import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const backendDir = path.join(rootDir, "backend");
const pythonBinary = path.join(rootDir, ".venv", "bin", "python");

const childProcesses = [];

function spawnProcess(label, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  childProcesses.push(child);

  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`${label} exited with signal ${signal}`);
    } else if (code !== 0) {
      console.log(`${label} exited with code ${code}`);
    }

    if (!shuttingDown) {
      shutdown(code ?? 1);
    }
  });

  return child;
}

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 100);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

spawnProcess("backend", pythonBinary, ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"], backendDir);
spawnProcess("frontend", "npm", ["run", "dev:frontend"], rootDir);
