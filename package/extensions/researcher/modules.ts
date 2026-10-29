import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResearchSkill } from './types.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
export function moduleResources(skills: ResearchSkill[]) {
  const experiment = skills.includes('research-experiment');
  return { skills: skills.map(s => join(root, 'skills', s, 'SKILL.md')),
    extensions: experiment ? [join(root, 'extensions/engine/index.ts')] : [],
    tools: experiment ? ['engine_start', 'engine_status', 'engine_abort'] : [] };
}
