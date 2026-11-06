import { RESEARCH_STAGE_LABELS, researchAgentRole } from '../../shared/research';
import { useEffect, useState } from 'react';
import { Collapsible } from '@animate-ui/react/primitives/radix-ui/collapsible';
import { Tabs } from '@animate-ui/react/primitives/radix-ui/tabs';
import { ChevronDown, LoaderCircle, Circle, Bot, Clock3, BookOpen, FlaskConical, FilePenLine, Lightbulb, Compass, ClipboardList, ScanSearch } from 'lucide-react';
import type { ChatMessage, SubSession } from '../../shared/types';
import { Markdown } from './Markdown';
import { FileIcon } from './FileIcon';
import { Disclosure } from './ui/animated';
import { toolTitle, CommandGroup, groupAdjacentCommands } from './ToolStep';
import { ThinkingBlock } from './ThinkingBlock';

function duration(start: number, end: number) {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
function toolDetail(message: ChatMessage) {
  const args = message.args || {};
  const path = typeof args.path === 'string' ? args.path : '';
  if (path) return path.split('/').slice(-3).join('/');
  const value = args.query || args.command || args.url || args.objective || '';
  return String(value).replace(/^cd\s+(?:'[^']*'|"[^"]*"|\S+)\s*&&\s*/, '').replace(/\s+/g, ' ').slice(0, 180);
}
const outcomes: Record<string, string> = {
  partial: '待补充',
  not_started: '未执行',
  blocked: '已阻塞',
  timed_out: '已超时',
  queued: '排队中',
};
const roleIcons: Record<string, typeof Bot> = {
  'research-task': ClipboardList,
  'research-literature': BookOpen,
  'research-hypothesis': Lightbulb,
  'research-method': Compass,
  'research-experiment': FlaskConical,
  'research-report': FilePenLine,
  'research-review': ScanSearch,
};
const stages = {
  running: '进行中',
  completed: '已完成',
  failed: '需要关注',
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
  const role = researchAgentRole(sub.skill);
  const RoleIcon = roleIcons[role?.name || ''] || Bot;
  const title = role?.label || (sub.skill ? sub.skill.split(/[:/]/).at(-1) : '研究助手');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (sub.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sub.status]);
  const running = sub.status === 'running',
    files = sub.artifacts || [];
  const tools = sub.messages.filter((m) => m.role === 'tool').slice(-6);
  const latestTool = tools.at(-1);
  const latestComment = sub.messages.filter(m => m.role === 'assistant' && m.text.trim()).at(-1)?.text;
  const lastActivity = sub.lastActivityAt || latestTool?.timestamp;
  const summary =
    sub.summary ||
    (!running ? sub.messages.filter((m) => m.role === 'assistant').at(-1)?.text : undefined);
  return (
    <Collapsible.Root defaultOpen className="sub-session" data-status={sub.status} data-role={role?.name || 'custom'}>
      <RoleIcon className="sub-session-watermark" size={100} strokeWidth={1} aria-hidden="true" />
      <Collapsible.Trigger className="sub-session-header">
        <span className="sub-session-icon">
          {running ? (
            <LoaderCircle size={16} className="spin" />
          ) : sub.status === 'completed' ? (
            <Circle size={9} fill="currentColor" className="sub-session-light done" />
          ) : sub.status === 'failed' ? (
            <Circle size={9} fill="currentColor" className="sub-session-light attention" />
          ) : (
            <Bot size={16} />
          )}
        </span>
        <span className="sub-session-title">{title}</span>
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
                ?.split(/[、,]/)
                .map((skill) => { const name = skill.trim().split(/[:/]/).at(-1) || ''; return RESEARCH_STAGE_LABELS[name] || skill; })
                .join('、') || '研究子任务'}
            </span>
            <span>
              <Clock3 size={12} />
              {duration(sub.startedAt, sub.endedAt || now)}
            </span>
          </div>
          {sub.objective && sub.objective !== title && (
            <p className="sub-session-objective">{sub.objective}</p>
          )}
          <Tabs.Root defaultValue="progress">
            <Tabs.List className="sub-session-tabs" aria-label="子任务内容">
              <Tabs.Trigger value="progress">进展</Tabs.Trigger>
              <Tabs.Trigger value="logs">执行记录 {sub.messages.length || ''}</Tabs.Trigger>
              <Tabs.Trigger value="files">产物 {files.length || ''}</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="progress" className="sub-session-pane">
              {running && (
                <div className="sub-session-live">
                  <span className="child-pulse" />
                  <div className="child-live-detail">
                    <strong>{sub.currentTool
                      ? `正在${toolTitle({ name: sub.currentTool })}`
                      : latestTool ? '等待下一步输出' : '正在启动子任务'}</strong>
                    {latestTool && <span>
                      {latestTool.status === 'running' ? '正在执行' : latestTool.status === 'failed' ? '最近失败' : '最近完成'}：{toolTitle(latestTool)}
                      {toolDetail(latestTool) && ` · ${toolDetail(latestTool)}`}
                    </span>}
                    {lastActivity && <time dateTime={new Date(lastActivity).toISOString()}>
                      最后活动 {new Date(lastActivity).toLocaleTimeString('zh-CN', { hour12: false })}
                      {' · '}{duration(lastActivity, now)}前
                    </time>}
                  </div>
                </div>
              )}
              {running && latestComment && <p className="child-progress-comment">{latestComment.slice(0, 240)}{latestComment.length > 240 ? '…' : ''}</p>}
              {tools.length > 0 && (
                <ol className="child-timeline">
                  {tools.map((m) => (
                    <li key={m.id} data-status={m.status}>
                      <span className="child-event-dot" />
                      <span className="child-event-content">
                        <span>{toolTitle(m)}</span>
                        {toolDetail(m) && <small title={toolDetail(m)}>{toolDetail(m)}</small>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {running && sub.progress && <Disclosure title="原始进度输出" defaultOpen={false} className="child-tool">
                <pre>{sub.progress}</pre>
              </Disclosure>}
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
                groupAdjacentCommands(sub.messages.filter(m =>
                  m.role === 'tool' || m.text || m.thinking?.trim() || m.thinkingStatus === 'running',
                )).map(messages => {
                  const m = messages[0];
                  return messages.length > 1 ? (
                    <CommandGroup
                      key={m.id}
                      messages={messages}
                      renderMessage={message => <Disclosure
                        key={message.id}
                        title={toolTitle(message)}
                        className="child-tool"
                        defaultOpen={false}
                      >
                        <pre>{message.text || JSON.stringify(message.args, null, 2)}</pre>
                      </Disclosure>}
                    />
                  ) : m.role === 'tool' ? (
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
                      <ThinkingBlock text={m.thinking} status={m.thinkingStatus} />
                      {m.text && <Markdown>{m.text}</Markdown>}
                    </div>
                  );
                })
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
                <p className="sub-session-empty">{running ? '尚未交付文件' : '尚未交付文件'}</p>
              )}
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
