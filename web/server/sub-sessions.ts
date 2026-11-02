import { open, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ChatMessage, StepStatus } from '../shared/types.ts';
import type { StoredSession } from './store.ts';

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  const blocks = Array.isArray(value) ? value : object(value).content;
  return Array.isArray(blocks)
    ? blocks
        .filter((b) => b?.type === 'text')
        .map((b) => b.text)
        .join('\n')
    : '';
}
export function childStatus(
  outcome: string | undefined,
  finished = false,
  error = false,
): StepStatus {
  if (error || ['failed', 'timed_out', 'blocked', 'error'].includes(outcome || '')) return 'failed';
  if (['cancelled', 'interrupted', 'aborted'].includes(outcome || '')) return 'cancelled';
  if (['completed', 'done', 'succeeded', 'success'].includes(outcome || '')) return 'completed';
  if (['pending', 'queued', 'partial'].includes(outcome || '')) return 'pending';
  return finished ? 'completed' : 'running';
}
export function childMessages(raw: unknown[], prefix: string): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const [index, entry] of raw.entries()) {
    const item = object(entry),
      message = object(item.message || item);
    const timestamp = Number(message.timestamp) || Date.parse(item.timestamp) || 0;
    const id = String(item.id || `${prefix}-${index}`);
    if (message.role === 'assistant') {
      const content = text(message);
      if (content)
        result.push({
          id,
          role: 'assistant',
          text: content,
          timestamp,
          status:
            message.stopReason === 'error'
              ? 'failed'
              : message.stopReason === 'aborted'
                ? 'cancelled'
                : 'completed',
        });
      if (Array.isArray(message.content))
        for (const block of message.content)
          if (block.type === 'toolCall')
            result.push({
              id: String(block.id),
              role: 'tool',
              name: block.name,
              text: '',
              args: block.arguments,
              timestamp,
              status: 'running',
            });
    } else if (message.role === 'toolResult' || message.role === 'tool') {
      const tool = result.find((m) => m.id === message.toolCallId);
      const update = {
        text: text(message),
        status: message.isError ? ('failed' as const) : ('completed' as const),
      };
      if (tool) Object.assign(tool, update);
      else
        result.push({
          id,
          role: 'tool',
          name: message.toolName || message.name,
          timestamp,
          ...update,
        });
    }
  }
  return result.slice(-160);
}
export function beginSubSessions(
  session: StoredSession,
  callId: string,
  name: string,
  args: Record<string, unknown>,
) {
  const tasks = Array.isArray(args.tasks)
    ? args.tasks
    : Array.isArray(args.chain)
      ? args.chain
      : [args];
  for (const [index, raw] of tasks.entries()) {
    const task = object(raw),
      objective = String(task.objective || task.task || task.label || '研究子任务');
    session.subSessions.push({
      id: tasks.length === 1 ? callId : `${callId}-${index}`,
      toolCallId: callId,
      kind: name === 'research_delegate' ? 'delegate' : 'subagent',
      label: objective.slice(0, 40),
      objective,
      skill: Array.isArray(task.skills) ? task.skills.join('、') : task.agent,
      status: index && Array.isArray(args.chain) ? 'pending' : 'running',
      messages: [],
      artifacts: [],
      startedAt: Date.now(),
    });
  }
}
export function updateSubSessions(
  session: StoredSession,
  callId: string,
  result: unknown,
  finished = false,
  error = false,
) {
  const envelope = object(result),
    details = object(envelope.details);
  const group = session.subSessions.filter((s) => s.toolCallId === callId);
  const results = Array.isArray(details.results) ? details.results : [details];
  for (const [index, child] of group.entries()) {
    if (Array.isArray(details.results) && !results[index]) {
      if (finished) {
        child.status = error ? 'cancelled' : 'pending';
        child.outcome = error ? 'cancelled' : 'not_started';
        child.endedAt = Date.now();
      }
      continue;
    }
    const record = object(results[index]),
      progress = object(record.progress),
      handoff = object(record.result);
    const outcome = record.status || progress.status;
    child.status = childStatus(
      outcome,
      finished,
      Number(record.exitCode || 0) !== 0 || (error && !outcome && record.exitCode === undefined),
    );
    child.outcome = outcome;
    const id = record.id || text(result).match(/\bT-[a-f0-9-]{36}\b/)?.[0];
    if (typeof id === 'string' && /^T-[a-f0-9-]{36}$/.test(id)) child.taskId = id;
    const latest = Array.isArray(progress.recentOutput)
      ? progress.recentOutput.join('\n')
      : text(result);
    if ((latest && group.length === 1) || progress.recentOutput?.length)
      child.progress = latest.slice(-1200).replaceAll(' · ', '，');
    if (Array.isArray(record.messages) && record.messages.length)
      child.messages = childMessages(record.messages, child.id);
    if (handoff.summary) child.summary = String(handoff.summary);
    else if (finished && latest && group.length === 1) child.summary = latest;
    if (Array.isArray(handoff.artifacts))
      child.artifacts = handoff.artifacts.filter((a: unknown) => typeof a === 'string');
    if (record.sessionFile) child.sessionFile = String(record.sessionFile);
    if (finished && child.status !== 'running') child.endedAt = Date.now();
  }
}
async function internalPath(workspace: string, path: string) {
  const base = await realpath(workspace),
    target = await realpath(resolve(base, path));
  const rel = relative(base, target);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep))
    throw new Error('Child session leaves workspace');
  return target;
}
const transcriptCache = new Map<string, { modified: number; size: number; entries: unknown[] }>();
async function sessionEntries(workspace: string, path: string): Promise<unknown[]> {
  const canonical = await internalPath(workspace, path);
  const file = await open(canonical, 'r');
  try {
    const info = await file.stat();
    const cached = transcriptCache.get(canonical);
    if (cached?.modified === info.mtimeMs && cached.size === info.size) return cached.entries;
    const length = Math.min(info.size, 2 * 1024 * 1024),
      buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, info.size - length);
    const lines = buffer.toString('utf8').split('\n');
    if (info.size > length) lines.shift();
    const entries = lines.flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
    if (transcriptCache.size >= 16) transcriptCache.delete(transcriptCache.keys().next().value!);
    transcriptCache.set(canonical, { modified: info.mtimeMs, size: info.size, entries });
    return entries;
  } finally {
    await file.close();
  }
}
/** Read existing child records only; never start or prompt a Pi session. */
export async function refreshSubSessions(session: StoredSession, workspace: string) {
  for (const child of session.subSessions) {
    try {
      if (child.kind === 'delegate' && child.taskId && /^T-[a-f0-9-]{36}$/.test(child.taskId)) {
        const record = JSON.parse(
          await readFile(
            await internalPath(workspace, join('.research/tasks', child.taskId, 'task.json')),
            'utf8',
          ),
        );
        child.status = childStatus(record.status);
        child.outcome = record.status;
        child.summary = record.result?.summary || record.error;
        child.artifacts = record.result?.artifacts || [];
        child.sessionFile = record.sessionFile;
        child.startedAt = Date.parse(record.startedAt) || child.startedAt;
        if (record.finishedAt) child.endedAt = Date.parse(record.finishedAt);
      }
      if (child.sessionFile) {
        const messages = childMessages(
          await sessionEntries(workspace, child.sessionFile),
          child.id,
        );
        if (messages.length) child.messages = messages;
      }
      if (child.status !== 'running')
        for (const message of child.messages)
          if (message.status === 'running')
            message.status =
              child.status === 'cancelled'
                ? 'cancelled'
                : child.status === 'failed'
                  ? 'failed'
                  : 'completed';
    } catch {
      /* A live record or session may not have been written yet. */
    }
  }
}
