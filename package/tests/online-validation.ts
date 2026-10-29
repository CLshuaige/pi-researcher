/** Opt-in paid integration check. Never included in npm test. */
import assert from 'node:assert/strict';
import { getSystemMessageText } from '@earendil-works/pi-ai';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ModelRegistry, ModelRuntime, getAgentDir, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { ChecklistStore, currentModule } from '../extensions/researcher/checklist.ts';
import { ResearchController } from '../extensions/researcher/controller.ts';
import { ResearchRunner } from '../extensions/researcher/runner.ts';
import { moduleResources } from '../extensions/researcher/modules.ts';
import { runSdk } from '../extensions/researcher/sdk.ts';
import { addUsage, zeroUsage } from '../extensions/researcher/usage.ts';
import envProxy from '../extensions/env-proxy/index.ts';

if (!process.argv.includes('--run-paid')) throw new Error('Opt-in required: node --experimental-strip-types tests/online-validation.ts --run-paid --provider <provider> --model <model>');
const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Supply ${name}`);
  return value;
};
const provider = argument('--provider'), modelId = argument('--model');
const reviewOnly = process.argv.includes('--review-root');
const root = reviewOnly ? argument('--review-root') : mkdtempSync(`/tmp/research-online-${modelId.replace(/[^a-zA-Z0-9_.-]/g, '_')}-`);
const store = new ChecklistStore(root);
const goal = 'Compare synthetic candidates A and B with a hard latency limit of 130 ms. Produce a concise Chinese report grounded only in observations.csv. This is a small integration fixture, not a real scientific result.';
if (reviewOnly) {
  assert.equal(store.read()?.control.state, 'completed', 'Review-only run requires a completed main checklist');
  assert.equal(JSON.parse(readFileSync(store.path('online-validation.json'), 'utf8')).model, `${provider}/${modelId}`);
} else {
  store.files.initialize(goal);
  writeFileSync(store.path('observations.csv'), 'candidate,accuracy,latency_ms\nA,0.80,120\nB,0.85,150\n');
  mkdirSync(store.path('.pi'), { recursive: true });
  writeFileSync(store.path('.pi/research.json'), JSON.stringify({ childExtensions: [], extraTools: [], reviewerTools: [], enableMcp: false, maxTurns: 8, timeoutMs: 180000 }));
  store.initialize(goal);
}
envProxy({} as never);
const agentDir = getAgentDir();
const catalog = join(agentDir, 'models-store.json'), testCatalog = store.path('.research/test-models-cache.json');
if (existsSync(catalog)) copyFileSync(catalog, testCatalog);
// Use only the current Pi account; normal OAuth refresh stays in its native credential store.
const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), modelsStorePath: testCatalog, allowModelNetwork: false });
const registry = new ModelRegistry(runtime);
const model = registry.find(provider, modelId);
assert.ok(model, `Configured ${provider}/${modelId} must exist`);
assert.ok(registry.hasConfiguredAuth(model), `Configured ${provider} credentials required`);
const abort = new AbortController();
const deadline = setTimeout(() => abort.abort(new Error('Online validation exceeded 5 minutes')), 300000);
let requests = 0, phase = reviewOnly ? 'child' : 'main';
const usage = zeroUsage();
const requestLog: object[] = [], toolLog: object[] = [], skillChecks: string[] = [];
const host = {
  cwd: root, model, thinkingLevel: 'off',
  modelRegistry: {
    streamSimple: ((selected, context, options) => {
      if (requests >= 28) throw new Error('Online validation request budget exceeded (28)');
      const selectedModule = phase === 'main' ? currentModule(store.read()!) : undefined;
      const required = selectedModule?.skills ?? (phase === 'child' ? ['research-review' as const] : []);
      const texts = [context.systemPrompt ?? '', ...context.messages.flatMap(message =>
        message.role === 'system' ? [getSystemMessageText(message)] : typeof message.content === 'string' ? [message.content] : message.content.flatMap(part => part.type === 'text' ? [part.text] : []))];
      // Main checkpoints are JSON encoded inside a text block; compare decoded bodies.
      const checkpoint = texts.map(text => { try { return JSON.parse(text); } catch { return undefined; } })
        .findLast(value => Array.isArray(value?.skillInstructions));
      if (phase === 'main' && selectedModule) assert.equal(checkpoint?.currentModule?.id, selectedModule.id);
      for (const path of moduleResources(required).skills) {
        const body = readFileSync(path, 'utf8');
        assert.ok(phase === 'main' ? checkpoint?.skillInstructions.some((skill: { instructions: string }) => skill.instructions === body)
          : texts.some(text => text.includes(body)), 'Full current Skill must reach the actual model request');
      }
      requests++;
      if (required.length) skillChecks.push(`${phase}:${required.join(',')}`);
      const number = requests, requestPhase = phase;
      console.log(JSON.stringify({ event: 'request', number, phase, module: selectedModule?.id, skills: required }));
      const stream = registry.streamSimple(selected, context, { ...options, maxTokens: 2048, signal: options?.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal });
      void stream.result().then(message => {
        addUsage(usage, message.usage);
        requestLog.push({ number, phase: requestPhase, stopReason: message.stopReason, usage: message.usage, error: message.errorMessage });
        console.log(JSON.stringify({ event: 'response', number, stopReason: message.stopReason, tokens: message.usage.totalTokens }));
      });
      return stream;
    }) as ModelRegistry['streamSimple'],
  },
} as unknown as ExtensionContext;
let controller: ResearchController | undefined;
const runner = new ResearchRunner();
let mainResult: unknown, childResult: unknown, failure: string | undefined;
console.log(JSON.stringify({ event: 'start', root, model: `${provider}/${modelId}`, limits: { requests: 28, outputTokensPerRequest: 2048, timeoutSeconds: 300 } }));
try {
  if (!reviewOnly) {
    mainResult = await runSdk({
      cwd: root, host, sessionDir: store.path('.research/main-session'), signal: abort.signal, maxTurns: 20,
      tools: ['research_checklist', 'read', 'write', 'edit'],
      prompt: `${goal}\nResume the paused research loop. Resolve this instruction. Plan exactly two ordered modules: M1 uses research-task to read observations.csv and record the decision constraints in research/STATE.md; M2 uses research-report to write research/reports/comparison.md. Start and accept each module through the checklist protocol in order. Read real files and inspect evidence before acceptance. The final report must state each candidate's accuracy and latency, recommend the eligible candidate, and explicitly say these synthetic observations do not establish generalization or statistical significance. No browsing, delegation or experiments are needed for this fixture. Keep prose concise; complete the checklist and stop.`,
      factories: [pi => {
        controller = new ResearchController(pi, runner); controller.bind();
        pi.on('session_start', async (_event, ctx) => { controller!.activate(ctx); await controller!.pause('Online fixture pause'); });
        pi.on('tool_call', event => {
          toolLog.push({ phase: 'main', name: event.toolName, input: event.input });
          console.log(JSON.stringify({ event: 'tool', name: event.toolName, action: (event.input as { action?: string }).action }));
        });
      }],
    });
    const c = store.read()!;
    assert.equal(c.control.state, 'completed');
    assert.deepEqual(c.modules.map(m => [m.id, m.status]), [['M1', 'completed'], ['M2', 'completed']]);
    assert.ok(c.control.instructions.length > 0 && c.control.instructions.every(i => i.resolution));
    const paused = c.audit.findIndex(a => a.reason === 'Online fixture pause');
    assert.equal(c.audit[paused + 1].reason, 'Explicit start/resume');
    assert.equal(c.audit.at(-1)?.reason, 'All modules accepted');
    assert.equal(existsSync(store.path('.research/controller.lock')), false);
    const report = readFileSync(store.path('research/reports/comparison.md'), 'utf8');
    for (const number of ['120', '150', '130']) assert.ok(report.includes(number), `Report must include ${number}`);
    assert.match(report, /0\.80|80\s*%/); assert.match(report, /0\.85|85\s*%/);
    assert.ok(skillChecks.includes('main:research-task') && skillChecks.includes('main:research-report'));
    console.log(JSON.stringify({ event: 'main-completed', revision: c.revision }));
  } else mainResult = { reusedCompletedRun: store.path('online-validation.json') };
  phase = 'child';
  const child = await runner.run({ objective: 'Independently review research/reports/comparison.md against observations.csv and the 130 ms hard constraint. Check all numbers, candidate recommendation and limitations; do not alter files. Return a concise Chinese structured handoff via research_finish with input file paths as evidence and no artifacts. Do not browse or run experiments.', skills: ['research-review'], inputs: ['observations.csv', 'research/reports/comparison.md'], doneWhen: ['Check numeric claims against the CSV', 'Verify the latency constraint and synthetic-data caveat; report any discrepancies honestly'] }, host, abort.signal);
  childResult = child;
  assert.equal(child.status, 'completed', child.error ?? JSON.stringify(child.result));
  assert.ok(child.sessionFile && existsSync(store.path(child.sessionFile)));
  assert.ok(skillChecks.includes('child:research-review'));
  console.log(JSON.stringify({ event: 'child-completed', taskId: child.id }));
} catch (error) {
  failure = String(error);
  console.error(failure);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await controller?.pause('Session shutdown');
  await runner.shutdown();
  const result = { model: `${provider}/${modelId}`, root, success: !failure, failure, requests, usage, billingNote: 'Configured model prices may be zero; this is not a provider billing receipt.', skillChecks, requestLog, toolLog, mainResult, childResult };
  const evidence = store.path(reviewOnly ? 'online-review-validation.json' : 'online-validation.json');
  writeFileSync(evidence, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ event: 'finished', success: !failure, requests, usage, evidence }));
}
