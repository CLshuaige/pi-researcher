import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Value } from 'typebox/value';
import { JobParameters, jobGuide } from './job-tool.ts';
import { scopeBash } from "./boundaries.ts";
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { ChecklistParameters, applyChecklistAction, checklistGuide, checklistRecovery } from './checklist-tool.ts';
import { moduleResources } from './modules.ts';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { ChecklistStore, checklistState, currentModule, requireCurrentModule } from './checklist.ts';
import { acquireOwnerLock, atomicWrite } from './store.ts';
import type { ResearchRunner } from './runner.ts';

export const managerPrompt = `You are the research manager responsible for the entire goal, evidence, budget and acceptance. checklist.json is the authoritative control state; BRIEF.md explains the goal and STATE.md records synthesis. Use research_checklist to initialize, plan, revise and accept modules. Give calls a short Chinese title (at most 12 characters) describing the action; execution status is determined by the program, and reason retains its audit/resolution purpose. Never edit control files directly, including via Bash. Modules MUST execute in checklist array order. Only currentModule may start, execute, delegate or be accepted; blocked modules cannot be silently bypassed. Use research_checklist start before execution. The current module SKILL.md contents are injected into every request: follow them. Skills are instruction documents, not tool names. Module settings remain editable throughout the research. Before starting, restarting or resuming any stage, read and validate the latest project .pi/research-modules.json using research-task/scripts/check-settings.mjs; pass freshly validated settings and the project root to any child. Historical task text, outputs and configuration snapshots do not override settings saved later. Record the effective settings used by each run. There is no default runtime or model-request budget. Do not invent timeoutMs, maxRuntimeMs, toolTimeoutMs, timeoutSeconds or shell time limits; supply them only when the user explicitly authorizes such a limit. New settings apply at the next execution boundary; do not claim an already running command changed its launch parameters. Prefer existing evidence and small direct tasks; delegate bounded tasks with moduleId. Child completion is only a handoff: verify evidence against every criterion before acceptance. Record negative findings honestly. Resolve each pending user instruction, revising the objective when necessary. Work and download only within the research root; configure temporary files and caches there. Do not claim completion while the checklist is unfinished. Use research_job for long downloads/training: start returns a job ID immediately, then finish your response to wait without polling. Call research_job wait alone in a tool batch after resolving pending instructions: it ends the model run normally and can schedule one timed check. Pause/Escape preserves background jobs; stop cancels them. Answer new user input while jobs run. Inspect exit status and real artifacts before accepting; process success is not module acceptance. Mark genuinely blocked modules with reasons rather than looping without evidence.`;
// Routing belongs to the parent. The specialist reads its own mounted skill.
const literatureRouting = `When the current module declares research-literature, delegate the literature work through the pi-subagents plugin to the registered agent whose local name is research-literature and which mounts the research-literature skill. This project instruction authorizes that delegation. If only subagents_enable is visible, enable it first, then discover the exact agent name with subagent(action: list); use its full canonical name if namespaced. Call subagent with that agent, an explicit project cwd and a bounded task including the research goal, relevant inputs, output directory, freshly validated current configuration and acceptance criteria. On a new run or resume, instruct the specialist to reread and validate the project configuration rather than reuse an earlier snapshot. Do not substitute research_delegate, a generic agent or parent-side execution. Reuse the existing agent definition and its mounted skill. If the plugin or agent is unavailable, report the blocker. Use this argument shape (replace placeholders): {"agent":"research-literature","task":"bounded research goal, inputs, current config path and required deliverables","cwd":"/absolute/project","async":true,"output":false,"options":{"context":"fresh","outputMode":"inline"}}. output is a TOP-LEVEL field, never an options field. After a successful asynchronous launch, simply stop generating text. Do NOT call research_job wait, do NOT write "waiting for notification" text, do NOT call status, and do NOT simulate waiting. The plugin will automatically notify you when the child completes. Keep the plugin native completion and resume behavior. If the child times out or fails, inspect its structured handoff once and use the plugin resume action with the same run id and bounded remaining work; do not repeatedly inspect temporary logs or take over literature execution in the parent. If recovery cannot proceed, mark the module blocked with the concrete reason and stop. The parent reads the returned files and verifies each criterion before accepting the Checklist module; partial or failed work is not acceptance. Do not delegate again when already executing as the literature specialist. Other research modules retain their existing execution paths.`;

