import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { ResearchController } from '../extensions/researcher/controller.ts';
import { ChecklistStore } from '../extensions/researcher/checklist.ts';
import { applyChecklistAction, checklistRecovery } from '../extensions/researcher/checklist-tool.ts';
import reportGuard, { reportHandoff } from '../extensions/researcher/boundaries.ts';
import { processIdentity } from '../extensions/researcher/store.ts';

function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'research-repetition-'));
  const hooks: Record<string, any> = {}, events: Record<string, any> = {}, tools: Record<string, any> = {};
  const branch: any[] = [];
  const messages: any[] = [];
  let jobChanged: ((root: string) => void) | undefined;
  let executions = 0, aborts = 0, sequence = 0;
  const api: any = {
    on: (name: string, handler: any) => { hooks[name] = handler; },
    events: { on: (name: string, handler: any) => { events[name] = handler; } },
    registerTool: (tool: any) => { tools[tool.name] = tool; },
    appendEntry() {}, sendMessage: (message: any, options: any) => { messages.push({ message, options }); },
  };
  const ctx: any = {
    cwd: root, model: {}, abort: async () => { aborts++; },
    ui: { setWidget() {}, setStatus() {}, notify() {} },
    sessionManager: { getBranch: () => branch, getSessionId: () => 'repetition-test' },
  };
  const runner: any = {
    onJobChange: (handler: any) => { jobChanged = handler; },
    cancelForeground: async () => {}, shutdown: async () => {},
  };
  const controller = new ResearchController(api, runner);
  const store = new ChecklistStore(root);
  let c = store.initialize('Review precipitation forecasting methods');
  c = applyChecklistAction(store, {
    action: 'plan', reason: 'Test plan', expectedRevision: c.revision,
    modules: [{ id: 'M1', objective: 'Review planner deliverables', skills: ['research-method'],
      criteria: ['Verify the proposed methods'], dependencies: [] }],
  })!;
  applyChecklistAction(store, { action: 'start', reason: 'Test start', moduleId: 'M1', expectedRevision: c.revision });
  controller.bind();
  controller.activate(ctx);
  t.after(async () => { await controller.pause('Session shutdown', 'stopped', false); rmSync(root, { recursive: true, force: true }); });
  const turn = () => hooks.turn_start?.({ turnIndex: ++sequence }, ctx);
  const endTurn = async () => {
    await hooks.turn_end({ outcome: 'completed' }, ctx);
    await (controller as any).pausing;
  };
  const settle = (outcome = 'completed') => hooks.agent_before_settle({ outcome, entries: [] }, ctx);
  const call = (command = 'find method -type f | sort; wc -l method/context.md; mkdir -p method/critic') => {
    const event = { toolName: 'bash', toolCallId: randomUUID(), input: { command } };
    const blocked = hooks.tool_call(event, ctx);
    if (blocked?.block) return { blocked, event, output: undefined };
    executions++;
    const output = hooks.tool_result({ ...event, isError: false, content: [{ type: 'text', text: '990 total' }] }, ctx);
    return { blocked: undefined, event, output };
  };
  const prime = () => { for (let i = 0; i < 3; i++) { turn(); assert.equal(call().blocked, undefined); } };
  const startChild = (id: string) => events['subagent:async-started']({ id, sessionId: 'repetition-test' });
  const finishChild = (id: string) => events['subagent:async-complete']({ runId: id, mode: 'single', state: 'complete' });
  const job = (id = `J-${randomUUID()}`, status = 'running') => {
    const checklist = store.read()!;
    store.files.saveJob({ version: 1, id, status, researchId: checklist.researchId,
      objectiveRevision: checklist.objectiveRevision, moduleId: 'M1', startedAt: Date.now(),
      command: 'test-job', cwd: root, envNames: [], fingerprint: id, timeoutSeconds: 0,
      ownerPid: process.pid, ownerToken: 'test-owner',
      workerPid: process.pid, workerIdentity: processIdentity(process.pid), logPath: '.research/test-job.log' } as any);
    jobChanged!(root);
    return id;
  };
  const wait = (wakeAfterSeconds?: number) => tools.research_job.execute(randomUUID(), { action: 'wait', ...(wakeAfterSeconds === undefined ? {} : { wakeAfterSeconds }) });
  return { root, hooks, events, tools, branch, ctx, api, controller, store, turn, endTurn, settle, call, prime,
    startChild, finishChild, job, wait, messages, executions: () => executions, aborts: () => aborts };
}

