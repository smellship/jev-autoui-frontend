<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import SnapshotViewer from '@/components/SnapshotViewer.vue'
import type { Artifact, RunDetail, StepResult, TraceRow, TraceRowKind } from '@/api/types'
import { fetchArtifactText } from '@/utils/artifact'

const props = defineProps<{ run: RunDetail; live?: TraceRow[] }>()

/** actions.json 里的一行（RecentAction）：给 trace 行补目标文字与"页面是否变化"。 */
interface ActionRow {
  action?: string
  kind?: string
  text?: string
  level?: string
  page_changed?: boolean | null
  step?: number
}

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'failed', label: '失败' },
  { key: 'degraded', label: '降级' },
  { key: 'supervised', label: '监督介入' },
]

const LIFE_LABELS: Record<string, string> = {
  run_start: '运行开始',
  run_end: '运行结束',
  step_start: '步骤开始',
  step_end: '步骤结束',
}

/** 回放缓存运行级行（kind="cache"）词表：口径见内核 run/trace.py 的模块注释。 */
const CACHE_MODES: Record<string, string> = {
  'self-finalized': '断言收尾（结论可信）',
  'agent-concluded': '模型自称完成（不写缓存）',
  missed: '未走回放',
}
const CACHE_WRITES: Record<string, string> = {
  saved: '有更新已落盘',
  kept: '命中且原样保留',
  'no-change': '重录内容一致',
  unconfirmed: '暂存未获断言确认',
  evicted: '失败牵连的旧条目已淘汰',
  'not-written': '无可写内容',
}
const CACHE_MISSES: Record<string, string> = {
  'no-entry': '没有录像',
  'no-variant': '没有匹配起点的录像',
  'wrong-context': '页面上下文不符',
  'invalid-entry': '定位不到目标',
  truncated: '录像未收尾',
  retry: '回放未成立交还',
}

const KNOWN_KINDS: readonly string[] = ['decision', ...Object.keys(LIFE_LABELS), 'assert', 'model', 'cache']

/** 旧产物没有 kind（按决策行对待）；不认识的新行类型也回落到决策行，至少能看到原始 JSON。 */
function rowKind(row: TraceRow): TraceRowKind {
  const kind = row.kind || 'decision'
  return (KNOWN_KINDS.includes(kind) ? kind : 'decision') as TraceRowKind
}

function isDecision(row: TraceRow): boolean {
  return rowKind(row) === 'decision'
}

function isLifecycle(row: TraceRow): boolean {
  return rowKind(row) in LIFE_LABELS
}

function toggleRaw(key: number): void {
  rawOpen.value = { ...rawOpen.value, [key]: !rawOpen.value[key] }
}

const baseRows = ref<TraceRow[]>([])
const actions = ref(new Map<string, ActionRow>())
const loading = ref(false)
const loadError = ref('')
const filter = ref('all')
const showAll = ref(false)
const overrides = ref<Record<number, boolean>>({})
const rawOpen = ref<Record<number, boolean>>({})
const snapshot = ref<{ visible: boolean; url: string; title: string }>({
  visible: false,
  url: '',
  title: '',
})

const artifactIndex = computed(() => {
  const map = new Map<string, Artifact>()
  for (const item of props.run.artifacts || []) map.set(item.path, item)
  return map
})

const merged = computed<TraceRow[]>(() => {
  const base = baseRows.value
  const live = props.live || []
  // SSE 从头 tail 同一份 trace.jsonl：比已读部分长的尾巴才是新行
  return live.length > base.length ? [...base, ...live.slice(base.length)] : base
})

interface GroupRow {
  row: TraceRow
  key: number
}

interface Group {
  index: number
  goal: string
  status: string
  dir: string
  rows: GroupRow[]
  hasIssue: boolean
}

function stepMeta(index: number): StepResult | undefined {
  return (props.run.steps_detail || []).find((item) => item.index === index)
}

