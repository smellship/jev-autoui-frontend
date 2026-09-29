/** 与 ui_backend 的 REST 形状一一对应（见 ui_backend/app/api/serializers.py）。 */

export interface User {
  id: number
  account: string
  name: string
  active: boolean
  is_admin: boolean
  created_at: string
}

export interface LoginResult {
  token: string
  expires_in: number
  user: User
}

export interface Node {
  id: number
  parent_id: number | null
  name: string
  sort: number
  description: string
  children: Node[]
}

export type Priority = 'P0' | 'P1' | 'P2' | 'P3'
export type Mode = 'debug' | 'ci'
export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'aborted' | 'unverified' | 'error'
export type EnvAuth = 'unknown' | 'none' | 'login_form'

export interface RunBrief {
  id: string
  case_id: string
  case_name: string
  scenario_name: string
  env: string
  mode: Mode
  batch_code: string
  status: RunStatus
  kernel_status: string
  detail: string
  steps: number
  created_at: string | null
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  triggered_by: string
  queue_position: number | null
  report_url: string
  events_url: string
}

export interface Scenario {
  id: string
  node_id: number
  name: string
  priority: Priority
  owner: string
  tags: string[]
  description: string
  env_id: number | null
  case_count: number
  last_run: RunBrief | null
}

export interface CaseBrief {
  id: string
  scenario_id: number
  name: string
  priority: Priority
  tags: string[]
  owner: string
  version: number
  updated_by: string
  updated_at: string | null
  last_run: RunBrief | null
  yaml_text?: string
}

export interface CaseDetail extends CaseBrief {
  yaml_text: string
  scenario_code: string
  scenario_name: string
}

/** 全局用例列表项（场景管理用例池）：case_brief + 场景名。 */
export interface CaseListItem extends CaseBrief {
  scenario_code: string
  scenario_name: string
}

export interface Suite {
  id: string
  name: string
  owner: string
  tags: string[]
  description: string
  case_count: number
  last_batch: BatchSummary | null
  created_at: string | null
  updated_at: string | null
}

export interface SuiteDetail extends Suite {
  items: CaseListItem[]
  missing: Array<{ id: string; name: string }>
}

export type BatchCounts = Record<RunStatus, number>

/** 批次汇总（从同 batch_code 的运行台账推导）。 */
export interface BatchSummary {
  code: string
  label: string
  suite_id: string | null
  env: string
  mode: Mode
  triggered_by: string
  created_at: string | null
  total: number
  done: boolean
  counts: BatchCounts
}

export interface BatchBrief extends BatchSummary {
  current: RunBrief | null
  items: RunBrief[]
}

export interface CheckResult {
  kind: string
  expected: string
  ok: boolean
  evidence: string
}

export interface StepResult {
  index: number
  attempt: number
  goal: string
  dir: string
  status: string
  status_label: string
  detail: string
  decisions: number
  checks: CheckResult[]
  defects: string[]
  replan: unknown[]
}

export interface Artifact {
  path: string
  size: number
  kind: 'screenshot' | 'snapshot' | 'report' | 'trace' | 'summary' | 'actions' | 'plan' | 'log' | 'other'
  url: string
}

export interface RunDetail extends RunBrief {
  checks: CheckResult[]
  steps_detail: StepResult[]
  defect_candidates: string[]
  plan: Record<string, unknown> | null
  artifacts: Artifact[]
  report_exists: boolean
}

export interface LintItem {
  line: number
  code: string
  message: string
}

export interface CompileResult {
  ok: boolean
  errors: LintItem[]
  warnings: LintItem[]
  plan: Record<string, unknown> | null
  env: string
}

export interface DraftResult {
  id: string
  yaml_text: string
  warnings: LintItem[]
  meta: Record<string, unknown>
}

/** 老脚本导入报告（后端 app/importers/midscene.py 的 Report.as_dict）。 */
export interface ImportReport {
  steps: number
  checks: number
  explicit: number
  lookahead: number
  fallback: number
  vars: string[]
  issues: string[]
  notes: string[]
}

export interface ImportResult {
  id: string
  yaml_text: string
  report: ImportReport
}

export interface VersionRow {
  version: number
  comment: string
  author: string
  created_at: string | null
  size: number
}

export interface VersionDetail {
  version: number
  yaml_text: string
  comment: string
  author: string
  created_at: string | null
}

export interface SaveResult {
  id: string
  name: string
  version: number
  steps: number
  warnings: LintItem[]
}

export interface EnvSecretKey {
  key: string
  set: boolean
}

export interface ProbeResult {
  env: string
  input_url: string
  final_url: string
  title: string
  element_count: number
  needs_login: boolean | null
  has_password_field: boolean | null
  at: string
}

export interface Env {
  id: number
  name: string
  label: string
  base_url: string
  configured: boolean
  auth: EnvAuth
  secret_keys: EnvSecretKey[]
  timeout_ms: number
  extra: Record<string, unknown>
  note: string
  last_probe: ProbeResult | null
  updated_at: string | null
}

export interface PageRow {
  url: string
  title: string
  needs_login: boolean | null
  first_seen: string | null
  last_seen: string | null
  source_case_id: number | null
}

/** 聚合 trace.jsonl 的一行（内核产出，平台原样透传）。 */
export interface TraceRow {
  step?: number
  plan_step?: number
  time?: string
  url?: string
  title?: string
  operation?: string
  target?: string
  target_element?: { index?: number; role?: string; name?: string } | string
  confidence?: number
  latency_ms?: number
  signal?: { kind?: string; detail?: string } | null
  supervisor?: Record<string, unknown> | null
  page_facts?: Array<Record<string, unknown>>
  click_failures?: number
  text_model?: string
  upload?: Record<string, unknown>
  action?: {
    ok?: boolean
    changed?: boolean
    level?: string
    detail?: string
    reason?: string
    warning?: string
    attempts?: string[][]
    occluded_by?: string
    trace?: { ok?: boolean; changed?: boolean; level?: string; reason?: string }
  }
  [key: string]: unknown
}

export interface Page<T> {
  items: T[]
  total: number
  page?: number
  size?: number
}