test('missing initial plan modules returns a fillable plan recovery without changing the checklist', t => {
  const root = mkdtempSync(join(tmpdir(), 'research-plan-recovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new ChecklistStore(root);
  const initial = store.initialize('Review precipitation forecasting methods');
  const attempted = { action: 'plan', expectedRevision: initial.revision, reason: 'Initial plan', title: '规划研究' } as any;
  const before = JSON.stringify(store.read());
  let error: unknown;
  assert.throws(() => applyChecklistAction(store, attempted), caught => {
    error = String(caught);
    return /plan requires modules/.test(String(caught));
  });

  const result = checklistRecovery(store, error, attempted);
  const recovery = (result as any).recovery;
  assert.equal(recovery.nextAction, 'plan');
  assert.equal(recovery.currentRevision, initial.revision);
  assert.equal(recovery.planningRequirements.objective, 'Review precipitation forecasting methods');
  assert.deepEqual(recovery.planningRequirements.retryTemplate, {
    action: 'plan', expectedRevision: initial.revision, reason: 'Initial plan',
    modules: [{ id: 'M1', objective: '', skills: [], criteria: [], dependencies: [] }],
  });
  assert.equal(recovery.planningRequirements.templateNeedsCompletion, true);
  assert.ok(recovery.planningRequirements.allowedSkills.includes('research-literature'));
  assert.ok(recovery.planningRequirements.allowedSkills.every((skill: string) => !skill.endsWith('-single')));
  assert.match(recovery.planningRequirements.instruction, /reason\/title/);
  assert.match(recovery.planningRequirements.instruction, /Empty objective or acceptance criteria/);
  assert.equal(JSON.stringify(store.read()), before, 'recovery must not submit or mutate the checklist');

  assert.throws(() => applyChecklistAction(store, recovery.planningRequirements.retryTemplate), /Invalid arguments/i,
    'the empty skeleton must fail validation');
  assert.equal(JSON.stringify(store.read()), before);
  const filled = { ...recovery.planningRequirements.retryTemplate, modules: [{ id: 'M1',
    objective: 'Compare forecasting methods against available precipitation datasets',
    skills: ['research-literature'], criteria: ['Use primary sources to compare methods'], dependencies: [] }] };
  const planned = applyChecklistAction(store, filled as any)!;
  assert.equal(planned.modules[0].objective, filled.modules[0].objective);
  assert.equal(planned.modules[0].status, 'pending');
});

test('the registered checklist tool exposes plan recovery and preserves the three-failure pause', async t => {
  const h = setup(t);
  h.store.change('Reset to unplanned checklist', c => { c.modules = []; });
  const revision = h.store.read()!.revision;
  const args = { action: 'plan', expectedRevision: revision, reason: 'Initial plan' };
  let result: any;
  for (let i = 0; i < 3; i++) result = await h.tools.research_checklist.execute(`plan-${i}`, args);
  assert.equal(result.isError, true);
  assert.equal(result.details.recovery.nextAction, 'plan');
  assert.equal(result.details.recovery.planningRequirements.retryTemplate.expectedRevision, revision);
  const checkpoint = JSON.parse(h.hooks.context({ messages: [] }, h.ctx).messages.at(-1).content);
  assert.equal(checkpoint.checklistRecovery.nextAction, 'plan');
  assert.equal(checkpoint.checklistRecovery.repeatedAttempts, 3);
  await h.hooks.turn_end({ outcome: 'completed' }, h.ctx);
  await (h.controller as any).pausing;
  assert.equal(h.store.read()!.control.state, 'paused');
  assert.match(h.store.read()!.control.reason, /Repeated checklist failure/);
});

test('revision conflict and unrelated plan errors do not receive the missing-modules template', t => {
  const root = mkdtempSync(join(tmpdir(), 'research-plan-conflict-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new ChecklistStore(root);
  const initial = store.initialize('Review precipitation forecasting methods');
  const attempted = { action: 'plan', expectedRevision: initial.revision, reason: 'Initial plan' } as any;
  store.change('Concurrent update', c => { c.control.continuations++; });
  let conflictError: unknown;
  assert.throws(() => applyChecklistAction(store, attempted), caught => {
    conflictError = String(caught);
    return /Revision conflict/.test(String(caught));
  });
  const conflict = checklistRecovery(store, conflictError, attempted) as any;
  assert.equal(conflict.recovery.nextAction, 'read');
  assert.equal(conflict.recovery.planningRequirements.retryTemplate, undefined);

  const other = checklistRecovery(store, new Error('Wait for active tasks before replanning.'), attempted) as any;
  assert.equal(other.recovery.nextAction, 'read');
  assert.equal(other.recovery.planningRequirements.retryTemplate, undefined);
});

test('fourth unchanged call is blocked before execution; retry after correction pauses', async t => {
  const h = setup(t);
  h.turn(); h.call(); h.turn(); h.call(); h.turn();
  assert.match(JSON.stringify(h.call().output), /重复执行检测/);
  h.turn();
  const fourth = h.call();
  assert.equal(fourth.blocked?.block, true);
  assert.equal(h.executions(), 3);
  assert.match(fourth.blocked.reason, /M1/);
  assert.match(fourth.blocked.reason, /Verify the proposed methods/);
  await h.endTurn();
  assert.equal(h.controller.active, true);
  assert.equal((await h.settle()).continue, true);
  h.turn(); assert.equal(h.call().blocked?.block, true);
  await h.endTurn();
  assert.equal(h.executions(), 3);
  assert.equal(h.store.read()!.control.state, 'paused');
});

test('duplicates in the same batch do not consume the correction opportunity', async t => {
  const h = setup(t); h.prime(); h.turn();
  for (let i = 0; i < 3; i++) assert.equal(h.call().blocked?.block, true);
  await h.endTurn();
  assert.equal(h.controller.active, true);
  assert.equal((await h.settle()).continue, true);
  assert.equal(h.executions(), 3);
});

test('in-flight calls prepared together cannot cause an immediate result-hook pause', async t => {
  const h = setup(t); h.turn();
  const calls = Array.from({ length: 4 }, () => ({ toolName: 'bash', toolCallId: randomUUID(), input: { command: 'ls method' } }));
  for (const event of calls) assert.equal(h.hooks.tool_call(event, h.ctx), undefined);
  for (const event of calls) h.hooks.tool_result({ ...event, isError: false, content: [{ type: 'text', text: 'unchanged' }] }, h.ctx);
  await h.endTurn();
  assert.equal(h.controller.active, true);
  assert.equal((await h.settle()).continue, true);
  h.turn(); assert.equal(h.call('ls method').blocked?.block, true);
  await h.endTurn();
  assert.equal(h.store.read()!.control.state, 'paused');
});

test('a natural next turn consumes the opportunity without a second forced correction', async t => {
  const h = setup(t); h.prime(); h.turn(); h.call(); await h.endTurn();
  h.turn(); assert.equal(h.call('ls method').blocked, undefined); await h.endTurn();
  const decision = await h.settle();
  assert.doesNotMatch(JSON.stringify(decision), /research-repetition-correction/);
  assert.equal(h.controller.active, true);
  h.turn(); h.call(); await h.endTurn();
  assert.equal(h.store.read()!.control.state, 'paused', 'changing a query alone does not reset the budget');
});

test('saving an artifact resets the budget, while read/help and control revisions do not', async t => {
  const h = setup(t); h.prime();
  h.store.change('Control bookkeeping', c => { c.control.continuations++; });
  await h.tools.research_checklist.execute('read', { action: 'read' });
  await h.tools.research_checklist.execute('help', { action: 'help' });
  h.turn(); assert.equal(h.call().blocked?.block, true);
  writeFileSync(join(h.root, 'method.md'), 'Verified planner evidence');
  h.turn(); assert.equal(h.call().blocked, undefined);
  h.turn(); h.call(); h.turn(); h.call(); h.turn();
  assert.equal(h.call().blocked?.block, true);
  await h.endTurn();
  assert.equal(h.controller.active, true, 'a new progress epoch gets its own correction opportunity');
});

test('stage progress in the same batch retires correction facts from the previous state', async t => {
  const h = setup(t); h.prime(); h.turn(); h.call();
  h.store.change('Ready for acceptance', c => { c.modules[0].status = 'awaiting_acceptance'; });
  const decision = await h.settle();
  assert.doesNotMatch(JSON.stringify(decision), /research-repetition-correction/);
  h.turn(); assert.equal(h.call().blocked, undefined);
});

test('active children suppress repeat pauses and resume through native completion', async t => {
  const h = setup(t); h.startChild('first'); h.startChild('second');
  h.controller.instruction('Continue the research');
  h.prime();
  for (let i = 0; i < 4; i++) {
    h.turn(); assert.equal(h.call().blocked?.block, true); await h.endTurn();
    assert.equal(await h.settle(), undefined);
    assert.equal(h.store.read()!.control.state, 'waiting');
    assert.equal(h.controller.active, true);
  }
  assert.equal(h.executions(), 3, 'waiting does not allow repeated tools to execute forever');
  h.finishChild('first'); assert.equal(h.store.read()!.control.state, 'waiting');
  h.finishChild('second'); assert.equal(h.store.read()!.control.state, 'running');
  h.turn(); assert.equal(h.call().blocked, undefined, 'completion clears the old repeated-call count');
  assert.equal((await h.settle()).continue, true);
});

test('native start followed by a receipt retains scientific task parsing context', t => {
  const h = setup(t); h.startChild('batch');
  h.hooks.tool_result({ toolName: 'subagent', input: { args: { tasks: [
    { key: 'P1', agent: 'delegate', task: '研究委派上下文：阶段为 research-method' },
  ] } }, details: { asyncId: 'batch' }, isError: false, content: [] }, h.ctx);
  h.events['subagent:async-complete']({ runId: 'batch', mode: 'workflow', state: 'complete', success: true,
    workflowChildren: { inventoryComplete: true, children: [{ childId: 'P1', runId: 'child', agent: 'delegate', state: 'completed' }] },
    results: [{ key: 'P1', runId: 'child', agent: 'delegate', ok: true, results: [{ agent: 'delegate', finalOutput: 'Missing scientific handoff', exitCode: 0 }] }],
  });
  const checkpoint = JSON.parse(h.hooks.context({ messages: [] }, h.ctx).messages.at(-1).content);
  assert.equal(checkpoint.priorSubagents.batch.workflow.status, 'partial');
});

test('child start clears a pending correction; user pause and abort remain effective', async t => {
  const h = setup(t); h.prime(); h.turn(); h.call();
  h.startChild('started-after-correction');
  assert.equal(await h.settle(), undefined);
  assert.equal(h.store.read()!.control.state, 'waiting');
  h.finishChild('started-after-correction');
  h.prime(); h.turn(); h.call(); await h.endTurn();
  assert.equal(h.controller.active, true);
  await h.controller.pause('User requested pause', 'paused', false);
  assert.equal(h.store.read()!.control.reason, 'User requested pause');
  h.controller.activate(h.ctx); h.startChild('running-during-abort');
  await h.settle('aborted');
  assert.equal(h.store.read()!.control.state, 'paused');
});

test('work started after a repeated retry prevents the pending repeat pause', async t => {
  const h = setup(t); h.prime(); h.turn(); h.call(); await h.endTurn();
  h.turn(); h.call();
  h.startChild('started-in-mixed-batch');
  await h.endTurn();
  assert.equal(h.controller.active, true);
  assert.equal(await h.settle(), undefined);
  assert.equal(h.store.read()!.control.state, 'waiting');
});

test('an error after the first intercepted call cannot be overridden by correction', async t => {
  const h = setup(t); h.prime(); h.turn(); h.call();
  await h.settle('error');
  assert.equal(h.controller.active, false);
  assert.equal(h.store.read()!.control.reason, 'Agent error or abort');
});

test('managed jobs wait despite unresolved instructions and their completion clears counts', async t => {
  const h = setup(t); const id = h.job(); h.controller.instruction('Continue'); h.prime();
  for (let i = 0; i < 3; i++) {
    h.turn(); assert.equal(h.call().blocked?.block, true); await h.endTurn();
    assert.equal(await h.settle(), undefined);
    assert.equal(h.store.read()!.control.state, 'waiting');
  }
  h.job(id, 'succeeded');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.store.read()!.control.state, 'running');
  assert.equal(h.messages.at(-1)?.message.customType, 'research-wake');
  assert.equal(h.messages.at(-1)?.options.triggerTurn, true);
  h.turn(); assert.equal(h.call().blocked, undefined);
  assert.equal((await h.settle()).continue, true);
  assert.equal(h.controller.active, true);
});

test('planned or followup instructions permit timed waits, but unhandled instructions do not', async t => {
  const h = setup(t);
  h.store.change('Planned instructions', c => { c.control.instructions.push(
    { id: 'planned', text: 'Original request', planned: true },
    { id: 'followup', text: 'Followup request', followupModuleId: 'M1' } as any,
  ); });
  assert.equal((await h.wait()).isError, true, 'bare wait still needs a running managed job or a timer');
  assert.equal((await h.wait(1800)).isError, undefined);
  h.prime();
  for (let i = 0; i < 3; i++) {
    h.turn(); assert.equal(h.call().blocked?.block, true); await h.endTurn();
    assert.equal(await h.settle(), undefined);
    assert.equal(h.store.read()!.control.state, 'waiting');
  }
  h.store.change('Unhandled request', c => { c.control.instructions.push({ id: 'unhandled', text: 'New requirement' }); });
  assert.match(JSON.stringify(await h.wait(1800)), /Resolve pending instructions/);
});

test('a scheduled wait wakes automatically and clears old repeat counts', async t => {
  const h = setup(t); h.prime();
  assert.equal((await h.wait(1)).isError, undefined);
  assert.equal(await h.settle(), undefined);
  await h.hooks.agent_settled({ aborted: false }, h.ctx);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(h.store.read()!.control.state, 'running');
  assert.equal(h.controller.active, true);
  assert.equal(h.messages.at(-1)?.options.triggerTurn, true);
  h.turn(); assert.equal(h.call().blocked, undefined);
});

test('real failure, checklist conflicts and no-progress protection remain in place', async t => {
  const h = setup(t);
  const stale = await h.tools.research_checklist.execute('stale', { action: 'start', moduleId: 'wrong-module', expectedRevision: 0, reason: 'Conflict' });
  assert.equal(stale.isError, true);
  await h.settle('error');
  assert.equal(h.store.read()!.control.state, 'paused');
  h.controller.activate(h.ctx);
  for (let i = 0; i < 5 && h.controller.active; i++) await h.settle();
  assert.equal(h.controller.active, false);
  assert.match(h.store.read()!.control.reason, /No checklist progress/);
});

test('report specialist retains its original third-warning and fourth-result stop', async t => {
  const h = setup(t);
  h.store.change('Report stage', c => { c.modules[0].skills = ['research-report']; });
  const hooks: Record<string, any> = {};
  reportGuard({ on: (name: string, handler: any) => { hooks[name] = handler; } } as any);
  hooks.before_agent_start({}, h.ctx);
  for (let i = 0; i < 4; i++) {
    const event = { toolName: 'bash', input: { command: 'ls report' }, content: [{ type: 'text', text: 'report.tex' }], isError: false };
    hooks.tool_call(event, h.ctx);
    const result = hooks.tool_result(event, h.ctx);
    if (i === 2) assert.match(JSON.stringify(result), /重复执行检测/);
    if (i === 3) assert.equal(result.isError, true);
  }
  assert.equal(hooks.turn_end({}, h.ctx).continue, false);
  assert.equal(h.aborts(), 1);
  assert.equal(reportHandoff(h.root)?.status, 'blocked');
});
