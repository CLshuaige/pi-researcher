import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { createApp } from '../server/app.ts';
import config from '../vite.config.ts';

test('Vite proxy accepts browser-origin writes and rejects cross-origin writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gewu-dev-proxy-'));
  const { app, service } = await createApp(root, join(root, 'data'));
  const api = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => api.once('listening', resolve));
  const address = api.address();
  assert(address && typeof address !== 'string');
  const proxy = config.server?.proxy?.['/api'];
  assert(proxy && typeof proxy !== 'string');
  const vite = await createServer({
    configFile: false,
    root,
    appType: 'custom',
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: true,
      proxy: { '/api': { ...proxy, target: `http://127.0.0.1:${address.port}` } },
    },
  });
  try {
    await vite.listen();
    const frontend = vite.httpServer!.address();
    assert(frontend && typeof frontend !== 'string');
    const origin = `http://127.0.0.1:${frontend.port}`;
    const create = (source: string) =>
      fetch(`${origin}/api/sessions`, {
        method: 'POST',
        headers: { Origin: source, 'Content-Type': 'application/json' },
        body: '{}',
      });
    const accepted = await create(origin);
    assert.equal(accepted.status, 201);
    const created = await accepted.json();
    assert(service.store.sessions.has(created.id));
    const count = service.store.sessions.size;
    const rejected = await create('https://unrelated.example');
    assert.equal(rejected.status, 403);
    assert.equal(service.store.sessions.size, count);
  } finally {
    await vite.close();
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
