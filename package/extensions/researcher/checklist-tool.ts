import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { relative, sep } from 'node:path';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { ChecklistStore, ModuleSchema, checklistState, currentModule, requireCurrentModule, type Checklist, type ResearchModule } from './checklist.ts';

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
  action: Type.Union([Type.Literal("help"), Type.Literal("read"), Type.Literal("init"), Type.Literal("repair"), Type.Literal("plan"), Type.Literal("start"), Type.Literal("update"), Type.Literal("accept"), Type.Literal("resolve"), Type.Literal("followup")]),
  expectedRevision: Type.Optional(Type.Integer({ minimum: 1, description: 'Use the revision from the latest tool result or checkpoint. On conflict read again; never guess.' })),
  reason: Type.Optional(Type.String({ minLength: 1, description: 'Why this mutation is necessary; required except help/read/init/repair.' })),
  objective: Type.Optional(Type.String({ minLength: 1 })),
  modules: Type.Optional(Type.Array(Definition, { minItems: 1, description: 'REQUIRED for action=plan: nonempty modules array with id, objective, skills, criteria and dependencies per module. reason/title do not define modules. Preserve existing IDs.' })),
  moduleId: Type.Optional(Type.String({ description: 'followup: original target module ID. start/update/accept: returned currentModule.id.' })),
  status: Type.Optional(Type.Union(ModuleSchema.properties.status.anyOf, { description: 'update only. Do not copy current status into accept: accept always completes after validation and ignores redundant status.' })),
  evidence: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: 'REQUIRED for accept: actual verified workspace file paths or source URLs. Submit explicitly together with acceptance; reason is not evidence.' })),
  acceptance: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: 'REQUIRED for accept: exactly one verified explanation per criterion, in criteria order. Always submit explicitly with evidence; reason is an audit note, not acceptance.' })),
  kind: Type.Optional(Type.Union([Type.Literal('analysis'),Type.Literal('revision')], {description:'followup only: supplementary analysis or a new version of the selected stage.'})),
  criteria: Type.Optional(ModuleSchema.properties.criteria),
  skills: Type.Optional(ModuleSchema.properties.skills),
  affectedModules: Type.Optional(Type.Array(Type.String(), {description:'followup only: downstream modules requiring review. Omit for conservative dependency propagation; [] requires an explicit impact explanation.'})),
  impact: Type.Optional(Type.String({minLength:1})),
  response: Type.Optional(Type.String({minLength:1,description:'resolve only: actual answer for a conversational question, not a claim that unverified files were written.'})),
  instructionId: Type.Optional(Type.String({ minLength: 1, description: 'REQUIRED for resolve: copy an exact ID from the latest pendingInstructions. Never guess or omit it; reason records its resolution.' })),
}, { additionalProperties: false });
// Keep the provider schema flat: Moonshot rejects object + root anyOf.
// Conditional acceptance requirements are enforced by the controller before execution.
export const ChecklistParameters = Type.Object(ChecklistActionParameters.properties, { additionalProperties: false });
export type ChecklistArguments = Static<typeof ChecklistActionParameters>;
export const checklistGuide = `research_checklist protocol. Skills are instruction files, not callable tools. Never edit checklist.json.
For each call, provide title when possible: a Chinese action phrase of at most 12 characters, e.g. "规划研究阶段" or "核验训练产物". title is optional display metadata; omit completion/failure claims. The program determines execution status and uses a fixed action label when title is absent. reason remains the mutation rationale/audit note or instruction resolution, never a title or acceptance explanation.
Use ONE mutation per tool result, not a batch. In examples replace expectedRevision:1 with the revision in the latest result/checkpoint. On conflict read again; never guess or use repair for conflicts.
- Help: {"action":"help"}; inspect state: {"action":"read"}.
- Initialize once: {"action":"init","objective":"Research goal"}.
- Plan ordered definitions: {"action":"plan","expectedRevision":1,"reason":"Initial plan","modules":[{"id":"M1","objective":"Inspect evidence","skills":["research-literature"],"criteria":["Cite original sources"],"dependencies":[]}]}.
  Required per module: id, objective, skills, criteria. dependencies defaults to []. Runtime fills pending status and empty evidence/acceptance. Preserve existing IDs. Unchanged definitions preserve progress; changed definitions reopen this and following modules. Do not change status through plan.
- Completed-stage followup: {"action":"followup","expectedRevision":1,"reason":"User requested a method amendment","instructionId":"I-...","moduleId":"M3","kind":"revision","objective":"Amend only the method document; do not run experiments","criteria":["Deliver and verify the requested amendments"],"impact":"Mark dependent experiments/report for review; do not rerun them"}.
  The harness creates a new ordered module and version outputDir, preserving original modules and artifacts. kind=analysis defaults to no specialist skills and does not replace the accepted version. kind=revision inherits the target's skills unless explicitly supplied. Read the resulting currentModule.id and followup.outputDir; start and accept that new ID. Never write old accepted paths. Bound instructions resolve automatically only after acceptance. Prefer small amendments and existing evidence over repeating a whole workflow. affectedModules=[] requires impact explaining why downstream results remain applicable. Historical completed results are retained; needsReview is not authorization to rerun them.
- Start: {"action":"start","expectedRevision":1,"reason":"Begin current module","moduleId":"M1"}.
  Only the runtime-selected currentModule (normally the first unfinished module; registered followups take precedence) may execute, delegate or be accepted. Its complete SKILL.md instructions are injected into requests; follow them. Blocked modules must be resolved or explicitly skipped, never bypassed.
- Update fields: {"action":"update","expectedRevision":1,"reason":"Collected evidence","moduleId":"M1","status":"awaiting_acceptance","evidence":["research/result.md"]}.
  Omitted fields are preserved. blocked/skipped require a concrete reason. Do not send completed here. Change objective/skills/criteria/dependencies using plan, not update/accept.
- Accept: {"action":"accept","expectedRevision":1,"reason":"Verified source","moduleId":"M1","evidence":["research/result.md"],"acceptance":["Original source supports criterion 1"]}.
  Automatically sets completed; omit status (redundant status is ignored). For accept this tool REQUIRES moduleId, expectedRevision, reason, evidence and acceptance together. Always explicitly submit both arrays, even when previously saved. reason does not replace acceptance. Start first. Requires one nonempty explanation per criterion, existing evidence, no active module tasks. Acceptance cannot change criteria. Then start the next module.
- Resolve user input: {"action":"resolve","expectedRevision":1,"reason":"Explained how this request was handled","instructionId":"I-..."}.
  After research completion, read-only questions require response containing the actual answer. File modifications require followup, not a prose-only resolve. Never claim a failed write succeeded. instructionId is required: copy the exact id from pendingInstructions in the latest result/checkpoint; I-... is a placeholder, not an ID. Resolve one instruction per call. status does not resolve an instruction. Optional objective changes the global goal and reopens modules. objective is accepted only in init/resolve.
- Recover externally edited/deleted JSON: {"action":"repair"}; restores the committed snapshot and preserves rejected content.
Use moduleId plus top-level fields; the old module parameter is rejected. Paths are workspace-relative or absolute within the root; evidence may be an http(s) URL. Errors return recovery.nextAction/currentRevision/currentModuleId. Correct arguments and retry; do not blindly repeat.`;

