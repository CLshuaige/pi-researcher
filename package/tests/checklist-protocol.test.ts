import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChecklistStore, checklistState, currentModule } from '../extensions/researcher/checklist.ts';
import { applyChecklistAction } from '../extensions/researcher/checklist-tool.ts';
import { ResearchController } from '../extensions/researcher/controller.ts';
import { ResearchRunner } from '../extensions/researcher/runner.ts';
import { acquireOwnerLock } from '../extensions/researcher/store.ts';
import researcherExtension from '../extensions/researcher/index.ts';

const definition = (id: string) => ({ id, objective: id, skills: ['research-task' as const], criteria: ['Recorded evidence'] });
function harness(readSkill?: (path: string) => string) {
  const root = mkdtempSync(join(tmpdir(), 'research-protocol-'));
  const store = new ChecklistStore(root);
  const hooks: Record<string, Function> = {}, tools: Record<string, any> = {};
  const pi = { on(name: string, fn: Function) { hooks[name] = fn; }, registerTool(t: any) { tools[t.name] = t; } };
  const widgets: { key: string; content?: string[] }[] = [], notices: string[] = [];
  const ctx = { cwd: root, model: { id: 'fake' }, abort: async () => {}, ui: { setStatus() {}, setWidget(key: string, content?: string[]) { widgets.push({ key, content }); }, notify(text: string) { notices.push(text); } } };
  const controller = new ResearchController(pi as any, new ResearchRunner(), readSkill); controller.bind(); controller.activate(ctx as any);
  const call = (p: object) => tools.research_checklist.execute('', { expectedRevision: store.read()?.revision, reason: 'test', ...p });
  return { root, store, hooks, tools, controller, ctx, call, widgets, notices, async cleanup() { await controller.pause('cleanup'); rmSync(root, { recursive: true, force: true }); } };
}

test('minimal plan and partial updates preserve fields; accept infers completed', async () => {
  const h = harness(); try {
    assert.equal((await h.call({ action: 'init', objective: 'Goal' })).isError, undefined);
    assert.equal((await h.call({ action: 'plan', modules: [definition('M1'), definition('M2')] })).isError, undefined);
    const c = h.store.read()!; assert.equal(c.modules[0].status, 'pending'); assert.deepEqual(c.modules[0].dependencies, []);
    await h.call({ action: 'start', moduleId: 'M1' });
    writeFileSync(join(h.root, 'evidence.txt'), 'actual evidence');
    await h.call({ action: 'update', moduleId: 'M1', status: 'awaiting_acceptance', evidence: ['evidence.txt'] });
    const result = await h.call({ action: 'accept', moduleId: 'M1', acceptance: ['Checked file'] });
    assert.equal(result.isError, undefined);
    assert.equal(h.store.read()!.modules[0].objective, 'M1');
    assert.equal(h.store.read()!.modules[0].status, 'completed');
    assert.equal(currentModule(h.store.read()!)!.id, 'M2');
    // A no-op plan must not erase completed progress.
    await h.call({ action: 'plan', modules: [definition('M1'), definition('M2')] });
    assert.equal(h.store.read()!.modules[0].status, 'completed');
  } finally { await h.cleanup(); }
});

test('out-of-order start/accept and criteria substitution are rejected without revision changes', async () => {
  const h = harness(); try {
    await h.call({ action: 'init', objective: 'Goal' }); await h.call({ action: 'plan', modules: [definition('M1'), definition('M2')] });
    const rev = h.store.read()!.revision;
    for (const action of ['start', 'accept']) {
      const result = await h.call({ action, moduleId: 'M2' }); assert.equal(result.isError, true); assert.match(result.details.error, /order/);
    }
    assert.equal(h.store.read()!.revision, rev);
    assert.equal(h.hooks.tool_call({ toolName: 'bash', input: { command: 'echo premature' } }).block, true);
    await h.call({ action: 'start', moduleId: 'M1' });
    const bad = await h.call({ action: 'accept', moduleId: 'M1', module: { criteria: ['Changed to easier criterion'] } });
    assert.equal(bad.isError, true); assert.match(bad.details.error, /Invalid arguments/);
    const c = h.store.read()!;
    assert.throws(() => applyChecklistAction(h.store, { action: 'plan', expectedRevision: c.revision, reason: 'invalid order', modules: [{ ...definition('M1'), dependencies: ['M2'] }, definition('M2')] }), /precede/);
  } finally { await h.cleanup(); }
});

