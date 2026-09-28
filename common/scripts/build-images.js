const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "../..");
const deployConfigPath = path.join(repoRoot, "common", "config", "rush", "deploy.json");
const rushConfigPath = path.join(repoRoot, "rush.json");

// Concurrency limit to prevent CPU/memory deadlocks and machine freeze
const MAX_CONCURRENT = 2;

// Command line arguments
const args = process.argv.slice(2);
const changedOnly = args.includes("--changed-only");
const shouldPush = args.includes("--push");
const isSingle = args.includes("--single");
const concurrencyLimit = isSingle ? 1 : MAX_CONCURRENT;

// Registry prefix (default: ghcr.io/<owner> or env var)
const registryArgIndex = args.indexOf("--registry");
const registryPrefix = registryArgIndex !== -1 && args[registryArgIndex + 1]
  ? args[registryArgIndex + 1]
  : (process.env.REGISTRY_PREFIX || (process.env.GITHUB_REPOSITORY_OWNER ? `ghcr.io/${process.env.GITHUB_REPOSITORY_OWNER.toLowerCase()}` : ""));

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, ""));
}

function getChangedFiles() {
  const changedSet = new Set();
  const commandsToTry = [];

  if (process.env.GITHUB_BASE_REF) {
    commandsToTry.push(`git diff --name-only origin/${process.env.GITHUB_BASE_REF}...HEAD`);
  }
  commandsToTry.push("git diff --name-only HEAD~1 HEAD");
  commandsToTry.push("git status --porcelain");

  for (const cmd of commandsToTry) {
    try {
      const output = execSync(cmd, { cwd: repoRoot, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
      output.split(/\r?\n/).forEach((line) => {
        let f = line.trim();
        if (f.startsWith("M ") || f.startsWith("M  ") || f.startsWith("?? ") || f.startsWith("AM ") || f.startsWith("A  ")) {
          f = f.replace(/^[?\sMADCRAU]+\s+/, "");
        }
        if (f) changedSet.add(f.replace(/\\/g, "/"));
      });
    } catch {
      // ignore
    }
  }

  return Array.from(changedSet);
}

function getDeployProjects() {
  const deployJson = loadJson(deployConfigPath);
  const rushJson = loadJson(rushConfigPath);

  const targetNames = new Set();
  if (Array.isArray(deployJson.deploymentProjectNames)) {
    for (const name of deployJson.deploymentProjectNames) targetNames.add(name);
  }
  if (Array.isArray(deployJson.projectSettings)) {
    for (const setting of deployJson.projectSettings) {
      if (setting.projectName) targetNames.add(setting.projectName);
      if (Array.isArray(setting.additionalProjectsToInclude)) {
        for (const addName of setting.additionalProjectsToInclude) targetNames.add(addName);
      }
    }
  }

  const changedFiles = changedOnly ? getChangedFiles() : [];
  if (changedOnly) {
    console.log(`[INFO] --changed-only active. Detected ${changedFiles.length} modified files in git.\n`);
  }

  const projects = [];
  for (const name of targetNames) {
    const rushProj = rushJson.projects.find((p) => p.packageName === name);
    if (!rushProj) {
      console.warn(`[WARN] Project "${name}" in deploy.json not found in rush.json. Skipping.`);
      continue;
    }

    const normalizedFolder = rushProj.projectFolder.replace(/\\/g, "/");
    const folder = path.join(repoRoot, rushProj.projectFolder);
    const dockerfile = path.join(folder, "Dockerfile");

    if (!fs.existsSync(dockerfile)) {
      console.warn(`[WARN] No Dockerfile found in "${rushProj.projectFolder}". Skipping image build.`);
      continue;
    }

    const tagBase = registryPrefix ? `${registryPrefix}/${name}` : name;
    const fullTag = `${tagBase}:latest`;

    // Check if this project folder was touched by git changes (file inside or submodule pointer)
    const hasChanges = !changedOnly || changedFiles.some((f) => f.startsWith(normalizedFolder) || f === normalizedFolder);

    // If --changed-only is active and project had no git changes, check if image is missing from registry
    if (changedOnly && !hasChanges) {
      let imageExists = false;
      if (shouldPush && registryPrefix) {
        try {
          execSync(`docker manifest inspect ${fullTag}`, { stdio: "ignore" });
          imageExists = true;
        } catch {
          imageExists = false;
        }
      } else {
        try {
          execSync(`docker image inspect ${fullTag}`, { stdio: "ignore" });
          imageExists = true;
        } catch {
          imageExists = false;
        }
      }

      if (!imageExists) {
        console.log(`[BOOTSTRAP] Project "${name}" had no git changes, but "${fullTag}" does not exist yet. Building initial image!`);
      } else {
        console.log(`[SKIP] Project "${name}" had no changes and image exists. Skipping.`);
        continue;
      }
    }

    projects.push({
      name,
      folder,
      imageTag: fullTag
    });
  }

  return projects;
}

function prefixStream(tag, stream, outStream) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim().length > 0) {
        outStream.write(`[${tag}] ${line}\n`);
      }
    }
  });
  stream.on("end", () => {
    if (buffer.trim().length > 0) {
      outStream.write(`[${tag}] ${buffer}\n`);
    }
  });
}

