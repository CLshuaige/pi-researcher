import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isResearchRunning } from '../shared/research.ts';
import { getLatestChecklistState } from '../src/components/ChecklistView.tsx';
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

function checklistSnapshot(revision: number | undefined, status: string, initialized = true) {
  return JSON.stringify({
    initialized,
    ...(revision === undefined ? {} : { revision }),
    modules: [{ id: 'm1', status }],
  });
}

test('latest checklist snapshot wins and previous text is the prior revision', () => {
  const oldText = checklistSnapshot(4, 'running');
  const latestText = checklistSnapshot(5, 'completed');
  const messages = [tool('old', 'research_checklist'), tool('latest', 'research_checklist')];
  messages[0].text = oldText;
  messages[1].text = latestText;
  assert.deepEqual(getLatestChecklistState(messages), { text: latestText, prevText: oldText });
});

test('same revisions prefer the last message while out-of-order older revisions do not win', () => {
  const rev3Earlier = checklistSnapshot(3, 'running');
  const rev3Later = checklistSnapshot(3, 'completed');
  const rev2 = checklistSnapshot(2, 'pending');
  const messages = [
    tool('rev3-a', 'research_checklist'),
    tool('rev3-b', 'research_checklist'),
    tool('rev2-late', 'research_checklist'),
  ];
  messages[0].text = rev3Earlier;
  messages[1].text = rev3Later;
  messages[2].text = rev2;
  assert.deepEqual(getLatestChecklistState(messages), { text: rev3Later, prevText: rev2 });
});

test('latest checklist ignores truncated, uninitialized, unrelated and invalid snapshots without mutating messages', () => {
  const validText = checklistSnapshot(undefined, 'running');
  const messages = [
    tool('truncated', 'research_checklist'),
    tool('uninitialized', 'research_checklist'),
    tool('other-tool', 'research_task'),
    tool('old', 'research_checklist'),
  ];
  messages[0].text = '{"initialized":true,"modules":[';
  messages[1].text = checklistSnapshot(10, 'completed', false);
  messages[2].text = checklistSnapshot(11, 'completed');
  messages[3].text = validText;
  const original = structuredClone(messages);
  assert.deepEqual(getLatestChecklistState(messages), { text: validText });
  assert.deepEqual(messages, original);
  assert.equal(getLatestChecklistState([tool('no-data', 'research_checklist')]), undefined);
});

test('unrevisioned checklist snapshots use message order and retain the prior valid text', () => {
  const first = checklistSnapshot(undefined, 'running');
  const last = checklistSnapshot(undefined, 'completed');
  const messages = [tool('first', 'research_checklist'), tool('last', 'research_checklist')];
  messages[0].text = first;
  messages[1].text = last;
  assert.deepEqual(getLatestChecklistState(messages), { text: last, prevText: first });
});