function rowMatches(row: TraceRow): boolean {
  const kind = rowKind(row)
  if (filter.value === 'failed') {
    if (kind === 'assert') return row.ok === false
    if (kind === 'model') return true
    return kind === 'decision' && (row.action || {}).ok === false
  }
  if (kind !== 'decision') return filter.value === 'all'
  const action = row.action || {}
  if (filter.value === 'degraded') return ['L4', 'L5'].includes(String(action.level || ''))
  if (filter.value === 'supervised') return Boolean(row.supervisor || row.signal)
  return true
}

function rowIssue(row: TraceRow): boolean {
  const kind = rowKind(row)
  if (kind === 'assert') return row.ok === false
  if (kind === 'model') return true
  if (kind !== 'decision') return false
  const action = row.action || {}
  return action.ok === false || ['L4', 'L5'].includes(String(action.level || '')) ||
    Boolean(row.supervisor || row.signal)
}

const groups = computed<Group[]>(() => {
  const map = new Map<number, Group>()
  merged.value.forEach((row, key) => {
    // 真实内核带 plan_step；桩/旧产物只有逐决策的 step，回落到它，别全塞进「运行目录根」
    const index = Number(row.plan_step ?? row.step ?? 0)
    let group = map.get(index)
    if (!group) {
      const meta = stepMeta(index)
      group = {
        index,
        goal: meta?.goal || (index ? `步骤 ${index}` : '运行级事件'),
        status: meta?.status || '',
        dir: meta?.dir || '',
        rows: [],
        hasIssue: false,
      }
      map.set(index, group)
    }
    group.rows.push({ row, key })
    if (rowIssue(row)) group.hasIssue = true
  })
  return [...map.values()].sort((a, b) => a.index - b.index)
})

const visibleGroups = computed(() =>
  groups.value
    .map((group) => ({ ...group, shown: group.rows.filter((item) => rowMatches(item.row)) }))
    .filter((group) => group.shown.length > 0),
)

const totalShown = computed(() => visibleGroups.value.reduce((sum, group) => sum + group.shown.length, 0))

function isOpen(group: Group): boolean {
  const override = overrides.value[group.index]
  if (override !== undefined) return override
  return showAll.value || group.hasIssue
}

function toggle(group: Group): void {
  overrides.value = { ...overrides.value, [group.index]: !isOpen(group) }
}

function toggleAll(): void {
  showAll.value = !showAll.value
  overrides.value = {}
}

function actionOf(row: TraceRow): ActionRow | undefined {
  return actions.value.get(`${row.plan_step ?? 0}#${row.step ?? 0}`)
}

function targetText(row: TraceRow): string {
  const fromActions = actionOf(row)?.text || ''
  const element = row.target_element
  const fallback = fromActions || (typeof row.target === 'string' ? row.target : '') || '—'
  if (typeof element === 'string') return element || fallback
  const suffix = element
    ? `（${element.role || '元素'} idx=${element.index ?? '?'}${element.name ? ` · ${element.name}` : ''}）`
    : ''
  return `${fallback}${suffix}`
}

function confidence(row: TraceRow): string {
  const value = row.confidence
  return typeof value === 'number' ? value.toFixed(2) : '—'
}

function changed(row: TraceRow): string {
  const value = actionOf(row)?.page_changed
  if (value === true) return '↻'
  if (value === false) return '·'
  return ''
}

function lifecycleText(row: TraceRow): string {
  const kind = rowKind(row)
  const nth = (row.attempt ?? 1) > 1 ? `（第 ${row.attempt} 次）` : ''
  if (kind === 'run_start') {
    const parts = [row.mode || '', row.headless ? '无头' : '可视化', `视口 ${row.viewport || '—'}`]
    if (row.steps) parts.push(`计划 ${row.steps} 步`)
    if (row.decision_model) parts.push(`决策模型 ${row.decision_model}`)
    if (row.supervisor) parts.push('监督开')
    if (row.vars?.length) parts.push(`变量 ${row.vars.length} 个`)
    return parts.filter(Boolean).join(' · ')
  }
  if (kind === 'run_end') {
    return `${row.status_label || ''} · ${row.detail || ''} · 用时 ${row.duration_s ?? '—'}s · 缺陷 ${row.defects ?? 0}`
  }
  if (kind === 'step_start') return `${nth}${row.goal || ''}`
  if (kind === 'step_end') {
    return `${nth}${row.status_label || row.status || ''} · ${row.detail || ''} · 决策 ${row.decisions ?? 0} 次`
  }
  return ''
}

