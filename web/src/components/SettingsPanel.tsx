import { Button } from './ui/Button';
import { Tabs } from '@animate-ui/react/primitives/radix-ui/tabs';
import { Switch } from './ui/animated';
import { Checkbox } from './ui/fields';
import { SettingsDialog } from './SettingsDialog';
import { api } from '../api';
import { useCallback, useEffect, useState } from 'react';
import {
  LoaderCircle,
  BookOpen,
  Globe2,
  FileText,
  Lock,
  Eye,
  EyeOff,
  Lightbulb,
  FlaskConical,
} from 'lucide-react';

/** Default research-modules config matching package/config/research-modules.json */
const DEFAULT_RESEARCH_MODULES = {
  interactionMode: 'auto',
  hypothesis: { max_debate_iterations: 5 },
  method: { max_debate_iterations: 5 },
  literature: {
    sources: ['arxiv', 'openalex', 'semantic_scholar', 'crossref', 'pubmed', 'dblp'],
    writeReview: false,
  },
};

const PENDING_KEY = 'gewu-pending-research-modules';

interface LiteratureConfig {
  sources: string[];
  writeReview: boolean;
}

interface ResearchModulesConfig {
  interactionMode: string;
  hypothesis: { max_debate_iterations: number };
  method: { max_debate_iterations: number };
  literature: LiteratureConfig;
}

const SOURCE_OPTIONS = [
  { id: 'arxiv', label: 'arXiv' },
  { id: 'openalex', label: 'OpenAlex' },
  { id: 'semantic_scholar', label: 'Semantic Scholar' },
  { id: 'crossref', label: 'Crossref' },
  { id: 'pubmed', label: 'PubMed' },
  { id: 'dblp', label: 'DBLP' },
];

type SettingsTab = 'literature' | 'hypothesis' | 'method';

