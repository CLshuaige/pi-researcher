import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { ChecklistStore } from '../extensions/researcher/checklist.ts';
import { applyChecklistAction } from '../extensions/researcher/checklist-tool.ts';
import { ResearchController } from '../extensions/researcher/controller.ts';
import { ResearchRunner } from '../extensions/researcher/runner.ts';
import { processIdentity } from '../extensions/researcher/store.ts';

const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
const node = (code: string) => `${quote(process.execPath)} -e ${quote(code)}`;
const until = async (predicate: () => boolean, limit = 6000) => {
  const end = Date.now() + limit;
  while (!predicate()) { if (Date.now() > end) throw new Error('Timed out waiting for test condition'); await new Promise(r => setTimeout(r, 15)); }
};
function fixture() {
  const root = mkdtempSync('/tmp/research-jobs-'), store = new ChecklistStore(root), runner = new ResearchRunner();
  store.files.initialize('Test managed work'); store.initialize('Test managed work');
  mkdirSync(store.path('.pi'), { recursive: true });
  writeFileSync(store.path('.pi/research.json'), JSON.stringify({ childExtensions: [], extraTools: [], reviewerTools: [] }));
  applyChecklistAction(store, { action: 'plan', expectedRevision: 1, reason: 'Plan', modules: [
    { id: 'M1', objective: 'Download', skills: ['research-task'], criteria: ['File exists'] },
    { id: 'M2', objective: 'Analyze', skills: ['research-report'], criteria: ['Verified'] },
  ] });
  applyChecklistAction(store, { action: 'start', expectedRevision: store.read()!.revision, reason: 'Start', moduleId: 'M1' });
  const hooks: Record<string, Function> = {}, tools: Record<string, any> = {}, sent: any[] = [], notices: string[] = [];
  const pi = { on(name: string, fn: Function) { hooks[name] = fn; }, registerTool(t: any) { tools[t.name] = t; }, sendMessage(message: any) { sent.push(message); } };
  const ctx = { cwd: root, model: { id: 'test' }, abort() {}, isIdle: () => true, hasPendingMessages: () => false,
    ui: { setWidget() {}, setStatus() {}, notify(text: string) { notices.push(text); } } };
  const controller = new ResearchController(pi as any, runner); controller.bind(); controller.activate(ctx as any);
  const job = (p: object) => tools.research_job.execute('', p, undefined);
  const settle = async () => { await hooks.agent_before_settle({ outcome: 'completed', entries: [] }); await hooks.agent_settled({ aborted: false }, ctx); };
  return { root, store, runner, controller, ctx, hooks, sent, notices, job, settle, async clean() { await controller.pause('Session shutdown'); rmSync(root, { recursive: true, force: true }); } };
}

test('jobs return immediately, deduplicate, scope environment, bound logs and gate acceptance', async () => {
  const h = fixture(); try {
    const command = node(`setTimeout(() => { require('fs').writeFileSync('evidence.json', JSON.stringify({tmp:process.env.TMPDIR,cache:process.env.XDG_CACHE_HOME,data:process.env.MNE_DATA})); console.log('x'.repeat(10000)); console.log('DONE'); }, 300)`);
    const result = await h.job({ action: 'start', moduleId: 'M1', command });
    assert.equal(result.isError, undefined); const id = result.details.id;
    assert.equal(result.details.status, 'running'); assert.equal(existsSync(h.store.path('evidence.json')), false);
    assert.equal((await h.job({ action: 'start', moduleId: 'M1', command })).details.id, id);
    assert.equal(h.store.files.jobs().length, 1);
    const mutate = (p: any) => applyChecklistAction(h.store, { expectedRevision: h.store.read()!.revision, reason: 'test', ...p });
    assert.throws(() => mutate({ action: 'update', moduleId: 'M1', status: 'skipped' }), /running tasks/);
    h.controller.instruction('Change goal');
    assert.throws(() => mutate({ action: 'resolve', instructionId: h.store.read()!.control.instructions[0].id, objective: 'New goal' }), /active tasks/);
    assert.throws(() => mutate({ action: 'plan', modules: h.store.read()!.modules }), /active tasks/);
    assert.equal((await h.job({ action: 'start', moduleId: 'M2', command: 'true' })).isError, true);
    assert.equal((await h.job({ action: 'start', moduleId: 'M1', command: 'true', cwd: '..' })).isError, true);
    await until(() => h.store.files.readJob(id).status === 'succeeded');
    const state = (await h.job({ action: 'status', jobId: id })).details;
    assert.equal(state.exitCode, 0); assert.ok(state.logTail.length <= 8192); assert.match(state.logTail, /DONE/);
    assert.deepEqual(JSON.parse(readFileSync(h.store.path('evidence.json'), 'utf8')), { tmp: h.store.path('.research/tmp'), cache: h.store.path('.research/cache'), data: h.store.path('mne_data') });
    mutate({ action: 'accept', moduleId: 'M1', evidence: ['evidence.json'], acceptance: ['Checked actual file'] });
    assert.equal(h.store.read()!.modules[0].status, 'completed');
  } finally { await h.clean(); }
});

