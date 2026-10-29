import { scopeBash } from "../researcher/boundaries.ts";
/** Adapted from the supplied engine: retain method → plan → execute/review → report,
 * but use bounded SDK sessions, per-runtime state, cancellation and durable evidence. */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { acquireOwnerLock, atomicWrite, digest, workspacePath } from "../researcher/store.ts";
import { runSdk } from "../researcher/sdk.ts";
import type { Usage } from "../researcher/types.ts";
import { addUsage, zeroUsage } from "../researcher/usage.ts";

interface PlanStep { id: string; title: string; description: string; instructions: string }
interface StepResult { stepId: string; status: string; attempts: number; output?: string; error?: string; timestamp: string }
interface Progress {
  version: 2; projectPath: string; methodDigest: string; status: string;
  currentStepIndex: number; steps: StepResult[]; createdAt: string; updatedAt: string;
  summary?: string; error?: string;
}
export interface EngineOptions { projectPath: string; timeoutMs?: number; maxSteps?: number; maxRetries?: number }
export interface EngineResult { status: string; projectPath: string; progressPath: string; resultsPath?: string; error?: string; usage: Usage }

export function parsePlan(text: string, maxSteps: number): PlanStep[] {
  const parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""));
  const steps = Array.isArray(parsed) ? parsed : parsed.steps;
  if (!Array.isArray(steps) || !steps.length || steps.length > maxSteps) throw new Error(`Plan must contain 1..${maxSteps} steps`);
  const ids = new Set<string>();
  return steps.map((s, i) => {
    const id = String(s.id ?? i + 1);
    if (ids.has(id) || typeof s.title !== "string" || !s.title.trim() || typeof s.instructions !== "string" || !s.instructions.trim()) throw new Error("Plan has duplicate IDs or missing titles/instructions");
    ids.add(id);
    return { id, title: s.title, instructions: s.instructions, description: typeof s.description === "string" ? s.description : "" };
  });
}
export function reviewPassed(text: string): boolean {
  try { return JSON.parse(text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")).pass === true; }
  catch { return false; }
}

export class EngineCore {
  private controller?: AbortController;
  private current?: Progress;
  private pending?: Promise<EngineResult>;
  status() { return this.current ?? { status: "idle" }; }
  abort() { this.controller?.abort(new Error("Engine cancelled")); }
  async shutdown() { this.abort(); await this.pending; }
  start(options: EngineOptions, host: ExtensionContext, signal?: AbortSignal, update?: (text: string) => void): Promise<EngineResult> {
    if (this.pending) return Promise.reject(new Error("This engine runtime already has an active execution"));
    const promise = this.execute(options, host, signal, update);
    this.pending = promise;
    void promise.finally(() => { if (this.pending === promise) this.pending = undefined; }).catch(() => {});
    return promise;
  }
  private async execute(options: EngineOptions, host: ExtensionContext, signal?: AbortSignal, update?: (text: string) => void): Promise<EngineResult> {
    signal?.throwIfAborted();
    const root = realpathSync(resolve(host.cwd, options.projectPath));
    const method = workspacePath(root, "method.md");
    if (!existsSync(method)) throw new Error(`Write a bounded method.md in ${root} before starting engine`);
    const methodDigest = digest(readFileSync(method, "utf8"));
    const maxSteps = options.maxSteps ?? 12;
    const maxRetries = options.maxRetries ?? 2;
    const timeoutMs = options.timeoutMs ?? 900_000;
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 30 || !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5 || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 86_400_000) throw new Error("Invalid engine limits");
    const work = workspacePath(root, "experiments");
    mkdirSync(work, { recursive: true });
    const lock = workspacePath(root, "experiments/engine.lock");
    const release = acquireOwnerLock(lock);
    const controller = new AbortController();
    this.controller = controller;
    this.current = undefined;
    const cancel = () => controller.abort(signal?.reason ?? new Error("Parent cancelled"));
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("Engine deadline exceeded")), timeoutMs);
    const progressPath = workspacePath(root, "experiments/progress.json");
    const planPath = workspacePath(root, "experiments/plan.json");
    const usage = zeroUsage();
    const save = () => {
      if (!this.current) return;
      this.current.updatedAt = new Date().toISOString();
      atomicWrite(progressPath, JSON.stringify(this.current, null, 2) + "\n");
    };
    let sequence = 0;
    const invocationId = randomUUID();
    const phase = async (name: string, prompt: string, writable: boolean) => {
      controller.signal.throwIfAborted();
      const dir = workspacePath(root, `experiments/runs/${invocationId}/${++sequence}-${name}`);
      mkdirSync(dir, { recursive: true });
      const startedAt = new Date().toISOString();
      let sessionFile: string | undefined;
      atomicWrite(join(dir, "request.md"), prompt + "\n");
      update?.(`engine：${name}`);
      try {
        const result = await runSdk({
          cwd: work, host, signal: controller.signal, maxTurns: writable ? 40 : 20,
          sessionDir: workspacePath(root, "experiments/sessions"),
          factories: [(pi) => { pi.on("tool_call", (event) => {
            if (event.toolName === "bash") scopeBash(work, event.input as { command?: string });
            if (["write", "edit"].includes(event.toolName)) {
              try {
                const p = workspacePath(work, String((event.input as { path?: string }).path ?? ""));
                if (["plan.json", "progress.json", "engine.lock"].some(n => p === join(work, n)) || p.startsWith(join(work, "runs") + "/") || p.startsWith(join(work, "sessions") + "/")) return { block: true, reason: "Engine runtime records are protected" };
              } catch (e) { return { block: true, reason: String(e) }; }
            }
          }); }],
          tools: writable ? ["read", "grep", "find", "ls", "write", "edit", "bash"] : ["read", "grep", "find", "ls"],
          prompt: `You are performing engine phase ${name}. Work only inside ${work}. Do not invoke other agents. Do not change method.md, plan.json, progress.json or prior run records.\n\n${prompt}`,
          onCreated: (session) => { sessionFile = session.sessionFile; },
          onProgress: (text) => update?.(`engine ${name}: ${text}`),
          onUsage: (part) => { addUsage(usage, part); },
        });
        atomicWrite(join(dir, "response.md"), result.text + "\n");
        atomicWrite(join(dir, "run.json"), JSON.stringify({ phase: name, status: "completed", startedAt, finishedAt: new Date().toISOString(), sessionFile, model: { provider: host.model?.provider, id: host.model?.id }, usage: result.usage }, null, 2));
        if (!result.text.trim()) throw new Error(`Engine phase ${name} returned no result`);
        return result.text;
      } catch (error) {
        atomicWrite(join(dir, "run.json"), JSON.stringify({ phase: name, status: controller.signal.aborted ? "cancelled" : "failed", startedAt, finishedAt: new Date().toISOString(), sessionFile, error: String(error) }, null, 2));
        throw error;
      }
    };
    try {
      if (existsSync(progressPath)) {
        const previous = JSON.parse(readFileSync(progressPath, "utf8"));
        if (!Array.isArray(previous.steps)) throw new Error("Invalid existing progress.json");
        if (previous.methodDigest && previous.methodDigest !== methodDigest) throw new Error("method.md changed after execution began. Use a new experiment directory to preserve prior results.");
        this.current = { ...previous, version: 2, projectPath: root, methodDigest };
      } else {
        this.current = { version: 2, projectPath: root, methodDigest, status: "initializing", currentStepIndex: -1, steps: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      }
      let plan: PlanStep[];
      if (existsSync(planPath)) {
        plan = parsePlan(readFileSync(planPath, "utf8"), maxSteps);
      } else {
        save();
        const files = readdirSync(root).filter((p) => p.endsWith(".md")).map((p) => join(root, p));
        const summary = this.current!.summary ?? await phase("analyze", `Read the relevant project files:\n${files.join("\n")}\nSummarize the goal, constraints, available data and completion criteria. Do not invent missing resources. Return Markdown.`, false);
        this.current!.summary = summary;
        atomicWrite(workspacePath(root, "experiments/CONTEXT.md"), summary + "\n");
        this.current!.status = "planning"; save();
        plan = parsePlan(await phase("plan", `Read ${method} and ${join(work, "CONTEXT.md")}. Make the smallest executable plan, at most ${maxSteps} steps. Reuse the existing environment when suitable. Include baselines and verification needed by the method. Return ONLY a JSON array of {id,title,description,instructions}.`, false), maxSteps);
        atomicWrite(planPath, JSON.stringify({ projectPath: root, steps: plan, createdAt: new Date().toISOString() }, null, 2));
      }
      if (this.current!.steps.length && (this.current!.steps.length !== plan.length || this.current!.steps.some((step, i) => step.stepId !== plan[i].id))) throw new Error("Plan and progress disagree; reconcile them before resuming");
      if (!this.current!.steps.length) this.current!.steps = plan.map((s) => ({ stepId: s.id, status: "pending", attempts: 0, timestamp: new Date().toISOString() }));
      if (this.current!.status === "completed" && this.current!.steps.every((s) => s.status === "completed") && existsSync(join(work, "results.md"))) {
        return { status: "completed", projectPath: root, progressPath, resultsPath: join(work, "results.md"), usage };
      }
      for (let i = 0; i < plan.length; i++) {
        const state = this.current!.steps[i];
        if (state.status === "completed") continue;
        const step = plan[i];
        let feedback = state.error ?? "";
        for (let retry = 0; retry <= maxRetries; retry++) {
          controller.signal.throwIfAborted();
          this.current!.status = "executing";
          this.current!.currentStepIndex = i;
          state.status = "executing"; state.attempts++; state.timestamp = new Date().toISOString(); save();
          const output = await phase(`step-${i + 1}-attempt-${state.attempts}`, `Read ${method} and the experiment context files if present.\nTask: ${step.title}\n${step.description}\n${step.instructions}\nPrior review: ${feedback || "none"}\nExecute and verify the task. Preserve commands, code revision/diff, dataset identity, parameters/seeds, metrics and raw outputs as applicable. Return artifact locations and actual results; do not claim success without evidence.`, true);
          state.output = output; this.current!.status = "reviewing"; save();
          const review = await phase(`review-${i + 1}-attempt-${state.attempts}`, `Independently inspect actual files to evaluate the task. Read-only tools are provided.\nTask: ${step.title}\n${step.instructions}\nWorker report (claims to verify):\n${output}\nReturn ONLY JSON {"pass":boolean,"findings":string,"suggestions":string}. Missing evidence or malformed results must not pass. A negative scientific result can pass if the requested experiment was correctly executed and documented.`, false);
          if (reviewPassed(review)) { state.status = "completed"; state.error = undefined; save(); break; }
          feedback = review; state.error = review; state.status = "failed"; save();
          if (retry === maxRetries) throw new Error(`Step ${step.id} failed review after ${maxRetries + 1} attempts in this invocation`);
        }
      }
      controller.signal.throwIfAborted();
      this.current!.status = "summarizing"; save();
      const report = await phase("summarize", `Read ${method}, ${planPath}, ${progressPath}, and the relevant actual artifacts in ${work}. Write a research report covering methods, experiment settings, observed results, evidence locations, failures/negative findings, limitations and next questions. Distinguish observations from interpretations. Return only the Markdown report; never invent metrics.`, false);
      atomicWrite(join(work, "results.md"), report + "\n");
      this.current!.status = "completed"; this.current!.error = undefined; save();
      return { status: "completed", projectPath: root, progressPath, resultsPath: join(work, "results.md"), usage };
    } catch (error) {
      const status = controller.signal.aborted ? (String(controller.signal.reason).includes("deadline") ? "timed_out" : "aborted") : "failed";
      // Never overwrite another project's state if this invocation failed during setup.
      if (this.current?.projectPath === root) { this.current.status = status; this.current.error = String(error); save(); }
      return { status, projectPath: root, progressPath, error: String(error), usage };
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", cancel);
      release();
      this.controller = undefined;
    }
  }
}

