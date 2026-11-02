import { RESEARCH_STAGE_LABELS } from '../shared/research.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workflow, StepStatus, Artifact } from '../shared/types.ts';

export function defaultWorkflow(): Workflow {
  return {
    source: 'default',
    nodes: [
      {
        id: 'task',
        label: '任务解析',
        description: '明确研究目标和范围',
        status: 'pending',
        x: 20,
        y: 0,
      },
      {
        id: 'literature',
        label: '文献调研',
        description: '收集和分析相关研究',
        status: 'pending',
        x: 20,
        y: 96,
      },
      {
        id: 'method',
        label: '方法设计',
        description: '设计可验证的研究方案',
        status: 'pending',
        x: 20,
        y: 192,
      },
      {
        id: 'experiment',
        label: '实验执行',
        description: '运行实验并收集证据',
        status: 'pending',
        x: 20,
        y: 288,
      },
      {
        id: 'report',
        label: '论文撰写',
        description: '组织论点与研究成果',
        status: 'pending',
        x: 20,
        y: 384,
      },
      {
        id: 'review',
        label: '综述撰写',
        description: '生成完整文献综述',
        status: 'pending',
        optional: true,
        x: 220,
        y: 96,
      },
      {
        id: 'analysis',
        label: '结果分析',
        description: '分析实际实验结果',
        status: 'pending',
        optional: true,
        x: 220,
        y: 288,
      },
    ],
    edges: [
      { source: 'task', target: 'literature' },
      { source: 'literature', target: 'method' },
      { source: 'method', target: 'experiment' },
      { source: 'experiment', target: 'report' },
      { source: 'literature', target: 'review', optional: true },
      { source: 'experiment', target: 'analysis', optional: true },
    ],
  };
}
const statuses = new Set<StepStatus>(['pending', 'running', 'completed', 'failed', 'cancelled']);
export function parseChecklist(value: unknown): Workflow {
  if (!value || typeof value !== 'object') throw new Error('Checklist 必须是对象');
  const checklist = value as any;
  if (Array.isArray(checklist.modules)) {
    const names = RESEARCH_STAGE_LABELS;
    const labels: Record<string, string> = {
      pending: '等待中',
      running: '进行中',
      awaiting_acceptance: '待验收',
      completed: '已完成',
      blocked: '已阻塞',
      skipped: '已跳过',
    };
    const ids = new Set(checklist.modules.map((m: any) => m.id));
    if (ids.size !== checklist.modules.length) throw new Error('Checklist 模块 ID 重复');
    return {
      source: 'checklist',
      ...(['running', 'waiting', 'paused', 'stopped', 'completed'].includes(
        checklist.control?.state,
      )
        ? {
            control: {
              state: checklist.control.state,
              ...(Number.isFinite(checklist.control.wakeAt)
                ? { wakeAt: checklist.control.wakeAt }
                : {}),
            },
          }
        : {}),
      nodes: checklist.modules.map((m: any, i: number) => ({
        id: m.id,
        label:
          (m.skills || []).map((skill: string) => names[skill] || skill).join(' / ') ||
          names['research-' + m.id] ||
          m.id,
        description: m.objective,
        status:
          m.status === 'completed'
            ? 'completed'
            : m.status === 'running' || m.status === 'awaiting_acceptance'
              ? 'running'
              : m.status === 'blocked'
                ? 'failed'
                : m.status === 'skipped'
                  ? 'cancelled'
                  : 'pending',
        statusLabel: labels[m.status] || m.status,
        criteria: m.criteria || [],
        evidence: m.evidence || [],
        reason: m.reason || '',
        x: 20,
        y: i * 150,
      })),
      edges: checklist.modules.flatMap((m: any) =>
        (m.dependencies || []).map((source: string) => {
          if (!ids.has(source)) throw new Error('Checklist 依赖不存在');
          return { source, target: m.id };
        }),
      ),
    };
  }
  const { nodes, edges } = value as Workflow;
  if (!Array.isArray(nodes) || nodes.length > 60 || !Array.isArray(edges) || edges.length > 150)
    throw new Error('Checklist 节点或连线格式无效');
  const ids = new Set<string>();
  for (const n of nodes) {
    if (
      !n ||
      typeof n.id !== 'string' ||
      ids.has(n.id) ||
      typeof n.label !== 'string' ||
      !statuses.has(n.status) ||
      !Number.isFinite(n.x) ||
      !Number.isFinite(n.y)
    )
      throw new Error('Checklist 节点格式无效');
    ids.add(n.id);
  }
  for (const e of edges)
    if (!e || !ids.has(e.source) || !ids.has(e.target))
      throw new Error('Checklist 连线引用不存在的节点');
  return {
    source: 'checklist',
    nodes: nodes.map((n) => ({ ...n, description: String(n.description || '') })),
    edges,
  };
}
export async function readChecklist(workspace: string): Promise<Workflow | undefined> {
  for (const path of [
    'checklist.json',
    '.research/checklist/latest.json',
    '.research/checklist.json',
    'research/checklist.json',
  ]) {
    try {
      return parseChecklist(JSON.parse(await readFile(join(workspace, path), 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}
export function markStage(workflow: Workflow, stage: string | undefined, status: StepStatus) {
  if (workflow.source !== 'default' || !stage) return;
  const node = workflow.nodes.find((n) => n.id === stage);
  if (node) node.status = status;
}
export function stageForTool(name: string, args: Record<string, unknown> = {}): string | undefined {
  if (name === 'research_delegate') {
    const skills = Array.isArray(args.skills) ? args.skills : [];
    for (const [skill, stage] of [
      ['research-literature', 'literature'],
      ['research-experiment', 'experiment'],
      ['research-report', 'report'],
      ['research-method', 'method'],
      ['research-task', 'task'],
    ]) {
      if (skills.includes(skill)) return stage;
    }
  }
  if (/search|fetch_arxiv|paper_lookup|paper_citations/.test(name)) return 'literature';
  if (name.startsWith('engine_')) return 'experiment';
}
export function markArtifactStages(workflow: Workflow, artifacts: Artifact[]) {
  for (const a of artifacts) {
    if (a.kind === 'directory') {
      markArtifactStages(workflow, a.children || []);
      continue;
    }
    const stage = (
      {
        'task.md': 'task',
        'literature.md': 'literature',
        'method.md': 'method',
        'result.md': 'experiment',
        'literature-review.md': 'review',
      } as Record<string, string>
    )[a.name];
    if (stage) markStage(workflow, stage, 'completed');
  }
}
