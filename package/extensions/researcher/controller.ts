import { randomUUID } from 'node:crypto';
import { Value } from 'typebox/value';
import { JobParameters, jobGuide } from './job-tool.ts';
import { scopeBash } from "./boundaries.ts";
import { mkdirSync, readFileSync } from 'node:fs';
import { ChecklistParameters, applyChecklistAction, checklistGuide, checklistRecovery } from './checklist-tool.ts';
import { moduleResources } from './modules.ts';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { ChecklistStore, checklistState, currentModule, requireCurrentModule } from './checklist.ts';
import { acquireOwnerLock, atomicWrite } from './store.ts';
import type { ResearchRunner } from './runner.ts';

export const managerPrompt = `You are the research manager responsible for the entire goal, evidence, budget and acceptance. checklist.json is the authoritative control state; BRIEF.md explains the goal and STATE.md records synthesis. Use research_checklist to initialize, plan, revise and accept modules. Never edit control files directly, including via Bash. Modules MUST execute in checklist array order. Only currentModule may start, execute, delegate or be accepted; blocked modules cannot be silently bypassed. Use research_checklist start before execution. The current module SKILL.md contents are injected into every request: follow them. Skills are instruction documents, not tool names. Prefer existing evidence and small direct tasks; delegate bounded tasks with moduleId. Child completion is only a handoff: verify evidence against every criterion before acceptance. Record negative findings honestly. Resolve each pending user instruction, revising the objective when necessary. Work and download only within the research root; configure temporary files and caches there. Do not claim completion while the checklist is unfinished. Use research_job for long downloads/training: start returns a job ID immediately, then finish your response to wait without polling. Call research_job wait alone in a tool batch after resolving pending instructions: it ends the model run normally and can schedule one timed check. Pause/Escape preserves background jobs; stop cancels them. Answer new user input while jobs run. Inspect exit status and real artifacts before accepting; process success is not module acceptance. Mark genuinely blocked modules with reasons rather than looping without evidence.`;
export class ResearchController {
  store?: ChecklistStore;
  private release?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private last = '';
  private stagnant = 0;
  private continuations = 0;
  private enabled = false;
  private activeMs = 0;
  private activeSince?: number;
  private modelTurns = 0;
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
  private elapsed() { return this.activeMs + (this.activeSince === undefined ? 0 : Date.now() - this.activeSince); }
  private startClock(ctx: ExtensionContext) {
    if (!this.active || this.activeSince !== undefined) return;
    this.activeSince = Date.now();
    this.timer = setTimeout(() => { void this.pause('Research active time budget exhausted'); void ctx.abort(); }, Math.max(0, 30 * 60_000 - this.activeMs));
  }
  private stopClock() {
    this.activeMs = this.elapsed(); this.activeSince = undefined; clearTimeout(this.timer);
  }
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
    clearTimeout(this.wakeTimer); this.stopClock(); this.showSkills([]);
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
      this.waiting = false; this.waitRequested = false; this.wakeAt = undefined;
      this.observedJobs.clear();
      this.refreshJobs(true);
      clearInterval(this.jobTimer);
      this.jobTimer = setInterval(() => this.refreshJobs(), 2000);
      this.resumeOnInput = false;
      this.last = ''; this.stagnant = 0; this.continuations = 0; this.activeMs = 0; this.activeSince = undefined; this.modelTurns = 0;
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
      if (this.elapsed() >= 30 * 60_000 || this.modelTurns >= 100 || this.continuations >= 20) { void this.pause('Research wake budget exhausted'); return; }
      try {
        if (this.wakeAt !== undefined && Date.now() >= this.wakeAt && this.waitId) {
          const c = this.store!.read()!;
          this.store!.files.recordEvent({ id: `timer:${this.waitId}`, type: 'timer', time: Date.now(), researchId: c.researchId, objectiveRevision: c.objectiveRevision, waitId: this.waitId, summary: 'Scheduled research check' });
        }
        const events = this.pendingEvents();
        const reason = events.map(e => e.summary).join('; ');
        const timerIds = events.filter(e => e.type === 'timer').map(e => e.id);
        // Preserve a fired timer for the next request after retiring the wait.
        this.requestEvents = timerIds;
        this.leaveWaiting(reason);
        this.continuations++;
        this.store!.change('Wake research: ' + reason, c => { c.control.continuations = this.continuations; });
        this.pi.sendMessage({ customType: 'research-wake', content: `${reason}. Inspect latest research checkpoint and job status. Verify artifacts before acceptance; wait again if work is still running.`, display: false }, { triggerTurn: true });
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
      try { skillInstructions.push({ name, instructions: this.readSkill(path) }); }
      catch (error) {
        // The UI exposes names and a clear failure, never resource paths or contents.
        const code = (error as NodeJS.ErrnoException).code ?? 'unreadable';
        skillErrors.push({ name, error: `SKILL LOAD FAILED (${code}); restore the Skill resource and retry. Checklist repair is not required.` });
        ctx?.ui.notify(`Cannot load Skill ${name} (${code})`, 'error');
      }
    }
    this.showSkills(skillInstructions.map(s => s.name));
    return JSON.stringify({ root: this.store?.files.root, ...state, ...(this.requestEvents.length ? { events: this.store?.files.events().filter(e => this.requestEvents.includes(e.id)) } : {}), skillInstructions, ...(skillErrors.length ? { skillErrors } : {}) });
  }
  private settlement(outcome: string) {
    if (outcome !== 'completed') return { state: 'paused' as const, reason: 'Agent error or abort' };
    try {
      this.flush();
      const c = this.store!.read();
      if (c && !this.pending.length && this.store!.complete(c)) return { state: 'completed' as const, reason: 'All modules accepted' };
      if (this.elapsed() >= 30 * 60_000 || this.modelTurns >= 100 || this.continuations >= 20) return { state: 'paused' as const, reason: 'Research continuation budget exhausted' };
      const unresolved = this.pending.length || c?.control.instructions.some(i => !i.resolution);
      if (!unresolved && !this.pendingEvents().length && (this.waitRequested || this.store!.files.jobs().some(j => j.status === 'running'))) {
        return { state: 'waiting' as const, reason: 'Waiting for managed jobs or scheduled check' };
      }
      const fingerprint = c ? this.store!.fingerprint(c) : 'missing';
      this.stagnant = fingerprint === this.last ? this.stagnant + 1 : 0;
      this.last = fingerprint;
      if (this.stagnant >= 3) return { state: 'paused' as const, reason: 'No progress or continuation budget exhausted' };
      if (c?.modules.length && !this.pending.length && !c.control.instructions.some(i => !i.resolution) && currentModule(c)?.status === 'blocked') return { state: 'paused' as const, reason: 'Remaining work blocked; inspect checklist' };
      return { state: 'continue' as const, reason: 'Continue unfinished research', checklist: c };
    } catch {
      return this.continuations >= 3 ? { state: 'paused' as const, reason: 'Checklist repair failed' }
        : { state: 'continue' as const, reason: 'Continue checklist repair' };
    }
  }
  bind() {
    const pi = this.pi;
    pi.on('agent_start', (_event, ctx) => { this.busy = true; this.context = ctx; this.startClock(ctx); });
    pi.on('turn_start', (_event, ctx) => {
      if (!this.active) return;
      if (++this.modelTurns > 100) { void this.pause('Research model turn budget exhausted'); void ctx.abort(); }
    });
    pi.on('turn_end', event => {
      if (event.outcome === 'completed' && this.release) {
        try { this.store?.files.acknowledgeEvents(this.requestEvents); this.requestEvents = []; }
        catch (error) { this.ui?.notify(`Event acknowledgement failed: ${String(error)}`, 'error'); void this.pause('Event acknowledgement failed'); }
      }
    });
    pi.on('before_agent_start', (event, ctx) => { this.context = ctx; this.startClock(ctx); return this.active ? { systemPrompt: event.systemPrompt + '\n\n' + managerPrompt } : undefined; });
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
      if (!this.active || !this.store) {
        if (this.release || this.pausing) return { block: true, reason: 'Research execution is paused or stopping' };
        return;
      }
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
        if ((!c || !c.modules.length) && !['read', 'grep', 'find', 'ls', 'research_checklist'].includes(event.toolName)) return { block: true, reason: 'Initialize and plan checklist before research execution' };
        if (c && c.modules.length && !['read', 'grep', 'find', 'ls', 'research_checklist'].includes(event.toolName)) {
          const m = currentModule(c);
          if (!m || !['running', 'awaiting_acceptance'].includes(m.status)) return { block: true, reason: `Start current module ${m?.id ?? 'none'} using research_checklist before execution` };
          requireCurrentModule(c, m.id);
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
      return { entries: [...event.entries, { type: 'custom_message' as const, customType: 'research-continue', content: 'Research is unfinished. Check the current checklist, resolve pending instructions, and perform the next bounded action; mark blocked work honestly.', display: false }], continue: true };
    });
    pi.on('agent_settled', async (event, ctx) => {
      this.busy = false; this.context = ctx; this.stopClock();
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
      execute: async (_id, p): Promise<{ content: { type: 'text'; text: string }[]; details: unknown; isError?: boolean }> => {
        if (p.action === 'help') return { content: [{ type: 'text', text: checklistGuide }], details: { guide: checklistGuide } };
        if (!this.active || !this.store) return { content: [{ type: 'text', text: 'Activate with /researcher, or send a new instruction after interruption.' }], details: {}, isError: true };
        try {
          applyChecklistAction(this.store, p.action === 'init' && !p.objective ? { ...p, objective: this.pending.join('\n') } : p);
          const payload = this.state();
          return { content: [{ type: 'text', text: JSON.stringify(payload) }], details: payload };
        } catch (error) {
          const details = checklistRecovery(this.store, error);
          return { content: [{ type: 'text', text: JSON.stringify(details) }], details, isError: true };
        }
      },
    });
  }
}
