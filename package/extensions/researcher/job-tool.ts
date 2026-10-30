import { Type, type Static } from 'typebox';
export const JobParameters = Type.Object({
  action: Type.Union(['start', 'status', 'cancel', 'wait'].map(value => Type.Literal(value))),
  moduleId: Type.Optional(Type.String()),
  command: Type.Optional(Type.String({ minLength: 1, maxLength: 20000 })),
  cwd: Type.Optional(Type.String({ description: 'Existing directory inside research root; defaults to root.' })),
  env: Type.Optional(Type.Record(Type.String(), Type.String(), { description: 'Additional environment passed to the command; values are not persisted.' })),
  timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 86400, description: 'Process lifetime limit, default 1200; overall research deadline also applies.' })),
  jobId: Type.Optional(Type.String()),
  wakeAfterSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 1800, description: 'wait only: one scheduled model wake, not a recurring polling loop.' })),
}, { additionalProperties: false });
export type JobArguments = Static<typeof JobParameters>;
export const jobGuide = `Managed Linux background processes. Use for downloads/training instead of a long foreground bash call. start returns immediately with a job ID; it does NOT wait for completion. Commands must stay in the foreground inside the worker: no nohup, trailing &, daemonization or nested agents. Keep files/caches/downloads inside the research root. This is cooperative scope, not a sandbox.
- start: {action:"start",moduleId:"M1",command:"python3 download.py",env:{PYTHONUNBUFFERED:"1"},timeoutSeconds:1200}. Current module must be started. Identical active commands are deduplicated.
- status: {action:"status",jobId:"J-..."} returns exit status and a bounded log tail; omit jobId to list jobs.
- cancel: {action:"cancel",jobId:"J-..."} cancels the owned process group and waits for cleanup.
- wait: {action:"wait",wakeAfterSeconds:60} must be called alone after resolving pending instructions; terminates the tool loop normally and schedules ONE check in 60 seconds. Omit wakeAfterSeconds to wait for active jobs. User input or a terminal job event wakes earlier. No busy polling or sleep loops.
With running jobs, finish your response to let the controller wait without spending continuation budget. A timer/completion wake consumes one automatic continuation. Pause/Escape stops model work and timers but preserves jobs. Stop/shutdown/reload cancels jobs and timers. A succeeded process still requires artifact verification and checklist acceptance. Active jobs prevent acceptance, skipping, replanning or changing the goal. Failed/interrupted jobs are never automatically restarted.`;
