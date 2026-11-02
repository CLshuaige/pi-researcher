import { test, expect } from '@playwright/test';
test('research parameters persist while user settings keep their own sections', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '新建研究' }).click();
  await expect(page.locator('.empty-title')).toBeVisible();
  await page.getByRole('button', { name: '参数配置', exact: true }).click();
  await expect(page.locator('.settings-dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: '参数配置' })).toBeVisible();
  await page.getByRole('tab', { name: '假设构建', exact: true }).click();
  await expect(page.locator('#hypothesis-rounds')).toHaveValue('5');
  await page.getByRole('tab', { name: '方法设计', exact: true }).click();
  await expect(page.locator('#method-rounds')).toHaveValue('5');
  await page.locator('#method-rounds').fill('3');
  await page.getByRole('tab', { name: '文献调研', exact: true }).click();
  const toggle = page.getByRole('switch', { name: '生成文献综述' });
  await toggle.click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.settings-dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '参数配置', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('tab', { name: '方法设计', exact: true }).click();
  await expect(page.locator('#method-rounds')).toHaveValue('3');
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: '用户菜单' }).click();
  await expect(page.getByRole('menuitem', { name: '登出' })).toBeVisible();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '用户设置' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '个人资料', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '通用', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'API Key', exact: true })).toBeVisible();
  await page.getByLabel('显示名称').fill('浏览器研究员');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '用户菜单' })).toContainText('浏览器研究员');
  expect(errors).toEqual([]);
});

test('artifact image previews use the shared viewer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建研究' }).click();
  await page.getByLabel('选择研究附件').setInputFiles({
    name: 'figure.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6xkAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.getByRole('button', { name: '查看文件 figure.png' }).click();
  await expect(
    page
      .getByRole('region', { name: '文件预览 figure.png' })
      .getByRole('img', { name: 'figure.png' }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('home has one draggable skill image and equal sidebar icon sizes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建研究' }).click();
  await expect(page.locator('.empty-title')).toBeVisible();
  await expect(page.locator('.skill-box-button img')).toHaveCount(1);
  const box = page.locator('.skill-box');
  await expect(box).toBeVisible();
  const before = (await box.boundingBox())!;
  await page.mouse.move(before.x + 90, before.y + 90);
  await page.mouse.down();
  await page.mouse.move(before.x - 40, before.y - 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await box.boundingBox())!.x).toBeLessThan(before.x - 50);
  const close = page.getByRole('button', { name: '收起会话边栏' }).locator('svg');
  const closeSize = (await close.boundingBox())!;
  await page.getByRole('button', { name: '收起会话边栏' }).click();
  const openSize = (await page
    .getByRole('button', { name: '展开会话边栏' })
    .locator('svg')
    .boundingBox())!;
  expect(openSize.width).toBe(closeSize.width);
  expect(openSize.height).toBe(closeSize.height);
});

test('automatic mode is the default and the icon persists a deliberate change', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建研究' }).click();
  await expect(page.locator('.empty-title')).toBeVisible();
  const mode = page.locator('.mode-toggle');
  await expect(mode).toHaveAttribute('aria-pressed', 'true');
  await expect(mode).toHaveText('');
  await mode.click();
  await expect(mode).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(mode).toHaveAttribute('aria-pressed', 'false');
  await mode.click();
  await expect(mode).toHaveAttribute('aria-pressed', 'true');
});
