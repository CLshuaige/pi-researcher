import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ResearchSession, SessionSummary } from '../shared/types.ts';
import { defaultWorkflow } from './workflow.ts';

export interface StoredSession extends ResearchSession {
  sessionFile?: string;
  /** Workspace directory name (timestamp_projectName), relative to project root. */
  workspaceDir?: string;
}
export class SessionStore {
  readonly sessions = new Map<string, StoredSession>();
  /** Project root (parent of web/ and package/). */
  root = '';
  workspaceRoot = '';
  get workspacesRoot() {
    return this.workspaceRoot || join(this.root, 'workspace');
  }
  constructor(readonly dataDir: string) {
    mkdirSync(join(dataDir, 'sessions'), { recursive: true, mode: 0o700 });
    for (const name of readdirSync(join(dataDir, 'sessions'))) {
      if (!name.endsWith('.json')) continue;
      try {
        const session = JSON.parse(
          readFileSync(join(dataDir, 'sessions', name), 'utf8'),
        ) as StoredSession;
        if (!/^[a-zA-Z0-9-]+$/.test(session.id)) continue;
        if (session.status === 'running' || session.status === 'waiting' || session.status === 'stopping') {
          session.status = 'interrupted';
          session.notice = '上次运行已中断，可以发送消息继续研究。';
          for (const m of session.messages) {
            if (m.status === 'running') m.status = 'cancelled';
            if (m.thinkingStatus === 'running') m.thinkingStatus = 'cancelled';
          }
        }
        if (/^This operation was aborted$/i.test(session.error || '')) {
          delete session.error;
          session.notice = '研究已暂停，可发送消息继续。';
        }
        for (const m of session.messages) {
          if (m.retryStatus === 'running') {
            m.retryStatus = 'cancelled';
            m.retryError = '重试已中断，可再次重试。';
          }
        }
        for (const m of session.messages)
          if (m.thinkingStatus === 'running')
            m.thinkingStatus =
              m.status === 'failed'
                ? 'failed'
                : m.status === 'cancelled'
                  ? 'cancelled'
                  : 'completed';
        session.phase ??=
          session.mode === 'demo' || session.messages.some((m) => m.role === 'user')
            ? 'started'
            : 'draft';
        this.sessions.set(session.id, session);
      } catch {
        console.warn(`跳过损坏的会话文件：${name}`);
      }
    }
  }
  /** One editable draft per local single-user store; old records and files remain recoverable. */
  draft(): StoredSession {
    const drafts = [...this.sessions.values()]
      .filter((s) => s.mode === 'pi' && s.phase === 'draft')
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    const selected = drafts[0];
    for (const old of drafts.slice(1)) {
      old.phase = 'archived';
      this.save(old);
    }
    return selected || this.create();
  }
  get(id: string) {
    const session = this.sessions.get(id);
    if (!session || session.phase === 'archived')
      throw Object.assign(new Error('会话不存在'), { status: 404 });
    return session;
  }
  create(mode: 'pi' | 'demo' = 'pi', id: string = randomUUID()): StoredSession {
    const now = Date.now();
    const session: StoredSession = {
      id,
      phase: mode === 'demo' ? 'started' : 'draft',
      title: '新研究',
      createdAt: now,
      updatedAt: now,
      mode,
      status: 'idle',
      messages: [],
      workflow: mode === 'demo' ? defaultWorkflow() : { source: 'checklist', nodes: [], edges: [] },
      artifacts: [],
      revision: 0,
      model: '',
      thinkingLevel: 'medium',
      subSessions: [],
    };
    this.sessions.set(id, session);
    this.save(session);
    return session;
  }
  save(session: StoredSession) {
    const file = join(this.dataDir, 'sessions', `${session.id}.json`);
    const tmp = file + '.tmp';
    writeFileSync(tmp, JSON.stringify(session), { mode: 0o600 });
    renameSync(tmp, file);
  }
  list(): SessionSummary[] {
    return [...this.sessions.values()]
      .filter((s) => s.phase === 'started')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ id, title, updatedAt, mode, status }) => ({ id, title, updatedAt, mode, status }));
  }
  public(session: StoredSession): ResearchSession {
    const { sessionFile: _, ...result } = session;
    return { ...result, workspacePath: this.workspace(session.id) };
  }
  workspace(id: string) {
    const s = this.get(id);
    if (s.phase === 'draft' && !s.workspaceDir) return join(this.dataDir, 'drafts', id);
    // New-style workspace: <root>/workspace/<workspaceDir>
    if (s.workspaceDir && this.root) return join(this.workspacesRoot, s.workspaceDir);
    // Legacy fallback for sessions created before the migration
    return join(this.dataDir, 'workspaces', id);
  }
  /** Set workspace directory name and return the absolute path. */
  setWorkspaceDir(id: string, dirName: string): string {
    const s = this.get(id);
    s.workspaceDir = dirName;
    this.save(s);
    return join(this.workspacesRoot, dirName);
  }
}
