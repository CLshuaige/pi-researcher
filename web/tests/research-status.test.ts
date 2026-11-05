import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isResearchRunning } from '../shared/research.ts';
import type { ResearchSession } from '../shared/types.ts';

function session(
  status: ResearchSession['status'],
  control?: ResearchSession['workflow']['control'],
) {
  return { status, workflow: { control } } as Pick<ResearchSession, 'status' | 'workflow'>;
}

test('research running status includes waiting jobs regardless of wake time', () => {
  assert.equal(isResearchRunning(session('running')), true);
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
