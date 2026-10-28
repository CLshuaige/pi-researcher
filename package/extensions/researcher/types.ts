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
  objective: string;
  skills: ResearchSkill[];
  inputs: string[];
  doneWhen: string[];
  resumeTaskId?: string;
}
export type { Usage } from "@earendil-works/pi-ai";
import type { Usage } from "@earendil-works/pi-ai";
export interface TaskRecord {
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
