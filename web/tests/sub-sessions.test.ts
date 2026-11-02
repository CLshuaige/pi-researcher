import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  beginSubSessions,
  updateSubSessions,
  childMessages,
  refreshSubSessions,
} from '../server/sub-sessions.ts';
import type { StoredSession } from '../server/store.ts';

const session = () => ({ subSessions: [] }) as unknown as StoredSession;
test('progress snapshots update in place and preserve a completed handoff', () => {
  const s = session();
  beginSubSessions(s, 'tool', 'research_delegate', {
    objective: '检验研究假设',
    skills: ['research-method'],
  });
  const update = { content: [{ type: 'text', text: '正在读取材料' }], details: {} };
  updateSubSessions(s, 'tool', update);
  updateSubSessions(s, 'tool', update);
  assert.equal(s.subSessions.length, 1);
  assert.equal(s.subSessions[0].messages.length, 0);
  assert.equal(s.subSessions[0].progress, '正在读取材料');
  updateSubSessions(
    s,
    'tool',
    {
      content: [],
      details: { status: 'partial', result: { summary: '仍需数据', artifacts: ['method.md'] } },
    },
    true,
  );
  assert.equal(s.subSessions[0].status, 'pending');
  assert.equal(s.subSessions[0].outcome, 'partial');
  assert.equal(s.subSessions[0].summary, '仍需数据');
  assert.deepEqual(s.subSessions[0].artifacts, ['method.md']);
});
test('parallel child results keep their own status and messages', () => {
  const s = session();
  beginSubSessions(s, 'parallel', 'subagent', {
    tasks: [
      { agent: 'reviewer', task: '检查方法' },
      { agent: 'reviewer', task: '检查证据' },
    ],
  });
  updateSubSessions(
    s,
    'parallel',
    {
      details: {
        results: [
          {
            exitCode: 0,
            progress: { status: 'completed' },
            messages: [{ role: 'assistant', content: [{ type: 'text', text: '方法检查完成' }] }],
          },
          { exitCode: 1, progress: { status: 'failed' }, messages: [] },
        ],
      },
    },
    true,
    true,
  );
  assert.equal(s.subSessions.length, 2);
  assert.equal(s.subSessions[0].status, 'completed');
  assert.equal(s.subSessions[1].status, 'failed');
  assert.equal(s.subSessions[0].messages[0].text, '方法检查完成');
});
test('child transcript merges tool calls and results with stable IDs', () => {
  const raw = [
    {
      id: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call', name: 'read', arguments: { path: 'task.md' } }],
      },
    },
    {
      id: 'result',
      message: {
        role: 'toolResult',
        toolCallId: 'call',
        content: [{ type: 'text', text: '真实文件内容' }],
      },
    },
  ];
  const messages = childMessages(raw, 'child');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 'call');
  assert.equal(messages[0].status, 'completed');
  assert.equal(messages[0].text, '真实文件内容');
});
test('persisted delegate records supply logs and files without following outside paths', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gewu-child-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = 'T-12345678-1234-1234-1234-123456789012',
    s = session();
  beginSubSessions(s, 'task', 'research_delegate', { objective: '核查任务' });
  s.subSessions[0].taskId = id;
  await mkdir(join(root, '.research/tasks', id), { recursive: true });
  const record = {
    id,
    status: 'completed',
    startedAt: new Date().toISOString(),
    sessionFile: '.research/child.jsonl',
    result: { summary: '已核查', artifacts: ['report.md'] },
  };
  await writeFile(join(root, '.research/tasks', id, 'task.json'), JSON.stringify(record));
  await writeFile(
    join(root, '.research/child.jsonl'),
    JSON.stringify({
      id: 'answer',
      message: { role: 'assistant', content: [{ type: 'text', text: '来源已验证' }] },
    }) + '\n',
  );
  await refreshSubSessions(s, root);
  assert.equal(s.subSessions[0].messages[0].text, '来源已验证');
  assert.equal(s.subSessions[0].status, 'completed');
  record.sessionFile = '../outside.jsonl';
  await writeFile(join(root, '.research/tasks', id, 'task.json'), JSON.stringify(record));
  await refreshSubSessions(s, root);
  assert.equal(s.subSessions[0].messages[0].text, '来源已验证');
});

test('an interrupted chain never marks an unexecuted child as completed', () => {
  const s = session();
  beginSubSessions(s, 'chain', 'subagent', {
    chain: [
      { agent: 'researcher', task: '收集证据' },
      { agent: 'reviewer', task: '评审证据' },
    ],
  });
  updateSubSessions(
    s,
    'chain',
    { details: { results: [{ exitCode: 1, progress: { status: 'failed' } }] } },
    true,
    true,
  );
  assert.equal(s.subSessions[0].status, 'failed');
  assert.equal(s.subSessions[1].status, 'cancelled');
});
