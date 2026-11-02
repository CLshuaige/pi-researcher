import copy from 'copy-to-clipboard';

export async function copyText(text: string): Promise<void> {
  const copied = await copy(text, { format: 'text/plain' });
  if (!copied) throw new Error('无法访问剪贴板，请手动选择文字复制');
}
