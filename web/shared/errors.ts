/** Translate service failures without changing research documents or raw execution logs. */
export function readableError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value || '操作未完成');
  if (
    /this operation was aborted|the operation was aborted|command aborted|^AbortError/i.test(text)
  )
    return '操作已取消，可继续研究。';
  if (/no api key|api key.*(?:missing|not configured)/i.test(text))
    return '模型密钥尚未配置，请在用户设置中填写 API Key。';
  if (/arrears|欠费|insufficient.*(?:balance|quota)|credit balance.*low/i.test(text))
    return '模型服务账户余额不足或已停用，请恢复账户或切换可用模型后重试。';
  if (/\b401\b|invalid api key|unauthorized|authentication (?:failed|error)/i.test(text))
    return '模型认证失败，请检查 API Key。';
  if (/rate limit|too many requests/i.test(text)) return '服务请求过于频繁，请稍后再试。';
  if (/failed to fetch|fetch failed|ECONNREFUSED|ECONNRESET|network error/i.test(text))
    return '连接暂时中断，请检查网络后重试。';
  if (/timed?\s*out|TimeoutError/i.test(text)) return '请求等待超时，请稍后重试。';
  return text;
}
