/** Project all provider-visible thinking blocks, preserving their order. */
export function thinkingText(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const blocks = content.filter(
    (block) => block?.type === 'thinking' && typeof block.thinking === 'string',
  );
  return blocks.length ? blocks.map((block) => block.thinking).join('\n\n') : undefined;
}
