import { RESEARCH_STAGE_LABELS } from '../../shared/research';
import { useEffect, useState } from 'react';
import { Collapsible } from '@animate-ui/react/primitives/radix-ui/collapsible';
import { Tabs } from '@animate-ui/react/primitives/radix-ui/tabs';
import { ChevronDown, LoaderCircle, Check, X, Bot, Clock3 } from 'lucide-react';
import type { SubSession } from '../../shared/types';
import { Markdown } from './Markdown';
import { FileIcon } from './FileIcon';
import { Disclosure } from './ui/animated';
import { toolTitle } from './ToolStep';

function duration(start: number, end: number) {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
const outcomes: Record<string, string> = {
  partial: '待补充',
  not_started: '未执行',
  blocked: '已阻塞',
  timed_out: '已超时',
  queued: '排队中',
};
const stages = {
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已停止',
  pending: '等待中',
};
export function SubSessionView({
  subSession: sub,
  onPreviewFile,
}: {
  subSession: SubSession;
  onPreviewFile?: (path: string, name: string) => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (sub.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sub.status]);
  const running = sub.status === 'running',
    files = sub.artifacts || [];
  const tools = sub.messages.filter((m) => m.role === 'tool').slice(-6);
  const summary =
    sub.summary ||
    (!running ? sub.messages.filter((m) => m.role === 'assistant').at(-1)?.text : undefined);
  return (
    <Collapsible.Root defaultOpen className="sub-session" data-status={sub.status}>
      <Collapsible.Trigger className="sub-session-header">
        <span className="sub-session-icon">
          {running ? (
            <LoaderCircle size={16} className="spin" />
          ) : sub.status === 'completed' ? (
            <Check size={16} />
          ) : sub.status === 'failed' ? (
            <X size={16} />
          ) : (
            <Bot size={16} />
          )}
        </span>
        <span className="sub-session-title">{sub.label}</span>
        <span className={`sub-session-status ${sub.status}`}>
          {outcomes[sub.outcome || ''] || stages[sub.status]}
        </span>
        <ChevronDown size={15} className="sub-session-chevron" />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div className="sub-session-body">
          <div className="sub-session-meta">
            <span>
              {sub.skill
                ?.split('、')
                .map((skill) => RESEARCH_STAGE_LABELS[skill] || skill)
                .join('、') || '研究子任务'}
            </span>
            <span>
              <Clock3 size={12} />
              {duration(sub.startedAt, sub.endedAt || now)}
            </span>
          </div>
          {sub.objective && sub.objective !== sub.label && (
            <p className="sub-session-objective">{sub.objective}</p>
          )}
          <Tabs.Root defaultValue="progress">
            <Tabs.List className="sub-session-tabs" aria-label="子任务内容">
              <Tabs.Trigger value="progress">进展</Tabs.Trigger>
              <Tabs.Trigger value="logs">执行记录 {sub.messages.length || ''}</Tabs.Trigger>
              <Tabs.Trigger value="files">交付文件 {files.length || ''}</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="progress" className="sub-session-pane">
              {running && (
                <div className="sub-session-live">
                  <span className="child-pulse" />
                  <span>{sub.progress || '正在启动子任务，等待实际进展…'}</span>
                </div>
              )}
              {tools.length > 0 && (
                <ol className="child-timeline">
                  {tools.map((m) => (
                    <li key={m.id} data-status={m.status}>
                      <span className="child-event-dot" />
                      <span>{toolTitle(m)}</span>
                    </li>
                  ))}
                </ol>
              )}
              {summary && (
                <div className="sub-session-summary">
                  <Markdown>{summary}</Markdown>
                </div>
              )}
              {!running && !summary && (
                <p className="sub-session-empty">{stages[sub.status]}，可查看执行记录。</p>
              )}
            </Tabs.Content>
            <Tabs.Content
              value="logs"
              className="sub-session-pane child-log"
              aria-label="子任务执行记录"
            >
              {sub.messages.length ? (
                sub.messages.map((m) =>
                  m.role === 'tool' ? (
                    <Disclosure
                      key={m.id}
                      title={toolTitle(m)}
                      className="child-tool"
                      defaultOpen={false}
                    >
                      <pre>{m.text || JSON.stringify(m.args, null, 2)}</pre>
                    </Disclosure>
                  ) : (
                    <div key={m.id} className="child-answer">
                      <Markdown>{m.text}</Markdown>
                    </div>
                  ),
                )
              ) : (
                <p className="sub-session-empty">
                  尚无可读取的执行记录，最新进度会显示在“进展”中。
                </p>
              )}
            </Tabs.Content>
            <Tabs.Content value="files" className="sub-session-pane">
              {files.length ? (
                files.map((path) => {
                  const name = path.split('/').at(-1) || path;
                  return (
                    <button
                      className="child-file"
                      key={path}
                      title={path}
                      onClick={() => onPreviewFile?.(path, name)}
                    >
                      <FileIcon name={name} />
                      <span>{name}</span>
                      <small>预览</small>
                    </button>
                  );
                })
              ) : (
                <p className="sub-session-empty">尚未交付文件</p>
              )}
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
