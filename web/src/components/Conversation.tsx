import { readableError } from '../../shared/errors';
import { Fragment, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
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
  ChevronDown,
  ChevronRight,
  LoaderCircle,
} from 'lucide-react';
import { useStickToBottom } from 'use-stick-to-bottom';
import { SkillBox } from './SkillBox';
import heroBg from '../assets/hero-bg.png';
import { ToolStep } from './ToolStep';
import { Composer } from './Composer';
import { Markdown, preloadMarkdown } from './Markdown';
import { SelectionToolbar } from './SelectionToolbar';
import { SubSessionView } from './SubSessionView';
import { copyText } from '../lib/clipboard';
import type {
  Attachment,
  ChatMessage,
  MessageQuote,
  ResearchSession,
  ModelOption,
  ThinkingLevel,
} from '../../shared/types';

function isFinalAnswer(session: ResearchSession, message: ChatMessage) {
  if (!message.text) return false;
  const following = session.messages.slice(session.messages.indexOf(message) + 1);
  const nextUser = following.findIndex((item) => item.role === 'user');
  const turn = nextUser < 0 ? following : following.slice(0, nextUser);
  return turn.length === 0 && (nextUser >= 0 || !['running', 'stopping'].includes(session.status));
}

/** Collapsible thinking block: expanded while running, collapsed when done. */
function ThinkingBlock({ text, status }: { text: string; status: string }) {
  const running = status === 'running';
  const [expanded, setExpanded] = useState(running);
  useEffect(() => {
    if (running) setExpanded(true);
    else setExpanded(false);
  }, [running]);
  if (!text) return null;
  return (
    <div className="thinking-block" data-status={status}>
      <button
        className="thinking-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="thinking-icon">
          {running ? <LoaderCircle size={14} className="spin" /> : <Brain size={14} />}
        </span>
        <span className="thinking-title">{running ? '正在思考…' : '思考过程'}</span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <div className="thinking-content">
          <Markdown streaming={running}>{text}</Markdown>
        </div>
      )}
    </div>
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
  connected,
  onSend,
  onStop,
  onUpload,
  onEdit,
  onRetry,
  onAnswer,
  onPreviewFile,
  reportError,
  models,
  onModelChange,
  onThinkingLevelChange,
  onOpenSettings,
}: {
  session: ResearchSession;
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
  models?: ModelOption[];
  onModelChange?: (model: string) => void;
  onThinkingLevelChange?: (level: ThinkingLevel) => void;
  onOpenSettings?: () => void;
}) {
  const empty = s.messages.length === 0;
  useEffect(() => {
    void preloadMarkdown();
  }, []);
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({
    resize: 'smooth',
    initial: 'instant',
  });
  const composerArea = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(130);
  useEffect(() => {
    if (!composerArea.current) return;
    const observer = new ResizeObserver((entries) =>
      setComposerHeight(entries[0].contentRect.height),
    );
    observer.observe(composerArea.current);
    return () => observer.disconnect();
  }, [s.id, empty]);
  const [questionText, setQuestionText] = useState('');
  const [answering, setAnswering] = useState(false);
  const [suggestion, setSuggestion] = useState<{ text: string; key: number }>();
  const [quote, setQuote] = useState<MessageQuote>();
  const [quotes, setQuotes] = useState<MessageQuote[]>([]);
  const selectionScope = useRef<HTMLDivElement>(null);
  async function answer(value: string) {
    if (!s.question || !value.trim()) return;
    setAnswering(true);
    try {
      await onAnswer(s.question.id, value);
      setQuestionText('');
    } catch (error) {
      reportError((error as Error).message);
    } finally {
      setAnswering(false);
    }
  }
  const composer = (
    <div ref={composerArea} className="conversation-composer">
      <Composer
        sessionId={s.id}
        key={s.id}
        status={s.status}
        connected={connected}
        suggestion={suggestion}
        quote={quote}
        quotes={quotes}
        onRemoveQuote={() => setQuote(undefined)}
        onRemoveQuotes={() => setQuotes([])}
        onRemoveQuoteAt={(index) => setQuotes((old) => old.filter((_, i) => i !== index))}
        onSend={async (text, files, selectedQuote, selectedQuotes) => {
          await onSend(text, files, selectedQuote, selectedQuotes);
          setQuote(undefined);
          setQuotes([]);
          void scrollToBottom();
        }}
        onStop={onStop}
        onUpload={onUpload}
        reportError={reportError}
        models={models}
        currentModel={s.model}
        thinkingLevel={s.thinkingLevel}
        onModelChange={onModelChange}
        onThinkingLevelChange={onThinkingLevelChange}
        onOpenSettings={onOpenSettings}
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
          <div className="suggestions-marquee" aria-label="研究建议">
            <div className="marquee-row marquee-left">
              <div className="marquee-track">
                {[
                  { icon: Atom, text: '预测蛋白质-RNA 复合物的结合位点' },
                  { icon: Layers, text: '筛选高离子电导率的固态电解质' },
                  { icon: Waves, text: '用图神经网络加速分子动力学模拟' },
                  { icon: Network, text: '从单细胞转录组推断基因调控网络' },
                  { icon: Dna, text: '预测基因编辑的脱靶效应' },
                  { icon: FlaskConical, text: '设计新型催化剂的反应路径' },
                ]
                  .concat([
                    { icon: Atom, text: '预测蛋白质-RNA 复合物的结合位点' },
                    { icon: Layers, text: '筛选高离子电导率的固态电解质' },
                    { icon: Waves, text: '用图神经网络加速分子动力学模拟' },
                    { icon: Network, text: '从单细胞转录组推断基因调控网络' },
                    { icon: Dna, text: '预测基因编辑的脱靶效应' },
                    { icon: FlaskConical, text: '设计新型催化剂的反应路径' },
                  ])
                  .map(({ icon: Icon, text }, i) => (
                    <button
                      key={i}
                      className="marquee-chip"
                      onClick={() => setSuggestion({ text, key: Date.now() })}
                    >
                      <Icon size={15} />
                      {text}
                    </button>
                  ))}
              </div>
            </div>
            <div className="marquee-row marquee-right">
              <div className="marquee-track">
                {[
                  { icon: CloudRain, text: '预测极端降水事件的次季节演变' },
                  { icon: Target, text: '设计靶向 KRAS G12C 突变的共价抑制剂' },
                  { icon: Sigma, text: '用符号回归发现湍流模型的修正项' },
                  { icon: Star, text: '重建银河系恒星的化学演化历史' },
                  { icon: Telescope, text: '从巡天数据中识别新的引力透镜' },
                  { icon: Brain, text: '构建大脑连接组的全脑动力学模型' },
                ]
                  .concat([
                    { icon: CloudRain, text: '预测极端降水事件的次季节演变' },
                    { icon: Target, text: '设计靶向 KRAS G12C 突变的共价抑制剂' },
                    { icon: Sigma, text: '用符号回归发现湍流模型的修正项' },
                    { icon: Star, text: '重建银河系恒星的化学演化历史' },
                    { icon: Telescope, text: '从巡天数据中识别新的引力透镜' },
                    { icon: Brain, text: '构建大脑连接组的全脑动力学模型' },
                  ])
                  .map(({ icon: Icon, text }, i) => (
                    <button
                      key={i}
                      className="marquee-chip"
                      onClick={() => setSuggestion({ text, key: Date.now() })}
                    >
                      <Icon size={15} />
                      {text}
                    </button>
                  ))}
              </div>
            </div>
            <div className="marquee-row marquee-left">
              <div className="marquee-track">
                {[
                  { icon: Magnet, text: '优化托卡马克等离子体约束控制策略' },
                  { icon: Scissors, text: '预测 CRISPR 脱靶效应的全基因组分布' },
                  { icon: Microscope, text: '冷冻电镜密度图自动搭建原子模型' },
                  { icon: Sun, text: '评估钙钛矿太阳能电池的长期稳定性' },
                  { icon: AudioWaveform, text: '模拟海洋内波对声场传播的影响' },
                  { icon: Dna2Icon, text: '预测蛋白质折叠的折叠中间态' },
                ]
                  .concat([
                    { icon: Magnet, text: '优化托卡马克等离子体约束控制策略' },
                    { icon: Scissors, text: '预测 CRISPR 脱靶效应的全基因组分布' },
                    { icon: Microscope, text: '冷冻电镜密度图自动搭建原子模型' },
                    { icon: Sun, text: '评估钙钛矿太阳能电池的长期稳定性' },
                    { icon: AudioWaveform, text: '模拟海洋内波对声场传播的影响' },
                    { icon: Dna2Icon, text: '预测蛋白质折叠的折叠中间态' },
                  ])
                  .map(({ icon: Icon, text }, i) => (
                    <button
                      key={i}
                      className="marquee-chip"
                      onClick={() => setSuggestion({ text, key: Date.now() })}
                    >
                      <Icon size={15} />
                      {text}
                    </button>
                  ))}
              </div>
            </div>
          </div>
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
                {s.messages.map((m) =>
                  m.role === 'user' ? (
                    <UserMessage
                      key={m.id}
                      message={m}
                      onBeginEdit={onStop}
                      onEdit={(text) => onEdit(m.id, text)}
                      reportError={reportError}
                    />
                  ) : m.role === 'tool' ? (
                    <Fragment key={m.id}>
                      {!s.subSessions.some((sub) => sub.toolCallId === m.id) && (
                        <ToolStep
                          key={m.id}
                          message={m}
                          onRetry={() => onRetry(m.id)}
                          onPreviewFile={onPreviewFile}
                        />
                      )}
                      {/* Render sub-sessions for research_delegate / subagent tool calls */}
                      {(m.name === 'research_delegate' || m.name === 'subagent') &&
                        s.subSessions
                          .filter((sub) => sub.toolCallId === m.id)
                          .map((sub) => (
                            <SubSessionView
                              key={sub.id}
                              subSession={sub}
                              onPreviewFile={onPreviewFile}
                            />
                          ))}
                    </Fragment>
                  ) : m.text || m.thinking ? (
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
                      {m.thinking && (
                        <ThinkingBlock text={m.thinking} status={m.thinkingStatus || 'completed'} />
                      )}
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
                  ) : null,
                )}
                {s.status === 'running' && !s.question && (
                  <div className="agent-pending" role="status" aria-label="正在继续研究">
                    <span className="agent-breathing-dot" />
                  </div>
                )}
                {s.question && (
                  <section className="question-panel" aria-label="需要你的决定">
                    <strong>{s.question.title}</strong>
                    {s.question.message && <p>{s.question.message}</p>}
                    <div className="question-options">
                      {s.question.options?.map((option) => (
                        <button
                          disabled={answering}
                          key={option}
                          onClick={() => void answer(option)}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void answer(questionText);
                      }}
                    >
                      <input
                        aria-label="自定义回答"
                        placeholder="也可以写下你的决定…"
                        value={questionText}
                        onChange={(e) => setQuestionText(e.target.value)}
                      />
                      <button disabled={answering || !questionText.trim()}>提交</button>
                    </form>
                  </section>
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
