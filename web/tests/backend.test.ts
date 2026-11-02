import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.ts';
import { flattenFiles, isVisiblePath, listArtifacts, safePath } from '../server/files.ts';
import { defaultWorkflow, parseChecklist } from '../server/workflow.ts';
import { extractLinks } from '../server/pi.ts';
import { SessionStore } from '../server/store.ts';
import { buildMessagePrompt, parseQuote } from '../server/messages.ts';
import { MAX_QUOTE_LENGTH, type ChatMessage } from '../shared/types.ts';

test('quoted follow-ups preserve source metadata and compose Pi context separately', () => {
  const source: ChatMessage = {
    id: 'answer',
    role: 'assistant',
    text: '**研究范围**需要确认。',
    timestamp: 1,
  };
  const quote = parseQuote({ messageId: 'answer', text: '研究范围需要确认。' }, [source])!;
  assert.deepEqual(quote, { messageId: 'answer', text: '研究范围需要确认。' });
  const prompt = buildMessagePrompt({
    text: '具体指什么？',
    quote,
    attachments: [{ id: 'a', name: '任务.md', path: 'uploads/a-任务.md', size: 10 }],
  });
  assert.match(prompt, /用户本次请求/);
  assert(prompt.includes(JSON.stringify(quote)));
  assert(prompt.includes('具体指什么？'));
  assert(prompt.includes('uploads/a-任务.md'));
  assert.equal(buildMessagePrompt({ text: '普通消息' }), '普通消息');
  assert.equal(parseQuote(undefined, [source]), undefined);
  assert.throws(() => parseQuote({ messageId: 'other-session', text: '片段' }, [source]));
  assert.throws(() => parseQuote({ messageId: 'answer', text: '' }, [source]));
  assert.throws(() =>
    parseQuote({ messageId: 'answer', text: '字'.repeat(MAX_QUOTE_LENGTH + 1) }, [source]),
  );
  assert.throws(() =>
    parseQuote({ messageId: 'answer', text: '片段' }, [{ ...source, role: 'user' }]),
  );
});

