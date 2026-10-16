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

/** 用例级互斥挡位：none=不限制；env=同环境串行；account=同环境同账号串行（解析不到账号时降级为 env）。 */
export type MutexLevel = 'none' | 'env' | 'account'

/**
 * 运行策略（提交时快照，存档在运行台账上）：
 * decider/supervisor 是两个模型开关的规范形（jev+监督=全开；llm+监督=只开大模型；
 * jev 无监督=只开 Jev；off 无监督=全关零模型）；cache/cache_strict=回放缓存与严判。
 * 老台账没有快照（空对象）时按默认「全开」对待。
 */
export interface RunPolicy {
  decider: 'jev' | 'llm' | 'off'
  supervisor: boolean
  cache: boolean
  cache_strict: boolean
}

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
  user_id: number | null
  queue_position: number | null
  mutex: MutexLevel
  policy?: Partial<RunPolicy>
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
  created_by: string
  updated_by: string
  updated_at: string | null
}

export interface CaseBrief {
  id: string
  scenario_id: number
  name: string
  priority: Priority
  tags: string[]
  owner: string
  version: number
  mutex: MutexLevel
  created_by: string
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
  attempts?: number
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
  /** 互斥降级提示：账号挡但没解析到账号时为非空文案，其余为空串。 */
  mutex_note: string
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

/** 模型 API Key 状态（管理员设置页）：值只写不读，只回是否已设置与来源。 */
export interface ModelKeyStatus {
  key: string
  label: string
  hint: string
  env_name: string
  set: boolean
  source: 'file' | 'env' | null
}

/** 模型端点配置（管理员设置页）：地址/模型名非秘密、可回显；file > 服务器 env > 内核默认。 */
export interface ModelEndpointStatus {
  key: string
  env_name: string
  group: 'text' | 'typesafe'
  field: 'base_url' | 'model'
  label: string
  value: string
  source: 'file' | 'env' | null
  default: string
}

/** 并行调度设置（管理员设置页）：max=全局并行上限（硬上限 hard_max=8），k=每人最多路数。 */
export interface RunSettings {
  pending: number
  running: number
  pool: number
  max: number
  k: number
  concurrency: number
  hard_max: number
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

export interface ProfileSlot {
  slot: string
  size: number
  path: string
}

/** trace.jsonl 分层行类型：生命周期 / 逐决策 / 断言 / 模型调用 / 回放缓存。旧产物没有 kind，按决策行对待。 */
export type TraceRowKind =
  | 'run_start'
  | 'run_end'
  | 'step_start'
  | 'step_end'
  | 'decision'
  | 'assert'
  | 'model'
  | 'cache'

/** 聚合 trace.jsonl 的一行（内核产出，平台原样透传）。 */
export interface TraceRow {
  kind?: TraceRowKind
  seq?: number
  at?: string
  plan_step?: number
  step?: number
  time?: string
  url?: string
  title?: string
  operation?: string
  target?: string
  target_element?: { index?: number; role?: string; name?: string } | string
  confidence?: number
  latency_ms?: number
  signal?: { kind?: string; detail?: string } | null
  supervisor?: boolean | Record<string, unknown> | null
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
  // 生命周期行
  goal?: string
  attempt?: number
  status?: string
  status_label?: string
  detail?: string
  decisions?: number
  mode?: string
  headless?: boolean
  viewport?: string
  steps?: number
  duration_s?: number
  defects?: number
  vars?: string[]
  decision_model?: string
  // 断言行
  ok?: boolean
  attempts?: number
  elapsed_ms?: number
  checks?: CheckResult[]
  // 模型行
  stage?: string
  model?: string
  error?: string
  // 回放缓存行（kind="cache"，mode 复用上面的 mode 字段）
  write?: string
  hits?: number
  misses?: number
  miss_reasons?: Record<string, number>
  kept_steps?: number
  saved_steps?: number
  no_change_steps?: number
  evicted_steps?: number
  dropped_steps?: number
  [key: string]: unknown
}

export interface Page<T> {
  items: T[]
  total: number
  page?: number
  size?: number
}