export function SettingsPanel({
  sessionId,
  onClose,
  reportError,
}: {
  sessionId?: string;
  onClose: () => void;
  reportError: (msg: string) => void;
}) {
  const [config, setConfig] = useState<ResearchModulesConfig>(DEFAULT_RESEARCH_MODULES);
  const [allowWebSearch, setAllowWebSearch] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [keyErrors, setKeyErrors] = useState<Record<string, boolean>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<SettingsTab>('literature');

  function applyConfig(value: Record<string, any>) {
    setConfig({
      ...DEFAULT_RESEARCH_MODULES,
      ...value,
      literature: { ...DEFAULT_RESEARCH_MODULES.literature, ...value.literature },
    });
    setAllowWebSearch(value.allowWebSearch ?? true);
    setApiKeys(value.apiKeys ?? {});
  }

  // Load config: workspace > pending > default
  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (sessionId) {
        const res = await fetch(`/api/sessions/${sessionId}/config/research-modules`);
        const data = await res.json();
        if (data.value && Object.keys(data.value).length) {
          applyConfig(data.value);
        }
      } else {
        // New session: check localStorage pending
        try {
          const raw = localStorage.getItem(PENDING_KEY);
          if (raw) {
            const pending = JSON.parse(raw);
            applyConfig(pending);
          }
        } catch {}
      }
    } catch {
      // Use defaults
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (updates: Partial<ResearchModulesConfig>) => {
    setConfig((old) => ({ ...old, ...updates }));
    setDirty(true);
  };

  const toggleSource = (source: string) => {
    const current = config.literature.sources;
    const updated = current.includes(source)
      ? current.filter((s) => s !== source)
      : [...current, source];
    update({ literature: { ...config.literature, sources: updated } });
  };

  const handleSave = async () => {
    // Validation: web search off + no enhanced sources = cannot search
    if (!allowWebSearch && config.literature.sources.length === 0) {
      reportError('无法搜索：请开启网页搜索或至少勾选一个增强学术源');
      return;
    }
    setKeyErrors({});
    setSaving(true);
    try {
      const payload = { ...config, allowWebSearch, apiKeys };
      if (sessionId) {
        await api.putConfig(sessionId, 'research-modules', payload);
      } else {
        localStorage.setItem(PENDING_KEY, JSON.stringify(payload));
      }
      window.dispatchEvent(new Event('research-config-changed'));
      setDirty(false);
      onClose();
    } catch (e) {
      reportError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    applyConfig(DEFAULT_RESEARCH_MODULES);
    setDirty(true);
    if (sessionId) {
      try {
        const result = await api.deleteConfig(sessionId, 'research-modules');
        applyConfig(result.value);
      } catch (error) {
        reportError((error as Error).message);
      }
    } else {
      localStorage.removeItem(PENDING_KEY);
    }
  };

  if (loading)
    return (
      <SettingsDialog title="参数配置" onClose={onClose}>
        <div className="settings-loading">
          <LoaderCircle size={20} className="spin" />
        </div>
      </SettingsDialog>
    );

  const tabs: { id: SettingsTab; label: string; icon: typeof BookOpen }[] = [
    { id: 'literature', label: '文献调研', icon: BookOpen },
    { id: 'hypothesis', label: '假设构建', icon: Lightbulb },
    { id: 'method', label: '方法设计', icon: FlaskConical },
  ];

  return (
    <SettingsDialog title="参数配置" onClose={onClose}>
      <Tabs.Root
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as SettingsTab)}
        orientation="vertical"
        asChild
      >
        <div className="settings-body">
          {/* Left nav */}
          <Tabs.List asChild>
            <nav className="settings-nav" aria-label="配置分类">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <Tabs.Trigger key={tab.id} value={tab.id} asChild>
                    <button
                      className={`settings-nav-item${activeTab === tab.id ? ' active' : ''}`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      <Icon size={16} />
                      <span>{tab.label}</span>
                    </button>
                  </Tabs.Trigger>
                );
              })}
            </nav>
          </Tabs.List>

          {/* Right content */}
          <Tabs.Content value={activeTab} asChild>
            <div className="settings-content">
              <div className="settings-form">
                {/* ── 文献调研 tab ─────────────────────────────────── */}
                {activeTab === 'literature' && (
                  <>
                    {/* Toggle: Write review */}
                    <div className="form-row">
                      <div className="form-label-group">
                        <FileText size={15} className="form-icon" />
                        <div>
                          <span className="form-label">生成文献综述</span>
                          <p className="form-hint">基于检索结果自动生成结构化文献综述</p>
                        </div>
                      </div>
                      <Switch
                        label="生成文献综述"
                        checked={config.literature.writeReview}
                        onCheckedChange={(checked) =>
                          update({ literature: { ...config.literature, writeReview: checked } })
                        }
                      />
                    </div>

                    {/* Toggle: Allow web search */}
                    <div className="form-row">
                      <div className="form-label-group">
                        <Globe2 size={15} className="form-icon" />
                        <div>
                          <span className="form-label">允许网页搜索</span>
                          <p className="form-hint">在学术数据库之外，补充搜索高质量的网页资源</p>
                        </div>
                      </div>
                      <Switch
                        label="允许网页搜索"
                        checked={allowWebSearch}
                        onCheckedChange={(checked) => {
                          setAllowWebSearch(checked);
                          setDirty(true);
                        }}
                      />
                    </div>

                    {/* Multi-select: Enhanced academic sources */}
                    <div className="form-row vertical">
                      <div className="form-label-group">
                        <BookOpen size={15} className="form-icon" />
                        <div>
                          <span className="form-label">增强学术源</span>
                          <p className="form-hint">
                            开启后调用专门的学术通道加强搜索；不勾选时通过通用搜索获取论文
                          </p>
                        </div>
                      </div>
                      <div className="source-grid">
                        {SOURCE_OPTIONS.map((src) => (
                          <label key={src.id} className="source-item">
                            <Checkbox
                              label={src.label}
                              checked={config.literature.sources.includes(src.id)}
                              onChange={() => toggleSource(src.id)}
                            />
                            <span>{src.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* API Keys: shown only when corresponding source is checked */}
                    {config.literature.sources.some((s) =>
                      ['openalex', 'semantic_scholar'].includes(s),
                    ) && (
                      <div className="form-row vertical">
                        <div className="form-label-group">
                          <Lock size={15} className="form-icon" />
                          <div>
                            <span className="form-label">API Key</span>
                            <p className="form-hint">
                              上面勾选的增强学术源中，部分需要私有 Key 才能访问。请在此填写对应的
                              Key； 若不填写，请关闭上面对应的增强学术源选项。
                            </p>
                          </div>
                        </div>
                        <div className="apikey-grid">
                          {config.literature.sources.includes('openalex') && (
                            <div className="apikey-field">
                              <label>OpenAlex API Key</label>
                              <div
                                className={`key-input-wrap${keyErrors.openalex ? ' error' : ''}`}
                              >
                                <input
                                  type={showKeys.openalex ? 'text' : 'password'}
                                  value={apiKeys.openalex || ''}
                                  onChange={(e) => {
                                    setApiKeys((old) => ({ ...old, openalex: e.target.value }));
                                    if (keyErrors.openalex)
                                      setKeyErrors((old) => ({ ...old, openalex: false }));
                                    setDirty(true);
                                  }}
                                  placeholder="请输入 Key"
                                />
                                <button
                                  className="key-toggle"
                                  onClick={() =>
                                    setShowKeys((old) => ({ ...old, openalex: !old.openalex }))
                                  }
                                  aria-label={showKeys.openalex ? '隐藏' : '显示'}
                                >
                                  {showKeys.openalex ? <EyeOff size={13} /> : <Eye size={13} />}
                                </button>
                              </div>
                            </div>
                          )}
                          {config.literature.sources.includes('semantic_scholar') && (
                            <div className="apikey-field">
                              <label>Semantic Scholar Key</label>
                              <div
                                className={`key-input-wrap${keyErrors.semantic_scholar ? ' error' : ''}`}
                              >
                                <input
                                  type={showKeys.semantic_scholar ? 'text' : 'password'}
                                  value={apiKeys.semantic_scholar || ''}
                                  onChange={(e) => {
                                    setApiKeys((old) => ({
                                      ...old,
                                      semantic_scholar: e.target.value,
                                    }));
                                    if (keyErrors.semantic_scholar)
                                      setKeyErrors((old) => ({ ...old, semantic_scholar: false }));
                                    setDirty(true);
                                  }}
                                  placeholder="请输入 Key"
                                />
                                <button
                                  className="key-toggle"
                                  onClick={() =>
                                    setShowKeys((old) => ({
                                      ...old,
                                      semantic_scholar: !old.semantic,
                                    }))
                                  }
                                  aria-label={showKeys.semantic_scholar ? '隐藏' : '显示'}
                                >
                                  {showKeys.semantic_scholar ? (
                                    <EyeOff size={13} />
                                  ) : (
                                    <Eye size={13} />
                                  )}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ── 假设构建 tab ─────────────────────────────────── */}
                {activeTab === 'hypothesis' && (
                  <>
                    <div className="form-row">
                      <label htmlFor="hypothesis-rounds">最多讨论轮数</label>
                      <input
                        id="hypothesis-rounds"
                        type="number"
                        min={1}
                        max={20}
                        value={config.hypothesis.max_debate_iterations}
                        onChange={(e) =>
                          update({
                            hypothesis: { max_debate_iterations: Number(e.target.value) },
                          })
                        }
                      />
                    </div>
                  </>
                )}

                {/* ── 方法设计 tab ─────────────────────────────────── */}
                {activeTab === 'method' && (
                  <>
                    <div className="form-row">
                      <label htmlFor="method-rounds">最多讨论轮数</label>
                      <input
                        id="method-rounds"
                        type="number"
                        min={1}
                        max={20}
                        value={config.method.max_debate_iterations}
                        onChange={(e) =>
                          update({
                            method: { max_debate_iterations: Number(e.target.value) },
                          })
                        }
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Footer actions */}
              <div className="settings-actions">
                <Button className="settings-btn secondary" onClick={onClose}>
                  取消
                </Button>
                <Button className="settings-btn secondary" onClick={handleReset} disabled={saving}>
                  恢复默认
                </Button>
                <Button
                  className="settings-btn primary"
                  onClick={() => void handleSave()}
                  disabled={!dirty || saving}
                >
                  {saving ? '保存中…' : '保存'}
                </Button>
              </div>
            </div>
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </SettingsDialog>
  );
}
