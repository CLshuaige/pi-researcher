import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const defaults = { profile: { name: '研究者', avatar: '' }, general: { theme: 'light' } };
function agentDir(root: string) {
  return resolve(root, process.env.PI_CODING_AGENT_DIR || '.pi/agent');
}
export async function readModelConfiguration(root: string) {
  for (const path of [
    join(agentDir(root), 'models.json'),
    join(root, 'package/config/models.json'),
  ]) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return { providers: {} };
}
export async function readUserSettings(root: string, dataDir: string) {
  let saved = defaults;
  try {
    saved = JSON.parse(await readFile(join(dataDir, 'user-settings.json'), 'utf8'));
  } catch {}
  const config = await readModelConfiguration(root);
  return {
    profile: { ...defaults.profile, ...saved.profile },
    general: { ...defaults.general, ...saved.general },
    providers: Object.entries(config.providers || {}).map(([id, provider]: [string, any]) => {
      const reference = String(provider.apiKey || '');
      const configured = reference.startsWith('$')
        ? !!process.env[reference.slice(1)]
        : !!(process.env[reference] || reference);
      return { id, name: provider.name || id, configured };
    }),
  };
}
export async function writeUserSettings(root: string, dataDir: string, input: any) {
  const invalid = () => {
    throw Object.assign(new Error('用户设置格式无效'), { status: 400 });
  };
  if (!input || typeof input !== 'object') invalid();
  const { profile, general, apiKeys = {} } = input;
  if (
    !profile ||
    typeof profile.name !== 'string' ||
    !profile.name.trim() ||
    profile.name.length > 40 ||
    typeof profile.avatar !== 'string' ||
    profile.avatar.length > 750000 ||
    (profile.avatar &&
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(profile.avatar)) ||
    !general ||
    !['light', 'dark', 'system'].includes(general.theme) ||
    !apiKeys ||
    typeof apiKeys !== 'object' ||
    Array.isArray(apiKeys)
  )
    invalid();
  const config = await readModelConfiguration(root);
  let credentialsChanged = false;
  for (const [provider, key] of Object.entries(apiKeys)) {
    if (
      !Object.hasOwn(config.providers || {}, provider) ||
      typeof key !== 'string' ||
      key.length > 8192
    )
      invalid();
    if ((key as string).trim()) {
      config.providers[provider].apiKey = (key as string).trim();
      credentialsChanged = true;
    }
  }
  if (credentialsChanged) {
    const dir = agentDir(root);
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'models.json');
    await writeFile(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    await chmod(path, 0o600);
  }
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    join(dataDir, 'user-settings.json'),
    JSON.stringify(
      {
        profile: { name: profile.name.trim(), avatar: profile.avatar },
        general: { theme: general.theme },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  return readUserSettings(root, dataDir);
}
