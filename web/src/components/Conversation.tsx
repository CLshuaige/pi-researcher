import { api } from '../api';
import { SettingsDialog } from './SettingsDialog';
import { readableError } from '../../shared/errors';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  BookOpen,
  Check,
  Copy,
  Pencil,
  Paperclip,
  Quote,
  Atom,
  Layers,
  Waves,
  Network,
  CloudRain,
  Target,
  Sigma,
  Star,
  Magnet,
  Scissors,
  Microscope,
  Sun,
  Dna,
  FlaskConical,
  Telescope,
  Brain,
  AudioWaveform,
  DnaIcon as Dna2Icon,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
} from 'lucide-react';
import { useStickToBottom } from 'use-stick-to-bottom';
import { SkillBox } from './SkillBox';
import heroBg from '../assets/hero-bg.png';
import { ToolStep, CommandGroup, groupAdjacentCommands } from './ToolStep';
import { Composer } from './Composer';
import { Markdown, preloadMarkdown } from './Markdown';
import { SelectionToolbar } from './SelectionToolbar';
import { SubSessionView } from './SubSessionView';
import { copyText } from '../lib/clipboard';
import { ThinkingBlock } from './ThinkingBlock';
import { ChecklistDock, getLatestChecklistState } from './ChecklistView';
import { isResearchRunning } from '../../shared/research';
import type {
  Attachment,
  ChatMessage,
  MessageQuote,
  ResearchSession,
  ResearchExamples,
} from '../../shared/types';

const EXAMPLE_ICONS: Record<string, typeof Atom> = {
  Atom,
  Layers,
  Waves,
  Network,
  CloudRain,
  Target,
  Sigma,
  Star,
  Magnet,
  Scissors,
  Microscope,
  Sun,
  Dna,
  FlaskConical,
  Telescope,
  Brain,
  AudioWaveform,
  Dna2Icon,
};

function isFinalAnswer(session: ResearchSession, message: ChatMessage) {
  if (!message.text) return false;
  const following = session.messages.slice(session.messages.indexOf(message) + 1);
  const nextUser = following.findIndex((item) => item.role === 'user');
  const turn = nextUser < 0 ? following : following.slice(0, nextUser);
  return (
    turn.length === 0 &&
    (nextUser >= 0 || (!isResearchRunning(session) && session.status !== 'stopping'))
  );
}

