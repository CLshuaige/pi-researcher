#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 19))
  throw new Error("Node.js 22.19 or newer is required.");
const check = process.argv.includes("--check");
const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error || result.status !== 0)
    throw result.error || new Error(`${command} exited with ${result.status}`);
};
if (!check) {
  for (const dir of ["package", "web"])
    run(process.platform === "win32" ? "npm.cmd" : "npm", [
      "ci",
      "--prefix",
      dir,
      "--no-audit",
      "--no-fund",
    ]);
  const cli = join(
    root,
    "package/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
  );
  for (const source of [
    "./package",
    "npm:pi-subagents@0.84.0",
    "npm:pi-ask-user@0.17.0",
    "npm:pi-web-access@0.45.0",
    "npm:@duskmoon/pi-academic-search@0.1.1",
    "npm:pi-arxivist@0.1.7",
  ]) {
    run(process.execPath, [cli, "install", "--local", source]);
  }
  const agent = join(root, ".pi/agent");
  mkdirSync(agent, { recursive: true });
  if (!existsSync(join(agent, "models.json")))
    copyFileSync(
      join(root, "package/config/models.json"),
      join(agent, "models.json"),
    );
  if (process.argv.includes("--browser"))
    run("npm", [
      "--prefix",
      "web",
      "exec",
      "--",
      "playwright",
      "install",
      "chromium",
    ]);
}
for (const dir of ["package", "web"]) {
  if (!existsSync(join(root, dir, "node_modules")))
    throw new Error(`Missing ${dir}/node_modules. Run node scripts/setup.mjs.`);
}
const env = { ...process.env };
env.PATH = (env.PATH || "")
  .split(":")
  .filter(
    (path) =>
      !/(?:^|\/)(?:\.venv|venv|(?:mini|ana)conda\d*)(?:\/|$)/i.test(path),
  )
  .join(":");
for (const key of ["VIRTUAL_ENV", "CONDA_PREFIX", "PYTHONPATH", "PYTHONHOME"])
  delete env[key];
const python = spawnSync(
  "python3",
  ["-c", "import sys,venv;print(sys.version.split()[0])"],
  { cwd: root, env, encoding: "utf8" },
);
console.log("Node dependencies ready.");
console.log(
  python.status === 0
    ? `Python ${python.stdout.trim()} ready. Each experiment uses its own .venv.`
    : "Install Python 3 with the venv module before running Python experiments.",
);
console.log(
  "Missing ensurepip is handled by the experiment environment helper. Proxy hosts may also need curl.",
);
console.log("Configure model credentials, then run: npm --prefix web run dev");
