export type RunStatus = 'idle' | 'running' | 'stopping' | 'interrupted';
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
  control?: { state: 'running' | 'waiting' | 'paused' | 'stopped' | 'completed'; wakeAt?: number };
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
  progress?: string;
  summary?: string;
  outcome?: string;
  artifacts?: string[];
  sessionFile?: string;
}
export interface ResearchSession {
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
