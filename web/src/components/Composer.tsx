import { Button } from './ui/Button';
import { FileIcon } from './FileIcon';
import { api } from '../api';
import { useEffect, useRef, useState } from 'react';
import { Pause, Square, Plus, X, LoaderCircle, Quote, Shield, ShieldCheck } from 'lucide-react';
import MDEditor from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
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
  status,
  connected,
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
}: {
  sessionId: string;
  status: RunStatus;
  connected: boolean;
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
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
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
      await api.putConfig(sessionId, 'research-modules', {
        ...result.value,
        interactionMode: result.value.interactionMode === 'auto' ? 'review' : 'auto',
      });
      setAutoMode(result.value.interactionMode !== 'auto');
    } catch (error) {
      reportError((error as Error).message);
    } finally {
      setModeSaving(false);
    }
  }
  const fileInput = useRef<HTMLInputElement>(null);
  const editorRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (quote || quotes?.length) editorRoot.current?.querySelector('textarea')?.focus();
  }, [quote, quotes]);
  const running = status === 'running' || status === 'stopping';
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
    if (busy || uploading || !connected || status === 'stopping') return;
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
                      <FileIcon name={file.name} size={18} />
                      <span>{file.name}</span>
                      <button
                        type="button"
                        className="floating-remove"
                        aria-label={`移除附件 ${file.name}`}
                        onClick={() => setFiles((old) => old.filter((f) => f.id !== file.id))}
                      >
                        <X size={11} />
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
          {/* Markdown editor */}
          <div className="composer-editor-wrapper">
            <MDEditor
              value={text}
              onChange={(val) => setText(val || '')}
              preview="edit"
              height="auto"
              visibleDragbar={false}
              textareaProps={{
                placeholder: running
                  ? '补充信息，或修正当前的研究方向'
                  : '输入消息，或提出你的研究想法',
                'aria-label': '研究消息',
                disabled: busy || uploading || !connected,
                onKeyDown: (e: React.KeyboardEvent) => {
                  // Enter to send, Shift+Enter for newline.
                  // MDEditor's own keydown listener handles list continuation.
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (hasInput) void submit();
                  }
                },
              }}
              hideToolbar
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