export default function engineExtension(pi: ExtensionAPI) {
  const engine = new EngineCore(); // Per extension runtime, never a module-global singleton.
  pi.on("session_shutdown", () => engine.shutdown());
  pi.registerTool({
    name: "engine_start", label: "Engine", description: "Execute or resume a bounded method.md experiment. Preserves the existing plan and completed steps; returns actual terminal status and artifact paths.",
    exposure: "model-only",
    parameters: Type.Object({ projectPath: Type.String(), timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 86400000 })), maxSteps: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })), maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: 5 })) }),
    async execute(_id, params, signal, update, ctx) {
      const result = await engine.start(params, ctx, signal, (text) => update?.({ content: [{ type: "text", text }], details: {} }));
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result, usage: result.usage, isError: result.status !== "completed" };
    },
  });
  pi.registerTool({ name: "engine_status", label: "Engine status", description: "Inspect this engine runtime's current progress", parameters: Type.Object({}), async execute() { const details = engine.status(); return { content: [{ type: "text", text: JSON.stringify(details) }], details }; } });
  pi.registerTool({ name: "engine_abort", label: "Engine abort", description: "Cancel this runtime's engine and its active SDK operation", parameters: Type.Object({}), async execute() { engine.abort(); return { content: [{ type: "text", text: "Cancellation requested; inspect the terminal result before resuming." }], details: {} }; } });
  pi.registerCommand("engine", {
    description: "Run method.md: /engine <path> | resume <path> | status | abort",
    async handler(args, ctx) {
      const arg = args.trim();
      if (arg === "status") { ctx.ui.notify(JSON.stringify(engine.status(), null, 2), "info"); return; }
      if (arg === "abort") { engine.abort(); ctx.ui.notify("Engine cancellation requested", "info"); return; }
      if (!arg) { ctx.ui.notify("Usage: /engine <path> | resume <path> | status | abort", "info"); return; }
      try {
        const result = await engine.start({ projectPath: arg.replace(/^resume\s+/, "") }, ctx, ctx.signal, (text) => ctx.ui.setStatus("engine", text.slice(0, 100)));
        ctx.ui.notify(JSON.stringify(result), result.status === "completed" ? "info" : "error");
      } catch (error) { ctx.ui.notify(String(error), "error"); }
      finally { ctx.ui.setStatus("engine", undefined); }
    },
  });
}
