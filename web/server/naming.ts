import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

interface ModelConfig {
  providers: Record<
    string,
    {
      baseUrl: string;
      apiKey: string;
      api: string;
      authHeader?: boolean;
      models: { id: string; name: string; compat?: { thinkingFormat?: string } }[];
    }
  >;
}

/**
 * Read the first available provider/model from models.json and resolve the API key
 * from environment variables.
 */
async function resolveModel(
  root: string,
  selection?: string,
): Promise<{
  baseUrl: string;
  apiKey: string;
  model: string;
  disableThinking: boolean;
} | null> {
  for (const candidate of [
    join(resolve(root, process.env.PI_CODING_AGENT_DIR || '.pi/agent'), 'models.json'),
    join(root, 'models.json'),
    join(root, 'package', 'config', 'models.json'),
  ]) {
    try {
      const config: ModelConfig = JSON.parse(await readFile(candidate, 'utf8'));
      for (const [providerId, provider] of Object.entries(config.providers)) {
        if (selection && !selection.startsWith(providerId + '/')) continue;
        if (provider.api && provider.api !== 'openai-completions') continue;
        const keyEnv = provider.apiKey.replace(/^\$/, '');
        const apiKey =
          process.env[keyEnv] || (provider.apiKey.startsWith('$') ? '' : provider.apiKey);
        if (!apiKey) continue;
        const model = selection
          ? provider.models.find((model) => model.id === selection.slice(providerId.length + 1))
          : provider.models[0];
        if (!model) continue;
        return {
          baseUrl: provider.baseUrl,
          apiKey,
          model: model.id,
          disableThinking: model.compat?.thinkingFormat === 'deepseek',
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

/** Generate a topic label without blocking research when naming is unavailable. */
export async function generateProjectName(
  root: string,
  question: string,
  options: { model?: string; onFailure?: (reason: string) => void } = {},
): Promise<string | null> {
  const fail = (reason: string) => {
    options.onFailure?.(reason);
    return null;
  };
  const resolved = await resolveModel(root, options.model);
  if (!resolved) return fail('model-not-configured');
  try {
    const response = await fetch(`${resolved.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resolved.apiKey}` },
      body: JSON.stringify({
        model: resolved.model,
        messages: [
          {
            role: 'system',
            content:
              '为科研工作空间命名。只输出一个4至8字的具体主题短语，可保留模型缩写，总长度不超过12个字符。例如：分子性质预测、湍流模型修正、小样本不确定性。不要输出任务指令、开场语、解释或标点。',
          },
          { role: 'user', content: question.slice(0, 1200) },
        ],
        max_tokens: 256,
        temperature: 0.3,
        ...(resolved.disableThinking ? { thinking: { type: 'disabled' } } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return fail(`http-${response.status}`);
    const data = await response.json();
    const raw = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!raw) return fail('empty-content');
    const name = raw
      .replace(/^(?:项目名称|研究名称|名称)[：:]\s*/, '')
      .replace(/[《》「」【】“”"'\s]/g, '')
      .replace(/[^\p{L}\p{N}-]/gu, '');
    if (!name || name.length > 12 || /^(本研究|本项目|建议|根据|我将|研究的任务)/.test(name))
      return fail('invalid-title');
    return name;
  } catch (error) {
    return fail((error as Error).name === 'TimeoutError' ? 'timeout' : 'request-failed');
  }
}

/** Format a Date as Beijing-time timestamp string: YYYYMMDD-HHmmss */
export function beijingTimestamp(date = new Date()): string {
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const y = beijing.getUTCFullYear();
  const mo = String(beijing.getUTCMonth() + 1).padStart(2, '0');
  const d = String(beijing.getUTCDate()).padStart(2, '0');
  const h = String(beijing.getUTCHours()).padStart(2, '0');
  const mi = String(beijing.getUTCMinutes()).padStart(2, '0');
  const s = String(beijing.getUTCSeconds()).padStart(2, '0');
  return `${y}${mo}${d}-${h}${mi}${s}`;
}

/** Build workspace directory name: timestamp_projectName */
export function workspaceDirName(projectName: string, date = new Date()): string {
  return `${beijingTimestamp(date)}_${projectName}`;
}

/** Keep an explicit short topic; do not turn a truncated instruction into a title. */
export function fallbackProjectName(question: string): string {
  const named = question.match(/\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+s?\b/);
  if (named && named[0].length <= 10) return named[0].replace(/s$/, '') + '研究';
  const topic = question
    .replace(/^\/(?:researcher|research)(?=\s|$)\s*(?:--)?\s*/i, '')
    .replace(/^(?:请研究|研究主题[：:]|主题[：:])\s*/, '')
    .trim();
  return topic.length >= 2 &&
    topic.length <= 12 &&
    /^[\p{L}\p{N}-]+$/u.test(topic) &&
    !/如何|为什么|请|帮我|任务是/.test(topic)
    ? topic
    : '未命名研究';
}
