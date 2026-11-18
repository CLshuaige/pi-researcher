import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Value } from 'typebox/value';
import { JobParameters, jobGuide } from './job-tool.ts';
import { ToolRepetitionGuard, reportHandoff, scopeBash, followupBoundary } from "./boundaries.ts";
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { ChecklistParameters, applyChecklistAction, checklistGuide, checklistRecovery, type ChecklistArguments } from './checklist-tool.ts';
import { moduleResources } from './modules.ts';
import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from '@earendil-works/pi-coding-agent';
import { ChecklistStore, checklistState, currentModule, requireCurrentModule } from './checklist.ts';
import { acquireOwnerLock, atomicWrite, workspacePath } from './store.ts';
import type { ResearchRunner } from './runner.ts';
import { normalizeRoleDelegation } from './delegation.ts';
import { parseWorkflowResults, type WorkflowResults } from '../shared/subagent-results.ts';

export const managerPrompt = `New input does not always require another full scientific workflow. With no planned modules, a conversational question may finish through resolve(response); a real research request still requires planning and execution. Read-only questions can be answered from project materials and resolved with response; no stage execution is needed. Requests to save analysis or modify completed work require research_checklist(action: followup), bound to the actual instructionId and target moduleId. Use kind=analysis for supplementary findings without changing the accepted method; use kind=revision when updating the formal method/report or another accepted stage. Read the returned new module ID and followup.outputDir, then start it. Work only on the user's requested scope, reuse prior evidence, do not redo a whole Skill workflow unnecessarily, and never rerun downstream experiments/reports without authorization. New artifacts stay in outputDir; prior accepted artifacts are read-only. Before using a stage's outputs, consult versions/currentVersionId rather than assuming its old fixed path is current. Followup acceptance verifies delivery and automatically resolves its bound instruction. Never resolve an artifact request merely in prose, or claim a blocked write succeeded. needsReview records downstream applicability concerns, not authorization to execute them.

Use the latest research-checkpoint or tool result as the current state, not an older transcript result. Initialize only if initialized=false; create an initial plan only if no modules exist; otherwise preserve progress and change only the requested scope through the existing protocol. Start only a pending currentModule. Repeated init preserves existing state and cannot change the goal. Checklist stages accept only the stage skills listed in research_checklist, never internal -single skills. If a new message explicitly replaces the goal, handle the change through resolve; if it supplements constraints, retain the earlier requirements. When unrelated goals are ambiguous, use the configured interaction mode to clarify with ask_user (allowed before planning) or record a reasonable default. Resolve the relevant instruction IDs; never restart initialization or silently discard earlier instructions.

You are the research manager responsible for the entire goal, evidence, budget and acceptance. checklist.json is the authoritative control state; BRIEF.md explains the goal and STATE.md records synthesis. Use research_checklist to initialize, plan, revise and accept modules. Give calls a short Chinese title (at most 12 characters) describing the action; execution status is determined by the program, and reason retains its audit/resolution purpose. Never edit control files directly, including via Bash. Initial modules MUST execute in checklist array order; explicitly registered followups temporarily take precedence as currentModule. Only currentModule may start, execute, delegate or be accepted; blocked modules cannot be silently bypassed. Use research_checklist start before execution. The current module execution instructions are injected into every request: follow them. For specialist stages the parent receives routing instructions and the child reads its own mounted SKILL.md. Skills are instruction documents, not tool names. Module settings remain editable throughout the research. First start a pending Checklist module; before executing, restarting or resuming its actual work, read and validate the latest project .pi/research-modules.json using research-task/scripts/check-settings.mjs; pass freshly validated settings and the project root to any child. Historical task text, outputs and configuration snapshots do not override settings saved later. Record the effective settings used by each run. There is no default runtime or model-request budget. Do not invent timeoutMs, maxRuntimeMs, toolTimeoutMs, timeoutSeconds or shell time limits; supply them only when the user explicitly authorizes such a limit. New settings apply at the next execution boundary; do not claim an already running command changed its launch parameters. Prefer existing evidence and small direct tasks; delegate bounded tasks with moduleId. Child completion is only a handoff: verify evidence against every criterion before acceptance. In review mode, submit research_checklist accept with the verified evidence and acceptance arrays; the host presents the stage approval in the Checklist dock and waits for the user. Do not ask for a second stage approval through ask_user. Record negative findings honestly. Resolve each pending user instruction, revising the objective when necessary. Work and download only within the research root; configure temporary files and caches there. Do not claim completion while the checklist is unfinished. Use research_job for long downloads/training: start returns a job ID immediately, then finish your response to wait without polling. Call research_job wait alone in a tool batch after resolving pending instructions: it ends the model run normally and can schedule one timed check. Pause/Escape preserves background jobs; stop cancels them. Answer new user input while jobs run. Inspect exit status and real artifacts before accepting; process success is not module acceptance. Mark genuinely blocked modules with reasons rather than looping without evidence. After a Checklist error, prioritize checklistRecovery in the next checkpoint: correct the actual tool arguments, not only narrative text. Read/help alone do not resolve the error. Never accept a child suggestion without verifying its evidence.`;
// Routing belongs to the parent. The specialist reads its own mounted skill.
const specialistNames = ['research-literature', 'research-experiment', 'research-report'] as const;
const specialistRouting = (name: string) => `When the current module declares ${name}, first call research_checklist(action: start, moduleId: currentModule.id) if its status is pending; only then validate settings, discover agents and delegate its work through pi-subagents to the registered ${name} agent with its own mounted skill. This project instruction authorizes delegation. Enable subagents_enable if needed and discover the canonical agent name once with subagent(action: list). If unavailable, report the blocker. Use {"agent":"${name}","task":"bounded goal, relevant materials, current config, output location and every acceptance criterion","cwd":"/absolute/project","async":true,"output":false,"options":{"context":"fresh","outputMode":"inline"}}. output is TOP LEVEL. The project root is the material root, not the plugin transcript or output directory. Pass actual existing input paths as hints, not an exhaustive allowlist; the child must discover and read relevant project files, including ignored materials. Read and validate the latest .pi/research-modules.json before launch or resume. Do not substitute research_delegate, a generic agent or parent-side stage execution. After launching asynchronously, stop generating text; do not poll status, call research_job wait or simulate waiting. Native completion automatically wakes the parent. Inspect a failed/partial handoff once and resume the same run with bounded remaining work and existing artifacts; if recovery cannot proceed, block the module with its reason. The parent owns Checklist acceptance, reads the actual files and verifies EVERY criterion; child completion and process success are not acceptance. The report child loop-guard state .research/report-handoff.json, when blocked, is a partial handoff, never successful completion. Do not delegate recursively from inside a specialist. Routing applies only to the current Checklist module: importing shared report Python helpers from literature work never delegates to the report agent.`;
const specialistDeliverables = (name: string, outputDir?: string) => outputDir
  ? `本次是局部后续任务，所有新产物只写入 ${outputDir}；该目录覆盖 Skill 的默认交付目录。旧版本、原始数据和实验结果只读。以本次目标和标准为限复用已有材料，不重新初始化整套流程。`
  : name === 'research-literature'
  ? 'literature.md 和 literature/ 位于项目根目录下；先保存已核实的 literature.md 和 literature/papers.jsonl，再按配置完成可选综述'
  : name === 'research-experiment'
    ? '实验代码、环境与运行记录放在 experiment/，结论写入 result.md，按配置执行有界优化并核验目标'
    : '默认报告输出为项目根目录下 report/；调用方明确指定其他项目内输出目录时遵循该目录。材料根目录始终是项目根目录，可自主发现和读取其中相关文件（包括 Git 忽略的材料），输入提示不是白名单。核验已有正文、引用库和编译状态后只续写或修复未完成部分，不重新初始化已有报告。不得修改实验数据、重做实验或代替主流程验收 Checklist；交付源码、证据索引、真实 PDF 及编译状态，不能把旧 PDF 当成本次成功';
