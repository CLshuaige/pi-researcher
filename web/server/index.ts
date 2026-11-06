import { workspaceEnvironment, researchAgentPaths } from './environment.ts';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (existsSync(resolve(root, '.env'))) loadEnvFile(resolve(root, '.env'));
const cleanEnvironment = workspaceEnvironment(process.env);
for (const key of Object.keys(process.env)) if (!(key in cleanEnvironment)) delete process.env[key];
Object.assign(process.env, cleanEnvironment);
process.env.PI_CODING_AGENT_DIR = resolve(root, process.env.PI_CODING_AGENT_DIR || '.pi/agent');
// Workspace sessions have their own .pi directory, so expose the package's file-defined agents
// through the plugin's launcher API instead of relying on ancestor package discovery.
process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS = researchAgentPaths(
  root,
  process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS,
);
if (['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'].some((name) => process.env[name]))
  process.env.NODE_USE_ENV_PROXY ??= '1';
// Apply the pinned plugin compatibility fix before importing its runtime.
execFileSync(process.execPath, [resolve(root, 'scripts/setup.mjs'), '--patch-timeouts']);
const { configureNetwork } = await import('./network.ts');
configureNetwork();
// Load the SDK after the environment: its configuration directory is resolved at import time.
const { createApp } = await import('./app.ts');
const { app, service } = await createApp(
  root,
  resolve(root, process.env.GEWU_DATA_DIR || '.pi/web'),
);
const port = Number(process.env.API_PORT || 3001);
const server = app.listen(port, '127.0.0.1', () =>
  console.log(`格悟 API，http://127.0.0.1:${port}`),
);
// Rebind persisted native runs after the server can already serve its UI.
void service.resumeAfterRestart().catch(error => console.error('研究自动接续失败：', error));
const refresh = setInterval(() => {
  for (const s of service.store.sessions.values()) void service.refresh(s).catch(() => {});
}, 1600);
async function shutdown() {
  clearInterval(refresh);
  server.close();
  await service.close();
  server.closeAllConnections();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
