import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { ChecklistStore, ModuleSchema, currentModule, requireCurrentModule, type ResearchModule } from './checklist.ts';

// Planning needs definitions, not execution bookkeeping. Defaults are supplied by the runtime.
const Definition = Type.Object({
  id: ModuleSchema.properties.id, objective: ModuleSchema.properties.objective,
  skills: ModuleSchema.properties.skills, criteria: ModuleSchema.properties.criteria,
  dependencies: Type.Optional(ModuleSchema.properties.dependencies),
  status: Type.Optional(Type.Union(ModuleSchema.properties.status.anyOf, { description: 'update only. Do not copy current status into accept: accept always completes after validation and ignores redundant status.' })),
  evidence: Type.Optional(ModuleSchema.properties.evidence),
  acceptance: Type.Optional(ModuleSchema.properties.acceptance), reason: Type.Optional(Type.String()),
});
const ChecklistActionParameters = Type.Object({
  title: Type.Optional(Type.String({ maxLength: 12, description: 'Optional display-only action title, at most 12 characters. Use a short Chinese action phrase without execution status; the UI derives status from the actual result and falls back to the action name when omitted. Never replaces reason or acceptance.' })),
  action: Type.Union([Type.Literal("help"), Type.Literal("read"), Type.Literal("init"), Type.Literal("repair"), Type.Literal("plan"), Type.Literal("start"), Type.Literal("update"), Type.Literal("accept"), Type.Literal("resolve")]),
  expectedRevision: Type.Optional(Type.Integer({ minimum: 1, description: 'Use the revision from the latest tool result or checkpoint. On conflict read again; never guess.' })),
  reason: Type.Optional(Type.String({ minLength: 1, description: 'Why this mutation is necessary; required except help/read/init/repair.' })),
  objective: Type.Optional(Type.String({ minLength: 1 })),
  modules: Type.Optional(Type.Array(Definition, { minItems: 1, description: 'plan only: ordered complete list of module definitions. Preserve existing IDs.' })),
  moduleId: Type.Optional(Type.String({ description: 'start/update/accept: must be currentModule.id.' })),
  status: Type.Optional(Type.Union(ModuleSchema.properties.status.anyOf, { description: 'update only. Do not copy current status into accept: accept always completes after validation and ignores redundant status.' })),
  evidence: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: 'REQUIRED for accept: actual verified workspace file paths or source URLs. Submit explicitly together with acceptance; reason is not evidence.' })),
  acceptance: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: 'REQUIRED for accept: exactly one verified explanation per criterion, in criteria order. Always submit explicitly with evidence; reason is an audit note, not acceptance.' })),
  instructionId: Type.Optional(Type.String({ minLength: 1, description: 'REQUIRED for resolve: copy an exact ID from the latest pendingInstructions. Never guess or omit it; reason records its resolution.' })),
}, { additionalProperties: false });
// Keep the flat catalog (and all existing action fields) for provider compatibility.
// Model-issued acceptance must carry its verified evidence explicitly. Legacy
// programmatic calls still reuse saved values through ChecklistActionParameters.
export const ChecklistParameters = Type.Object(ChecklistActionParameters.properties, {
  additionalProperties: false,
  anyOf: [
    { properties: { action: { enum: ['help', 'read', 'init', 'repair', 'plan', 'start', 'update', 'resolve'] } } },
    { properties: { action: { const: 'accept' }, evidence: { minItems: 1 }, acceptance: { minItems: 1 } },
      required: ['action', 'moduleId', 'expectedRevision', 'reason', 'evidence', 'acceptance'] },
  ],
});
export type ChecklistArguments = Static<typeof ChecklistActionParameters>;
export const checklistGuide = `research_checklist protocol. Skills are instruction files, not callable tools. Never edit checklist.json.
For each call, provide title when possible: a Chinese action phrase of at most 12 characters, e.g. "规划研究阶段" or "核验训练产物". title is optional display metadata; omit completion/failure claims. The program determines execution status and uses a fixed action label when title is absent. reason remains the mutation rationale/audit note or instruction resolution, never a title or acceptance explanation.
Use ONE mutation per tool result, not a batch. In examples replace expectedRevision:1 with the revision in the latest result/checkpoint. On conflict read again; never guess or use repair for conflicts.
- Help: {"action":"help"}; inspect state: {"action":"read"}.
- Initialize once: {"action":"init","objective":"Research goal"}.
- Plan ordered definitions: {"action":"plan","expectedRevision":1,"reason":"Initial plan","modules":[{"id":"M1","objective":"Inspect evidence","skills":["research-literature"],"criteria":["Cite original sources"],"dependencies":[]}]}.
  Required per module: id, objective, skills, criteria. dependencies defaults to []. Runtime fills pending status and empty evidence/acceptance. Preserve existing IDs. Unchanged definitions preserve progress; changed definitions reopen this and following modules. Do not change status through plan.
- Start: {"action":"start","expectedRevision":1,"reason":"Begin current module","moduleId":"M1"}.
  Only currentModule (first unfinished module in array order) may execute, delegate or be accepted. Its complete SKILL.md instructions are injected into requests; follow them. Blocked modules must be resolved or explicitly skipped, never bypassed.
- Update fields: {"action":"update","expectedRevision":1,"reason":"Collected evidence","moduleId":"M1","status":"awaiting_acceptance","evidence":["research/result.md"]}.
  Omitted fields are preserved. blocked/skipped require a concrete reason. Do not send completed here. Change objective/skills/criteria/dependencies using plan, not update/accept.
- Accept: {"action":"accept","expectedRevision":1,"reason":"Verified source","moduleId":"M1","evidence":["research/result.md"],"acceptance":["Original source supports criterion 1"]}.
  Automatically sets completed; omit status (redundant status is ignored). For accept this tool REQUIRES moduleId, expectedRevision, reason, evidence and acceptance together. Always explicitly submit both arrays, even when previously saved. reason does not replace acceptance. Start first. Requires one nonempty explanation per criterion, existing evidence, no active module tasks. Acceptance cannot change criteria. Then start the next module.
- Resolve user input: {"action":"resolve","expectedRevision":1,"reason":"Explained how this request was handled","instructionId":"I-..."}.
  instructionId is required: copy the exact id from pendingInstructions in the latest result/checkpoint; I-... is a placeholder, not an ID. Resolve one instruction per call. status does not resolve an instruction. Optional objective changes the global goal and reopens modules. objective is accepted only in init/resolve.
- Recover externally edited/deleted JSON: {"action":"repair"}; restores the committed snapshot and preserves rejected content.
Use moduleId plus top-level fields; the old module parameter is rejected. Paths are workspace-relative or absolute within the root; evidence may be an http(s) URL. Errors return recovery.nextAction/currentRevision/currentModuleId. Correct arguments and retry; do not blindly repeat.`;

