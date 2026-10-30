#!/usr/bin/env node
// Deterministic structural log check; NOT scientific validation.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const index = args.indexOf('--run');
if (args.length !== 2 || index !== 0 || !args[1] || args[1].startsWith('--')) { console.error('Usage: node verify-run.mjs --run PATH'); process.exit(2); }
const workspace = realpathSync(process.cwd());
const run = resolve(workspace, args[index + 1]);
const rel = relative(workspace, run);
if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) { console.error('Run path outside workspace'); process.exit(2); }
if (!existsSync(run) || !statSync(run).isDirectory() || realpathSync(run) !== run) { console.error('Run directory absent or symlinked'); process.exit(2); }
const issues = [];
let manifest;
try { manifest = JSON.parse(readFileSync(join(run, 'run.json'), 'utf8')); }
catch (error) { console.error('Invalid or missing run.json:', error.message); process.exit(1); }
if (!Array.isArray(manifest.command) || !manifest.command.length || manifest.command.some(x => typeof x !== 'string')) issues.push('command missing');
if (!Number.isFinite(Date.parse(manifest.startedAt)) || !Number.isFinite(Date.parse(manifest.finishedAt))) issues.push('timestamps missing');
else if (Date.parse(manifest.finishedAt) < Date.parse(manifest.startedAt)) issues.push('timestamps reversed');
if (!Number.isFinite(manifest.durationMs) || manifest.durationMs < 0) issues.push('duration invalid');
if (!Number.isInteger(manifest.exitCode) && manifest.exitCode !== null) issues.push('exitCode invalid');
if (manifest.exitCode !== 0 || manifest.signal || manifest.spawnError) issues.push('process did not finish successfully');
let logsPresent = true;
for (const name of ['stdout', 'stderr']) {
  const file = manifest[name];
  if (typeof file !== 'string' || file !== `${name}.log`) { issues.push(`${name} path invalid`); logsPresent = false; continue; }
  const target = join(run, file);
  if (!existsSync(target) || !statSync(target).isFile() || realpathSync(target) !== target) { issues.push(`${name} file missing or symlinked`); logsPresent = false; }
}
const result = { run: rel, logsPresent, processSucceeded: manifest.exitCode === 0 && !manifest.signal && !manifest.spawnError, issues, note: 'This checks command capture structure only. It does NOT validate dataset provenance, metrics or scientific claims.' };
console.log(JSON.stringify(result, null, 2));
process.exitCode = issues.length ? 1 : 0;
