export type RunStatus = 'idle' | 'running' | 'waiting' | 'stopping' | 'interrupted';

/** The parent can finish its turn while the research still owns background work. */
export function isResearchWaiting(session: Pick<ResearchSession, 'workflow' | 'subSessions'>) {
  const state = session.workflow.control?.state;
  if (state === 'paused' || state === 'stopped' || state === 'completed') return false;
  return (
    state === 'waiting' ||
    session.subSessions.some((child) => child.status === 'running' || child.status === 'pending')
  );
}
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
/** Thinking levels supported by Pi SDK */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface Attachment {
  id: string;
  name: string;
  path: string;
  size: number;
}
export interface SourceLink {
  title: string;
  url: string;
}
export interface MessageQuote {
  messageId: string;
  text: string;
}
export const MAX_QUOTE_LENGTH = 12000;
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  timestamp: number;
  status?: StepStatus;
  name?: string;
  description?: string;
  args?: Record<string, unknown>;
  links?: SourceLink[];
  attachments?: Attachment[];
  quote?: MessageQuote;
  quotes?: MessageQuote[];
  piEntryId?: string;
  queued?: boolean;
  requestId?: string;
  /** Actual new tool calls remain in the transcript and project onto their original retry card. */
  retryOf?: string;
  retryAttempts?: number;
  retryProgress?: string;
  retryStatus?: StepStatus;
  retryError?: string;
  /** Model thinking/reasoning content, streamed separately from text. */
  thinking?: string;
  thinkingStatus?: StepStatus;
}
export interface WorkflowNode {
  statusLabel?: string;
  criteria?: string[];
  evidence?: string[];
  reason?: string;
  id: string;
  label: string;
  description: string;
  status: StepStatus;
  optional?: boolean;
  x: number;
  y: number;
}
export interface WorkflowEdge {
  source: string;
  target: string;
  optional?: boolean;
}
export interface Workflow {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  source: 'default' | 'checklist' | 'demo';
  control?: {
    state: 'running' | 'waiting' | 'paused' | 'stopped' | 'completed';
    wakeAt?: number;
    reason?: string;
  };
}
export interface Artifact {
  path: string;
  name: string;
  kind: 'file' | 'directory';
  updatedAt: number;
  size: number;
  children?: Artifact[];
  status?: 'completed' | 'updated';
}
export interface UserQuestion {
  id: string;
  kind: 'select' | 'confirm' | 'input';
  title: string;
  message?: string;
  options?: string[];
}
/** A delegated sub-session (research_delegate / subagent) shown nested in the conversation. */
export interface SubSession {
  id: string;
  toolCallId: string;
  kind: 'delegate' | 'subagent' | 'council';
  label: string;
  skill?: string;
  status: StepStatus;
  objective?: string;
  messages: ChatMessage[];
  startedAt: number;
  endedAt?: number;
  taskId?: string;
  asyncRunId?: string;
  asyncDir?: string;
  progress?: string;
  lastActivityAt?: number;
  currentTool?: string;
  currentToolArgs?: string;
  summary?: string;
  outcome?: string;
  artifacts?: string[];
  sessionFile?: string;
}
export interface ResearchSession {
  /** Drafts are excluded from history until the first user message is persisted. */
  phase?: 'draft' | 'started' | 'archived';
  draftAttachments?: Attachment[];
  workspaceDir?: string;
  workspacePath?: string;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  mode: 'pi' | 'demo';
  status: RunStatus;
  messages: ChatMessage[];
  workflow: Workflow;
  artifacts: Artifact[];
  question?: UserQuestion;
  notice?: string;
  error?: string;
  revision: number;
  /** Currently selected model (provider/id) */
  model: string;
  /** Current thinking level */
  thinkingLevel: ThinkingLevel;
  /** Delegated sub-sessions for nested display */
  subSessions: SubSession[];
}
export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  mode: 'pi' | 'demo';
  status: RunStatus;
}
export interface Health {
  ok: boolean;
  piVersion: string;
  piAvailable: boolean;
  configured: boolean;
  model: string;
  /** Available models from models.json */
  models?: ModelOption[];
}
/** A selectable model from models.json */
export interface ModelOption {
  id: string;
  provider: string;
  name: string;
  reasoning?: boolean;
}

/** Config key names matching package/config/*.json */
export type ConfigKey = 'research' | 'research-modules' | 'web-search' | 'models';

export interface ConfigResponse {
  configs: Record<ConfigKey, Record<string, unknown>>;
  overrides: Record<ConfigKey, boolean>;
}

export interface SingleConfigResponse {
  key: ConfigKey;
  value: Record<string, unknown>;
  overridden: boolean;
}

export interface PresentationSource {
  id: string;
  path: string;
  title: string;
}
export interface PresentationStage {
  status: 'queued' | 'rendering' | 'ready' | 'failed';
  sourceDigest?: string;
  dependencies?: string[];
  sessionFile?: string;
  digest?: string;
  updatedAt?: number;
  error?: string;
  sources: PresentationSource[];
}
export interface PresentationState {
  enabled: boolean;
  stages: Record<string, PresentationStage>;
  facts: Record<string, Record<string, string | number>>;
}

/** Semantic roles keep their colors when optional research stages are omitted. */
export function presentationRole(label: string) {
  const roles = [
    { role: 'task', color: '#3478d4', pattern: /任务|解析|task|scope/i },
    { role: 'literature', color: '#8963bc', pattern: /文献|检索|literature|papers/i },
    { role: 'hypothesis', color: '#bc8650', pattern: /假设|hypothes/i },
    { role: 'method', color: '#349486', pattern: /方法|设计|method/i },
    { role: 'experiment', color: '#c76579', pattern: /实验|试验|experiment/i },
    { role: 'report', color: '#6673be', pattern: /报告|论文|写作|report/i },
    { role: 'review', color: '#8c7898', pattern: /评审|审查|review/i },
  ] as const;
  return roles.find((item) => item.pattern.test(label)) || roles[0];
}