function UserMessage({
  message: m,
  onBeginEdit,
  onEdit,
  reportError,
}: {
  message: ChatMessage;
  onBeginEdit: () => Promise<void>;
  onEdit: (text: string) => Promise<void>;
  reportError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.text);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function beginEdit() {
    setBusy(true);
    try {
      await onBeginEdit();
      setText(m.text);
      setEditing(true);
    } catch (error) {
      reportError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await onEdit(text.trim());
      setEditing(false);
    } catch (error) {
      reportError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="user-message" aria-label="你的消息">
      <time className="user-time">
        {new Date(m.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
      </time>
      {/* Floating quote indicators above bubble */}
      {(m.quotes?.length ? m.quotes : m.quote ? [m.quote] : []).map((q, i) => (
        <div className="quote-indicator" aria-label="引用片段" title={q.text} key={q.messageId + i}>
          <Quote size={12} />
          <span>{q.text.slice(0, 100)}</span>
        </div>
      ))}
      <div className="user-bubble">
        {editing ? (
          <div className="user-edit">
            <textarea
              autoFocus
              aria-label="编辑消息"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
            />
            <div className="edit-actions">
              <button onClick={() => setEditing(false)} disabled={busy}>
                取消
              </button>
              <button
                className="edit-send"
                onClick={() => void submit()}
                disabled={busy || !text.trim()}
              >
                {busy ? '处理中…' : '重新发送'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="user-text">
              <Markdown>{m.text}</Markdown>
            </div>
            {m.attachments?.length ? (
              <div className="user-attachments">
                {m.attachments.map((f) => (
                  <span className="attachment-chip" key={f.id}>
                    <Paperclip size={12} />
                    {f.name}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
      {m.queued && <span className="pending-note">已排队，将在当前工具结束后结合此消息继续</span>}
      {m.status === 'failed' && <span className="pending-note">发送未成功，可编辑后重试</span>}
      {m.status === 'cancelled' && <span className="pending-note">已取消</span>}
      {!editing && (
        <div className="message-actions">
          <button
            aria-label="复制消息"
            onClick={async () => {
              try {
                await copyText(m.text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              } catch {
                reportError('无法访问剪贴板，请手动选择文字复制');
              }
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? '已复制' : '复制'}
          </button>
          <button aria-label="编辑消息" disabled={busy} onClick={() => void beginEdit()}>
            <Pencil size={13} /> 编辑
          </button>
        </div>
      )}
    </article>
  );
}
export function Conversation({
  session: s,
  messageJump,
  connected,
  onSend,
  onStop,
  onUpload,
  onEdit,
  onRetry,
  onAnswer,
  onPreviewFile,
  reportError,
}: {
  session: ResearchSession;
  messageJump?: { messageId: string; sequence: number };
  connected: boolean;
  onSend: (
    text: string,
    files: Attachment[],
    quote?: MessageQuote,
    quotes?: MessageQuote[],
  ) => Promise<void>;
  onStop: () => Promise<void>;
  onUpload: (files: File[]) => Promise<Attachment[]>;
  onEdit: (id: string, text: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  onAnswer: (id: string, value: string) => Promise<void>;
  onPreviewFile?: (path: string, name: string) => void;
  reportError: (message: string) => void;
}) {
  const empty = s.messages.length === 0;
  const composerStatus = s.status === 'idle' && isResearchRunning(s) ? 'waiting' : s.status;
  const checklistState = useMemo(() => getLatestChecklistState(s.messages), [s.messages]);
  useEffect(() => {
    void preloadMarkdown();
  }, []);
  const { scrollRef, contentRef, isAtBottom, scrollToBottom, stopScroll } = useStickToBottom({
    resize: 'smooth',
    initial: 'instant',
  });
  const composerArea = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(130);
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (!composerArea.current) return;
    const observer = new ResizeObserver((entries) =>
      setComposerHeight(entries[0].contentRect.height),
    );
    observer.observe(composerArea.current);
    return () => observer.disconnect();
  }, [s.id, empty]);
  const [suggestion, setSuggestion] = useState<{ text: string; key: number }>();
  const [examples, setExamples] = useState<ResearchExamples>();
  const [benchmarkOpen, setBenchmarkOpen] = useState(false);
  const [examplesLoading, setExamplesLoading] = useState(false);
  const [examplesError, setExamplesError] = useState('');
  const loadExamples = useCallback(async () => {
    setExamplesLoading(true);
    setExamplesError('');
    try {
      setExamples(await api.researchExamples());
    } catch (error) {
      setExamplesError((error as Error).message);
    } finally {
      setExamplesLoading(false);
    }
  }, []);
  useEffect(() => {
    if (empty) void loadExamples();
  }, [empty, s.id, loadExamples]);

  const [quote, setQuote] = useState<MessageQuote>();
  const [quotes, setQuotes] = useState<MessageQuote[]>([]);
  const selectionScope = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!messageJump) return;
    const container = scrollRef.current;
    const message = selectionScope.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageJump.messageId)}"]`,
    );
    if (!container || !message) return;
    stopScroll();
    container.scrollTo({
      top:
        container.scrollTop +
        message.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        16,
      behavior: 'instant',
    });
  }, [messageJump, scrollRef, stopScroll]);
  const retries = new Map<string, ChatMessage>();
  for (const message of s.messages) if (message.retryOf) retries.set(message.retryOf, message);
  const toolView = (message: ChatMessage): ChatMessage => {
    const latest = retries.get(message.id);
    return {
      ...message,
      ...(latest
        ? { text: latest.text, args: latest.args, links: latest.links }
        : message.retryStatus === 'running'
          ? { text: '', links: undefined }
          : {}),
      status: message.retryStatus || message.status,
    };
  };
  const composer = (
    <div ref={composerArea} className="conversation-composer">
      {(checklistState || s.question) && (
        <ChecklistDock
          key={s.id}
          sessionId={s.id}
          text={checklistState?.text}
          prevText={checklistState?.prevText}
          controlState={s.workflow.control?.state}
          question={s.question}
          onAnswer={async (value) => {
            if (!s.question) return;
            await onAnswer(s.question.id, value);
          }}
        />
      )}
      <Composer
        sessionId={s.id}
        draft={s.phase === 'draft'}
        initialFiles={s.draftAttachments}
        key={s.id}
        status={composerStatus}
        connected={connected}
        focusRequest={focusRequest}
        suggestion={suggestion}
        quote={quote}
        quotes={quotes}
        onRemoveQuote={() => setQuote(undefined)}
        onRemoveQuotes={() => setQuotes([])}
        onRemoveQuoteAt={(index) => setQuotes((old) => old.filter((_, i) => i !== index))}
        onSend={async (text, files, selectedQuote, selectedQuotes) => {
          const restoreFocus = composerArea.current?.contains(document.activeElement);
          try {
            await onSend(text, files, selectedQuote, selectedQuotes);
            setQuote(undefined);
            setQuotes([]);
            void scrollToBottom();
          } finally {
            // Survives the first-message layout change and waits for an enabled textarea.
            if (restoreFocus) setFocusRequest((value) => value + 1);
          }
        }}
        onStop={onStop}
        onUpload={onUpload}
        reportError={reportError}
        onPreviewFile={onPreviewFile}
      />
    </div>
  );
  return (
    <main className="conversation" data-empty={empty} aria-label="研究对话">
      {s.error && (
        <div className="error-banner" role="alert">
          {readableError(s.error)}
        </div>
      )}
      {s.notice && !empty && <div className="notice-banner">{readableError(s.notice)}</div>}
      {empty ? (
        <div className="empty-layout">
          <div className="empty-state">
            <h2 className="empty-title">
              一起<span className="title-accent">研究</span>些什么？
              <svg className="title-underline" viewBox="0 0 80 10" aria-hidden="true">
                <path
                  d="M2 6 Q 20 2, 40 5 T 78 3"
                  stroke="var(--cobalt)"
                  strokeWidth="2.5"
                  fill="none"
                  strokeLinecap="round"
                  opacity="0.55"
                />
              </svg>
            </h2>
          </div>
          {composer}
          <div className="benchmark-entry">
            <button
              type="button"
              className="marquee-chip"
              onClick={() => {
                setBenchmarkOpen(true);
                void loadExamples();
              }}
            >
              <BookOpen size={15} />
              {examples?.benchmark.title || 'ResearchClawBench'}
            </button>
          </div>
          <div className="suggestions-marquee" aria-label="研究建议">
            {examples?.suggestions.map((row, index) => (
              <div
                key={index}
                className={`marquee-row ${index % 2 ? 'marquee-right' : 'marquee-left'}`}
              >
                <div className="marquee-track">
                  {row.concat(row).map(({ icon, text }, i) => {
                    const Icon = EXAMPLE_ICONS[icon] || Atom;
                    return (
                      <button
                        type="button"
                        key={i}
                        className="marquee-chip"
                        onClick={() => setSuggestion({ text, key: Date.now() })}
                      >
                        <Icon size={15} />
                        {text}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {benchmarkOpen && (
            <SettingsDialog
              title={examples?.benchmark.title || 'ResearchClawBench'}
              size="wide"
              closeLabel="关闭示例问题"
              onClose={() => setBenchmarkOpen(false)}
              returnFocusTarget={composerArea.current?.querySelector('textarea')}
            >
              <div className="benchmark-list" aria-busy={examplesLoading}>
                {examplesLoading && <p role="status">正在加载</p>}
                {examplesError && (
                  <div role="alert">
                    {examplesError}
                    <button type="button" onClick={() => void loadExamples()}>
                      重新加载
                    </button>
                  </div>
                )}
                {!examplesLoading &&
                  !examplesError &&
                  examples?.benchmark.tasks.map((task) => {
                    const Icon = EXAMPLE_ICONS[task.icon] || Atom;
                    return (
                      <button
                        type="button"
                        className="benchmark-question"
                        key={task.id}
                        onClick={() => {
                          setSuggestion({
                            text: [task.question, task.materials].filter(Boolean).join('\n\n'),
                            key: Date.now(),
                          });
                          setBenchmarkOpen(false);
                        }}
                      >
                        <span className="benchmark-question-top">
                          <Icon className="benchmark-question-icon" size={72} strokeWidth={1.7} />
                        </span>
                        <strong className="benchmark-question-title">
                          {task.domain}
                          <br />
                          {task.id}
                        </strong>
                      </button>
                    );
                  })}
              </div>
            </SettingsDialog>
          )}
          <div className="empty-hero" aria-hidden="true">
            <img src={heroBg} alt="" />
          </div>
          <SkillBox />
        </div>
      ) : (
        <>
          <div className="message-scroll" ref={scrollRef}>
            <div className="message-content" ref={contentRef}>
              <div className="message-list" ref={selectionScope}>
                {groupAdjacentCommands(
                  s.messages.filter(
                    (m) =>
                      !m.retryOf &&
                      (m.role !== 'assistant' ||
                        m.text ||
                        m.thinking?.trim() ||
                        m.thinkingStatus === 'running'),
                  ),
                ).map((messages) => {
                  const m = messages[0];
                  if (m.name === 'research_job' && m.args?.action === 'wait') return null;
                  return messages.length > 1 ? (
                    <CommandGroup
                      key={m.id}
                      messages={messages}
                      renderMessage={(message) => (
                        <ToolStep
                          key={message.id}
                          workspacePath={s.workspacePath}
                          message={toolView(message)}
                          onRetry={() => onRetry(message.id)}
                          onPreviewFile={onPreviewFile}
                        />
                      )}
                    />
                  ) : m.role === 'user' ? (
                    <UserMessage
                      key={m.id}
                      message={m}
                      onBeginEdit={onStop}
                      onEdit={(text) => onEdit(m.id, text)}
                      reportError={reportError}
                    />
                  ) : m.role === 'tool' ? (
                    <div
                      key={m.id}
                      className="tool-message"
                      data-message-id={m.id}
                      data-stage-target={messageJump?.messageId === m.id || undefined}
                    >
                      {!s.subSessions.some(
                        (sub) => sub.toolCallId === (retries.get(m.id)?.id || m.id),
                      ) &&
                        !(m.name === 'research_job' && m.args?.action === 'wait') && (
                          <ToolStep
                            key={m.id}
                            workspacePath={s.workspacePath}
                            message={toolView(m)}
                            onRetry={() => onRetry(m.id)}
                            onPreviewFile={onPreviewFile}
                          />
                        )}
                      {/* Render sub-sessions for research_delegate / subagent tool calls */}
                      {(m.name === 'research_delegate' || m.name === 'subagent') &&
                        s.subSessions
                          .filter((sub) => sub.toolCallId === (retries.get(m.id)?.id || m.id))
                          .map((sub) => (
                            <SubSessionView
                              key={sub.id}
                              subSession={sub}
                              onPreviewFile={onPreviewFile}
                            />
                          ))}
                    </div>
                  ) : m.text || m.thinking?.trim() || m.thinkingStatus === 'running' ? (
                    <article
                      key={m.id}
                      className="assistant-message"
                      data-message-id={m.id}
                      aria-label="智能体回答"
                    >
                      <time className="assistant-time">
                        {new Date(m.timestamp).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                      <ThinkingBlock text={m.thinking} status={m.thinkingStatus} />
                      {m.text && (
                        <div className="assistant-body">
                          <Markdown streaming={m.status === 'running'}>{m.text}</Markdown>
                        </div>
                      )}
                      {/* Action bar: copy, like, dislike, retry */}
                      {isFinalAnswer(s, m) && (
                        <div className="assistant-actions">
                          <button
                            className="action-btn"
                            aria-label="复制回答"
                            title="复制"
                            onClick={async () => {
                              try {
                                await copyText(m.text);
                                reportError('已复制到剪贴板');
                              } catch {
                                reportError('复制失败');
                              }
                            }}
                          >
                            <Copy size={13} />
                          </button>
                          <button
                            className="action-btn"
                            aria-label="点赞"
                            title="有帮助"
                            onClick={() => {}}
                          >
                            <ThumbsUp size={13} />
                          </button>
                          <button
                            className="action-btn"
                            aria-label="点踩"
                            title="无帮助"
                            onClick={() => {}}
                          >
                            <ThumbsDown size={13} />
                          </button>
                          <button
                            className="action-btn"
                            aria-label="重试"
                            title="重新生成"
                            onClick={() => onRetry(m.id)}
                          >
                            <RotateCcw size={13} />
                          </button>
                        </div>
                      )}
                    </article>
                  ) : null;
                })}
                {isResearchRunning(s) && !s.question && (
                  <div
                    className="agent-pending"
                    role="status"
                    aria-label={composerStatus === 'waiting' ? '等待后台任务完成' : '正在继续研究'}
                  >
                    <span className="agent-breathing-dot" />
                    {composerStatus === 'waiting' && <span>后台任务进行中，完成后继续研究</span>}
                  </div>
                )}
                {s.status === 'idle' && s.workflow.control?.state === 'paused' && (
                  <div className="research-paused-note" role="status">
                    <strong>研究已暂停</strong>
                    <span>{s.workflow.control.reason || s.notice || '可补充要求后继续。'}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          {!isAtBottom && (
            <button
              className="scroll-bottom icon-button"
              style={{ bottom: composerHeight + 16 }}
              aria-label="回到底部"
              onClick={() => void scrollToBottom()}
            >
              <ArrowDown size={16} />
            </button>
          )}
          {composer}
          <SelectionToolbar
            scope={selectionScope}
            onQuote={(q) => setQuotes((old) => [...old, q])}
            reportError={reportError}
          />
        </>
      )}
    </main>
  );
}