export function applyChecklistAction(store: ChecklistStore, p: ChecklistArguments) {
  // Also validate direct/programmatic callers; SDK validates provider calls before execute.
  if (!Value.Check(ChecklistActionParameters, p)) throw new Error('Invalid arguments. Use action: help for the exact JSON protocol.');
  if (p.action === 'read') return store.read();
  if (p.action === 'repair') return store.repair();
  if (p.action === 'init') return store.initialize(p.objective ?? '');
  if (p.expectedRevision === undefined || !p.reason?.trim()) throw new Error('Mutation requires expectedRevision and nonempty reason. Read first.');
  if (p.objective !== undefined && p.action !== 'resolve') throw new Error('Change objective through resolve with instructionId.');
  return store.change(p.reason, c => {
    if (p.action === 'resolve') {
      if (!p.instructionId?.trim()) throw new Error('resolve requires instructionId. Copy an exact ID from pendingInstructions; status cannot replace instructionId.');
      const instruction = c.control.instructions.find(i => i.id === p.instructionId);
      if (!instruction) throw new Error('Unknown instructionId. Read pendingInstructions.');
      if (p.objective && p.objective !== c.objective) {
        if (store.files.activeWork().length) throw new Error('Cancel or finish active tasks/jobs before changing the goal.');
        c.objective = p.objective; c.objectiveRevision++;
        for (const m of c.modules) { m.status = 'pending'; m.acceptedRevision = undefined; }
      }
      instruction.resolution = p.reason;
      return;
    }
    if (p.action === 'plan') {
      if (!p.modules?.length) throw new Error('plan requires modules definitions.');
      if (store.files.activeWork().length) throw new Error('Wait for active tasks before replanning.');
      if (c.modules.some(m => !p.modules!.some(n => n.id === m.id))) throw new Error('Preserve existing IDs; skip obsolete modules with reason.');
      let reopen = false;
      c.modules = p.modules.map((d, i) => {
        const old = c.modules.find(m => m.id === d.id);
        const definition = { id: d.id, objective: d.objective, skills: d.skills, criteria: d.criteria, dependencies: d.dependencies ?? [] };
        const prior = old && { id: old.id, objective: old.objective, skills: old.skills, criteria: old.criteria, dependencies: old.dependencies };
        if (d.status && d.status !== 'pending' && d.status !== old?.status) throw new Error('plan cannot change status; use start/update/accept.');
        reopen ||= c.modules[i]?.id !== d.id || JSON.stringify(definition) !== JSON.stringify(prior);
        return { evidence: [], acceptance: [], reason: '', taskIds: [], ...old, ...definition,
          status: reopen ? 'pending' : old!.status, acceptedRevision: reopen ? undefined : old!.acceptedRevision };
      });
      return;
    }
    const id = p.moduleId;
    if (!id) throw new Error('Supply moduleId.');
    const old = requireCurrentModule(c, id);
    if (p.action === 'update' && p.status === undefined && p.evidence === undefined && p.acceptance === undefined) throw new Error('update requires status, evidence or acceptance; read is non-mutating.');
    const status = p.action === 'start' ? 'running' : p.action === 'accept' ? 'completed' : p.status ?? old.status;
    if (!['start', 'update', 'accept'].includes(p.action)) throw new Error('Unknown action; use help.');
    if (old.status === 'pending' && !['running', 'blocked', 'skipped'].includes(status)) throw new Error('Start the current module before submitting or accepting work.');
    const m: ResearchModule = { ...old, status, evidence: p.evidence ?? old.evidence,
      acceptance: p.acceptance ?? old.acceptance, reason: p.reason!, acceptedRevision: undefined };
    if (status === 'completed') {
      if (p.action !== 'accept') throw new Error('Use accept to complete a module.');
      const problems = acceptanceProblems(store, m);
      if (problems.length) throw new Error('Acceptance rejected: ' + problems.join('; '));
      m.acceptedRevision = c.objectiveRevision;
    }
    if (['completed', 'skipped'].includes(status) && store.files.activeWork(id).length) throw new Error('Module has running tasks; wait or cancel them.');
    c.modules[c.modules.findIndex(m => m.id === id)] = m;
  }, p.expectedRevision, 'manager');
}