test('tool errors return exact recovery revision and help; status updates cannot bypass acceptance', async () => {
  const h = harness(); try {
    await h.call({ action: 'init', objective: 'Goal' }); await h.call({ action: 'plan', modules: [definition('M1')] });
    const result = await h.call({ action: 'start', moduleId: 'M1', expectedRevision: 1 });
    assert.equal(result.isError, true); assert.equal(result.details.recovery.nextAction, 'read');
    assert.equal(result.details.recovery.currentRevision, h.store.read()!.revision);
    assert.match((await h.call({ action: 'help' })).content[0].text, /moduleId/);
    await h.call({ action: 'start', moduleId: 'M1' });
    assert.equal((await h.call({ action: 'update', moduleId: 'M1', status: 'completed' })).isError, true);
  } finally { await h.cleanup(); }
});

test('current module skills are loaded and advance only after acceptance or explicit skip', async () => {
  const h = harness(); try {
    await h.call({ action: 'init', objective: 'Goal' });
    await h.call({ action: 'plan', modules: [definition('M1'), { ...definition('M2'), skills: ['research-report'] }] });
    const first = JSON.parse(h.controller.checkpoint());
    assert.equal(first.currentModule.id, 'M1'); assert.equal(first.skillInstructions.length, 1);
    assert.match(first.skillInstructions[0].instructions, /name: research-task/);
    assert.equal(first.skillInstructions.some((s: any) => s.instructions.includes('name: research-report')), false);
    await h.call({ action: 'update', moduleId: 'M1', status: 'skipped', reason: 'User does not need this module' });
    assert.match(JSON.parse(h.controller.checkpoint()).skillInstructions[0].instructions, /name: research-report/);
  } finally { await h.cleanup(); }
});

test('interruption waits for cleanup then ordinary user input resumes; extension input and stop do not', async () => {
  const h = harness(); try {
    await h.call({ action: 'init', objective: 'Goal' }); await h.call({ action: 'plan', modules: [definition('M1')] });
    const settling = h.hooks.agent_settled({ aborted: true }, h.ctx);
    await h.hooks.input({ source: 'interactive', text: 'Continue with new constraints' }, h.ctx); await settling;
    assert.equal(h.controller.active, true); assert.equal(h.store.read()!.control.state, 'running');
    assert.equal(h.store.read()!.control.instructions.at(-1)!.text, 'Continue with new constraints');
    assert.equal(h.store.read()!.modules[0].id, 'M1');
    await h.controller.pause('Interrupted');
    await h.hooks.input({ source: 'extension', text: 'automatic followup' }, h.ctx); assert.equal(h.controller.active, false);
    await h.controller.pause('Explicit stop', 'stopped');
    await h.hooks.input({ source: 'interactive', text: 'ordinary unrelated chat' }, h.ctx); assert.equal(h.controller.active, false);
    h.controller.activate(h.ctx as any); await h.controller.pause('Session shutdown');
    await h.hooks.input({ source: 'rpc', text: 'next session' }, h.ctx); assert.equal(h.controller.active, false);
  } finally { await h.cleanup(); }
});

test('delegate rejects wrong module and mismatched skills before starting a child', async () => {
  const root = mkdtempSync(join(tmpdir(), 'research-delegate-'));
  const hooks: Record<string, Function> = {}, tools: Record<string, any> = {}, commands: Record<string, any> = {};
  const pi = { on(name: string, fn: Function) { hooks[name] = fn; }, registerTool(t: any) { tools[t.name] = t; }, registerCommand(name: string, c: any) { commands[name] = c; }, sendUserMessage() {} };
  const ctx = { cwd: root, model: { id: 'fake' }, ui: { notify() {}, setStatus() {}, setWidget() {} } };
  researcherExtension(pi as any);
  assert.deepEqual(Object.keys(tools).sort(), ['research_checklist', 'research_delegate', 'research_job']);
  assert.equal(commands.research, commands.researcher);
  try {
    await commands.researcher.handler('Goal', ctx);
    const store = new ChecklistStore(root); store.initialize('Goal');
    applyChecklistAction(store, { action: 'plan', expectedRevision: 1, reason: 'Plan', modules: [definition('M1'), definition('M2')] });
    const params = { objective: 'task', moduleId: 'M2', skills: ['research-task'], inputs: [], doneWhen: ['done'] };
    await assert.rejects(() => tools.research_delegate.execute('', params, undefined, undefined, ctx), /order/);
    applyChecklistAction(store, { action: 'start', expectedRevision: store.read()!.revision, reason: 'Begin', moduleId: 'M1' });
    await assert.rejects(() => tools.research_delegate.execute('', { ...params, moduleId: 'M1', skills: ['research-review'] }, undefined, undefined, ctx), /module skills/);
    assert.equal(store.files.list().length, 0);
  } finally { await hooks.session_shutdown(); rmSync(root, { recursive: true, force: true }); }
});

