import { test, expect } from '@playwright/test';

test('workflow canvas stays inside its panel after zoom, pan and split resizing', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('gewu-active-session', 'demo'));
  await page.goto('/');
  await expect(page.locator('.flow-section')).toBeVisible();
  await expect(page.locator('.inspector')).toHaveCSS('display', 'grid');
  const separated = async () => {
    const flow = (await page.locator('.flow-section').boundingBox())!;
    const artifacts = (await page.locator('.artifact-section').boundingBox())!;
    return flow.y + flow.height <= artifacts.y;
  };
  await expect.poll(separated).toBe(true);
  await page.getByRole('button', { name: '放大流程图' }).click({ clickCount: 3 });
  const canvas = (await page.getByTestId('flow-canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width - 8, canvas.y + 65);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width - 8, canvas.y + canvas.height + 220, { steps: 12 });
  await page.mouse.up();
  const divider = page.getByRole('separator', { name: '调整研究节点与产物高度' });
  for (const movement of [-450, 700]) {
    const box = (await divider.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + movement, { steps: 8 });
    await page.mouse.up();
    await expect.poll(separated).toBe(true);
  }
  const file = page.getByRole('button', { name: '查看文件 task.md', exact: true });
  await file.scrollIntoViewIfNeeded();
  expect(
    await file.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return !!document
        .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        ?.closest('.artifact-section');
    }),
  ).toBe(true);
  await file.click();
  await expect(page.getByRole('region', { name: '文件预览 task.md' })).toBeVisible();
});

test('research-source checkmarks stay centered and toggle with the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建研究' }).click();
  await expect(page.locator('.empty-title')).toBeVisible();
  await page.getByRole('button', { name: '参数配置', exact: true }).click();
  const boxes = page.getByRole('checkbox');
  await expect(boxes).toHaveCount(6);
  for (const box of await boxes.all()) {
    await expect(box).toHaveAttribute('aria-checked', 'true');
    const offset = await box.evaluate((el) => {
      const b = el.getBoundingClientRect(),
        mark = el.querySelector('svg')!.getBoundingClientRect();
      return Math.max(
        Math.abs(b.x + b.width / 2 - mark.x - mark.width / 2),
        Math.abs(b.y + b.height / 2 - mark.y - mark.height / 2),
      );
    });
    expect(offset).toBeLessThan(0.75);
  }
  await boxes.first().focus();
  await page.keyboard.press('Space');
  await expect(boxes.first()).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Space');
  await expect(boxes.first()).toHaveAttribute('aria-checked', 'true');
});

test('program cards share one scrollbar for output and bottom-of-card parameters', async ({
  page,
}) => {
  const demo = await (await page.request.get('/api/sessions/demo')).json();
  const output = Array.from(
    { length: 100 },
    (_, i) => `epoch ${i + 1}: measured loss = ${(1 / (i + 1)).toFixed(4)}`,
  ).join('\n');
  const state = {
    ...demo,
    revision: 100000,
    status: 'idle',
    subSessions: [],
    messages: [
      { id: 'request', role: 'user', text: '检查程序输出', timestamp: Date.now() },
      {
        id: 'program',
        role: 'tool',
        name: 'bash',
        status: 'completed',
        text: output,
        timestamp: Date.now(),
        args: {
          command: 'python experiment/demo/src/train.py --epochs 100',
          settings: Object.fromEntries(
            Array.from({ length: 40 }, (_, i) => [`parameter_${i}`, `value_${i}`]),
          ),
        },
      },
    ],
  };
  await page.route('**/api/sessions/demo', (route) => route.fulfill({ json: state }));
  await page.addInitScript(() => localStorage.setItem('gewu-active-session', 'demo'));
  await page.goto('/');
  const card = page.locator('.execution-card');
  await expect(card).toContainText('程序输出');
  const scroller = card.locator('.tool-detail');
  const scrollbars = () =>
    card.evaluate(
      (el) =>
        [el, ...el.querySelectorAll('*')].filter((node) => {
          const css = getComputedStyle(node);
          return (
            ['auto', 'scroll'].includes(css.overflowY) && node.scrollHeight > node.clientHeight + 1
          );
        }).length,
    );
  await expect.poll(scrollbars).toBe(1);
  const parameters = card.getByRole('button', { name: '调用参数', exact: true });
  await expect(parameters).toHaveAttribute('data-state', 'closed');
  await expect(parameters).not.toBeInViewport();
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(parameters).toBeInViewport();
  expect(
    await scroller.evaluate((el) => el.lastElementChild?.classList.contains('tool-parameters')),
  ).toBe(true);
  await parameters.click();
  await expect(parameters).toHaveAttribute('data-state', 'open');
  const parameterBody = card.locator('.tool-parameters > div[data-state="open"]');
  await expect
    .poll(() => parameterBody.evaluate((el) => Math.abs(el.clientHeight - el.scrollHeight)))
    .toBeLessThan(2);
  await expect.poll(scrollbars).toBe(1);
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThan(2);
  for (const block of await card.locator('pre').all()) {
    await expect(block).toHaveCSS('overflow-y', 'visible');
    await expect(block).toHaveCSS('max-height', 'none');
  }
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await card.getByRole('button', { name: '复制程序输出' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(output);
});
