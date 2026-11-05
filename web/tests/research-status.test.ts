import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isResearchRunning } from '../shared/research.ts';
import { getStageStartMessages } from '../src/lib/research-navigation.ts';
import type { ChatMessage, ResearchSession, Workflow } from '../shared/types.ts';

function session(
  status: ResearchSession['status'],
  control?: ResearchSession['workflow']['control'],
) {
  return { status, workflow: { control } } as Pick<ResearchSession, 'status' | 'workflow'>;
}

test('research running status includes waiting jobs regardless of wake time', () => {
  assert.equal(isResearchRunning(session('running')), true);
  assert.equal(isResearchRunning(session('waiting')), true);
  assert.equal(isResearchRunning(session('idle', { state: 'waiting' })), true);
  assert.equal(
    isResearchRunning(session('idle', { state: 'waiting', wakeAt: Date.now() - 60_000 })),
    true,
  );
});

test('research running status excludes idle controls and non-running session states', () => {
  for (const state of ['paused', 'stopped', 'completed'] as const) {
    assert.equal(isResearchRunning(session('idle', { state })), false);
  }
  assert.equal(isResearchRunning(session('idle')), false);
  assert.equal(isResearchRunning(session('stopping', { state: 'waiting' })), false);
  assert.equal(isResearchRunning(session('interrupted', { state: 'waiting' })), false);
});

function navigationWorkflow(source: Workflow['source'], ids: string[]): Workflow {
  return {
    source,
    nodes: ids.map((id, index) => ({
      id,
      label: id,
      description: '',
      status: 'pending',
      x: 0,
      y: index,
    })),
    edges: [],
  };
}

function tool(id: string, name: string, args: Record<string, unknown> = {}): ChatMessage {
  return { id, role: 'tool', name, args, text: '', timestamp: 0 };
}

test('stage navigation prefers the first checklist start over later module updates', () => {
  const messages = [
    tool('update', 'research_task', { moduleId: 'm1' }),
    tool('start-first', 'research_checklist', { action: 'start', moduleId: 'm1' }),
    tool('start-later', 'research_checklist', { action: 'start', moduleId: 'm1' }),
  ];
  assert.deepEqual(
    [...getStageStartMessages(navigationWorkflow('checklist', ['m1']), messages)],
    [['m1', 'start-first']],
  );
});

test('stage navigation falls back to visible module tools and ignores retries and hidden waits', () => {
  const messages = [
    tool('retry', 'research_task', { moduleId: 'm1' }),
    tool('bash', 'bash', { moduleId: 'm2' }),
    tool('wait', 'research_job', { action: 'wait', moduleId: 'm2' }),
    tool('visible', 'research_task', { moduleId: 'm2' }),
    tool('unknown', 'research_task', { moduleId: 'other' }),
  ];
  messages[0].retryOf = 'original';
  assert.deepEqual(
    [...getStageStartMessages(navigationWorkflow('checklist', ['m1', 'm2']), messages)],
    [['m2', 'visible']],
  );
  assert.deepEqual(
    [...getStageStartMessages(navigationWorkflow('checklist', ['unmatched']), messages)],
    [],
  );
});

test('default and demo workflows map tool names and stage skills to node ids', () => {
  const messages = [
    tool('literature', 'paper_lookup'),
    tool('experiment', 'engine_run'),
    tool('task', 'research_delegate', { skills: ['research-task'] }),
  ];
  for (const source of ['default', 'demo'] as const) {
    assert.deepEqual(
      [...getStageStartMessages(navigationWorkflow(source, ['literature', 'experiment', 'task']), messages)],
      [
        ['literature', 'literature'],
        ['experiment', 'experiment'],
        ['task', 'task'],
      ],
    );
  }
  assert.deepEqual(
    [...getStageStartMessages(navigationWorkflow('checklist', ['literature']), messages)],
    [],
  );
});
