// A process worker, owned through IPC. Losing the Pi owner cancels its process group.
import { spawn } from 'node:child_process';
import { openSync, closeSync, writeFileSync, renameSync } from 'node:fs';
let child, timer, escalation, stopping, done = false;
function kill(signal) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
function cancel(status = 'cancelled') {
  if (done || stopping) return;
  stopping = status;
  if (!child) { process.exit(0); return; }
  kill('SIGTERM');
  escalation = setTimeout(() => kill('SIGKILL'), 500);
}
process.on('disconnect', () => cancel());
process.on('SIGTERM', () => cancel());
process.on('SIGINT', () => cancel());
process.once('message', ({ command, cwd, env, logPath, exitPath, timeoutSeconds }) => {
  const finish = (exitCode, signal, error) => {
    if (done) return;
    done = true;
    clearTimeout(timer); clearTimeout(escalation);
    // A command must stay in the foreground; clean up descendants even if its shell exits first.
    kill('SIGKILL');
    const result = { status: stopping ?? (exitCode === 0 && !error ? 'succeeded' : 'failed'), finishedAt: Date.now(), exitCode, signal, ...(error ? { error: String(error) } : {}) };
    const temp = `${exitPath}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(result), { mode: 0o600 }); renameSync(temp, exitPath);
    process.exit(0);
  };
  if (!process.connected || stopping) { finish(null, null, 'Owner disconnected before start'); return; }
  let log;
  try {
    log = openSync(logPath, 'a', 0o600);
    child = spawn('/bin/bash', ['--noprofile', '--norc', '-c', command], { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', log, log] });
    child.once('error', error => finish(null, null, error));
    child.once('exit', (code, signal) => finish(code, signal));
    timer = setTimeout(() => cancel('timed_out'), timeoutSeconds * 1000);
  } catch (error) { finish(null, null, error); }
  finally { if (log !== undefined) closeSync(log); }
});
