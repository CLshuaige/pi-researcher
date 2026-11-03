import { test, expect } from '@playwright/test';
import { parseChecklist } from '../server/workflow';

test('ordered research nodes render horizontal arrow paths in sidebar and fullscreen', async ({
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
      // Straight SVG paths can have zero geometric height, so Playwright's box-based
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
      const direction = await path.evaluate((el) => {
        const path = el as SVGPathElement;
        const start = path.getPointAtLength(0);
        const end = path.getPointAtLength(path.getTotalLength());
        return { dx: end.x - start.x, dy: end.y - start.y };
      });
      expect(direction.dx).toBeGreaterThan(0);
      expect(Math.abs(direction.dy)).toBeLessThan(1);
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
  const stages = page.locator('.flow-section .react-flow__node-stage');
  await expect(stages).toHaveCount(3);
  const positions = await stages.evaluateAll((nodes) =>
    nodes.map((node) => {
      const { x, y, width } = node.getBoundingClientRect();
      return { x, y, width };
    }),
  );
  expect(positions[1].x).toBeGreaterThan(positions[0].x + positions[0].width);
  expect(Math.abs(positions[1].y - positions[0].y)).toBeLessThan(1);
  const panel = (await page.locator('.inspector').boundingBox())!;
  const flow = (await page.locator('.flow-section').boundingBox())!;
  expect(panel.width).toBeGreaterThan(650);
  expect(flow.height / panel.height).toBeLessThan(0.46);
  await checkArrows(page.locator('.flow-section'));
  await page.getByRole('button', { name: '全屏查看研究节点' }).click();
  const dialog = page.getByRole('dialog', { name: '研究节点全屏画布' });
  await expect(dialog).toBeVisible();
  await checkArrows(dialog);
});

test('artifact trees stay below their stages when expanded and still open file previews', async ({
  page,
}) => {
  const demo = await (await page.request.get('/api/sessions/demo')).json();
  const file = (path: string) => ({
    path,
    name: path.split('/').at(-1),
    kind: 'file',
    size: 10,
    updatedAt: 1,
  });
  const workflow = parseChecklist({
    modules: [
      {
        id: 'scope',
        skills: ['research-task'],
        objective: '确认研究范围',
        status: 'completed',
        evidence: ['research/task.md'],
      },
      {
        id: 'method',
        skills: ['research-method'],
        objective: '设计实验方法',
        status: 'running',
        evidence: ['method'],
      },
    ],
  });
  await page.route('**/api/sessions/demo', (route) =>
    route.fulfill({
      json: {
        ...demo,
        revision: 100000,
        workflow,
        artifacts: [
          file('research/task.md'),
          {
            path: 'method',
            name: 'method',
            kind: 'directory',
            size: 0,
            updatedAt: 1,
            children: Array.from({ length: 6 }, (_, i) => file(`method/design-${i + 1}.md`)),
          },
        ],
      },
    }),
  );
  await page.addInitScript(() => localStorage.setItem('gewu-active-session', 'demo'));
  await page.goto('/');
  const canvas = page.locator('.flow-section');
  const stages = canvas.locator('.react-flow__node-stage');
  const trees = canvas.locator('.react-flow__node-resources');
  await expect(trees).toHaveCount(2);
  const checkPositions = async () => {
    for (let i = 0; i < 2; i++) {
      const stage = (await stages.nth(i).boundingBox())!;
      const tree = (await trees.nth(i).boundingBox())!;
      expect(tree.y).toBeGreaterThan(stage.y + stage.height);
      expect(Math.abs(tree.x + tree.width / 2 - stage.x - stage.width / 2)).toBeLessThan(1);
    }
  };
  await checkPositions();
  await trees.nth(1).getByRole('button', { name: '展开节点目录 method' }).click();
  await trees.nth(1).getByRole('button', { name: '展开其余 4 个文件' }).click();
  await checkPositions();
  await expect
    .poll(() =>
      trees
        .nth(1)
        .locator('.workflow-resource-tree')
        .evaluate((el) => el.scrollHeight > el.clientHeight),
    )
    .toBe(true);
  const connectors = canvas.locator(
    '.react-flow__edge[data-id^="resource-edge-"] .react-flow__edge-path',
  );
  await expect(connectors).toHaveCount(2);
  for (const connector of await connectors.all()) {
    const direction = await connector.evaluate((el) => {
      const path = el as SVGPathElement;
      const start = path.getPointAtLength(0),
        end = path.getPointAtLength(path.getTotalLength());
      return { dx: end.x - start.x, dy: end.y - start.y };
    });
    expect(Math.abs(direction.dx)).toBeLessThan(1);
    expect(direction.dy).toBeGreaterThan(0);
  }
  await canvas.getByRole('button', { name: '预览节点文件 task.md' }).click();
  await expect(page.getByRole('region', { name: '文件预览 task.md' })).toBeVisible();
});

test('the wider inspector leaves space for the conversation after a window resize', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('gewu-active-session', 'demo'));
  await page.goto('/');
  await expect(page.locator('.flow-section')).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect
    .poll(async () => (await page.locator('.conversation').boundingBox())!.width)
    .toBeGreaterThanOrEqual(399);
  const canvas = (await page.locator('.flow-section').boundingBox())!;
  expect(canvas.x + canvas.width).toBeLessThanOrEqual(1000);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