function runCommand(command, argsList, tag) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argsList, { cwd: repoRoot, shell: false });
    prefixStream(tag, child.stdout, process.stdout);
    prefixStream(tag, child.stderr, process.stderr);

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command ${command} exited with code ${code}`));
    });

    child.on("error", (err) => reject(err));
  });
}

async function buildAndPushProject(project) {
  const start = Date.now();
  console.log(`\n🚀 [${project.name}] Starting Docker build -> Tag: ${project.imageTag}`);

  try {
    // 1. Build Docker image
    await runCommand("docker", ["build", "-t", project.imageTag, project.folder], project.name);
    const buildDuration = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`✅ [${project.name}] Built image in ${buildDuration}s`);

    // 2. Push to Registry if requested
    if (shouldPush) {
      console.log(`📤 [${project.name}] Pushing ${project.imageTag} to Registry...`);
      const pushStart = Date.now();
      await runCommand("docker", ["push", project.imageTag], project.name);
      const pushDuration = ((Date.now() - pushStart) / 1000).toFixed(1);
      console.log(`🚀 [${project.name}] Pushed to Registry in ${pushDuration}s`);
    }

    const totalDuration = ((Date.now() - start) / 1000).toFixed(1);
    return { name: project.name, tag: project.imageTag, status: shouldPush ? "BUILT & PUSHED" : "BUILT", duration: `${totalDuration}s` };
  } catch (err) {
    console.error(`❌ [${project.name}] Failed:`, err.message);
    return { name: project.name, tag: project.imageTag, status: "FAILED", duration: "N/A" };
  }
}

async function runParallel(projects, limit) {
  const results = [];
  const queue = [...projects];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      const res = await buildAndPushProject(item);
      results.push(res);
    }
  }

  const workers = Array.from({ length: Math.min(limit, projects.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log("=================================================");
  console.log(" Rush Deploy Smart Selective Docker Builder");
  console.log("=================================================");
  console.log(`Options: changedOnly=${changedOnly}, push=${shouldPush}, single=${isSingle}`);
  if (registryPrefix) {
    console.log(`Registry: ${registryPrefix}`);
  }

  const projects = getDeployProjects();

  if (projects.length === 0) {
    console.log("\n✨ No projects need building (all up to date based on deploy.json)!");
    return;
  }

  console.log(`\nFound ${projects.length} project(s) ready to build:`);
  projects.forEach((p, idx) => console.log(`  ${idx + 1}. ${p.name} (tag: ${p.imageTag})`));
  console.log(`\nMax parallel builds: ${concurrencyLimit}${isSingle ? " (sequential / one-by-one mode)" : ""}\n`);

  const results = await runParallel(projects, concurrencyLimit);

  console.log("\n=================================================");
  console.log(" Docker Build & Push Summary");
  console.log("=================================================");
  console.table(results);

  const hasFailures = results.some((r) => r.status === "FAILED");
  if (hasFailures) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
