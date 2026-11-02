import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiBridge } from '../server/pi.ts';
import { SessionStore } from '../server/store.ts';
import { childMessages } from '../server/sub-sessions.ts';
import type { StoredSession } from '../server/store.ts';

function harness() {
  const session = { messages: [], workflow: { nodes: [], edges: [] } } as unknown as StoredSession;
  const bridge = new PiBridge(
    '',
    {} as SessionStore,
    () => {},
    async () => {},
  );
  const live = { users: new Map(), session: { sessionManager: { getBranch: () => [] } } };
  const emit = (event: object) => (bridge as any).onEvent(session, live, event);
  const message = (content: object[], stopReason = 'stop') => ({
    role: 'assistant',
    content,
    stopReason,
  });
  emit({ type: 'message_start', message: message([]) });
  return { session, emit, message, current: () => session.messages.at(-1)! };
}

test('streaming thinking keeps all content blocks and uses authoritative snapshots', () => {
  const h = harness();
  const update = (type: string, contentIndex: number, blocks: object[], extra = {}) => {
    const partial = h.message(blocks);
    h.emit({
      type: 'message_update',
      message: partial,
      assistantMessageEvent: { type, contentIndex, partial, ...extra },
    });
  };
  update('thinking_start', 0, [{ type: 'thinking', thinking: '' }]);
  assert.equal(h.current().thinkingStatus, 'running');
  update('thinking_delta', 0, [{ type: 'thinking', thinking: 'First thought' }], {
    delta: 'First thought',
  });
  update('thinking_end', 0, [{ type: 'thinking', thinking: 'First thought.' }], {
    content: 'First thought.',
  });
  const blocks = [
    { type: 'thinking', thinking: 'First thought.' },
    { type: 'text', text: 'Explanation' },
    { type: 'thinking', thinking: 'Second thought' },
  ];
  update('thinking_delta', 2, blocks, { delta: 'Second thought' });
  assert.equal(h.current().thinking, 'First thought.\n\nSecond thought');
  blocks[2] = { type: 'thinking', thinking: 'Second thought.' };
  update('thinking_end', 2, blocks, { content: 'Second thought.' });
  assert.equal(h.current().thinking, 'First thought.\n\nSecond thought.');
  // Re-delivery of an SDK snapshot must not append its delta twice.
  update('thinking_delta', 2, blocks, { delta: 'Second thought.' });
  assert.equal(h.current().thinking, 'First thought.\n\nSecond thought.');
});

test('message end recovers final-only thinking and closes interrupted thinking', () => {
  for (const stopReason of ['stop', 'aborted', 'error']) {
    const h = harness();
    h.emit({
      type: 'message_end',
      message: h.message(
        [
          { type: 'thinking', thinking: 'First block' },
          { type: 'thinking', thinking: 'Final block' },
          { type: 'text', text: 'Answer' },
        ],
        stopReason,
      ),
    });
    assert.equal(h.current().thinking, 'First block\n\nFinal block');
    assert.equal(h.current().text, 'Answer');
    assert.equal(
      h.current().thinkingStatus,
      stopReason === 'aborted' ? 'cancelled' : stopReason === 'error' ? 'failed' : 'completed',
    );
  }
});

test('settling without thinking_end preserves partial thinking and stops the spinner', () => {
  const h = harness();
  const partial = h.message([{ type: 'thinking', thinking: 'Partial thought' }]);
  h.emit({
    type: 'message_update',
    message: partial,
    assistantMessageEvent: {
      type: 'thinking_delta',
      contentIndex: 0,
      partial,
      delta: 'Partial thought',
    },
  });
  h.emit({ type: 'agent_settled', aborted: true });
  assert.equal(h.current().thinking, 'Partial thought');
  assert.equal(h.current().thinkingStatus, 'cancelled');
});

test('an interrupted final message without thinking blocks preserves streamed thinking', () => {
  const h = harness();
  const partial = h.message([{ type: 'thinking', thinking: 'Received before disconnect' }]);
  h.emit({
    type: 'message_update',
    message: partial,
    assistantMessageEvent: {
      type: 'thinking_delta',
      contentIndex: 0,
      partial,
      delta: 'Received before disconnect',
    },
  });
  h.emit({ type: 'message_end', message: h.message([], 'aborted') });
  assert.equal(h.current().thinking, 'Received before disconnect');
  assert.equal(h.current().thinkingStatus, 'cancelled');
});

test('child transcripts retain thinking-only messages and all thinking blocks', () => {
  const messages = childMessages(
    [
      {
        id: 'thought',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'First block' },
            { type: 'thinking', thinking: 'Second block' },
            { type: 'toolCall', id: 'read', name: 'read', arguments: {} },
          ],
          stopReason: 'toolUse',
        },
      },
      {
        id: 'answer',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Interrupted thought' },
            { type: 'text', text: 'Partial answer' },
          ],
          stopReason: 'aborted',
        },
      },
    ],
    'child',
  );
  assert.equal(messages.length, 3);
  assert.equal(messages[0].thinking, 'First block\n\nSecond block');
  assert.equal(messages[0].thinkingStatus, 'completed');
  assert.equal(messages[1].role, 'tool');
  assert.equal(messages[2].thinking, 'Interrupted thought');
  assert.equal(messages[2].thinkingStatus, 'cancelled');
});

test('restart closes stale thinking status without losing received text', () => {
  const root = mkdtempSync(join(tmpdir(), 'gewu-thinking-'));
  try {
    const store = new SessionStore(root);
    const s = store.create();
    s.status = 'running';
    s.messages.push({
      id: 'thought',
      role: 'assistant',
      text: '',
      thinking: 'Saved thought',
      thinkingStatus: 'running',
      status: 'running',
      timestamp: 1,
    });
    store.save(s);
    const restored = new SessionStore(root).get(s.id);
    assert.equal(restored.messages[0].thinking, 'Saved thought');
    assert.equal(restored.messages[0].thinkingStatus, 'cancelled');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
