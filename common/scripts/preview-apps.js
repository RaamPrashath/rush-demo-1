const { spawn } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const apps = [
  {
    name: "app-react-one",
    folder: path.join(repoRoot, "apps", "app-react-one"),
    port: 3001
  },
  {
    name: "app-react-two",
    folder: path.join(repoRoot, "apps", "app-react-two"),
    port: 3002
  }
];

const children = new Map();
let shuttingDown = false;

function prefixStream(appName, streamName, stream) {
  let buffered = "";

  stream.on("data", (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || "";

    for (const line of lines) {
      if (line.length > 0) {
        process[streamName].write(`[${appName}] ${line}\n`);
      }
    }
  });

  stream.on("end", () => {
    if (buffered.length > 0) {
      process[streamName].write(`[${appName}] ${buffered}\n`);
    }
  });
}

function stopAll(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log("Stopping preview servers...");

  for (const [appName, child] of children) {
    if (child.stdin && !child.stdin.destroyed) {
      child.stdin.write("Y\n");
      child.stdin.end();
    }

    if (process.platform === "win32" && child.pid) {
      console.log(`[${appName}] Stopping...`);
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore"
      });
    } else if (!child.killed) {
      console.log(`[${appName}] Stopping...`);
      child.kill("SIGINT");
    }
  }

  setTimeout(() => {
    for (const [appName, child] of children) {
      if (!child.killed) {
        console.log(`[${appName}] Force stopping...`);
        child.kill("SIGTERM");
      }
    }

    process.exit(exitCode);
  }, 3000);
}

console.log("Starting Vite preview servers:");
for (const app of apps) {
  console.log(`${app.name}: http://localhost:${app.port}`);
}

for (const app of apps) {
  const command = `rushx preview --host 0.0.0.0 --port ${app.port}`;
  const child = spawn(command, {
    cwd: app.folder,
    shell: true,
    stdio: ["pipe", "pipe", "pipe"]
  });

  children.set(app.name, child);
  prefixStream(app.name, "stdout", child.stdout);
  prefixStream(app.name, "stderr", child.stderr);

  child.on("exit", (code, signal) => {
    children.delete(app.name);

    if (shuttingDown) {
      return;
    }

    const reason = signal ? `signal ${signal}` : `exit code ${code}`;
    console.error(`[${app.name}] Preview process exited unexpectedly with ${reason}.`);
    stopAll(code || 1);
  });

  child.on("error", (error) => {
    console.error(`[${app.name}] Failed to start preview process: ${error.message}`);
    stopAll(1);
  });
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