test('job failure and process timeout retain real terminal state', async () => {
  const h = fixture(); try {
    const failed = await h.job({ action: 'start', moduleId: 'M1', command: 'echo failed >&2; exit 7' });
    await until(() => h.store.files.readJob(failed.details.id).status === 'failed');
    assert.equal(h.store.files.readJob(failed.details.id).exitCode, 7);
    const timeout = await h.job({ action: 'start', moduleId: 'M1', command: "trap '' TERM; sleep 20", timeoutSeconds: 1 });
    await until(() => h.store.files.readJob(timeout.details.id).status === 'timed_out');
    assert.equal(h.store.read()!.modules[0].status, 'running', 'A job exit never accepts the module');
  } finally { await h.clean(); }
});

test('pause cancels descendants, records cancellation, clears wakeups and does not restart on completion', async () => {
  const h = fixture(); try {
    const command = node(`const cp=require('child_process'); const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); require('fs').writeFileSync('descendant.pid',String(child.pid)); setInterval(()=>{},1000)`);
    const job = await h.job({ action: 'start', moduleId: 'M1', command });
    await until(() => existsSync(h.store.path('descendant.pid')));
    const pid = Number(readFileSync(h.store.path('descendant.pid'), 'utf8'));
    await h.job({ action: 'wait', wakeAfterSeconds: 1 }); await h.settle();
    assert.equal(h.store.read()!.control.state, 'waiting');
    await h.controller.pause('User stop', 'stopped');
    await until(() => processIdentity(pid) === undefined);
    assert.equal(h.store.files.readJob(job.details.id).status, 'cancelled');
    await new Promise(r => setTimeout(r, 1100));
    assert.equal(h.sent.length, 0); assert.equal(h.store.read()!.control.state, 'stopped');
  } finally { await h.clean(); }
});

test('waiting spends no continuations; input wakes immediately without cancelling work or resetting budget', async () => {
  const h = fixture(); try {
    const job = await h.job({ action: 'start', moduleId: 'M1', command: node('setTimeout(()=>{},5000)') });
    const before = h.store.read()!.control;
    await h.settle();
    assert.equal(h.store.read()!.control.state, 'waiting');
    assert.equal(h.store.read()!.control.continuations, before.continuations);
    await h.hooks.input({ source: 'interactive', text: 'How much data?' }, h.ctx);
    assert.equal(h.store.read()!.control.state, 'running');
    assert.equal(h.store.read()!.control.startedAt, before.startedAt);
    assert.equal(h.store.read()!.control.instructions.at(-1)?.text, 'How much data?');
    assert.equal(h.store.files.readJob(job.details.id).status, 'running');
  } finally { await h.clean(); }
});