const experimentRouting = `When the current module declares research-experiment, delegate the experiment work through the pi-subagents plugin to the registered agent whose local name is research-experiment and which mounts the research-experiment skill. This project instruction authorizes that delegation. If only subagents_enable is visible, enable it first, then discover the exact agent name with subagent(action: list); use its full canonical name if namespaced. Call subagent with that agent, an explicit project cwd and a bounded task including the research goal, relevant inputs, output directory, freshly validated current configuration and acceptance criteria. On a new run or resume, instruct the specialist to reread and validate the project configuration rather than reuse an earlier snapshot. Do not substitute research_delegate, a generic agent or parent-side execution. Reuse the existing agent definition and its mounted skill. If the plugin or agent is unavailable, report the blocker. Use this argument shape (replace placeholders): {"agent":"research-experiment","task":"bounded experiment goal, inputs, current config path and required deliverables","cwd":"/absolute/project","async":true,"output":false,"options":{"context":"fresh","outputMode":"inline"}}. output is a TOP-LEVEL field, never an options field. After a successful asynchronous launch, simply stop generating text. Do NOT call research_job wait, do NOT write "waiting for notification" text, do NOT call status, and do NOT simulate waiting. The plugin will automatically notify you when the child completes. Keep the plugin native completion and resume behavior. If the child times out or fails, inspect its structured handoff once and use the plugin resume action with the same run id and bounded remaining work; do not repeatedly inspect temporary logs or take over experiment execution in the parent. If recovery cannot proceed, mark the module blocked with the concrete reason and stop. The parent reads the returned files and verifies each criterion before accepting the Checklist module; partial or failed work is not acceptance. Do not delegate again when already executing as the experiment specialist. Other research modules retain their existing execution paths.`;
export class ResearchController {
  store?: ChecklistStore;
  private release?: () => void;
  private last = '';
  private stagnant = 0;
  private continuations = 0;
  private enabled = false;
  private checklistFailure?: { key: string; count: number };
  private checklistFailurePause?: string;
  private delegationFailures = 0;
  private delegationQueries = 0;
  private asyncDelegations = new Set<string>();
  private terminalSubagents = new Map<string, { state: string; error?: string }>();
  private statusQueries = new Map<string, number>();
  private delegationFailurePause?: string;
  private closing = false;
  private waitId?: string;
  private requestEvents: string[] = [];
  private pending: string[] = [];
  private resumeOnInput = false;
  private pausing?: Promise<void>;
  private ui?: ExtensionContext['ui'];
  private visibleSkills = '';
  private context?: ExtensionContext;
  private busy = false;
  private waiting = false;
  private waitRequested = false;
  private wakeAt?: number;
  private wakeTimer?: ReturnType<typeof setTimeout>;
  private jobTimer?: ReturnType<typeof setInterval>;
  private observedJobs = new Map<string, string>();
  private jobsWidget = '';
  private generation = 0;
  private pi: ExtensionAPI;
  private runner: ResearchRunner;
  private readSkill: (path: string) => string;
  constructor(pi: ExtensionAPI, runner: ResearchRunner, readSkill = (path: string) => readFileSync(path, 'utf8')) { this.pi = pi; this.runner = runner; this.readSkill = readSkill; this.runner.onJobChange((root) => {
    if (this.release && !this.closing && this.store?.files.root === root) this.refreshJobs();
  }); }
  get active() { return this.enabled; }
  private releaseIfIdle() {
    if (!this.active && !this.busy && !this.pausing && !this.store?.files.activeWork().length) {
      this.release?.(); this.release = undefined; clearInterval(this.jobTimer);
    }
  }
  pause(reason: string, state: 'paused' | 'stopped' | 'completed' = 'paused', interrupt = true): Promise<void> {
    const close = state !== 'paused' || reason === 'Session shutdown';
    if (this.closing && !close) return this.pausing ?? Promise.resolve();
    if (this.pausing) {
      if (close) {
        this.closing = true; this.resumeOnInput = false;
        return this.pausing.then(() => this.pause(reason, state));
      }
      return this.pausing;
    }
    const owned = Boolean(this.release);
    this.resumeOnInput = !close && !this.closing && (this.active || this.resumeOnInput);
    this.closing ||= close;
    this.enabled = false;
    this.generation++; this.waiting = false; this.waitRequested = false;
    this.wakeAt = undefined; this.waitId = undefined; this.requestEvents = [];
    clearTimeout(this.wakeTimer); this.showSkills([]);
    // Gate new execution before aborting. Never await the running agent from its own hook.
    if (interrupt && this.busy) void this.context?.abort();
    const work = async () => {
      try { if (owned && this.store?.read()) this.store.change(reason, c => { c.control.state = state; c.control.reason = reason; delete c.control.wakeAt; delete c.control.wait; }); }
      catch (error) { this.ui?.notify(`Cannot record research stop: ${String(error)}`, 'error'); }
      if (close) await this.runner.shutdown(); else await this.runner.cancelForeground();
      if (close) {
        clearInterval(this.jobTimer);
        this.ui?.setWidget('research-jobs', undefined); this.jobsWidget = '';
      }
    };
    this.pausing = work().finally(() => { this.pausing = undefined; this.releaseIfIdle(); });
    return this.pausing;
  }
  activate(ctx: ExtensionContext) {
    if (this.active) return;
    if (this.release && this.store?.files.root !== new ChecklistStore(ctx.cwd).files.root) throw new Error('Stop owned background jobs before changing workspaces');
    this.store = new ChecklistStore(ctx.cwd);
    const retained = this.release;
    const release = retained ?? acquireOwnerLock(this.store.path('.research/controller.lock'));
    try {
      this.pending = this.store.readInbox();
      this.store.files.events(); // Validate durable events before admitting a resumed model run.
      for (const dir of ['downloads', 'cache', 'tmp']) mkdirSync(this.store.path(`.research/${dir}`), { recursive: true });
      // A damaged checklist remains available for explicit repair through the tool.
      let initialized = false;
      try { initialized = Boolean(this.store.read()); } catch { /* Repair via tool. */ }
      if (initialized) this.store.change('Explicit start/resume', c => { c.control.state = 'running'; c.control.reason = ''; c.control.startedAt = Date.now(); c.control.continuations = 0; delete c.control.wakeAt; delete c.control.wait; });
      this.release = release; this.enabled = true; this.closing = false;
      this.ui = ctx.ui; this.context = ctx; this.generation++;
      // Restore outstanding native runs when reopening a persisted main session.
      this.asyncDelegations.clear(); this.terminalSubagents.clear(); this.statusQueries.clear();
      for (const entry of ctx.sessionManager?.getBranch() ?? []) {
        if (entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'subagent') {
          const details = entry.message.details as { asyncId?: string; asyncDir?: string } | undefined;
          if (!entry.message.isError && details?.asyncId) {
            let terminal = false;
            if (details.asyncDir) try {
              const status = JSON.parse(readFileSync(join(details.asyncDir, 'status.json'), 'utf8'));
              terminal = status.runId === details.asyncId && ['complete', 'failed', 'partial', 'paused', 'stopped', 'cancelled'].includes(status.state);
              if (terminal) this.terminalSubagents.set(details.asyncId, { state: status.state, error: status.error });
            } catch { /* The plugin remains responsible for unavailable run records. */ }
            if (!terminal) this.asyncDelegations.add(details.asyncId);
          }
        } else if (entry.type === 'custom_message' && entry.customType === 'subagent-notify') {
          const details = entry.details as { runs?: { runId?: string }[] } | undefined;
          for (const run of details?.runs ?? []) if (run.runId) this.asyncDelegations.delete(run.runId);
        }
      }
      this.waiting = false; this.waitRequested = false; this.wakeAt = undefined;
      this.observedJobs.clear();
      this.refreshJobs(true);
      clearInterval(this.jobTimer);
      this.jobTimer = setInterval(() => this.refreshJobs(), 2000);
      this.resumeOnInput = false; this.checklistFailure = undefined; this.checklistFailurePause = undefined;
      this.delegationFailures = 0; this.delegationQueries = 0; this.delegationFailurePause = undefined;
      this.last = ''; this.stagnant = 0; this.continuations = 0;
    } catch (error) { if (!retained) { release(); this.release = undefined; } this.enabled = false; this.resumeOnInput = Boolean(retained); throw error; }
  }
  /** Commands and native input share admission, resume and durable instruction handling. */
  async receive(text: string, ctx: ExtensionContext, explicit = false): Promise<'accepted' | 'ignored' | 'blocked'> {
    await this.pausing;
    const sameRoot = this.store?.files.root === new ChecklistStore(ctx.cwd).files.root;
    if (!explicit && !this.active && !(this.resumeOnInput && sameRoot)) return 'ignored';
    let queued = false;
    try {
      if (this.release && !sameRoot) throw new Error('Pause research before changing workspaces');
      if (!this.active) {
        if (!sameRoot) {
          this.store = new ChecklistStore(ctx.cwd);
          this.pending = this.store.readInbox();
        }
        if (!ctx.model) throw new Error('Select a model before resuming research');
        this.activate(ctx);
      }
      this.leaveWaiting('User input');
      queued = true;
      this.instruction(text);
      return 'accepted';
    } catch (error) {
      // Do not submit a research instruction to an uncontrolled ordinary model run.
      // Keep it in the inbox even if another owner currently prevents activation.
      this.store ??= new ChecklistStore(ctx.cwd);
      try { if (!queued) this.instruction(text, false); }
      catch (saveError) { ctx.ui.notify(`Research input retained in memory; inbox save failed: ${String(saveError)}`, 'error'); }
      ctx.ui.notify(`Cannot resume research; input retained: ${String(error)}`, 'error');
      return 'blocked';
    }
  }
  instruction(text: string, flush = true) {
    if (!text.trim()) return;
    this.pending.push(text);
    if (this.store) atomicWrite(this.store.path(".research/inbox.json"), JSON.stringify(this.pending));
    if (flush) this.flush();
  }
  private flush() {
    try {
      if (!this.store?.read() || !this.pending.length) return;
      const texts = [...this.pending];
      this.store.change('User instructions', c => { for (const text of texts) c.control.instructions.push({ id: `I-${c.revision}-${c.control.instructions.length}`, text }); });
      this.pending.splice(0, texts.length);
      atomicWrite(this.store.path(".research/inbox.json"), JSON.stringify(this.pending));
    } catch { /* Kept in memory until initialization/repair. */ }
  }
  private leaveWaiting(reason: string) {
    clearTimeout(this.wakeTimer);
    this.waitRequested = false; this.wakeAt = undefined; this.waitId = undefined;
    if (this.waiting || this.store?.read()?.control.wait) {
      this.waiting = false;
      this.store?.change(reason, c => { c.control.state = 'running'; c.control.reason = ''; delete c.control.wakeAt; delete c.control.wait; });
    }
  }
  private pendingEvents() {
    return this.store?.files.events().filter(e => !e.delivered && (e.type === 'job' || e.waitId === this.waitId)) ?? [];
  }
  private refreshJobs(initial = false) {
    if (!this.release || this.closing || !this.store) return;
    try {
      const jobs = this.store.files.jobs();
      for (const job of jobs) {
        if (job.status !== 'running' && (!initial || job.researchId === this.store.read()?.researchId)) {
          const summary = `${job.id}: ${job.status}`;
          if (this.store.files.recordEvent({ id: `${job.id}:${job.status}`, type: 'job', time: Date.now(), researchId: job.researchId, objectiveRevision: job.objectiveRevision, jobId: job.id, summary })) {
            this.store.change(`Managed job ${summary}`, () => {});
          }
        }
        this.observedJobs.set(job.id, job.status);
      }
      const lines = jobs.filter(j => j.status === 'running').map(j => `${j.id} · running · ${Math.floor((Date.now() - j.startedAt) / 1000)}s`);
      const widget = lines.join('\n');
      if (widget !== this.jobsWidget) { this.ui?.setWidget('research-jobs', lines.length ? lines : undefined); this.jobsWidget = widget; }
      this.scheduleWake(); this.releaseIfIdle();
    } catch (error) {
      if (initial) throw error;
      this.ui?.notify(`Cannot inspect managed jobs: ${String(error)}`, 'error');
      void this.pause('Managed job state unavailable');
    }
  }
  private scheduleWake() {
    if (!this.active || this.pausing || !this.waiting || this.busy) return;
    clearTimeout(this.wakeTimer);
    let delay: number | undefined;
    try { delay = this.pendingEvents().length ? 0 : this.wakeAt === undefined ? undefined : Math.max(0, this.wakeAt - Date.now()); }
    catch (error) { this.ui?.notify(`Cannot schedule research wake: ${String(error)}`, 'error'); void this.pause('Research events unavailable'); return; }
    if (delay === undefined) return;
    const generation = this.generation;
    this.wakeTimer = setTimeout(() => {
      if (generation !== this.generation || !this.active || this.pausing || !this.waiting) return;
      // Never enqueue an automatic wake behind a user turn: that could survive a later stop.
      if (this.busy || this.context?.isIdle?.() === false || this.context?.hasPendingMessages?.()) return;
      try {
        if (this.wakeAt !== undefined && Date.now() >= this.wakeAt && this.waitId) {
          const c = this.store!.read()!;
          this.store!.files.recordEvent({ id: `timer:${this.waitId}`, type: 'timer', time: Date.now(), researchId: c.researchId, objectiveRevision: c.objectiveRevision, waitId: this.waitId, summary: 'Scheduled research check' });
        }
        const events = this.pendingEvents();
        if (!events.length) { this.scheduleWake(); return; }
        const reason = events.map(e => e.summary).join('; ');
        const timerIds = events.filter(e => e.type === 'timer').map(e => e.id);
        // Preserve a fired timer for the next request after retiring the wait.
        this.requestEvents = timerIds;
        this.leaveWaiting(reason);
        this.continuations++;
        this.store!.change('Wake research: ' + reason, c => { c.control.continuations = this.continuations; });
        this.pi.sendMessage({ customType: 'research-wake', content: `${reason}. Check the latest research checkpoint and inspect any completed child agent results. If child agents are still running, end this turn without calling wait again — the next scheduled check or completion notification will wake you. Verify artifacts before acceptance.`, display: false }, { triggerTurn: true });
      } catch (error) { this.ui?.notify(`Research wake failed: ${String(error)}`, 'error'); void this.pause('Research wake failed'); }
    }, delay);
  }
  private showSkills(names: string[]) {
    const label = names.length ? `Skills: ${[...names].sort().join(', ')}` : '';
    if (label === this.visibleSkills) return;
    this.ui?.setWidget('research-skills', label ? [label] : undefined);
    this.visibleSkills = label;
  }
  state() {
    if (this.active) this.flush();
    const jobs = this.store?.files.jobs() ?? [];
    return checklistState(this.store?.read(), this.pending, jobs);
  }
  private moduleSettings() {
    const path = this.store?.path('.pi/research-modules.json');
    const value = path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
    const interactionMode = value.interactionMode ?? 'auto';
    if (!['auto', 'review'].includes(interactionMode)) throw new Error('Invalid interactionMode');
    // Only non-secret module settings enter the model context.
    return { interactionMode, literature: value.literature, hypothesis: value.hypothesis,
      method: value.method, experiment: value.experiment };
  }
  checkpoint(ctx?: ExtensionContext) {
    if (ctx) { this.ui = ctx.ui; this.context = ctx; }
    let state: ReturnType<typeof checklistState>;
    try { state = this.state(); }
    catch (e) {
      this.showSkills([]);
      return `CONTROL REPAIR REQUIRED: ${String(e)}. Use research_checklist(action: repair), then read and reconcile.`;
    }
    const skillInstructions: { name: string; instructions: string }[] = [];
    const skillErrors: { name: string; error: string }[] = [];
    const skills = [...new Set(state.currentModule?.skills ?? [])];
    for (const [i, path] of moduleResources(skills).skills.entries()) {
      const name = skills[i];
      try { skillInstructions.push({ name, instructions: name === 'research-literature' ? literatureRouting : name === 'research-experiment' ? experimentRouting : this.readSkill(path) }); }
      catch (error) {
        // The UI exposes names and a clear failure, never resource paths or contents.
        const code = (error as NodeJS.ErrnoException).code ?? 'unreadable';
        skillErrors.push({ name, error: `SKILL LOAD FAILED (${code}); restore the Skill resource and retry. Checklist repair is not required.` });
        ctx?.ui.notify(`Cannot load Skill ${name} (${code})`, 'error');
      }
    }
    this.showSkills(skillInstructions.map(s => s.name));
    let moduleSettings: unknown;
    try { moduleSettings = this.moduleSettings(); }
    catch (error) { moduleSettings = { error: String(error), instruction: 'Repair module settings before execution; do not use a stale snapshot.' }; }
    return JSON.stringify({ ...(this.terminalSubagents.size ? { priorSubagents: Object.fromEntries(this.terminalSubagents), recoveryInstruction: "These runs have already ended. Inspect delivered evidence; resume a failed/partial literature run for bounded remaining work. Do not wait for it or repeat status queries." } : {}), ...(this.asyncDelegations.size ? { activeSubagents: [...this.asyncDelegations], instruction: "Child agents are running. End this turn and wait for the native completion notification; do not poll or relaunch." } : {}), moduleSettings, root: this.store?.files.root, ...state, ...(this.requestEvents.length ? { events: this.store?.files.events().filter(e => this.requestEvents.includes(e.id)) } : {}), skillInstructions, ...(skillErrors.length ? { skillErrors } : {}) });
  }
  private settlement(outcome: string) {
    if (outcome !== 'completed') return { state: 'paused' as const, reason: 'Agent error or abort' };
    try {
      this.flush();
      const c = this.store!.read();
      if (c && !this.pending.length && this.store!.complete(c)) return { state: 'completed' as const, reason: 'All modules accepted' };
      const unresolved = this.pending.length || c?.control.instructions.some(i => !i.resolution);
      if (!unresolved && !this.pendingEvents().length && (this.asyncDelegations.size || this.waitRequested || this.store!.files.jobs().some(j => j.status === 'running'))) {
        return { state: 'waiting' as const, reason: 'Waiting for child agents, managed jobs or scheduled check' };
      }
      const fingerprint = c ? this.store!.fingerprint(c) : 'missing';
      this.stagnant = fingerprint === this.last ? this.stagnant + 1 : 0;
      this.last = fingerprint;
      if (this.stagnant >= 3) return { state: 'paused' as const, reason: 'No checklist progress across repeated continuations' };
      if (c?.modules.length && !this.pending.length && !c.control.instructions.some(i => !i.resolution) && currentModule(c)?.status === 'blocked') return { state: 'paused' as const, reason: 'Remaining work blocked; inspect checklist' };
      return { state: 'continue' as const, reason: 'Continue unfinished research', checklist: c };
    } catch {
      return this.continuations >= 3 ? { state: 'paused' as const, reason: 'Checklist repair failed' }
        : { state: 'continue' as const, reason: 'Continue checklist repair' };
    }
  }
  bind() {
    const pi = this.pi;
    // The plugin owns result delivery and wakeup; the manager only tracks its work.
    pi.events?.on('subagent:async-started', data => {
      const event = data as { id?: string; sessionId?: string };
      if (event.id && event.sessionId === this.context?.sessionManager.getSessionId()) this.asyncDelegations.add(event.id);
    });
    pi.events?.on('subagent:async-complete', data => {
      const event = data as { runId?: string; id?: string };
      const owned = this.asyncDelegations.delete(event.runId || event.id || '');
      if (owned && this.active && this.waiting && !this.asyncDelegations.size && !this.waitRequested && !this.store?.files.jobs().some(j => j.status === 'running')) this.leaveWaiting('Child agent result delivered');
    });
    pi.on('agent_start', (_event, ctx) => { this.busy = true; this.context = ctx; });
    pi.on('turn_end', event => {
      if ((this.checklistFailurePause || this.delegationFailurePause) && this.active) {
        const reason = this.delegationFailurePause || this.checklistFailurePause!;
        this.checklistFailurePause = undefined; this.delegationFailurePause = undefined;
        this.ui?.notify(reason, 'warning'); void this.pause(reason);
      }
      if (event.outcome === 'completed' && this.release) {
        try { this.store?.files.acknowledgeEvents(this.requestEvents); this.requestEvents = []; }
        catch (error) { this.ui?.notify(`Event acknowledgement failed: ${String(error)}`, 'error'); void this.pause('Event acknowledgement failed'); }
      }
    });
    pi.on('before_agent_start', (event, ctx) => {
      this.context = ctx;
      if (this.active && this.waiting && !this.asyncDelegations.size && !this.waitRequested && !this.store?.files.jobs().some(j => j.status === 'running')) this.leaveWaiting('Child agent result received');
      return this.active ? { systemPrompt: event.systemPrompt + '\n\n' + managerPrompt + '\n\n' + literatureRouting } : undefined;
    });
    pi.on('context', (event, ctx) => {
      if (!this.active) return;
      try { this.requestEvents = [...new Set([...this.requestEvents, ...this.pendingEvents().map(e => e.id)])]; }
      catch (error) { ctx.ui.notify(`Cannot read research events: ${String(error)}`, 'error'); void this.pause('Research events unavailable'); return; }
      return { messages: [...event.messages.filter(m => !(m.role === 'custom' && m.customType === 'research-checkpoint')), {
        role: 'custom' as const, customType: 'research-checkpoint', content: this.checkpoint(ctx), display: false, timestamp: Date.now(),
      }] };
    });
    pi.on('input', async (event, ctx) => {
      if (event.source === 'extension' || !event.text.trim()) return;
      if (await this.receive(event.text, ctx) === 'blocked') return { action: 'handled' as const };
    });
    pi.on('tool_call', (event, ctx) => {
      if (this.checklistFailurePause || this.delegationFailurePause) return { block: true, reason: this.delegationFailurePause || this.checklistFailurePause };
      if (!this.active || !this.store) {
        if (this.release || this.pausing) return { block: true, reason: 'Research execution is paused or stopping' };
        return;
      }
      if (event.toolName === 'subagent' && this.asyncDelegations.size && (event.input as { action?: string }).action === 'status') return { block: true, terminate: true, reason: 'Child agents are running. End this turn and wait for the plugin completion notification; no status polling is needed.' };
      if (event.toolName === 'research_job' && (event.input as { action?: string }).action === 'wait') {
        const entries = ctx.sessionManager.getBranch();
        const entry = [...entries].reverse().find(e => e.type === 'message' && e.message.role === 'assistant');
        const message = entry?.type === 'message' && entry.message.role === 'assistant' ? entry.message : undefined;
        if (event.parentToolCallId || !message || message.content.filter(b => b.type === 'toolCall').length !== 1) return { block: true, reason: 'Call research_job wait alone in its own tool batch; nested wait is unsupported' };
      }
      try {
        const c = this.store.read();
        const jobManagement = event.toolName === 'research_job' && (event.input as { action?: string }).action !== 'start';
        if (jobManagement) return;
        if ((!c || !c.modules.length) && !['read', 'grep', 'find', 'ls', 'research_checklist'].includes(event.toolName)) return { block: true, reason: 'Call research_checklist(action: "init") to initialize the research checklist, then research_checklist(action: "plan", modules: [...]) to plan modules before any other tool execution.' };
        if (c && c.modules.length && !['read', 'grep', 'find', 'ls', 'research_checklist'].includes(event.toolName)) {
          const m = currentModule(c);
          if (!m || !['running', 'awaiting_acceptance'].includes(m.status)) return { block: true, reason: `Call research_checklist(action: "start", moduleId: "${m?.id ?? '...'}") to start the current module before other tool execution.` };
          requireCurrentModule(c, m.id);
          if (event.toolName === 'subagent' && m.skills.some(skill => ['research-literature', 'research-experiment'].includes(skill))) {
            const input = event.input as { agent?: string; task?: string; message?: string; cwd?: string; output?: unknown; options?: Record<string, unknown>; action?: string };
            const literature = m.skills.includes('research-literature');
            const specialist = literature ? 'research-literature' : 'research-experiment';
            if (input.action === 'resume' || (!input.action && (input.agent || '').split(/[:/]/).at(-1) === specialist)) {
              // Temporarily disable activity-monitor notices: ordinary reading can
              // exceed the 60s idle window. Native completion/failure delivery stays on.
              input.options = { ...input.options, control: { enabled: false } };
            }
            if (input.action === 'resume') {
              input.message = `${input.message || ''}\n恢复后的研究产物必须交付到项目根目录 ${this.store.files.root}，先读取该目录 .pi/research-modules.json 最新配置。若先前材料位于插件日志/会话目录，核验后复制需要的材料到项目目录，再继续未完成部分。${literature ? '优先交接 literature.md 和 literature/papers.jsonl' : '实验代码、环境与运行记录放在 experiment/，结论写入 result.md'}；不要重复已完成工作或反复处理缺少的依赖。`;
            }
            if (!input.action && (input.agent || '').split(/[:/]/).at(-1) === specialist) {
              input.cwd = this.store.files.root;
              input.output = false;
              input.options = { ...input.options, context: 'fresh', outputMode: 'inline' };
              delete input.options.output;
              // Keep project deliverables outside the plugin's managed transcript directory.
              input.task = `${input.task || ''}\n项目根目录：${this.store.files.root}。先读取该目录 .pi/research-modules.json 的最新配置。所有研究产物写入此项目；插件的 session/artifact 目录仅用于日志，不能作为研究输出目录。${literature ? 'literature.md 和 literature/ 位于项目根目录下；先写 literature.md 和 papers.jsonl 的已核实内容，再按配置完成可选综述' : '实验代码、环境与运行记录放在 experiment/，结论写入 result.md，按配置执行有界优化并核验目标'}；资源缺失时保留已完成内容并如实交接，不反复安装依赖。`;
            }
          }
          if (event.toolName === 'engine_start' && !m.skills.includes('research-experiment')) return { block: true, reason: 'Current module does not declare research-experiment' };
        }
        const input = event.input as { path?: string; outputDir?: string; command?: string };
        if (['write', 'edit'].includes(event.toolName)) {
          const p = this.store.path(input.path ?? '');
          if (p === this.store.path('checklist.json') || p.startsWith(this.store.path('.research') + '/')) return { block: true, reason: 'Runtime files are managed through research_checklist' };
        }
        if (event.toolName === 'bash') scopeBash(this.store.files.root, input);
        if (event.toolName === 'engine_start') {
          const target = (event.input as { projectPath?: string }).projectPath;
          if (!target) throw new Error('Supply projectPath');
          this.store.path(target);
        }
        if (event.toolName === 'download_pdf') {
          if (!input.outputDir?.startsWith('/')) throw new Error('Supply absolute project outputDir');
          this.store.path(input.outputDir);
        }
        if (event.toolName === 'fetch_arxiv') throw new Error('Unadapted global cache tool disabled; use project-local download_pdf');
      } catch (e) { if (event.toolName !== 'research_checklist' && !['read', 'grep', 'find', 'ls'].includes(event.toolName)) return { block: true, reason: String(e) }; }
    });
    pi.on('tool_result', event => {
      if (!this.active || !this.store || event.toolName !== 'subagent') return;
      const details = event.details as { asyncId?: string } | undefined;
      if (!event.isError && details?.asyncId) this.asyncDelegations.add(details.asyncId);
      const c = this.store.read(), m = c && currentModule(c);
      if (!m?.skills.includes('research-literature')) return;
      if (event.input.action === 'status') {
        const id = String(event.input.id || event.input.runId || '');
        const text = event.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        const state = text.match(/^State: (failed|complete|completed|partial|paused|stopped|cancelled)\b/m)?.[1];
        if (state && id) {
          this.asyncDelegations.delete(id);
          this.terminalSubagents.set(id, { state });
          const count = (this.statusQueries.get(id) || 0) + 1;
          this.statusQueries.set(id, count);
          if (count < 3) return { content: [...event.content, { type: 'text' as const, text: `运行 ${id} 已结束（${state}），不能继续等待。请核查已有产物；未完成时使用 subagent(action: resume, id: ${id}) 继续，不再重复查询状态。` }] };
          this.delegationFailurePause = '文献子代理已结束，但主流程重复查询状态，已停止循环。请从子代理步骤恢复任务。';
          return;
        }
      }
      if (event.input.action === 'list') {
        this.delegationQueries++;
        const text = event.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        if (!text.includes('research-literature')) this.delegationFailures++;
      } else if (event.isError && (!event.input.action || ['start', 'resume'].includes(String(event.input.action)))) this.delegationFailures++;
      else if (!event.input.action || event.input.action === 'resume') {
        this.delegationFailures = 0; this.delegationQueries = 0;
      }
      if (this.delegationFailures < 2 && this.delegationQueries < 3) return;
      const reason = '文献代理暂不可用：已停止重复发现或调用。请检查插件代理目录，修复后继续研究。';
      this.store.change(reason, value => {
        const module = value.modules.find(module => module.id === m.id)!;
        module.status = 'blocked'; module.reason = reason;
      });
      this.delegationFailurePause = reason;
      return { content: [...event.content, { type: 'text' as const, text: reason }] };
    });
    pi.on('agent_before_settle', async (event) => {
      if (!this.active || !this.store) return;
      const decision = this.settlement(event.outcome);
      if (decision.state === 'waiting') {
        this.waiting = true; this.stagnant = 0;
        this.store.change(decision.reason, c => { c.control.state = 'waiting'; c.control.reason = decision.reason; c.control.wakeAt = this.wakeAt; if (c.control.wait) c.control.wait.state = 'waiting'; });
        return;
      }
      if (decision.state !== 'continue') { await this.pause(decision.reason, decision.state, false); return; }
      this.continuations++;
      try {
        if (decision.checklist) this.store.change(decision.reason, c => { c.control.continuations = this.continuations; });
      } catch { await this.pause('Could not record research continuation'); return; }
      return { entries: [...event.entries, { type: 'custom_message' as const, customType: 'research-continue', content: `Research is unfinished (continuation ${this.continuations}, stagnant checks: ${this.stagnant}). Check the current checklist state before acting — if the last approach failed, try a different strategy rather than repeating the same command. Perform the next bounded action; mark blocked work honestly.`, display: false }], continue: true };
    });
    pi.on('agent_settled', async (event, ctx) => {
      this.busy = false; this.context = ctx;
      if (event.aborted && this.active) await this.pause('User or runtime aborted');
      if (this.store) ctx.ui.setStatus('researcher', this.active ? this.waiting ? `Research waiting${this.wakeAt ? '; check at ' + new Date(this.wakeAt).toISOString() : '; awaiting job event'}; new input is welcome` : 'Research running' : this.resumeOnInput ? 'Research paused; background jobs may still run; send input or /researcher resume' : 'Research inactive; /researcher resume to start');
      this.releaseIfIdle(); this.scheduleWake();
    });
    pi.on('session_shutdown', async () => {
      await this.pause('Session shutdown');
      this.busy = false; this.releaseIfIdle();
    });
    pi.registerTool({ name: 'research_job', label: 'Research background job', executionMode: 'sequential', description: jobGuide, parameters: JobParameters,
      execute: async (_id, p, signal) => {
        try {
          if (!Value.Check(JobParameters, p)) throw new Error('Invalid research_job arguments');
          if (!this.active || !this.store || this.pausing) throw new Error('Activate /researcher first');
          signal?.throwIfAborted();
          let result: unknown;
          if (p.action === 'start') {
            if (!p.moduleId || !p.command) throw new Error('start requires moduleId and command');
            result = this.runner.startJob({ moduleId: p.moduleId, command: p.command, cwd: p.cwd, env: p.env, timeoutSeconds: p.timeoutSeconds }, this.store.files.root);
            this.refreshJobs();
          } else if (p.action === 'status') result = p.jobId ? this.store.files.jobStatus(p.jobId) : this.store.files.jobs();
          else if (p.action === 'cancel') {
            if (!p.jobId) throw new Error('cancel requires jobId');
            result = await this.runner.cancelJob(p.jobId, this.store.files.root);
          } else {
            const c = this.store.read();
            if (!c) throw new Error('Initialize checklist before waiting');
            const unresolved = this.state().pendingInstructions;
            if (unresolved.length) throw new Error(`Resolve pending instructions before waiting: ${JSON.stringify(unresolved)}`);
            if (p.wakeAfterSeconds === undefined && !this.store.files.jobs().some(j => j.status === 'running')) throw new Error('wait needs a running job or wakeAfterSeconds');
            this.waitRequested = true; this.waitId = randomUUID();
            this.wakeAt = p.wakeAfterSeconds === undefined ? undefined : Date.now() + p.wakeAfterSeconds * 1000;
            this.store.change('Wait requested', value => { value.control.wait = { id: this.waitId!, objectiveRevision: value.objectiveRevision, jobIds: this.store!.files.jobs().filter(j => j.status === 'running').map(j => j.id), wakeAt: this.wakeAt, state: 'requested' }; });
            result = { waitRequested: true, waitId: this.waitId, wakeAt: this.wakeAt ?? null };
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result, terminate: true };
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
        } catch (error) { return { content: [{ type: 'text' as const, text: String(error) }], details: { error: String(error) }, isError: true }; }
      },
    });
    pi.registerTool({ name: 'research_checklist', label: 'Research checklist', executionMode: 'sequential',
      description: checklistGuide,
      parameters: ChecklistParameters,
      execute: async (_id, p, signal): Promise<{ content: { type: 'text'; text: string }[]; details: unknown; isError?: boolean; terminate?: boolean }> => {
        if (p.action === 'help') return { content: [{ type: 'text', text: checklistGuide }], details: { guide: checklistGuide } };
        if (!this.active || !this.store) return { content: [{ type: 'text', text: 'Activate with /researcher, or send a new instruction after interruption.' }], details: {}, isError: true };
        try {
          if (p.action === 'accept' && this.moduleSettings().interactionMode === 'review') {
            const c = this.store.read();
            if (!c || c.revision !== p.expectedRevision || currentModule(c)?.id !== p.moduleId)
              throw new Error('Checklist changed before approval; read the latest revision first.');
            const m = currentModule(c)!;
            const approved = await this.ui?.confirm(`阶段验收：${m.id}`, `${m.objective}\n\n${m.criteria.join('\n')}\n\n确认验收本阶段并继续？`, { signal });
            if (!this.active || (!approved && this.moduleSettings().interactionMode === 'review')) {
              if (this.active) await this.pause('阶段验收已暂缓，等待用户继续', 'paused', false);
              return { content: [{ type: 'text', text: '阶段验收已暂缓，保留当前成果。' }], details: this.state(), terminate: true };
            }
          }
          applyChecklistAction(this.store, p.action === 'init' && !p.objective ? { ...p, objective: this.pending.join('\n') } : p);
          if (p.action !== 'read') this.checklistFailure = undefined;
          const payload = this.state();
          return { content: [{ type: 'text', text: JSON.stringify(payload) }], details: payload };
        } catch (error) {
          const details = checklistRecovery(this.store, error, p);
          const { reason: _reason, title: _title, ...argumentsWithoutReason } = p;
          const key = JSON.stringify([Object.keys(argumentsWithoutReason).sort().map(k => [k, argumentsWithoutReason[k as keyof typeof argumentsWithoutReason]]), details.error, details.recovery.currentRevision]);
          const count = this.checklistFailure?.key === key ? this.checklistFailure.count + 1 : 1;
          this.checklistFailure = { key, count };
          if (count >= 3) this.checklistFailurePause = 'Repeated checklist failure (3 identical attempts). Research paused; inspect recovery details and correct arguments before resuming.';
          Object.assign(details.recovery, { repeatedAttempts: count, pauseAfterTurn: Boolean(this.checklistFailurePause) });
          return { content: [{ type: 'text', text: JSON.stringify(details) }], details, isError: true };
        }
      },
    });
  }
}
