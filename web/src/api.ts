export interface UserSettings {
  profile: { name: string; avatar: string };
  general: { theme: 'light' | 'dark' | 'system' };
  providers: { id: string; name: string; configured: boolean }[];
}
import type {
  Attachment,
  ConfigKey,
  ConfigResponse,
  Health,
  MessageQuote,
  ModelOption,
  ResearchSession,
  SessionSummary,
  SingleConfigResponse,
  ThinkingLevel,
} from '../shared/types';
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/api' + path, {
    ...options,
    headers: {
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options?.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data as T;
}
const post = <T>(path: string, body = {}) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const api = {
  userSettings: () => request<UserSettings>('/settings/user'),
  saveUserSettings: (settings: {
    profile: UserSettings['profile'];
    general: UserSettings['general'];
    apiKeys: Record<string, string>;
  }) => request<UserSettings>('/settings/user', { method: 'PUT', body: JSON.stringify(settings) }),
  health: () => request<Health>('/health'),
  sessions: () => request<SessionSummary[]>('/sessions'),
  session: (id: string) => request<ResearchSession>(`/sessions/${id}`),
  create: () => post<ResearchSession>('/sessions'),
  send: (
    id: string,
    text: string,
    attachments: Attachment[],
    quote?: MessageQuote,
    quotes?: MessageQuote[],
  ) => post<ResearchSession>(`/sessions/${id}/messages`, { text, attachments, quote, quotes }),
  command: (id: string, command: string) =>
    post<ResearchSession>(`/sessions/${id}/commands`, { command }),
  stop: (id: string) => post<ResearchSession>(`/sessions/${id}/stop`),
  edit: (id: string, messageId: string, text: string) =>
    post<ResearchSession>(`/sessions/${id}/messages/${messageId}/edit`, { text }),
  retry: (id: string, toolId: string) =>
    post<ResearchSession>(`/sessions/${id}/tools/${toolId}/retry`),
  answer: (id: string, questionId: string, value: string) =>
    post(`/sessions/${id}/questions/${questionId}`, { value }),
  rename: (id: string, title: string) =>
    request<ResearchSession>(`/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  delete: (id: string) => request<{ ok: boolean }>(`/sessions/${id}`, { method: 'DELETE' }),
  upload: async (id: string, files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append('files', file);
    return request<Attachment[]>(`/sessions/${id}/uploads`, { method: 'POST', body: form });
  },
  preview: (id: string, path: string) =>
    request<{ text: string }>(`/sessions/${id}/files/preview?path=${encodeURIComponent(path)}`),
  download: (id: string, path = '') =>
    `/api/sessions/${id}/files/download?path=${encodeURIComponent(path)}`,
  // Config APIs
  getConfigs: (id: string) => request<ConfigResponse>(`/sessions/${id}/config`),
  getConfig: (id: string, key: ConfigKey) =>
    request<SingleConfigResponse>(`/sessions/${id}/config/${key}`),
  putConfig: (id: string, key: ConfigKey, value: Record<string, unknown>) =>
    request<SingleConfigResponse>(`/sessions/${id}/config/${key}`, {
      method: 'PUT',
      body: JSON.stringify(value),
    }),
  deleteConfig: (id: string, key: ConfigKey) =>
    request<SingleConfigResponse>(`/sessions/${id}/config/${key}`, { method: 'DELETE' }),
  // Model and thinking level APIs
  getModels: () => request<{ models: ModelOption[] }>('/models'),
  setModel: (id: string, model: string) =>
    post<ResearchSession>(`/sessions/${id}/model`, { model }),
  setThinkingLevel: (id: string, level: ThinkingLevel) =>
    post<ResearchSession>(`/sessions/${id}/thinking-level`, { level }),
};
