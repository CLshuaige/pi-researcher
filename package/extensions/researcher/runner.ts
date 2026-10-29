import { fork } from "node:child_process";
import { ChecklistStore, requireCurrentModule } from "./checklist.ts";
import { scopeBash } from "./boundaries.ts";
import { moduleResources } from "./modules.ts";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import type { ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { atomicWrite, digest, processIdentity, readConfig, ResearchStore } from "./store.ts";
import { runSdk } from "./sdk.ts";
import { SKILLS, type Handoff, type JobRecord, type JobRequest, type TaskRecord, type TaskRequest } from "./types.ts";

export const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const HandoffSchema = Type.Object({
  status: Type.Union([Type.Literal("completed"), Type.Literal("partial"), Type.Literal("blocked")]),
  summary: Type.String({ minLength: 1, maxLength: 6000 }),
  artifacts: Type.Array(Type.String(), { maxItems: 50 }),
  evidence: Type.Array(Type.String(), { maxItems: 50 }),
  openQuestions: Type.Array(Type.String(), { maxItems: 30 }),
  nextActions: Type.Array(Type.String(), { maxItems: 20 }),
});
export function renderTask(task: TaskRecord): string {
  return [
    `${task.id} · ${task.status} · attempt ${task.attempt}`,
    task.objective, task.result?.summary ?? task.error ?? "运行中",
    `成果目录：${task.outputDir}`,
    ...(task.result?.artifacts.map((p) => `成果：${p}`) ?? []),
    ...(task.result?.evidence.map((p) => `证据：${p}`) ?? []),
    ...(task.result?.openQuestions.map((q) => `未决：${q}`) ?? []),
    ...(task.result?.nextActions.map((q) => `建议：${q}`) ?? []),
    ...(task.staleBrief ? ["注意：运行期间 BRIEF.md 已变更；采纳结果前核对新目标。"] : []),
  ].join("\n");
}

export class ResearchRunner {
  private active = new Map<string, { controller: AbortController; done: Promise<void>; root: string }>();
  private jobs = new Map<string, { root: string; record: JobRecord; stop: () => void; done: Promise<void> }>();
  private jobListener?: (root: string, job: JobRecord) => void;
  onJobChange(listener: (root: string, job: JobRecord) => void) { this.jobListener = listener; }
  startJob(request: JobRequest, root: string): JobRecord {
    if (process.platform !== 'linux') throw new Error('Managed process jobs currently require Linux');
    const checklist = new ChecklistStore(root), c = checklist.read();
    if (!c) throw new Error('Initialize checklist first');
    const module = requireCurrentModule(c, request.moduleId);
    if (!['running', 'awaiting_acceptance'].includes(module.status)) throw new Error('Start current module before executing a job');
    if (!request.command.trim()) throw new Error('Supply a foreground command; do not use nohup, &, or daemonization');
    const store = checklist.files, cwd = store.path(request.cwd ?? '.');
    if (!statSync(cwd).isDirectory()) throw new Error('Job cwd must be an existing project directory');
    const timeoutSeconds = request.timeoutSeconds ?? 1200;
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 86400) throw new Error('timeoutSeconds must be 1..86400');
    for (const name of Object.keys(request.env ?? {})) if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error('Invalid environment variable name');
    const fingerprint = digest(JSON.stringify([c.researchId, c.objectiveRevision, module.id, request.command, cwd, request.env ?? {}, timeoutSeconds]));
    const previous = store.jobs().find(j => j.status === 'running' && j.fingerprint === fingerprint);
    if (previous) return previous;
    if (store.activeWork().length >= readConfig(root).maxConcurrent) throw new Error('Research concurrency limit reached; wait or cancel a task/job');
    const env = { ...request.env, TMPDIR: store.path('.research/tmp'), XDG_CACHE_HOME: store.path('.research/cache'), MNE_DATA: store.path(request.env?.MNE_DATA ?? 'mne_data') };
    for (const directory of [env.TMPDIR, env.XDG_CACHE_HOME, env.MNE_DATA]) mkdirSync(directory, { recursive: true });
    const id = `J-${randomUUID()}`, dir = store.jobPath(id);
    mkdirSync(dir, { recursive: true });
    const logPath = `.research/jobs/${id}/output.log`;
    const job: JobRecord = { version: 1, id, researchId: c.researchId, objectiveRevision: c.objectiveRevision, moduleId: module.id,
      command: request.command, cwd: relative(store.root, cwd) || '.', envNames: Object.keys(request.env ?? {}), fingerprint,
      status: 'running', logPath, startedAt: Date.now(), timeoutSeconds, ownerPid: process.pid, ownerToken: randomUUID() };
    // Persist before launching. An interrupted launch is never inferred to be successful.
    store.saveJob(job);
    const child = fork(fileURLToPath(new URL('./process-worker.mjs', import.meta.url)), [], { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    job.workerPid = child.pid;
    job.workerIdentity = child.pid ? processIdentity(child.pid) : undefined;
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    let cancelled = false;
    const stop = () => { cancelled = true; if (child.connected) child.kill('SIGTERM'); };
    this.jobs.set(id, { root: store.root, record: job, stop, done });
    let spawnError: string | undefined;
    child.once('error', error => { spawnError = String(error); });
    child.once('close', () => {
      let final: JobRecord = { ...job, status: 'interrupted', finishedAt: Date.now(), error: spawnError ?? 'Worker exited without a terminal record' };
      try {
        final = store.readJob(id);
        if (cancelled && final.status === 'interrupted') final = { ...final, status: 'cancelled', finishedAt: Date.now() };
        if (spawnError) final = { ...final, status: 'failed', error: spawnError, finishedAt: Date.now() };
        store.saveJob(final);
      } catch (error) { final.error = String(error); }
      finally {
        this.jobs.delete(id); finish();
        this.jobListener?.(store.root, final);
      }
    });
    try {
      store.saveJob(job);
      checklist.change(`Started managed job ${id}`, value => { value.modules.find(m => m.id === module.id)!.taskIds.push(id); });
      // cwd stays project-local, with project-local temporary/cache/data directories.
      child.send({ command: request.command, cwd, env, logPath: store.path(logPath), exitPath: join(dir, 'exit.json'), timeoutSeconds }, error => { if (error) { spawnError = String(error); stop(); } });
    } catch (error) { stop(); throw error; }
    return job;
  }
  async cancelJob(id: string, root: string) {
    const store = new ResearchStore(root), job = store.readJob(id);
    if (job.status !== 'running') return job;
    const live = this.jobs.get(id);
    if (!live || live.root !== store.root) throw new Error('Job belongs to another runtime; wait for owner cleanup, never kill an unverified PID');
    live.stop(); await live.done;
    return store.readJob(id);
  }
  stop(id: string) {
    const job = this.jobs.get(id);
    if (job) { job.stop(); return; }
    const item = this.active.get(id);
    if (!item) throw new Error("Task is not running in this Pi runtime; inspect its owner before resuming");
    item.controller.abort(new Error("Cancelled by user"));
  }
  async shutdown() {
    const jobs = [...this.jobs.values()];
    for (const job of jobs) job.stop();
    for (const item of this.active.values()) item.controller.abort(new Error("Research runtime is shutting down"));
    await Promise.all([...jobs.map(job => job.done), ...[...this.active.values()].map(item => item.done)]);
  }
  async run(request: TaskRequest, host: ExtensionContext, signal?: AbortSignal, onProgress?: (message: string) => void): Promise<TaskRecord> {
    const store = new ResearchStore(host.cwd);
    if (!store.initialized()) throw new Error("Initialize the project with /research init <objective> first");
    if (!host.model) throw new Error("Select a model first");
    if (!request.objective.trim() || !request.doneWhen.length || !request.skills.length || request.skills.some((s) => !SKILLS.includes(s))) throw new Error("Supply an objective, valid skills and completion criteria");
    const checklist = request.researchId ? new ChecklistStore(store.root).read() : undefined;
    if (request.researchId && (!checklist || checklist.researchId !== request.researchId || checklist.objectiveRevision !== request.objectiveRevision)) throw new Error("Checklist changed before delegation; inspect and retry");
    const config = readConfig(store.root);
    if (store.activeWork().length >= config.maxConcurrent) throw new Error("Research concurrency limit reached; wait for a current task");
    signal?.throwIfAborted();
    const previous = request.resumeTaskId ? store.read(request.resumeTaskId) : undefined;
    if (previous && (!previous.sessionFile || !existsSync(store.path(previous.sessionFile)))) throw new Error("The exact child session is missing; start a new task using prior artifacts as inputs");
    if (previous && (previous.model.id !== host.model.id || previous.model.provider !== host.model.provider)) throw new Error("Resume requires the original model; switch the parent model or start a fresh task");
    const configDigest = digest(JSON.stringify(config));
    if (previous && (previous.configDigest !== configDigest || JSON.stringify(previous.skills) !== JSON.stringify(request.skills))) throw new Error("Resume retains its skills and tool configuration; restore them or start a fresh task");
    const inputs = store.validateInputs([...new Set(["research/BRIEF.md", "research/STATE.md", ...request.inputs])]);
    const id = previous?.id ?? `T-${randomUUID()}`;
    const briefDigest = store.briefDigest();
    const release = store.lock(id);
    try {
      if (previous && JSON.stringify(store.read(id)) !== JSON.stringify(previous)) throw new Error("Task changed while acquiring its lock; inspect and retry the exact task");
    } catch (error) { release(); throw error; }
    const attempt = (previous?.attempt ?? 0) + 1;
    const category = request.skills.includes("research-experiment") ? "experiments" : request.skills.includes("research-literature") ? "evidence" : request.skills.includes("research-review") ? "reviews" : "notes";
    const outputDir = `research/${category}/${id}/attempt-${attempt}`;
    const task: TaskRecord = {
      moduleId: request.moduleId, researchId: request.researchId, objectiveRevision: request.objectiveRevision,
      version: 1, id, attempt, status: "running", objective: request.objective, skills: request.skills,
      inputs, doneWhen: request.doneWhen, outputDir, model: { provider: host.model.provider, id: host.model.id },
      sessionFile: previous?.sessionFile, sessionId: previous?.sessionId,
      configDigest, briefDigest, startedAt: new Date().toISOString(),
      ownerPid: process.pid, ownerToken: randomUUID(),
    };
    const controller = new AbortController();
    let finished!: () => void;
    const done = new Promise<void>((resolve) => { finished = resolve; });
    this.active.set(id, { controller, done, root: store.root });
    const cancel = () => controller.abort(signal?.reason ?? new Error("Parent cancelled"));
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("Research deadline exceeded")), config.timeoutMs);
    let handoff: Handoff | undefined;
    let lastProgress = 0;
    const progress = (text: string) => {
      if (Date.now() - lastProgress > 400) { lastProgress = Date.now(); onProgress?.(`${id}\n${text}`); }
    };
    const reviewOnly = request.skills.every((s) => s === "research-review");
    const engine = request.skills.includes("research-experiment");
    const resources = moduleResources(request.skills);
    const allowed = [...new Set([
      "read", "grep", "find", "ls", ...(reviewOnly ? [] : ["write", "edit", "bash"]),
      ...(reviewOnly ? config.reviewerTools : config.extraTools),
      ...resources.tools, "research_finish",
    ])];
    const guard: ExtensionFactory = (pi) => {
      pi.on("tool_call", (event) => {
        if (controller.signal.aborted) return { block: true, reason: "Task cancelled" };
        if (handoff && event.toolName !== "research_finish") return { block: true, reason: "Task already handed off" };
        if (!allowed.includes(event.toolName)) return { block: true, reason: "Tool is outside this task's explicit tool set" };
        if (event.toolName === "bash") scopeBash(store.path(outputDir), event.input as { command?: string });
        if (["write", "edit"].includes(event.toolName)) {
          const destination = store.path(String((event.input as { path?: string }).path ?? ""));
          const output = store.path(outputDir);
          if (destination !== output && !destination.startsWith(output + sep)) return { block: true, reason: `Write only inside ${outputDir}; return proposed shared changes to the parent` };
        }
        if (event.toolName === "fetch_arxiv") return { block: true, reason: "Global cache tool requires project-local adapter" };
        if (event.toolName === "download_pdf") {
          const raw = (event.input as { outputDir?: string }).outputDir;
          if (!raw) return { block: true, reason: `Supply an absolute outputDir inside ${store.path(outputDir)}` };
          const destination = store.path(raw);
          const output = store.path(outputDir);
          if (destination !== output && !destination.startsWith(output + sep)) return { block: true, reason: `Download only inside ${output}` };
          if (!raw.startsWith(sep)) return { block: true, reason: `Use an absolute outputDir: ${destination}` };
        }
        if (event.toolName === "web_search" && ![undefined, "none"].includes((event.input as { workflow?: string }).workflow)) {
          return { block: true, reason: "Use workflow: none. Research workers analyze sources themselves; no nested summary agent or curator." };
        }
        if (event.toolName === "engine_start") {
          const destination = store.path(String((event.input as { projectPath?: string }).projectPath ?? ""));
          const taskRoot = store.path(dirname(outputDir));
          if (!destination.startsWith(taskRoot + sep)) return { block: true, reason: `Run engine only inside this task's attempt directories: ${taskRoot}` };
        }
      });
    };
    try {
      mkdirSync(store.path(outputDir), { recursive: true });
      store.save(task);
      onProgress?.(`${id}\n启动 ${request.skills.join(", ")}`);
      const result = await runSdk({
        cwd: store.root, host, signal: controller.signal, maxTurns: config.maxTurns,
        sessionDir: store.path(".research/sessions"), sessionFile: previous?.sessionFile ? store.path(previous.sessionFile) : undefined,
        skills: resources.skills,
        extensions: [...config.childExtensions, ...resources.extensions],
        enableMcp: config.enableMcp, factories: [guard], tools: allowed,
        customTools: [{
          name: "research_finish", label: "Research handoff",
          executionMode: "sequential",
          description: "Submit the final bounded research handoff. Artifacts must exist inside the assigned output directory; evidence can cite input files or URLs. Use partial/blocked when completion criteria are unmet.",
          parameters: HandoffSchema,
          async execute(_id, raw) {
            const params = raw as Handoff;
            if (handoff) throw new Error("A handoff has already been submitted");
            for (const artifact of params.artifacts) {
              const absolute = store.path(artifact);
              if (!absolute.startsWith(store.path(outputDir) + sep) || !statSync(absolute).isFile()) throw new Error(`Artifact is missing or outside the assigned output directory: ${artifact}`);
            }
            handoff = params;
            return { content: [{ type: "text", text: "Handoff recorded" }], details: params, terminate: true };
          },
        }],
        onCreated(session) {
          task.sessionFile = session.sessionFile ? relative(store.root, session.sessionFile) : undefined;
          task.sessionId = session.sessionId;
          store.save(task);
        },
        onProgress: progress,
        onUsage: (usage) => { task.usage = usage; },
        prompt: [
          `Research task ${id}, attempt ${attempt}.\nObjective: ${request.objective}`,
          checklist ? `Authoritative research goal revision ${checklist.objectiveRevision}: ${checklist.objective}\nModule: ${JSON.stringify(checklist.modules.find(m => m.id === request.moduleId))}` : "",
          `Read these inputs on demand (the supplied checklist objective supersedes historical BRIEF.md):\n${inputs.join("\n")}`,
          `Use skills: ${request.skills.join(", ")}. Read their SKILL.md instructions.`,
          `Completion criteria:\n${request.doneWhen.map((s) => `- ${s}`).join("\n")}`,
          `Workspace root: ${store.root}\nYour output directory: ${outputDir}`,
          "Bash starts in your output directory; use absolute paths for input files. Other tools accept absolute paths or workspace-root-relative paths. Write only inside your output directory, including through bash and external tools. Do not edit shared BRIEF.md, STATE.md or source indexes. Do not start other agents.",
          engine ? "engine_start is available for a bounded method.md execution inside your output directory. It is optional; direct analysis is also appropriate. Read the experiment skill's engine guidance before use." : "",
          previous ? `This is a continuation of the exact saved child session. Preserve earlier outputs; write this attempt's new artifacts to ${outputDir}.` : "Start from these inputs; no parent conversation is inherited.",
          "Finish with research_finish. Include evidence locations, limitations and suggested next actions. A successful process exit alone is not scientific validation. If you cannot finish, return partial or blocked.",
        ].filter(Boolean).join("\n\n"),
      });
      task.usage = result.usage;
      task.result = handoff ?? { status: "partial", summary: result.text.slice(0, 6000) || "No structured handoff was returned", artifacts: [], evidence: [], openQuestions: ["Missing research_finish handoff; inspect the session before accepting the result."], nextActions: [] };
      task.status = task.result.status;
      if (result.text) atomicWrite(store.path(`${outputDir}/assistant-output.md`), result.text + "\n");
    } catch (error) {
      task.status = controller.signal.aborted ? (String(controller.signal.reason).includes("deadline") ? "timed_out" : "cancelled") : "failed";
      task.error = error instanceof Error ? error.message : String(error);
      if (handoff) task.result = { ...handoff, status: "partial" };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      task.finishedAt = new Date().toISOString();
      try {
        task.staleBrief = store.briefDigest() !== task.briefDigest;
        if (task.staleBrief && task.status === "completed") {
          task.status = "partial";
          if (task.result) task.result.status = "partial";
        }
        store.save(task);
        atomicWrite(store.path(`${outputDir}/handoff.md`), renderTask(task) + "\n");
      } finally {
        try { release(); } finally { this.active.delete(id); finished(); }
      }
    }
    return task;
  }
}
