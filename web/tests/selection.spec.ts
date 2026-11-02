import { test, expect, type Locator, type Page } from '@playwright/test';

async function selectContents(element: Locator) {
  await element.scrollIntoViewIfNeeded();
  return element.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
}
function menu(page: Page) {
  return page.getByRole('toolbar', { name: '选中文本操作' });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('gewu-active-session', 'demo'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '多模态大模型的强化学习方法研究' })).toBeVisible();
  await expect(page.locator('.assistant-body .markdown p').first()).toBeVisible();
});

test('mouse selection copies exact text and sends a quoted follow-up without losing the draft or files', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const input = page.getByRole('textbox', { name: '研究消息', exact: true });
  await input.fill('已有的追问草稿');
  await page
    .getByLabel('选择研究附件')
    .setInputFiles({ name: '补充.txt', mimeType: 'text/plain', buffer: Buffer.from('补充信息') });
  const paragraph = page.locator('.assistant-body .markdown p').first();
  await paragraph.scrollIntoViewIfNeeded();
  const box = (await paragraph.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(menu(page)).toBeVisible();
  const selected = await page.evaluate(() => window.getSelection()!.toString());
  expect(selected.length).toBeGreaterThan(4);
  await expect(menu(page).getByRole('button').nth(0)).toHaveText('复制');
  await expect(menu(page).getByRole('button').nth(1)).toHaveText('问问格物');
  await menu(page).getByRole('button', { name: '复制选中文字' }).click();
  await expect(menu(page)).toContainText('已复制');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(selected);
  const count = await page.locator('.user-message').count();
  await page.screenshot({ path: 'test-results/gewu-selection.png', fullPage: true });
  await menu(page).getByRole('button', { name: '问问格物', exact: true }).click();
  await expect(menu(page)).toHaveCount(0);
  await expect(page.locator('.floating-quote')).toContainText(selected);
  await expect(input).toHaveValue('已有的追问草稿');
  await expect(input).toBeFocused();
  await expect(page.locator('.floating-files')).toContainText('补充.txt');
  expect(await page.locator('.user-message').count()).toBe(count);
  await input.fill('请进一步解释这段内容');
  const sent = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/sessions/demo/messages'),
  );
  await page.screenshot({ path: 'test-results/gewu-quoted-composer.png', fullPage: true });
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const body = (await sent).postDataJSON();
  expect(body.text).toBe('请进一步解释这段内容');
  expect(body.quotes[0].text).toBe(selected);
  expect(body.quotes[0].messageId).toBe('demo-intro');
  expect(body.attachments).toHaveLength(1);
  await expect(page.locator('.user-message').last().getByLabel('引用片段')).toContainText(selected);
  await expect(page.locator('.floating-quote')).toHaveCount(0);
  await page.getByRole('button', { name: '停止生成' }).click();
  await page.reload();
  await expect(page.locator('.user-message').last().getByLabel('引用片段')).toContainText(selected);
});

test('quotes can be replaced or removed, and user/tool text never opens the answer toolbar', async ({
  page,
}) => {
  const input = page.getByRole('textbox', { name: '研究消息', exact: true });
  await input.fill('保留这个问题');
  await selectContents(page.locator('.user-text').first());
  await expect(menu(page)).toHaveCount(0);
  await selectContents(page.locator('.tool-output pre').first());
  await expect(menu(page)).toHaveCount(0);
  const paragraphs = page.locator('[data-message-id="demo-intro"] .markdown p');
  await selectContents(paragraphs.nth(0));
  await menu(page).getByRole('button', { name: '问问格物' }).click();
  const replacement = await selectContents(paragraphs.nth(1));
  await menu(page).getByRole('button', { name: '问问格物' }).click();
  await expect(page.locator('.floating-quote')).toHaveCount(2);
  await expect(page.locator('.floating-quote').last()).toContainText(replacement.slice(0, 50));
  await page.getByRole('button', { name: '移除引用' }).last().click();
  await expect(page.locator('.floating-quote')).toHaveCount(1);
  await page.getByRole('button', { name: '移除引用' }).click();
  await expect(page.locator('.floating-quote')).toHaveCount(0);
  await expect(input).toHaveValue('保留这个问题');
});

test('multiline selections stay inside the mobile viewport and dismiss with Escape or deselection', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const paragraph = page.locator('[data-message-id="demo-intro"] .markdown p').nth(1);
  await selectContents(paragraph);
  await expect(menu(page)).toBeVisible();
  const bounds = (await menu(page).boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await selectContents(paragraph);
  await expect(menu(page)).toBeVisible();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await expect(menu(page)).toHaveCount(0);
});
