import { Button } from './ui/Button';
import { FileIcon } from './FileIcon';
import { api } from '../api';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pause, Square, Plus, X, LoaderCircle, Quote, Shield, ShieldCheck } from 'lucide-react';
import type {
  Attachment,
  MessageQuote,
  RunStatus,
  ModelOption,
  ThinkingLevel,
} from '../../shared/types';
import { ModelSelector } from './ModelSelector';

export function Composer({
  sessionId,
  draft = false,
  initialFiles = [],
  status,
  connected,
  focusRequest = 0,
  suggestion,
  quote,
  quotes,
  onRemoveQuote,
  onRemoveQuotes,
  onRemoveQuoteAt,
  onSend,
  onStop,
  onUpload,
  reportError,
  models,
  currentModel,
  thinkingLevel,
  onModelChange,
  onThinkingLevelChange,
  onOpenSettings,
  onPreviewFile,
}: {
  sessionId: string;
  draft?: boolean;
  initialFiles?: Attachment[];
  status: RunStatus;
  connected: boolean;
  focusRequest?: number;
  suggestion?: { text: string; key: number };
  quote?: MessageQuote;
  quotes?: MessageQuote[];
  onRemoveQuote: () => void;
  onRemoveQuotes: () => void;
  onRemoveQuoteAt?: (index: number) => void;
  onSend: (
    text: string,
    files: Attachment[],
    quote?: MessageQuote,
    quotes?: MessageQuote[],
  ) => Promise<void>;
  onStop: () => Promise<void>;
  onUpload: (files: File[]) => Promise<Attachment[]>;
  reportError: (message: string) => void;
  models?: ModelOption[];
  currentModel?: string;
  thinkingLevel?: ThinkingLevel;
  onModelChange?: (model: string) => void;
  onThinkingLevelChange?: (level: ThinkingLevel) => void;
  onOpenSettings?: () => void;
  onPreviewFile?: (path: string, name: string) => void;
}) {
  // Keep the one draft locally while switching history or refreshing.
  const [savedDraft] = useState<{ text: string; files: Attachment[] }>(() => {
    if (draft) {
      try {
        const saved = JSON.parse(localStorage.getItem(`gewu-draft-${sessionId}`) || 'null');
        if (saved) return saved;
      } catch {}
    }
    return { text: '', files: initialFiles };
  });
  const [text, setText] = useState(savedDraft.text);
  const [files, setFiles] = useState<Attachment[]>(savedDraft.files);
  useEffect(() => {
    if (!draft) {
      try {
        localStorage.removeItem(`gewu-draft-${sessionId}`);
      } catch {}
      return;
    }
    try {
      localStorage.setItem(`gewu-draft-${sessionId}`, JSON.stringify({ text, files }));
    } catch {}
  }, [draft, sessionId, text, files]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [autoMode, setAutoMode] = useState(true);
  const [modeSaving, setModeSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .getConfig(sessionId, 'research-modules')
        .then((result) => {
          if (!cancelled) setAutoMode(result.value.interactionMode === 'auto');
        })
        .catch((error) => {
          if (!cancelled) reportError(error.message);
        });
    void load();
    window.addEventListener('research-config-changed', load);
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.removeEventListener('research-config-changed', load);
      window.removeEventListener('focus', load);
    };
  }, [sessionId, reportError]);
  async function toggleMode() {
    if (modeSaving) return;
    setModeSaving(true);
    try {
      const result = await api.getConfig(sessionId, 'research-modules');
      const saved = await api.patchConfig(sessionId, 'research-modules', {
        interactionMode: result.value.interactionMode === 'auto' ? 'review' : 'auto',
      });
      setAutoMode(saved.value.interactionMode === 'auto');
      window.dispatchEvent(new Event('research-config-changed'));
    } catch (error) {
      reportError((error as Error).message);
    } finally {
      setModeSaving(false);
    }
  }
  const fileInput = useRef<HTMLInputElement>(null);
  const editorRoot = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const appliedFocus = useRef(0);
  useLayoutEffect(() => {
    if (focusRequest <= appliedFocus.current || busy || uploading || !connected) return;
    appliedFocus.current = focusRequest;
    if (
      document.activeElement === document.body ||
      editorRoot.current?.contains(document.activeElement)
    )
      input.current?.focus();
  }, [focusRequest, busy, uploading, connected]);
  const composing = useRef(false);
  const submitting = useRef(false);
  const resizeInput = useCallback(() => {
    const field = input.current;
    if (!field) return;
    const scrollTop = field.scrollTop;
    field.style.height = '0px';
    if (field.value) field.style.height = `${field.scrollHeight}px`;
    field.scrollTop = scrollTop;
  }, []);
  useLayoutEffect(resizeInput, [text, resizeInput]);
  useEffect(() => {
    const field = input.current;
    if (!field) return;
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === field.clientWidth) return;
      width = field.clientWidth;
      resizeInput();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [resizeInput]);
  useEffect(() => {
    if (quote || quotes?.length) input.current?.focus();
  }, [quote, quotes]);
  const running = status === 'running' || status === 'waiting' || status === 'stopping';
  const hasInput = !!text.trim() || !!files.length;
  const stopMode = running && !hasInput;
  const hasAttachments = files.length > 0;
  const hasQuote = !!quote;
  const hasQuotes = (quotes?.length ?? 0) > 0;

  useEffect(() => {
    if (suggestion) {
      setText(suggestion.text);
    }
  }, [suggestion]);

  async function submit() {
    if (submitting.current || uploading || !connected || status === 'stopping') return;
    submitting.current = true;
    setBusy(true);
    try {
      if (stopMode) await onStop();
      else if (hasInput) {
        await onSend(text.trim(), files, quote, quotes);
        setText('');
        setFiles([]);
        onRemoveQuote();
        onRemoveQuotes();
      }
    } catch (error) {
      reportError((error as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function upload(selected: FileList | null) {
    if (!selected?.length) return;
    if (files.length + selected.length > 10) {
      reportError('每条消息最多添加 10 个附件');
      return;
    }
    setUploading(true);
    try {
      const added = await onUpload([...selected]);
      setFiles((old) => [...old, ...added]);
    } catch (error) {
      reportError((error as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function removeFile(file: Attachment) {
    setFiles((old) => old.filter((f) => f.id !== file.id));
    try {
      await api.deleteFile(sessionId, file.path);
    } catch {
      // 文件可能已随消息发送或不存在；仅从前端列表移除即可
    }
  }

  // Determine if textarea has multiple lines (for layout switch)
  const isMultiline = text.includes('\n') || text.length > 40;
  return (
    <div className="composer-area" ref={editorRoot}>
      <form
        className="composer-row"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {/* Floating attachments and quote above the input */}
        {(hasAttachments || hasQuote || hasQuotes) && (
          <div className="composer-floating">
            {hasQuotes &&
              quotes!.map((q, i) => (
                <div className="floating-quote" key={q.messageId + i}>
                  <Quote size={12} />
                  <span className="floating-quote-text">{q.text.slice(0, 50)}</span>
                  <button
                    type="button"
                    className="floating-remove"
                    aria-label="移除引用"
                    onClick={() => {
                      // Remove individual quote from array
                      if (onRemoveQuoteAt) onRemoveQuoteAt(i);
                      else onRemoveQuotes();
                    }}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            {hasQuote && !hasQuotes && (
              <div className="floating-quote">
                <Quote size={12} />
                <span className="floating-quote-text">{quote.text.slice(0, 50)}</span>
                <button
                  type="button"
                  className="floating-remove"
                  aria-label="移除引用"
                  onClick={onRemoveQuote}
                >
                  <X size={11} />
                </button>
              </div>
            )}
            {hasAttachments && (
              <div className="floating-files">
                {files.map((file) => {
                  return (
                    <span key={file.id} className="floating-file-chip">
                      <button
                        type="button"
                        className="floating-file-name"
                        title={`预览 ${file.name}`}
                        onClick={() => onPreviewFile?.(file.path, file.name)}
                      >
                        <FileIcon name={file.name} size={18} />
                        <span>{file.name}</span>
                      </button>
                      <button
                        type="button"
                        className="floating-remove"
                        aria-label={`移除附件 ${file.name}`}
                        onClick={() => removeFile(file)}
                      >
                        <X size={13} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Main composer container */}
        <div className={`composer-container${isMultiline ? ' multiline' : ''}`}>
          <div className="composer-editor-wrapper">
            <textarea
              ref={input}
              className="composer-input"
              value={text}
              rows={1}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                running ? '补充信息，或修正当前的研究方向' : '输入消息，或提出你的研究想法'
              }
              aria-label="研究消息"
              disabled={busy || uploading || !connected}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229)
                  return;
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (hasInput) void submit();
                }
              }}
            />
          </div>

          {/* Bottom row: attachment button + mode badge + send button */}
          <div className="composer-bottom-row">
            <button
              type="button"
              className="composer-attachment"
              aria-label="上传附件"
              title="添加文件，每个最多 32 MB"
              disabled={uploading || busy}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? <LoaderCircle size={18} className="spin" /> : <Plus size={20} />}
            </button>
            <input
              type="file"
              ref={fileInput}
              className="sr-only"
              multiple
              tabIndex={-1}
              aria-label="选择研究附件"
              onChange={(e) => void upload(e.target.files)}
            />
            {/* Mode toggle: shield for auto-run vs stage-review */}
            <button
              type="button"
              disabled={modeSaving || !connected}
              aria-pressed={autoMode}
              className={`mode-toggle${autoMode ? ' active' : ''}`}
              aria-label={autoMode ? '当前为自动运行模式' : '当前为阶段审批模式'}
              title={autoMode ? '自动运行' : '阶段审批'}
              onClick={() => void toggleMode()}
            >
              {modeSaving ? (
                <LoaderCircle size={18} className="spin" />
              ) : autoMode ? (
                <ShieldCheck size={18} />
              ) : (
                <Shield size={18} />
              )}
            </button>
            <div className="composer-spacer" />
            {/* Model selector - placed before send button */}
            {models && currentModel && thinkingLevel && onModelChange && onThinkingLevelChange && (
              <ModelSelector
                models={models}
                currentModel={currentModel}
                thinkingLevel={thinkingLevel}
                onModelChange={onModelChange}
                onThinkingLevelChange={onThinkingLevelChange}
                onOpenSettings={onOpenSettings}
                disabled={busy || uploading || !connected}
              />
            )}
            <Button
              type="submit"
              className="send-button"
              aria-label={
                stopMode
                  ? sessionId === 'demo'
                    ? '停止生成'
                    : '暂停研究'
                  : running
                    ? '发送纠偏消息'
                    : '发送消息'
              }
              title={
                stopMode
                  ? sessionId === 'demo'
                    ? '停止生成'
                    : '暂停研究'
                  : running
                    ? '发送纠偏消息'
                    : '发送消息'
              }
              disabled={
                busy || uploading || !connected || status === 'stopping' || (!hasInput && !stopMode)
              }
            >
              {busy || status === 'stopping' ? (
                <LoaderCircle size={17} className="spin" />
              ) : stopMode ? (
                sessionId === 'demo' ? (
                  <Square size={14} fill="currentColor" />
                ) : (
                  <Pause size={14} fill="currentColor" />
                )
              ) : (
                <svg width="20" height="22" viewBox="0 0 20 22" fill="none" aria-hidden="true">
                  <path
                    d="M10 20V4M10 4L4 10M10 4L16 10"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </Button>
          </div>
        </div>
      </form>
      {!connected && (
        <div className="composer-caption">
          <span className="connection-dot" data-connected={false} />
          正在恢复会话连接…
        </div>
      )}
    </div>
  );
}
