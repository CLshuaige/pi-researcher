import { test, expect } from '@playwright/test';
import type { ResearchSession } from '../shared/types';

test('a scheduled research wait stays active, accepts input and can be paused', async ({
  page,
}) => {
  const response = await page.request.post('/api/sessions', { data: {} });
  expect(response.ok()).toBeTruthy();
  const created: ResearchSession = await response.json();
  const now = Date.now();
  let state: ResearchSession = {
    ...created,
    revision: 100000,
    status: 'idle',
    workflow: {
      source: 'checklist',
      control: { state: 'waiting', wakeAt: now + 600000 },
      nodes: [
        {
          id: 'experiment',
          label: '实验执行',
          description: '等待后台实验',
          status: 'running',
          x: 0,
          y: 0,
        },
      ],
      edges: [],
    },
    messages: [
      {
        id: 'wait-call',
        role: 'tool',
        name: 'research_job',
        timestamp: now,
        status: 'completed',
        args: { action: 'wait', wakeAfterSeconds: 600 },
        text: JSON.stringify({
          waitRequested: true,
          waitId: 'scheduled-check',
          wakeAt: now + 600000,
        }),
      },
    ],
  };
  await page.route(`**/api/sessions/${created.id}`, (route) => route.fulfill({ json: state }));
  const sent: string[] = [];
  await page.route(`**/api/sessions/${created.id}/messages`, async (route) => {
    sent.push(route.request().postDataJSON().text);
    state = {
      ...state,
      revision: state.revision + 1,
      status: 'running',
      workflow: { ...state.workflow, control: { state: 'running' } },
    };
    await route.fulfill({ status: 202, json: state });
  });
  let pauses = 0;
  await page.route(`**/api/sessions/${created.id}/stop`, async (route) => {
    pauses++;
    state = {
      ...state,
      revision: state.revision + 1,
      status: 'idle',
      workflow: { ...state.workflow, control: { state: 'paused' } },
    };
    await route.fulfill({ json: state });
  });
  await page.addInitScript((id) => localStorage.setItem('gewu-active-session', id), created.id);
  try {
    await page.goto('/');
    const canvasStatus = page.locator('.flow-section .canvas-status');
    const pause = page.getByRole('button', { name: '暂停研究', exact: true });
    await expect(pause).toBeEnabled();
    await expect(canvasStatus).toHaveClass(/active/);
    await expect(canvasStatus).toContainText('运行中');
    await expect(page.getByRole('status', { name: '正在继续研究' })).toBeVisible();
    const researchStatus = page.getByRole('button', { name: '查看研究状态' });
    await expect(researchStatus).toContainText('研究进行中');
    await researchStatus.click();
    await expect(page.getByRole('dialog', { name: '研究状态' })).toContainText('下次检查：');
    await page.keyboard.press('Escape');

    // Waiting must still allow a user message to resume/redirect the research.
    await page.getByRole('textbox', { name: '研究消息', exact: true }).fill('调整下一轮实验参数');
    await page.getByRole('button', { name: '发送纠偏消息', exact: true }).click();
    await expect.poll(() => sent).toEqual(['调整下一轮实验参数']);
    await expect(pause).toBeEnabled();

    state = {
      ...state,
      revision: state.revision + 1,
      status: 'idle',
      workflow: { ...state.workflow, control: { state: 'waiting', wakeAt: now + 600000 } },
    };
    await page.reload();
    await expect(pause).toBeEnabled();
    await pause.click();
    await expect.poll(() => pauses).toBe(1);
    await expect(researchStatus).toContainText('研究已暂停');
    await expect(canvasStatus).not.toHaveClass(/active/);
    await expect(canvasStatus).toContainText('就位');
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled();
    await expect(pause).toHaveCount(0);
    await expect(page.getByRole('status', { name: '正在继续研究' })).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/sessions/${created.id}`);
  }
});
