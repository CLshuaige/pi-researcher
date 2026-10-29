/** Offline provider for the real CLI/TUI smoke test; never contacts a model service. */
import { writeFileSync } from 'node:fs';
import { createAssistantMessageEventStream, type AssistantMessage, type ToolCall } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { ChecklistStore, currentModule } from '../../extensions/researcher/checklist.ts';
import { applyChecklistAction } from '../../extensions/researcher/checklist-tool.ts';
import { zeroUsage } from '../../extensions/researcher/usage.ts';

export default function smokeProvider(pi: ExtensionAPI) {
  let store: ChecklistStore;
  let calls = 0, scheduled = false;
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  pi.on('session_start', (_event, ctx) => {
    store = new ChecklistStore(ctx.cwd);
    store.files.initialize('Offline TUI smoke');
    store.initialize('Offline TUI smoke');
    applyChecklistAction(store, { action: 'plan', expectedRevision: 1, reason: 'Smoke fixture', modules: [
      { id: 'M1', objective: 'Inspect', skills: ['research-task'], criteria: ['Verify saved evidence'] },
      { id: 'M2', objective: 'Report', skills: ['research-report'], criteria: ['Verify saved evidence'], dependencies: ['M1'] },
    ] });
    writeFileSync(store.path('evidence.txt'), 'Deterministic test evidence');
  });
  pi.registerProvider('research-smoke', {
    api: 'openai-completions', baseUrl: 'http://offline.invalid', apiKey: 'offline',
    models: [{ id: 'local', name: 'Offline smoke', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024 }],
    streamSimple(model, context) {
      if (++calls > 16) throw new Error('Smoke provider request budget exceeded');
      const c = store.read()!, m = currentModule(c);
      if (m && !JSON.stringify(context).includes(`name: ${m.skills[0]}`)) throw new Error('Current Skill missing from provider context');
      const common = { expectedRevision: c.revision, reason: 'Offline TUI verification' };
      const instruction = c.control.instructions.find(i => !i.resolution);
      let name = 'research_checklist';
      const job = store.files.jobs()[0];
      let args: ToolCall['arguments'] | undefined;
      if (instruction) args = { ...common, action: 'resolve', instructionId: instruction.id };
      else if (m?.status === 'pending') args = { ...common, action: 'start', moduleId: m.id };
      else if (m?.id === 'M1' && !job) {
        name = 'research_job';
        args = { action: 'start', moduleId: m.id, timeoutSeconds: 30, command: `${quote(process.execPath)} -e ${quote("const fs=require('fs');const t=setInterval(()=>{if(fs.existsSync('release-download')){fs.writeFileSync('download.txt','verified download');clearInterval(t)}},30)")}` };
      } else if (job?.status === 'running' && !scheduled) {
        scheduled = true; name = 'research_job'; args = { action: 'wait', wakeAfterSeconds: 1 };
      } else if (job?.status === 'running') { /* Return control to the idle TUI. */ }
      else if (m) args = { ...common, action: 'accept', moduleId: m.id, evidence: [m.id === 'M1' ? 'download.txt' : 'evidence.txt'], acceptance: ['Verified fixture evidence'] };
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = { role: 'assistant', content: args ? [{ type: 'toolCall', id: `smoke-${calls}`, name, arguments: args }] : [{ type: 'text', text: job?.status === 'running' ? 'Download still running; expected 42 bytes.' : 'Smoke research complete' }], api: model.api, provider: model.provider, model: model.id, usage: zeroUsage(), stopReason: args ? 'toolUse' : 'stop', timestamp: Date.now() };
      // Leave enough time for the real terminal to render each request's widget.
      const timer = setTimeout(() => { stream.push({ type: 'done', reason: args ? 'toolUse' : 'stop', message }); stream.end(message); }, 700);
      timer.unref();
      return stream;
    },
  });
}
