import { Notification } from './components/ui/Notification';
import { readableError } from '../shared/errors';
import { applyTheme } from './lib/theme';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FileBox,
  GitBranch,
  MoreHorizontal,
  PanelLeftOpen,
  Pencil,
  Settings2,
  Check,
  X,
  LoaderCircle,
} from 'lucide-react';
import { api } from './api';
import { Sidebar } from './components/Sidebar';
import { Conversation } from './components/Conversation';
import { Workflow } from './components/Workflow';
import { Artifacts } from './components/Artifacts';
import { SettingsPanel } from './components/SettingsPanel';
import { PreviewPanel, type PreviewTab } from './components/PreviewPanel';
import { ResearchControls } from './components/ResearchControls';
import { GlobalSettingsPanel } from './components/GlobalSettingsPanel';
import { Logo } from './components/Logo';
import type { ResearchSession, SessionSummary, ModelOption } from '../shared/types';

export default function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<ResearchSession>();
  const [loggedOut, setLoggedOut] = useState(false);
  const [error, setError] = useState('');
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 860);
  const [showFlow, setShowFlow] = useState(false);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [globalSettingsTab, setGlobalSettingsTab] = useState<'profile' | 'general' | 'apikey'>(
    'profile',
  );
  const [profile, setProfile] = useState({ name: '研究者', avatar: '' });
  const [flowRatio, setFlowRatio] = useState(0.55);
  const [showSettings, setShowSettings] = useState(false);
  const [inspectorView, setInspectorView] = useState<'research' | 'preview'>('research');
  const [previewTabs, setPreviewTabs] = useState<PreviewTab[]>([]);
  const [activePreviewId, setActivePreviewId] = useState<string>();
  const [connected, setConnected] = useState(false);
  const [activeId, setActiveId] = useState<string>();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  useEffect(() => {
    api
      .userSettings()
      .then((settings) => {
        setProfile(settings.profile);
        applyTheme(settings.general.theme);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const change = () => {
      if (document.documentElement.dataset.themePreference === 'system') applyTheme('system');
    };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  const active = useRef(activeId);
  active.current = activeId;
  const version = useRef(-1);
  // Auto-collapse inspector when session is empty (blank page), expand when it has content
  const isEmptySession = session?.messages.length === 0;
  const hasPreviewTabs = previewTabs.length > 0 && inspectorView === 'preview';
  const hasArtifacts = (session?.artifacts?.length ?? 0) > 0;
  useEffect(() => {
    if (isEmptySession && !hasPreviewTabs && !hasArtifacts) {
      setShowFlow(false);
      setShowArtifacts(false);
    } else if (window.innerWidth > 700) {
      setShowFlow(true);
      setShowArtifacts(true);
    }
  }, [isEmptySession, hasPreviewTabs, hasArtifacts]);
  // Resizable panel widths
  const [sidebarW, setSidebarW] = useState(256);
  const [inspectorW, setInspectorW] = useState(() => (window.innerWidth > 1200 ? 440 : 330));
  const dragState = useRef<{
    panel: 'sidebar' | 'inspector' | 'flow';
    startX: number;
    startW: number;
  } | null>(null);
  const onDragStart = (panel: 'sidebar' | 'inspector' | 'flow') => (e: React.PointerEvent) => {
    dragState.current = {
      panel,
      startX: panel === 'flow' ? e.clientY : e.clientX,
      startW: panel === 'flow' ? flowRatio : panel === 'sidebar' ? sidebarW : inspectorW,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = dragState.current;
    if (!d) return;
    const delta = (d.panel === 'flow' ? e.clientY : e.clientX) - d.startX;
    if (d.panel === 'flow') {
      const height = document.querySelector('.inspector')?.getBoundingClientRect().height || 600;
      setFlowRatio(Math.min(0.8, Math.max(0.2, d.startW + delta / height)));
      return;
    }
    if (d.panel === 'sidebar') setSidebarW(Math.min(480, Math.max(200, d.startW + delta)));
    else setInspectorW(Math.min(window.innerWidth * 0.65, Math.max(300, d.startW - delta)));
  };
  const onDragEnd = () => {
    dragState.current = null;
  };
  const reportError = useCallback((text: string) => {
    setError(readableError(text));
    // Auto-dismiss after 4 seconds
    setTimeout(() => setError(''), 4000);
  }, []);
  const accept = useCallback((s: ResearchSession) => {
    if (s.id !== active.current || s.revision < version.current) return;
    version.current = s.revision;
    setSession(s);
    setSessions((old) => {
      const summary: SessionSummary = {
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        mode: s.mode,
        status: s.status,
      };
      return [summary, ...old.filter((x) => x.id !== s.id)].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      );
    });
  }, []);
  function select(id: string) {
    if (active.current === id) return;
    setPreviewTabs([]);
    setActivePreviewId(undefined);
    setShowSettings(false);
    setError('');
    setRenaming(false);
    version.current = -1;
    setActiveId(id);
    setConnected(false);
    if (window.innerWidth <= 860) setSidebar(false);
    try {
      localStorage.setItem('gewu-active-session', id);
    } catch {}
  }
  useEffect(() => {
    let cancelled = false;
    api
      .sessions()
      .then((list) => {
        if (cancelled) return;
        setSessions(list);
        let stored: string | null = null;
        try {
          stored = localStorage.getItem('gewu-active-session');
        } catch {}
        const id =
          stored && list.some((s) => s.id === stored)
            ? stored
            : list.find((s) => s.mode === 'pi')?.id || 'demo';
        select(id);
      })
      .catch((error) => !cancelled && reportError(error.message))
      .finally(() => !cancelled && setLoading(false));
    // Load available models
    api
      .health()
      .then((health) => {
        if (!cancelled && health.models) setModels(health.models);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [reportError]);
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    version.current = -1;
    setSession(undefined);
    api
      .session(activeId)
      .then((s) => {
        if (!cancelled) accept(s);
      })
      .catch((error) => {
        if (!cancelled) reportError(error.message);
      });
    const source = new EventSource(`/api/sessions/${activeId}/events`);
    source.addEventListener('snapshot', (event) => {
      if (!cancelled) {
        try {
          accept(JSON.parse((event as MessageEvent).data));
          setConnected(true);
        } catch {
          reportError('会话数据暂时不可用');
        }
      }
    });
    source.onopen = () => !cancelled && setConnected(true);
    source.onerror = () => !cancelled && setConnected(false);
    return () => {
      cancelled = true;
      source.close();
    };
  }, [activeId, accept, reportError]);
  function openPreviewFile(path: string, name: string) {
    if (!session) return;
    setInspectorView('preview');
    if (session.workspacePath && path.startsWith(session.workspacePath + '/'))
      path = path.slice(session.workspacePath.length + 1);
    if (session.workspaceDir) {
      const marker = `/workspace/${session.workspaceDir}/`;
      const index = path.indexOf(marker);
      if (index >= 0) path = path.slice(index + marker.length);
    }
    const id = `file-${path}`;
    // Check if tab already exists
    if (previewTabs.some((t) => t.id === id)) {
      setActivePreviewId(id);
      return;
    }
    // Images: open directly with URL, no content fetch needed
    if (/\.(png|jpe?g|gif|webp|pdf)$/i.test(name)) {
      const newTab: PreviewTab = {
        id,
        type: 'file',
        title: name,
        path,
        url: `/api/sessions/${session.id}/files/preview?path=${encodeURIComponent(path)}`,
      };
      setPreviewTabs((old) => [...old, newTab]);
      setActivePreviewId(id);
      return;
    }
    // Text files: fetch content then display
    const newTab: PreviewTab = { id, type: 'file', title: name, path, loading: true };
    setPreviewTabs((old) => [...old, newTab]);
    setActivePreviewId(id);
    api
      .preview(session.id, path)
      .then((data) => {
        setPreviewTabs((old) =>
          old.map((t) => (t.id === id ? { ...t, content: data.text, loading: false } : t)),
        );
      })
      .catch((e) => {
        setPreviewTabs((old) => old.filter((t) => t.id !== id));
        reportError((e as Error).message);
      });
  }
  async function newResearch() {
    if (creating) return;
    setCreating(true);
    setShowSettings(false);
    try {
      const s = await api.create();
      const pending = localStorage.getItem('gewu-pending-research-modules');
      if (pending) {
        await api.putConfig(s.id, 'research-modules', JSON.parse(pending));
        localStorage.removeItem('gewu-pending-research-modules');
      }
      setSessions((old) => [
        { id: s.id, title: s.title, updatedAt: s.updatedAt, mode: s.mode, status: s.status },
        ...old.filter((item) => item.id !== s.id),
      ]);
      setSession(undefined);
      select(s.id);
    } catch (error) {
      reportError((error as Error).message);
    } finally {
      setCreating(false);
    }
  }
  async function handleDelete(id: string) {
    try {
      await api.delete(id);
      setSessions((old) => old.filter((s) => s.id !== id));
      if (activeId === id) {
        const remaining = sessions.filter((s) => s.id !== id && s.mode === 'pi');
        if (remaining.length) select(remaining[0].id);
        else void newResearch();
      }
    } catch (error) {
      reportError((error as Error).message);
    }
  }
  async function act(action: () => Promise<ResearchSession>) {
    try {
      const s = await action();
      accept(s);
    } catch (error) {
      reportError((error as Error).message);
      throw error;
    }
  }
  if (loggedOut)
    return (
      <div className="logout-screen">
        <Logo />
        <p>已退出工作空间</p>
        <button className="settings-btn primary" onClick={() => window.location.reload()}>
          重新进入
        </button>
      </div>
    );
  return (
    <div
      className="app-shell"
      data-sidebar={sidebar ? 'open' : 'closed'}
      data-inspector={showFlow || showArtifacts || hasPreviewTabs ? 'open' : 'closed'}
      style={
        {
          gridTemplateColumns: `${sidebar ? sidebarW : 0}px minmax(0, 1fr) ${showFlow || showArtifacts || hasPreviewTabs ? inspectorW : 0}px`,
        } as React.CSSProperties
      }
    >
      {sidebar && (
        <button className="sidebar-scrim" aria-label="收起侧栏" onClick={() => setSidebar(false)} />
      )}
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={select}
        onNew={() => void newResearch()}
        creating={creating}
        onCollapse={() => setSidebar(false)}
        onRename={(id, title) => void act(() => api.rename(id, title))}
        onDelete={(id) => void handleDelete(id)}
        profile={profile}
        onOpenSettings={() => {
          setGlobalSettingsTab('profile');
          setShowGlobalSettings(true);
        }}
        onLogout={() => {
          localStorage.removeItem('gewu-active-session');
          setActiveId(undefined);
          setSession(undefined);
          setLoggedOut(true);
        }}
      />
      {sidebar && (
        <div
          className="panel-resizer"
          style={{ left: sidebarW - 4 }}
          onPointerDown={onDragStart('sidebar')}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          role="separator"
          aria-label="调整侧边栏宽度"
          aria-orientation="vertical"
        />
      )}
      <header className="topbar">
        <div className="topbar-title">
          {!sidebar && (
            <button
              className="icon-button sidebar-reopen"
              aria-label="展开会话边栏"
              title="展开会话边栏"
              onClick={() => setSidebar(true)}
            >
              <PanelLeftOpen size={20} />
            </button>
          )}
          {renaming ? (
            <form
              className="title-edit"
              onSubmit={async (e) => {
                e.preventDefault();
                if (session && title.trim()) {
                  try {
                    await act(() => api.rename(session.id, title.trim()));
                    setRenaming(false);
                  } catch {}
                }
              }}
            >
              <input
                aria-label="研究标题"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
              />
              <button className="icon-button" aria-label="保存标题">
                <Check size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="取消修改标题"
                onClick={() => setRenaming(false)}
              >
                <X size={15} />
              </button>
            </form>
          ) : (
            <>
              <h1>{session?.title || '格悟科研工作空间'}</h1>
              {session && session.messages.length > 0 && session.title !== '新研究' && (
                <button
                  className="icon-button title-pencil"
                  aria-label="修改研究标题"
                  onClick={() => {
                    setTitle(session.title);
                    setRenaming(true);
                  }}
                >
                  <Pencil size={14} />
                </button>
              )}
            </>
          )}
          {session?.mode === 'demo' && <span className="mode-badge">交互演示</span>}
        </div>
        <div className="topbar-actions">
          {session && (session.messages.length > 0 || hasArtifacts || hasPreviewTabs) && (
            <>
              <button
                className={`toolbar-button${showFlow ? ' active' : ''}`}
                aria-pressed={showFlow}
                onClick={() => {
                  setInspectorView('research');
                  setShowFlow(hasPreviewTabs ? true : !showFlow);
                }}
              >
                <GitBranch size={16} />
                <span>研究节点</span>
              </button>
              <button
                className={`toolbar-button${showArtifacts ? ' active' : ''}`}
                aria-pressed={showArtifacts}
                onClick={() => {
                  setInspectorView('research');
                  setShowArtifacts(hasPreviewTabs ? true : !showArtifacts);
                }}
              >
                <FileBox size={16} />
                <span>研究产物</span>
              </button>
              {session.mode === 'pi' && <ResearchControls session={session} />}
            </>
          )}
          <button
            className={`toolbar-button${showSettings ? ' active' : ''}`}
            aria-pressed={showSettings}
            disabled={creating}
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings2 size={16} />
            <span>参数配置</span>
          </button>
          <button className="icon-button more-button" aria-label="更多操作" title="更多操作">
            <MoreHorizontal size={20} />
          </button>
        </div>
      </header>
      {session && !creating ? (
        <Conversation
          key={session.id}
          session={session}
          connected={connected && !creating}
          onSend={(text, files, quote, quotes) =>
            act(() => api.send(session.id, text, files, quote, quotes))
          }
          onStop={() => act(() => api.stop(session.id))}
          onUpload={(files) => api.upload(session.id, files)}
          onEdit={(id, text) => act(() => api.edit(session.id, id, text))}
          onRetry={(id) => act(() => api.retry(session.id, id)).catch(() => {})}
          onAnswer={(id, value) => api.answer(session.id, id, value).then(() => {})}
          models={models}
          onModelChange={(model) => void act(() => api.setModel(session.id, model))}
          onThinkingLevelChange={(level) => void act(() => api.setThinkingLevel(session.id, level))}
          onOpenSettings={() => {
            setGlobalSettingsTab('apikey');
            setShowGlobalSettings(true);
          }}
          onPreviewFile={openPreviewFile}
          reportError={reportError}
        />
      ) : (
        <main className="conversation loading-screen">
          <Logo />
          {loading || activeId ? (
            <>
              <LoaderCircle size={18} className="spin" />
              <p>正在打开研究工作空间…</p>
            </>
          ) : (
            <>
              <p>暂时无法连接格悟服务</p>
              <button onClick={() => location.reload()}>重新连接</button>
            </>
          )}
        </main>
      )}
      <aside
        className="inspector"
        data-only-flow={showFlow && !showArtifacts && !hasPreviewTabs}
        data-only-artifacts={showArtifacts && !showFlow && !hasPreviewTabs}
        data-panel-layout={
          hasPreviewTabs ? 'preview' : showFlow && showArtifacts ? 'split' : 'single'
        }
        style={
          {
            '--flow-fraction': `${flowRatio}fr`,
            '--artifact-fraction': `${1 - flowRatio}fr`,
          } as React.CSSProperties
        }
        aria-label="研究信息"
      >
        {(showFlow || showArtifacts || hasPreviewTabs) && (
          <div
            className="panel-resizer right"
            onPointerDown={onDragStart('inspector')}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            role="separator"
            aria-label="调整信息面板宽度"
            aria-orientation="vertical"
          />
        )}
        {hasPreviewTabs ? (
          <PreviewPanel
            sessionId={session?.id}
            reportError={reportError}
            onSaved={(path, text) =>
              setPreviewTabs((old) =>
                old.map((tab) => (tab.path === path ? { ...tab, content: text } : tab)),
              )
            }
            tabs={previewTabs}
            activeTabId={activePreviewId}
            onTabChange={(id) => setActivePreviewId(id)}
            onClose={(id) => {
              const updated = previewTabs.filter((t) => t.id !== id);
              setPreviewTabs(updated);
              if (activePreviewId === id) {
                setActivePreviewId(updated[updated.length - 1]?.id);
              }
            }}
            onCloseAll={() => {
              setPreviewTabs([]);
              setActivePreviewId(undefined);
            }}
          />
        ) : (
          session && (
            <>
              {showFlow && (
                <Workflow
                  key={`workflow-${session.id}`}
                  running={session.status === 'running'}
                  artifacts={session.artifacts}
                  onPreviewFile={openPreviewFile}
                  workflow={session.workflow}
                  onClose={() => setShowFlow(false)}
                />
              )}
              {showFlow && showArtifacts && (
                <div
                  className="panel-resizer horizontal"
                  role="separator"
                  aria-label="调整研究节点与产物高度"
                  aria-orientation="horizontal"
                  onPointerDown={onDragStart('flow')}
                  onPointerMove={onDragMove}
                  onPointerUp={onDragEnd}
                />
              )}
              {showArtifacts && (
                <Artifacts
                  key={session.id}
                  sessionId={session.id}
                  workspaceDir={session.workspaceDir}
                  artifacts={session.artifacts}
                  onPreviewFile={openPreviewFile}
                  onClose={() => setShowArtifacts(false)}
                />
              )}
            </>
          )
        )}
      </aside>
      {showGlobalSettings && (
        <GlobalSettingsPanel
          initialTab={globalSettingsTab}
          onClose={() => setShowGlobalSettings(false)}
          reportError={reportError}
          onProfileChange={setProfile}
        />
      )}
      {showSettings && (
        <SettingsPanel
          key={session?.id || 'new'}
          sessionId={session?.id}
          onClose={() => setShowSettings(false)}
          reportError={reportError}
        />
      )}
      <Notification message={error} onClose={() => setError('')} />
    </div>
  );
}
