import { Type } from "typebox";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { renderTask, ResearchRunner } from "./runner.ts";
import { readConfig, ResearchStore } from "./store.ts";
import { SKILLS } from "./types.ts";

const guidance = `Research workspace: research/BRIEF.md is the goal and constraints; research/STATE.md is the current synthesis. Read existing artifacts before duplicating work. Use the seven research-* skills as capabilities, not mandatory stages. Work directly for small, context-dependent tasks. Delegate bounded evidence gathering, sustained experiments or independent reviews with research_delegate when useful for this research goal. Keep child scopes disjoint, return evidence paths, and update shared project state in the parent. Complete, skip or repeat capabilities according to evidence and available resources. A partial or negative result is not a successful validation of a hypothesis. Stop when the goal, budget or evidence boundary is reached.`;

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
  pi.on("session_shutdown", () => runner.shutdown());
  pi.on("before_agent_start", (event, ctx) => {
    if (!new ResearchStore(ctx.cwd).initialized()) return;
    return { systemPrompt: event.systemPrompt + "\n\n" + guidance };
  });
  pi.registerTool({
    name: "research_workspace", label: "Research workspace",
    description: "Initialize a research project without overwriting existing files; inspect project status or an exact task. No model calls.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("init"), Type.Literal("status"), Type.Literal("inspect"), Type.Literal("capabilities")]),
      objective: Type.Optional(Type.String({ minLength: 1 })), taskId: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const store = new ResearchStore(ctx.cwd);
      if (params.action === "capabilities") {
        const report = capabilities(ctx);
        return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }], details: report };
      }
      if (params.action === "init") {
        store.initialize(params.objective ?? "");
        return { content: [{ type: "text", text: "Research workspace ready. Read research/BRIEF.md and research/STATE.md; existing files were preserved." }], details: {} };
      }
      if (params.action === "inspect") {
        const task = store.list().find((t) => t.id === params.taskId);
        if (!task) throw new Error("Task not found");
        return { content: [{ type: "text", text: renderTask(task) }], details: task };
      }
      const tasks = store.list().map(({ id, status, objective, outputDir }) => ({ id, status, objective, outputDir }));
      return { content: [{ type: "text", text: JSON.stringify({ initialized: store.initialized(), tasks, config: readConfig(ctx.cwd) }, null, 2) }], details: { tasks } };
    },
  });
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
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      const task = await runner.run(params, ctx, signal, (text) => {
        onUpdate?.({ content: [{ type: "text", text }], details: {} });
      });
      return { content: [{ type: "text", text: renderTask(task) }], details: task, usage: task.usage, isError: ["failed", "cancelled", "timed_out", "interrupted"].includes(task.status) };
    },
  });
  pi.registerCommand("research", {
    description: "Research: <goal> | init <goal> | status | capabilities | inspect <task-id> | stop <task-id> | help",
    async handler(args, ctx) {
      const store = new ResearchStore(ctx.cwd);
      const [command, ...rest] = args.trim().split(/\s+/);
      const value = rest.join(" ");
      try {
        if (command === "help") { ctx.ui.notify("/research <goal> · init <goal> · status · capabilities · inspect <task-id> · stop <task-id>\n轻量任务留在主会话；按需委派。实验自动加载内置 engine。", "info"); return; }
        if (command === "capabilities") { ctx.ui.notify(JSON.stringify(capabilities(ctx), null, 2), "info"); return; }
        if (command === "status") {
          const tasks = store.list();
          const lines = tasks.slice(0, 10).map((t) => `${t.id} ${t.status} ${t.objective.slice(0, 60)}`);
          ctx.ui.setWidget("research", [store.initialized() ? "研究工作区：research/BRIEF.md · research/STATE.md" : "尚未初始化", ...lines]);
          ctx.ui.notify(lines.join("\n") || "暂无研究子任务", "info"); return;
        }
        if (command === "inspect") {
          const task = store.list().find((t) => t.id === value);
          if (!task) throw new Error("Task not found");
          ctx.ui.notify(renderTask(task), "info"); return;
        }
        if (command === "stop") { runner.stop(value); ctx.ui.notify("取消请求已发送；等待任务进入终态后再续接。", "info"); return; }
        if (command === "init") { store.initialize(value); ctx.ui.notify("研究工作区已初始化；已有文件保持原样。", "info"); return; }
        if (!args.trim() && !store.initialized()) { ctx.ui.notify("用 /research <研究目标> 开始，或 /research init <目标> 仅初始化。", "info"); return; }
        if (!store.initialized()) store.initialize(args);
        pi.sendUserMessage(`${guidance}\n\n当前请求：${args.trim() || "继续当前研究，先检查状态和已有成果。"}\n\n先读取 BRIEF.md；如果本次请求改变目标，更新 BRIEF.md 并重新判断已有任务是否仍适用。`, { deliverAs: "followUp" });
      } catch (error) { ctx.ui.notify(String(error), "error"); }
    },
  });
}
