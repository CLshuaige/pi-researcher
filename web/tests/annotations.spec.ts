import { test, expect } from '@playwright/test';

test('file tree opens sidebar tabs with a shared fullscreen header and persistent edits', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建研究' }).click();
  await expect(page.locator('.empty-title')).toBeVisible();
  await page.getByLabel('选择研究附件').setInputFiles([
    {
      name: 'first.markdown',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 第一份文档\n\n文档正文'),
    },
    { name: 'second.md', mimeType: 'text/markdown', buffer: Buffer.from('# 第二份文档') },
  ]);
  await page.getByRole('button', { name: '查看文件 first.markdown' }).click();
  const viewer = page.getByRole('region', { name: '文件预览 first.markdown' });
  await expect(viewer).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(viewer.locator('.preview-header')).toContainText('first.markdown');
  await page.getByRole('button', { name: '编辑文件', exact: true }).click();
  await page.locator('.cm-content').fill('# 修改后\n\n保存测试');
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' && response.url().includes('/files/content'),
  );
  await page.getByRole('button', { name: '保存文件', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(viewer.getByRole('heading', { name: '修改后' })).toBeVisible();
  await page.getByRole('button', { name: '研究产物', exact: true }).click();
  await page.getByRole('button', { name: '查看文件 second.md' }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.preview-header')).toContainText('second.md');
  await page.getByRole('tab', { name: /first.markdown/ }).click();
  await expect(page.locator('.preview-header')).toContainText('first.markdown');
  await expect(page.getByRole('heading', { name: '修改后' })).toBeVisible();
  await page.getByRole('button', { name: '全屏预览文件' }).click();
  await expect(page.getByRole('dialog', { name: '全屏预览 first.markdown' })).toBeVisible();
  const content = (await page.locator('.preview-content-text').boundingBox())!;
  const text = (await page.locator('.preview-content-text .markdown').boundingBox())!;
  expect(text.x - content.x).toBeGreaterThanOrEqual(24);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(viewer).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载预览文件' }).click();
  expect((await download).suggestedFilename()).toBe('first.markdown');
});

test('all three inspector boundaries resize by dragging', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('gewu-active-session', 'demo'));
  await page.goto('/');
  await expect(page.locator('.flow-section')).toBeVisible();
  const drag = async (name: string, x: number, y: number) => {
    const box = (await page.getByRole('separator', { name }).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + x, box.y + box.height / 2 + y, { steps: 10 });
    await page.mouse.up();
  };
  const side = (await page.locator('.sidebar').boundingBox())!.width;
  await drag('调整侧边栏宽度', 70, 0);
  await expect
    .poll(async () => (await page.locator('.sidebar').boundingBox())!.width)
    .toBeGreaterThan(side + 40);
  const right = (await page.locator('.inspector').boundingBox())!.width;
  await drag('调整信息面板宽度', -90, 0);
  await expect
    .poll(async () => (await page.locator('.inspector').boundingBox())!.width)
    .toBeGreaterThan(right + 60);
  const height = (await page.locator('.flow-section').boundingBox())!.height;
  await drag('调整研究节点与产物高度', 0, 70);
  await expect
    .poll(async () => (await page.locator('.flow-section').boundingBox())!.height)
    .toBeGreaterThan(height + 40);
});

test('active assistant turns keep a breathing dot and hide final answer actions', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('gewu-active-session', 'demo'));
  await page.goto('/');
  await page.getByRole('textbox', { name: '研究消息', exact: true }).fill('继续讨论评价指标');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('status', { name: '正在继续研究' })).toBeVisible();
  await expect(page.locator('.assistant-message').last().locator('.markdown')).toContainText(
    '收到',
  );
  await expect(
    page.locator('.assistant-message').last().getByRole('button', { name: '复制回答' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '停止生成' }).click();
  await expect(page.getByRole('status', { name: '正在继续研究' })).toHaveCount(0);
  await expect(
    page.locator('.assistant-message').last().getByRole('button', { name: '复制回答' }),
  ).toBeVisible();
});

