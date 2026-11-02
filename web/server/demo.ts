import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StoredSession } from './store.ts';
import { SessionStore } from './store.ts';

export async function seedDemo(store: SessionStore) {
  if (store.sessions.has('demo')) {
    const demo = store.get('demo');
    for (const message of demo.messages) {
      if (message.links)
        for (const link of message.links) link.title = link.title.replaceAll(' · ', '，');
    }
    return;
  }
  const s = store.create('demo', 'demo');
  const now = Date.now();
  s.title = '多模态大模型的强化学习方法研究';
  s.workflow.source = 'demo';
  s.workflow.nodes.find((n) => n.id === 'task')!.status = 'completed';
  s.workflow.nodes.find((n) => n.id === 'literature')!.status = 'running';
  s.messages = [
    {
      id: 'demo-user',
      role: 'user',
      text: '请帮我研究多模态大模型中使用强化学习的方法，重点关注近两年的进展，并分析几种代表性方法的优缺点。',
      timestamp: now - 180000,
    },
    {
      id: 'demo-intro',
      role: 'assistant',
      text: '好的，我将为你开展相关的研究工作。\n\n我会先明确研究范围和关键问题，再检索与阅读相关文献，对比代表性方法的训练策略、评估方式与适用边界，最后整理成可追溯的研究成果。',
      timestamp: now - 179000,
      status: 'completed',
    },
    {
      id: 'demo-task',
      role: 'tool',
      name: 'research-task',
      description: '已识别研究主题、时间范围和重点问题',
      text: '已生成 research/task.md。\n研究目标：梳理多模态大模型中的强化学习方法。\n关注范围：训练策略、奖励建模、评估与局限。\n这是一份交互演示文件，不代表已完成实际研究。',
      timestamp: now - 120000,
      status: 'completed',
      args: { path: 'research/task.md' },
    },
    {
      id: 'demo-search',
      role: 'tool',
      name: 'academic_search',
      description: '检索相关研究，核对原文与证据范围',
      text: '演示检索结果：点击下面的来源可在这里展开链接。正式研究的结果由实际检索工具返回。',
      timestamp: now - 60000,
      status: 'running',
      args: { source: 'arxiv', query: 'multimodal reinforcement learning' },
      links: [
        {
          title: 'arXiv，多模态强化学习相关论文',
          url: 'https://arxiv.org/search/?query=multimodal+reinforcement+learning&searchtype=all',
        },
        {
          title: 'Semantic Scholar，相关文献',
          url: 'https://www.semanticscholar.org/search?q=multimodal%20reinforcement%20learning',
        },
        {
          title: 'OpenAlex，开放学术索引',
          url: 'https://openalex.org/works?search=multimodal%20reinforcement%20learning',
        },
      ],
    },
  ];
  const workspace = store.workspace(s.id);
  await mkdir(join(workspace, 'research'), { recursive: true });
  await writeFile(
    join(workspace, 'research/task.md'),
    '# 研究任务，交互演示\n\n研究多模态大模型中使用强化学习的方法。\n\n- 关注训练策略、奖励建模与评估\n- 对比代表性方法的优缺点\n- 每项结论保留来源与证据范围\n\n> 此文件仅用于界面交互演示，并非真实科研结果。\n',
  );
  await writeFile(
    join(workspace, 'research/literature.md'),
    '# 文献调研，示例\n\n正式研究将在这里保存经过实际检索和阅读的结果。\n\n当前界面中的来源链接用于演示展开交互，不代表已经阅读或验证这些论文。\n',
  );
  s.notice = '交互演示：消息与文件为示例。点击「新建研究」连接真实 Pi 会话。';
  store.save(s);
}

export function completeDemoTools(s: StoredSession) {
  for (const m of s.messages) if (m.status === 'running') m.status = 'completed';
}
