import type { ResearchSession } from './types';

export function isResearchRunning(session: Pick<ResearchSession, 'status' | 'workflow'>): boolean {
  return (
    session.status === 'running' ||
    session.status === 'waiting' ||
    (session.status === 'idle' && session.workflow.control?.state === 'waiting')
  );
}

export const RESEARCH_STAGE_LABELS: Record<string, string> = {
  'research-task': '任务解析',
  'research-literature': '文献调研',
  'research-hypothesis': '研究假设',
  'research-method': '方法设计',
  'research-experiment': '实验执行',
  'research-report': '论文撰写',
  'research-review': '反馈评估',
};

// Agent identifiers stay stable; presentation names can change independently.
const RESEARCH_AGENT_LABELS: Record<string, string> = {
  'research-task': '任务规划助手',
  'research-literature': '文献调研助手',
  'research-hypothesis': '研究假设助手',
  'research-method': '方法设计助手',
  'research-experiment': '实验执行助手',
  'research-report': '报告撰写助手',
  'research-review': '研究评审助手',
};
export function researchAgentRole(skills?: string) {
  for (const skill of skills?.split(/[、,]/) || []) {
    const name = skill.trim().split(/[:/]/).at(-1) || '';
    if (RESEARCH_AGENT_LABELS[name]) return { name, label: RESEARCH_AGENT_LABELS[name] };
  }
  return undefined;
}
