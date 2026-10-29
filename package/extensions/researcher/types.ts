export const SKILLS = [
  "research-task", "research-literature", "research-hypothesis", "research-method",
  "research-experiment", "research-report", "research-review",
] as const;
export type ResearchSkill = typeof SKILLS[number];
export type TaskStatus = "running" | "completed" | "partial" | "blocked" | "failed" | "cancelled" | "timed_out" | "interrupted";
export interface Handoff {
  status: "completed" | "partial" | "blocked";
  summary: string;
  artifacts: string[];
  evidence: string[];
  openQuestions: string[];
  nextActions: string[];
}
export interface TaskRequest {
  moduleId?: string;
  researchId?: string;
  objectiveRevision?: number;
  objective: string;
  skills: ResearchSkill[];
  inputs: string[];
  doneWhen: string[];
  resumeTaskId?: string;
}
export type { Usage } from "@earendil-works/pi-ai";
import type { Usage } from "@earendil-works/pi-ai";
export interface TaskRecord {
  moduleId?: string;
  researchId?: string;
  objectiveRevision?: number;
  version: 1;
  id: string;
  attempt: number;
  status: TaskStatus;
  objective: string;
  skills: ResearchSkill[];
  inputs: string[];
  doneWhen: string[];
  outputDir: string;
  sessionFile?: string;
  sessionId?: string;
  model: { provider: string; id: string };
  configDigest: string;
  briefDigest: string;
  startedAt: string;
  finishedAt?: string;
  ownerPid: number;
  ownerToken: string;
  result?: Handoff;
  error?: string;
  usage?: Usage;
  staleBrief?: boolean;
}
export interface ResearchConfig {
  maxConcurrent: number;
  timeoutMs: number;
  maxTurns: number;
  childExtensions: string[];
  extraTools: string[];
  reviewerTools: string[];
  enableMcp: boolean;
}

export type JobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted';
export interface JobRecord {
  version: 1; id: string; researchId: string; objectiveRevision: number; moduleId: string;
  command: string; cwd: string; envNames: string[]; fingerprint: string;
  status: JobStatus; logPath: string; startedAt: number; finishedAt?: number; timeoutSeconds: number;
  ownerPid: number; ownerToken: string; workerPid?: number; workerIdentity?: string;
  exitCode?: number | null; signal?: string | null; error?: string;
}
export interface JobRequest {
  moduleId: string; command: string; cwd?: string; env?: Record<string, string>; timeoutSeconds?: number;
}
export interface JobExit {
  status: Exclude<JobStatus, 'running' | 'interrupted'>; finishedAt: number;
  exitCode: number | null; signal: string | null; error?: string;
}
