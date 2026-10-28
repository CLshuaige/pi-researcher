import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Usage } from "./types.ts";
export const zeroUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
export function addUsage(total: Usage, part: Usage, sign = 1): Usage {
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) total[key] += sign * part[key];
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) total.cost[key] += sign * part.cost[key];
  for (const key of ["cacheWrite1h", "reasoning"] as const) if (part[key] !== undefined) total[key] = (total[key] ?? 0) + sign * part[key]!;
  return total;
}
export function sessionUsage(session: AgentSession): Usage {
  const total = zeroUsage();
  for (const entry of session.sessionManager.getEntries()) {
    if ((entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) addUsage(total, entry.usage);
    if (entry.type === "message" && (entry.message.role === "assistant" || entry.message.role === "toolResult") && entry.message.usage) addUsage(total, entry.message.usage);
  }
  return total;
}
