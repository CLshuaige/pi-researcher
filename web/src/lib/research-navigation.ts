import type { ChatMessage, Workflow } from '../../shared/types';

function defaultStageForTool(name: string, args: Record<string, unknown> = {}): string | undefined {
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

/** Find the first visible message that starts each workflow stage. */
export function getStageStartMessages(
  workflow: Workflow,
  messages: ChatMessage[],
): Map<string, string> {
  const result = new Map<string, string>();
  const originals = messages.filter((message) => message.role === 'tool' && !message.retryOf);

  for (const node of workflow.nodes) {
    const checklistStart = originals.find(
      (message) =>
        message.name === 'research_checklist' &&
        message.args?.action === 'start' &&
        message.args?.moduleId === node.id,
    );
    if (checklistStart) {
      result.set(node.id, checklistStart.id);
      continue;
    }

    const moduleMessage = originals.find(
      (message) =>
        message.name !== 'bash' &&
        !(message.name === 'research_job' && message.args?.action === 'wait') &&
        message.args?.moduleId === node.id,
    );
    if (moduleMessage) {
      result.set(node.id, moduleMessage.id);
      continue;
    }

    if (workflow.source !== 'default' && workflow.source !== 'demo') continue;

    const defaultStageMessage = originals.find((message) => {
      if (message.name === `research-${node.id}`) return true;
      if (
        message.name === 'research_delegate' &&
        Array.isArray(message.args?.skills) &&
        message.args.skills.includes(`research-${node.id}`)
      )
        return true;
      return defaultStageForTool(message.name || '', message.args) === node.id;
    });
    if (defaultStageMessage) result.set(node.id, defaultStageMessage.id);
  }

  return result;
}
