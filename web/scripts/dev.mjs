import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const testing = process.argv.includes('--test');
const env = { ...process.env };
if (testing) {
  env.GEWU_PORT = env.GEWU_TEST_API_PORT || '3004';
  env.GEWU_CLIENT_PORT = env.GEWU_TEST_CLIENT_PORT || '3003';
  env.GEWU_API_TARGET = `http://127.0.0.1:${env.GEWU_PORT}`;
  env.GEWU_DATA_DIR = env.GEWU_TEST_DATA_DIR || '.pi/web-test';
  env.GEWU_WORKSPACE_DIR = env.GEWU_TEST_WORKSPACE_DIR || '.pi/web-test/workspaces';
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const originalAgentDir = resolve(root, env.PI_CODING_AGENT_DIR || '.pi/agent');
  env.PI_CODING_AGENT_DIR = resolve(root, env.GEWU_TEST_AGENT_DIR || `${env.GEWU_DATA_DIR}/agent`);
  mkdirSync(env.PI_CODING_AGENT_DIR, { recursive: true, mode: 0o700 });
  // Seed configuration once. Subsequent test changes stay in the test agent directory.
  for (const name of ['models.json', 'auth.json', 'settings.json', 'academic-search.json']) {
    const source = resolve(originalAgentDir, name);
    const target = resolve(env.PI_CODING_AGENT_DIR, name);
    if (existsSync(source) && !existsSync(target)) {
      copyFileSync(source, target);
      chmodSync(target, 0o600);
    }
  }
  console.log(`测试前端：http://127.0.0.1:${env.GEWU_CLIENT_PORT}，API：${env.GEWU_API_TARGET}`);
}
const processGroups = process.platform !== 'win32';
const children = ['dev:server', 'dev:client'].map((script) =>
  spawn('npm', ['run', script], {
    stdio: 'inherit',
    cwd: new URL('../', import.meta.url),
    detached: processGroups,
    env,
  }),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      if (processGroups && child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
for (const child of children)
  child.on('exit', (code) => {
    if (!stopping) stop(code || 0);
  });
