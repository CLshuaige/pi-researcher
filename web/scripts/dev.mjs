import { spawn } from 'node:child_process';
const processGroups = process.platform !== 'win32';
const children = ['dev:server', 'dev:client'].map((script) =>
  spawn('npm', ['run', script], {
    stdio: 'inherit',
    cwd: new URL('../', import.meta.url),
    detached: processGroups,
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
