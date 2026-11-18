import { useEffect, useId, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleDot,
  ClipboardList,
  LoaderCircle,
  Minus,
  Pause,
  ShieldQuestion,
} from 'lucide-react';
import type { ChatMessage, UserQuestion } from '../../shared/types';

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
  objectiveRevision?: number;
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
  blocked: { label: '受阻', icon: <Pause size={12} />, className: 'blocked' },
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
  return stripped || m.id;
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

export function getLatestChecklistState(
  messages: ChatMessage[],
): { text: string; prevText?: string } | undefined {
  const snapshots = messages.flatMap((message, index) => {
    if (
      message.role !== 'tool' ||
      message.name !== 'research_checklist' ||
      !isChecklistJson(message.text)
    )
      return [];
    const data = JSON.parse(message.text) as ChecklistData;
    return [
      {
        text: message.text,
        revision: Number.isInteger(data.revision) ? data.revision : undefined,
        index,
      },
    ];
  });
  if (!snapshots.length) return undefined;

  const byPriority = [...snapshots].sort((a, b) => {
    const revisionA = a.revision ?? Number.NEGATIVE_INFINITY;
    const revisionB = b.revision ?? Number.NEGATIVE_INFINITY;
    return revisionA - revisionB || a.index - b.index;
  });
  const latest = byPriority.at(-1)!;
  const previous = [...byPriority]
    .reverse()
    .find(
      (snapshot) =>
        snapshot.index !== latest.index &&
        (latest.revision === undefined
          ? snapshot.revision === undefined
          : snapshot.revision !== latest.revision),
    );
  return { text: latest.text, ...(previous ? { prevText: previous.text } : {}) };
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

export function ChecklistView({ text, prevText, controlState }: { text: string; prevText?: string; controlState?: string }) {
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
  const effectiveControlState = controlState ?? data.control?.state;
  const currentRunningId = currentId ?? modules.find((m) => m.status === 'running')?.id;
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
            {effectiveControlState === 'paused' && <span className="cl-badge paused">已暂停</span>}
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
              const isCurrentRunning = m.id === currentRunningId && m.status === 'running';
              const pausedOrStopped = isCurrentRunning && (effectiveControlState === 'paused' || effectiveControlState === 'stopped');
              const waiting = isCurrentRunning && effectiveControlState === 'waiting';
              const meta = pausedOrStopped
                ? { ...statusMeta(m.status), label: effectiveControlState === 'paused' ? '已暂停' : '已停止', icon: <Pause size={12} /> }
                : waiting
                  ? { ...statusMeta(m.status), label: '等待中', icon: <Circle size={11} /> }
                  : statusMeta(m.status);
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

/** Inline single-choice card shown inside the checklist dock while the agent waits for a decision. */
function QuestionCard({
  question,
  onAnswer,
}: {
  question: UserQuestion;
  onAnswer: (value: string) => Promise<void>;
}) {
  // The native ask_user fallback includes a custom-entry sentinel; the dock
  // already provides its own inline Other input.
  const options = (question.options ?? []).filter(
    (option) => option !== '✏️ Type custom response...',
  );
  const [selected, setSelected] = useState(options.length ? options[0] : '');
  const [other, setOther] = useState(!options.length);
  const [text, setText] = useState('');
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState('');
  const confirmation = question.kind === 'confirm';
  async function answer(value: string) {
    if (!value.trim() || answering) return;
    setAnswering(true);
    setError('');
    try {
      await onAnswer(value);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setAnswering(false);
    }
  }
  return (
    <form
      className="question-panel dock-question"
      aria-label="需要你的决定"
      onSubmit={(event) => {
        event.preventDefault();
        void answer(confirmation ? options[0] || '确认' : other ? text.trim() : selected);
      }}
    >
      <strong>{question.title}</strong>
      {question.message && <p>{question.message}</p>}
      {!confirmation && (
        <fieldset disabled={answering} className="dock-question-options">
          <legend className="sr-only">选择回答</legend>
          {options.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="research-answer"
                checked={!other && selected === option}
                onChange={() => {
                  setSelected(option);
                  setOther(false);
                }}
              />
              <span>{option}</span>
            </label>
          ))}
          <label>
            <input
              type="radio"
              name="research-answer"
              checked={other}
              onChange={() => setOther(true)}
            />
            <span>其他</span>
          </label>
          <input
            aria-label="自定义回答"
            placeholder="写下你的决定…"
            value={text}
            onFocus={() => setOther(true)}
            onChange={(event) => {
              setText(event.target.value);
              setOther(true);
            }}
          />
        </fieldset>
      )}
      {error && (
        <p className="dock-question-error" role="alert">
          {error}
        </p>
      )}
      <div className="dock-question-actions">
        {confirmation && (
          <button
            type="button"
            disabled={answering}
            onClick={() => void answer(options[1] || '取消')}
          >
            暂缓
          </button>
        )}
        <button
          type="submit"
          disabled={answering || (!confirmation && !(other ? text.trim() : selected))}
        >
          {answering ? '提交中…' : '下一步'}
        </button>
      </div>
    </form>
  );
}

