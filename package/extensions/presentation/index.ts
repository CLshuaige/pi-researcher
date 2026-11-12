import { relative } from "node:path";
import { workspacePath } from "../researcher/store.ts";
import { Type } from "typebox";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export interface PresentationJob {
  signal: AbortSignal;
  list?(query: string, offset: number): Promise<string>;
  read(
    sourceId: string,
    offset?: number,
  ): Promise<
    string | { text: string; image?: { data: string; mimeType: string } }
  >;
  workspace?: string;
  draftPath?: string;
  readable?(path: string): boolean;
  observed?(path: string): Promise<void>;
  progress?(phase: string): void;
  previewFile?(): Promise<void>;
  publishFailed?(error: string): void;
  publish(html: string): Promise<void>;
  publishFile?(): Promise<void>;
  style?(css: string): Promise<void>;
}
/** Web-owned job capability, deliberately absent from the default Pi package entry. */
export function presentationExtension(job: PresentationJob): ExtensionFactory {
  return (pi) => {
    let closed = false,
      failures = 0;
    const check = () => {
      job.signal.throwIfAborted();
      if (closed) throw new Error("Presentation job closed");
    };
    pi.on("session_shutdown", () => {
      closed = true;
    });
    pi.on("tool_call", (event) => {
      if (closed || job.signal.aborted || failures >= 2)
        return {
          block: true,
          terminate: true,
          reason: "展示任务已停止；保留上一份展板。",
        };
      if (
        event.toolName === "read" ||
        event.toolName === "write" ||
        event.toolName === "edit"
      ) {
        try {
          if (!job.workspace || !job.draftPath)
            throw new Error("未分配展板编辑路径。");
          const path = workspacePath(
            job.workspace,
            String(event.input.path || ""),
          );
          const draft = workspacePath(job.workspace, job.draftPath);
          event.input.path = path;
          if (event.toolName === "read") {
            if (
              path !== draft &&
              !job.readable?.(relative(job.workspace, path))
            )
              throw new Error("只能读取项目研究材料和本次展板。");
            job.progress?.("读取材料");
          } else {
            if (path !== draft)
              throw new Error("仅可编辑本次展板文件；科研材料及其他展板只读。");
            job.progress?.("更新图文");
          }
        } catch (error) {
          return { block: true, reason: String(error) };
        }
      }
    });
    pi.on("tool_result", async (event) => {
      if (
        event.toolName === "read" &&
        !event.isError &&
        job.workspace &&
        job.draftPath
      ) {
        const path = workspacePath(
          job.workspace,
          String(event.input.path || ""),
        );
        if (path !== workspacePath(job.workspace, job.draftPath))
          await job.observed?.(relative(job.workspace, path));
      }
      if (
        ["write", "edit"].includes(event.toolName) &&
        !event.isError &&
        !closed &&
        !job.signal.aborted
      ) {
        try {
          await job.previewFile?.();
        } catch (error) {
          // The edit succeeded. Keep the last valid preview and ask the agent to repair the draft.
          return {
            content: [
              ...event.content,
              {
                type: "text" as const,
                text: `草稿已保存，但预览未更新：${String(error)}。请修复完整结构后继续编辑。`,
              },
            ],
          };
        }
      }
    });
    pi.registerTool({
      name: "presentation_list",
      label: "Browse research workspace",
      description:
        "List project research files, including notes, data, report sources and figures. query filters paths, offset pages through results.",
      parameters: Type.Object(
        {
          query: Type.Optional(Type.String()),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
        },
        { additionalProperties: false },
      ),
      async execute(_id, p) {
        check();
        return {
          details: {},
          content: [
            {
              type: "text",
              text:
                (await job.list?.(p.query || "", p.offset || 0)) ||
                "Use provided file inventory.",
            },
          ],
        };
      },
    });
    pi.registerTool({
      name: "presentation_read",
      label: "Read presentation source",
      description:
        "Read a real project file by workspace-relative path or source ID. Text/PDF is paginated by character offset; images return a preview. Use nextOffset to continue long material.",
      parameters: Type.Object(
        {
          sourceId: Type.String({
            description: "Workspace-relative path or listed source ID",
          }),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
        },
        { additionalProperties: false },
      ),
      async execute(_id, p) {
        check();
        const result = await job.read(p.sourceId, p.offset || 0);
        const value = typeof result === "string" ? { text: result } : result;
        return {
          details: {},
          content: [
            { type: "text" as const, text: value.text },
            ...(value.image
              ? [{ type: "image" as const, ...value.image }]
              : []),
          ],
        };
      },
    });
    pi.registerTool({
      name: "presentation_publish",
      label: "Publish research board",
      executionMode: "sequential",
      description:
        "Publish the assigned HTML draft after editing it with native read/edit/write tools: call with {}. Alternatively supply html for a new board, or css alone for style changes. A successful call is required for delivery.",
      parameters: Type.Object(
        {
          html: Type.Optional(Type.String({ minLength: 1, maxLength: 60000 })),
          css: Type.Optional(Type.String({ minLength: 1, maxLength: 16000 })),
        },
        { additionalProperties: false },
      ),
      async execute(_id, p) {
        try {
          check();
          job.progress?.("发布展板");
          if (p.html && !p.css) await job.publish(p.html);
          else if (!p.html && !p.css && job.publishFile)
            await job.publishFile();
          else if (!p.html && p.css && job.style) await job.style(p.css);
          else throw new Error("仅提供 html、css 或空参数发布本次文件。");
          closed = true;
          return {
            details: {},
            content: [{ type: "text", text: "展板已发布。" }],
          };
        } catch (error) {
          failures++;
          job.publishFailed?.(error instanceof Error ? error.message : String(error));
          return {
            details: {},
            content: [{ type: "text", text: String(error) }],
            isError: true,
            ...(failures >= 2 ? { terminate: true } : {}),
          };
        }
      },
    });
  };
}
