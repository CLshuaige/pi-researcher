import * as http from "node:http";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Optional, process-wide proxy integration. Load explicitly on proxy-based networks. */
export default function envProxy(_pi: ExtensionAPI) {
  if (!["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"].some((name) => process.env[name])) return;
  const marker = Symbol.for("gewu.pi-researcher.env-proxy");
  const state = globalThis as typeof globalThis & { [key: symbol]: unknown };
  if (state[marker]) return;
  const configure = (http as unknown as { setGlobalProxyFromEnv?: (env: NodeJS.ProcessEnv) => () => void }).setGlobalProxyFromEnv;
  if (!configure) throw new Error("Research network proxy requires Node >=24.14; alternatively start a supported Node version with NODE_USE_ENV_PROXY=1.");
  const bypass = process.env.no_proxy ?? process.env.NO_PROXY ?? "";
  configure({ ...process.env, no_proxy: [bypass, "localhost", "127.0.0.1", "::1"].filter(Boolean).join(",") });
  // Keep the dispatcher for the whole Pi process; reload/child shutdown must not reset it.
  state[marker] = true;
}
