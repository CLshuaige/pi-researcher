import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChecklistStore } from '../extensions/researcher/checklist.ts';
import { ResearchController } from '../extensions/researcher/controller.ts';
import { ResearchRunner } from '../extensions/researcher/runner.ts';
import { acquireOwnerLock } from '../extensions/researcher/store.ts';
import { runSdk } from '../extensions/researcher/sdk.ts';
import { createAssistantMessageEventStream, type AssistantMessage, type Model, type ToolCall } from '@earendil-works/pi-ai';
import researcherExtension from '../extensions/researcher/index.ts';
import { moduleResources } from '../extensions/researcher/modules.ts';
import { zeroUsage } from '../extensions/researcher/usage.ts';

const module = () => ({ id: 'm1', objective: 'Verify', dependencies: [], skills: [], criteria: ['Evidence exists'], status: 'pending' as const, evidence: [], acceptance: [], reason: '', taskIds: [] });
function fixture() { const root = mkdtempSync(join(tmpdir(), 'research-loop-')); return { root, store: new ChecklistStore(root), clean: () => rmSync(root, { recursive: true, force: true }) }; }
test('revisions, conflicts, cycles, external edits and recovery', () => {
  const f = fixture(); try {
    const c = f.store.initialize('Goal'); assert.equal(c.revision, 1);
    f.store.change('Plan', c => c.modules.push(module()), 1);
    assert.throws(() => f.store.change('Conflict', () => {}, 1), /conflict/);
    assert.throws(() => f.store.change('Cycle', c => c.modules[0].dependencies = ['m1']), /cycle/);
    writeFileSync(join(f.root, 'checklist.json'), '{}');
    assert.throws(() => f.store.read(), /outside protocol/);
    assert.equal(f.store.repair().modules[0].id, 'm1');
    rmSync(join(f.root, 'checklist.json'));
    assert.throws(() => f.store.read(), /deleted/); f.store.repair();
  } finally { f.clean(); }
});
test('completion requires current goal, evidence and resolved instructions', () => {
  const f = fixture(); try {
    const c = f.store.initialize('Goal'); c.modules.push({ ...module(), status: 'completed', evidence: ['result.txt'], acceptance: ['Verified'], acceptedRevision: 1 });
    assert.equal(f.store.complete(c), false);
    writeFileSync(join(f.root, 'result.txt'), 'observed'); assert.equal(f.store.complete(c), true);
    c.objectiveRevision++; assert.equal(f.store.complete(c), false);
    c.modules[0].acceptedRevision = 2;
    c.control.instructions.push({ id: 'i', text: 'new requirement' }); assert.equal(f.store.complete(c), false);
  } finally { f.clean(); }
});
test('controller gates context, continues unfinished work, stops on abort and bounds stagnation', async () => {
  const f = fixture(); const hooks: Record<string, Function> = {}; const tools: Record<string, any> = {};
  const pi = { on: (name: string, fn: Function) => { hooks[name] = fn; }, registerTool: (t: any) => { tools[t.name] = t; } };
  const ctx = { cwd: f.root, abort: async () => {}, ui: { setStatus() {}, setWidget() {} } };
  const controller = new ResearchController(pi as any, new ResearchRunner()); controller.bind();
  try {
    assert.equal(hooks.context({ messages: [] }), undefined);
    controller.activate(ctx as any); controller.instruction('Research question');
    assert.equal(JSON.parse(hooks.context({ messages: [] }).messages[0].content).nextAction, 'init');
    await tools.research_checklist.execute('', { action: 'init', objective: 'Goal' });
    const c = f.store.read()!;
    await tools.research_checklist.execute('', { action: 'plan', expectedRevision: c.revision, reason: 'Plan', modules: [module()] });
    assert.equal(hooks.tool_call({ toolName: 'write', input: { path: '../escape' } }).block, true);
    assert.equal(hooks.tool_call({ toolName: 'write', input: { path: 'checklist.json' } }).block, true);
    const event = { outcome: 'completed', entries: [] };
    assert.equal((await hooks.agent_before_settle(event)).continue, true);
    await hooks.agent_settled({ aborted: true }, ctx); assert.equal(controller.active, false);
    controller.activate(ctx as any);
    for (let i = 0; i < 4; i++) await hooks.agent_before_settle(event);
    assert.equal(controller.active, false);
    controller.activate(ctx as any); await hooks.agent_before_settle({ outcome: 'error', entries: [] }); assert.equal(controller.active, false);
  } finally { await controller.pause('Test finished'); f.clean(); }
});
test('project lock rejects competing controllers', () => {
  const f = fixture(); const release = acquireOwnerLock(join(f.root, 'owner.lock'));
  try { assert.throws(() => acquireOwnerLock(join(f.root, 'owner.lock')), /locked/); } finally { release(); f.clean(); }
});
test('real Pi SDK invokes request checkpoint and settlement continuation with deterministic provider', async () => {
  const f = fixture(); let requests = 0; let checks = 0; let settled = 0;
  const model = { id: 'local', name: 'local', provider: 'test', api: 'openai-completions', baseUrl: 'http://localhost', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024 } as Model<'openai-completions'>;
  const host = { model, thinkingLevel: 'off', modelRegistry: { streamSimple: (_model: unknown, context: unknown) => {
    assert.match(JSON.stringify(context), /name: research-task/, 'Child SDK must receive complete Skill instructions');
    requests++; const stream = createAssistantMessageEventStream();
    const message: AssistantMessage = { role: 'assistant', content: [{ type: 'text', text: 'done' }], api: model.api, provider: model.provider, model: model.id, usage: zeroUsage(), stopReason: 'stop', timestamp: Date.now() };
    queueMicrotask(() => { stream.push({ type: 'done', reason: 'stop', message }); stream.end(message); }); return stream;
  } } };
  try {
    await runSdk({ cwd: f.root, host: host as any, prompt: 'test', sessionDir: join(f.root, 'sessions'), signal: new AbortController().signal, maxTurns: 3, skills: moduleResources(['research-task']).skills, tools: ['research_checklist', 'research_delegate', 'research_job'], onCreated: session => {
      assert.deepEqual(session.getAllTools().map(t => t.name).filter(name => name.startsWith('research_')).sort(), ['research_checklist', 'research_delegate', 'research_job']);
    }, factories: [researcherExtension, pi => {
      pi.on('context', () => { checks++; });
      pi.on('agent_before_settle', event => { if (++settled === 1) return { entries: [...event.entries, { type: 'custom_message', customType: 'test', content: 'Continue', display: false }], continue: true }; });
    }] });
    assert.equal(requests, 2); assert.equal(checks, 2); assert.equal(settled, 2);
  } finally { f.clean(); }
});
test('real SDK controller stops a model that repeatedly exits without progress', async () => {
  const f = fixture(); let controller: ResearchController | undefined; let requests = 0;
  const model = { id: 'local', name: 'local', provider: 'test', api: 'openai-completions', baseUrl: 'http://localhost', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024 } as Model<'openai-completions'>;
  const host = { model, thinkingLevel: 'off', modelRegistry: { streamSimple: (_m: unknown, context: any) => {
    requests++; assert.match(JSON.stringify(context), /checklist|revision/i);
    const stream = createAssistantMessageEventStream();
    const message: AssistantMessage = { role: 'assistant', content: [{ type: 'text', text: 'I am done' }], api: model.api, provider: model.provider, model: model.id, usage: zeroUsage(), stopReason: 'stop', timestamp: Date.now() };
    queueMicrotask(() => { stream.push({ type: 'done', reason: 'stop', message }); stream.end(message); }); return stream;
  } } };
  try {
    f.store.initialize('Goal'); f.store.change('Plan', c => c.modules.push(module()));
    await runSdk({ cwd: f.root, host: host as any, prompt: 'test', sessionDir: join(f.root, 'sessions'), signal: new AbortController().signal, maxTurns: 8, tools: [], factories: [pi => {
      controller = new ResearchController(pi, new ResearchRunner()); controller.bind();
      pi.on('session_start', (_e, ctx) => controller!.activate(ctx));
    }] });
    assert.equal(requests, 4); assert.equal(controller!.active, false);
    assert.equal(f.store.read()!.control.state, 'paused'); assert.match(f.store.read()!.control.reason, /progress/);
  } finally { await controller?.pause('cleanup'); f.clean(); }
});
test('real SDK ordinary input resumes, injects skills, executes in order and audits completion', async () => {
  const f = fixture(); let controller: ResearchController | undefined; let requests = 0;
  const model = { id: 'local', name: 'local', provider: 'test', api: 'openai-completions', baseUrl: 'http://localhost', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024 } as Model<'openai-completions'>;
  const host = { model, thinkingLevel: 'off', modelRegistry: { streamSimple: (_m: unknown, context: any) => {
    requests++;
    const c = f.store.read(); let name = 'research_checklist'; let args: ToolCall['arguments'] | undefined;
    const common = { expectedRevision: c?.revision ?? 1, reason: 'Deterministic SDK test' };
    if (!c) args = { action: 'init', objective: 'Ordered research' };
    else if (c.control.instructions.some(i => !i.resolution)) args = { ...common, action: 'resolve', instructionId: c.control.instructions.find(i => !i.resolution)!.id };
    else if (!c.modules.length) args = { ...common, action: 'plan', modules: [
      { id: 'M1', objective: 'Inspect', skills: ['research-task'], criteria: ['Evidence saved'] },
      { id: 'M2', objective: 'Report', skills: ['research-report'], criteria: ['Report verified'], dependencies: ['M1'] },
    ] };
    else {
      const current = c.modules.find(m => m.status !== 'completed');
      if (current) {
        assert.ok(JSON.stringify(context).includes('name: ' + current.skills[0]), 'Current skill must be in actual provider context');
        if (current.status === 'pending') args = { ...common, action: 'start', moduleId: current.id };
        else if (!current.evidence.length) { name = 'write'; args = { path: current.id + '.txt', content: 'Observed evidence' };
          // The next request observes the saved file; do not mutate checklist outside the tool.
          if (requests > 1 && context.messages.some((m: any) => m.role === 'toolResult' && m.toolName === 'write' && !m.isError && m.content.some((t: any) => t.text?.includes(current.id + '.txt')))) {
            name = 'research_checklist'; args = { ...common, action: 'accept', moduleId: current.id, evidence: [current.id + '.txt'], acceptance: ['Verified saved evidence'] };
          }
        }
      }
    }
    const stream = createAssistantMessageEventStream();
    const message: AssistantMessage = { role: 'assistant', content: args ? [{ type: 'toolCall', id: 'call-' + requests, name, arguments: args }] : [{ type: 'text', text: 'All accepted' }], api: model.api, provider: model.provider, model: model.id, usage: zeroUsage(), stopReason: args ? 'toolUse' : 'stop', timestamp: Date.now() };
    queueMicrotask(() => { stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message }); stream.end(message); }); return stream;
  } } };
  try {
    await runSdk({ cwd: f.root, host: host as any, prompt: 'Execute research', sessionDir: join(f.root, 'sessions'), signal: new AbortController().signal, maxTurns: 16, tools: ['research_checklist', 'write'], factories: [pi => {
      controller = new ResearchController(pi, new ResearchRunner()); controller.bind();
      pi.on('session_start', async (_e, ctx) => { controller!.activate(ctx); controller!.store!.initialize('Ordered research'); await controller!.pause('User pause'); });
    }] });
    assert.equal(f.store.read()!.control.state, 'completed');
    assert.deepEqual(f.store.read()!.modules.map(m => m.status), ['completed', 'completed']);
    assert.equal(controller!.active, false);
    const completed = f.store.read()!;
    assert.equal(completed.control.instructions[0].text, 'Execute research');
    assert.ok(completed.control.instructions[0].resolution);
    assert.equal(completed.audit.at(-1)!.reason, 'All modules accepted');
    const pauseIndex = completed.audit.findIndex(a => a.reason === 'User pause');
    assert.ok(pauseIndex >= 0);
    assert.equal(completed.audit[pauseIndex + 1].reason, 'Explicit start/resume');
  } finally { await controller?.pause('cleanup'); f.clean(); }
});
