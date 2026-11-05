import { useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Check, Circle, CircleDot, ClipboardList, LoaderCircle, Minus, Pause } from 'lucide-react';

interface ChecklistModule {
  id: string;
  objective?: string;
  status?: string;
  reason?: string;
  evidence?: string[];
  acceptance?: string[];
  criteria?: string[];
}

interface ChecklistData {
  initialized?: boolean;
  revision?: number;
  currentModule?: ChecklistModule | null;
  nextAction?: string;
  objective?: string;
  modules?: ChecklistModule[];
  control?: { state?: string };
}

const STATUS_META: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  completed: { label: '已完成', icon: <Check size={11} />, className: 'done' },
  running: {
    label: '进行中',
    icon: <LoaderCircle size={11} className="spin" />,
    className: 'running',
  },
  awaiting_acceptance: { label: '待验收', icon: <CircleDot size={11} />, className: 'review' },
  pending: { label: '等待中', icon: <Circle size={11} />, className: 'pending' },
  blocked: { label: '受阻', icon: <Pause size={11} />, className: 'blocked' },
  skipped: { label: '已跳过', icon: <Minus size={11} />, className: 'skipped' },
};

const NEXT_ACTION_LABELS: Record<string, string> = {
  start: '开始下一模块',
  'resolve pending instructions': '等待处理待办指令',
  finish: '全部完成',
};

function statusMeta(status?: string) {
  return STATUS_META[status || ''] || STATUS_META.pending;
}

function moduleLabel(m: ChecklistModule): string {
  const text = m.objective || '';
  const stripped = text.replace(/^[^：:]{2,12}[：:]\s*/, '');
  return stripped.length > 52 ? stripped.slice(0, 52) + '…' : stripped || m.id;
}

export function isChecklistJson(text: string): boolean {
  if (!text || !text.startsWith('{')) return false;
  try {
    const data = JSON.parse(text) as ChecklistData;
    return data.initialized === true && Array.isArray(data.modules);
  } catch {
    return false;
  }
}

function moduleSignature(m: ChecklistModule): string {
  return JSON.stringify({ s: m.status, r: m.reason, e: m.evidence, a: m.acceptance });
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const reduceMotion = useReducedMotion();
  const r = 17;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? done / total : 0;
  return (
    <div className="cl-ring" role="img" aria-label={`进度 ${done}/${total}`}>
      <svg viewBox="0 0 44 44" width="44" height="44">
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--line)" strokeWidth="3.5" />
        <motion.circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="var(--cobalt)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: reduceMotion ? c * (1 - pct) : c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: reduceMotion ? 0 : 0.9, ease: 'easeOut' }}
          transform="rotate(-90 22 22)"
        />
      </svg>
      <span className="cl-ring-text">
        {done}/{total}
      </span>
    </div>
  );
}

export function ChecklistView({ text, prevText }: { text: string; prevText?: string }) {
  const reduceMotion = useReducedMotion();

  const data = useMemo(() => {
    try {
      return JSON.parse(text) as ChecklistData;
    } catch {
      return null;
    }
  }, [text]);

  const prevModules = useMemo(() => {
    if (!prevText) return new Map<string, string>();
    try {
      const prev = JSON.parse(prevText) as ChecklistData;
      return new Map((prev.modules || []).map((m) => [m.id, moduleSignature(m)]));
    } catch {
      return new Map<string, string>();
    }
  }, [prevText]);

  if (!data) return <pre className="checklist-raw">{text}</pre>;

  const modules = data.modules || [];
  const done = modules.filter((m) => m.status === 'completed').length;
  const total = modules.length;
  const currentId = data.currentModule?.id;
  const controlState = data.control?.state;
  const allDone = total > 0 && done === total;
  const nextLabel =
    NEXT_ACTION_LABELS[data.nextAction || ''] ||
    (data.nextAction ? `下一步：${data.nextAction}` : '');

  const itemVariants = {
    hidden: { opacity: 0, y: reduceMotion ? 0 : 10 },
    show: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: reduceMotion ? 0 : 0.07 * i,
        duration: reduceMotion ? 0 : 0.35,
        ease: 'easeOut' as const,
      },
    }),
  };

  return (
    <motion.div
      className="cl-journal"
      initial={{ opacity: 0, y: reduceMotion ? 0 : 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.45, ease: 'easeOut' }}
    >
      <ClipboardList className="cl-watermark" size={100} strokeWidth={1} aria-hidden="true" />
      <div className="cl-journal-inner">
        <header className="cl-header">
          <div className="cl-heading">
            <span className="cl-heading-title">研究清单</span>
            {controlState === 'paused' && <span className="cl-badge paused">已暂停</span>}
            {nextLabel && <span className="cl-next">{nextLabel}</span>}
          </div>
          <div className="cl-progress">
            <span className="cl-progress-caption">已完成</span>
            <ProgressRing done={done} total={total} />
          </div>
        </header>

        {data.objective && (
          <motion.p
            className="cl-objective"
            variants={itemVariants}
            custom={0}
            initial="hidden"
            animate="show"
          >
            {data.objective}
          </motion.p>
        )}

        {modules.length > 0 && (
          <div className="cl-timeline">
            {modules.map((m, i) => {
              const meta = statusMeta(m.status);
              const isCurrent = m.id === currentId;
              const isNew = prevText ? !prevModules.has(m.id) : false;
              const isChanged = prevText ? prevModules.get(m.id) !== moduleSignature(m) : false;
              const highlight = isNew || isChanged;
              const isLast = i === modules.length - 1;
              return (
                <motion.div
                  key={m.id}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={[
                    'cl-tl-item',
                    meta.className,
                    isCurrent ? 'current' : '',
                    highlight ? 'highlight' : '',
                    isLast ? 'last' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  variants={itemVariants}
                  custom={i + 1}
                  initial="hidden"
                  animate="show"
                >
                  <div className="cl-tl-rail">
                    <span className={`cl-tl-dot ${meta.className}`}>{meta.icon}</span>
                    {!isLast && <span className="cl-tl-line" />}
                  </div>
                  <div className="cl-tl-body">
                    <div className="cl-tl-top">
                      <span className="cl-tl-id">{m.id}</span>
                      <span className="cl-tl-label" title={m.objective}>
                        {moduleLabel(m)}
                      </span>
                      <span className="cl-tl-status">{meta.label}</span>
                    </div>
                    {(isCurrent || highlight) && m.reason && (
                      <p className="cl-tl-reason">{m.reason}</p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {allDone && (
          <motion.div
            className="cl-done-stamp"
            initial={{ opacity: 0, scale: reduceMotion ? 1 : 1.5, rotate: reduceMotion ? 0 : -12 }}
            animate={{ opacity: 1, scale: 1, rotate: -6 }}
            transition={{
              delay: reduceMotion ? 0 : 0.4,
              duration: reduceMotion ? 0 : undefined,
              type: 'spring',
              stiffness: 260,
              damping: 16,
            }}
          >
            全部完成
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
