export type SubagentResultStatus = 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface WorkflowChildResult {
  id: string;
  runId?: string;
  status: SubagentResultStatus;
  error?: string;
  summary?: string;
  artifacts: string[];
}

export interface WorkflowResults {
  status: SubagentResultStatus;
  incomplete: boolean;
  error?: string;
  children: WorkflowChildResult[];
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function jsonHandoff(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return object(value);
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    const candidate = object(parsed);
    return ['status', 'summary', 'artifacts'].some((key) => key in candidate) ? candidate : {};
  } catch {
    return {};
  }
}

function unwrapResult(value: Record<string, any>): Record<string, any> {
  if (!Array.isArray(value.results) || !value.results.length) return value;
  const leaf = object(value.results[0]);
  return {
    ...leaf,
    agent: value.agent ?? leaf.agent,
    success: value.ok === false || leaf.success === false || (typeof leaf.exitCode === 'number' && leaf.exitCode !== 0)
      ? false
      : value.ok === true ? true : leaf.success,
    error: value.error ?? leaf.error,
    runId: value.runId ?? leaf.runId,
  };
}

function status(value: unknown, success?: unknown): SubagentResultStatus | undefined {
  if (success === false) return 'failed';
  if (typeof value === 'string') {
    if (['running', 'queued', 'pending'].includes(value)) return 'running';
    if (['complete', 'completed', 'success', 'succeeded'].includes(value)) return 'completed';
    if (['failed', 'error', 'timed_out', 'blocked', 'rejected'].includes(value)) return 'failed';
    if (['stopped', 'cancelled', 'interrupted', 'paused', 'aborted'].includes(value)) return 'cancelled';
    if (value === 'partial') return 'partial';
  }
  if (success === true) return 'completed';
  return undefined;
}

function childResult(
  id: string,
  runId: unknown,
  fallbackStatus: unknown,
  result: Record<string, any>,
  request: Record<string, any>,
  artifactExists?: (path: string) => boolean,
  fallbackAgent?: unknown,
): WorkflowChildResult {
  const leaf = unwrapResult(result);
  const structuredOutput = jsonHandoff(leaf.structuredOutput);
  const outputHandoff = jsonHandoff(leaf.output ?? leaf.finalOutput);
  const summaryHandoff = jsonHandoff(leaf.summary);
  const structured = Object.keys(structuredOutput).length
    ? structuredOutput
    : Object.keys(outputHandoff).length ? outputHandoff : summaryHandoff;
  const failed = result.ok === false || result.success === false || leaf.success === false ||
    (typeof leaf.exitCode === 'number' && leaf.exitCode !== 0);
  const resultStatus = status(leaf.status ?? leaf.state, leaf.success);
  const fallbackState = status(fallbackStatus);
  const executionStatus = failed || typeof leaf.error === 'string'
    ? 'failed'
    : fallbackState === 'failed' || fallbackState === 'cancelled'
      ? fallbackState
      : resultStatus ?? fallbackState;
  const handoffStatus = status(structured.status);
  const rawStatus = executionStatus === 'failed' || executionStatus === 'cancelled'
    ? executionStatus
    : handoffStatus === 'failed' || handoffStatus === 'cancelled' || handoffStatus === 'partial'
      ? 'partial'
      : executionStatus ?? handoffStatus;
  const error = typeof result.error === 'string' ? result.error
    : typeof leaf.error === 'string' ? leaf.error
      : typeof leaf.exitCode === 'number' && leaf.exitCode !== 0 ? `Child exited with code ${leaf.exitCode}` : undefined;
  const handoffError = typeof structured.error === 'string' ? structured.error : undefined;
  const summaryValue = typeof structured.summary === 'string'
    ? structured.summary
    : typeof leaf.summary === 'string' && !Object.keys(summaryHandoff).length
      ? leaf.summary
      : typeof leaf.finalOutput === 'string' && !Object.keys(jsonHandoff(leaf.finalOutput)).length
        ? leaf.finalOutput
        : typeof leaf.output === 'string' && !Object.keys(outputHandoff).length
          ? leaf.output
      : undefined;
  const summary = typeof summaryValue === 'string' ? summaryValue.slice(0, 1200) : undefined;
  const declaredArtifacts = Array.isArray(structured.artifacts)
    ? structured.artifacts.filter((path: unknown): path is string => typeof path === 'string')
    : [];
  const artifacts = artifactExists ? declaredArtifacts.filter(artifactExists) : declaredArtifacts;
  const missingArtifacts = artifactExists ? declaredArtifacts.filter((path) => !artifactExists(path)) : [];
  const agent = request.agent || result.agent || leaf.agent || fallbackAgent;
  const taskText = [request.task, request.objective, leaf.task].filter((value): value is string => typeof value === 'string').join('\n');
  const controlledRole = taskText.includes('研究委派上下文：') && /research-(?:hypothesis|method)/.test(taskText);
  const namedResearchAgent = typeof agent === 'string' && /research[-/]/.test(agent);
  const needsHandoff = controlledRole || namedResearchAgent;
  const hasHandoff = typeof structured.summary === 'string' && Array.isArray(structured.artifacts);
  const missingHandoff = needsHandoff && rawStatus === 'completed' &&
    (!hasHandoff || (namedResearchAgent && artifacts.length === 0));
  const artifactError = missingArtifacts.length ? `声明产物不存在：${missingArtifacts.join('、')}` : undefined;
  const errors = [error, handoffError, artifactError].filter((item): item is string => Boolean(item));
  const childError = errors.length ? errors.join('\n') : undefined;
  const failedExecution = executionStatus === 'failed';
  return {
    id,
    ...(typeof runId === 'string' ? { runId } : {}),
    status: failedExecution ? 'failed'
      : executionStatus === 'cancelled' ? 'cancelled'
        : executionStatus === 'running' ? 'running'
          : handoffError || missingArtifacts.length || missingHandoff ? 'partial'
            : rawStatus ?? 'running',
    ...(childError ? { error: childError } : {}),
    ...(summary ? { summary } : {}),
    artifacts,
  };
}

