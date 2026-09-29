<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import { runApi } from '@/api'
import type { RunBrief, RunStatus } from '@/api/types'
import HtmlViewer from '@/components/HtmlViewer.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useUiStore } from '@/stores/ui'
import { downloadArtifact, openArtifactTab } from '@/utils/artifact'
import { formatDateTime, formatDuration, formatTime } from '@/utils/format'
import { showApiError } from '@/utils/notify'

const router = useRouter()
const ui = useUiStore()

const STATUSES: Array<{ value: RunStatus; label: string }> = [
  { value: 'queued', label: '排队中' },
  { value: 'running', label: '运行中' },
  { value: 'passed', label: '通过' },
  { value: 'failed', label: '失败' },
  { value: 'aborted', label: '中止' },
  { value: 'unverified', label: '未验收' },
  { value: 'error', label: '错误' },
]
const PAGE_SIZE = 20

const rows = ref<RunBrief[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const statuses = ref<RunStatus[]>([])
const mode = ref('')
const envId = ref<number | null>(null)
const dateFrom = ref('')
const dateTo = ref('')
const keyword = ref('')
const reportView = ref<{ visible: boolean; url: string; runId: string }>({ visible: false, url: '', runId: '' })
let timer: number | null = null

const filtered = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return rows.value
  return rows.value.filter((row) =>
    [row.id, row.case_id, row.case_name, row.scenario_name, row.detail]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(text)),
  )
})

async function load(): Promise<void> {
  loading.value = true
  try {
    const data = await runApi.list({
      page: page.value,
      size: PAGE_SIZE,
      ...(statuses.value.length ? { status: statuses.value.join(',') } : {}),
      ...(mode.value ? { mode: mode.value } : {}),
      ...(envId.value ? { env_id: envId.value } : {}),
      ...(dateFrom.value ? { date_from: `${dateFrom.value}T00:00:00` } : {}),
      ...(dateTo.value ? { date_to: `${dateTo.value}T23:59:59` } : {}),
    })
    rows.value = data.items
    total.value = data.total
  } catch (error) {
    showApiError(error, '取运行台账失败')
  } finally {
    loading.value = false
  }
}

function search(): void {
  page.value = 1
  void load()
}

function reset(): void {
  statuses.value = []
  mode.value = ''
  envId.value = null
  dateFrom.value = ''
  dateTo.value = ''
  keyword.value = ''
  search()
}

function openRun(row: RunBrief): void {
  void router.push({ name: 'case-detail', params: { id: row.case_id }, query: { run: row.id } })
}

function openReport(row: RunBrief): void {
  reportView.value = { visible: true, url: row.report_url, runId: row.id }
}

async function openReportTab(): Promise<void> {
  if (!reportView.value.url) return
  try {
    await openArtifactTab(reportView.value.url)
  } catch (error) {
    showApiError(error, '报告打开失败（可到用例页点『重出报告』）')
  }
}

