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
        if (session.status === 'running' || session.status === 'stopping') {
          session.status = 'interrupted';
          session.notice = '上次运行已中断，可以发送消息继续研究。';
          for (const m of session.messages) if (m.status === 'running') m.status = 'cancelled';
        }
        if (/^This operation was aborted$/i.test(session.error || '')) {
          delete session.error;
          session.notice = '研究已暂停，可发送消息继续。';
        }
        this.sessions.set(session.id, session);
      } catch {
        console.warn(`跳过损坏的会话文件：${name}`);
      }
    }
  }
  get(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw Object.assign(new Error('会话不存在'), { status: 404 });
    return session;
  }
  create(mode: 'pi' | 'demo' = 'pi', id: string = randomUUID()): StoredSession {
    const now = Date.now();
    const session: StoredSession = {
      id,
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
      thinkingLevel: 'low',
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
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ id, title, updatedAt, mode, status }) => ({ id, title, updatedAt, mode, status }));
  }
  public(session: StoredSession): ResearchSession {
    const { sessionFile: _, ...result } = session;
    return { ...result, workspacePath: this.workspace(session.id) };
  }
  workspace(id: string) {
    const s = this.get(id);
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
