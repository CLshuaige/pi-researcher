import {
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";

/** One cleanup path; callers retain their own orchestration and shutdown policy. */
export async function closePiSession(
  session: AgentSession,
  unsubscribe: () => void,
  reason: "quit" | "reload" | "new" | "resume" | "fork" = "quit",
  notify = true,
  settle?: () => Promise<unknown> | undefined,
) {
  try {
    if (notify)
      await session.extensionRunner.emit({ type: "session_shutdown", reason });
    await session.abort();
    await settle?.();
  } finally {
    unsubscribe();
    session.dispose();
  }
}
export async function createManagedSession(
  options: NonNullable<Parameters<typeof createAgentSession>[0]>,
  lifecycle: {
    signal?: AbortSignal;
    onEvent?: (event: AgentSessionEvent) => void;
  } = {},
) {
  lifecycle.signal?.throwIfAborted();
  const created = await createAgentSession(options);
  const { session } = created;
  const abort = () => { void session.abort().catch(() => {}); };
  const unsubscribe = session.subscribe(event => {
    if (event.type === 'agent_start' && lifecycle.signal?.aborted) abort();
    lifecycle.onEvent?.(event);
  });
  lifecycle.signal?.addEventListener('abort', abort, { once: true });
  if (lifecycle.signal?.aborted) {
    lifecycle.signal.removeEventListener("abort", abort);
    await closePiSession(session, unsubscribe, "quit", false);
    lifecycle.signal.throwIfAborted();
  }
  let closing: Promise<void> | undefined;
  return {
    ...created,
    close(
      reason: "quit" | "reload" | "new" | "resume" | "fork" = "quit",
      notify = true,
    ) {
      return (closing ??= (async () => {
        lifecycle.signal?.removeEventListener("abort", abort);
        await closePiSession(session, unsubscribe, reason, notify);
      })());
    },
  };
}