async function rebuild(row: RunBrief): Promise<void> {
  try {
    const result = await runApi.rebuildReport(row.id)
    ElMessage.success(result.exists ? '报告已重出' : '内核返回了报告结果')
    void load()
  } catch (error) {
    showApiError(error, '重出报告失败')
  }
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

async function exportCsv(): Promise<void> {
  const header = ['运行 id', '用例', '用例名', '场景', '环境', '模式', '状态', '内核状态',
    '开始', '结束', '用时(ms)', '触发人', '说明']
  const lines = [header.map(csvCell).join(',')]
  const pageSize = 200
  let current = 1
  let fetched = 0
  try {
    for (;;) {
      const data = await runApi.list({
        page: current,
        size: pageSize,
        ...(statuses.value.length ? { status: statuses.value.join(',') } : {}),
        ...(mode.value ? { mode: mode.value } : {}),
        ...(envId.value ? { env_id: envId.value } : {}),
        ...(dateFrom.value ? { date_from: `${dateFrom.value}T00:00:00` } : {}),
        ...(dateTo.value ? { date_to: `${dateTo.value}T23:59:59` } : {}),
      })
      for (const row of data.items) {
        lines.push([row.id, row.case_id, row.case_name, row.scenario_name, row.env, row.mode,
          row.status, row.kernel_status, row.started_at, row.finished_at, row.duration_ms,
          row.triggered_by, row.detail].map(csvCell).join(','))
      }
      fetched += data.items.length
      if (!data.items.length || fetched >= data.total) break
      current += 1
    }
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `runs-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    ElMessage.success(`已导出 ${fetched} 条`)
  } catch (error) {
    showApiError(error, '导出失败')
  }
}

async function copyId(row: RunBrief): Promise<void> {
  try {
    await navigator.clipboard.writeText(row.id)
    ElMessage.success(`已复制 ${row.id}`)
  } catch {
    ElMessage.warning('浏览器不允许写剪贴板')
  }
}

function artifactRun(row: RunBrief): void {
  downloadArtifact(row.report_url, `${row.id}-report.html`).catch(() => {
    ElMessage.warning('这个运行还没有报告，先「重出报告」')
  })
}

onMounted(async () => {
  await ui.loadEnvs()
  await load()
  timer = window.setInterval(() => {
    if (rows.value.some((row) => ['queued', 'running'].includes(row.status))) void load()
  }, 8000)
})

onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer)
})
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="crumb"><b>运行记录</b><span class="muted" style="margin-left: 8px">服务端串行执行，队列即台账顺序</span></div>

    <el-card style="margin-bottom: 12px">
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
        <el-select v-model="statuses" multiple collapse-tags placeholder="状态" style="width: 190px" size="small">
          <el-option v-for="item in STATUSES" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select v-model="mode" clearable placeholder="模式" style="width: 110px" size="small">
          <el-option label="debug" value="debug" />
          <el-option label="ci" value="ci" />
        </el-select>
        <el-select v-model="envId" clearable placeholder="环境" style="width: 150px" size="small">
          <el-option v-for="env in ui.envs" :key="env.id" :label="env.name" :value="env.id" />
        </el-select>
        <el-date-picker v-model="dateFrom" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" size="small" style="width: 140px" />
        <el-date-picker v-model="dateTo" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" size="small" style="width: 140px" />
        <el-button size="small" type="primary" @click="search()">查询</el-button>
        <el-button size="small" @click="reset()">重置</el-button>
        <el-input v-model="keyword" size="small" placeholder="本页内搜用例 / id / 说明" clearable style="width: 200px" />
        <div style="flex: 1" />
        <el-button size="small" @click="exportCsv()">导出 CSV</el-button>
      </div>
    </el-card>

    <el-card>
      <template #header>
        <div style="display: flex; align-items: center; gap: 8px">
          <b>台账</b>
          <span class="muted">共 {{ total }} 条{{ keyword ? ` · 本页筛出 ${filtered.length}` : '' }}</span>
        </div>
      </template>
      <el-table :data="filtered" size="small" empty-text="还没有运行记录">
        <el-table-column label="运行" width="180">
          <template #default="{ row }">
            <span class="link mono" style="color: #409eff; cursor: pointer" @click="openRun(row)">{{ row.id }}</span>
            <div class="muted">{{ formatDateTime(row.created_at) }}</div>
            <div v-if="row.batch_code" class="muted mono" style="margin-top: 2px">批次 {{ row.batch_code }}</div>
          </template>
        </el-table-column>
        <el-table-column label="用例" min-width="200">
          <template #default="{ row }">
            <span>{{ row.case_name }}</span>
            <div class="muted">{{ row.scenario_name }} · {{ row.case_id }}</div>
          </template>
        </el-table-column>
        <el-table-column label="环境" width="110">
          <template #default="{ row }">
            <span>{{ row.env }}</span>
            <div class="muted">{{ row.mode }}</div>
          </template>
        </el-table-column>
        <el-table-column label="结果" width="120">
          <template #default="{ row }">
            <StatusTag :status="row.status" />
            <div v-if="row.kernel_status" class="muted">{{ row.kernel_status }}</div>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="150">
          <template #default="{ row }">
            <div>{{ formatTime(row.started_at || row.created_at) }}</div>
            <div class="muted">用时 {{ formatDuration(row.duration_ms) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="触发人" width="90">
          <template #default="{ row }"><span class="muted">{{ row.triggered_by || '—' }}</span></template>
        </el-table-column>
        <el-table-column prop="detail" label="说明" min-width="180" show-overflow-tooltip />
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openRun(row)">打开</el-button>
            <el-button size="small" text @click="openReport(row)">报告</el-button>
            <el-button size="small" text @click="rebuild(row)">重出</el-button>
            <el-dropdown trigger="click">
              <el-button size="small" text>更多</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="copyId(row)">复制运行 id</el-dropdown-item>
                  <el-dropdown-item @click="artifactRun(row)">下载报告 HTML</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>

      <div style="display: flex; justify-content: flex-end; margin-top: 10px">
        <el-pagination
          layout="prev, pager, next, total"
          :total="total"
          :page-size="PAGE_SIZE"
          :current-page="page"
          @current-change="(value: number) => { page = value; load() }"
        />
      </div>
    </el-card>

    <HtmlViewer
      v-model="reportView.visible"
      :url="reportView.url"
      :title="`运行报告 · ${reportView.runId}`"
      @open-tab="openReportTab"
    />
  </div>
</template>
