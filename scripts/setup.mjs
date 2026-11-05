#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 19))
  throw new Error("Node.js 22.19 or newer is required.");
// pi-subagents 0.84.0 has no configuration switch for its implicit run/tool
// deadlines. Remove only fallback timers; explicit call/agent/config limits win.
function patchSubagentTimeouts() {
  for (const location of ['.pi/npm/node_modules/pi-subagents', 'package/node_modules/pi-subagents']) {
    const directory = join(root, location);
    if (!existsSync(directory)) continue;
    const version = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version;
    if (version !== '0.84.0') throw new Error(`Review timeout compatibility patch for pi-subagents ${version}`);
    const bundle = join(directory, 'bundle');
    let found = 0;
    for (const name of readdirSync(bundle).filter(name => name.endsWith('.js'))) {
      const path = join(bundle, name);
      const source = readFileSync(path, 'utf8');
      let patched = source;
      for (const constant of ['DEFAULT_ASYNC_TIMEOUT_MS', 'DEFAULT_FOREGROUND_TIMEOUT_MS', 'DEFAULT_FAST_TOOL_TIMEOUT_MS']) {
        const pattern = new RegExp(`var ${constant} = (?:30 \\* 60 \\* 1e3|3e5|void 0);`, 'g');
        patched = patched.replace(pattern, () => { found++; return `var ${constant} = void 0;`; });
      }
      patched = patched.replaceAll('Foreground and single async runs use config timeoutMs, else 30m; async composites have no default parent deadline. Alias maxRuntimeMs; must agree.', 'Optional explicit run deadline; no implicit runtime limit. Alias maxRuntimeMs; must agree.')
        .replaceAll('Per-tool deadline (ms); fast builtins default 5m.', 'Optional explicit per-tool deadline (ms); no implicit tool limit.');
      if (patched !== source) writeFileSync(path, patched);
    }
    if (found !== 3) throw new Error(`Timeout compatibility patch mismatch in ${location}: found ${found}/3 defaults`);
  }
}
if (process.argv.includes('--patch-timeouts')) {
  patchSubagentTimeouts();
  process.exit(0);
}
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
patchSubagentTimeouts();
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
