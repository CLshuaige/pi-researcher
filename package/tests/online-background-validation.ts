/** Explicitly opted-in paid lifecycle validation; excluded from npm test. */
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAgentSession, DefaultResourceLoader, ModelRegistry, ModelRuntime, SessionManager, SettingsManager, getAgentDir } from '@earendil-works/pi-coding-agent';
import { ChecklistStore } from '../extensions/researcher/checklist.ts';
import { applyChecklistAction } from '../extensions/researcher/checklist-tool.ts';
import { ResearchController } from '../extensions/researcher/controller.ts';
import { ResearchRunner } from '../extensions/researcher/runner.ts';
import { moduleResources } from '../extensions/researcher/modules.ts';
import { zeroUsage, addUsage } from '../extensions/researcher/usage.ts';
import envProxy from '../extensions/env-proxy/index.ts';

if (!process.argv.includes('--run-paid')) throw Error('Requires --run-paid --provider <provider> --model <model>');
const arg = (name: string) => { const i = process.argv.indexOf(name); const value = i >= 0 ? process.argv[i + 1] : undefined; if (!value || value.startsWith('--')) throw Error(`Supply ${name}`); return value; };
const provider = arg('--provider'), modelId = arg('--model');
const root = mkdtempSync('/tmp/research-online-lifecycle-'), store = new ChecklistStore(root), runner = new ResearchRunner();
store.files.initialize('Verify background lifecycle with a local 42-byte fixture; this is not scientific research.');
store.initialize('Generate a fixture in a managed job and verify its 42-byte output.');
mkdirSync(store.path('.pi'), { recursive: true });
writeFileSync(store.path('.pi/research.json'), JSON.stringify({ childExtensions: [], extraTools: [], reviewerTools: [], enableMcp: false }));
writeFileSync(store.path('job.cjs'), "const fs=require('fs'); console.log('Expected output: 42 bytes; waiting for release'); const t=setInterval(()=>{if(fs.existsSync('release')){fs.writeFileSync('evidence.txt','x'.repeat(42));console.log('DONE: 42 bytes');clearInterval(t)}},100);\n");
applyChecklistAction(store, { action: 'plan', expectedRevision: store.read()!.revision, reason: 'Online lifecycle fixture', modules: [
  { id: 'M1', objective: 'Run job.cjs and verify evidence.txt', skills: ['research-task'], criteria: ['Managed process succeeded and evidence.txt contains exactly 42 x characters'] },
  { id: 'M2', objective: 'Write a short verification report', skills: ['research-report'], dependencies: ['M1'], criteria: ['report.md records 42 bytes and explicitly describes a synthetic integration fixture, not scientific evidence'] },
] });
const agentDir = getAgentDir(), cache = store.path('.research/model-cache.json');
if (existsSync(join(agentDir, 'models-store.json'))) copyFileSync(join(agentDir, 'models-store.json'), cache);
envProxy({} as never);
const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), modelsStorePath: cache, allowModelNetwork: false });
const registry = new ModelRegistry(runtime), selected = registry.find(provider, modelId);
assert.ok(selected && registry.hasConfiguredAuth(selected), 'Current Pi model and authentication required');
const model = selected!;
let controller!: ResearchController, requests = 0, failure: string | undefined;
const usage = zeroUsage(), trace: object[] = [], checks: string[] = [];
const log = (entry: object) => { trace.push({ time: Date.now(), ...entry }); console.log(JSON.stringify(entry)); };
const abort = new AbortController();
const timeout = setTimeout(() => abort.abort(Error('Online test deadline: 8 minutes')), 480000);
const settings = SettingsManager.inMemory({ packages: [], extensions: [], skills: [], retry: { enabled: false }, compaction: { enabled: false } });
const loader = new DefaultResourceLoader({ cwd: root, agentDir: store.path('.research/test-agent'), settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, extensionFactories: [pi => {
  controller = new ResearchController(pi, runner); controller.bind();
  pi.on('session_start', (_event, ctx) => controller.activate(ctx));
  pi.on('tool_call', event => { log({ event: 'tool', name: event.toolName, input: event.input }); });
  pi.registerProvider(provider, { api: model.api, baseUrl: model.baseUrl, apiKey: 'host-managed', models: [model], streamSimple: (_m, context, options) => {
    abort.signal.throwIfAborted();
    if (++requests > 24) throw Error('Online request limit: 24');
    const texts = context.messages.flatMap(m => typeof m.content === 'string' ? [m.content] : m.content.flatMap(b => b.type === 'text' ? [b.text] : []));
    const checkpoint = texts.map(t => { try { return JSON.parse(t); } catch { return undefined; } }).findLast(c => c?.skillInstructions);
    const skills = checkpoint?.currentModule?.skills ?? [];
    for (const path of moduleResources(skills).skills) assert.ok(checkpoint.skillInstructions.some((s: { instructions: string }) => s.instructions === readFileSync(path, 'utf8')), 'Full Skill must reach real API');
    const { apiKey: _key, headers: _headers, env: _env, ...rest } = options ?? {};
    const number = requests;
    log({ event: 'request', number, skills });
    const stream = registry.streamSimple(model, context, { ...rest, maxTokens: 4096, signal: options?.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal });
    void stream.result().then(message => { addUsage(usage, message.usage); log({ event: 'response', number, stopReason: message.stopReason, usage: message.usage, error: message.errorMessage }); }).catch(error => log({ event: 'stream-error', number, error: String(error) }));
    return stream;
  } });
}] });
log({ event: 'start', root, model: `${provider}/${modelId}`, limits: { requests: 24, outputTokens: 4096, seconds: 480 } });
await loader.reload();
const { session } = await createAgentSession({ cwd: root, model, thinkingLevel: 'off', settingsManager: settings, resourceLoader: loader, sessionManager: SessionManager.create(root, store.path('.research/main-session')), tools: ['research_checklist', 'research_job', 'read', 'write'] });
const cancel = () => { void session.abort(); };
abort.signal.addEventListener('abort', cancel, { once: true });
const waitFor = async (predicate: () => boolean) => { while (!predicate()) { abort.signal.throwIfAborted(); if (!controller.active) throw Error(`Research paused unexpectedly: ${store.read()!.control.reason}`); await new Promise(r => setTimeout(r, 100)); } };
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
try {
  await session.bindExtensions({ mode: 'print' });
  await session.prompt(`This is an integration test. Resolve this instruction, start M1, and launch exactly one managed job with command ${JSON.stringify(`${quote(process.execPath)} job.cjs`)} and timeoutSeconds 420. Do not create the release file: the external harness releases it. Read job.cjs if needed. Then call research_job wait ALONE with wakeAfterSeconds: 2. When that timer wakes you, inspect status at most once and wait again WITHOUT a timer. Do not poll. After a later user question, answer it in Chinese, resolve it, and wait without a timer. When the job finally succeeds, read evidence.txt, verify its 42 x characters and accept M1. Then start M2, write report.md, accept M2 and finish. Never accept while the job is running. No delegation, internet, external data, training, or extra jobs. Use the latest expectedRevision; wait returns terminate and needs no follow-up response.`);
  assert.equal(store.read()!.control.state, 'waiting');
  await waitFor(() => store.read()!.control.continuations >= 1 && store.read()!.control.state === 'waiting' && !session.isStreaming);
  const job = store.files.jobs()[0]; assert.ok(job); assert.equal(store.files.jobs().length, 1);
  const before = requests;
  await new Promise(r => setTimeout(r, 800)); assert.equal(requests, before);
  checks.push('timed wake followed by zero-poll waiting'); log({ event: 'waiting-verified', requests });
  await controller.pause('Online pause fixture');
  assert.equal(store.files.readJob(job.id).status, 'running'); assert.ok(existsSync(store.path('.research/controller.lock')));
  await new Promise(r => setTimeout(r, 800)); assert.equal(requests, before);
  checks.push('pause preserves process and owner without model requests');
  const messageStart = session.messages.length;
  await session.prompt('这个后台任务预计产生多少字节？请先回答，再 resolve 本条指令，保持原任务继续运行，然后单独 wait（不设定时器）。');
  assert.equal(store.read()!.control.state, 'waiting'); assert.equal(store.files.readJob(job.id).status, 'running');
  const answer = session.messages.slice(messageStart).filter(m => m.role === 'assistant');
  assert.match(JSON.stringify(answer), /42/); assert.ok(store.read()!.control.instructions.every(i => i.resolution));
  checks.push('native input resumes and answers while same job runs');
  writeFileSync(store.path('release'), 'finish');
  while (store.read()!.control.state !== 'completed') {
    abort.signal.throwIfAborted();
    if (!controller.active && store.read()!.control.state !== 'completed') throw Error(`Research paused: ${store.read()!.control.reason}`);
    await new Promise(r => setTimeout(r, 100));
  }
  await session.waitForIdle();
  assert.equal(store.files.readJob(job.id).status, 'succeeded');
  assert.equal(readFileSync(store.path('evidence.txt')).length, 42);
  assert.match(readFileSync(store.path('report.md'), 'utf8'), /42/);
  assert.deepEqual(store.read()!.modules.map(m => m.status), ['completed', 'completed']);
  assert.equal(store.read()!.audit.at(-1)?.reason, 'All modules accepted');
  assert.ok(store.files.events().filter(e => e.type === 'job').every(e => e.delivered));
  checks.push('completion event, ordered acceptance and final audit');
} catch (error) { failure = String(error); process.exitCode = 1; log({ event: 'failure', failure }); }
finally {
  clearTimeout(timeout); abort.signal.removeEventListener('abort', cancel);
  await session.abort(); await controller.pause('Session shutdown'); await runner.shutdown(); session.dispose();
  const result = { success: !failure, model: `${provider}/${modelId}`, root, requests, usage, checks, failure, trace, billingNote: 'Configured prices are not a provider billing receipt.' };
  writeFileSync(store.path('online-lifecycle-validation.json'), JSON.stringify(result, null, 2));
  log({ event: 'finished', success: !failure, requests, usage, checks, evidence: store.path('online-lifecycle-validation.json') });
}