function cacheText(row: TraceRow): string {
  const mode = CACHE_MODES[String(row.mode || '')] || `模式 ${row.mode || '—'}`
  const write = CACHE_WRITES[String(row.write || '')] || `写入 ${row.write || '—'}`
  return `${mode} · 命中 ${row.hits ?? 0} 步 · 失配 ${row.misses ?? 0} 步 · ${write}`
}

function cacheFacts(row: TraceRow): string[] {
  const out: string[] = []
  const reasons = row.miss_reasons || {}
  const reasonText = Object.entries(reasons)
    .map(([key, count]) => `${CACHE_MISSES[key] || key}×${count}`)
    .join('、')
  if (reasonText) out.push(`失配原因：${reasonText}`)
  const counts: Array<[string, number]> = [
    ['写回', Number(row.saved_steps || 0)],
    ['命中保留', Number(row.kept_steps || 0)],
    ['重录一致', Number(row.no_change_steps || 0)],
    ['淘汰', Number(row.evicted_steps || 0)],
    ['丢弃', Number(row.dropped_steps || 0)],
  ]
  const steps = counts.filter(([, value]) => value > 0).map(([label, value]) => `${label} ${value} 步`)
  if (steps.length) out.push(`步骤明细：${steps.join(' · ')}`)
  return out
}

function snapshotUrl(row: TraceRow, dir: string): string {
  if (row.step === undefined || row.step === null) return ''
  const name = String(row.step).padStart(3, '0')
  const path = dir ? `steps/${dir}/snapshots/${name}.json` : `snapshots/${name}.json`
  return artifactIndex.value.get(path)?.url || ''
}

function openSnapshot(row: TraceRow, dir: string): void {
  const url = snapshotUrl(row, dir)
  if (!url) return
  snapshot.value = { visible: true, url, title: `决策 #${row.step} 的快照（喂给模型的那份 state）` }
}

function facts(row: TraceRow): string[] {
  const out: string[] = []
  for (const fact of row.page_facts || []) {
    if (fact.fact === 'tab') out.push(`⇢ 新标签：${fact.note ?? ''}`)
    else if (fact.fact === 'dialog') {
      out.push(`⇢ 原生 ${fact.kind ?? ''} 对话框：「${fact.message ?? ''}」→ ${fact.handled ?? ''}`)
    } else out.push(`⇢ ${JSON.stringify(fact)}`)
  }
  if (row.signal) out.push(`信号 ${row.signal.kind || ''}：${row.signal.detail || ''}`)
  const supervisor = row.supervisor
  if (supervisor && typeof supervisor === 'object') {
    if (supervisor.ruling) out.push(`监督 ${supervisor.ruling}：${supervisor.label || ''}`)
    else out.push(`监督不可用：${supervisor.error || ''}`)
  }
  const textMeta = row.text_model as { source?: string; key?: string; model?: string } | undefined
  if (textMeta) {
    out.push(`文本值来源：${textMeta.source || ''} ${textMeta.key || textMeta.model || ''}`)
  }
  const upload = row.upload as { key?: string; files?: Array<{ name?: string; size?: number }> } | undefined
  if (upload) {
    const files = (upload.files || []).map((file) => `${file.name}（${file.size ?? 0} B）`).join('、')
    out.push(`上传 ← 变量 ${upload.key || ''}：${files}`)
  }
  const warning = (row.action || {}).warning
  if (warning) out.push(`⚠ ${warning}`)
  return out
}

async function loadActions(): Promise<void> {
  const map = new Map<string, ActionRow>()
  const targets: Array<{ path: string; planStep: number }> = []
  for (const step of props.run.steps_detail || []) {
    if (step.dir) targets.push({ path: `steps/${step.dir}/actions.json`, planStep: step.index })
  }
  if (artifactIndex.value.has('actions.json')) targets.push({ path: 'actions.json', planStep: 0 })
  await Promise.all(
    targets.map(async (target) => {
      const artifact = artifactIndex.value.get(target.path)
      if (!artifact) return
      try {
        const rows = JSON.parse(await fetchArtifactText(artifact.url)) as ActionRow[]
        for (const row of rows || []) {
          if (typeof row?.step !== 'number') continue
          if (['PAGE', 'CHECK_FAILED'].includes(String(row.action))) continue
          map.set(`${target.planStep}#${row.step}`, row)
        }
      } catch {
        // 单步 actions.json 读不到就少一点补充信息，不该拦住日志本身
      }
    }),
  )
  actions.value = map
}

