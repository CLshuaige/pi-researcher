import { useEffect, useId, useRef, useState } from 'react';
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

function activityBounds(activity: HTMLElement) {
  const parent = activity.parentElement;
  const canvas = parent?.querySelector<HTMLElement>('.flow-canvas');
  if (!parent || !canvas) return { min: 34, max: 34 };
  const fixedHeight = Array.from(parent.children)
    .filter((child) => child !== activity && child !== canvas)
    .reduce((height, child) => height + child.getBoundingClientRect().height, 0);
  const available = Math.max(34, parent.clientHeight - fixedHeight);
  const min = Math.min(80, Math.max(34, available / 3));
  const canvasMin = Math.min(150, Math.max(0, available - min));
  return { min, max: Math.max(min, available - canvasMin) };
}

export function ResearchActivity({ messages }: { messages: ChatMessage[] }) {
  const [open, setOpen] = useState(true);
  const [resizedHeight, setResizedHeight] = useState<number>();
  const [range, setRange] = useState<{ min: number; max: number }>();
  const dragRef = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const activityRef = useRef<HTMLElement>(null);
  const listId = useId();
  const recent = messages
    .filter((message) => message.role === 'tool')
    .slice(-12)
    .reverse();

  const resized = resizedHeight !== undefined;
  useEffect(() => {
    const parent = activityRef.current?.parentElement;
    if (!parent || !open || !resized) return;
    const resizeObserver = new ResizeObserver(() => {
      const activity = activityRef.current;
      if (!activity) return;
      const bounds = activityBounds(activity);
      setRange(bounds);
      setResizedHeight((height) =>
        height === undefined ? undefined : Math.max(bounds.min, Math.min(bounds.max, height)),
      );
    });
    resizeObserver.observe(parent);
    return () => resizeObserver.disconnect();
  }, [open, resized]);

  return (
    <>
      {open && (
        <div
          className="research-activity-resize"
          role="separator"
          aria-label="调整画布与研究动态高度"
          aria-orientation="horizontal"
          aria-valuemin={range?.min ?? 34}
          aria-valuemax={range?.max}
          aria-valuenow={resizedHeight === undefined ? undefined : Math.round(resizedHeight)}
          tabIndex={0}
          onPointerDown={(event) => {
            const activity = event.currentTarget.nextElementSibling as HTMLElement;
            dragRef.current = {
              pointerId: event.pointerId,
              y: event.clientY,
              height: activity.getBoundingClientRect().height,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            const activity = event.currentTarget.nextElementSibling as HTMLElement;
            const bounds = activityBounds(activity);
            setRange(bounds);
            setResizedHeight(
              Math.max(bounds.min, Math.min(bounds.max, drag.height + drag.y - event.clientY)),
            );
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          onLostPointerCapture={() => {
            dragRef.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            const activity = event.currentTarget.nextElementSibling as HTMLElement;
            const current = resizedHeight ?? activity.getBoundingClientRect().height;
            const delta = event.key === 'ArrowUp' ? 24 : -24;
            const bounds = activityBounds(activity);
            setRange(bounds);
            setResizedHeight(Math.max(bounds.min, Math.min(bounds.max, current + delta)));
          }}
        >
          <span />
        </div>
      )}
      <section
        ref={activityRef}
        className="research-activity"
        aria-label="研究动态"
        style={
          open && resizedHeight !== undefined
            ? { flex: `0 0 ${resizedHeight}px`, maxHeight: 'none' }
            : undefined
        }
      >
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
    </>
  );
}
