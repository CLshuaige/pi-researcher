import { refreshSubSessions } from './sub-sessions.ts';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fallbackProjectName, generateProjectName, beijingTimestamp } from './naming.ts';
import type { Attachment, ChatMessage, MessageQuote } from '../shared/types.ts';
import { listArtifacts } from './files.ts';
import { completeDemoTools, seedDemo } from './demo.ts';
import { PiBridge } from './pi.ts';
import { SessionStore, type StoredSession } from './store.ts';
import { readChecklist } from './workflow.ts';

export class ResearchService {
  readonly store: SessionStore;
  readonly bridge: PiBridge;
  private listeners = new Map<string, Set<(s: StoredSession) => void>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private demoRuns = new Map<string, AbortController>();
  private locks = new Map<string, Promise<unknown>>();
  private refreshing = new Set<string>();
  constructor(root: string, dataDir: string) {
    this.store = new SessionStore(dataDir);
    this.bridge = new PiBridge(
      root,
      this.store,
      (s) => this.changed(s),
      (s) => this.refresh(s),
    );
  }
  async init() {
    await seedDemo(this.store);
    for (const s of this.store.sessions.values()) await this.refresh(s);
  }
  changed(s: StoredSession) {
    if (!this.store.sessions.has(s.id)) return;
    s.revision++;
    s.updatedAt = Date.now();
    if (this.timers.has(s.id)) return;
    const timer = setTimeout(() => {
      this.timers.delete(s.id);
      this.store.save(s);
      for (const listener of this.listeners.get(s.id) || []) listener(s);
    }, 45);
    this.timers.set(s.id, timer);
  }
  subscribe(id: string, listener: (s: StoredSession) => void) {
    const set = this.listeners.get(id) || new Set();
    set.add(listener);
    this.listeners.set(id, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(id);
    };
  }
  async exclusive<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    this.locks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }
  async refresh(s: StoredSession) {
    if (this.refreshing.has(s.id)) return;
    this.refreshing.add(s.id);
    try {
      const workspace = this.store.workspace(s.id);
      await mkdir(workspace, { recursive: true });
      const files = await listArtifacts(workspace);
      const before = JSON.stringify([s.artifacts, s.workflow, s.subSessions]);
      s.artifacts = files;
      if (s.mode === 'pi') {
        try {
          const checklist = await readChecklist(workspace);
          if (checklist) s.workflow = checklist;
          else s.workflow = { source: 'checklist', nodes: [], edges: [] };
        } catch (error) {
          s.error = `Checklist 暂不可用：${(error as Error).message}`;
        }
      }
      await refreshSubSessions(s, workspace);
      if (JSON.stringify([s.artifacts, s.workflow, s.subSessions]) !== before) this.changed(s);
    } finally {
      this.refreshing.delete(s.id);
    }
  }
  async rename(s: StoredSession, title: string) {
    if (s.mode === 'demo') {
      s.title = title;
      this.changed(s);
      return;
    }
    if (['running', 'stopping'].includes(s.status))
      throw Object.assign(new Error('请先暂停研究，再重命名工作空间'), { status: 409 });
    const oldRoot = this.store.workspace(s.id);
    const jobs = join(oldRoot, '.research/jobs');
    if (existsSync(jobs))
      for (const entry of await readdir(jobs)) {
        try {
          const job = JSON.parse(await readFile(join(jobs, entry, 'job.json'), 'utf8'));
          if (job.status === 'running' && !existsSync(join(jobs, entry, 'exit.json')))
            throw Object.assign(new Error('后台实验仍在运行，请结束任务后重命名'), { status: 409 });
        } catch (error) {
          if ((error as { status?: number }).status === 409) throw error;
        }
      }
    const stamp =
      s.workspaceDir?.match(/^\d{8}-\d{6}/)?.[0] || beijingTimestamp(new Date(s.createdAt));
    const name =
      title
        .replace(/[^\p{L}\p{N}_.-]/gu, '-')
        .replace(/-+/g, '-')
        .slice(0, 48) || '新研究';
    const dir = `${stamp}_${name}_${s.id.slice(0, 8)}`;
    const newRoot = join(this.store.workspacesRoot, dir);
    if (oldRoot !== newRoot) {
      await this.bridge.release(s);
      await mkdir(this.store.workspacesRoot, { recursive: true });
      if (existsSync(oldRoot)) await rename(oldRoot, newRoot);
      else await mkdir(newRoot, { recursive: true });
      // Rebase persisted runtime paths and venv entry scripts, preserving binary files.
      const rebase = async (path: string) => {
        if (!existsSync(path)) return;
        const info = await import('node:fs/promises').then((fs) => fs.lstat(path));
        if (info.isSymbolicLink()) return;
        if (info.isDirectory()) {
          for (const file of await readdir(path)) await rebase(join(path, file));
          return;
        }
        if (info.size > 8 * 1024 * 1024) return;
        const buffer = await readFile(path);
        if (!buffer.includes(0)) {
          const text = buffer.toString('utf8');
          if (text.includes(oldRoot)) await writeFile(path, text.replaceAll(oldRoot, newRoot));
        }
      };
      await rebase(join(newRoot, '.research'));
      await rebase(join(newRoot, '.pi'));
      if (s.sessionFile) await rebase(s.sessionFile);
      // Virtual environments keep absolute paths in launcher and activation scripts.
      const venvs = async (path: string) => {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
          if (entry.name === '.venv') {
            await rebase(join(path, entry.name, 'bin'));
            await rebase(join(path, entry.name, 'pyvenv.cfg'));
            await rebase(join(path, 'environment.json'));
          } else if (!entry.name.startsWith('.') && entry.name !== 'node_modules')
            await venvs(join(path, entry.name));
        }
      };
      await venvs(newRoot);
      s.messages = JSON.parse(JSON.stringify(s.messages).replaceAll(oldRoot, newRoot));
      s.subSessions = JSON.parse(JSON.stringify(s.subSessions).replaceAll(oldRoot, newRoot));
      s.workspaceDir = dir;
    }
    s.title = title;
    this.changed(s);
    await this.refresh(s);
  }
  async prepareName(s: StoredSession, text: string) {
    if (s.mode !== 'pi' || s.messages.length || s.title !== '新研究') return;
    if (
      /^\/(?:research|researcher)\s+(?:status|capabilities|inspect|pause|stop|resume|help|init)\b/i.test(
        text,
      )
    )
      return;
    text = text.replace(/^\/(?:researcher|research)(?=\s|$)\s*(?:--)?\s*/i, '');
    let reason: string | undefined;
    const generated = await generateProjectName(this.store.root, text, {
      model: s.model,
      onFailure: (failure) => {
        reason = failure;
      },
    });
    const name = generated || fallbackProjectName(text);
    await this.rename(s, name);
    const dir = join(this.store.workspace(s.id), '.pi');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'naming.json'),
      JSON.stringify(
        { name, source: generated ? 'model' : 'request', ...(reason ? { reason } : {}) },
        null,
        2,
      ),
    );
  }
  async command(s: StoredSession, command: string) {
    const normalized = command.trim().replace(/^\/(?:researcher|research)(?=\s|$)\s*/i, '');
    if (
      !/^(?:status|capabilities|help|pause|stop|resume|inspect(?:\s+\S+)?|init(?:\s+.+)?)$/.test(
        normalized,
      )
    )
      throw Object.assign(new Error('不支持的研究命令'), { status: 400 });
    if (s.mode === 'demo') s.notice = '交互演示不调用真实研究命令。';
    else await this.bridge.command(s, normalized);
    this.changed(s);
  }
  async send(
    s: StoredSession,
    text: string,
    attachments: Attachment[] = [],
    quote?: MessageQuote,
    quotes?: MessageQuote[],
  ) {
    const explicit = text.trim().match(/^\/(?:researcher|research)(?=\s|$)\s*(.*)$/i);
    if (explicit) {
      if (
        /^(?:status|capabilities|help|pause|stop|resume|inspect|init)(?:\s|$)/.test(explicit[1])
      ) {
        await this.command(s, explicit[1]);
        return;
      }
      text = explicit[1].replace(/^--\s*/, '').trim();
      if (!text && !attachments.length)
        throw Object.assign(new Error('请输入研究问题'), { status: 400 });
    }
    if (s.status === 'stopping')
      throw Object.assign(new Error('正在停止，请稍候再发送'), { status: 409 });
    await this.prepareName(s, text);
    const wasRunning = s.status === 'running';
    const m: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      text,
      attachments,
      quote,
      quotes,
      timestamp: Date.now(),
      queued: wasRunning,
    };
    if (s.messages.length === 0 && s.title === '新研究')
      s.title = fallbackProjectName(text) || attachments[0]?.name || '新研究';
    s.messages.push(m);
    s.status = 'running';
    delete s.error;
    if (s.mode === 'pi') delete s.notice;
    this.changed(s);
    if (s.mode === 'demo') {
      if (wasRunning) s.notice = '交互演示：已收到纠偏，下一步将结合新消息继续。';
      else this.runDemo(s);
    } else {
      try {
        await this.bridge.send(s, m);
      } catch (error) {
        m.queued = false;
        m.status = 'failed';
        s.error = (error as Error).message;
        if (!wasRunning) s.status = 'idle';
        this.changed(s);
        throw error;
      }
    }
    return m;
  }
  private runDemo(s: StoredSession) {
    const controller = new AbortController();
    this.demoRuns.set(s.id, controller);
    const message: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      text: '',
      timestamp: Date.now(),
      status: 'running',
    };
    const response = `收到，我们可以从这个方向继续。\n\n**当前是交互演示**，你可以检查消息的流式展示、中途补充、停止与编辑。这里不会调用模型，也不会把示例当作真实科研成果。\n\n新建研究后，格悟会通过 Pi 读取实际工具与研究产物，再将结果同步到右侧工作空间。`;
    let i = 0;
    const tick = () => {
      if (controller.signal.aborted) return;
      if (i === 0) {
        completeDemoTools(s);
        s.messages.push(message);
      }
      message.text += response.slice(i, i + 3);
      i += 3;
      this.changed(s);
      if (i < response.length) setTimeout(tick, 42);
      else {
        message.status = 'completed';
        s.status = 'idle';
        this.demoRuns.delete(s.id);
        for (const m of s.messages) m.queued = false;
        this.changed(s);
      }
    };
    setTimeout(tick, 650);
  }
  async stop(s: StoredSession) {
    if (s.mode === 'demo') {
      this.demoRuns.get(s.id)?.abort();
      this.demoRuns.delete(s.id);
      for (const m of s.messages) if (m.status === 'running') m.status = 'cancelled';
      for (const m of s.messages) m.queued = false;
      s.status = 'idle';
      this.changed(s);
    } else await this.bridge.stop(s);
  }
  async edit(s: StoredSession, messageId: string, text: string) {
    const index = s.messages.findIndex((m) => m.id === messageId && m.role === 'user');
    if (index < 0) throw Object.assign(new Error('消息不存在'), { status: 404 });
    await this.stop(s);
    if (s.mode === 'pi') {
      const manager = await this.bridge.rewind(s, s.messages[index]);
      if (manager) await this.bridge.replaceManager(s, manager);
    }
    const { attachments, quote, quotes } = s.messages[index];
    s.messages = s.messages.slice(0, index);
    return this.send(s, text, attachments, quote, quotes);
  }
  async retry(s: StoredSession, toolId: string) {
    const tool = s.messages.find((m) => m.id === toolId);
    if (tool?.role === 'assistant') {
      const previous = s.messages
        .slice(0, s.messages.indexOf(tool))
        .filter((message) => message.role === 'user')
        .at(-1);
      if (!previous) throw Object.assign(new Error('找不到对应的用户消息'), { status: 404 });
      return this.edit(s, previous.id, previous.text);
    }
    if (!tool) throw Object.assign(new Error('步骤不存在'), { status: 404 });
    await this.stop(s);
    await this.send(
      s,
      `请重试这一步：${tool.name}。上次输入：${JSON.stringify(tool.args || {})}。请先检查已有产物和状态，按当前目标重试，保留已有证据；不要直接覆盖已有实验。`,
    );
  }
  async setModel(s: StoredSession, model: string) {
    if (s.mode === 'pi') await this.bridge.setModel(s, model);
    s.model = model;
    this.changed(s);
  }
  async setThinkingLevel(s: StoredSession, level: string) {
    const valid = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    if (!valid.includes(level)) throw new Error(`无效的思考强度：${level}`);
    s.thinkingLevel = level as any;
    this.changed(s);
    // If session is live, update thinking level via bridge
    await this.bridge.setThinkingLevel(s, level as any);
  }
  async remove(s: StoredSession) {
    if (s.mode === 'demo') await this.stop(s);
    else await this.bridge.remove(s);
    clearTimeout(this.timers.get(s.id));
    this.timers.delete(s.id);
    this.listeners.delete(s.id);
    this.store.sessions.delete(s.id);
    await rm(join(this.store.dataDir, 'sessions', `${s.id}.json`), { force: true });
  }
  async close() {
    for (const controller of this.demoRuns.values()) controller.abort();
    await this.bridge.dispose();
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const s of this.store.sessions.values()) this.store.save(s);
  }
}
