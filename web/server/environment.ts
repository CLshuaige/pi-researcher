import { delimiter, resolve } from 'node:path';

/** Avoid borrowing Python environments from the shell that launched the web host. */
export function workspaceEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...input };
  const inherited = [env.VIRTUAL_ENV, env.CONDA_PREFIX].filter(Boolean) as string[];
  env.PATH = (env.PATH || '/usr/local/bin:/usr/bin:/bin')
    .split(':')
    .filter(
      (entry) =>
        !inherited.some((prefix) => entry === prefix || entry.startsWith(prefix + '/')) &&
        !/(?:^|\/)(?:\.venv|venv|(?:mini|ana)conda\d*|condabin)(?:\/|$)/i.test(entry),
    )
    .join(':');
  for (const key of [
    'VIRTUAL_ENV',
    'VIRTUAL_ENV_PROMPT',
    'CONDA_PREFIX',
    'CONDA_DEFAULT_ENV',
    'CONDA_SHLVL',
    'PYTHONHOME',
    'PYTHONPATH',
    'BASH_ENV',
  ])
    delete env[key];
  return env;
}

/** pi-subagents' supported read-only discovery path for file-defined project agents. */
export function researchAgentPaths(root: string, inherited = '') {
  return [
    ...new Set([...inherited.split(delimiter).filter(Boolean), resolve(root, 'package/agents')]),
  ].join(delimiter);
}
