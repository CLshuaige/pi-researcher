import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/sessions/demo/stop');
  await page.request.patch('/api/sessions/demo', {
    data: { title: '多模态大模型的强化学习方法研究' },
  });
  await page.addInitScript(() => localStorage.setItem('gewu-active-session', 'demo'));
  await page.goto('/');
  await page.getByRole('button', { name: '交互演示 示例' }).click();
  await expect(page.getByRole('heading', { name: '多模态大模型的强化学习方法研究' })).toBeVisible();
});

test('reference layout, source expansion and bounded tool detail', async ({ page }) => {
  await expect(page.getByText('任务解析已完成', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /在 arXiv 中搜索/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByRole('link', { name: /arXiv，多模态/ })).toBeVisible();
  const details = page.locator('.tool-detail');
  for (const box of await details.all())
    expect((await box.boundingBox())!.height).toBeLessThanOrEqual(241);
  await page.screenshot({ path: 'test-results/gewu-desktop.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('workshop branding, quiet answers, framed menu and a one-line growing composer', async ({
  page,
}) => {
  await expect(page.locator('.brand-title')).toHaveText('格悟科研工坊');
  await expect(
    page.locator('.assistant-heading,.assistant-name,.assistant-message .logo-mark'),
  ).toHaveCount(0);
  await expect(page.locator('.more-button')).toHaveCSS('border-top-width', '1px');
  await expect(page.locator('.composer-row')).not.toContainText(/Enter|Shift|发送|随时补充/);
  const composer = page.locator('.composer-container');
  const initial = (await composer.boundingBox())!.height;
  expect(initial).toBeLessThanOrEqual(120);
  const textarea = page.getByRole('textbox', { name: '研究消息', exact: true });
  await textarea.fill('第一行\n第二行\n第三行\n第四行');
  await expect
    .poll(async () => (await composer.boundingBox())!.height)
    .toBeGreaterThan(initial + 30);
  await textarea.fill('');
  await expect.poll(async () => (await composer.boundingBox())!.height).toBe(initial);
  await page.setViewportSize({ width: 1000, height: 900 });
  const brand = (await page.locator('.brand-title').boundingBox())!;
  const collapse = (await page.getByRole('button', { name: '收起会话边栏' }).boundingBox())!;
  expect(brand.x + brand.width).toBeLessThanOrEqual(collapse.x);
});
test('sidebar and inspector toggles preserve requested panel proportions', async ({ page }) => {
  await page.getByRole('button', { name: '收起会话边栏' }).click();
  await expect(page.getByRole('button', { name: '展开会话边栏' })).toBeVisible();
  await page.getByRole('button', { name: '研究产物', exact: true }).click();
  await expect(page.locator('.artifact-section')).toHaveCount(0);
  const flow = (await page.locator('.flow-section').boundingBox())!;
  const rail = (await page.locator('.inspector').boundingBox())!;
  expect(flow.height / rail.height).toBeCloseTo(1, 1);
  await page.getByRole('button', { name: '研究节点', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-inspector', 'closed');
  await page.getByRole('button', { name: '研究产物', exact: true }).click();
  await expect(page.locator('.artifact-section')).toBeVisible();
  const artifacts = (await page.locator('.artifact-section').boundingBox())!;
  expect(artifacts.height).toBeGreaterThan(rail.height * 0.95);
});
test('flow canvas can zoom, pan and enter fullscreen', async ({ page }) => {
  const viewport = page.locator('.react-flow__viewport').first();
  const before = await viewport.getAttribute('style');
  await page.getByRole('button', { name: '放大流程图' }).click();
  await page.waitForTimeout(250);
  expect(await viewport.getAttribute('style')).not.toBe(before);
  const pane = page.locator('.react-flow__pane').first();
  const box = (await pane.boundingBox())!;
  await page.mouse.move(box.x + box.width - 15, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 65, box.y + 60, { steps: 6 });
  await page.mouse.up();
  await page.getByRole('button', { name: '全屏查看研究节点' }).click();
  await expect(page.getByRole('dialog', { name: '研究节点全屏画布' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('file preview and file/folder/project downloads', async ({ page }) => {
  await page.getByRole('button', { name: '查看文件 task.md' }).click();
  await expect(page.getByRole('region', { name: '文件预览 task.md' })).toBeVisible();
  await expect(page.getByText('此文件仅用于界面交互演示，并非真实科研结果。')).toBeVisible();
  await page.getByRole('button', { name: '关闭全部预览' }).click();
  for (const name of ['下载文件 task.md', '下载文件夹 research', '下载全部研究产物']) {
    const pending = page.waitForEvent('download');
    const link = page.getByRole('link', { name, exact: true });
    await link.hover();
    await link.click();
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(name.includes('task.md') ? /task.md/ : /\.zip$/);
  }
});
test('new conversation centers the composer and native file input uploads', async ({ page }) => {
  await page.getByRole('button', { name: '新建研究' }).click();
  await expect(page.getByRole('heading', { name: /一起.*研究.*些什么/ })).toBeVisible();
  const composer = (await page.locator('.composer-area').boundingBox())!;
  expect(composer.y).toBeGreaterThan(350);
  expect(composer.y).toBeLessThan(700);
  await page.getByLabel('选择研究附件').setInputFiles({
    name: '课题说明.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 课题说明'),
  });
  await expect(page.locator('.floating-files')).toContainText('课题说明.md');
  await expect(page.getByRole('button', { name: '查看文件 课题说明.md' })).toBeVisible();
  // Check file exists in artifacts (fresh class may timeout quickly)
  await expect(page.locator('.file-row')).toHaveCount(2); // uploads folder + file
  // Extra SSE snapshots must not cancel the one-shot highlight cleanup.
  const list = await (await page.request.get('/api/sessions')).json();
  const created = list.find((s: { mode: string }) => s.mode === 'pi');
  await page.request.patch(`/api/sessions/${created.id}`, { data: { title: '新研究' } });
  await page.waitForTimeout(120);
  await page.request.patch(`/api/sessions/${created.id}`, { data: { title: '新研究' } });
  await expect(page.locator('.file-row.fresh')).toHaveCount(0, { timeout: 2500 });
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '移除附件 课题说明.md' }).click();
  await page.screenshot({ path: 'test-results/gewu-empty.png', fullPage: true });
});
test('the first new user message starts at the bottom of the conversation', async ({ page }) => {
  await page.getByRole('button', { name: '新建研究' }).click();
  await expect(page.getByRole('heading', { name: /一起.*研究.*些什么/ })).toBeVisible();
  const list = await (await page.request.get('/api/sessions')).json();
  const created = list.find((s: { mode: string }) => s.mode === 'pi');
  const state = await (await page.request.get(`/api/sessions/${created.id}`)).json();
  // Keep this layout check independent of external model latency/cost.
  await page.route(`**/api/sessions/${created.id}/messages`, (route) =>
    route.fulfill({
      json: {
        ...state,
        revision: 100,
        status: 'running',
        messages: [
          { id: 'first-user', role: 'user', text: '从一个问题开始', timestamp: Date.now() },
        ],
      },
    }),
  );
  await page.getByRole('textbox', { name: '研究消息', exact: true }).fill('从一个问题开始');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.user-bubble')).toContainText('从一个问题开始');
  const user = (await page.locator('.user-message').boundingBox())!;
  const scroll = (await page.locator('.message-scroll').boundingBox())!;
  expect(user.y).toBeGreaterThan(scroll.y + scroll.height / 2);
  expect(user.y + user.height).toBeGreaterThan(scroll.y + scroll.height - 120);
});
test('mobile panels stay usable without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  // Initial mobile layout starts with both inspectors closed.
  await expect(page.getByRole('button', { name: '展开会话边栏' })).toBeVisible();
  await page.getByRole('button', { name: '研究产物', exact: true }).click();
  await expect(page.locator('.artifact-section')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '研究产物', exact: true }).click();
  await page.screenshot({ path: 'test-results/gewu-mobile.png', fullPage: true });
});
test('stream, steering button, stop, hover actions and in-place edit', async ({ page }) => {
  const user = page.locator('.user-message').first();
  await expect(user.locator('.user-time')).toHaveCSS('opacity', '0');
  await page.locator('.message-scroll').hover();
  await page.mouse.wheel(0, -4000);
  await user.hover();
  await expect(user.locator('.user-time')).toHaveCSS('opacity', '1');
  await page.getByLabel('研究消息', { exact: true }).fill('演示一个流式回答');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible();
  const bubble = page.locator('.user-message').last();
  const bubbleBox = (await bubble.boundingBox())!;
  const scrollBox = (await page.locator('.message-scroll').boundingBox())!;
  expect(bubbleBox.y + bubbleBox.height).toBeGreaterThan(scrollBox.y + scrollBox.height - 140);
  await page.getByLabel('研究消息', { exact: true }).fill('补充一个边界条件');
  await expect(page.getByRole('button', { name: '发送纠偏消息' })).toBeVisible();
  await page.getByRole('button', { name: '发送纠偏消息' }).click();
  await expect(page.getByText('已排队，将在当前工具结束后结合此消息继续')).toBeVisible();
  await page.getByRole('button', { name: '停止生成' }).click();
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  const last = page.locator('.user-message').last();
  await last.hover();
  await last.getByRole('button', { name: '编辑消息' }).click();
  await page.getByRole('textbox', { name: '编辑消息', exact: true }).fill('修改后的问题');
  await page.getByRole('button', { name: '重新发送', exact: true }).click();
  await expect(page.locator('.user-message').last()).toContainText('修改后的问题');
  await page.getByRole('button', { name: '停止生成' }).click();
});

test('new streamed text fades in, old text stays settled and the final fade completes', async ({
  page,
}) => {
  await expect(
    page.locator('.markdown-surface[data-stream-state="complete"] [data-sd-animate]'),
  ).toHaveCount(0);
  await page.getByRole('textbox', { name: '研究消息', exact: true }).fill('检查文字渐显的节奏');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const live = page.locator('.markdown-surface[data-stream-state="streaming"]').last();
  await expect(live).toBeVisible();
  await expect
    .poll(() =>
      live
        .locator('[data-sd-animate]')
        .evaluateAll((nodes) =>
          nodes.some(
            (node) => (node as HTMLElement).style.getPropertyValue('--sd-duration') === '380ms',
          ),
        ),
    )
    .toBe(true);
  const first = live.locator('[data-sd-animate]').first();
  const startedAt = await first.evaluate(async (node) => {
    const animation = node.getAnimations()[0];
    await animation?.ready;
    return animation?.startTime;
  });
  await expect
    .poll(() => first.evaluate((node) => Number(node.getAnimations()[0]?.currentTime || 0)))
    .toBeGreaterThanOrEqual(350);
  expect(await first.evaluate((node) => node.getAnimations()[0]?.startTime)).toBe(startedAt);
  await expect(first).toHaveCSS('opacity', '1');
  const text = await live.textContent();
  await page.getByRole('button', { name: '停止生成' }).click();
  const last = page.locator('.assistant-message .markdown-surface').last();
  await expect(last).toHaveAttribute('data-stream-state', 'settling');
  await expect(last).toContainText(text!.trim());
  await expect(last).toHaveAttribute('data-stream-state', 'complete');
  await expect(last.locator('[data-sd-animate]')).toHaveCount(0);
});

test('reduced-motion preference displays streaming content immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('textbox', { name: '研究消息', exact: true }).fill('检查低动效模式');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const live = page.locator('.markdown-surface[data-stream-state="streaming"]').last();
  await expect(live).toBeVisible();
  await expect(live.locator('[data-sd-animate]')).toHaveCount(0);
  await expect.poll(() => live.textContent()).not.toBe('');
  await page.getByRole('button', { name: '停止生成' }).click();
  await expect(page.locator('.assistant-message .markdown-surface').last()).toHaveAttribute(
    'data-stream-state',
    'complete',
  );
});
