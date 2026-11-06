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
  publish(html: string): Promise<void>;
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
    pi.on("tool_call", () => {
      if (closed || job.signal.aborted || failures >= 2)
        return {
          block: true,
          terminate: true,
          reason: "展示任务已停止；保留上一份展板。",
        };
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
        "Publish new content with html, or restyle an existing board with css alone to preserve its content/figures and avoid rewriting them. Supply exactly one. A successful call is required for delivery.",
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
          if (p.html && !p.css) await job.publish(p.html);
          else if (p.css && !p.html && job.style) await job.style(p.css);
          else
            throw new Error("提供 html 或 css 其中一项；css 仅用于已有展板。");
          closed = true;
          return {
            details: {},
            content: [{ type: "text", text: "展板已发布。" }],
          };
        } catch (error) {
          failures++;
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
