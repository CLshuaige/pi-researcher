import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResearchModule } from './checklist.ts';
import { workspacePath } from './store.ts';

const stageSkills = ['research-hypothesis', 'research-method'] as const;
type StageSkill = typeof stageSkills[number];

function isWithin(parent: string, child: string) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function skillPaths(skill: StageSkill) {
  const directory = fileURLToPath(new URL(`../../skills/${skill}/`, import.meta.url));
  return {
    roles: resolve(directory, 'references/roles.md'),
    output: resolve(directory, 'references/output.md'),
  };
}

function taskContext(root: string, module: ResearchModule, skill: StageSkill, outputDir: string, cwd: string) {
  const refs = skillPaths(skill);
  return `\n\n研究委派上下文：项目根目录（材料根目录）为 ${root}；当前阶段节点 ID 为 ${module.id}，阶段为 ${skill}。读取角色参考 ${refs.roles} 和输出要求 ${refs.output}。本次产物目录为 ${outputDir}；只写入该目录，不修改共享阶段文件。先读取项目根目录的最新 .pi/research-modules.json 配置，并按任务指定的输入材料完成角色工作。最终必须返回 JSON handoff，字段包含 status（completed、partial 或 blocked）、artifacts（真实产物绝对路径数组）、summary（具体工作小结）；没有产物时用空数组并说明原因。执行工作目录为 ${cwd}。`;
}

/** Normalize only start/execution calls for an active hypothesis or method module. */
export function normalizeRoleDelegation(root: string, module: ResearchModule, input: Record<string, unknown>): void {
  const skill = stageSkills.find(name => module.skills.includes(name));
  if (!skill || (input.action !== undefined && input.action !== 'start')) return;

  const projectRoot = resolve(root);
  // workspacePath canonicalizes existing roots and rejects symlink escapes.
  const safeRoot = workspacePath(projectRoot, '.');
  const options = input.options && typeof input.options === 'object' && !Array.isArray(input.options)
    ? input.options as Record<string, unknown>
    : {};
  const args = input.args && typeof input.args === 'object' && !Array.isArray(input.args)
    ? input.args as Record<string, unknown>
    : {};
  const tasks = args.tasks;
  if (tasks !== undefined && !Array.isArray(tasks)) throw new Error('args.tasks must be an array');
  if (Array.isArray(tasks) && tasks.length === 0) throw new Error('args.tasks must contain at least one task');
  const stageDir = module.followup?.outputDir ?? (skill === 'research-hypothesis' ? 'hypothese' : 'method');
  const runId = randomUUID();
  const baseRel = `${stageDir}/delegations/${module.id}/${runId}`;

  const resolveCwd = (value: unknown, fallback: string, name: string) => {
    const supplied = value === undefined ? fallback : requireString(value, name);
    return workspacePath(safeRoot, supplied);
  };

  if (Array.isArray(tasks) && tasks.length > 0) {
    if (input.agent !== undefined || input.task !== undefined) {
      throw new Error('Parallel delegation cannot mix args.tasks with top-level agent or task');
    }
    const normalized = tasks.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`args.tasks[${index}] must be an object`);
      const item = raw as Record<string, unknown>;
      const alias = item.agent === undefined ? 'delegate' : requireString(item.agent, `args.tasks[${index}].agent`);
      if (alias !== 'delegate' && alias !== skill) {
        throw new Error(`args.tasks[${index}].agent must be delegate or the current skill ${skill}; cross-stage delegation is not allowed`);
      }
      const fallback = workspacePath(safeRoot, `${baseRel}/H${index + 1}`);
      const cwd = resolveCwd(item.cwd, fallback, `args.tasks[${index}].cwd`);
      const outputDir = cwd;
      return {
        agent: 'delegate',
        task: requireString(item.task, `args.tasks[${index}].task`) + taskContext(safeRoot, module, skill, outputDir, cwd),
        cwd,
        ...(typeof item.model === 'string' && item.model.trim() ? { model: item.model } : {}),
      };
    });
    for (let i = 0; i < normalized.length; i++) {
      for (let j = i + 1; j < normalized.length; j++) {
        if (isWithin(normalized[i].cwd, normalized[j].cwd) || isWithin(normalized[j].cwd, normalized[i].cwd)) {
          throw new Error(`Parallel task directories must be distinct and non-overlapping: ${normalized[i].cwd} and ${normalized[j].cwd}`);
        }
      }
    }
    for (const item of normalized) mkdirSync(item.cwd, { recursive: true });
    input.workflow = 'parallel';
    input.args = { ...args, tasks: normalized };
    delete input.action;
    delete input.agent;
    delete input.task;
    delete options.script;
    input.cwd = safeRoot;
    input.async = true;
    input.output = false;
    input.options = { ...options, context: 'fresh', outputMode: 'inline' };
    return;
  }

  const alias = input.agent === undefined ? 'delegate' : requireString(input.agent, 'agent');
  if (alias !== 'delegate' && alias !== skill) {
    throw new Error(`agent must be delegate or the current skill ${skill}; cross-stage delegation is not allowed`);
  }
  const outputRel = module.followup?.outputDir ?? `${skill === 'research-hypothesis' ? 'hypothese' : 'method'}/delegations/${module.id}/${runId}`;
  const cwd = resolveCwd(input.cwd, workspacePath(safeRoot, outputRel), 'cwd');
  const outputDir = cwd;
  mkdirSync(cwd, { recursive: true });
  input.agent = 'delegate';
  input.task = requireString(input.task, 'task') + taskContext(safeRoot, module, skill, outputDir, cwd);
  input.cwd = cwd;
  delete input.action;
  input.async = true;
  delete input.workflow;
  delete input.args;
  delete options.script;
  input.output = false;
  input.options = { ...options, context: 'fresh', outputMode: 'inline' };
}