test('checkpoint and tools share projection without Skill bodies, paths or audit in tool results', async () => {
  const h = harness(); try {
    for (const action of [
      { action: 'read' }, { action: 'init', objective: 'Goal' },
      { action: 'plan', modules: [definition('M1')] }, { action: 'start', moduleId: 'M1' },
      { action: 'update', moduleId: 'M1', status: 'blocked' },
    ]) {
      const result = await h.call(action);
      assert.equal(result.isError, undefined);
      const checkpoint = JSON.parse(h.controller.checkpoint());
      const { root, skillInstructions, ...state } = checkpoint;
      assert.deepEqual(state, result.details);
      assert.deepEqual(state, checklistState(h.store.read()));
      assert.doesNotMatch(JSON.stringify(result), /skillInstructions|SKILL.md|audit/);
    }
    h.controller.instruction('Adjust goal');
    const result = await h.call({ action: 'read' });
    assert.equal(result.details.pendingInstructions[0].text, 'Adjust goal');
    await h.call({ action: 'resolve', instructionId: result.details.pendingInstructions[0].id });
    assert.deepEqual((await h.call({ action: 'read' })).details.pendingInstructions, []);
    assert.ok(h.store.read()!.audit.length > 0);
  } finally { await h.cleanup(); }
});

test('widget contains only successfully loaded names, updates on changes and clears at lifecycle boundaries', async () => {
  const h = harness(); try {
    h.controller.checkpoint(h.ctx as any); assert.equal(h.widgets.length, 0);
    await h.call({ action: 'init', objective: 'Goal' });
    await h.call({ action: 'plan', modules: [definition('M1'), { ...definition('M2'), skills: ['research-report'] }] });
    const context = h.hooks.context({ messages: [] }, h.ctx);
    assert.equal(context.messages[0].display, false);
    assert.deepEqual(h.widgets, [{ key: 'research-skills', content: ['Skills: research-task'] }]);
    h.hooks.context(context, h.ctx); h.controller.checkpoint(); assert.equal(h.widgets.length, 1);
    await h.call({ action: 'update', moduleId: 'M1', status: 'skipped' });
    h.controller.checkpoint(); assert.deepEqual(h.widgets.at(-1)?.content, ['Skills: research-report']);
    await h.controller.pause('User pause'); assert.equal(h.widgets.at(-1)?.content, undefined);
    await h.controller.receive('Continue', h.ctx as any); h.controller.checkpoint();
    assert.deepEqual(h.widgets.at(-1)?.content, ['Skills: research-report']);
    await h.call({ action: 'resolve', instructionId: h.store.read()!.control.instructions[0].id });
    await h.call({ action: 'update', moduleId: 'M2', status: 'skipped' });
    await h.hooks.agent_before_settle({ outcome: 'completed', entries: [] });
    assert.equal(h.store.read()!.control.state, 'completed'); assert.equal(h.widgets.at(-1)?.content, undefined);
    assert.equal(await h.controller.receive('Unrelated chat', h.ctx as any), 'ignored');
    h.controller.activate(h.ctx as any);
    await h.call({ action: 'plan', modules: [{ ...definition('M1'), objective: 'Reopen' }, definition('M2')] });
    h.controller.checkpoint(); await h.hooks.session_shutdown();
    assert.equal(h.widgets.at(-1)?.content, undefined);
    assert.doesNotMatch(JSON.stringify(h.widgets), /SKILL.md|\/|instructions|revision/);
  } finally { await h.cleanup(); }
});

