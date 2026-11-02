import { Tabs } from '@animate-ui/react/primitives/radix-ui/tabs';
import { FileIcon } from './FileIcon';
import {
  X,
  Globe,
  LoaderCircle,
  ExternalLink,
  Pencil,
  Save,
  Download,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { Dialog } from '@animate-ui/react/primitives/radix-ui/dialog';
import { request, api } from '../api';
import { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { Markdown } from './Markdown';

export interface PreviewTab {
  id: string;
  type: 'file' | 'url';
  title: string;
  path?: string;
  url?: string;
  content?: string;
  loading?: boolean;
}
const EDITABLE =
  /\.(md|markdown|txt|json|jsonl|yaml|yml|toml|py|ts|tsx|js|jsx|sh|csv|css|html|xml|sql)$/i;
export function PreviewPanel({
  sessionId,
  reportError,
  onSaved,
  tabs,
  activeTabId,
  onTabChange,
  onClose,
  onCloseAll,
}: {
  sessionId?: string;
  reportError: (message: string) => void;
  onSaved?: (path: string, text: string) => void;
  tabs: PreviewTab[];
  activeTabId?: string;
  onTabChange: (id: string) => void;
  onClose: (id: string) => void;
  onCloseAll: () => void;
}) {
  const active = tabs.find((tab) => tab.id === activeTabId) || tabs[0];
  const [editing, setEditing] = useState(false),
    [saving, setSaving] = useState(false),
    [fullscreen, setFullscreen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    setEditing(false);
  }, [active?.id]);
  if (!active) return null;
  const draft = drafts[active.id] ?? active.content ?? '';
  const editable =
    active.type === 'file' &&
    active.path &&
    EDITABLE.test(active.title) &&
    active.content !== undefined;
  async function save() {
    setSaving(true);
    try {
      await request(
        `/sessions/${sessionId}/files/content?path=${encodeURIComponent(active.path!)}`,
        { method: 'PUT', body: JSON.stringify({ text: draft }) },
      );
      onSaved?.(active.path!, draft);
      setEditing(false);
    } catch (error) {
      reportError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const panel = (
    <Tabs.Root value={active.id} onValueChange={onTabChange} asChild>
      <section
        className={`preview-panel${fullscreen ? ' fullscreen' : ''}`}
        aria-label={`文件预览 ${active.title}`}
      >
        <div className="preview-header">
          <strong title={active.path || active.url}>{active.title}</strong>
          <div className="preview-header-actions">
            {active.path && sessionId && (
              <a
                className="icon-button"
                href={api.download(sessionId, active.path)}
                download
                aria-label="下载预览文件"
                title="下载"
              >
                <Download size={16} />
              </a>
            )}
            {editable &&
              (editing ? (
                <>
                  <button
                    className="icon-button"
                    aria-label="保存文件"
                    title="保存"
                    disabled={saving}
                    onClick={() => void save()}
                  >
                    {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
                  </button>
                  <button
                    className="icon-button"
                    aria-label="取消编辑"
                    title="取消编辑"
                    onClick={() => {
                      setDrafts((old) => {
                        const next = { ...old };
                        delete next[active.id];
                        return next;
                      });
                      setEditing(false);
                    }}
                  >
                    <X size={16} />
                  </button>
                </>
              ) : (
                <button
                  className="icon-button"
                  aria-label="编辑文件"
                  title="编辑"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={16} />
                </button>
              ))}
            <button
              className="icon-button"
              aria-label={fullscreen ? '退出文件全屏' : '全屏预览文件'}
              title={fullscreen ? '退出全屏' : '全屏'}
              onClick={() => setFullscreen(!fullscreen)}
            >
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              className="icon-button"
              aria-label="关闭全部预览"
              title="关闭预览"
              onClick={onCloseAll}
            >
              <X size={17} />
            </button>
          </div>
        </div>
        <div className="preview-tabbar">
          <Tabs.List asChild>
            <div className="preview-tabs" aria-label="预览文件">
              {tabs.map((tab) => (
                <Tabs.Trigger key={tab.id} value={tab.id} asChild>
                  <div
                    role="tab"
                    tabIndex={0}
                    aria-selected={tab.id === active.id}
                    className={`preview-tab${tab.id === active.id ? ' active' : ''}`}
                    onClick={() => onTabChange(tab.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') onTabChange(tab.id);
                    }}
                  >
                    {tab.type === 'file' ? (
                      <FileIcon name={tab.title} size={17} />
                    ) : (
                      <Globe size={13} />
                    )}
                    <span className="preview-tab-title">{tab.title}</span>
                    <button
                      className="preview-tab-close"
                      aria-label={`关闭 ${tab.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onClose(tab.id);
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </Tabs.Trigger>
              ))}
            </div>
          </Tabs.List>
        </div>
        <Tabs.Content value={active.id} asChild>
          <div className="preview-body">
            {active.loading ? (
              <div className="preview-loading">
                <LoaderCircle className="spin" size={20} />
              </div>
            ) : active.type === 'url' ? (
              <div className="preview-url">
                <a href={active.url} target="_blank" rel="noreferrer" title={active.url}>
                  <ExternalLink size={14} />
                  {active.title}
                </a>
                <iframe
                  src={active.url}
                  title={active.title}
                  className="preview-iframe"
                  sandbox="allow-scripts"
                />
              </div>
            ) : active.url && /\.pdf$/i.test(active.title) ? (
              <iframe src={active.url} title={active.title} className="preview-iframe" />
            ) : active.url && /\.(png|jpe?g|gif|webp)$/i.test(active.title) ? (
              <div className="preview-image">
                <img src={active.url} alt={active.title} />
              </div>
            ) : active.content !== undefined ? (
              editing ? (
                <CodeMirror
                  value={draft}
                  height="100%"
                  extensions={
                    /\.(md|markdown)$/i.test(active.title)
                      ? [markdown({ base: markdownLanguage, codeLanguages: languages })]
                      : []
                  }
                  onChange={(value) => setDrafts((old) => ({ ...old, [active.id]: value }))}
                  basicSetup={{ lineNumbers: true, foldGutter: true }}
                />
              ) : (
                <div className="preview-content-text">
                  {/\.(md|markdown)$/i.test(active.title) ? (
                    <Markdown>{active.content}</Markdown>
                  ) : (
                    <pre>{active.content}</pre>
                  )}
                </div>
              )
            ) : (
              <div className="preview-empty">选择文件以预览</div>
            )}
          </div>
        </Tabs.Content>
      </section>
    </Tabs.Root>
  );
  return fullscreen ? (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) setFullscreen(false);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="preview-fullscreen-overlay" />
        <Dialog.Content
          className="preview-fullscreen-content"
          aria-describedby={undefined}
          aria-label={`全屏预览 ${active.title}`}
        >
          <Dialog.Title className="sr-only">全屏预览 {active.title}</Dialog.Title>
          {panel}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  ) : (
    panel
  );
}