test('terminal events wake once, while timed checks are one-shot and user/stop suppress stale wakes', async () => {
  const h = fixture(); try {
    const job = await h.job({ action: 'start', moduleId: 'M1', command: node('setTimeout(()=>{},250)') });
    await h.job({ action: 'wait', wakeAfterSeconds: 1 }); await h.settle();
    await until(() => h.sent.length === 1);
    assert.match(h.sent[0].content, /succeeded/); assert.equal(h.sent[0].display, false);
    assert.equal(h.store.read()!.control.continuations, 1);
    await new Promise(r => setTimeout(r, 1100)); assert.equal(h.sent.length, 1);
    assert.equal(h.store.files.readJob(job.details.id).status, 'succeeded');
    // Emulate the next request consuming the event, then schedule one explicit check.
    h.hooks.context({ messages: [] }, h.ctx);
    await h.job({ action: 'wait', wakeAfterSeconds: 1 }); await h.settle();
    await until(() => h.sent.length === 2); assert.match(h.sent[1].content, /Scheduled research check/);
    h.hooks.context({ messages: [] }, h.ctx);
    await h.job({ action: 'wait', wakeAfterSeconds: 1 }); await h.settle();
    await h.hooks.input({ source: 'interactive', text: 'Change direction' }, h.ctx);
    await new Promise(r => setTimeout(r, 1100)); assert.equal(h.sent.length, 2);
    assert.equal(h.store.read()!.control.startedAt > 0, true);
  } finally { await h.clean(); }
});

test('a lost owner cancels its process group and leaves a readable terminal record', async () => {
  const root = mkdtempSync('/tmp/research-job-orphan-');
  const worker = fork(new URL('../extensions/researcher/process-worker.mjs', import.meta.url), [], { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  try {
    worker.send({ command: node("require('fs').writeFileSync('pid',String(process.pid));setInterval(()=>{},1000)"), cwd: root, env: {}, logPath: join(root, 'log'), exitPath: join(root, 'exit.json'), timeoutSeconds: 20 });
    await until(() => existsSync(join(root, 'pid')));
    const pid = Number(readFileSync(join(root, 'pid'), 'utf8'));
    worker.disconnect();
    await until(() => existsSync(join(root, 'exit.json')) && processIdentity(pid) === undefined);
    assert.equal(JSON.parse(readFileSync(join(root, 'exit.json'), 'utf8')).status, 'cancelled');
  } finally { worker.kill('SIGTERM'); rmSync(root, { recursive: true, force: true }); }
});

test('real Pi SDK: timed wake, user question during a job, terminal wake and final audit', async () => {
  const { createAgentSession, DefaultResourceLoader, SettingsManager, SessionManager } = await import('@earendil-works/pi-coding-agent');
  const { createAssistantMessageEventStream } = await import('@earendil-works/pi-ai');
  const { zeroUsage } = await import('../extensions/researcher/usage.ts');
  const root = mkdtempSync('/tmp/research-jobs-sdk-'), store = new ChecklistStore(root), runner = new ResearchRunner();
  store.files.initialize('Responsive research'); store.initialize('Responsive research');
  mkdirSync(store.path('.pi'), { recursive: true });
  writeFileSync(store.path('.pi/research.json'), JSON.stringify({ childExtensions: [], extraTools: [], reviewerTools: [] }));
  applyChecklistAction(store, { action: 'plan', expectedRevision: 1, reason: 'Plan', modules: [{ id: 'M1', objective: 'Download', skills: ['research-task'], criteria: ['Evidence exists'] }] });
  applyChecklistAction(store, { action: 'start', expectedRevision: store.read()!.revision, reason: 'Start', moduleId: 'M1' });
  let controller: ResearchController | undefined, requests = 0, scheduled = false;
  const model: import('@earendil-works/pi-ai').Model<'openai-completions'> = { id: 'local', name: 'local', provider: 'background-test', api: 'openai-completions', baseUrl: 'http://offline.invalid', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024 };
  const settings = SettingsManager.inMemory({ packages: [], extensions: [], skills: [], retry: { enabled: false }, compaction: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: store.path('.research/test-agent'), settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [pi => {
      controller = new ResearchController(pi, runner); controller.bind();
      pi.on('session_start', (_event, ctx) => controller!.activate(ctx));
      pi.registerProvider(model.provider, { api: model.api, baseUrl: model.baseUrl, apiKey: 'offline', models: [model], streamSimple: (_model, context) => {
        assert.ok(++requests <= 14, 'No busy-loop model polling');
        const c = store.read()!, pending = c.control.instructions.find(i => !i.resolution), job = store.files.jobs()[0];
        let name = 'research_checklist', args: import('@earendil-works/pi-ai').ToolCall['arguments'] | undefined;
        const common = { expectedRevision: c.revision, reason: 'SDK background test' };
        if (pending) args = { ...common, action: 'resolve', instructionId: pending.id };
        else if (!scheduled) { scheduled = true; name = 'research_job'; args = { action: 'wait', wakeAfterSeconds: 1 }; }
        else if (!job && JSON.stringify(context).includes('Scheduled research check')) {
          name = 'research_job'; args = { action: 'start', moduleId: 'M1', timeoutSeconds: 10, command: node("const fs=require('fs');const t=setInterval(()=>{if(fs.existsSync('release')){fs.writeFileSync('evidence.txt','observed');clearInterval(t)}},20)") };
        } else if (job?.status === 'succeeded' && c.modules[0].status !== 'completed') {
          args = { ...common, action: 'accept', moduleId: 'M1', evidence: ['evidence.txt'], acceptance: ['Verified actual output'] };
        }
        const stream = createAssistantMessageEventStream();
        const message: import('@earendil-works/pi-ai').AssistantMessage = { role: 'assistant', content: args ? [{ type: 'toolCall', id: `call-${requests}`, name, arguments: args }] : [{ type: 'text', text: job?.status === 'running' ? 'Expected data: 42 bytes. Download still running.' : 'Waiting or completed.' }], api: model.api, provider: model.provider, model: model.id, usage: zeroUsage(), stopReason: args ? 'toolUse' : 'stop', timestamp: Date.now() };
        queueMicrotask(() => { stream.push({ type: 'done', reason: args ? 'toolUse' : 'stop', message }); stream.end(message); });
        return stream;
      } });
    }],
  });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: root, model, thinkingLevel: 'off', resourceLoader: loader, settingsManager: settings, sessionManager: SessionManager.create(root, store.path('.research/sdk-sessions')), tools: ['research_checklist', 'research_job'] });
  try {
    await session.bindExtensions({ mode: 'print' });
    await session.prompt('Start after one timed check');
    assert.equal(store.read()!.control.state, 'waiting');
    assert.equal(store.read()!.control.continuations, 0);
    await until(() => store.files.jobs().length === 1 && store.read()!.control.state === 'waiting');
    const before = store.read()!.control;
    assert.equal(before.continuations, 1);
    await session.prompt('How much data?');
    assert.match(session.getLastAssistantText()!, /42 bytes/);
    assert.equal(store.files.jobs()[0].status, 'running');
    assert.equal(store.read()!.control.startedAt, before.startedAt);
    assert.equal(store.read()!.control.continuations, 1);
    assert.equal(store.read()!.control.state, 'waiting');
    writeFileSync(store.path('release'), 'complete now');
    await until(() => store.read()!.control.state === 'completed');
    assert.equal(store.read()!.control.continuations, 2);
    assert.equal(store.read()!.audit.at(-1)?.reason, 'All modules accepted');
    assert.equal(store.files.jobs()[0].exitCode, 0);
    assert.equal(controller!.active, false);
    assert.equal(existsSync(store.path('.research/controller.lock')), false);
  } finally { await controller?.pause('Session shutdown'); session.dispose(); rmSync(root, { recursive: true, force: true }); }
});