function acceptanceProblems(store: ChecklistStore, m: ResearchModule): string[] {
  const problems: string[] = [];
  if (m.acceptance.length !== m.criteria.length) problems.push(`acceptance requires exactly ${m.criteria.length} explanations (one per criterion), received ${m.acceptance.length}; reason is not acceptance`);
  m.acceptance.forEach((text, i) => { if (!text.trim()) problems.push(`acceptance[${i}] is empty`); });
  if (!m.evidence.length) problems.push('evidence is empty: supply real artifact paths or source URLs');
  for (const path of m.evidence) {
    try { if (!store.evidenceExists(path)) problems.push(`Evidence is not a file: ${path}`); }
    catch { problems.push(`Evidence missing or outside workspace: ${path}`); }
  }
  return problems;
}

export function checklistRecovery(store: ChecklistStore, error: unknown, attempted?: ChecklistArguments) {
  let currentRevision: number | undefined; let currentModuleId: string | undefined; let nextAction = 'read';
  let acceptanceRequirements: object | undefined;
  let resolveRequirements: object | undefined;
  try {
    const c = store.read(); currentRevision = c?.revision;
    const m = c && currentModule(c); currentModuleId = m?.id;
    if (!c) nextAction = 'init';
    if (attempted?.action === 'resolve' && c) {
      const pendingInstructions = c.control.instructions.filter(i => !i.resolution);
      resolveRequirements = {
        pendingInstructions,
        requiredFields: ['action', 'expectedRevision', 'reason', 'instructionId'],
        ...(pendingInstructions.length === 1 ? { retryArguments: {
          action: 'resolve', expectedRevision: c.revision, instructionId: pendingInstructions[0].id,
          ...(typeof attempted.reason === 'string' && attempted.reason.trim() ? { reason: attempted.reason } : {}),
          ...(typeof attempted.objective === 'string' && attempted.objective.trim() ? { objective: attempted.objective } : {}),
        } } : {}),
        instruction: pendingInstructions.length
          ? 'Choose the instruction you actually handled and copy its exact id. Submit action=resolve, expectedRevision, instructionId and a nonempty reason. Resolve one at a time; omit status. Do not repeat the failed arguments.'
          : 'There are no pending instructions to resolve. Read current state and follow nextAction; do not invent an instructionId.',
      };
    }
    if (attempted?.action === 'accept' && m) {
      const effective = { ...m, evidence: Array.isArray(attempted.evidence) && attempted.evidence.every(x => typeof x === 'string') ? attempted.evidence : m.evidence, acceptance: Array.isArray(attempted.acceptance) && attempted.acceptance.every(x => typeof x === 'string') ? attempted.acceptance : m.acceptance };
      const requiredFields = ['action', 'moduleId', 'expectedRevision', 'reason', 'evidence', 'acceptance'];
      const missingFields = requiredFields.filter(field => attempted[field as keyof ChecklistArguments] === undefined);
      const invalidFields = requiredFields.filter(field => attempted[field as keyof ChecklistArguments] !== undefined &&
        (!Value.Check(ChecklistActionParameters.properties[field as keyof typeof ChecklistActionParameters.properties], attempted[field as keyof ChecklistArguments]) ||
          (field === 'reason' && typeof attempted.reason === 'string' && !attempted.reason.trim()) ||
          (field === 'evidence' && Array.isArray(attempted.evidence) && !attempted.evidence.length) ||
          (field === 'acceptance' && Array.isArray(attempted.acceptance) && attempted.acceptance.length !== m.criteria.length)));
      const retryTemplate = { action: 'accept', moduleId: m.id, expectedRevision: c!.revision,
        reason: typeof attempted.reason === 'string' ? attempted.reason.trim() : '', evidence: effective.evidence, acceptance: effective.acceptance };
      acceptanceRequirements = {
        requiredFields, missingFields, invalidFields, retryTemplate,
        templateNeedsCompletion: !retryTemplate.reason || acceptanceProblems(store, effective).length > 0,
        criterionChecks: m.criteria.map((criterion, index) => ({ index, criterion,
          explanation: effective.acceptance[index] ?? null })),
        moduleId: m.id, criteria: m.criteria, requiredAcceptanceCount: m.criteria.length,
        evidence: effective.evidence, acceptance: effective.acceptance,
        problems: acceptanceProblems(store, effective),
        ignoredFields: attempted.status === undefined ? [] : ['status'],
        instruction: 'Read the current Checklist, verify actual evidence and complete retryTemplate before submitting. Submit all requiredFields, with exactly one verified acceptance explanation per criterion. Empty arrays or reason alone cannot pass. The template revision is a snapshot, not permission to overwrite a concurrent change. Child suggestions are not manager verification. Never repeat the incomplete call.',
      };
    }
  } catch { nextAction = 'repair'; }
  return { error: String(error), recovery: { nextAction, currentRevision, currentModuleId, ...(resolveRequirements ? { resolveRequirements } : {}), ...(acceptanceRequirements ? { acceptanceRequirements } : {}), instruction: 'Read current state, correct arguments using action: help, then retry once. Do not edit JSON directly.' } };
}
