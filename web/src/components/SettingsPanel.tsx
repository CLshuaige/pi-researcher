import { Button } from './ui/Button';
import { Tabs } from '@animate-ui/react/primitives/radix-ui/tabs';
import { Slider } from '@animate-ui/react/primitives/radix-ui/slider';
import { Switch } from './ui/animated';
import { Checkbox, IntegerInput } from './ui/fields';
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
  Play,
  Cpu,
  SlidersHorizontal,
} from 'lucide-react';
import type { ModelOption, ThinkingLevel } from '../../shared/types';

/** Default research-modules config matching package/config/research-modules.json */
const DEFAULT_RESEARCH_MODULES = {
  interactionMode: 'auto',
  hypothesis: { max_debate_iterations: 5 },
  method: { max_debate_iterations: 5 },
  experiment: { max_optimization_iterations: 5 },
  literature: {
    sources: ['arxiv'],
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
  experiment: { max_optimization_iterations: number };
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

type SettingsTab = 'model' | 'general' | 'literature' | 'hypothesis' | 'method' | 'experiment';

const LEVELS: { id: ThinkingLevel; label: string }[] = [
  { id: 'off', label: '关闭' },
  { id: 'minimal', label: '极简' },
  { id: 'low', label: '低' },
  { id: 'medium', label: '中' },
  { id: 'high', label: '高' },
  { id: 'xhigh', label: '极高' },
  { id: 'max', label: '最大' },
];

export function SettingsPanel({
  sessionId,
  onClose,
  reportError,
  models = [],
  currentModel = '',
  thinkingLevel = 'medium',
  onModelChange,
  onThinkingLevelChange,
}: {
  sessionId?: string;
  onClose: () => void;
  reportError: (msg: string) => void;
  models?: ModelOption[];
  currentModel?: string;
  thinkingLevel?: ThinkingLevel;
  onModelChange?: (model: string) => Promise<void>;
  onThinkingLevelChange?: (level: ThinkingLevel) => Promise<void>;
}) {
  const [config, setConfig] = useState<ResearchModulesConfig>(DEFAULT_RESEARCH_MODULES);
  const [allowWebSearch, setAllowWebSearch] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selectedModel, setSelectedModel] = useState(currentModel);
  const [selectedThinkingLevel, setSelectedThinkingLevel] = useState(thinkingLevel);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [keyErrors, setKeyErrors] = useState<Record<string, boolean>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<SettingsTab>('model');
  const [presentationEnabled, setPresentationEnabled] = useState(true);

  function applyConfig(value: Record<string, any>) {
    setConfig({
      ...DEFAULT_RESEARCH_MODULES,
      ...value,
      literature: { ...DEFAULT_RESEARCH_MODULES.literature, ...value.literature },
      hypothesis: { ...DEFAULT_RESEARCH_MODULES.hypothesis, ...value.hypothesis },
      method: { ...DEFAULT_RESEARCH_MODULES.method, ...value.method },
      experiment: { ...DEFAULT_RESEARCH_MODULES.experiment, ...value.experiment },
    });
    setAllowWebSearch(value.allowWebSearch ?? true);
    setApiKeys(value.apiKeys ?? {});
    setPresentationEnabled(value.presentation?.enabled ?? true);
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
  useEffect(() => {
    const refreshMode = () => {
      if (!sessionId) return;
      void api
        .getConfig(sessionId, 'research-modules')
        .then(({ value }) => {
          setConfig((old) => ({
            ...old,
            interactionMode: String(value.interactionMode ?? 'auto'),
          }));
        })
        .catch((error) => reportError(error.message));
    };
    window.addEventListener('research-config-changed', refreshMode);
    return () => window.removeEventListener('research-config-changed', refreshMode);
  }, [sessionId, reportError]);

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
    const configDirty = dirty;
    const modelDirty = selectedModel !== currentModel;
    const thinkingDirty = selectedThinkingLevel !== thinkingLevel;
    if (!configDirty && !modelDirty && !thinkingDirty) return;
    // Validation: web search off + no enhanced sources = cannot search
    if (configDirty && !allowWebSearch && config.literature.sources.length === 0) {
      reportError('无法搜索：请开启网页搜索或至少勾选一个增强学术源');
      return;
    }
    const rounds = [
      config.hypothesis.max_debate_iterations,
      config.method.max_debate_iterations,
      config.experiment.max_optimization_iterations,
    ];
    if (
      configDirty &&
      rounds.some((value) => !Number.isInteger(value) || value < 1 || value > 20)
    ) {
      reportError('轮数必须是 1–20 的整数');
      return;
    }
    setKeyErrors({});
    setSaving(true);
    try {
      if (configDirty) {
        const { interactionMode, ...moduleConfig } = config;
        const payload = {
          ...moduleConfig,
          interactionMode,
          allowWebSearch,
          apiKeys,
          presentation: { enabled: presentationEnabled },
        };
        if (sessionId) {
          await api.patchConfig(sessionId, 'research-modules', payload);
        } else {
          localStorage.setItem(PENDING_KEY, JSON.stringify({ ...payload, interactionMode }));
        }
        window.dispatchEvent(new Event('research-config-changed'));
        setDirty(false);
      }
      if (modelDirty) await onModelChange?.(selectedModel);
      if (thinkingDirty) await onThinkingLevelChange?.(selectedThinkingLevel);
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
      <SettingsDialog title="参数配置" onClose={saving ? () => {} : onClose}>
        <div className="settings-loading">
          <LoaderCircle size={20} className="spin" />
        </div>
      </SettingsDialog>
    );

  const tabs: { id: SettingsTab; label: string; icon: typeof BookOpen }[] = [
    { id: 'model', label: '模型配置', icon: Cpu },
    { id: 'general', label: '通用配置', icon: SlidersHorizontal },
    { id: 'literature', label: '文献调研', icon: BookOpen },
    { id: 'hypothesis', label: '假设构建', icon: Lightbulb },
    { id: 'method', label: '方法设计', icon: FlaskConical },
    { id: 'experiment', label: '实验执行', icon: Play },
  ];

  return (
    <SettingsDialog title="参数配置" onClose={saving ? () => {} : onClose}>
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
                {/* ── 模型配置 tab ─────────────────────────────────── */}
                {activeTab === 'model' && (
                  <>
                    <div className="form-row vertical">
                      <div className="form-label-group">
                        <Cpu size={15} className="form-icon" />
                        <div>
                          <span className="form-label">模型选择</span>
                        </div>
                      </div>
                      <label className="model-provider-select">
                        模型供应商
                        <select
                          aria-label="模型供应商"
                          disabled={saving}
                          value={selectedModel.split('/')[0] || ''}
                          onChange={(event) => {
                            const model = models.find(
                              (model) => model.provider === event.target.value,
                            );
                            if (model) setSelectedModel(`${model.provider}/${model.id}`);
                          }}
                        >
                          {[...new Set(models.map((model) => model.provider))].map((provider) => (
                            <option key={provider} value={provider}>
                              {provider}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="model-select-list">
                        {models
                          .filter(
                            (model) =>
                              !selectedModel || model.provider === selectedModel.split('/')[0],
                          )
                          .map((m) => {
                            const id = `${m.provider}/${m.id}`;
                            return (
                              <button
                                key={id}
                                type="button"
                                className={`model-select-item${id === selectedModel ? ' active' : ''}`}
                                disabled={saving}
                                onClick={() => setSelectedModel(id)}
                              >
                                <span className="model-select-name">{m.name}</span>
                                <span className="model-select-provider">{m.provider}</span>
                                {m.reasoning && <span className="model-badge">推理</span>}
                              </button>
                            );
                          })}
                      </div>
                    </div>
                    <div className="form-row vertical">
                      <div className="form-label-group">
                        <SlidersHorizontal size={15} className="form-icon" />
                        <div>
                          <span className="form-label">思考强度</span>
                        </div>
                      </div>
                      <div className="thinking-level-control">
                        <div className="thinking-level-header">
                          <span>强度</span>
                          <span className="thinking-level-value">
                            {LEVELS.find((l) => l.id === selectedThinkingLevel)?.label ||
                              selectedThinkingLevel}
                          </span>
                        </div>
                        <Slider.Root
                          className="ui-slider"
                          disabled={saving}
                          min={0}
                          max={LEVELS.length - 1}
                          step={1}
                          value={[
                            Math.max(
                              0,
                              LEVELS.findIndex((level) => level.id === selectedThinkingLevel),
                            ),
                          ]}
                          onValueChange={(value) => {
                            const level = LEVELS[value[0]];
                            if (level) setSelectedThinkingLevel(level.id);
                          }}
                        >
                          <Slider.Track className="ui-slider-track">
                            <Slider.Range className="ui-slider-range" />
                          </Slider.Track>
                          <Slider.Thumb
                            className="ui-slider-thumb"
                            aria-label="思考强度"
                            aria-valuetext={
                              LEVELS.find((level) => level.id === selectedThinkingLevel)?.label
                            }
                          />
                        </Slider.Root>
                        <div className="thinking-level-labels">
                          {LEVELS.map((level) => (
                            <span
                              key={level.id}
                              className={`thinking-level-tick${level.id === selectedThinkingLevel ? ' active' : ''}`}
                            >
                              {level.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* ── 通用配置 tab ─────────────────────────────────── */}
                {activeTab === 'general' && (
                  <>
                    <div className="form-row">
                      <div className="form-label-group">
                        <Play size={15} className="form-icon" />
                        <div>
                          <span className="form-label">自动推进研究</span>
                          <p className="form-hint">
                            关闭后，重要问题由你选择，每个阶段验收后点击“下一步”继续
                          </p>
                        </div>
                      </div>
                      <Switch
                        label="自动推进研究"
                        checked={config.interactionMode === 'auto'}
                        onCheckedChange={(checked) =>
                          update({ interactionMode: checked ? 'auto' : 'review' })
                        }
                      />
                    </div>
                    <div className="form-row">
                      <div className="form-label-group">
                        <SlidersHorizontal size={15} className="form-icon" />
                        <div>
                          <span className="form-label">开启研究节点画板</span>
                          <p className="form-hint">
                            开启后，右侧面板将使用 Presentation
                            模块生成可视化展板；关闭则仅显示文本摘要
                          </p>
                        </div>
                      </div>
                      <Switch
                        label="开启研究节点画板"
                        checked={presentationEnabled}
                        onCheckedChange={(checked) => {
                          setPresentationEnabled(checked);
                          setDirty(true);
                        }}
                      />
                    </div>
                  </>
                )}

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
                      <IntegerInput
                        id="hypothesis-rounds"
                        min={1}
                        max={20}
                        value={config.hypothesis.max_debate_iterations}
                        onValueChange={(value) =>
                          update({ hypothesis: { max_debate_iterations: value } })
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
                      <IntegerInput
                        id="method-rounds"
                        min={1}
                        max={20}
                        value={config.method.max_debate_iterations}
                        onValueChange={(value) =>
                          update({ method: { max_debate_iterations: value } })
                        }
                      />
                    </div>
                  </>
                )}
                {activeTab === 'experiment' && (
                  <>
                    <div className="form-row">
                      <label htmlFor="experiment-rounds">最多优化轮数</label>
                      <IntegerInput
                        id="experiment-rounds"
                        min={1}
                        max={20}
                        step={1}
                        aria-describedby="experiment-rounds-help"
                        value={config.experiment.max_optimization_iterations}
                        onValueChange={(value) =>
                          update({ experiment: { max_optimization_iterations: value } })
                        }
                      />
                    </div>
                    <p id="experiment-rounds-help" className="form-hint">
                      默认 5 轮，范围
                      1–20。仅在任务需要迭代改进时使用。初次执行不计入轮数，中断续跑累计计数。
                    </p>
                  </>
                )}
              </div>

              {/* Footer actions */}
              <div className="settings-actions">
                <Button className="settings-btn secondary" onClick={onClose} disabled={saving}>
                  取消
                </Button>
                <Button className="settings-btn secondary" onClick={handleReset} disabled={saving}>
                  恢复默认
                </Button>
                <Button
                  className="settings-btn primary"
                  onClick={() => void handleSave()}
                  disabled={
                    (!dirty &&
                      selectedModel === currentModel &&
                      selectedThinkingLevel === thinkingLevel) ||
                    saving
                  }
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
