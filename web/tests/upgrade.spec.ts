import { test, expect } from '@playwright/test';

test('status popover reads existing snapshots without sending commands', async ({ page }) => {
  const created = await (await page.request.post('/api/sessions', { data: {} })).json();
  await page.addInitScript((id) => localStorage.setItem('gewu-active-session', id), created.id);
  const state = {
    ...created,
    revision: 100000,
    messages: [{ id: 'question', role: 'user', text: '验证只读状态', timestamp: Date.now() }],
  };
  await page.route(`**/api/sessions/${created.id}`, (route) => route.fulfill({ json: state }));
  await page.goto('/');
  const mutations: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET') mutations.push(r.url());
  });
  await page.getByRole('button', { name: '查看研究状态' }).click();
  await expect(page.getByRole('dialog', { name: '研究状态' })).toBeVisible();
  await expect(page.getByText('暂无进行中的节点')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '研究状态' })).toHaveCount(0);
  expect(mutations).toEqual([]);
});

test('model settings open the API tab and retain keyboard-operable thinking controls', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建研究' }).click();
  await expect(page.locator('.empty-title')).toBeVisible();
  const trigger = page.getByRole('button', { name: '模型和思考强度设置' });
  await trigger.click();
  const slider = page.getByRole('slider', { name: '思考强度' });
  await expect(slider).toBeVisible();
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '3');
  await page.getByRole('button', { name: '更多模型设置' }).click();
  const dialog = page.getByRole('dialog', { name: '用户设置' });
  await expect(dialog.getByRole('tab', { name: 'API Key', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('parallel child cards show distinct progress, logs and shared file previews', async ({
  page,
}) => {
  const demo = await (await page.request.get('/api/sessions/demo')).json();
  const now = Date.now();
  const state = {
    ...demo,
    revision: 100000,
    subSessions: [
      {
        id: 'child-one',
        toolCallId: 'children',
        kind: 'delegate',
        label: '核对研究方法',
        status: 'completed',
        startedAt: now - 10000,
        endedAt: now,
        summary: '方法核对完成。',
        artifacts: ['research/task.md'],
        messages: [
          { id: 'child-answer', role: 'assistant', text: '这是实际子会话记录。', timestamp: now },
        ],
      },
      {
        id: 'child-two',
        toolCallId: 'children',
        kind: 'subagent',
        label: '核对研究证据',
        status: 'running',
        startedAt: now,
        progress: '正在逐项核对来源。',
        messages: [],
      },
    ],
    messages: [
      ...demo.messages,
      {
        id: 'children',
        role: 'tool',
        name: 'subagent',
        text: '子任务进度',
        timestamp: now,
        status: 'running',
      },
    ],
  };
  await page.route('**/api/sessions/demo', (r) => r.fulfill({ json: state }));
  await page.addInitScript(() => localStorage.setItem('gewu-active-session', 'demo'));
  await page.goto('/');
  const cards = page.locator('.sub-session');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(1)).toContainText('正在逐项核对来源。');
  await cards
    .first()
    .getByRole('tab', { name: /执行记录/ })
    .click();
  await expect(cards.first()).toContainText('这是实际子会话记录。');
  await cards
    .first()
    .getByRole('tab', { name: /交付文件/ })
    .click();
  await cards
    .first()
    .getByRole('button', { name: /task.md/ })
    .click();
  await expect(page.getByRole('region', { name: '文件预览 task.md' })).toBeVisible();
});

test('history menus open with the keyboard and rename uses the shared dialog', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建研究' }).click();
  await expect(page.locator('.empty-title')).toBeVisible();
  const more = page.locator('.history-more').first();
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: '重命名' })).toBeVisible();
  await page.getByRole('menuitem', { name: '重命名' }).click();
  const dialog = page.getByRole('dialog', { name: '重命名研究' });
  await expect(dialog).toBeVisible();
  expect((await dialog.boundingBox())!.width).toBeLessThan(500);
  await expect(dialog.getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(more).toBeFocused();
});
