import { test, expect } from '@playwright/test';
import { parseChecklist } from '../server/workflow';

test('ordered research nodes render connected arrow paths in sidebar and fullscreen', async ({
  page,
}) => {
  const demo = await (await page.request.get('/api/sessions/demo')).json();
  const workflow = parseChecklist({
    modules: ['scope', 'papers', 'method'].map((id, i) => ({
      id,
      objective: `Research stage ${i + 1}`,
      skills: ['research-task'],
      status: i === 0 ? 'completed' : i === 1 ? 'running' : 'pending',
      dependencies: [],
    })),
  });
  await page.route('**/api/sessions/demo', (route) =>
    route.fulfill({
      json: { ...demo, revision: 100000, workflow, artifacts: [] },
    }),
  );
  await page.addInitScript(() => localStorage.setItem('gewu-active-session', 'demo'));
  await page.goto('/');

  const checkArrows = async (canvas: ReturnType<typeof page.locator>) => {
    const paths = canvas.locator('.react-flow__edge-path');
    await expect(canvas).toBeVisible();
    await expect(paths).toHaveCount(2);
    for (const path of await paths.all()) {
      // Vertical SVG paths have zero geometric width, so Playwright's box-based
      // visibility check treats them as hidden even though their stroke is drawn.
      await expect(path).toHaveCSS('visibility', 'visible');
      expect(
        await path.evaluate((el) => {
          const style = getComputedStyle(el);
          return (
            style.display !== 'none' &&
            style.stroke !== 'none' &&
            Number.parseFloat(style.strokeWidth) > 0
          );
        }),
      ).toBe(true);
      expect(await path.evaluate((el) => (el as SVGPathElement).getTotalLength())).toBeGreaterThan(
        0,
      );
      const marker = await path.getAttribute('marker-end');
      const id = marker?.match(/^url\(['"]?#(.+?)['"]?\)$/)?.[1];
      expect(id).toBeTruthy();
      expect(
        await canvas
          .locator('marker')
          .evaluateAll(
            (markers, id) =>
              markers.some((marker) => marker.id === id && !!marker.querySelector('polyline')),
            id,
          ),
      ).toBe(true);
    }
  };
  await checkArrows(page.locator('.flow-section'));
  await page.getByRole('button', { name: '全屏查看研究节点' }).click();
  const dialog = page.getByRole('dialog', { name: '研究节点全屏画布' });
  await expect(dialog).toBeVisible();
  await checkArrows(dialog);
});
