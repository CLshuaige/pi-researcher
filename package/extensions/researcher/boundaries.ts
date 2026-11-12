import { ChecklistStore, currentModule, type ResearchModule } from './checklist.ts';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import type { ExtensionAPI, ToolResultEvent } from '@earendil-works/pi-coding-agent';
import { atomicWrite, digest, workspacePath } from './store.ts';
/** Cooperative shell scope, not a sandbox: the command may explicitly override it. */
export function scopeBash(root: string, input: { command?: string }) {
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  const temp = workspacePath(root, '.research/tmp');
  const cache = workspacePath(root, '.research/cache');
  mkdirSync(temp, { recursive: true }); mkdirSync(cache, { recursive: true });
  input.command = `cd ${quote(root)} && export TMPDIR=${quote(temp)} XDG_CACHE_HOME=${quote(cache)} &&\n${input.command ?? ''}`;
}

/** Use the existing workspace path checks for a revision's declared write destinations. */
export function followupBoundary(root: string, module: ResearchModule, tool: string, input: Record<string, unknown>): string | undefined {
  if(!module.followup)return;
  try {
    if(tool==='fetch_arxiv')return 'Use a project-local download with an explicit output directory for this followup.';
    if(!['write','edit','download_pdf','engine_start'].includes(tool))return;
    const output=workspacePath(root,module.followup.outputDir);
    const raw=['write','edit'].includes(tool)?input.path:tool==='download_pdf'?input.outputDir:input.projectPath;
    if(typeof raw!=='string' || !raw.trim())return `Supply an explicit destination inside ${module.followup.outputDir}.`;
    const destination=workspacePath(root,raw);
    if(destination!==output && !destination.startsWith(output+sep))return `This followup writes only inside ${module.followup.outputDir}; existing project artifacts are read-only.`;
  } catch(error) { return String(error); }

}

/** Shared observation guard: no controller, Checklist tools or stage scheduling. */
export class ToolRepetitionGuard {
  private calls = new Map<string, { result: string; count: number }>();
  private progress = '';
  reset() { this.calls.clear(); this.progress = ''; }
  observe(root: string, event: ToolResultEvent, context: unknown = []) {
    if (['research_checklist', 'research_job', 'subagent', 'bg_wait'].includes(event.toolName)) return;
    const files: [string, number, number][] = [];
    const scan = (directory: string, prefix = '') => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || ['node_modules', '__pycache__', 'inputs'].includes(entry.name) || entry.isSymbolicLink()) continue;
        const path = join(directory, entry.name), relative = join(prefix, entry.name);
        if (entry.isDirectory()) scan(path, relative);
        else if (entry.isFile()) {
          const info = statSync(path);
          files.push([relative, info.size, info.mtimeMs]);
        }
      }
    };
    try { scan(root); } catch { this.reset(); return; }
    files.sort((a, b) => a[0].localeCompare(b[0]));
    const progress = digest(JSON.stringify([context, files]));
    if (progress !== this.progress) { this.calls.clear(); this.progress = progress; }
    const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    const key = digest(canonical([event.toolName, event.input]));
    const result = digest(canonical([event.isError, event.content]));
    const previous = this.calls.get(key);
    const count = previous?.result === result ? previous.count + 1 : 1;
    if (this.calls.size >= 32 && !this.calls.has(key)) this.calls.delete(this.calls.keys().next().value!);
    this.calls.set(key, { result, count });
    if (count < 3) return;
    const blocked = count >= 4;
    const reason = blocked
      ? `重复工具调用无进展：${event.toolName} 已重复 ${count} 次。保留已有成果，以 partial / blocked 交接，从首次重复步骤调整策略后恢复。`
      : `重复执行检测：${event.toolName} 的相同输入已得到相同结果 ${count} 次，期间研究产物没有变化。不要再次执行这条查询；利用已有结果采取实际修复、改用不同策略，或记录具体阻塞。工具成功不代表研究取得进展。`;
    return { blocked, reason, result: { content: [...event.content, { type: 'text' as const, text: reason }], ...(blocked ? { isError: true } : {}) } };
  }
}

export function reportHandoff(root: string): { status: string; reason?: string } | undefined {
  try { return JSON.parse(readFileSync(workspacePath(root, '.research/report-handoff.json'), 'utf8')); }
  catch { return undefined; }
}

/** Shared specialist write scope; the existing repetition/handoff guard remains report-only. */
export default function reportGuard(pi: ExtensionAPI) {
  const guard = new ToolRepetitionGuard();
  let blocked: string | undefined;
  let projectRoot: string | undefined;
  let module: ResearchModule | undefined;
  let report = true;
  const save = (root: string, status: string, reason?: string) => {
    const path = workspacePath(root, '.research/report-handoff.json');
    mkdirSync(dirname(path), { recursive: true });
    atomicWrite(path, JSON.stringify({ status, reason, root, updatedAt: Date.now() }));
  };
  pi.on('before_agent_start', (_event, ctx) => {
    guard.reset(); blocked = undefined;
    projectRoot=ctx.cwd;
    while(!existsSync(join(projectRoot,'checklist.json')) && dirname(projectRoot)!==projectRoot)projectRoot=dirname(projectRoot);
    if(!existsSync(join(projectRoot,'checklist.json')))projectRoot=ctx.cwd;
    let checklist: ReturnType<ChecklistStore['read']>;try{checklist=new ChecklistStore(projectRoot).read();}catch(error){blocked=String(error);return;}module=checklist && currentModule(checklist);
    report=module ? module.skills.includes('research-report') : !/name[>:=\s"']+research-(literature|experiment)\b/.test(ctx.getSystemPrompt?.() || '');
    if(report)save(projectRoot,'running');
  });
  pi.on('tool_call', (event, ctx) => {
    if (blocked) return { block: true, terminate: true, reason: blocked };
    if(module?.followup && projectRoot) {
      let latest: ReturnType<ChecklistStore['read']>;try{latest=new ChecklistStore(projectRoot).read();}catch(error){return {block:true,terminate:true,reason:String(error)};}
      if(!latest || currentModule(latest)?.id!==module.id)return {block:true,terminate:true,reason:'The owning followup is no longer current.'};
      const reason=followupBoundary(projectRoot,module,event.toolName,event.input);
      if(reason)return {block:true,reason};
    }
    if (event.toolName === 'bash' && (report || module?.followup)) scopeBash(module?.followup ? workspacePath(projectRoot!,module.followup.outputDir):ctx.cwd, event.input as { command?: string });
  });
  pi.on('tool_result', (event, ctx) => {
    if(!report)return;
    const observed = guard.observe(projectRoot || ctx.cwd, event);
    if (observed?.blocked) { blocked = observed.reason; save(projectRoot || ctx.cwd, 'blocked', blocked); }
    return observed?.result;
  });
  pi.on('turn_end', (_event, ctx) => {
    if (!blocked) return;
    ctx.abort();
    return { continue: false, entries: [{ type: 'custom_message' as const,
      customType: 'research-report-partial', content: blocked, display: true }] };
  });
  pi.on('agent_settled', (event, ctx) => {
    if (report && !blocked) save(projectRoot || ctx.cwd, event.aborted ? 'partial' : 'handoff', event.aborted ? '运行被中断，保留已有成果，恢复后核验。' : undefined);
  });
}
