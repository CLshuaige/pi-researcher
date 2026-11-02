import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Artifact } from '../shared/types.ts';

const hiddenNames = new Set([
  'node_modules',
  '__pycache__',
  'models.json',
  'model.json',
  'auth.json',
  'settings.json',
  'research-modules.json',
  'package-lock.json',
  'pnpm-lock.yaml',
]);
export function displayFilename(path: string): string {
  const name = path.split('/').pop() || path;
  return path.startsWith('inputs/')
    ? name.replace(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-/, '')
    : name;
}
export function isVisiblePath(path: string): boolean {
  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    !path.includes('\\') &&
    path
      .split('/')
      .every(
        (p) =>
          p.length > 0 && p !== '..' && !p.startsWith('.') && !hiddenNames.has(p.toLowerCase()),
      )
  );
}
export async function safePath(workspace: string, path: string): Promise<string> {
  if (!isVisiblePath(path)) throw Object.assign(new Error('文件路径不可访问'), { status: 403 });
  const base = await realpath(workspace);
  const target = resolve(base, path);
  const rel = relative(base, target);
  if (rel.startsWith('..' + sep) || isAbsolute(rel))
    throw Object.assign(new Error('文件路径不可访问'), { status: 403 });
  // Do not follow symlinks, even if they currently point inside this workspace.
  let current = base;
  for (const part of path.split('/')) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink())
      throw Object.assign(new Error('不支持符号链接下载'), { status: 403 });
  }
  const canonical = await realpath(target);
  if (canonical !== base && !canonical.startsWith(base + sep))
    throw Object.assign(new Error('文件路径不可访问'), { status: 403 });
  return canonical;
}
export async function listArtifacts(
  workspace: string,
  prefix = '',
  depth = 0,
): Promise<Artifact[]> {
  if (depth > 12) return [];
  const items: Artifact[] = [];
  const entries = await readdir(resolve(workspace, prefix), { withFileTypes: true });
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!isVisiblePath(path) || entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
      continue;
    const info = await stat(resolve(workspace, path));
    const children = entry.isDirectory()
      ? await listArtifacts(workspace, path, depth + 1)
      : undefined;
    if (entry.isDirectory() && !children?.length) continue;
    items.push({
      path,
      name: displayFilename(path),
      kind: entry.isDirectory() ? 'directory' : 'file',
      size: info.size,
      updatedAt: info.mtimeMs,
      status: 'completed',
      children,
    });
  }
  return items.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1,
  );
}
export function flattenFiles(items: Artifact[]): Artifact[] {
  return items.flatMap((a) => (a.kind === 'directory' ? flattenFiles(a.children || []) : [a]));
}