test('Skill read failures are separate from checklist corruption and show only successfully loaded names', async () => {
  const h = harness(path => {
    if (path.includes('research-report')) throw Object.assign(new Error('secret/path/SKILL.md'), { code: 'ENOENT' });
    return readFileSync(path, 'utf8');
  }); try {
    await h.call({ action: 'init', objective: 'Goal' });
    await h.call({ action: 'plan', modules: [{ ...definition('M1'), skills: ['research-task', 'research-report'] }] });
    const raw = h.controller.checkpoint(h.ctx as any), state = JSON.parse(raw);
    assert.equal(state.skillErrors[0].name, 'research-report'); assert.match(state.skillErrors[0].error, /SKILL LOAD FAILED/);
    assert.doesNotMatch(raw, /CONTROL REPAIR REQUIRED|secret\/path/);
    assert.deepEqual(h.widgets.at(-1)?.content, ['Skills: research-task']);
    assert.deepEqual(h.notices, ['Cannot load Skill research-report (ENOENT)']);
    assert.equal((await h.call({ action: 'read' })).isError, undefined);
    await h.call({ action: 'plan', modules: [{ ...definition('M1'), skills: ['research-report'] }] });
    h.controller.checkpoint(h.ctx as any); assert.equal(h.widgets.at(-1)?.content, undefined);
    writeFileSync(h.store.path('checklist.json'), '{}');
    assert.match(h.controller.checkpoint(), /CONTROL REPAIR REQUIRED/);
  } finally { await h.cleanup(); }
});

test('legacy module and module.id fallback are rejected without mutation', async () => {
  const h = harness(); try {
    await h.call({ action: 'init', objective: 'Goal' }); await h.call({ action: 'plan', modules: [definition('M1')] });
    const revision = h.store.read()!.revision;
    for (const p of [{ action: 'start', module: { id: 'M1' } }, { action: 'update', moduleId: 'M1', module: { status: 'running' } }]) {
      assert.equal((await h.call(p)).isError, true);
      assert.equal(h.store.read()!.revision, revision);
    }
  } finally { await h.cleanup(); }
});

test('running instructions keep budget; ordinary resumed input starts a fresh budget', async () => {
  const h = harness(); try {
    await h.call({ action: 'init', objective: 'Goal' }); await h.call({ action: 'plan', modules: [definition('M1')] });
    for (let i = 0; i < 20; i++) {
      h.store.change('Progress', c => c.modules[0].evidence.push(`https://example.com/${i}`));
      const before = h.store.read()!.control;
      await h.controller.receive(`Requirement ${i}`, h.ctx as any, i % 2 === 0);
      assert.equal(h.store.read()!.control.startedAt, before.startedAt);
      assert.equal(h.store.read()!.control.continuations, i);
      assert.equal((await h.hooks.agent_before_settle({ outcome: 'completed', entries: [] })).continue, true);
    }
    await h.hooks.agent_before_settle({ outcome: 'completed', entries: [] });
    assert.equal(h.controller.active, false); assert.equal(h.store.read()!.control.continuations, 20);
    await h.hooks.input({ source: 'interactive', text: 'Continue after budget pause' }, h.ctx);
    assert.equal(h.controller.active, true); assert.equal(h.store.read()!.control.continuations, 0);
  } finally { await h.cleanup(); }
});

test('resume failure retains instruction durably and blocks native submission until explicit recovery', async () => {
  const h = harness(); let release: (() => void) | undefined;
  try {
    await h.call({ action: 'init', objective: 'Goal' }); await h.controller.pause('User pause');
    release = acquireOwnerLock(h.store.path('.research/controller.lock'));
    const outcome = await h.hooks.input({ source: 'interactive', text: 'Do not lose this instruction' }, h.ctx);
    assert.deepEqual(outcome, { action: 'handled' }); assert.equal(h.controller.active, false);
    assert.deepEqual(JSON.parse(readFileSync(h.store.path('.research/inbox.json'), 'utf8')), ['Do not lose this instruction']);
    assert.match(h.notices.at(-1)!, /Cannot resume research; input retained.*locked/);
    assert.equal(h.controller.state().pendingInstructions[0].text, 'Do not lose this instruction');
    assert.equal(h.store.read()!.control.instructions.length, 0, 'status must not mutate another owner’s checklist');
    release(); release = undefined;
    assert.equal(await h.controller.receive('', h.ctx as any, true), 'accepted');
    h.controller.checkpoint();
    assert.equal(h.store.read()!.control.instructions[0].text, 'Do not lose this instruction');
  } finally { release?.(); await h.cleanup(); }
});

