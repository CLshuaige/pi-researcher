import { test, expect } from '@playwright/test';

test('research activity follows tool snapshots', async ({ page }) => {
  const demo = await (await page.request.get('/api/sessions/demo')).json();
  const startedAt = Date.now();
  await page.route('**/api/sessions/demo', (route) =>
    route.fulfill({
      json: {
        ...demo,
        revision: 100000,
        artifacts: [],
        workflow: {
          nodes: [
            {
              id: 'literature',
              label: '文献调研',
              description: '核对研究来源',
              status: 'running',
              criteria: ['核对原文', '记录出处'],
              evidence: ['https://example.com/paper'],
              x: 0,
              y: 0,
            },
          ],
          edges: [],
        },
        messages: [
          {
            id: 'search',
            role: 'tool',
            name: 'academic_search',
            text: '',
            timestamp: startedAt - 1000,
            status: 'completed',
            args: { query: '已核对的检索关键词' },
          },
          {
            id: 'read',
            role: 'tool',
            name: 'fetch_content',
            text: '',
            timestamp: startedAt,
            status: 'running',
            description: '正在核对论文原文',
          },
          { id: 'answer', role: 'assistant', text: '这不是一条工具动态', timestamp: startedAt + 1 },
        ],
      },
    }),
  );
  await page.addInitScript(() => localStorage.setItem('gewu-active-session', 'demo'));
  await page.goto('/');
  const panel = page.locator('.flow-section');
  const activity = panel.getByRole('region', { name: '研究动态', exact: true });
  expect(
    await activity.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(120);
  const entries = activity.getByRole('listitem');
  await expect(entries).toHaveCount(2);
  await expect(entries.first()).toContainText('正在核对论文原文');
  await expect(entries.first()).toHaveAttribute('data-status', 'running');
  await expect(entries.last()).toContainText('已核对的检索关键词');
  await expect(entries.last()).toHaveAttribute('data-status', 'completed');
  await expect(entries.first().locator('time')).toHaveAttribute(
    'datetime',
    new Date(startedAt).toISOString(),
  );
  await activity.getByRole('button', { name: '收起研究动态' }).click();
  await expect(activity.getByRole('list')).toBeHidden();
  await activity.getByRole('button', { name: '展开研究动态' }).click();
  await expect(activity.getByRole('list')).toBeVisible();
  await page.getByRole('button', { name: '全屏查看研究节点' }).click();
  const dialog = page.getByRole('dialog', { name: '研究节点全屏画布' });
  await expect(
    dialog.getByRole('region', { name: '研究动态', exact: true }).getByRole('listitem'),
  ).toHaveCount(2);
  await page.getByRole('button', { name: '退出全屏' }).click();
});
