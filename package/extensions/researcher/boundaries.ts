import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ExtensionAPI, ToolResultEvent } from '@earendil-works/pi-coding-agent';
import { atomicWrite, digest, workspacePath } from './store.ts';
/** Cooperative shell scope, not a sandbox: the command may explicitly override it. */
export function scopeBash(root: string, input: { command?: string }) {
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  const temp = workspacePath(root, '.research/tmp');
  const cache = workspacePath(root, '.research/cache');
  mkdirSync(temp, { recursive: true }); mkdirSync(cache, { recursive: true });
  input.command = `cd ${quote(root)} && export TMPDIR=${quote(temp)} XDG_CACHE_HOME=${quote(cache)} &&\n${input.command ?? ''}`;
}

/** Shared observation guard: no controller, Checklist tools or stage scheduling. */
export class ToolRepetitionGuard {
  private calls = new Map<string, { result: string; count: number }>();
  private progress = '';
  reset() { this.calls.clear(); this.progress = ''; }
  observe(root: string, event: ToolResultEvent, context: unknown = []) {
    if (['research_checklist', 'research_job', 'subagent', 'bg_wait'].includes(event.toolName)) return;
    const files: [string, number, number][] = [];
    const scan = (directory: string, prefix = '') => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || ['node_modules', '__pycache__', 'inputs'].includes(entry.name) || entry.isSymbolicLink()) continue;
        const path = join(directory, entry.name), relative = join(prefix, entry.name);
        if (entry.isDirectory()) scan(path, relative);
        else if (entry.isFile()) {
          const info = statSync(path);
          files.push([relative, info.size, info.mtimeMs]);
        }
      }
    };
    try { scan(root); } catch { this.reset(); return; }
    files.sort((a, b) => a[0].localeCompare(b[0]));
    const progress = digest(JSON.stringify([context, files]));
    if (progress !== this.progress) { this.calls.clear(); this.progress = progress; }
    const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    const key = digest(canonical([event.toolName, event.input]));
    const result = digest(canonical([event.isError, event.content]));
    const previous = this.calls.get(key);
    const count = previous?.result === result ? previous.count + 1 : 1;
    if (this.calls.size >= 32 && !this.calls.has(key)) this.calls.delete(this.calls.keys().next().value!);
    this.calls.set(key, { result, count });
    if (count < 3) return;
    const blocked = count >= 4;
    const reason = blocked
      ? `重复工具调用无进展：${event.toolName} 已重复 ${count} 次。保留已有成果，以 partial / blocked 交接，从首次重复步骤调整策略后恢复。`
      : `重复执行检测：${event.toolName} 的相同输入已得到相同结果 ${count} 次，期间研究产物没有变化。不要再次执行这条查询；利用已有结果采取实际修复、改用不同策略，或记录具体阻塞。工具成功不代表研究取得进展。`;
    return { blocked, reason, result: { content: [...event.content, { type: 'text' as const, text: reason }], ...(blocked ? { isError: true } : {}) } };
  }
}

export function reportHandoff(root: string): { status: string; reason?: string } | undefined {
  try { return JSON.parse(readFileSync(workspacePath(root, '.research/report-handoff.json'), 'utf8')); }
  catch { return undefined; }
}

/** Loaded only by the report agent's subagentOnlyExtensions. */
export default function reportGuard(pi: ExtensionAPI) {
  const guard = new ToolRepetitionGuard();
  let blocked: string | undefined;
  const save = (root: string, status: string, reason?: string) => {
    const path = workspacePath(root, '.research/report-handoff.json');
    mkdirSync(dirname(path), { recursive: true });
    atomicWrite(path, JSON.stringify({ status, reason, root, updatedAt: Date.now() }));
  };
  pi.on('before_agent_start', (_event, ctx) => {
    guard.reset(); blocked = undefined; save(ctx.cwd, 'running');
  });
  pi.on('tool_call', (event, ctx) => {
    if (blocked) return { block: true, terminate: true, reason: blocked };
    if (event.toolName === 'bash') scopeBash(ctx.cwd, event.input as { command?: string });
  });
  pi.on('tool_result', (event, ctx) => {
    const observed = guard.observe(ctx.cwd, event);
    if (observed?.blocked) { blocked = observed.reason; save(ctx.cwd, 'blocked', blocked); }
    return observed?.result;
  });
  pi.on('turn_end', (_event, ctx) => {
    if (!blocked) return;
    ctx.abort();
    return { continue: false, entries: [{ type: 'custom_message' as const,
      customType: 'research-report-partial', content: blocked, display: true }] };
  });
  pi.on('agent_settled', (event, ctx) => {
    if (!blocked) save(ctx.cwd, event.aborted ? 'partial' : 'handoff', event.aborted ? '运行被中断，保留已有成果，恢复后核验。' : undefined);
  });
}