/** Parse the installed pi-subagents workflow completion/receipt fields. */
export function parseWorkflowResults(
  value: unknown,
  requestedTasks: unknown[] = [],
  artifactExists?: (path: string) => boolean,
): WorkflowResults | undefined {
  const record = object(value);
  const workflow = object(record.workflowChildren);
  if (record.mode !== 'workflow' && !record.workflowChildren && requestedTasks.length === 0) return undefined;
  const rawChildren = Array.isArray(workflow.children) ? workflow.children : [];
  const rawResults = Array.isArray(record.results) ? record.results : [];
  const workflowState = status(record.state) ?? status(workflow.workflowState);
  const error = typeof record.error === 'string' ? record.error : undefined;
  if (!rawChildren.length && !rawResults.length && !workflowState && !error && record.success !== false) return undefined;

  const children: WorkflowChildResult[] = rawChildren.map((raw: unknown, index: number) => {
    const child = object(raw);
    const resultIndex = rawResults.findIndex((row: unknown) => {
      const candidate = object(row);
      return (child.runId && candidate.runId === child.runId) ||
        (child.childId && (candidate.workflowKey === child.childId || candidate.key === child.childId || candidate.id === child.childId));
    });
    const hasIdentity = Boolean(child.runId || child.childId);
    const result = object(resultIndex >= 0 ? rawResults[resultIndex] : !hasIdentity ? rawResults[index] : undefined);
    const request = object(requestedTasks.find((task) => {
      const taskRecord = object(task);
      return [taskRecord.key, taskRecord.id, taskRecord.taskKey, taskRecord.workflowKey]
        .some((key) => key && key === child.childId);
    }) ?? requestedTasks[index]);
    const matchedRequest = request;
    return childResult(
      String(child.childId || result.workflowKey || result.key || result.id || request.key || request.id || index),
      child.runId || result.runId,
      child.state,
      result,
      matchedRequest,
      artifactExists,
      child.agent,
    );
  });

  // Some native completion records expose results without a receipt inventory.
  if (!children.length) {
    for (const [index, raw] of rawResults.entries()) {
      const result = object(raw);
      const matchedRequest = object(requestedTasks[index]);
      children.push(childResult(
        String(result.workflowKey || result.key || result.id || matchedRequest.key || matchedRequest.id || index),
        result.runId,
        undefined,
        result,
        matchedRequest,
        artifactExists,
      ));
    }
  }

  const incomplete = children.length === 0 || requestedTasks.length > children.length ||
    children.some((child) => child.status === 'partial') ||
    (workflow.inventoryComplete === false && workflowState !== 'running');
  const statuses = children.map((child) => child.status);
  const aggregate: SubagentResultStatus = statuses.includes('running') || workflowState === 'running'
    ? 'running'
    : (error || record.success === false) && !statuses.some((item) => item === 'completed' || item === 'cancelled')
      ? 'failed'
      : (error || record.success === false) && statuses.some((item) => item === 'completed')
        ? 'partial'
    : workflowState === 'failed' && !statuses.length
      ? 'failed'
      : workflowState === 'cancelled' && !statuses.length
        ? 'cancelled'
        : incomplete
          ? 'partial'
          : statuses.includes('failed') && statuses.some((item) => item === 'completed' || item === 'cancelled')
            ? 'partial'
            : workflowState === 'failed' && statuses.includes('completed')
              ? 'partial'
              : statuses.includes('failed')
                ? 'failed'
                : statuses.includes('cancelled') && statuses.includes('completed')
                  ? 'partial'
                  : statuses.includes('cancelled')
                    ? 'cancelled'
                    : 'completed';
  return { status: aggregate, incomplete, ...(error ? { error } : {}), children };
}
