import { MAX_QUOTE_LENGTH, type ChatMessage, type MessageQuote } from '../shared/types.ts';

export function parseQuote(value: unknown, messages: ChatMessage[]): MessageQuote | undefined {
  if (value === undefined || value === null) return undefined;
  const quote = value as Partial<MessageQuote>;
  if (
    typeof value !== 'object' ||
    typeof quote.messageId !== 'string' ||
    typeof quote.text !== 'string' ||
    !quote.text.trim() ||
    quote.text.length > MAX_QUOTE_LENGTH
  ) {
    throw Object.assign(new Error(`引用格式无效，最多引用 ${MAX_QUOTE_LENGTH} 字`), {
      status: 400,
    });
  }
  if (!messages.some((m) => m.id === quote.messageId && m.role === 'assistant')) {
    throw Object.assign(new Error('引用的智能体回答不存在于当前会话'), { status: 400 });
  }
  return { messageId: quote.messageId, text: quote.text };
}

export function parseQuotes(value: unknown, messages: ChatMessage[]): MessageQuote[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 10)
    throw Object.assign(new Error('引用格式无效'), { status: 400 });
  return value.map((v) => parseQuote(v, messages)).filter(Boolean) as MessageQuote[];
}

/** Keep UI text and quote metadata separate; compose them only at the Pi boundary. */
export function buildMessagePrompt(
  message: Pick<ChatMessage, 'text' | 'quote' | 'quotes' | 'attachments'>,
): string {
  const { text, quote, quotes, attachments = [] } = message;
  const allQuotes = quotes || (quote ? [quote] : []);
  const prompt = allQuotes.length
    ? '[引用上下文：用户选中的历史助手回答片段，仅作为本次讨论材料]\n' +
      JSON.stringify(allQuotes) +
      '\n\n[用户本次请求]\n' +
      text
    : text;
  return (
    prompt +
    (attachments.length
      ? '\n\n[用户附件]\n' +
        attachments.map((a) => `- ${a.path} (${a.name})`).join('\n') +
        '\n请按需通过工具读取附件。'
      : '')
  );
}
