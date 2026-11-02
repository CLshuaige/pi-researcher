import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { getSettings, toolSource, settingsSchema } from '../skills/research-task/scripts/check-settings.mjs';

const capture = fileURLToPath(new URL('../skills/research-experiment/scripts/run-capture.mjs', import.meta.url));
const verify = fileURLToPath(new URL('../skills/research-experiment/scripts/verify-run.mjs', import.meta.url));
const settings = fileURLToPath(new URL('../skills/research-task/scripts/check-settings.mjs', import.meta.url));
function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'pi-modules-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function config(root, value) {
  mkdirSync(join(root, '.pi'), { recursive: true });
  writeFileSync(join(root, '.pi/research-modules.json'), JSON.stringify(value));
}
function run(root, command, out = 'runs/test') {
  return spawnSync(process.execPath, [capture, '--output', out, '--', ...command], { cwd: root, encoding: 'utf8', timeout: 10000 });
}
function check(root, dir = 'runs/test') {
  return spawnSync(process.execPath, [verify, '--run', dir], { cwd: root, encoding: 'utf8', timeout: 10000 });
}
test('defaults and partial preferences preserve selected mode and sources', t => {
  const root = workspace(t);
  assert.equal(getSettings(root).interactionMode, 'auto');
  assert.ok(getSettings(root).literature.sources.includes('semantic_scholar'));
  config(root, { interactionMode: 'auto', literature: { sources: [], writeReview: true } });
  assert.deepEqual(getSettings(root).literature, { sources: [], writeReview: true });
  assert.equal(getSettings(root).interactionMode, 'auto');
  config(root, { literature: { sources: ['crossref'] } });
  assert.equal(getSettings(root).literature.writeReview, false);
});
test('reject invalid preferences rather than silently use defaults', t => {
  const root = workspace(t);
  for (const value of [null, [], { interactionMode: null }, { interactionMode: 'automatic' },
    { apiKey: 'test' }, { literature: null }, { literature: { writeReview: 'false' } },
    { literature: { sources: ['crossref', 'crossref'] } }, { literature: { sources: ['unknown_source'] } }]) {
    config(root, value);
    assert.throws(() => getSettings(root));
  }
});
test('settings CLI reads the invoking project without copying the schema', t => {
  const root = workspace(t);
  config(root, { interactionMode: 'auto', literature: { sources: ['crossref'], writeReview: true } });
  const result = spawnSync(process.execPath, [settings], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    source: '.pi/research-modules.json', interactionMode: 'auto',
    literature: { sources: ['crossref'], writeReview: true },
    hypothesis: { max_debate_iterations: 5 }, method: { max_debate_iterations: 5 },
  });
  assert.equal(existsSync(join(root, '.pi/research-modules.schema.json')), false);
});
test('schema source names and plugin mappings agree; old spelling remains readable', t => {
  const root = workspace(t);
  config(root, { $schema: './research-modules.schema.json', literature: { sources: ['semantic'] } });
  assert.deepEqual(getSettings(root).literature.sources, ['semantic_scholar']);
  assert.equal(toolSource('semantic_scholar'), 'semantic');
  for (const item of settingsSchema.properties.literature.properties.sources.items.oneOf) {
    assert.ok(item.title);
    assert.equal(toolSource(item.const), item['x-tool-value']);
  }
});
test('capture real output, preserve argv literally, verify success', t => {
  const root = workspace(t);
  const literal = '$(touch unwanted) and spaces';
  const r = run(root, [process.execPath, '-e', 'console.log(process.argv[1]); console.error("err")', literal]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(root, 'runs/test/stdout.log'), 'utf8').trim(), literal);
  assert.equal(readFileSync(join(root, 'runs/test/stderr.log'), 'utf8').trim(), 'err');
  assert.equal(existsSync(join(root, 'unwanted')), false);
  assert.equal(check(root).status, 0);
});
test('default run directory uses the actual Beijing start timestamp', t => {
  const root = workspace(t);
  const result = spawnSync(process.execPath, [capture, '--', process.execPath, '--version'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout.trim().replace(/^RUN_CAPTURE /, ''));
  assert.match(record.run, /^experiment\/runs\/\d{8}_\d{6}_\d{3}$/);
  const manifest = JSON.parse(readFileSync(join(root, record.run, 'run.json')));
  const stamp = new Date(Date.parse(manifest.startedAt) + 8 * 3600000).toISOString()
    .replace(/[-:]/g, '').replace('T', '_').replace('.', '_').replace('Z', '');
  assert.equal(record.run, 'experiment/runs/' + stamp);
  assert.equal(check(root, record.run).status, 0);
});
test('command failure keeps its real exit code and logs', t => {
  const root = workspace(t);
  assert.equal(run(root, [process.execPath, '-e', 'console.error("failed"); process.exit(7)']).status, 7);
  const r = check(root);
  assert.equal(r.status, 1);
  const details = JSON.parse(r.stdout);
  assert.equal(details.logsPresent, true);
  assert.equal(details.processSucceeded, false);
});
test('missing executable records failure', t => {
  const root = workspace(t);
  const r = run(root, ['pi-test-nonexistent-executable']);
  assert.notEqual(r.status, 0);
  const m = JSON.parse(readFileSync(join(root, 'runs/test/run.json')));
  assert.equal(m.exitCode, null);
  assert.ok(m.spawnError);
  assert.equal(check(root).status, 1);
});
test('capture preserves old runs and rejects traversal and symlink escape', t => {
  const root = workspace(t), outside = workspace(t);
  assert.equal(run(root, [process.execPath, '--version']).status, 0);
  assert.notEqual(run(root, [process.execPath, '--version']).status, 0);
  assert.notEqual(run(root, [process.execPath, '--version'], '../escape-run').status, 0);
  symlinkSync(outside, join(root, 'escape'), 'dir');
  assert.notEqual(run(root, [process.execPath, '--version'], 'escape/run').status, 0);
  assert.equal(existsSync(join(outside, 'run')), false);
});
test('verification rejects missing or symlinked logs and invalid manifests', t => {
  const root = workspace(t), outside = workspace(t);
  assert.equal(run(root, [process.execPath, '--version']).status, 0);
  const log = join(root, 'runs/test/stdout.log');
  rmSync(log);
  writeFileSync(join(outside, 'log'), 'other workspace');
  symlinkSync(join(outside, 'log'), log);
  const result = check(root);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).logsPresent, false);
  rmSync(log);
  writeFileSync(log, '');
  const file = join(root, 'runs/test/run.json');
  const m = JSON.parse(readFileSync(file));
  delete m.command;
  writeFileSync(file, JSON.stringify(m));
  const malformed = check(root);
  assert.equal(malformed.status, 1);
  assert.equal(JSON.parse(malformed.stdout).logsPresent, true);
});
test('termination is captured and forwarded to the running process', { timeout: 10000 }, async t => {
  const root = workspace(t);
  const child = spawn(process.execPath, [capture, '--output', 'runs/test', '--', process.execPath, '-e',
    'console.log("ready"); setInterval(()=>{},1000)'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const close = once(child, 'close');
  const deadline = Date.now() + 5000;
  while (!existsSync(join(root, 'runs/test/stdout.log')) || !readFileSync(join(root, 'runs/test/stdout.log'), 'utf8').includes('ready')) {
    if (Date.now() > deadline) assert.fail('command did not become ready');
    await new Promise(r => setTimeout(r, 20));
  }
  child.kill('SIGTERM');
  const [code] = await close;
  assert.notEqual(code, 0);
  assert.equal(JSON.parse(readFileSync(join(root, 'runs/test/run.json'))).signal, 'SIGTERM');
  assert.equal(check(root).status, 1);
});

test('discussion settings validate and expose per-stage iteration limits', t => {
  const root = workspace(t);
  assert.equal(getSettings(root).hypothesis.max_debate_iterations, 5);
  assert.equal(getSettings(root).method.max_debate_iterations, 5);
  config(root, { hypothesis: { max_debate_iterations: 3 }, method: { max_debate_iterations: 2 } });
  assert.equal(getSettings(root).hypothesis.max_debate_iterations, 3);
  assert.equal(getSettings(root).method.max_debate_iterations, 2);
  config(root, { method: { max_debate_iterations: 0 } });
  assert.throws(() => getSettings(root), /max_debate_iterations/);
});

test('experiment environment setup rejects paths outside its Workspace', t => {
  const root = workspace(t);
  const prepare = fileURLToPath(new URL('../skills/research-experiment/scripts/prepare-venv.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [prepare, '--project', '../outside'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /inside the current Workspace/);
});
