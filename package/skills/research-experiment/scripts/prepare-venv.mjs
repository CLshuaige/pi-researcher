#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { resolve, join, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--project" || !args[1]) {
  console.error("Usage: node prepare-venv.mjs --project experiment/<project>");
  process.exit(1);
}
const root = realpathSync(process.cwd());
const project = resolve(root, args[1]);
const inside = (path) => path === root || path.startsWith(root + sep);
const inherited = [process.env.VIRTUAL_ENV, process.env.CONDA_PREFIX].filter(
  Boolean,
);
const env = { ...process.env };
env.PATH = (env.PATH || "/usr/local/bin:/usr/bin:/bin")
  .split(":")
  .filter(
    (path) =>
      !inherited.some(
        (prefix) => path === prefix || path.startsWith(prefix + "/"),
      ) &&
      !/(?:^|\/)(?:\.venv|venv|(?:mini|ana)conda\d*|condabin)(?:\/|$)/i.test(
        path,
      ),
  )
  .join(":");
for (const key of [
  "VIRTUAL_ENV",
  "VIRTUAL_ENV_PROMPT",
  "CONDA_PREFIX",
  "CONDA_DEFAULT_ENV",
  "CONDA_SHLVL",
  "PYTHONHOME",
  "PYTHONPATH",
  "BASH_ENV",
])
  delete env[key];
function run(python, args, timeout = 60000) {
  const result = spawnSync(python, args, {
    cwd: project,
    env,
    encoding: "utf8",
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      result.error?.message ||
        result.stderr ||
        result.stdout ||
        "Python command failed",
    );
  return result.stdout.trim();
}
try {
  if (!inside(project))
    throw new Error("Project must stay inside the current Workspace");
  let ancestor = project;
  while (!existsSync(ancestor)) ancestor = resolve(ancestor, "..");
  if (!inside(realpathSync(ancestor)))
    throw new Error("Project symlink leaves the Workspace");
  mkdirSync(project, { recursive: true });
  const venv = join(project, ".venv");
  if (existsSync(venv) && lstatSync(venv).isSymbolicLink())
    throw new Error("A shared/symlinked .venv is not supported");
  const python = join(
    venv,
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  if (!existsSync(python))
    run("python3", ["-m", "venv", "--without-pip", venv]);
  const metadata = JSON.parse(
    run(python, [
      "-c",
      'import sys,json;print(json.dumps({"python":sys.executable,"version":sys.version,"prefix":sys.prefix,"basePrefix":sys.base_prefix}))',
    ]),
  );
  if (
    realpathSync(metadata.prefix) !== realpathSync(venv) ||
    metadata.prefix === metadata.basePrefix
  )
    throw new Error("Interpreter is not isolated in this experiment .venv");
  let pipVersion;
  let bootstrap;
  try {
    pipVersion = run(python, ["-m", "pip", "--version"]);
  } catch {
    // pip's official bootstrap works even when the host omits ensurepip.
    const source = "https://bootstrap.pypa.io/get-pip.py";
    let script;
    try {
      const response = await fetch(source, {
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok)
        throw new Error(`pip bootstrap download failed (${response.status})`);
      script = Buffer.from(await response.arrayBuffer());
    } catch {
      // curl honors the proxy and CA configuration on hosts whose Node fetch does not.
      const result = spawnSync(
        "curl",
        [
          "--fail",
          "--location",
          "--silent",
          "--show-error",
          "--connect-timeout",
          "10",
          "--max-time",
          "30",
          source,
        ],
        { cwd: project, env, timeout: 35000, maxBuffer: 8 * 1024 * 1024 },
      );
      if (result.error || result.status !== 0)
        throw new Error(
          "Cannot download the official pip bootstrap; check network/proxy access to bootstrap.pypa.io",
        );
      script = result.stdout;
    }
    if (script.length > 8 * 1024 * 1024)
      throw new Error("Unexpected pip bootstrap size");
    const path = join(venv, ".get-pip.py");
    writeFileSync(path, script, { mode: 0o600 });
    try {
      run(python, [path, "--disable-pip-version-check"], 120000);
    } finally {
      unlinkSync(path);
    }
    bootstrap = {
      source,
      sha256: createHash("sha256").update(script).digest("hex"),
    };
    pipVersion = run(python, ["-m", "pip", "--version"]);
  }
  const result = {
    project,
    venv,
    ...metadata,
    pip: pipVersion,
    ...(bootstrap ? { bootstrap } : {}),
  };
  writeFileSync(
    join(project, "environment.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error("Environment setup failed: " + error.message);
  process.exitCode = 1;
}