export function ChecklistDock({
  sessionId,
  text,
  prevText,
  controlState,
  question,
  onAnswer,
}: {
  sessionId: string;
  text?: string;
  prevText?: string;
  controlState?: string;
  question?: UserQuestion;
  onAnswer?: (value: string) => Promise<void>;
}) {
  const storageKey = `gewu-checklist-dock-${sessionId}`;
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === 'collapsed';
    } catch {
      return false;
    }
  });
  // A pending question covers the checklist; it always starts expanded so the
  // options are visible, but the bar still collapses to a one-line prompt.
  const [questionCollapsed, setQuestionCollapsed] = useState(false);
  useEffect(() => setQuestionCollapsed(false), [question?.id]);
  const expanded = question ? !questionCollapsed : !collapsed;
  const panelId = useId();
  const data = useMemo(() => {
    if (!text) return null;
    try {
      return JSON.parse(text) as ChecklistData;
    } catch {
      return null;
    }
  }, [text]);
  if (!question && !data?.modules?.length) return null;

  if (question) {
    return (
      <section className="checklist-dock question-dock" aria-label="需要你的决定">
        <div id={panelId} className="checklist-dock-panel" hidden={!expanded}>
          {expanded && (
            <>
              <QuestionCard
                key={question.id}
                question={question}
                onAnswer={async (value) => {
                  await onAnswer?.(value);
                }}
              />
            </>
          )}
        </div>
        <button
          type="button"
          className="checklist-dock-toggle"
          aria-label={`${expanded ? '收起' : '展开'}待决问题`}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setQuestionCollapsed((value) => !value)}
        >
          <ShieldQuestion size={14} />
          <span className="checklist-dock-current" title={question.title}>
            {question.title}
          </span>
          <span className="checklist-dock-status">等待你的选择</span>
          {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </section>
    );
  }

  const state = controlState ?? data!.control?.state;
  const active = new Set(['running', 'awaiting_acceptance', 'blocked']);
  const modules = data!.modules ?? [];
  const current =
    state === 'completed'
      ? undefined
      : (data!.currentModule && active.has(data!.currentModule.status || '')
          ? data!.currentModule
          : undefined) || modules.find((module) => active.has(module.status || ''));
  const allTerminal = modules.every((module) =>
    ['completed', 'skipped'].includes(module.status || ''),
  );
  const allCompleted = modules.every((module) => module.status === 'completed');
  const finished = state === 'completed' || data!.nextAction === 'finish' || allCompleted;
  const title = current
    ? `${current.id}：${current.objective || current.id}`
    : finished
      ? '任务已完成'
      : allTerminal
        ? '任务已结束'
        : '等待任务开始';
  const icon =
    state === 'paused' || state === 'stopped' ? (
      <Pause size={12} />
    ) : state === 'waiting' ? (
      <Circle size={14} />
    ) : (
      statusMeta(current?.status ?? (finished ? 'completed' : allTerminal ? 'skipped' : 'pending'))
        .icon
    );
  const stateLabel =
    state === 'paused'
      ? '已暂停'
      : state === 'waiting'
        ? '等待中'
        : state === 'stopped'
          ? '已停止'
          : current?.status === 'awaiting_acceptance'
            ? '待验收'
            : current?.status === 'blocked'
              ? '受阻'
              : undefined;

  return (
    <section className="checklist-dock" aria-label="研究清单">
      <div id={panelId} className="checklist-dock-panel" hidden={!expanded}>
        {expanded && text && <ChecklistView text={text} prevText={prevText} controlState={state} />}
      </div>
      <button
        type="button"
        className="checklist-dock-toggle"
        aria-label={`${expanded ? '收起' : '展开'}研究清单`}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => {
          const next = !expanded;
          setCollapsed(!next);
          try {
            localStorage.setItem(storageKey, next ? 'expanded' : 'collapsed');
          } catch {}
        }}
      >
        {icon}
        <span className="checklist-dock-current" title={title}>
          {title}
        </span>
        {stateLabel && <span className="checklist-dock-status">{stateLabel}</span>}
        {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
    </section>
  );
}
