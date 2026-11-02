import { useState } from 'react';
import { Brain, ChevronDown, ChevronRight, LoaderCircle } from 'lucide-react';
import type { StepStatus } from '../../shared/types';
import { Markdown } from './Markdown';

export function ThinkingBlock({
  text = '',
  status = 'completed',
}: {
  text?: string;
  status?: StepStatus;
}) {
  const running = status === 'running';
  // Follow the live state until the reader explicitly chooses to open or close it.
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? running;
  if (!text.trim() && !running) return null;
  const title = running
    ? '正在思考…'
    : status === 'cancelled'
      ? '思考已中断'
      : status === 'failed'
        ? '思考未完成'
        : '思考过程';
  return (
    <div className="thinking-block" data-status={status} aria-busy={running}>
      <button className="thinking-toggle" onClick={() => setExpanded(!open)} aria-expanded={open}>
        <span className="thinking-icon">
          {running ? <LoaderCircle size={14} className="spin" /> : <Brain size={14} />}
        </span>
        <span className="thinking-title">{title}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && text.trim() && (
        <div className="thinking-content">
          <Markdown streaming={running}>{text}</Markdown>
        </div>
      )}
    </div>
  );
}
