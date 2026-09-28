import type { Mode, Priority, RunStatus } from '@/api/types'

export const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3']

const RUN_STATUS_TEXT: Record<RunStatus, string> = {
  queued: '排队中',
  running: '运行中',
  passed: '通过',
  failed: '失败',
  aborted: '中止',
  unverified: '未验收',
  error: '错误',
}

type TagType = 'success' | 'danger' | 'warning' | 'info' | 'primary'

const RUN_STATUS_TYPE: Record<RunStatus, TagType> = {
  queued: 'info',
  running: 'primary',
  passed: 'success',
  failed: 'danger',
  aborted: 'warning',
  unverified: 'info',
  error: 'danger',
}

export function runStatusText(status: string): string {
  return RUN_STATUS_TEXT[status as RunStatus] || status || '—'
}

export function runStatusType(status: string): TagType {
  return RUN_STATUS_TYPE[status as RunStatus] || 'info'
}

/** 内核状态词表（§4.3，锁死 10 个）→ 中文标签与颜色。 */
const STEP_STATUS: Record<string, [string, TagType]> = {
  ok: ['成功', 'success'],
  done_unverified: ['未验收', 'info'],
  check_failed: ['断言未过', 'danger'],
  blocked: ['受阻', 'warning'],
  stuck: ['卡住', 'warning'],
  budget: ['预算耗尽', 'warning'],
  replanned: ['已重排', 'info'],
  skipped: ['未执行', 'info'],
  aborted: ['中止', 'warning'],
  error: ['错误', 'danger'],
}

export function stepStatusText(status: string): string {
  return STEP_STATUS[status]?.[0] || status || '—'
}

export function stepStatusType(status: string): TagType {
  return STEP_STATUS[status]?.[1] || 'info'
}

/** 步骤 chip 的样式类：与视觉稿一致（passed/failed/running/skipped）。 */
export function stepChipClass(status: string): string {
  if (status === 'ok') return 'passed'
  if (status === 'skipped') return 'skipped'
  if (['check_failed', 'blocked', 'stuck', 'budget', 'error', 'aborted'].includes(status)) return 'failed'
  return ''
}

export const MODE_TEXT: Record<Mode, string> = { debug: 'debug', ci: 'ci' }

export function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const text = value.replace('T', ' ')
  return text.length >= 16 ? text.slice(5, 16) : text
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return value.replace('T', ' ').slice(0, 19)
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  const total = Math.round(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function shortTime(at?: string | null): string {
  if (!at) return ''
  return new Date(at).toLocaleTimeString('zh-CN', { hour12: false })
}