test('user menu remains visible on an existing conversation', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('gewu-active-session', 'demo'));
  await page.goto('/');
  await page.getByRole('button', { name: '用户菜单' }).click();
  await expect(page.getByRole('menuitem', { name: '登出' })).toBeVisible();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '用户设置' })).toBeVisible();
  await page.getByRole('tab', { name: '通用', exact: true }).click();
  await expect(page.getByLabel('外观')).toBeVisible();
});

test('scroll-to-bottom stays above the composer as it grows', async ({ page }) => {
  const state = await (await page.request.get('/api/sessions/demo')).json();
  await page.route('**/api/sessions/demo', (route) =>
    route.fulfill({
      json: {
        ...state,
        revision: 100000,
        status: 'idle',
        messages: [
          ...state.messages,
          {
            id: 'long-answer',
            role: 'assistant',
            status: 'completed',
            timestamp: Date.now(),
            text: Array.from({ length: 80 }, (_, index) => `第 ${index + 1} 条实验观察。`).join(
              '\n\n',
            ),
          },
        ],
      },
    }),
  );
  await page.addInitScript(() => localStorage.setItem('gewu-active-session', 'demo'));
  await page.goto('/');
  await expect(page.getByText('第 80 条实验观察。', { exact: true })).toBeVisible();
  await page.locator('.message-scroll').evaluate((element) => {
    element.scrollTop = 0;
  });
  const button = page.getByRole('button', { name: '回到底部' });
  await expect(button).toBeVisible();
  const separated = async () => {
    const arrow = (await button.boundingBox())!;
    const composer = (await page.locator('.conversation-composer').boundingBox())!;
    return arrow.y + arrow.height <= composer.y - 8;
  };
  await expect.poll(separated).toBe(true);
  await page.getByRole('textbox', { name: '研究消息', exact: true }).fill('一\n二\n三\n四');
  await expect.poll(separated).toBe(true);
});

test('node directory branches reveal two files first and reuse the sidebar preview', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建研究' }).click();
  await expect(page.locator('.empty-title')).toBeVisible();
  await page.getByLabel('选择研究附件').setInputFiles(
    ['one.md', 'two.md', 'three.pdf'].map((name) => ({
      name,
      mimeType: name.endsWith('pdf') ? 'application/pdf' : 'text/markdown',
      buffer: Buffer.from('# 节点产物'),
    })),
  );
  await expect(page.getByRole('button', { name: '查看文件 three.pdf' })).toBeVisible();
  const id = await page.evaluate(() => localStorage.getItem('gewu-active-session'));
  const state = await (await page.request.get(`/api/sessions/${id}`)).json();
  const directory = state.artifacts.find((item: { kind: string }) => item.kind === 'directory');
  expect(directory).toBeTruthy();
  await page.route(`**/api/sessions/${id}`, (route) =>
    route.fulfill({
      json: {
        ...state,
        revision: 100000,
        workflow: {
          source: 'checklist',
          nodes: [
            {
              id: 'task',
              label: '任务解析',
              description: '实际清单证据',
              status: 'completed',
              evidence: [directory.path],
              x: 0,
              y: 0,
            },
          ],
          edges: [],
        },
      },
    }),
  );
  await page.reload();
  const tree = page.getByRole('tree', { name: '节点相关文件' });
  await expect(tree).toBeVisible();
  await tree.getByRole('button', { name: `展开节点目录 ${directory.name}` }).click();
  await expect(tree.locator('.file-children .file-row')).toHaveCount(2);
  await tree.getByRole('button', { name: '展开其余 1 个文件' }).click();
  await expect(tree.locator('.file-children .file-row')).toHaveCount(3);
  await expect(tree.locator('[data-filetype="pdf"]')).toHaveCount(1);
  await tree.getByRole('button', { name: '预览节点文件 one.md' }).click();
  await expect(page.getByRole('region', { name: '文件预览 one.md' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.preview-tabs [data-filetype="markdown"]')).toHaveCount(1);
});