async function loadTrace(): Promise<void> {
  const artifact = artifactIndex.value.get('trace.jsonl')
  if (!artifact) return
  loading.value = true
  loadError.value = ''
  try {
    const text = await fetchArtifactText(artifact.url)
    baseRows.value = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as TraceRow
        } catch {
          return null
        }
      })
      .filter((row): row is TraceRow => row !== null)
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
  await loadActions()
}

onMounted(loadTrace)
watch(() => props.run.id, loadTrace)
</script>

<template>
  <div>
    <div class="run-bar" style="margin-bottom: 8px">
      <div class="filters" style="margin: 0">
        <span
          v-for="item in FILTERS"
          :key="item.key"
          class="f"
          :class="{ active: filter === item.key }"
          @click="filter = item.key"
        >
          {{ item.label }}
        </span>
      </div>
      <span class="muted">共 {{ merged.length }} 行事件{{ totalShown !== merged.length ? ` · 筛选后 ${totalShown}` : '' }}</span>
      <el-button size="small" text @click="toggleAll">{{ showAll ? '全部收起' : '全部展开' }}</el-button>
    </div>

    <el-alert v-if="loadError" type="error" :closable="false" :title="`决策日志读取失败：${loadError}`" style="margin-bottom: 8px" />
    <div v-loading="loading">
      <el-alert
        v-if="!loading && !merged.length"
        type="info"
        :closable="false"
        title="还没有事件行：运行未开始、已入队，或这次运行没有产物目录"
      />
      <div
        v-for="group in visibleGroups"
        :key="group.index"
        class="panel"
        style="margin-bottom: 8px"
      >
        <div class="panel-head" style="cursor: pointer" @click="toggle(group)">
          <span class="caret muted">{{ isOpen(group) ? '▾' : '▸' }}</span>
          <span class="title">{{ group.index ? `步骤 ${group.index} · ` : '' }}{{ group.goal }}</span>
          <span v-if="group.status" class="muted">{{ group.status }}</span>
          <span class="muted">{{ group.shown.length }} 行</span>
          <span v-if="group.hasIssue" class="muted" style="color: #f56c6c">有失败/降级/升级</span>
        </div>

        <div v-if="isOpen(group)" class="logbox" style="border: 0; max-height: 460px">
          <template v-for="item in group.shown" :key="item.key">
            <div v-if="isDecision(item.row)" class="logline">
              <span class="lstep">#{{ item.row.step }}</span>
              <span class="op-tag" :class="`op-${item.row.operation || 'OTHER'}`">
                {{ item.row.operation || '—' }}
              </span>
              <span class="ltarget">{{ targetText(item.row) }}</span>
              <span class="conf">conf {{ confidence(item.row) }}</span>
              <span v-if="item.row.action" :class="item.row.action.ok ? 'res-ok' : 'res-no'">
                {{ item.row.action.ok ? '✓' : '✗' }} {{ item.row.action.detail || '' }}
              </span>
              <span class="muted">{{ changed(item.row) }}</span>
              <span v-if="item.row.action?.level" class="ladder">
                阶梯{{ item.row.action.level }}
              </span>
              <span class="ms">{{ item.row.latency_ms ?? 0 }}ms</span>
              <button
                v-if="snapshotUrl(item.row, group.dir)"
                class="snap"
                title="看这次决策当时喂给模型的 state"
                @click="openSnapshot(item.row, group.dir)"
              >
                快照
              </button>
              <el-button size="small" text @click="toggleRaw(item.key)">
                {{ rawOpen[item.key] ? '收起' : '原始' }}
              </el-button>
            </div>
            <div v-else-if="isLifecycle(item.row)" class="logline life">
              <span class="kind-tag">{{ LIFE_LABELS[rowKind(item.row)] }}</span>
              <span class="ltarget">{{ lifecycleText(item.row) }}</span>
              <el-button size="small" text @click="toggleRaw(item.key)">
                {{ rawOpen[item.key] ? '收起' : '原始' }}
              </el-button>
            </div>
            <div v-else-if="rowKind(item.row) === 'assert'" class="logline">
              <span class="kind-tag">断言</span>
              <span :class="item.row.ok ? 'res-ok' : 'res-no'">
                {{ item.row.ok ? '✓ 验收通过' : '✗ 验收未通过' }}
              </span>
              <span class="muted">
                轮询 {{ item.row.attempts ?? 1 }} 轮 · {{ item.row.elapsed_ms ?? 0 }}ms
              </span>
              <el-button size="small" text @click="toggleRaw(item.key)">
                {{ rawOpen[item.key] ? '收起' : '原始' }}
              </el-button>
            </div>
            <div v-else-if="rowKind(item.row) === 'cache'" class="logline life">
              <span class="kind-tag">回放缓存</span>
              <span :class="(item.row.misses ?? 0) > 0 ? 'res-no' : 'res-ok'">
                {{ (item.row.misses ?? 0) > 0 ? '⚠ 有失配' : '✓ 全命中' }}
              </span>
              <span class="ltarget">{{ cacheText(item.row) }}</span>
              <el-button size="small" text @click="toggleRaw(item.key)">
                {{ rawOpen[item.key] ? '收起' : '原始' }}
              </el-button>
            </div>
            <div v-else class="logline">
              <span class="kind-tag">模型</span>
              <span class="res-no">⚠ {{ item.row.stage || 'decide' }} 调用失败</span>
              <span class="muted">{{ item.row.model || '' }} · {{ item.row.error || '' }}</span>
              <el-button size="small" text @click="toggleRaw(item.key)">
                {{ rawOpen[item.key] ? '收起' : '原始' }}
              </el-button>
            </div>
            <template v-if="isDecision(item.row)">
              <div v-for="(fact, index) in facts(item.row)" :key="`f${index}`" class="logfact">
                {{ fact }}
              </div>
            </template>
            <template v-else-if="rowKind(item.row) === 'assert'">
              <div v-for="(check, index) in item.row.checks || []" :key="`c${index}`" class="logfact">
                {{ check.ok ? '✓' : '✗' }} {{ check.kind }}: {{ check.expected
                }}{{ check.evidence ? ` — ${check.evidence}` : '' }}
              </div>
            </template>
            <template v-else-if="rowKind(item.row) === 'cache'">
              <div v-for="(line, index) in cacheFacts(item.row)" :key="`cc${index}`" class="logfact">
                {{ line }}
              </div>
            </template>
            <div v-if="rawOpen[item.key]" class="logfact">
              <pre class="plan-tree" style="max-height: 240px; overflow: auto; margin: 0">{{ JSON.stringify(item.row, null, 2) }}</pre>
            </div>
          </template>
        </div>
      </div>
    </div>

    <SnapshotViewer
      v-model="snapshot.visible"
      :url="snapshot.url"
      :title="snapshot.title"
    />
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 6px;
}

.filters .f {
  border: 1px solid #dcdfe6;
  border-radius: 12px;
  background: #fff;
  color: #606266;
  cursor: pointer;
  font-size: 12px;
  padding: 3px 12px;
}

.filters .f.active {
  background: #ecf5ff;
  border-color: #b3d8ff;
  color: #409eff;
}

.snap {
  border: 1px solid #b3d8ff;
  border-radius: 3px;
  background: #ecf5ff;
  color: #409eff;
  cursor: pointer;
  font-size: 12px;
  padding: 0 6px;
}

.res-ok {
  color: #67c23a;
}

.res-no {
  color: #f56c6c;
}

.ladder {
  color: #909399;
  font-size: 11.5px;
}

.kind-tag {
  border: 1px solid #dcdfe6;
  border-radius: 3px;
  color: #909399;
  font-size: 11.5px;
  padding: 0 5px;
}

.life .ltarget {
  color: #909399;
}

.panel-head .caret {
  font-family: Consolas, monospace;
}
</style>