test('artifact view and download path reject credentials, traversal and symlinks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gewu-files-'));
  try {
    await mkdir(join(dir, 'research'));
    await mkdir(join(dir, '.pi'));
    await writeFile(join(dir, 'research/task.md'), 'task');
    await writeFile(join(dir, 'models.json'), 'private');
    await writeFile(join(dir, '.env'), 'private');
    await symlink('/etc/passwd', join(dir, 'research/escape.txt'));
    const paths = flattenFiles(await listArtifacts(dir)).map((a) => a.path);
    assert.deepEqual(paths, ['research/task.md']);
    for (const path of [
      '../.env',
      'research/../../.env',
      '/etc/passwd',
      '.pi/auth.json',
      'models.json',
      'model.json',
      'research/escape.txt',
      'research\\task.md',
    ])
      await assert.rejects(safePath(dir, path));
    assert.equal(await readFile(await safePath(dir, 'research/task.md'), 'utf8'), 'task');
    assert.equal(isVisiblePath('research/notes.md'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('Checklist validates unique IDs, real edges and finite positions', () => {
  const graph = defaultWorkflow();
  assert.equal(parseChecklist(graph).source, 'checklist');
  assert.throws(() => parseChecklist({ ...graph, nodes: [...graph.nodes, graph.nodes[0]] }));
  assert.throws(() => parseChecklist({ ...graph, edges: [{ source: 'missing', target: 'task' }] }));
  assert.throws(() => parseChecklist({ ...graph, nodes: [{ ...graph.nodes[0], x: Infinity }] }));
  assert.throws(() =>
    parseChecklist({ ...graph, nodes: [{ ...graph.nodes[0], status: 'invented' }] }),
  );
});
test('tool source extraction deduplicates links and keeps only HTTP(S)', () => {
  const links = extractLinks(
    '[Paper](https://arxiv.org/abs/1234.5678) https://arxiv.org/abs/1234.5678 javascript:alert(1)',
  );
  assert.equal(links.length, 1);
  assert.equal(links[0].url, 'https://arxiv.org/abs/1234.5678');
});
test('persisted running session becomes interrupted on restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gewu-store-'));
  try {
    const first = new SessionStore(dir);
    const s = first.create();
    s.status = 'running';
    s.messages.push({
      id: 'tool',
      role: 'tool',
      text: '',
      timestamp: Date.now(),
      status: 'running',
    });
    first.save(s);
    const second = new SessionStore(dir);
    assert.equal(second.get(s.id).status, 'interrupted');
    assert.equal(second.get(s.id).messages[0].status, 'cancelled');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('HTTP session, SSE, upload, preview, zip, steering, stop and edit contract', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gewu-api-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const { app, service } = await createApp(root, dataDir);
  service.store.workspaceRoot = join(dataDir, 'workspaces');
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  const post = (path: string, value: unknown, headers = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(value),
    });
  try {
    const badOrigin = await post('/sessions', {}, { Origin: 'https://unrelated.example' });
    assert.equal(badOrigin.status, 403);
    const response = await post('/sessions', {});
    assert.equal(response.status, 201);
    const s = await response.json();
    assert.deepEqual(s.messages, []);
    assert.equal(s.mode, 'pi');
    assert.equal('sessionFile' in s, false);
    const abort = new AbortController();
    const stream = await fetch(base + `/sessions/${s.id}/events`, { signal: abort.signal });
    assert.match(stream.headers.get('content-type') || '', /event-stream/);
    const chunk = await stream.body!.getReader().read();
    assert.match(new TextDecoder().decode(chunk.value), /event: snapshot/);
    abort.abort();
    const form = new FormData();
    form.append('files', new Blob(['# 附件内容']), '研究附件.md');
    const uploaded = await fetch(base + `/sessions/${s.id}/uploads`, {
      method: 'POST',
      body: form,
    });
    assert.equal(uploaded.status, 201);
    const files = await uploaded.json();
    assert.equal(files[0].name, '研究附件.md');
    const preview = await fetch(
      base + `/sessions/${s.id}/files/preview?path=${encodeURIComponent(files[0].path)}`,
    );
    assert.equal((await preview.json()).text, '# 附件内容');
    const badPreview = await fetch(
      base + `/sessions/${s.id}/files/preview?path=${encodeURIComponent('../.env')}`,
    );
    assert.equal(badPreview.status, 403);
    const zip = await fetch(base + '/sessions/demo/files/download');
    assert.match(zip.headers.get('content-disposition') || '', /attachment/);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    assert.equal(String.fromCharCode(...bytes.slice(0, 2)), 'PK');
    const quoted = await post('/sessions/demo/messages', {
      text: '解释这段话',
      quote: { messageId: 'demo-intro', text: '先明确研究范围和关键问题' },
    });
    assert.equal(quoted.status, 202);
    const quotedState = await quoted.json();
    const followUp = quotedState.messages.at(-1);
    assert.equal(followUp.text, '解释这段话');
    assert.deepEqual(followUp.quote, { messageId: 'demo-intro', text: '先明确研究范围和关键问题' });
    await post('/sessions/demo/stop', {});
    const quoteEdit = await post(`/sessions/demo/messages/${followUp.id}/edit`, {
      text: '进一步解释这段话',
    });
    assert.equal(quoteEdit.status, 202);
    assert.deepEqual((await quoteEdit.json()).messages.at(-1).quote, followUp.quote);
    await post('/sessions/demo/stop', {});
    const forged = await post('/sessions/demo/messages', {
      text: '解释',
      quote: { messageId: 'demo-user', text: '用户消息不是助手回答' },
    });
    assert.equal(forged.status, 400);
    const sent = await post('/sessions/demo/messages', { text: '查看流式交互' });
    assert.equal(sent.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 850));
    const steer = await post('/sessions/demo/messages', { text: '补充研究边界' });
    assert.equal(steer.status, 202);
    const steering = await steer.json();
    assert.equal(steering.messages.at(-1).queued, true);
    const stop = await post('/sessions/demo/stop', {});
    const stopped = await stop.json();
    assert.equal(stopped.status, 'idle');
    assert(!stopped.messages.some((m: { queued?: boolean }) => m.queued));
    const edited = await post('/sessions/demo/messages/demo-user/edit', {
      text: '修订后的研究问题',
    });
    assert.equal(edited.status, 202);
    const after = await edited.json();
    assert.equal(after.messages[0].text, '修订后的研究问题');
    assert.equal(after.messages.length, 1);
    await post('/sessions/demo/stop', {});
    const retainedWorkspace = service.store.workspace(s.id);
    service.changed(service.store.get(s.id));
    const deleted = await fetch(base + `/sessions/${s.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal((await fetch(base + `/sessions/${s.id}`)).status, 404);
    await assert.rejects(() => readFile(join(dataDir, 'sessions', `${s.id}.json`)), {
      code: 'ENOENT',
    });
    assert.equal(await readFile(join(retainedWorkspace, files[0].path), 'utf8'), '# 附件内容');
  } finally {
    await service.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('native research checklist modules map to Chinese nodes, dependencies and acceptance details', async () => {
  const workflow = parseChecklist({
    schemaVersion: 1,
    modules: [
      {
        id: 'scope',
        skills: ['research-task'],
        objective: '确认问题',
        status: 'awaiting_acceptance',
        dependencies: [],
        criteria: ['范围明确'],
        evidence: ['task.md'],
      },
      {
        id: 'papers',
        skills: ['research-literature'],
        objective: '检索论文',
        status: 'blocked',
        dependencies: ['scope'],
        criteria: ['可追溯来源'],
        reason: '等待数据库响应',
      },
    ],
  });
  assert.equal(workflow.source, 'checklist');
  assert.equal(workflow.nodes[0].label, '任务解析');
  assert.equal(workflow.nodes[0].statusLabel, '待验收');
  assert.deepEqual(workflow.nodes[0].evidence, ['task.md']);
  assert.equal(workflow.nodes[1].label, '文献调研');
  assert.equal(workflow.nodes[1].reason, '等待数据库响应');
  assert.deepEqual(workflow.edges, [{ source: 'scope', target: 'papers' }]);
});

test('source extraction separates escaped URLs and preserves display names', () => {
  const links = extractLinks(
    '{"sources":[{"title":"原始论文","url":"https://example.org/paper.pdf"}],"text":"https://example.org/a.csv\\nhttps://example.org/b.csv"}',
  );
  assert.equal(links.length, 3);
  assert.equal(links.find((link) => link.url.endsWith('paper.pdf'))?.title, '原始论文');
  assert(links.some((link) => link.url === 'https://example.org/a.csv'));
  assert(links.some((link) => link.url === 'https://example.org/b.csv'));
});

test('web host strips inherited project virtual environments', async () => {
  const { workspaceEnvironment } = await import('../server/environment.ts');
  const result = workspaceEnvironment({
    PATH: '/other/.venv/bin:/usr/bin:/opt/miniconda3/bin:/usr/local/bin',
    VIRTUAL_ENV: '/other/.venv',
    PYTHONPATH: '/other/site-packages',
    BLSC_API_KEY: 'kept',
  });
  assert.equal(result.PATH, '/usr/bin:/usr/local/bin');
  assert.equal(result.VIRTUAL_ENV, undefined);
  assert.equal(result.PYTHONPATH, undefined);
  assert.equal(result.BLSC_API_KEY, 'kept');
});

test('workspace rename moves artifacts and runtime paths while preserving timestamp', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gewu-rename-'));
  const { service } = await createApp(root, join(root, '.pi/web'));
  t.after(async () => {
    await service.close();
    await rm(root, { recursive: true, force: true });
  });
  const session = service.store.create();
  const oldRoot = service.store.setWorkspaceDir(
    session.id,
    `20261030-120000_新研究_${session.id.slice(0, 8)}`,
  );
  await mkdir(join(oldRoot, '.pi'), { recursive: true });
  await writeFile(join(oldRoot, 'task.md'), '# 任务');
  await writeFile(join(oldRoot, '.pi/context.json'), JSON.stringify({ cwd: oldRoot }));
  await service.rename(session, '分子性质预测');
  const target = service.store.workspace(session.id);
  assert.match(target, /20261030-120000_分子性质预测_/);
  assert.equal(await readFile(join(target, 'task.md'), 'utf8'), '# 任务');
  assert.equal(JSON.parse(await readFile(join(target, '.pi/context.json'), 'utf8')).cwd, target);
  session.status = 'running';
  await assert.rejects(() => service.rename(session, '另一个名字'), /先暂停/);
  session.status = 'idle';
});

test('user profile and API keys persist without exposing key values', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gewu-profile-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { readUserSettings, writeUserSettings } = await import('../server/user-settings.ts');
  const before = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, '.pi/agent');
  t.after(() => {
    if (before === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = before;
  });
  await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
  await writeFile(
    join(process.env.PI_CODING_AGENT_DIR, 'models.json'),
    JSON.stringify({ providers: { test: { apiKey: '' } } }),
  );
  const result = await writeUserSettings(root, join(root, 'data'), {
    profile: { name: '研究员', avatar: '' },
    general: { theme: 'dark' },
    apiKeys: { test: 'test-key-value' },
  });
  assert.equal(result.providers[0].configured, true);
  assert(!JSON.stringify(result).includes('test-key-value'));
  assert.equal((await readUserSettings(root, join(root, 'data'))).profile.name, '研究员');
  assert.equal(
    JSON.parse(await readFile(join(process.env.PI_CODING_AGENT_DIR, 'models.json'), 'utf8'))
      .providers.test.apiKey,
    'test-key-value',
  );
});

test('research controls stay out of chat bubbles and goal prefixes are stripped', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gewu-commands-'));
  const { service } = await createApp(root, join(root, 'data'));
  t.after(async () => {
    await service.close();
    await rm(root, { recursive: true, force: true });
  });
  const session = service.store.create('demo');
  await service.send(session, '/research status');
  assert.equal(session.messages.length, 0);
  await service.send(session, '/Research -- 比较预测方法');
  assert.equal(session.messages[0].text, '比较预测方法');
  assert(!session.messages[0].text.includes('/Research'));
});

test('naming uses the configured reasoning format and does not truncate instructions', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gewu-naming-'));
  const originalFetch = globalThis.fetch;
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, '.pi/agent');
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
  await writeFile(
    join(process.env.PI_CODING_AGENT_DIR, 'models.json'),
    JSON.stringify({
      providers: {
        test: {
          baseUrl: 'https://example.invalid/v1',
          api: 'openai-completions',
          apiKey: 'fixture-key',
          models: [{ id: 'test-model', compat: { thinkingFormat: 'deepseek' } }],
        },
      },
    }),
  );
  let payload: any;
  globalThis.fetch = (async (_input, init) => {
    payload = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { content: '分子性质预测' } }] });
  }) as typeof fetch;
  const { generateProjectName, fallbackProjectName } = await import('../server/naming.ts');
  assert.equal(
    await generateProjectName(root, '设计并评估一种分子预测方法', { model: 'test/test-model' }),
    '分子性质预测',
  );
  assert.deepEqual(payload.thinking, { type: 'disabled' });
  assert.equal(fallbackProjectName('请帮我在小样本条件下比较这些方法并开展实验'), '未命名研究');
});

test('common cancellation errors have a friendly Chinese display message', async () => {
  const { readableError } = await import('../shared/errors.ts');
  assert.equal(readableError('This operation was aborted'), '操作已取消，可继续研究。');
  assert.equal(readableError('需要用户确认实验预算'), '需要用户确认实验预算');
});
