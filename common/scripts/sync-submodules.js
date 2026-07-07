const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "../..");
const projectsConfigPath = path.join(
  repoRoot,
  "common",
  "config",
  "projects.json"
);

function run(command, args, options = {}) {
  const cwd = options.cwd || repoRoot;

  console.log(`\n> ${command} ${args.join(" ")}`);

  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function read(command, args, options = {}) {
  const cwd = options.cwd || repoRoot;

  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim();
}

function pathExists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function ensureParentDir(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const parentDir = path.dirname(absolutePath);

  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
}

function normalizeProject(project) {
  if (!project.name) {
    throw new Error("Each project must have a name.");
  }

  if (!project.repo) {
    throw new Error(`Project "${project.name}" is missing repo.`);
  }

  return {
    name: project.name,
    repo: project.repo,
    path: project.path || `apps/${project.name}`,
    branch: project.branch || "main",
    commit: project.commit || "latest"
  };
}

function isGitRepo() {
  return read("git", ["rev-parse", "--is-inside-work-tree"]) === "true";
}

function ensureGitmodulesFile() {
  const gitmodulesPath = path.join(repoRoot, ".gitmodules");

  if (!fs.existsSync(gitmodulesPath)) {
    console.log("\nCreating missing .gitmodules file");
    fs.writeFileSync(gitmodulesPath, "", "utf8");
  }

  const stat = fs.statSync(gitmodulesPath);

  if (!stat.isFile()) {
    throw new Error(".gitmodules exists but is not a file.");
  }
}

function isSubmoduleRegistered(projectPath) {
  const submodulePaths = read("git", [
    "config",
    "--file",
    ".gitmodules",
    "--get-regexp",
    "path"
  ]);

  if (!submodulePaths) {
    return false;
  }

  return submodulePaths
    .split("\n")
    .some((line) => line.trim().endsWith(` ${projectPath}`));
}

function getCurrentCommit(projectPath) {
  return read("git", ["rev-parse", "HEAD"], {
    cwd: path.join(repoRoot, projectPath)
  });
}

function ensureCleanSubmodule(project) {
  const projectRoot = path.join(repoRoot, project.path);

  const status = read("git", ["status", "--porcelain"], {
    cwd: projectRoot
  });

  if (status) {
    throw new Error(
      `Submodule "${project.name}" has uncommitted changes.\n` +
      `Commit/stash them before syncing:\n\n${status}`
    );
  }
}

function addSubmodule(project) {
  console.log(`\nAdding submodule: ${project.name}`);

  ensureParentDir(project.path);

  if (project.commit === "latest") {
    run("git", [
      "submodule",
      "add",
      "-b",
      project.branch,
      project.repo,
      project.path
    ]);
  } else {
    run("git", [
      "submodule",
      "add",
      project.repo,
      project.path
    ]);
  }
}

function initSubmodule(project) {
  console.log(`\nInitializing submodule: ${project.name}`);

  run("git", [
    "submodule",
    "update",
    "--init",
    "--recursive",
    "--",
    project.path
  ]);
}

function checkoutLatest(project) {
  const projectRoot = path.join(repoRoot, project.path);

  console.log(`\nChecking out latest ${project.branch} for ${project.name}`);

  run("git", ["fetch", "origin", "--prune", "--tags"], {
    cwd: projectRoot
  });

  const currentBranch = read("git", ["branch", "--show-current"], {
    cwd: projectRoot
  });

  if (currentBranch !== project.branch) {
    const localBranchExists = read("git", ["rev-parse", "--verify", project.branch], {
      cwd: projectRoot
    });

    if (localBranchExists) {
      run("git", ["checkout", project.branch], {
        cwd: projectRoot
      });
    } else {
      run("git", ["checkout", "-B", project.branch, `origin/${project.branch}`], {
        cwd: projectRoot
      });
    }
  }

  run("git", ["pull", "--ff-only", "origin", project.branch], {
    cwd: projectRoot
  });
}

function checkoutPinnedCommit(project) {
  const projectRoot = path.join(repoRoot, project.path);

  console.log(`\nChecking out pinned commit for ${project.name}: ${project.commit}`);

  run("git", ["fetch", "origin", "--prune", "--tags"], {
    cwd: projectRoot
  });

  run("git", ["checkout", project.commit], {
    cwd: projectRoot
  });
}

function syncSubmodule(project) {
  console.log("\n=======================================");
  console.log(`Syncing ${project.name}`);
  console.log(`Path: ${project.path}`);
  console.log(`Repo: ${project.repo}`);
  console.log(`Branch: ${project.branch}`);
  console.log(`Target commit: ${project.commit}`);
  console.log("=======================================");

  const alreadyRegistered = isSubmoduleRegistered(project.path);

  if (!alreadyRegistered) {
    if (pathExists(project.path)) {
      throw new Error(
        `Path exists but is not registered as a submodule: ${project.path}\n` +
        "Remove it first or register it manually."
      );
    }

    addSubmodule(project);
  }

  initSubmodule(project);
  ensureCleanSubmodule(project);

  const beforeCommit = getCurrentCommit(project.path);

  if (project.commit === "latest") {
    checkoutLatest(project);
  } else {
    checkoutPinnedCommit(project);
  }

  const afterCommit = getCurrentCommit(project.path);
  const changed = beforeCommit !== afterCommit;

  console.log(`\n${project.name}`);
  console.log(`Before: ${beforeCommit}`);
  console.log(`After:  ${afterCommit}`);
  console.log(`Changed: ${changed ? "yes" : "no"}`);

  return {
    name: project.name,
    path: project.path,
    target: project.commit,
    finalCommit: afterCommit,
    changed
  };
}

function main() {
  if (!isGitRepo()) {
    throw new Error(
      "This folder is not a Git repository.\n" +
      "Run `git init` before using Git submodules."
    );
  }

  ensureGitmodulesFile();

  if (!fs.existsSync(projectsConfigPath)) {
    throw new Error(`Missing config file: ${projectsConfigPath}`);
  }

  const rawProjects = JSON.parse(fs.readFileSync(projectsConfigPath, "utf8"));
  const projects = rawProjects.map(normalizeProject);

  const results = [];

  for (const project of projects) {
    results.push(syncSubmodule(project));
  }

  console.log("\n=======================================");
  console.log("Submodule Sync Summary");
  console.log("=======================================");
  console.table(results);

  console.log("\nParent repo status:");
  run("git", ["status", "--short"]);

  console.log("\nIf submodule pointers changed, record them with:");
  console.log("  git add .gitmodules apps");
  console.log('  git commit -m "Sync application submodules"');
}

main();