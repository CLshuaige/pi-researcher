import { readableError } from '../shared/errors.ts';
import { readModelConfiguration, readUserSettings, writeUserSettings } from './user-settings.ts';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import archiver from 'archiver';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ResearchService } from './service.ts';
import { displayFilename, flattenFiles, isVisiblePath, listArtifacts, safePath } from './files.ts';
import type { Attachment } from '../shared/types.ts';
import { parseQuote, parseQuotes } from './messages.ts';
import { workspaceDirName } from './naming.ts';
import {
  syncRuntimeConfig,
  CONFIG_KEYS,
  readAllConfigs,
  readConfig,
  writeWorkspaceConfig,
  removeWorkspaceConfig,
  hasWorkspaceOverride,
  type ConfigKey,
} from './config.ts';

export async function createApp(root: string, dataDir: string) {
  const service = new ResearchService(root, dataDir);
  service.store.root = root;
  if (process.env.GEWU_WORKSPACE_DIR)
    service.store.workspaceRoot = resolve(root, process.env.GEWU_WORKSPACE_DIR);
  await service.init();
  const app = express();
  app.disable('x-powered-by');
  // This is a local, single-user host. Same-origin writes prevent drive-by browser requests.
  app.use((req, res, next) => {
    const origin = req.get('origin');
    // Allow same-origin and local dev server requests
    const host = req.get('host');
    const allowedOrigins = [
      `${req.protocol}://${host}`,
      `http://${host}`,
      `https://${host}`,
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ];
    if (origin && !allowedOrigins.includes(origin))
      return res.status(403).json({ error: '仅接受同源请求' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '20mb' }));
  const uploadDir = join(dataDir, 'upload-temp');
  await mkdir(uploadDir, { recursive: true });
  const upload = multer({ dest: uploadDir, limits: { fileSize: 32 * 1024 * 1024, files: 10 } });
  const session = (req: Request) => service.store.get(String(req.params.id));
  app.get('/api/settings/user', async (_req, res) =>
    res.json(await readUserSettings(root, dataDir)),
  );
  app.put('/api/settings/user', async (req, res) => {
    const result = await writeUserSettings(root, dataDir, req.body);
    await service.bridge.refreshModels();
    res.json(result);
  });
  app.get('/api/health', async (_req, res) => {
    // Check whether pi CLI is available
    let piAvailable = false;
    try {
      const { execFile } = await import('node:child_process');
      piAvailable = await new Promise<boolean>((resolvePromise) => {
        execFile('pi', ['--version'], { timeout: 5000 }, (err) => resolvePromise(!err));
      });
    } catch {
      /* pi not found */
    }
    // Load available models from models.json
    let models: Array<{ id: string; provider: string; name: string; reasoning?: boolean }> = [];
    try {
      const modelsConfig = await readModelConfiguration(root);
      for (const [providerId, provider] of Object.entries(modelsConfig.providers || {})) {
        const p = provider as { models?: Array<{ id: string; name: string; reasoning?: boolean }> };
        for (const m of p.models || []) {
          models.push({ id: m.id, provider: providerId, name: m.name, reasoning: m.reasoning });
        }
      }
    } catch {
      /* models.json not available */
    }
    res.json({
      ok: true,
      piVersion: '1.4.0',
      piAvailable,
      configured: (await readUserSettings(root, dataDir)).providers.some((p) => p.configured),
      model: models[0] ? `${models[0].provider}/${models[0].id}` : '',
      models,
    });
  });
  app.get('/api/sessions', (_req, res) => res.json(service.store.list()));
  app.post('/api/sessions', async (req, res) => {
    const s = service.store.create();
    const config = await readModelConfiguration(root);
    for (const [provider, value] of Object.entries(config.providers || {})) {
      const first = (value as { models?: { id: string }[] }).models?.[0];
      if (first) {
        s.model = `${provider}/${first.id}`;
        break;
      }
    }
    const dirName = workspaceDirName('新研究') + '_' + s.id.slice(0, 8);
    const wsPath = service.store.setWorkspaceDir(s.id, dirName);
    await mkdir(wsPath, { recursive: true });
    const question = String(req.body?.question || '').trim();
    if (question) await service.prepareName(s, question);
    service.changed(s);
    res.status(201).json(service.store.public(s));
  });
  app.get('/api/sessions/:id', (req, res) => res.json(service.store.public(session(req))));
  app.patch('/api/sessions/:id', async (req, res) => {
    const s = session(req);
    const title = String(req.body.title || '')
      .trim()
      .slice(0, 80);
    if (!title) return res.status(400).json({ error: '标题不能为空' });
    await service.exclusive(s.id, () => service.rename(s, title));
    res.json(service.store.public(s));
  });
  app.delete('/api/sessions/:id', async (req, res) => {
    const id = String(req.params.id);
    const s = service.store.sessions.get(id);
    if (s) await service.exclusive(id, () => service.remove(s));
    else rmSync(join(service.store.dataDir, 'sessions', `${id}.json`), { force: true });
    res.json({ ok: true });
  });
  app.get('/api/sessions/:id/events', (req, res) => {
    const s = session(req);
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const send = () =>
      res.write(
        `id: ${s.revision}\nevent: snapshot\ndata: ${JSON.stringify(service.store.public(s))}\n\n`,
      );
    send();
    const off = service.subscribe(s.id, send);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    req.on('close', () => {
      clearInterval(heartbeat);
      off();
    });
  });
  async function checkedAttachments(sid: string, raw: unknown): Promise<Attachment[]> {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > 10)
      throw Object.assign(new Error('附件格式无效'), { status: 400 });
    const result: Attachment[] = [];
    for (const a of raw) {
      if (
        !a ||
        typeof a.path !== 'string' ||
        !a.path.startsWith('inputs/') ||
        !/^[a-zA-Z0-9-]+$/.test(a.id) ||
        !a.path
          .split('/')
          .pop()
          ?.startsWith(a.id + '-')
      )
        throw Object.assign(new Error('附件无效'), { status: 400 });
      const path = await safePath(service.store.workspace(sid), a.path);
      const info = await stat(path);
      if (!info.isFile()) throw Object.assign(new Error('附件不是文件'), { status: 400 });
      result.push({
        id: a.id,
        path: a.path,
        name: a.path
          .split('/')
          .pop()!
          .slice(a.id.length + 1),
        size: info.size,
      });
    }
    return result;
  }
  const textOf = (body: unknown) => {
    const text = (body as { text?: unknown })?.text;
    if (typeof text !== 'string' || text.length > 50000)
      throw Object.assign(new Error('消息格式无效或超过长度限制'), { status: 400 });
    return text.trim();
  };
  app.post('/api/sessions/:id/commands', async (req, res) => {
    const s = session(req);
    if (typeof req.body.command !== 'string' || req.body.command.length > 12000)
      return res.status(400).json({ error: '研究命令格式无效' });
    await service.exclusive(s.id, () => service.command(s, req.body.command));
    res.json(service.store.public(s));
  });
  app.post('/api/sessions/:id/messages', async (req, res) => {
    const s = session(req);
    const text = textOf(req.body);
    const files = await checkedAttachments(s.id, req.body.attachments);
    if (!text && !files.length) return res.status(400).json({ error: '请输入消息或添加附件' });
    await service.exclusive(s.id, () => {
      const quotes = parseQuotes(req.body.quotes, s.messages);
      const quote = quotes?.length ? undefined : parseQuote(req.body.quote, s.messages);
      return service.send(s, text, files, quote, quotes);
    });
    res.status(202).json(service.store.public(s));
  });
  app.post('/api/sessions/:id/stop', async (req, res) => {
    const s = session(req);
    await service.exclusive(s.id, () => service.stop(s));
    res.json(service.store.public(s));
  });
  app.post('/api/sessions/:id/messages/:messageId/edit', async (req, res) => {
    const s = session(req);
    const text = textOf(req.body);
    if (!text) return res.status(400).json({ error: '消息不能为空' });
    await service.exclusive(s.id, () => service.edit(s, String(req.params.messageId), text));
    res.status(202).json(service.store.public(s));
  });
  app.post('/api/sessions/:id/tools/:toolId/retry', async (req, res) => {
    const s = session(req);
    await service.exclusive(s.id, () => service.retry(s, String(req.params.toolId)));
    res.status(202).json(service.store.public(s));
  });
  app.post('/api/sessions/:id/questions/:questionId', (req, res) => {
    const s = session(req);
    const value = String(req.body.value || '').slice(0, 12000);
    service.bridge.answer(s, String(req.params.questionId), value);
    res.json({ ok: true });
  });
  // Model and thinking level control
  app.post('/api/sessions/:id/model', async (req, res) => {
    const s = session(req);
    const model = String(req.body.model || '');
    if (!model) return res.status(400).json({ error: '模型不能为空' });
    try {
      await service.setModel(s, model);
      res.json(service.store.public(s));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  app.post('/api/sessions/:id/thinking-level', async (req, res) => {
    const s = session(req);
    const level = String(req.body.level || '');
    if (!level) return res.status(400).json({ error: '思考强度不能为空' });
    try {
      await service.setThinkingLevel(s, level as any);
      res.json(service.store.public(s));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });
  app.post(
    '/api/sessions/:id/uploads',
    (req, _res, next) => {
      session(req);
      next();
    },
    upload.array('files', 10),
    async (req, res) => {
      const s = session(req);
      const workspace = service.store.workspace(s.id);
      await mkdir(join(workspace, 'inputs'), { recursive: true });
      const files: Attachment[] = [];
      for (const f of (req.files || []) as Express.Multer.File[]) {
        // Multer decodes multipart names as latin1; browser File names are UTF-8.
        const decoded = Buffer.from(f.originalname, 'latin1').toString('utf8');
        const name =
          decoded
            .replace(/[\\/\x00-\x1f]/g, '_')
            .replace(/^\.+/, '')
            .slice(0, 150) || 'attachment';
        const id = randomUUID();
        const path = `inputs/${id}-${name}`;
        if (!isVisiblePath(path)) throw Object.assign(new Error('不支持此附件名'), { status: 400 });
        await rename(f.path, join(workspace, path));
        files.push({ id, name, path, size: f.size });
      }
      await service.refresh(s);
      res.status(201).json(files);
    },
  );
  app.get('/api/sessions/:id/files/preview', async (req, res) => {
    const s = session(req);
    const path = String(req.query.path || '');
    // Image files: serve inline for preview
    if (/\.(png|jpe?g|gif|webp|pdf)$/i.test(path)) {
      const target = await safePath(service.store.workspace(s.id), path);
      return res.sendFile(target);
    }
    const full = await safePath(service.store.workspace(s.id), path);
    const info = await stat(full);
    if (!info.isFile() || info.size > 16 * 1024 * 1024)
      return res.status(415).json({ error: '此文件请下载后查看（预览上限 16 MB）' });
    const buffer = await readFile(full);
    if (buffer.includes(0)) return res.status(415).json({ error: '此文件请下载后查看' });
    res.json({ text: buffer.toString('utf8') });
  });
  app.put('/api/sessions/:id/files/content', async (req, res) => {
    const s = session(req);
    const path = String(req.query.path || '');
    if (
      !/\.(md|markdown|txt|json|jsonl|yaml|yml|toml|py|ts|tsx|js|jsx|sh|csv|css|html|xml|sql)$/i.test(
        path,
      ) ||
      typeof req.body.text !== 'string'
    )
      return res.status(400).json({ error: '不支持编辑此文件' });
    if (Buffer.byteLength(req.body.text, 'utf8') > 16 * 1024 * 1024)
      return res.status(413).json({ error: '文本文件上限为 16 MB' });
    const target = await safePath(service.store.workspace(s.id), path);
    if (!(await stat(target)).isFile()) return res.status(400).json({ error: '请选择文件' });
    await writeFile(target, req.body.text, 'utf8');
    await service.refresh(s);
    res.json({ ok: true });
  });
  app.get('/api/sessions/:id/files/download', async (req, res) => {
    const s = session(req);
    const workspace = service.store.workspace(s.id);
    const path = String(req.query.path || '');
    if (path) {
      const target = await safePath(workspace, path);
      const info = await stat(target);
      if (info.isFile()) return res.download(target, displayFilename(path));
    }
    const tree = await listArtifacts(workspace);
    const files = flattenFiles(tree).filter((f) => !path || f.path.startsWith(path + '/'));
    res.attachment(
      (path ? path.split('/').pop() : s.title.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 70)) +
        '.zip',
    );
    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('error', (error) => {
      if (!res.headersSent) res.status(500).json({ error: error.message });
      else res.destroy(error);
    });
    res.on('close', () => zip.abort());
    zip.pipe(res);
    for (const file of files) {
      const full = await safePath(workspace, file.path);
      zip.file(full, { name: file.path });
    }
    await zip.finalize();
  });
  app.post('/api/sessions/:id/files/delete', async (req, res) => {
    const s = session(req);
    const workspace = service.store.workspace(s.id);
    const path = String(req.body.path || '');
    if (!path) return res.status(400).json({ error: '路径不能为空' });
    try {
      const target = await safePath(workspace, path);
      const { rm } = await import('node:fs/promises');
      await rm(target, { recursive: true });
      await service.refresh(s);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  // ── Configuration API ──────────────────────────────────────────
  // Read effective config for a session (workspace override > package default)
  app.get('/api/sessions/:id/config', async (req, res) => {
    const s = session(req);
    const ws = service.store.workspace(s.id);
    const configs = await readAllConfigs(root, ws);
    const overrides: Record<string, boolean> = {};
    for (const key of CONFIG_KEYS) overrides[key] = hasWorkspaceOverride(ws, key);
    res.json({ configs, overrides });
  });
  // Read a single config key
  app.get('/api/sessions/:id/config/:key', async (req, res) => {
    const s = session(req);
    const key = String(req.params.key) as ConfigKey;
    if (!CONFIG_KEYS.includes(key)) return res.status(400).json({ error: `未知的配置项：${key}` });
    const ws = service.store.workspace(s.id);
    const value = await readConfig(root, ws, key);
    const overridden = hasWorkspaceOverride(ws, key);
    res.json({ key, value, overridden });
  });
  // Write (patch) a workspace-level config override
  app.put('/api/sessions/:id/config/:key', async (req, res) => {
    const s = session(req);
    const key = String(req.params.key) as ConfigKey;
    if (!CONFIG_KEYS.includes(key)) return res.status(400).json({ error: `未知的配置项：${key}` });
    const value = req.body;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return res.status(400).json({ error: '配置必须是 JSON 对象' });
    const ws = service.store.workspace(s.id);
    if (key === 'research-modules') await syncRuntimeConfig(root, ws, value);
    await writeWorkspaceConfig(ws, key, value);
    res.json({ key, value, overridden: true });
  });
  // Remove workspace override → revert to default
  app.delete('/api/sessions/:id/config/:key', async (req, res) => {
    const s = session(req);
    const key = String(req.params.key) as ConfigKey;
    if (!CONFIG_KEYS.includes(key)) return res.status(400).json({ error: `未知的配置项：${key}` });
    const ws = service.store.workspace(s.id);
    await removeWorkspaceConfig(ws, key);
    if (key === 'research-modules') await syncRuntimeConfig(root, ws);
    const value = await readConfig(root, ws, key);
    res.json({ key, value, overridden: false });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
  const dist = join(root, 'web/dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('/{*splat}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  app.use(
    (
      error: Error & { status?: number; code?: string },
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      const status =
        error.status ||
        (error.code === 'ENOENT' ? 404 : error instanceof multer.MulterError ? 400 : 500);
      let message = error.message;
      for (const [key, value] of Object.entries(process.env))
        if (/KEY|TOKEN|SECRET|PASSWORD/.test(key) && value && value.length > 6)
          message = message.split(value).join('[redacted]');
      if (!res.headersSent) res.status(status).json({ error: readableError(message) });
    },
  );
  return { app, service };
}
