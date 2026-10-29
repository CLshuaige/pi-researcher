import {
  createAgentSession, createMcpExtension, DefaultResourceLoader, getAgentDir,
  SessionManager, SettingsManager,
  type AgentSession, type ExtensionContext, type ExtensionFactory, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Usage } from "./types.ts";
import { addUsage, sessionUsage } from "./usage.ts";
import { existsSync, readFileSync } from "node:fs";

export interface SdkRunOptions {
  cwd: string;
  host: Pick<ExtensionContext, "model" | "modelRegistry" | "thinkingLevel">;
  prompt: string;
  sessionDir: string;
  sessionFile?: string;
  tools: string[];
  skills?: string[];
  extensions?: string[];
  factories?: ExtensionFactory[];
  customTools?: ToolDefinition<any, any>[];
  enableMcp?: boolean;
  maxTurns: number;
  signal: AbortSignal;
  onCreated?: (session: AgentSession) => void;
  onProgress?: (text: string) => void;
  onUsage?: (usage: Usage) => void;
}

/** An independent transcript using the parent's live model connection, not its history. */
export async function runSdk(options: SdkRunOptions): Promise<{ text: string; usage: Usage; sessionFile?: string; sessionId: string }> {
  options.signal.throwIfAborted();
  for (const skill of options.skills ?? []) if (!existsSync(skill)) throw new Error(`Child skill not found: ${skill}`);
  const model = options.host.model;
  if (!model) throw new Error("Select a model before starting research");
  let requests = 0;
  const bridge: ExtensionFactory = (pi) => {
    pi.registerProvider(model.provider, {
      baseUrl: model.baseUrl || "https://host-managed.invalid",
      apiKey: "host-managed",
      api: model.api,
      models: [model],
      streamSimple: (_model, context, streamOptions) => {
        options.signal.throwIfAborted();
        if (++requests > options.maxTurns) throw new Error(`Model request budget exhausted (${options.maxTurns})`);
        // Child auth may materialize the placeholder in headers/env as well as apiKey.
        // Resolve the entire auth envelope again in the host, including custom headers.
        const { apiKey: _key, headers: _headers, env: _env, ...requestOptions } = streamOptions ?? {};
        return options.host.modelRegistry.streamSimple(model, context, {
          ...requestOptions,
          signal: streamOptions?.signal ? AbortSignal.any([streamOptions.signal, options.signal]) : options.signal,
        });
      },
    });
  };
  const settings = SettingsManager.inMemory({
    packages: [], extensions: [], skills: [], retry: { enabled: false },
    compaction: { enabled: true },
  });
  const loader = new DefaultResourceLoader({
    cwd: options.cwd, agentDir: getAgentDir(), settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    additionalExtensionPaths: options.extensions ?? [],
    additionalSkillPaths: options.skills ?? [],
    extensionFactories: [
      ...(options.enableMcp ? [createMcpExtension()] : []),
      ...(options.factories ?? []), bridge,
    ],
    appendSystemPrompt: ["You are a bounded research worker. Follow the supplied task and project constraints. Do not delegate or invoke another agent through tools or shell commands. Read only the relevant skills. Report missing evidence honestly. The engine's explicitly provided internal execution tools are the only exception to the no-delegation rule.", ...(options.skills ?? []).map(path => `Required skill instructions (${path}):\n${readFileSync(path, "utf8")}`)],
  });
  await loader.reload();
  const errors = loader.getExtensions().errors;
  if (errors.length) throw new Error(`Child extension loading failed: ${JSON.stringify(errors)}`);
  options.signal.throwIfAborted();
  const { session } = await createAgentSession({
    cwd: options.cwd, model, thinkingLevel: options.host.thinkingLevel,
    resourceLoader: loader, settingsManager: settings,
    sessionManager: options.sessionFile ? SessionManager.open(options.sessionFile) : SessionManager.create(options.cwd, options.sessionDir),
    tools: options.tools, customTools: options.customTools,
  });
  const before = sessionUsage(session);
  let abortError: unknown;
  const abort = () => { void session.abort().catch((error) => { abortError = error; }); };
  options.signal.addEventListener("abort", abort, { once: true });
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "tool_execution_start") options.onProgress?.(`工具：${event.toolName}`);
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      options.onProgress?.(event.assistantMessageEvent.delta.slice(-240));
    }
  });
  try {
    await session.bindExtensions({ mode: "print", onError: (error) => options.onProgress?.(`扩展错误：${String(error)}`) });
    const available = new Set(session.getAllTools().map((tool) => tool.name));
    const missing = options.tools.filter((name) => !available.has(name));
    if (missing.length) throw new Error(`Child tools unavailable: ${missing.join(", ")}. Configure their extension providers.`);
    // bindExtensions may activate tools registered by third-party extensions.
    session.setActiveToolsByName(options.tools);
    options.onCreated?.(session);
    options.signal.throwIfAborted();
    await session.prompt(options.prompt);
    options.signal.throwIfAborted();
    if (abortError) throw abortError;
    const last = [...session.messages].reverse().find((message) => message.role === "assistant");
    if (last?.role === "assistant" && ["error", "aborted"].includes(last.stopReason)) throw new Error(last.errorMessage || `Child ${last.stopReason}`);
    return {
      text: session.getLastAssistantText() ?? "", sessionFile: session.sessionFile, sessionId: session.sessionId,
      usage: addUsage(sessionUsage(session), before, -1),
    };
  } finally {
    try { options.onUsage?.(addUsage(sessionUsage(session), before, -1)); }
    finally {
      options.signal.removeEventListener("abort", abort);
      unsubscribe();
      session.dispose();
    }
  }
}
