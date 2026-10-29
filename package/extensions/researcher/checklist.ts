import { existsSync, readFileSync, statSync } from 'node:fs';
import type { JobRecord } from './types.ts';
import { randomUUID } from 'node:crypto';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { atomicWrite, digest, ResearchStore } from './store.ts';

const Strings = Type.Array(Type.String({ minLength: 1 }));
export const ModuleSchema = Type.Object({
  id: Type.String({ pattern: '^[a-zA-Z0-9_-]+$' }), objective: Type.String({ minLength: 1 }),
  dependencies: Strings, skills: Type.Array(Type.Union([Type.Literal("research-task"), Type.Literal("research-literature"), Type.Literal("research-hypothesis"), Type.Literal("research-method"), Type.Literal("research-experiment"), Type.Literal("research-report"), Type.Literal("research-review")])),
  criteria: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  status: Type.Union([Type.Literal("pending"), Type.Literal("running"), Type.Literal("awaiting_acceptance"), Type.Literal("completed"), Type.Literal("blocked"), Type.Literal("skipped")]),
  evidence: Strings, acceptance: Strings, reason: Type.String(),
});
export type ResearchModule = Static<typeof ModuleSchema> & { taskIds: string[]; acceptedRevision?: number };
export interface Checklist {
  schemaVersion: 1; researchId: string; revision: number; objective: string; objectiveRevision: number;
  modules: ResearchModule[];
  control: { state: 'running' | 'waiting' | 'paused' | 'stopped' | 'completed'; reason: string; continuations: number; startedAt: number; wakeAt?: number; instructions: { id: string; text: string; resolution?: string }[] };
  audit: { sequence: number; time: string; source: string; reason: string }[];
}
/** Modules execute in array order; blocked work is not silently bypassed. */
export function currentModule(c: Checklist): ResearchModule | undefined {
  return c.modules.find(m => m.status !== 'skipped' && !(m.status === 'completed' && m.acceptedRevision === c.objectiveRevision));
}
/** Shared model/status view. Audit and resolved instructions stay in committed files. */
export function checklistState(c?: Checklist, inbox: string[] = [], jobs: JobRecord[] = []) {
  const selected = c ? currentModule(c) : undefined;
  const pendingInstructions = [...(c?.control.instructions.filter(i => !i.resolution) ?? []), ...inbox.map(text => ({ text }))];
  const nextAction = !c ? 'init' : pendingInstructions.length ? 'resolve pending instructions' : c.control.state === 'waiting' ? 'wait for user input, job completion or scheduled wake' : !c.modules.length ? 'plan'
    : selected?.status === 'pending' ? 'start' : selected?.status === 'blocked' ? 'resolve blocker or explicitly skip with reason'
    : selected?.status === 'awaiting_acceptance' ? 'verify evidence then accept' : selected ? 'execute current module' : 'finish';
  return { ...(jobs.length ? { jobs: jobs.map(({ id, moduleId, status, logPath, exitCode, error }) => ({ id, moduleId, status, logPath, exitCode, error })) } : {}), initialized: Boolean(c), revision: c?.revision ?? null, currentModule: selected ?? null, nextAction, pendingInstructions,
    ...(c ? { researchId: c.researchId, objective: c.objective, objectiveRevision: c.objectiveRevision, modules: c.modules,
      control: { state: c.control.state, reason: c.control.reason, continuations: c.control.continuations, startedAt: c.control.startedAt, ...(c.control.wakeAt !== undefined ? { wakeAt: c.control.wakeAt } : {}) } } : {}) };
}
export function requireCurrentModule(c: Checklist, id: string): ResearchModule {
  const m = currentModule(c);
  if (!m || m.id !== id) throw new Error(`Module order violation: current module is ${m?.id ?? 'none'}, requested ${id}`);
  if (m.dependencies.some(id => !c.modules.some(d => d.id === id && (d.status === 'skipped' || (d.status === 'completed' && d.acceptedRevision === c.objectiveRevision))))) throw new Error('Current module dependencies are unfinished');
  return m;
}
export class ChecklistStore {
  readonly files: ResearchStore;
  constructor(root: string) { this.files = new ResearchStore(root); }
  path(name: string) { return this.files.path(name); }
  readInbox(): string[] {
    const path = this.path('.research/inbox.json');
    const pending = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
    if (!Array.isArray(pending) || pending.some(text => typeof text !== 'string')) throw new Error('Invalid research inbox');
    return pending;
  }
  read(): Checklist | undefined {
    const file = this.path('checklist.json');
    if (!existsSync(file)) {
      if (existsSync(this.path('.research/checklist/latest.json'))) throw new Error('Checklist deleted; use repair to restore last committed snapshot');
      return undefined;
    }
    const raw = readFileSync(file, 'utf8');
    const snapshot = this.path('.research/checklist/latest.json');
    if (!existsSync(snapshot) || raw !== readFileSync(snapshot, 'utf8')) throw new Error('Checklist modified outside protocol; use repair, then revise through research_checklist');
    const c = JSON.parse(raw) as Checklist;
    this.validate(c);
    return c;
  }
  validate(c: Checklist) {
    if (c.schemaVersion !== 1 || !Number.isInteger(c.revision) || !c.objective.trim() || !Array.isArray(c.modules)) throw new Error('Invalid checklist');
    const ids = new Set(c.modules.map(m => m.id));
    if (ids.size !== c.modules.length) throw new Error('Duplicate module ID');
    for (const m of c.modules) {
      if (!Value.Check(ModuleSchema, m)) throw new Error("Invalid module");
      if (m.dependencies.some(d => !ids.has(d))) throw new Error('Unknown dependency');
    }
    const visit = (id: string, stack: Set<string>) => {
      if (stack.has(id)) throw new Error('Dependency cycle');
      const next = new Set(stack).add(id);
      for (const dep of c.modules.find(m => m.id === id)!.dependencies) visit(dep, next);
    };
    for (const id of ids) visit(id, new Set());
    for (const [i, m] of c.modules.entries()) if (m.dependencies.some(id => c.modules.findIndex(d => d.id === id) >= i)) throw new Error('Dependencies must precede the module in execution order');
  }
  commit(c: Checklist, source: string, reason: string) {
    this.validate(c);
    c.revision++;
    c.audit.push({ sequence: c.revision, time: new Date().toISOString(), source, reason });
    const raw = JSON.stringify(c, null, 2) + '\n';
    atomicWrite(this.path(`.research/checklist/revision-${c.revision}.json`), raw);
    // latest is the recovery commit point; interrupted materialization is repaired explicitly.
    atomicWrite(this.path('.research/checklist/latest.json'), raw);
    atomicWrite(this.path('checklist.json'), raw);
    return c;
  }
  repair() {
    const snapshot = this.path('.research/checklist/latest.json');
    if (!existsSync(snapshot)) throw new Error('No committed snapshot; preserve/remove the untracked checklist manually before initialization');
    const file = this.path('checklist.json');
    if (existsSync(file)) atomicWrite(this.path(`.research/checklist/rejected-${randomUUID()}.json`), readFileSync(file, 'utf8'));
    const c = JSON.parse(readFileSync(snapshot, 'utf8')) as Checklist;
    return this.commit(c, 'runtime', 'Restored committed snapshot; external content preserved');
  }
  initialize(objective: string) {
    if (this.read()) throw new Error('Checklist already exists');
    return this.commit({ schemaVersion: 1, researchId: randomUUID(), revision: 0, objective, objectiveRevision: 1, modules: [],
      control: { state: 'running', reason: '', continuations: 0, startedAt: Date.now(), instructions: [] }, audit: [] }, 'runtime', 'Initialize research');
  }
  change(reason: string, update: (c: Checklist) => void, expected?: number, source = 'runtime') {
    const c = this.read();
    if (!c) throw new Error('Initialize checklist first');
    if (expected !== undefined && c.revision !== expected) throw new Error(`Revision conflict: expected ${expected}, actual ${c.revision}`);
    update(c);
    return this.commit(c, source, reason);
  }
  evidenceExists(e: string) { return /^https?:\/\//.test(e) || statSync(this.path(e)).isFile(); }
  complete(c: Checklist) {
    return c.modules.length > 0 && !c.control.instructions.some(i => !i.resolution) &&
      !this.files.activeWork().length && c.modules.every(m => {
        if (m.status === 'skipped') return Boolean(m.reason.trim());
        try { return m.status === 'completed' && m.acceptedRevision === c.objectiveRevision && m.acceptance.length === m.criteria.length && m.evidence.length > 0 && m.evidence.every(e => this.evidenceExists(e)); }
        catch { return false; }
      });
  }
  fingerprint(c: Checklist) {
    return digest(JSON.stringify([c.objectiveRevision, c.modules.map(m => [m.id, m.status, m.evidence, m.taskIds]), this.files.list().map(t => [t.id, t.attempt, t.status]), this.files.jobs().map(j => [j.id, j.status])]));
  }
}
