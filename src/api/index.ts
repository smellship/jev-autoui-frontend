import { del, get, patch, post, put } from '@/api/client'
import type {
  BatchBrief,
  CaseBrief,
  CaseDetail,
  CaseListItem,
  CompileResult,
  DraftResult,
  Env,
  ImportResult,
  LoginResult,
  ModelKeyStatus,
  Node,
  Page,
  PageRow,
  ProbeResult,
  RunBrief,
  RunDetail,
  SaveResult,
  Scenario,
  Suite,
  SuiteDetail,
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

/** 模型 API Key（仅管理员）：只写不读，值落 secrets/，保存后对后续内核调用生效。 */
export const settingsApi = {
  modelKeys: () => get<{ items: ModelKeyStatus[] }>('/settings/model-keys'),
  saveModelKeys: (body: Record<string, string | null>) =>
    put<{ items: ModelKeyStatus[]; changed: string[] }>('/settings/model-keys', body),
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
  /** 全局用例池（场景管理）：可按节点（含子孙）/场景/关键字过滤。 */
  list: (params: { node_id?: number; scenario_id?: string; q?: string; page?: number; size?: number } = {}) =>
    get<Page<CaseListItem>>('/cases', params),
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

export const suiteApi = {
  list: (params: { q?: string; page?: number; size?: number } = {}) => get<Page<Suite>>('/suites', params),
  create: (body: { name: string; owner?: string; tags?: string[]; description?: string }) =>
    post<Suite>('/suites', body),
  detail: (id: string) => get<SuiteDetail>(`/suites/${id}`),
  update: (id: string, body: Record<string, unknown>) => patch<Suite>(`/suites/${id}`, body),
  remove: (id: string) => del(`/suites/${id}`),
  copy: (id: string, name?: string) => post<Suite>(`/suites/${id}/copy`, name ? { name } : {}),
  setCases: (id: string, caseIds: string[]) =>
    put<{ id: string; count: number }>(`/suites/${id}/cases`, { case_ids: caseIds }),
  run: (id: string, body: { env_id: number; mode?: string }) => post<BatchBrief>(`/suites/${id}/run`, body),
}

export const batchApi = {
  create: (body: { case_ids: string[]; env_id: number; mode?: string }) => post<BatchBrief>('/batches', body),
  detail: (code: string) => get<BatchBrief>(`/batches/${code}`),
  stop: (code: string) => post<{ id: string; status: string; aborted: number }>(`/batches/${code}/stop`),
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
