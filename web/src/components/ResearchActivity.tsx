import { useId, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Check,
  ChevronDown,
  Circle,
  LoaderCircle,
  Minus,
} from 'lucide-react';
import type { ChatMessage } from '../../shared/types';
import { toolTitle } from './ToolStep';

export function ResearchActivity({ messages }: { messages: ChatMessage[] }) {
  const [open, setOpen] = useState(true);
  const listId = useId();
  const recent = messages
    .filter((message) => message.role === 'tool')
    .slice(-12)
    .reverse();
  return (
    <section className="research-activity" aria-label="研究动态">
      <button
        className="research-activity-toggle"
        aria-label={`${open ? '收起' : '展开'}研究动态`}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        <Activity size={13} />
        <span className="research-activity-title">研究动态</span>
        <span className="research-activity-count">
          {recent.length ? `最近 ${recent.length} 条` : '等待研究开始'}
        </span>
        <ChevronDown size={13} className={open ? 'expanded' : ''} />
      </button>
      <div id={listId} className="research-activity-body" hidden={!open}>
        {recent.length ? (
          <ol className="research-activity-list" aria-label="最近研究动态，按开始时间倒序">
            {recent.map((message) => {
              const status = message.status;
              const Icon =
                status === 'running'
                  ? LoaderCircle
                  : status === 'completed'
                    ? Check
                    : status === 'failed'
                      ? AlertCircle
                      : status === 'cancelled'
                        ? Minus
                        : Circle;
              const detail = [
                message.description,
                message.args?.query,
                message.args?.objective,
                message.args?.path,
                message.args?.command,
              ].find((value): value is string => typeof value === 'string' && !!value.trim());
              return (
                <li key={message.id} className="research-activity-item" data-status={status}>
                  <span className="research-activity-icon">
                    <Icon size={12} />
                  </span>
                  <div className="research-activity-content">
                    <div className="research-activity-line">
                      <strong>{toolTitle(message)}</strong>
                      <time
                        dateTime={new Date(message.timestamp).toISOString()}
                        title={`开始于 ${new Date(message.timestamp).toLocaleString('zh-CN')}`}
                      >
                        {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                      </time>
                    </div>
                    <p title={detail}>{detail || '执行详情可在对话中查看'}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="research-activity-empty">检索、分析与工具执行记录将在这里同步展示。</p>
        )}
      </div>
    </section>
  );
}