test('scheduled wake honors the overall wall-clock deadline', async t => {
  const h = fixture(); const now = Date.now();
  try {
    await h.job({ action: 'wait', wakeAfterSeconds: 1 }); await h.settle();
    t.mock.method(Date, 'now', () => now + 31 * 60000);
    await new Promise(r => setTimeout(r, 1200));
    assert.equal(h.sent.length, 0); assert.equal(h.controller.active, false);
    assert.match(h.store.read()!.control.reason, /budget/);
  } finally { t.mock.restoreAll(); await h.clean(); }
});

test('stale worker identities are interrupted and cannot be used to kill a recycled PID', async () => {
  const h = fixture(); try {
    const started = await h.job({ action: 'start', moduleId: 'M1', command: 'true' });
    await until(() => h.store.files.readJob(started.details.id).status === 'succeeded');
    await h.runner.shutdown();
    const job = h.store.files.readJob(started.details.id);
    rmSync(join(h.store.files.jobPath(job.id), 'exit.json'));
    h.store.files.saveJob({ ...job, status: 'running', workerPid: process.pid, workerIdentity: 'not-this-process' });
    assert.equal(h.store.files.readJob(job.id).status, 'interrupted');
    assert.equal((await h.runner.cancelJob(job.id, h.root)).status, 'interrupted');
    assert.ok(processIdentity(process.pid));
  } finally { await h.clean(); }
});
