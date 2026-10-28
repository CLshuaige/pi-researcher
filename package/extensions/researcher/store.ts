import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ResearchConfig, TaskRecord } from "./types.ts";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const DEFAULT_CONFIG: ResearchConfig = {
  maxConcurrent: 2, timeoutMs: 900_000, maxTurns: 30,
  childExtensions: [], extraTools: [], reviewerTools: [], enableMcp: false,
};
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
};

/** Reject traversal and symlink escapes, including a not-yet-created leaf. */
export function workspacePath(root: string, path: string): string {
  const base = realpathSync(root);
  const target = resolve(base, path);
  const inside = (p: string) => p === base || p.startsWith(base + sep);
  if (!inside(target)) throw new Error(`Path leaves the research workspace: ${path}`);
  let existing = target;
  while (!existsSync(existing)) existing = dirname(existing);
  const canonical = resolve(realpathSync(existing), relative(existing, target));
  if (!inside(canonical)) throw new Error(`Symlink leaves the research workspace: ${path}`);
  return canonical;
}

export function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, content, { mode: 0o600 }); renameSync(temp, path); }
  finally { rmSync(temp, { force: true }); }
}

/** Atomic acquisition; a separate short recovery guard prevents two reclaimers
 * from removing a newly acquired live lock after observing the same dead owner. */
export function acquireOwnerLock(file: string): () => void {
  mkdirSync(dirname(file), { recursive: true });
  const token = randomUUID();
  const acquire = () => writeFileSync(file, JSON.stringify({ pid: process.pid, token }), { flag: "wx", mode: 0o600 });
  try { acquire(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const recovery = `${file}.recovery`;
    try { writeFileSync(recovery, "recovering", { flag: "wx" }); }
    catch { throw new Error(`Task is locked or its owner recovery is in progress: ${file}`); }
    try {
      if (existsSync(file)) {
        const previous = JSON.parse(readFileSync(file, "utf8"));
        if (!Number.isInteger(previous.pid) || alive(previous.pid)) throw new Error(`Task is locked by a live or unknown owner: ${file}`);
        rmSync(file);
      }
      acquire();
    } finally { rmSync(recovery, { force: true }); }
  }
  return () => {
    if (existsSync(file) && JSON.parse(readFileSync(file, "utf8")).token === token) rmSync(file);
  };
}

export function readConfig(root: string, agentDir = getAgentDir()): ResearchConfig {
  const path = workspacePath(root, ".pi/research.json");
  const readLayer = (file: string, base: string) => {
    if (!existsSync(file)) return {};
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (!raw || Array.isArray(raw) || typeof raw !== "object") throw new Error(`${file} must be an object`);
    for (const key of Object.keys(raw)) if (!Object.hasOwn(DEFAULT_CONFIG, key)) throw new Error(`Unknown research setting: ${key}`);
    if (Array.isArray(raw.childExtensions)) raw.childExtensions = raw.childExtensions.map((p: unknown) =>
      typeof p === "string" && p.trim() && !isAbsolute(p) ? workspacePath(base, p) : p);
    return raw;
  };
  // Project arrays replace global arrays, so [] explicitly disables inherited tools.
  const config = { ...DEFAULT_CONFIG, ...readLayer(join(agentDir, "research.json"), agentDir), ...readLayer(path, root) } as ResearchConfig;
  for (const [key, min, max] of [["maxConcurrent", 1, 8], ["timeoutMs", 1000, 86_400_000], ["maxTurns", 1, 1000]] as const) {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) throw new Error(`Invalid ${key}: expected ${min}..${max}`);
  }
  for (const key of ["childExtensions", "extraTools", "reviewerTools"] as const) {
    if (!Array.isArray(config[key]) || config[key].some((x) => typeof x !== "string" || !x.trim())) throw new Error(`Invalid ${key}`);
  }
  if (typeof config.enableMcp !== "boolean") throw new Error("enableMcp must be boolean");
  for (const name of [...config.extraTools, ...config.reviewerTools]) {
    if (!/^[a-zA-Z0-9_.:-]+$/.test(name) || /subagent|research_delegate|research_workspace|codemode|tool_search/i.test(name)) {
      throw new Error(`Use explicit non-delegating tool names: ${name}`);
    }
  }
  if (config.reviewerTools.some((x) => ["bash", "write", "edit"].includes(x))) throw new Error("reviewerTools must not include bash, write or edit");
  config.childExtensions = config.childExtensions.map((p) => {
    if (!isAbsolute(p)) p = workspacePath(root, p);
    if (!existsSync(p)) throw new Error(`Child extension not found: ${p}`);
    return realpathSync(p);
  });
  return config;
}

export class ResearchStore {
  readonly root: string;
  constructor(root: string) { this.root = realpathSync(root); }
  path(path: string) { return workspacePath(this.root, path); }
  initialized() { return existsSync(this.path("research/BRIEF.md")); }
  initialize(goal: string): void {
    if (!goal.trim()) throw new Error("Provide a research objective");
    const brief = this.path("research/BRIEF.md");
    mkdirSync(dirname(brief), { recursive: true });
    try {
      writeFileSync(brief, `# 研究目标\n\n${goal.trim()}\n\n## 约束与已有资源\n\n待根据已有材料补充。\n\n## 完成条件\n\n待根据任务明确；无需默认完成全部七类工作。\n`, { flag: "wx" });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const state = this.path("research/STATE.md");
    try { writeFileSync(state, "# 研究状态\n\n尚未开展。先检查已有资源，选择能解决关键未知问题的下一步。\n", { flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    mkdirSync(this.path(".research/tasks"), { recursive: true });
    mkdirSync(this.path(".research/sessions"), { recursive: true });
  }
  briefDigest() { return digest(readFileSync(this.path("research/BRIEF.md"), "utf8")); }
  taskPath(id: string) {
    if (!/^T-[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid research task ID");
    return this.path(`.research/tasks/${id}`);
  }
  read(id: string): TaskRecord {
    const record = JSON.parse(readFileSync(join(this.taskPath(id), "task.json"), "utf8")) as TaskRecord;
    if (record.version !== 1 || record.id !== id || !Number.isInteger(record.attempt)) throw new Error(`Invalid task record: ${id}`);
    return record;
  }
  save(record: TaskRecord): void {
    const dir = this.taskPath(record.id);
    const data = JSON.stringify(record, null, 2) + "\n";
    atomicWrite(join(dir, `attempt-${record.attempt}.json`), data);
    atomicWrite(join(dir, "task.json"), data);
  }
  list(): TaskRecord[] {
    const dir = this.path(".research/tasks");
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((id) => /^T-[a-f0-9-]{36}$/.test(id)).map((id) => {
      const record = this.read(id);
      // Observation only: never turn a timeout or a missing in-memory handle into success.
      if (record.status === "running" && !alive(record.ownerPid)) return { ...record, status: "interrupted" as const };
      return record;
    }).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  lock(id: string): () => void {
    return acquireOwnerLock(join(this.taskPath(id), "owner.lock"));
  }
  validateInputs(paths: string[]): string[] {
    return paths.map((path) => {
      const absolute = this.path(path);
      if (!statSync(absolute).isFile()) throw new Error(`Input is not a file: ${path}`);
      return relative(this.root, absolute);
    });
  }
}
