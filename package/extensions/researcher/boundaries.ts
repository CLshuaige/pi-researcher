import { mkdirSync } from 'node:fs';
import { workspacePath } from './store.ts';
/** Cooperative shell scope, not a sandbox: the command may explicitly override it. */
export function scopeBash(root: string, input: { command?: string }) {
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  const temp = workspacePath(root, '.research/tmp');
  const cache = workspacePath(root, '.research/cache');
  mkdirSync(temp, { recursive: true }); mkdirSync(cache, { recursive: true });
  input.command = `cd ${quote(root)} && export TMPDIR=${quote(temp)} XDG_CACHE_HOME=${quote(cache)} &&\n${input.command ?? ''}`;
}
