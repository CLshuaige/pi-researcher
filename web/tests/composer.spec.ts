import { test, expect } from '@playwright/test';

test('composer text stays aligned with the textarea caret as input grows and wraps', async ({
  page,
}) => {
  const created = await page.request.post('/api/sessions', { data: {} });
  expect(created.ok()).toBeTruthy();
  const session = await created.json();
  await page.addInitScript((id) => localStorage.setItem('gewu-active-session', id), session.id);
  await page.goto('/');
  try {
    const input = page.getByRole('textbox', { name: '研究消息', exact: true });
    await expect(input).toBeEnabled();

    for (const text of [
      'Research',
      'Research input grows with each letter and should stay aligned',
      '研究消息中英文 mixed input 12345\n第二行继续输入 research details',
      'Long research input with mixed 中文内容 and numbers 12345 '.repeat(5),
    ]) {
      await input.fill(text);
      await expect(page.locator('.w-md-editor-text-pre > code')).toContainText(text.trim());

      const drift = await input.evaluate((textarea: HTMLTextAreaElement) => {
        const code = textarea.parentElement!.querySelector('.w-md-editor-text-pre > code')!;
        // A mirror with the textarea's computed typography exposes native text/caret geometry.
        const mirror = document.createElement('div');
        const style = getComputedStyle(textarea);
        for (const property of Array.from(style)) {
          mirror.style.setProperty(property, style.getPropertyValue(property));
        }
        Object.assign(mirror.style, {
          position: 'fixed',
          left: '0',
          top: '0',
          width: `${textarea.getBoundingClientRect().width}px`,
          height: 'auto',
          maxHeight: 'none',
          visibility: 'hidden',
        });
        mirror.textContent = textarea.value;
        document.body.append(mirror);

        const origin = textarea.getBoundingClientRect();
        const mirrorOrigin = mirror.getBoundingClientRect();
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        let offset = 0;
        let maxX = 0;
        let maxY = 0;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          for (
            let i = 0;
            i < node.textContent!.length && offset < textarea.value.length;
            i++, offset++
          ) {
            if (textarea.value[offset] === '\n') continue;
            const visible = document.createRange();
            visible.setStart(node, i);
            visible.setEnd(node, i + 1);
            const native = document.createRange();
            native.setStart(mirror.firstChild!, offset);
            native.setEnd(mirror.firstChild!, offset + 1);
            const a = visible.getBoundingClientRect();
            const b = native.getBoundingClientRect();
            maxX = Math.max(maxX, Math.abs(a.right - origin.left - (b.right - mirrorOrigin.left)));
            maxY = Math.max(
              maxY,
              Math.abs(a.top - origin.top + textarea.scrollTop - (b.top - mirrorOrigin.top)),
            );
          }
        }
        mirror.remove();
        return { maxX, maxY, measured: offset };
      });

      expect(drift.measured).toBe(text.length);
      expect(drift.maxX, `horizontal caret drift for ${text}`).toBeLessThan(1);
      expect(drift.maxY, `vertical caret drift for ${text}`).toBeLessThan(1);
      await expect(input).toHaveValue(text);
    }
  } finally {
    await page.request.delete(`/api/sessions/${session.id}`);
  }
});
