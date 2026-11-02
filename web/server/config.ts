import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Layered configuration: workspace overrides take precedence over package defaults.
 *
 * Default configs live in  <root>/package/config/
 * Workspace overrides live in <workspace>/.gewu/config/
 *
 * When the user hasn't changed anything, the workspace file simply doesn't exist
 * and the default is returned.
 */

const CONFIG_DIR = '.gewu/config';

/** Names of known config files (without extension). */
export const CONFIG_KEYS = ['research', 'research-modules', 'web-search', 'models'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

function defaultPath(root: string, key: ConfigKey): string {
  return join(root, 'package', 'config', `${key}.json`);
}

function workspacePath(workspace: string, key: ConfigKey): string {
  return join(workspace, CONFIG_DIR, `${key}.json`);
}

/** Read a config value: workspace override first, then package default. */
export async function readConfig(
  root: string,
  workspace: string,
  key: ConfigKey,
): Promise<Record<string, unknown>> {
  const wsPath = workspacePath(workspace, key);
  if (existsSync(wsPath)) {
    try {
      return JSON.parse(await readFile(wsPath, 'utf8'));
    } catch {
      // Corrupted workspace config → fall through to default
    }
  }
  const defPath = defaultPath(root, key);
  if (existsSync(defPath)) {
    return JSON.parse(await readFile(defPath, 'utf8'));
  }
  return {};
}

/** Write a workspace-level config override. */
export async function writeWorkspaceConfig(
  workspace: string,
  key: ConfigKey,
  value: Record<string, unknown>,
): Promise<void> {
  const dir = join(workspace, CONFIG_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(workspacePath(workspace, key), JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  });
}

/** Remove a workspace-level override (revert to default). */
export async function removeWorkspaceConfig(workspace: string, key: ConfigKey): Promise<void> {
  const { rm } = await import('node:fs/promises');
  await rm(workspacePath(workspace, key), { force: true });
}

/** Check whether a workspace has an override for a given key. */
export function hasWorkspaceOverride(workspace: string, key: ConfigKey): boolean {
  return existsSync(workspacePath(workspace, key));
}

/** Return the effective config for all known keys. */
export async function readAllConfigs(
  root: string,
  workspace: string,
): Promise<Record<ConfigKey, Record<string, unknown>>> {
  const result = {} as Record<ConfigKey, Record<string, unknown>>;
  for (const key of CONFIG_KEYS) {
    result[key] = await readConfig(root, workspace, key);
  }
  return result;
}

/** Materialize only fields understood by the existing research skills. */
export async function syncRuntimeConfig(
  root: string,
  workspace: string,
  input?: Record<string, unknown>,
): Promise<void> {
  const value = input ?? (await readConfig(root, workspace, 'research-modules'));
  const literature = value.literature as Record<string, unknown> | undefined;
  const runtime = {
    hypothesis: value.hypothesis ?? { max_debate_iterations: 5 },
    method: value.method ?? { max_debate_iterations: 5 },
    interactionMode: value.interactionMode ?? 'auto',
    literature: {
      sources: literature?.sources ?? [
        'arxiv',
        'openalex',
        'semantic_scholar',
        'crossref',
        'pubmed',
        'dblp',
      ],
      writeReview: literature?.writeReview ?? false,
    },
  };
  if (
    !['auto', 'review'].includes(String(runtime.interactionMode)) ||
    !Array.isArray(runtime.literature.sources) ||
    runtime.literature.sources.some(
      (s) =>
        !['arxiv', 'openalex', 'semantic_scholar', 'crossref', 'pubmed', 'dblp'].includes(
          String(s),
        ),
    ) ||
    typeof runtime.literature.writeReview !== 'boolean'
  )
    throw Object.assign(new Error('科研参数格式无效'), { status: 400 });
  for (const stage of [runtime.hypothesis, runtime.method]) {
    const count = (stage as { max_debate_iterations?: unknown }).max_debate_iterations ?? 5;
    if (!Number.isInteger(count) || Number(count) < 1 || Number(count) > 20)
      throw Object.assign(new Error('讨论轮数必须是 1–20 的整数'), { status: 400 });
  }
  await mkdir(join(workspace, '.pi'), { recursive: true });
  await writeFile(join(workspace, '.pi/research-modules.json'), JSON.stringify(runtime, null, 2), {
    mode: 0o600,
  });
  const keys = value.apiKeys as Record<string, string> | undefined;
  if (keys) {
    const dir = process.env.PI_CODING_AGENT_DIR || join(root, '.pi/agent');
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'academic-search.json');
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(await readFile(path, 'utf8'));
    } catch {}
    for (const [source, field] of Object.entries({
      openalex: 'openAlexApiKey',
      semantic_scholar: 'semanticScholarApiKey',
      pubmed: 'ncbiApiKey',
    })) {
      if (source in keys) config[field] = keys[source]?.trim() || null;
    }
    await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  }
}