export function applyChecklistAction(store: ChecklistStore, p: ChecklistArguments) {
  // Also validate direct/programmatic callers; SDK validates provider calls before execute.
  if (!Value.Check(ChecklistActionParameters, p)) throw new Error('Invalid arguments. Use action: help for the exact JSON protocol.');
  if (p.action === 'read') return store.read();
  if (p.action === 'repair') return store.repair();
  if (p.action === 'init') return store.initialize(p.objective ?? '');
  if (p.expectedRevision === undefined || !p.reason?.trim()) throw new Error('Mutation requires expectedRevision and nonempty reason. Read first.');
  if (p.objective !== undefined && !['resolve','followup'].includes(p.action)) throw new Error('Change objective through resolve with instructionId.');
  if(p.action!=='followup' && [p.kind,p.criteria,p.skills,p.affectedModules,p.impact].some(value=>value!==undefined))throw new Error('kind/criteria/skills/affectedModules/impact are followup-only fields.');
  if(p.response!==undefined && p.action!=='resolve')throw new Error('response is for resolve only.');
  return store.change(p.reason, c => {
    if (p.action === 'resolve') {
      if (!p.instructionId?.trim()) throw new Error('resolve requires instructionId. Copy an exact ID from pendingInstructions; status cannot replace instructionId.');
      const instruction = c.control.instructions.find(i => i.id === p.instructionId);
      if (!instruction || instruction.resolution) throw new Error('Use an unresolved instructionId from pendingInstructions.');
      if (instruction.followupModuleId) throw new Error('This instruction is bound to a followup; accept its verified artifacts instead of resolving it in prose.');
      if (instruction.requiresArtifact) throw new Error('A file delivery was attempted; create a followup and verify its artifacts before resolving this instruction.');
      if (c.modules.length && !currentModule(c) && !p.response?.trim() && !p.objective) throw new Error('Completed research: provide response for a read-only answer, or use followup for requested modifications.');
      if(p.response) instruction.response=p.response;
      if (p.evidence?.length) for(const path of p.evidence) if(!store.evidenceExists(path)) throw new Error(`Missing instruction evidence: ${path}`);
      if (p.objective && p.objective !== c.objective) {
        if (store.files.activeWork().length) throw new Error('Cancel or finish active tasks/jobs before changing the goal.');
        if(c.modules.some(m=>m.followup)) throw new Error('Preserve published revision history; express scoped changes through followup instead of resetting the global goal.');
        c.objective = p.objective; c.objectiveRevision++;
        for (const m of c.modules) { m.status = 'pending'; m.acceptedRevision = undefined; }
      }
      instruction.resolution = p.reason;
      return;
    }
    if (p.action === 'followup') {
      if(!p.instructionId || !p.moduleId || !p.objective?.trim() || !p.criteria?.length || !p.kind) throw new Error('followup requires instructionId, moduleId (target), objective, criteria and kind.');
      if(store.files.activeWork().length || c.modules.some(m=>m.followup && !['completed','skipped'].includes(m.status))) throw new Error('Finish or cancel active work before creating another followup.');
      const instruction=c.control.instructions.find(i=>i.id===p.instructionId && !i.resolution);
      if(!instruction || instruction.followupModuleId) throw new Error('Use an unresolved, unbound instructionId.');
      const target=c.modules.find(m=>m.id===p.moduleId && !m.followup);
      if(!target || target.status!=='completed' || target.acceptedRevision!==c.objectiveRevision) throw new Error('Followups target a currently accepted original module; continue unfinished research normally.');
      if(p.kind==='revision' && !p.impact?.trim()) throw new Error('A revision requires impact: describe downstream effects and the authorized scope.');
      const affected=new Set<string>();
      for(const module of c.modules.filter(m=>!m.followup)) if(module.dependencies.some(id=>id===target.id || affected.has(id))) affected.add(module.id);
      if(p.affectedModules?.some(id=>!affected.has(id))) throw new Error('affectedModules must be downstream dependencies of the selected module.');
      const id=`${target.id}_R_${randomUUID().replaceAll('-','')}`;
      const skills=p.skills ?? (p.kind==='analysis'?[]:target.skills);
      const category=target.skills[0]?.replace('research-','') || 'analysis';
      const outputDir=`${category}/revisions/${id}`;
      const baseline=store.snapshotEvidence(c,id);
      target.versionNumber ??= 1;
      const priorRevisions=c.modules.filter(m=>m.followup?.targetModuleId===target.id && m.followup.kind==='revision');
      const versionNumber=p.kind==='revision' ? Math.max(target.versionNumber,...priorRevisions.map((m,i)=>m.versionNumber ?? i+2))+1 : undefined;
      c.modules.push({id,versionNumber,objective:p.objective,skills,criteria:p.criteria,dependencies:[target.id],status:'pending',evidence:[],acceptance:[],reason:p.reason!,taskIds:[],
        followup:{kind:p.kind,instructionId:p.instructionId,targetModuleId:target.id,outputDir,baseVersionId:target.currentVersionId ?? target.id,baseRevision:c.revision,baseline,affectedModules:p.kind==='revision'?[...(p.affectedModules ?? affected)]:[],impact:p.impact ?? 'Supplementary analysis; previously accepted deliverables remain unchanged.'}});
      instruction.followupModuleId=id;instruction.requiresArtifact=true;
      c.control.state='running';c.control.reason='';
      return;
    }
    if (p.action === 'plan') {
      const initialPlan = c.modules.length === 0;
      if(c.modules.some(m=>m.followup && !['completed','skipped'].includes(m.status))) throw new Error('Finish the current followup before replanning.');
      if (!p.modules?.length) throw new Error('plan requires modules: a nonempty array of definitions with id, objective, skills, criteria and dependencies. reason/title alone cannot create the plan.');
      if (store.files.activeWork().length) throw new Error('Wait for active tasks before replanning.');
      if (c.modules.some(m => !p.modules!.some(n => n.id === m.id))) throw new Error('Preserve existing IDs; skip obsolete modules with reason.');
      let reopen = false;
      c.modules = p.modules.map((d, i) => {
        const old = c.modules.find(m => m.id === d.id);
        const definition = { id: d.id, objective: d.objective, skills: d.skills, criteria: d.criteria, dependencies: d.dependencies ?? [] };
        if(old?.followup) { if(JSON.stringify(definition)!==JSON.stringify({id:old.id,objective:old.objective,skills:old.skills,criteria:old.criteria,dependencies:old.dependencies})) throw new Error('Preserve revision history; create a new followup instead.'); return old; }
        if(old?.currentVersionId && JSON.stringify(definition)!==JSON.stringify({id:old.id,objective:old.objective,skills:old.skills,criteria:old.criteria,dependencies:old.dependencies}))throw new Error('Use followup to revise a versioned stage.');
        const prior = old && { id: old.id, objective: old.objective, skills: old.skills, criteria: old.criteria, dependencies: old.dependencies };
        if (d.status && d.status !== 'pending' && d.status !== old?.status) throw new Error('plan cannot change status; use start/update/accept.');
        reopen ||= c.modules[i]?.id !== d.id || JSON.stringify(definition) !== JSON.stringify(prior);
        if(reopen && old?.currentVersionId)throw new Error('Replanning would invalidate a published revision; use followup.');
        return { evidence: [], acceptance: [], reason: '', taskIds: [], ...old, ...definition,
          status: reopen ? 'pending' : old!.status, acceptedRevision: reopen ? undefined : old!.acceptedRevision };
      });
      if (initialPlan) for (const instruction of c.control.instructions)
        if (!instruction.resolution && !instruction.followupModuleId) instruction.planned = true;
      return;
    }
    const id = p.moduleId;
    if (!id) throw new Error('Supply moduleId.');
    const old = requireCurrentModule(c, id);
    if (p.action === 'update' && p.status === undefined && p.evidence === undefined && p.acceptance === undefined) throw new Error('update requires status, evidence or acceptance; read is non-mutating.');
    const status = p.action === 'start' ? 'running' : p.action === 'accept' ? 'completed' : p.status ?? old.status;
    if (!['start', 'update', 'accept'].includes(p.action)) throw new Error('Unknown action; use help.');
    if (old.status === 'pending' && !['running', 'blocked', 'skipped'].includes(status)) throw new Error('Start the current module before submitting or accepting work.');
    if(p.action==='start' && old.followup) mkdirSync(store.path(old.followup.outputDir),{recursive:true});
    const m: ResearchModule = { ...old, status, evidence: p.evidence ?? old.evidence,
      acceptance: p.acceptance ?? old.acceptance, reason: p.reason!, acceptedRevision: undefined };
    if (status === 'completed') {
      if (p.action !== 'accept') throw new Error('Use accept to complete a module.');
      const problems = acceptanceProblems(store, m);
      if (problems.length) throw new Error('Acceptance rejected: ' + problems.join('; '));
      store.verifyBaseline(m);
      m.acceptedRevision = c.objectiveRevision;
      if(m.followup) {
        const target=c.modules.find(module=>module.id===m.followup!.targetModuleId)!;
        if((target.currentVersionId ?? target.id)!==m.followup.baseVersionId) throw new Error('The target version changed; reconcile the revision base first.');
        if(m.followup.kind==='revision') {
          target.currentVersionId=m.id;target.needsReview=[];
          for(const id of m.followup.affectedModules){const dependent=c.modules.find(module=>module.id===id)!;dependent.needsReview=[...new Set([...(dependent.needsReview ?? []),m.id])];}
        }
        const instruction=c.control.instructions.find(i=>i.id===m.followup!.instructionId)!;
        instruction.resolution=p.reason;instruction.response=`Verified delivery: ${m.evidence.join(', ')}`;
      }
    }
    if (['completed', 'skipped'].includes(status) && store.files.activeWork(id).length) throw new Error('Module has running tasks; wait or cancel them.');
    if(status==='skipped' && m.followup){const instruction=c.control.instructions.find(i=>i.id===m.followup!.instructionId)!;instruction.resolution=`Cancelled without publishing: ${p.reason}`;}
    c.modules[c.modules.findIndex(m => m.id === id)] = m;
  }, p.expectedRevision, 'manager');
}