export class ResearchController {
  store?: ChecklistStore;
  private release?: () => void;
  private last = '';
  private stagnant = 0;
  private continuations = 0;
  private enabled = false;
  private checklistFailure?: { key: string; count: number };
  private checklistFailurePause?: string;
  private checklistRecoveryState?: ReturnType<typeof checklistRecovery>;
  private checklistFailedArguments?: ChecklistArguments;
  private checklistCalls = new Map<string, ChecklistArguments>();
  private toolGuard = new ToolRepetitionGuard(true);
  private recentSavedFiles: { moduleId: string; path: string }[] = [];
  private answerRevision?: number;
  private repetitionPause?: string;
  private turnSeq = 0;
  private repetitionCorrection?: { progress: string; blockedTurn: number; promptSent: boolean; reason: string };
  private delegationFailures = 0;
  private delegationQueries = 0;
  private discoveredSpecialists = new Set<string>();
  private asyncDelegations = new Set<string>();
  private roleRequests = new Map<string, unknown[]>();
  private terminalSubagents = new Map<string, { state: string; error?: string; workflow?: WorkflowResults }>();
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
  private resetRepetition() {
    this.toolGuard.reset(); this.repetitionCorrection = undefined; this.repetitionPause = undefined; this.stagnant = 0;
  }
  private clearCorrection() { this.repetitionCorrection = undefined; this.repetitionPause = undefined; }
  private hasActiveWait() {
    if (this.asyncDelegations.size || this.store?.files.jobs().some(job => job.status === 'running')) return true;
    return this.waitRequested && !(this.store?.files.events().some(event => !event.delivered && (event.type === 'job' || event.waitId === this.waitId)) ?? false);
  }
  private repetitionReason(module: ReturnType<typeof currentModule>, count: number) {
    const jobs = this.store?.files.jobs().filter(job => job.status === 'running').map(job => job.id) ?? [];
    const activeRuns = [...this.asyncDelegations];
    const priorRuns = [...this.terminalSubagents].map(([id, value]) => ({ id, state: value.state }));
    const files = this.recentSavedFiles.filter(file => file.moduleId === module?.id && existsSync(file.path) && statSync(file.path).isFile()).map(file => file.path);
    return `相同工具输入已连续得到相同结果 ${count} 次且没有进展。当前阶段：${module?.id ?? '未知'} ${module?.objective ?? ''}；验收标准：${JSON.stringify(module?.criteria ?? [])}；运行中的子代理：${JSON.stringify(activeRuns)}；运行中的托管任务：${JSON.stringify(jobs)}；已结束子代理：${JSON.stringify(priorRuns)}；本模块最近保存文件：${JSON.stringify(files)}（未跟踪的角色不推断）。请核对当前标准和已有证据，改变下一步策略或说明具体阻塞。`;
  }
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
      this.asyncDelegations.clear(); this.roleRequests.clear(); this.terminalSubagents.clear(); this.statusQueries.clear();
      for (const entry of ctx.sessionManager?.getBranch() ?? []) {
        if (entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'subagent') {
          const details = entry.message.details as { asyncId?: string; asyncDir?: string } | undefined;
          if (!entry.message.isError && details?.asyncId) {
            let terminal = false;
            if (details.asyncDir) try {
              const status = JSON.parse(readFileSync(join(details.asyncDir, 'status.json'), 'utf8'));
              terminal = status.runId === details.asyncId && ['complete', 'failed', 'partial', 'paused', 'stopped', 'cancelled'].includes(status.state);
              if (terminal) {
                const resultPath = status.mode === 'workflow' || status.workflowChildren ? join(details.asyncDir, 'workflow-result.json') : undefined;
                const result = resultPath && existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : status;
                const workflow = parseWorkflowResults(result.runId === details.asyncId ? result : status, [], path => this.artifactExists(path));
                this.terminalSubagents.set(details.asyncId, { state: workflow?.status || status.state, error: status.error, ...(workflow ? { workflow } : {}) });
              }
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
      this.checklistRecoveryState = undefined; this.checklistFailedArguments = undefined; this.checklistCalls.clear();
      this.resetRepetition();
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
    this.resetRepetition();
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
        const previousStatus = this.observedJobs.get(job.id);
        if (previousStatus !== job.status && (previousStatus !== undefined || job.status === 'running')) this.resetRepetition();
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
  private repetitionContext(checklist: NonNullable<ReturnType<ChecklistStore['read']>>) {
    const module = currentModule(checklist);
    return [checklist.objectiveRevision, module?.id, module?.status, module?.objective, module?.criteria, this.moduleSettings()];
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
      try { skillInstructions.push({ name, instructions: specialistNames.some(specialist => specialist === name) ? specialistRouting(name) : this.readSkill(path) }); }
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
    const recentSavedFiles = this.recentSavedFiles.filter(file => file.moduleId === state.currentModule?.id && existsSync(file.path)).map(file => file.path);
    let recovery = this.checklistRecoveryState && checklistRecovery(this.store!, this.checklistRecoveryState.error, this.checklistFailedArguments);
    if (recovery?.recovery.required === false) {
      this.clearStartRecovery(this.checklistFailedArguments!);
      recovery = undefined;
    }
    if (recovery) state.nextAction = 'Correct the failed Checklist call using checklistRecovery; read/help do not resolve it.';
    return JSON.stringify({ ...(this.discoveredSpecialists.size ? { availableSpecialists: [...this.discoveredSpecialists], delegationInstruction: 'These canonical specialist agents were already discovered successfully. Do not list them again. Check prior handoffs before launching work; delegate only the remaining task for the current module with its project root and acceptance criteria.' } : {}), ...(recentSavedFiles.length ? { recentSavedFiles, artifactInstruction: 'These files were already saved successfully for the current module. Read and verify them against criteria, then accept when satisfied; do not recreate completed deliverables merely because the module is still running.' } : {}), ...(recovery ? { checklistRecovery: { ...recovery.recovery, repeatedAttempts: this.checklistFailure?.count } } : {}), ...(this.terminalSubagents.size ? { priorSubagents: Object.fromEntries(this.terminalSubagents), recoveryInstruction: "These runs have already ended. Do not redelegate unchanged completed work. Read and verify delivered evidence against each criterion, then accept when satisfied. Resume a failed/partial specialist run only for bounded remaining work. Do not wait for ended runs or repeat status queries." } : {}), ...(this.asyncDelegations.size ? { activeSubagents: [...this.asyncDelegations], instruction: "Child agents are running. End this turn and wait for the native completion notification; do not poll or relaunch." } : {}), moduleSettings, root: this.store?.files.root, ...state, ...(this.requestEvents.length ? { events: this.store?.files.events().filter(e => this.requestEvents.includes(e.id)) } : {}), skillInstructions, ...(skillErrors.length ? { skillErrors } : {}) });
  }
  private settlement(outcome: string, deferRepetition = false) {
    if (outcome !== 'completed') return { state: 'paused' as const, reason: 'Agent error or abort' };
    try {
      this.flush();
      const c = this.store!.read();
      if (c) {
        this.toolGuard.refresh(this.store!.files.root, this.repetitionContext(c));
        if (this.repetitionCorrection && this.toolGuard.epoch !== this.repetitionCorrection.progress) this.clearCorrection();
      }
      if (this.asyncDelegations.size || this.store!.files.jobs().some(j => j.status === 'running') || (this.waitRequested && !this.pendingEvents().length)) {
        return { state: 'waiting' as const, reason: 'Waiting for child agents, managed jobs or scheduled check' };
      }
      if (c && !this.pending.length && this.store!.complete(c)) return { state: 'completed' as const, reason: 'All modules accepted' };
      if (c && this.answerRevision === c.revision && !this.pending.length && !c.control.instructions.some(i => !i.resolution) && !this.asyncDelegations.size && !this.store!.files.activeWork().length) return { state: 'paused' as const, reason: 'Read-only answer finished; remaining research preserved' };
      const unresolved = this.pending.length || c?.control.instructions.some(i => !i.resolution && !i.followupModuleId && !i.planned);
      if (deferRepetition && this.repetitionCorrection) return { state: 'continue' as const, reason: 'Allow one repetition correction turn', checklist: c };
      const fingerprint = c ? this.store!.fingerprint(c) : 'missing';
      this.stagnant = fingerprint === this.last ? this.stagnant + 1 : 0;
      this.last = fingerprint;
      if (this.stagnant >= 3) return { state: 'paused' as const, reason: 'No checklist progress across repeated continuations' };
      if (c?.modules.length && !unresolved && currentModule(c)?.status === 'blocked') return { state: 'paused' as const, reason: 'Remaining work blocked; inspect checklist' };
      return { state: 'continue' as const, reason: 'Continue unfinished research', checklist: c };
    } catch {
      return this.continuations >= 3 ? { state: 'paused' as const, reason: 'Checklist repair failed' }
        : { state: 'continue' as const, reason: 'Continue checklist repair' };
    }
  }
  private observeToolResult(event: ToolResultEvent) {
    if (!this.store || ['research_checklist', 'research_job', 'subagent', 'bg_wait'].includes(event.toolName)) return;
    const checklist = this.store.read();
    if (!checklist) return;
    const module = currentModule(checklist);
    if (!module) return;
    const observed = this.toolGuard.observe(this.store.files.root, event, this.repetitionContext(checklist));
    if (this.repetitionCorrection && this.toolGuard.epoch !== this.repetitionCorrection.progress) this.clearCorrection();
    if (observed?.blocked) {
      if (this.hasActiveWait()) {
        return { ...observed.result, content: [...event.content, { type: 'text' as const, text: '当前有子代理或托管任务正在运行。保持已有等待，不要重复此调用或结束任务；本轮结束并等待任务完成通知。' }] };
      }
      if (observed.progress) {
        const reason = this.repetitionReason(module, 4);
        if (this.repetitionCorrection?.progress === observed.progress && this.turnSeq > this.repetitionCorrection.blockedTurn) this.repetitionPause = reason;
        else if (!this.repetitionCorrection || this.repetitionCorrection.progress !== observed.progress) this.repetitionCorrection = { progress: observed.progress, blockedTurn: this.turnSeq, promptSent: false, reason };
        return { ...observed.result, content: [...event.content, { type: 'text' as const, text: reason }] };
      }
    }
    return observed?.result;
  }

  private checklistError(error: unknown, p: ChecklistArguments) {
    // Keep validation diagnostics, without echoing a potentially huge bad call.
    const summary = String(error).split('\n\nReceived arguments:')[0];
    const details = checklistRecovery(this.store!, summary, p);
    if (details.recovery.required === false) {
      this.clearStartRecovery(p);
      return details;
    }
    const { reason: _reason, title: _title, ...argumentsWithoutReason } = p;
    // SDK validation errors include the original arguments, including display text.
    // Compare semantic arguments so changing a title/reason cannot hide the loop.
    const failure = Value.Check(ChecklistParameters, p) ? details.error : 'Invalid Checklist parameters';
    const key = JSON.stringify([Object.keys(argumentsWithoutReason).sort().map(k => [k, argumentsWithoutReason[k as keyof typeof argumentsWithoutReason]]), failure, details.recovery.currentRevision]);
    const count = this.checklistFailure?.key === key ? this.checklistFailure.count + 1 : 1;
    this.checklistFailure = { key, count };
    if (count >= 3) this.checklistFailurePause = 'Repeated checklist failure (3 identical attempts). Research paused; inspect recovery details and correct arguments before resuming.';
    Object.assign(details.recovery, { repeatedAttempts: count, pauseAfterTurn: Boolean(this.checklistFailurePause) });
    this.checklistRecoveryState = details; this.checklistFailedArguments = p;
    return details;
  }
  private clearStartRecovery(p: ChecklistArguments) {
    const failed = this.checklistFailedArguments;
    if (failed?.action !== 'start' || p.action !== 'start' || failed.moduleId !== p.moduleId || failed.expectedRevision !== p.expectedRevision) return;
    this.checklistFailure = undefined;
    this.checklistFailurePause = undefined;
    this.checklistRecoveryState = undefined;
    this.checklistFailedArguments = undefined;
  }
  private artifactExists(path: string) {
    try { return !!this.store && statSync(workspacePath(this.store.files.root, path)).isFile(); }
    catch { return false; }
  }
  bind() {
    const pi = this.pi;
    pi.on('session_start', (_event, ctx) => {
      const marker = ctx.sessionManager.getBranch().filter(entry =>
        entry.type === 'custom' && entry.customType === 'research-host-resume',
      ).at(-1);
      if (marker?.type === 'custom' && (marker.data as { pending?: boolean })?.pending) {
        // Restore the manager before the subagent plugin delivers retained
        // completion notifications during session_start.
        this.activate(ctx);
        pi.appendEntry('research-host-resume', { pending: false });
      }
    });
    // The plugin owns result delivery and wakeup; the manager only tracks its work.
    pi.events?.on('subagent:async-started', data => {
      const event = data as { id?: string; sessionId?: string };
      if (event.id && event.sessionId === this.context?.sessionManager.getSessionId() && !this.asyncDelegations.has(event.id)) {
        this.resetRepetition(); this.asyncDelegations.add(event.id);
      }
    });
    pi.events?.on('subagent:async-complete', data => {
      const event = data as { runId?: string; id?: string; state?: string; error?: string };
      const id = event.runId || event.id || '';
      const owned = this.asyncDelegations.delete(id);
      if (owned) this.resetRepetition();
      const workflow = owned ? parseWorkflowResults(data, this.roleRequests.get(id), path => this.artifactExists(path)) : undefined;
      this.roleRequests.delete(id);
      if (owned && (workflow || event.state && ['complete', 'completed', 'failed', 'partial', 'paused', 'stopped', 'cancelled'].includes(event.state))) {
        this.terminalSubagents.set(id, { state: workflow?.status || event.state!, ...(typeof event.error === 'string' ? { error: event.error } : {}), ...(workflow ? { workflow } : {}) });
        if (this.terminalSubagents.size > 12) this.terminalSubagents.delete(this.terminalSubagents.keys().next().value!);
      }
      if (owned && this.active && this.waiting && !this.asyncDelegations.size && !this.waitRequested && !this.store?.files.jobs().some(j => j.status === 'running')) this.leaveWaiting('Child agent result delivered');
    });
    // Core schema failures happen before tool_call/execute/tool_result. Recover
    // them at message_end, before the result is persisted and sent to the model.
    pi.on('message_end', event => {
      if (!this.active || !this.store) return;
      const message = event.message;
      if (message.role === 'assistant') {
        for (const block of message.content) if (block.type === 'toolCall' && block.name === 'research_checklist') {
          if (this.checklistCalls.size >= 32) this.checklistCalls.delete(this.checklistCalls.keys().next().value!);
          this.checklistCalls.set(block.id, (block.arguments && typeof block.arguments === 'object' && !Array.isArray(block.arguments) ? block.arguments : {}) as ChecklistArguments);
        }
      } else if (message.role === 'toolResult' && message.toolName === 'research_checklist') {
        const attempted = this.checklistCalls.get(message.toolCallId);
        this.checklistCalls.delete(message.toolCallId);
        const recovery = (message.details as { recovery?: { required?: boolean; repeatedAttempts?: number } } | undefined)?.recovery;
        if (!message.isError || !attempted || recovery?.required === false || recovery?.repeatedAttempts) return;
        const error = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
        const details = this.checklistError(error, attempted);
        const text = JSON.stringify(details);
        return { message: { ...message, content: [{ type: 'text' as const, text }], details: JSON.parse(text) } };
      }
    });
    pi.on('agent_start', (_event, ctx) => { this.busy = true; this.context = ctx; });
    pi.on('turn_start', () => { this.turnSeq++; });
    pi.on('turn_end', event => {
      if (this.active && this.repetitionPause && this.hasActiveWait()) this.clearCorrection();
      if ((this.checklistFailurePause || this.delegationFailurePause || this.repetitionPause) && this.active) {
        const reason = this.checklistFailurePause || this.delegationFailurePause || this.repetitionPause!;
        this.repetitionPause = undefined;
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
      return this.active ? { systemPrompt: event.systemPrompt + '\n\n' + managerPrompt } : undefined;
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
      if (this.checklistFailurePause || this.delegationFailurePause || this.repetitionPause) return { block: true, reason: this.repetitionPause || this.delegationFailurePause || this.checklistFailurePause };
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
        if(event.toolName==='research_checklist' && event.input.action==='followup') {
          const entry=ctx.sessionManager.getBranch().findLast(entry=>entry.type==='message'&&entry.message.role==='assistant');
          if(entry?.type==='message' && entry.message.role==='assistant' && entry.message.content.filter(part=>part.type==='toolCall').length!==1) return {block:true,reason:'Create a followup in a separate tool call before executing or delegating work.'};
        }
        const c = this.store.read();
        if (event.toolName === 'research_checklist' && event.input.action === 'accept' && c) {
          const module = currentModule(c);
          if (module?.skills.includes('research-report')) {
            const handoff = reportHandoff(this.store.files.root);
            if (handoff && ['blocked', 'partial', 'running'].includes(handoff.status)) return { block: true, reason: `报告子代理仅交接了部分成果：${handoff.reason}。恢复原运行并修复后再验收。` };
          }
        }
        const jobManagement = event.toolName === 'research_job' && (event.input as { action?: string }).action !== 'start';
        if (jobManagement || event.toolName === 'ask_user') return;
        if ((!c || !c.modules.length) && !['read', 'grep', 'find', 'ls', 'research_checklist'].includes(event.toolName)) return {
          block: true,
          reason: !c
            ? 'Checklist is not initialized. Call research_checklist(action: "init", objective), then use the returned revision to plan modules. Necessary read/grep/find/ls and ask_user clarification are allowed before planning.'
            : `Checklist is already initialized at revision ${c.revision}; no modules are planned. Do not call init again. Clarify the goal with ask_user if needed, then call research_checklist(action: "plan", expectedRevision: ${c.revision}, reason, modules: [...]). Read-only questions may use resolve(response) instead. Command execution, writing and delegation require a planned, started module.`,
        };
        if (c && c.modules.length && !['read', 'grep', 'find', 'ls', 'research_checklist'].includes(event.toolName) && !(!currentModule(c) && ['web_search','academic_search','fetch_content','get_search_content','paper_lookup','paper_citations'].includes(event.toolName))) {
          const m = currentModule(c);
          if (!m) {
            if(['write','edit'].includes(event.toolName)) this.store.change('Artifact delivery requires a followup',value=>{const instruction=value.control.instructions.findLast(i=>!i.resolution);if(instruction)instruction.requiresArtifact=true;});
            return {block:true,reason:'Research is complete. Answer read-only questions with resolve(response). To write artifacts, first call research_checklist(action: "followup", instructionId, moduleId: target stage, kind, objective, criteria), then start the returned currentModule.id.'};
          }
          if (!['running', 'awaiting_acceptance'].includes(m.status)) return {block:true,reason: m.status === 'pending'
            ? `Checklist revision ${c.revision}; currentModule ${m.id} is pending. Call research_checklist(action: "start", expectedRevision: ${c.revision}, moduleId: "${m.id}", reason) before execution. Do not initialize or rebuild the existing plan.`
            : `Checklist revision ${c.revision}; currentModule ${m.id} is ${m.status}. Resolve its blocker or explicitly skip with a reason before execution; do not initialize or rebuild the existing plan.`};
          const boundary=followupBoundary(this.store.files.root,m,event.toolName,event.input);
          if(boundary)return {block:true,reason:boundary};
          requireCurrentModule(c, m.id);
          if (event.toolName === 'subagent' && m.skills.some(skill => skill === 'research-hypothesis' || skill === 'research-method'))
            normalizeRoleDelegation(this.store.files.root, m, event.input);
          if (event.toolName === 'subagent' && m.skills.some(skill => specialistNames.some(name => name === skill))) {
            const input = event.input as { agent?: string; task?: string; message?: string; cwd?: string; output?: unknown; workflow?: unknown; options?: Record<string, unknown>; action?: string };
            const specialist = specialistNames.find(name => m.skills.includes(name))!;
            const validator = join(dirname(moduleResources(['research-task']).skills[0]), 'scripts/check-settings.mjs');
            const projectContext = `本次版本上下文：${JSON.stringify(checklistState(c).versions)}。${m.followup?`本次交付目录（覆盖默认路径）：${this.store.path(m.followup.outputDir)}；已有产物只读；不执行未授权的下游任务。`:""}当前节点：${m.id}；目标：${m.objective}；验收条件：${JSON.stringify(m.criteria)}。配置校验脚本（绝对路径）：${validator}；用 node 执行该脚本并传入 --workspace 和项目根目录，路径应正确引用。配置文件不存在时采用校验器给出的默认值，不反复读取不存在的文件。`;
            if (input.action === 'resume' || (!input.action && (input.agent || '').split(/[:/]/).at(-1) === specialist)) {
              // Temporarily disable activity-monitor notices: ordinary reading can
              // exceed the 60s idle window. Native completion/failure delivery stays on.
              input.options = { ...input.options, control: { enabled: false } };
            }
            if (input.action === 'resume') {
              if(m.followup && !m.taskIds.includes(String((input as {id?:string;runId?:string}).id || (input as {runId?:string}).runId || ''))) return {block:true,reason:'Do not resume a run from another version. Start a fresh revision run using previous artifacts as inputs.'};
              input.message = `${input.message || ''}\n${projectContext}\n恢复后的研究产物必须交付到项目根目录 ${this.store.files.root}，先读取该目录 .pi/research-modules.json 最新配置。若先前材料位于插件日志/会话目录，核验后复制需要的材料到项目目录，再继续未完成部分。${specialistDeliverables(specialist, m.followup && this.store.path(m.followup.outputDir))}；不要重复已完成工作或反复处理缺少的依赖。`;
            }
            if (!input.action && (input.agent || '').split(/[:/]/).at(-1) === specialist) {
              // A disabled optional workflow means an ordinary named-agent run.
              if (input.workflow === false) delete input.workflow;
              input.cwd = this.store.files.root;
              input.output = false;
              input.options = { ...input.options, context: 'fresh', outputMode: 'inline' };
              delete input.options.output;
              // Keep project deliverables outside the plugin's managed transcript directory.
              input.task = `${input.task || ''}\n${projectContext}项目根目录：${this.store.files.root}。先读取该目录 .pi/research-modules.json 的最新配置。所有研究产物写入此项目；插件的 session/artifact 目录仅用于日志，不能作为研究输出目录。${specialistDeliverables(specialist, m.followup && this.store.path(m.followup.outputDir))}；资源缺失时保留已完成内容并如实交接，不反复安装依赖。`;
            }
          }
          if (event.toolName === 'engine_start' && !m.skills.includes('research-experiment')) return { block: true, reason: 'Current module does not declare research-experiment' };
        }
        const current=c && currentModule(c);
        if(current?.followup && event.toolName==='subagent' && !(event.input as {action?:string}).action) {
          const request=event.input as {task?:string;cwd?:string;args?:{tasks?:{task?:string}[]}};
          const context=`\n项目材料根目录：${this.store.files.root}。本次修订所有新文件只写入 ${this.store.path(current.followup.outputDir)} 及其子目录，覆盖旧的默认输出位置；旧成果只读。${JSON.stringify(checklistState(c!).versions)}`;
          if (Array.isArray(request.args?.tasks)) {
            for (const task of request.args.tasks) task.task=`${task.task || ''}${context}`;
          } else request.task=`${request.task || ''}${context}`;
        }
        const input = event.input as { path?: string; outputDir?: string; command?: string };
        if (['write', 'edit'].includes(event.toolName)) {
          const p = this.store.path(input.path ?? '');
          if (p === this.store.path('checklist.json') || p.startsWith(this.store.path('.research') + '/')) return { block: true, reason: 'Runtime files are managed through research_checklist' };
        }
        if (event.toolName === 'bash') { const module=c && currentModule(c); scopeBash(module?.followup ? this.store.path(module.followup.outputDir) : this.store.files.root,input); }
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
        const latest = this.store.read();
        const activeModule = latest && currentModule(latest);
        const context = activeModule && this.repetitionContext(latest!);
        const repeated = context && this.toolGuard.preflight(this.store.files.root, event.toolName, event.input, context);
        if (this.repetitionCorrection && this.toolGuard.epoch !== this.repetitionCorrection.progress) this.clearCorrection();
        if (repeated) {
          const reason = this.repetitionReason(activeModule, repeated.count);
          if (!this.hasActiveWait()) {
            if (this.repetitionCorrection?.progress === repeated.progress && this.turnSeq > this.repetitionCorrection.blockedTurn) this.repetitionPause = reason;
            else if (!this.repetitionCorrection || this.repetitionCorrection.progress !== repeated.progress) this.repetitionCorrection = { progress: repeated.progress, blockedTurn: this.turnSeq, promptSent: false, reason };
          }
          return { block: true, terminate: true, reason };
        }
      } catch (e) { if (event.toolName !== 'research_checklist' && !['read', 'grep', 'find', 'ls'].includes(event.toolName)) return { block: true, reason: String(e) }; }
    });
    pi.on('tool_result', event => {
      if (!this.active || !this.store) return;
      if (!event.isError && ['write','edit'].includes(event.toolName) && typeof event.input.path === 'string') {
        this.answerRevision = undefined;
        const module = this.store.read() && currentModule(this.store.read()!);
        if (module) {
          const path = this.store.path(event.input.path);
          this.recentSavedFiles = [...this.recentSavedFiles.filter(file => file.path !== path), { moduleId: module.id, path }].slice(-8);
        }
      }
      const repetition = this.observeToolResult(event);
      if (repetition) return repetition;
      if (event.toolName !== 'subagent') return;
      const details = event.details as { asyncId?: string } | undefined;
      const tasks = (event.input.args as { tasks?: unknown[] } | undefined)?.tasks;
      if (!event.isError && details?.asyncId && !this.terminalSubagents.has(details.asyncId)) {
        if (!this.asyncDelegations.has(details.asyncId)) { this.resetRepetition(); this.asyncDelegations.add(details.asyncId); }
        if (Array.isArray(tasks)) this.roleRequests.set(details.asyncId, tasks);
      }
      const c = this.store.read(), m = c && currentModule(c);
      const specialist = m && specialistNames.find(name => m.skills.includes(name));
      const nativeId=details?.asyncId;
      if(nativeId && m?.followup && !event.isError && (!event.input.action || event.input.action==='start')) this.store.change('Record revision child run',value=>{const module=value.modules.find(module=>module.id===m.id)!;if(!module.taskIds.includes(nativeId))module.taskIds.push(nativeId);});
      if (!m || !specialist) return;
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
          this.delegationFailurePause = '研究子代理已结束，但主流程重复查询状态，已停止循环。请从子代理步骤恢复任务。';
          return;
        }
      }
      if (event.input.action === 'list') {
        this.delegationQueries++;
        const text = event.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        if (!event.isError && text.includes(specialist)) {
          this.discoveredSpecialists.add(specialist);
          this.delegationQueries = 0;
          this.delegationFailures = 0;
        } else this.delegationFailures++;
      } else if (event.isError && (!event.input.action || ['start', 'resume'].includes(String(event.input.action)))) this.delegationFailures++;
      else if (!event.input.action || event.input.action === 'resume') {
        this.delegationFailures = 0; this.delegationQueries = 0;
      }
      if (this.delegationFailures < 2 && this.delegationQueries < 3) return;
      const reason = '研究代理暂不可用：已停止重复发现或调用。请检查插件代理目录，修复后继续研究。';
      this.store.change(reason, value => {
        const module = value.modules.find(module => module.id === m.id)!;
        module.status = 'blocked'; module.reason = reason;
      });
      this.delegationFailurePause = reason;
      return { content: [...event.content, { type: 'text' as const, text: reason }] };
    });
    pi.on('agent_before_settle', async (event) => {
      if (!this.active || !this.store) return;
      const pendingCorrection = this.repetitionCorrection;
      const correctionDue = Boolean(pendingCorrection && !pendingCorrection.promptSent && this.turnSeq === pendingCorrection.blockedTurn);
      const decision = this.settlement(event.outcome, correctionDue);
      if (decision.state === 'waiting') {
        this.waiting = true; this.stagnant = 0;
        this.store.change(decision.reason, c => { c.control.state = 'waiting'; c.control.reason = decision.reason; c.control.wakeAt = this.wakeAt; if (c.control.wait) c.control.wait.state = 'waiting'; });
        return;
      }
      if (correctionDue && pendingCorrection && this.repetitionCorrection === pendingCorrection && decision.state === 'continue') {
        pendingCorrection.promptSent = true;
        this.continuations++;
        return { entries: [...event.entries, { type: 'custom_message' as const, customType: 'research-repetition-correction', content: pendingCorrection.reason, display: false }], continue: true };
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
            const unresolved = this.state().pendingInstructions.filter(i=>!('followupModuleId' in i && i.followupModuleId) && !('planned' in i && i.planned));
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
          if (p.action === 'accept' && (!p.moduleId || p.expectedRevision === undefined || !p.reason?.trim() || !p.evidence?.length || !p.acceptance?.length)) throw new Error('accept requires moduleId, expectedRevision, reason, evidence and acceptance explicitly together.');
          if (['followup','accept'].includes(p.action) && this.asyncDelegations.size) throw new Error('Wait for native child completion before accepting or switching work.');
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
          const alreadyInitialized = p.action === 'init' && Boolean(this.store.read());
          const changed = applyChecklistAction(this.store, p.action === 'init' && !p.objective ? { ...p, objective: this.pending.join('\n') } : p);
          const scopedDelivery = (p.action==='accept' || (p.action==='update' && p.status==='skipped')) && changed?.modules.find(module=>module.id===p.moduleId)?.followup;
          if (changed && p.action === 'resolve' && p.response && !p.objective && !changed.control.instructions.find(i=>i.id===p.instructionId)?.planned) this.answerRevision = changed.revision;
          else if (!['read','help','resolve'].includes(p.action)) this.answerRevision = undefined;
          // Decide conversational completion at settlement, after any requested execution
          // has had a chance to start; resolving an acknowledgement must not block it.
          if(changed && currentModule(changed) && scopedDelivery && !this.pending.length && !changed.control.instructions.some(i=>!i.resolution) && !this.asyncDelegations.size && !this.store.files.activeWork().length) {
            await this.pause('Scoped followup finished; remaining research preserved for explicit continuation', 'paused', false);
          }
          if (p.action !== 'read') { this.checklistFailure = undefined; this.checklistRecoveryState = undefined; this.checklistFailedArguments = undefined; }
          const payload = { ...this.state(), ...(alreadyInitialized ? { notice: 'Checklist already initialized; existing objective, modules and versions preserved. Follow nextAction using the current revision; do not initialize again.' } : {}) };
          return { content: [{ type: 'text', text: JSON.stringify(payload) }], details: payload };
        } catch (error) {
          const details = this.checklistError(error, p);
          return { content: [{ type: 'text', text: JSON.stringify(details) }], details, isError: true };
        }
      },
    });
  }
}
