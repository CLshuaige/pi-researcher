import { test, expect, type Page } from '@playwright/test';
import type { ResearchSession } from '../shared/types';

async function setup(page: Page) {
  const demo = (await (await page.request.get('/api/sessions/demo')).json()) as ResearchSession;
  const state: ResearchSession = {
    ...demo,
    status: 'running',
    revision: 100000,
    subSessions: [],
    messages: [
      {
        id: 'thinking',
        role: 'assistant',
        text: '',
        timestamp: Date.now(),
        status: 'running',
        thinkingStatus: 'running',
      },
    ],
  };
  await page.route('**/api/sessions/demo', (route) => route.fulfill({ json: state }));
  await page.addInitScript(() => {
    localStorage.setItem('gewu-active-session', 'demo');
    class SnapshotSource extends EventTarget {
      onerror = null;
      constructor() {
        super();
        (window as any).thinkingSource = this;
      }
      close() {}
    }
    (window as any).EventSource = SnapshotSource;
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!(window as any).thinkingSource)).toBe(true);
  const publish = async () => {
    state.revision++;
    await page.evaluate((state) => {
      (window as any).thinkingSource.dispatchEvent(
        new MessageEvent('snapshot', { data: JSON.stringify(state) }),
      );
    }, state);
  };
  return { state, publish };
}

test('live thinking displays every block, remains available after completion and survives reload', async ({
  page,
}) => {
  const { state, publish } = await setup(page);
  const block = page.locator('.thinking-block');
  await expect(block.getByRole('button', { name: '正在思考…' })).toBeVisible();
  state.messages[0].thinking = '第一段：核对资料。';
  await publish();
  await expect(block.locator('.thinking-content')).toContainText('第一段：核对资料。');
  state.messages[0].thinking += '\n\n第二段：比较实验结果。';
  state.messages[0].thinkingStatus = 'completed';
  state.messages[0].status = 'completed';
  state.messages[0].text = '研究结论。';
  state.status = 'idle';
  await publish();
  await block.getByRole('button', { name: '思考过程' }).click();
  await expect(block).toContainText('第一段：核对资料。');
  await expect(block).toContainText('第二段：比较实验结果。');
  await page.reload();
  await block.getByRole('button', { name: '思考过程' }).click();
  await expect(block).toContainText('第一段：核对资料。');
  await expect(block).toContainText('第二段：比较实验结果。');
});

test('reader expansion choices survive thinking state changes and interruption retains partial text', async ({
  page,
}) => {
  const { state, publish } = await setup(page);
  state.messages[0].thinking = '已经收到的思考内容。';
  await publish();
  const block = page.locator('.thinking-block');
  const toggle = block.getByRole('button');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  state.messages[0].thinkingStatus = 'completed';
  await publish();
  await toggle.click();
  state.messages[0].thinkingStatus = 'running';
  await publish();
  state.messages[0].thinkingStatus = 'cancelled';
  state.messages[0].status = 'cancelled';
  state.status = 'idle';
  await publish();
  await expect(toggle).toHaveText('思考已中断');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(block.locator('.thinking-content')).toContainText('已经收到的思考内容。');
  await expect(block.locator('.spin')).toHaveCount(0);
});

test('child execution logs show thinking-only messages and whitespace does not create empty panels', async ({
  page,
}) => {
  const { state, publish } = await setup(page);
  state.status = 'idle';
  state.messages = [
    {
      id: 'blank',
      role: 'assistant',
      text: '正文',
      thinking: '  ',
      thinkingStatus: 'completed',
      timestamp: 1,
    },
    { id: 'delegate', role: 'tool', name: 'research_delegate', text: '', timestamp: 1 },
  ];
  state.subSessions = [
    {
      id: 'child',
      toolCallId: 'delegate',
      kind: 'delegate',
      label: '子任务',
      status: 'completed',
      startedAt: 1,
      messages: [
        {
          id: 'thought-only',
          role: 'assistant',
          text: '',
          thinking: '子任务第一段。\n\n子任务第二段。',
          thinkingStatus: 'completed',
          timestamp: 1,
        },
        {
          id: 'answer',
          role: 'assistant',
          text: '子任务结论。',
          thinking: '核对完成。',
          thinkingStatus: 'completed',
          timestamp: 2,
        },
      ],
    },
  ];
  await publish();
  await expect(page.locator('.assistant-message .thinking-block')).toHaveCount(0);
  const child = page.locator('.sub-session');
  await child.getByRole('tab', { name: /执行记录/ }).click();
  await expect(child.locator('.thinking-block')).toHaveCount(2);
  await child.getByRole('button', { name: '思考过程' }).first().click();
  await expect(child).toContainText('子任务第一段。');
  await expect(child).toContainText('子任务第二段。');
  await expect(child).toContainText('子任务结论。');
});
