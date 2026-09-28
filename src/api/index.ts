import { del, get, patch, post, put } from '@/api/client'
import type {
  CaseBrief,
  CaseDetail,
  CompileResult,
  DraftResult,
  Env,
  ImportResult,
  LoginResult,
  Node,
  Page,
  PageRow,
  ProbeResult,
  RunBrief,
  RunDetail,
  SaveResult,
  Scenario,
  User,
  VersionDetail,
  VersionRow,
} from '@/api/types'

export const authApi = {
  login: (account: string, password: string) =>
    post<LoginResult>('/auth/login', { account, password }),
  me: () => get<User>('/auth/me'),
  updateMe: (name: string) => patch<User>('/auth/me', { name }),
  changePassword: (oldPassword: string, newPassword: string) =>
    put<{ ok: boolean }>('/auth/password', { old_password: oldPassword, new_password: newPassword }),
}

/** 管理员才有权限的用户管理（后端口径：非管理员一律 403）。 */
export const userApi = {
  list: () => get<{ items: User[] }>('/users'),
  create: (body: { account: string; name: string; password: string }) => post<User>('/users', body),
  update: (id: number, body: { name?: string; active?: boolean; is_admin?: boolean }) =>
    patch<User>(`/users/${id}`, body),
  resetPassword: (id: number, password: string) => post<{ ok: boolean }>(`/users/${id}/password`, { password }),
}

export const nodeApi = {
  tree: () => get<{ items: Node[] }>('/nodes'),
  create: (body: { parent_id?: number | null; name: string; sort?: number; description?: string }) =>
    post<Node>('/nodes', body),
  update: (id: number, body: { name?: string; parent_id?: number; sort?: number; description?: string }) =>
    patch<Node>(`/nodes/${id}`, body),
  remove: (id: number) => del(`/nodes/${id}`),
}

export const scenarioApi = {
  list: (params: { node_id?: number; q?: string } = {}) => get<Page<Scenario>>('/scenarios', params),
  create: (body: {
    node_id: number
    name: string
    priority: string
    owner?: string
    tags?: string[]
    description?: string
    env_id?: number | null
  }) => post<Scenario>('/scenarios', body),
  detail: (id: string) => get<Scenario>(`/scenarios/${id}`),
  update: (id: string, body: Record<string, unknown>) => patch<Scenario>(`/scenarios/${id}`, body),
  remove: (id: string, cascade = false) => del(`/scenarios/${id}`, cascade ? { cascade: true } : undefined),
  cases: (id: string) => get<{ items: CaseBrief[]; total: number }>(`/scenarios/${id}/cases`),
  createCase: (id: string, body: { name: string; priority?: string; owner?: string; template?: string; copy_from?: string }) =>
    post<CaseBrief>(`/scenarios/${id}/cases`, body),
}

export const caseApi = {
  detail: (id: string) => get<CaseDetail>(`/cases/${id}`),
  save: (id: string, body: { yaml_text: string; version: number; comment?: string }) =>
    put<SaveResult>(`/cases/${id}`, body),
  validate: (id: string, yaml_text?: string) =>
    post<CompileResult>(`/cases/${id}/validate`, yaml_text === undefined ? {} : { yaml_text }),
  draft: (id: string, desc: string, url = '') => post<DraftResult>(`/cases/${id}/drafts`, { desc, url }),
  importMidscene: (id: string, script_text: string, keep_url = false) =>
    post<ImportResult>(`/cases/${id}/imports`, { script_text, keep_url }),
  versions: (id: string) =>
    get<{ current_version: number; items: VersionRow[]; total: number }>(`/cases/${id}/versions`),
  version: (id: string, version: number) => get<VersionDetail>(`/cases/${id}/versions/${version}`),
  rollback: (id: string, version: number) => post<SaveResult>(`/cases/${id}/rollback`, { version }),
  copy: (id: string, body: { name?: string; scenario_id?: string } = {}) =>
    post<CaseBrief>(`/cases/${id}/copy`, body),
  remove: (id: string) => del(`/cases/${id}`),
}

export const envApi = {
  list: () => get<{ items: Env[] }>('/envs'),
  detail: (id: number) => get<Env>(`/envs/${id}`),
  create: (body: Record<string, unknown>) => post<Env>('/envs', body),
  update: (id: number, body: Record<string, unknown>) => patch<Env>(`/envs/${id}`, body),
  remove: (id: number) => del(`/envs/${id}`),
  putSecrets: (id: number, body: { base_url?: string; secrets: Record<string, string> }) =>
    put<Env>(`/envs/${id}/secrets`, body),
  delSecret: (id: number, key: string) => del(`/envs/${id}/secrets/${encodeURIComponent(key)}`),
  probe: (id: number, url = '') => post<ProbeResult>(`/envs/${id}/probe`, { url }),
  pages: (id: number) => get<{ items: PageRow[]; total: number }>(`/envs/${id}/pages`),
}

export const runApi = {
  create: (body: { case_id: string; env_id: number; mode: string }) => post<RunBrief>('/runs', body),
  list: (params: Record<string, unknown> = {}) => get<Page<RunBrief>>('/runs', params),
  detail: (id: string) => get<RunDetail>(`/runs/${id}`),
  stop: (id: string) => post<RunBrief>(`/runs/${id}/stop`),
  rebuildReport: (id: string) => post<{ report: string; exists: boolean }>(`/runs/${id}/report`),
}

export const healthApi = {
  health: () => get<Record<string, unknown>>('/health'),
}

/** 产物 URL 加 token 查询串供 <img>/<a> 直接使用（后端只认 Bearer 头，这里走同源下载代理）。 */
export function artifactUrl(url: string): string {
  return url
}
