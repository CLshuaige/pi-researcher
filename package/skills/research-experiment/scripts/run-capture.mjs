#!/usr/bin/env node
// Capture a real subprocess command and logs. Not a sandbox or job scheduler.
// Usage: node run-capture.mjs [--output PATH] [--cwd PATH] -- EXECUTABLE [ARGS...]
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { finished } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

const params = process.argv.slice(2);
const split = params.indexOf('--');
if (split < 0 || split === params.length - 1) {
  console.error('Usage: node run-capture.mjs [--output PATH] [--cwd PATH] -- EXECUTABLE [ARGS...]');
  process.exit(2);
}
const opts = params.slice(0, split);
const command = params.slice(split + 1);
const parsed = {};
for (let i = 0; i < opts.length; i += 2) {
  const key = opts[i], val = opts[i + 1];
  if (!['--output', '--cwd'].includes(key) || !val || parsed[key]) {
    console.error(`Invalid argument: ${key}`); process.exit(2);
  }
  parsed[key] = val;
}

// Prevent accidental log writes outside the invoking workspace; this does not
// restrict the command itself. Only an OS/container security boundary can do that.
const workspace = realpathSync(process.cwd());
function inWorkspace(file) {
  const absolute = resolve(workspace, file);
  const rel = relative(workspace, absolute);
  if (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) throw new Error(`Path is outside workspace: ${file}`);
  let existing = absolute;
  while (!existsSync(existing)) existing = dirname(existing);
  const canonical = resolve(realpathSync(existing), relative(existing, absolute));
  const effective = relative(workspace, canonical);
  if (effective.startsWith('..' + sep) || effective === '..' || isAbsolute(effective)) throw new Error(`Path symlink leaves workspace: ${file}`);
  return canonical;
}

async function main() {
  const startedAt = new Date().toISOString();
  const stamp = new Date(Date.parse(startedAt) + 8 * 3600000).toISOString()
    .replace(/[-:]/g, '').replace('T', '_').replace('.', '_').replace('Z', '');
  const cwd = inWorkspace(parsed['--cwd'] ?? '.');
  if (!existsSync(cwd)) throw new Error(`Command cwd does not exist: ${cwd}`);
  const out = inWorkspace(parsed['--output'] ?? `experiment/runs/${stamp}`);
  if (existsSync(out)) throw new Error(`Output path already exists; use a new run directory: ${out}`);
  mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
  mkdirSync(out, { mode: 0o700 });
  const stdoutFile = resolve(out, 'stdout.log'), stderrFile = resolve(out, 'stderr.log');
  const stdout = createWriteStream(stdoutFile, { flags: 'wx', mode: 0o600 });
  const stderr = createWriteStream(stderrFile, { flags: 'wx', mode: 0o600 });
  const startMs = Date.now();
  // 'shell:false' avoids implicit shell expansion. Never pass secrets in args.
  const child = spawn(command[0], command.slice(1), {
    cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  let forwarded = null;
  function relay(signal) {
    forwarded = signal;
    // Best effort process-group termination, not reliable remote scheduler cancellation.
    try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
    catch { try { child.kill(signal); } catch {} }
  }
  const sigint = () => relay('SIGINT');
  const sigterm = () => relay('SIGTERM');
  process.on('SIGINT', sigint); process.on('SIGTERM', sigterm);
  const logsFinished = Promise.all([finished(stdout), finished(stderr)]).catch(error => {
    relay('SIGTERM');
    return error;
  });
  const end = await new Promise(resolveFinish => {
    let settled = false;
    function resolveOnce(value) { if (!settled) { settled = true; resolveFinish(value); } }
    child.on('error', error => resolveOnce({ exitCode: null, signal: null, spawnError: error.message }));
    child.on('close', (code, signal) => resolveOnce({ exitCode: code, signal: signal || forwarded, spawnError: null }));
  });
  process.removeListener('SIGINT', sigint); process.removeListener('SIGTERM', sigterm);
  const logError = await logsFinished;
  if (logError instanceof Error) throw logError;
  const manifest = {
    startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - startMs,
    command, cwd: relative(workspace, cwd) || '.', exitCode: end.exitCode,
    signal: end.signal, spawnError: end.spawnError,
    stdout: 'stdout.log', stderr: 'stderr.log',
  };
  const target = resolve(out, 'run.json');
  const temp = resolve(out, `.run-${randomUUID()}.tmp`);
  try { writeFileSync(temp, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 }); renameSync(temp, target); }
  finally { rmSync(temp, { force: true }); }
  console.log(`RUN_CAPTURE ${JSON.stringify({ run: relative(workspace, out), exitCode: end.exitCode, signal: end.signal, spawnError: end.spawnError })}`);
  // Expose command failure through exit status; never claim that a log proves scientific validity.
  process.exitCode = end.exitCode === 0 && !end.spawnError && !end.signal ? 0 : (end.exitCode || 1);
}

main().catch(error => { console.error(`Capture failed: ${error.message}`); process.exitCode = 2; });