function acceptanceProblems(store: ChecklistStore, m: ResearchModule): string[] {
  const problems: string[] = [];
  if (m.acceptance.length !== m.criteria.length) problems.push(`acceptance requires exactly ${m.criteria.length} explanations (one per criterion), received ${m.acceptance.length}; reason is not acceptance`);
  m.acceptance.forEach((text, i) => { if (!text.trim()) problems.push(`acceptance[${i}] is empty`); });
  if (!m.evidence.length) problems.push('evidence is empty: supply real artifact paths or source URLs');
  for (const path of m.evidence) {
    if(m.followup) { try { const name=relative(store.path(m.followup.outputDir),store.path(path));if(!name || name.startsWith('..'+sep) || name==='..') problems.push(`Followup evidence must be inside ${m.followup.outputDir}: ${path}`); } catch { problems.push(`Followup evidence must be a local artifact: ${path}`); } }
    try { if (!store.evidenceExists(path)) problems.push(`Evidence is not a file: ${path}`); }
    catch { problems.push(`Evidence missing or outside workspace: ${path}`); }
  }
  return problems;
}

export function checklistRecovery(store: ChecklistStore, error: unknown, attempted?: ChecklistArguments) {
  let currentRevision: number | undefined; let currentModuleId: string | undefined; let nextAction = 'read';
  let acceptanceRequirements: object | undefined;
  let resolveRequirements: object | undefined;
  let planningRequirements: object | undefined;
  let initialPlanRecovery = false;
  try {
    const c = store.read(); currentRevision = c?.revision;
    const m = c && currentModule(c); currentModuleId = m?.id;
    if (c && isSatisfiedStartRecovery(store, c, error, attempted)) {
      return { error: String(error), recovery: {
        required: false, resolution: 'already_satisfied', currentRevision, currentModuleId,
        nextAction: checklistState(c, store.readInbox()).nextAction,
        instruction: 'This start is already satisfied. Continue from the latest checklist state; do not repeat it.',
      } };
    }
    if (!c) nextAction = 'init';
    const errorMessage = (error instanceof Error ? error.message : String(error)).replace(/^Error: /, '');
    if (c && attempted?.action === 'plan' && c.modules.length === 0 &&
      (!attempted.modules || attempted.modules.length === 0) && errorMessage.startsWith('plan requires modules:')) {
      initialPlanRecovery = true;
      nextAction = 'plan';
      const retryTemplate = {
        action: 'plan', expectedRevision: c.revision, reason: attempted.reason!,
        modules: [{ id: 'M1', objective: '', skills: [], criteria: [], dependencies: [] }],
      };
      planningRequirements = {
        objective: c.objective,
        requiredFields: ['action', 'expectedRevision', 'reason', 'modules'],
        missingFields: ['modules'], moduleRequiredFields: ['id', 'objective', 'skills', 'criteria'],
        retryTemplate, templateNeedsCompletion: true,
        instruction: 'Use the actual research request to choose the number and order of modules, fill every module objective and nonempty criteria array, and choose appropriate skills and dependencies. Changing reason/title does not plan research. Empty objective or acceptance criteria cannot pass validation. Complete the template, then submit through research_checklist; recovery never submits it automatically.',
      };
    }
    if (attempted?.action === 'plan' && c) {
      planningRequirements ??= {
        requiredFields: ['action', 'expectedRevision', 'reason', 'modules'],
        missingFields: !Array.isArray(attempted.modules) || !attempted.modules.length ? ['modules'] : [],
        moduleRequiredFields: ['id', 'objective', 'skills', 'criteria'],
        instruction: 'Create the actual ordered modules array from the research request. Every module needs its own id, objective, skills array and nonempty criteria array; dependencies is optional. Include this array in action=plan with the latest revision and reason. A narrative reason/title is not a plan. Do not repeat the call without modules.',
      };
    }
    if (attempted?.action === 'resolve' && c) {
      const pendingInstructions = c.control.instructions.filter(i => !i.resolution);
      resolveRequirements = {
        pendingInstructions,
        requiredFields: ['action', 'expectedRevision', 'reason', 'instructionId', ...(c.modules.length && !m ? ['response'] : [])],
        ...(pendingInstructions.length === 1 ? { retryArguments: {
          action: 'resolve', expectedRevision: c.revision, instructionId: pendingInstructions[0].id,
          ...(typeof attempted.response === 'string' && attempted.response.trim() ? { response: attempted.response } : {}),
          ...(typeof attempted.reason === 'string' && attempted.reason.trim() ? { reason: attempted.reason } : {}),
          ...(typeof attempted.objective === 'string' && attempted.objective.trim() ? { objective: attempted.objective } : {}),
        } } : {}),
        instruction: pendingInstructions.length
          ? (pendingInstructions.some(i=>i.followupModuleId || i.requiresArtifact) ? 'Artifact instructions cannot be closed in prose: create a followup, or finish and accept the already bound module. Other read-only questions require an actual response.' : 'Choose the instruction you actually handled and copy its exact id. Submit action=resolve, expectedRevision, instructionId and a nonempty reason. Resolve one at a time; omit status. Do not repeat the failed arguments. After completion include response with the actual answer, or use followup for requested modifications.')
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
  return { error: String(error), recovery: { required: true, nextAction, currentRevision, currentModuleId, ...(planningRequirements ? { planningRequirements } : {}), ...(resolveRequirements ? { resolveRequirements } : {}), ...(acceptanceRequirements ? { acceptanceRequirements } : {}), instruction: initialPlanRecovery ? 'Complete planningRequirements.retryTemplate using the research objective and submit it with action: plan. Do not change checklist JSON directly; recovery does not submit the plan for you.' : 'Read current state, correct arguments using action: help, then retry once. Do not edit JSON directly.' } };
}

function isSatisfiedStartRecovery(store: ChecklistStore, current: Checklist, error: unknown, attempted?: ChecklistArguments): boolean {
  if (attempted?.action !== 'start' || attempted.expectedRevision === undefined || !attempted.moduleId) return false;
  const allowed = new Set(['action', 'expectedRevision', 'reason', 'moduleId', 'title']);
  if (Object.entries(attempted).some(([key, value]) => value !== undefined && !allowed.has(key))) return false;
  const message = error instanceof Error ? error.message : String(error);
  const casMessage = message.startsWith('Error: ') ? message.slice('Error: '.length) : message;
  if (!casMessage.startsWith(`Revision conflict: expected ${attempted.expectedRevision}, actual `)) return false;

  const snapshotPath = store.path(`.research/checklist/revision-${attempted.expectedRevision}.json`);
  if (!existsSync(snapshotPath)) return false;
  const expected = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Checklist;
  store.validate(expected);
  if (expected.revision !== attempted.expectedRevision || expected.researchId !== current.researchId ||
      expected.objective !== current.objective || expected.objectiveRevision !== current.objectiveRevision) return false;
  if (!['running', 'waiting'].includes(current.control.state)) return false;

  const expectedModule = currentModule(expected);
  const currentModuleNow = currentModule(current);
  if (!expectedModule || expectedModule.id !== attempted.moduleId || !['pending', 'running'].includes(expectedModule.status) ||
      !currentModuleNow || currentModuleNow.id !== attempted.moduleId || currentModuleNow.status !== 'running') return false;
  const definition = (module: ResearchModule) => JSON.stringify({ id: module.id, objective: module.objective,
    skills: module.skills, criteria: module.criteria, dependencies: module.dependencies ?? [],
    versionNumber: module.versionNumber, currentVersionId: module.currentVersionId, followup: module.followup,
    needsReview: module.needsReview });
  return definition(expectedModule) === definition(currentModuleNow);
}
