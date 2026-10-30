import { ChecklistStore, checklistState, requireCurrentModule } from "./checklist.ts";
import { ResearchController } from "./controller.ts";
import { Type } from "typebox";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { renderTask, ResearchRunner } from "./runner.ts";
import { readConfig, ResearchStore } from "./store.ts";
import { SKILLS } from "./types.ts";



export default function researcherExtension(pi: ExtensionAPI) {
  const runner = new ResearchRunner();
  const capabilities = (ctx: ExtensionContext) => {
    const config = readConfig(ctx.cwd);
    return {
      model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
      modelAuthConfigured: ctx.model ? ctx.modelRegistry.hasConfiguredAuth(ctx.model) : false,
      mainActiveTools: pi.getActiveTools(),
      childExtensions: config.childExtensions,
      childExtraTools: config.extraTools,
      reviewerTools: config.reviewerTools,
      configSources: [`${getAgentDir()}/research.json`, `${ctx.cwd}/.pi/research.json`],
      note: "Configuration only: child tools are validated on child startup; authentication and search services have not been contacted by this check.",
    };
  };
  const controller = new ResearchController(pi, runner);
  controller.bind();
  pi.registerTool({
    name: "research_delegate", label: "Research task",
    exposure: "model-only", executionMode: "parallel",
    description: "Run a bounded research task in an independent, persisted Pi session. Select one or more research skills, input files and completion criteria. Returns a concise handoff and artifact paths. Resume only by exact task ID; same skills, tools and model are retained. Lightweight work should stay in the parent session.",
    parameters: Type.Object({
      objective: Type.String({ minLength: 1, maxLength: 12000 }),
      skills: Type.Array(Type.Union(SKILLS.map((name) => Type.Literal(name))), { minItems: 1, uniqueItems: true }),
      inputs: Type.Array(Type.String(), { maxItems: 40 }),
      doneWhen: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 20 }),
      resumeTaskId: Type.Optional(Type.String()),
      moduleId: Type.String(),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      if (!controller.active || !controller.store) throw new Error("Activate /researcher first");
      const checklist = controller.store.read();
      const module = checklist?.modules.find(m => m.id === params.moduleId);
      if (!checklist || !module) throw new Error("Unknown checklist module");
      requireCurrentModule(checklist, params.moduleId);
      if (!["running", "awaiting_acceptance"].includes(module.status)) throw new Error("Start the current module through research_checklist first");
      if (JSON.stringify([...new Set(params.skills)].sort()) !== JSON.stringify([...new Set(module.skills)].sort())) throw new Error(`Delegation must use current module skills: ${module.skills.join(", ")}`);
      if (module.dependencies.some(id => !["completed", "skipped"].includes(checklist.modules.find(m => m.id === id)?.status ?? ""))) throw new Error("Module dependencies unfinished");
      if (params.resumeTaskId) {
        const previous = new ResearchStore(ctx.cwd).read(params.resumeTaskId);
        if (previous.moduleId && previous.moduleId !== module.id) throw new Error("Cannot resume another module's task");
      }
      controller.store.change("Delegate module", c => { c.modules.find(m => m.id === module.id)!.status = "running"; });
      let task;
      try { task = await runner.run({ ...params, researchId: checklist.researchId, objectiveRevision: checklist.objectiveRevision }, ctx, signal, (text) => {
        onUpdate?.({ content: [{ type: "text", text }], details: {} });
      });
      } catch (error) {
        controller.store.change("Delegation failed", c => { const m = c.modules.find(m => m.id === module.id)!; m.status = "blocked"; m.reason = String(error); });
        throw error;
      }
      controller.store.change("Child handoff requires acceptance", c => {
        const m = c.modules.find(m => m.id === module.id)!;
        if (!m.taskIds.includes(task.id)) m.taskIds.push(task.id);
        m.status = "awaiting_acceptance";
        m.reason = task.objectiveRevision === c.objectiveRevision ? "Inspect child evidence" : "Goal changed: re-evaluate old result";
      });
      return { content: [{ type: "text", text: renderTask(task) }], details: task, usage: task.usage, isError: ["failed", "cancelled", "timed_out", "interrupted"].includes(task.status) };
    },
  });
  const commandDefinition = {
    description: "Researcher: <instruction> | resume | pause | stop | status | capabilities | inspect <task-id> | init <goal>",
    async handler(args: string, ctx: import("@earendil-works/pi-coding-agent").ExtensionCommandContext) {
      const store = new ResearchStore(ctx.cwd);
      const [command, ...rest] = args.trim().split(/\s+/);
      const value = rest.join(" ");
      try {
        if (command === "help") { ctx.ui.notify("/researcher <instruction> · resume · pause · stop · status · capabilities · inspect <task-id>\n轻量任务留在主会话；按需委派。实验自动加载内置 engine。", "info"); return; }
        if (command === "capabilities") { ctx.ui.notify(JSON.stringify(capabilities(ctx), null, 2), "info"); return; }
        if (command === "status") {
          const checklist = new ChecklistStore(ctx.cwd);
          ctx.ui.notify(JSON.stringify(controller.store?.files.root === store.root ? controller.state() : checklistState(checklist.read(), checklist.readInbox(), store.jobs()), null, 2), "info");
          const tasks = store.list();
          const jobs = store.jobs();
          const lines = tasks.slice(0, 10).map((t) => `${t.id} ${t.status} ${t.objective.slice(0, 60)}`);
          lines.push(...jobs.slice(0, 10).map(j => `${j.id} ${j.status} module=${j.moduleId}`));
          ctx.ui.setWidget("research", [store.initialized() ? "研究工作区：research/BRIEF.md · research/STATE.md" : "尚未初始化", ...lines]);
          ctx.ui.notify(lines.join("\n") || "暂无研究子任务", "info"); return;
        }
        if (command === "inspect") {
          if (value.startsWith("J-")) { ctx.ui.notify(JSON.stringify(store.jobStatus(value), null, 2), "info"); return; }
          const task = store.list().find((t) => t.id === value);
          if (!task) throw new Error("Task not found");
          ctx.ui.notify(renderTask(task), "info"); return;
        }
        if (command === "stop" && value) { runner.stop(value); ctx.ui.notify("取消请求已发送；等待任务进入终态后再续接。", "info"); return; }
        if (command === "init") { store.initialize(value); ctx.ui.notify("研究工作区已初始化；已有文件保持原样。", "info"); return; }
        if (["pause", "stop"].includes(command)) { const cleanup = controller.pause("User " + command, command === "stop" ? "stopped" : "paused"); await ctx.abort(); await cleanup; return; }
        const instruction = command === "--" ? args.trim().slice(2).trim() : command === "resume" ? "" : args.trim();
        if (!store.initialized()) {
          if (!instruction) throw new Error("Supply a research objective");
          store.initialize(instruction);
        }
        if (await controller.receive(instruction, ctx, true) !== 'accepted') return;
        pi.sendUserMessage(instruction || "Resume research from checklist; inspect prior results first.", { deliverAs: "followUp" });
      } catch (error) { ctx.ui.notify(String(error), "error"); }
    },
  };
  pi.registerCommand("researcher", commandDefinition);
  pi.registerCommand("research", commandDefinition);
}
