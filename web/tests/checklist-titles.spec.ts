import { test, expect } from '@playwright/test';

test('tool titles omit status suffixes while icons retain execution status and legacy action fallbacks', async ({
  page,
}) => {
  const demo = await (await page.request.get('/api/sessions/demo')).json();
  const cases = [
    { action: 'help', label: '查看清单说明' },
    { action: 'read', label: '读取研究状态' },
    { action: 'init', label: '初始化研究清单' },
    { action: 'plan', label: '规划研究阶段' },
    { action: 'start', label: '启动研究阶段' },
    { action: 'update', label: '更新阶段记录', title: '   ' },
    { action: 'accept', label: '验收研究阶段', title: 123 },
    { action: 'resolve', label: '处理待办指令' },
    { action: 'repair', label: '恢复清单快照' },
    { label: '更新研究清单' },
    { action: 'plan', title: '  规划分子建模  ', label: '规划分子建模' },
    {
      action: 'accept',
      title: '核验训练产物',
      label: '核验训练产物',
      status: 'failed',
    },
    {
      action: 'update',
      title: '记录模型指标',
      label: '记录模型指标',
      status: 'running',
    },
    {
      action: 'resolve',
      title: '调整研究目标',
      label: '调整研究目标',
      status: 'cancelled',
    },
    {
      action: 'plan',
      title: '一二三四五六七八九十甲乙超长标题',
      label: '一二三四五六七八九十甲乙',
    },
    { name: 'read', title: '不应替代工具名', label: '读取文件' },
  ];
  const reason = '记录验收依据，仍需提供逐条 acceptance';
  await page.route('**/api/sessions/demo', (route) =>
    route.fulfill({
      json: {
        ...demo,
        revision: 100000,
        status: 'idle',
        subSessions: [],
        messages: [
          { id: 'request', role: 'user', text: '检查清单标题', timestamp: Date.now() },
          ...cases.map((item, i) => ({
            id: `checklist-${i}`,
            role: 'tool',
            name: item.name || 'research_checklist',
            status: item.status || 'completed',
            text: '{"revision":3}',
            timestamp: Date.now(),
            args: { action: item.action, title: item.title, reason },
          })),
        ],
      },
    }),
  );
  await page.addInitScript(() => localStorage.setItem('gewu-active-session', 'demo'));
  await page.goto('/');
  const statusIcons: Record<string, string> = {
    completed: '.lucide-check',
    failed: '.lucide-x',
    running: '.spin',
    cancelled: '.lucide-x',
  };
  for (const item of cases) {
    const step = page.getByRole('region', { name: item.label, exact: true });
    await expect(step).toBeVisible();
    await expect(step.locator('.step-heading strong')).toHaveText(
      item.label + (item.status === 'running' ? '…' : ''),
    );
    const status = item.status || 'completed';
    await expect(step.locator(`.step-status.${status} ${statusIcons[status]}`)).toBeVisible();
  }
  const titled = page.getByRole('region', { name: '核验训练产物', exact: true });
  await titled.getByRole('button', { name: '调用参数', exact: true }).click();
  await expect(titled).toContainText(reason);
  await expect(titled).toContainText('核验训练产物');
});