test('command status uses the same projection and native input is submitted only once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'research-commands-'));
  const hooks: Record<string, Function> = {}, tools: Record<string, any> = {}, commands: Record<string, any> = {};
  const sent: string[] = [], notices: string[] = [];
  const pi = { on(name: string, fn: Function) { hooks[name] = fn; }, registerTool(t: any) { tools[t.name] = t; }, registerCommand(name: string, c: any) { commands[name] = c; }, sendUserMessage(text: string) { sent.push(text); } };
  const ctx = { cwd: root, model: { id: 'fake' }, ui: { notify(text: string) { notices.push(text); }, setStatus() {}, setWidget() {} } };
  researcherExtension(pi as any);
  try {
    await commands.researcher.handler('Goal', ctx);
    await hooks.input({ source: 'extension', text: sent[0] }, ctx);
    const initialized = await tools.research_checklist.execute('', { action: 'init', objective: 'Goal' });
    assert.equal(initialized.details.pendingInstructions.length, 1);
    await hooks.input({ source: 'interactive', text: 'New constraint' }, ctx);
    assert.deepEqual(sent, ['Goal']);
    const result = await tools.research_checklist.execute('', { action: 'read' });
    await commands.researcher.handler('status', ctx);
    assert.deepEqual(JSON.parse(notices.at(-2)!), result.details);
    assert.equal(result.details.pendingInstructions.length, 2);
  } finally { await hooks.session_shutdown(); rmSync(root, { recursive: true, force: true }); }
});

test('goal revisions keep evidence and reopen accepted or skipped modules', async () => {
  const h = harness(); try {
    await h.call({ action: 'init', objective: 'Goal' }); await h.call({ action: 'plan', modules: [definition('M1'), definition('M2')] });
    await h.call({ action: 'start', moduleId: 'M1' });
    await h.call({ action: 'accept', moduleId: 'M1', evidence: ['https://example.com/source'], acceptance: ['Verified source'] });
    await h.call({ action: 'update', moduleId: 'M2', status: 'skipped', reason: 'Not applicable to original goal' });
    h.controller.instruction('Change goal');
    assert.equal(h.store.complete(h.store.read()!), false);
    await h.call({ action: 'resolve', instructionId: h.store.read()!.control.instructions[0].id, objective: 'Revised goal' });
    const c = h.store.read()!;
    assert.equal(c.objectiveRevision, 2); assert.deepEqual(c.modules.map(m => m.status), ['pending', 'pending']);
    assert.deepEqual(c.modules[0].evidence, ['https://example.com/source']);
    assert.equal(c.modules[0].acceptedRevision, undefined);
    assert.equal(currentModule(c)!.id, 'M1');
  } finally { await h.cleanup(); }
});

test('input waits for child cancellation; late abort cannot make stop resumable', async () => {
  const h = harness(); try {
    await h.call({ action: 'init', objective: 'Goal' });
    let finish!: () => void;
    const shuttingDown = new Promise<void>(resolve => { finish = resolve; });
    const runner = (h.controller as any).runner as ResearchRunner;
    const original = runner.cancelForeground.bind(runner);
    runner.cancelForeground = () => shuttingDown;
    const pause = h.controller.pause('User pause');
    let received = false;
    const input = h.controller.receive('Wait for cleanup', h.ctx as any).then(() => { received = true; });
    await Promise.resolve(); assert.equal(received, false);
    assert.equal(h.store.read()!.control.instructions.length, 0);
    finish(); await pause; await input; runner.cancelForeground = original;
    assert.equal(h.controller.active, true);
    const stop = h.controller.pause('User stop', 'stopped');
    await h.hooks.agent_settled({ aborted: true }, h.ctx); await stop;
    await h.controller.pause('Another pause');
    assert.equal(await h.controller.receive('Unrelated chat', h.ctx as any), 'ignored');
  } finally { await h.cleanup(); }
});
