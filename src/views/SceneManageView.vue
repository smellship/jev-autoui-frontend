<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

import { suiteApi } from '@/api'
import type { BatchSummary, Suite } from '@/api/types'
import StatusTag from '@/components/StatusTag.vue'
import { useUiStore } from '@/stores/ui'
import { formatTime } from '@/utils/format'
import { showApiError } from '@/utils/notify'

const router = useRouter()
const ui = useUiStore()

const rows = ref<Suite[]>([])
const total = ref(0)
const keyword = ref('')
const loading = ref(false)
const launching = ref('')

async function load(): Promise<void> {
  loading.value = true
  try {
    const data = await suiteApi.list({
      ...(keyword.value.trim() ? { q: keyword.value.trim() } : {}),
    })
    rows.value = data.items
    total.value = data.total
  } catch (error) {
    showApiError(error, '取套件列表失败')
  } finally {
    loading.value = false
  }
}

function open(row: Suite): void {
  void router.push({ name: 'scene-detail', params: { id: row.id } })
}

function openAdhoc(): void {
  void router.push({ name: 'scene-new' })
}

async function createSuite(): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('套件名称（用例清单可以进去再选）', '新建套件', {
      inputPlaceholder: '例如：每日回归串跑',
      inputValidator: (text: string) => Boolean(text && text.trim()) || '名称必填',
    })
    const suite = await suiteApi.create({ name: value.trim() })
    ElMessage.success(`已创建 ${suite.id}`)
    open(suite)
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showApiError(error, '新建套件失败')
  }
}

async function runSuite(row: Suite): Promise<void> {
  if (!ui.envId) {
    ElMessage.warning('先在顶栏选一个环境')
    return
  }
  if (!row.case_count) {
    ElMessage.warning(`「${row.name}」还没有用例，先打开它把清单排好`)
    return
  }
  launching.value = row.id
  try {
    const batch = await suiteApi.run(row.id, { env_id: ui.envId, mode: ui.mode })
    await ui.refreshQueue()
    void router.push({ name: 'scene-detail', params: { id: row.id }, query: { batch: batch.code } })
  } catch (error) {
    showApiError(error, '发起串跑失败')
  } finally {
    launching.value = ''
  }
}

async function copySuite(row: Suite): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('新套件名称', `复制「${row.name}」`, {
      inputValue: `${row.name} 副本`,
      inputValidator: (text: string) => Boolean(text && text.trim()) || '名称必填',
    })
    await suiteApi.copy(row.id, value.trim())
    await load()
    ElMessage.success('已复制')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showApiError(error, '复制失败')
  }
}

async function removeSuite(row: Suite): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除套件「${row.name}」？（只删这条编排，用例本身不动）`, '二次确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await suiteApi.remove(row.id)
    await load()
    ElMessage.success('已删除')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showApiError(error, '删除失败')
  }
}

/** 最近批次的聚合标签：进行中 → running；跑完按最差结果着色。 */
function batchStatus(item: BatchSummary | null): string {
  if (!item) return ''
  if (!item.done) return 'running'
  const counts = item.counts
  if (counts.failed) return 'failed'
  if (counts.error) return 'error'
  if (counts.aborted) return 'aborted'
  if (counts.unverified) return 'unverified'
  if (counts.passed) return 'passed'
  return 'queued'
}

function batchDoneCount(item: BatchSummary): number {
  const counts = item.counts
  return counts.passed + counts.failed + counts.aborted + counts.unverified + counts.error
}

let searchTimer: number | null = null
watch(keyword, () => {
  if (searchTimer !== null) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void load(), 250)
})

onMounted(async () => {
  await ui.loadEnvs()
  await load()
})
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="crumb" style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
      <b>场景管理</b>
      <span class="muted">把任意几个用例排成一条串跑清单，服务端按顺序自动依次执行（失败不中断）</span>
      <div style="flex: 1" />
      <el-button size="small" @click="openAdhoc()">临时串跑</el-button>
      <el-button size="small" type="primary" @click="createSuite()">+ 新建套件</el-button>
    </div>

    <el-card>
      <template #header>
        <div style="display: flex; align-items: center; gap: 10px">
          <b>套件</b>
          <span class="muted">共 {{ total }} 个</span>
          <div style="flex: 1" />
          <el-input
            v-model="keyword"
            size="small"
            placeholder="搜套件名 / 编号"
            style="width: 220px"
            clearable
          />
        </div>
      </template>

      <el-table :data="rows" size="small" empty-text="还没有套件：新建一个，或从「临时串跑」随手排一条">
        <el-table-column label="套件" min-width="220">
          <template #default="{ row }">
            <span style="color: #409eff; cursor: pointer" @click="open(row)">{{ row.name }}</span>
            <span class="muted" style="margin-left: 8px">{{ row.id }}</span>
            <span v-if="row.tags?.length" class="muted" style="margin-left: 8px">{{ row.tags.join(' / ') }}</span>
            <div v-if="row.description" class="muted">{{ row.description }}</div>
          </template>
        </el-table-column>
        <el-table-column label="用例数" width="80">
          <template #default="{ row }">{{ row.case_count }}</template>
        </el-table-column>
        <el-table-column label="最近批次" min-width="230">
          <template #default="{ row }">
            <template v-if="row.last_batch">
              <StatusTag :status="batchStatus(row.last_batch)" />
              <span class="muted" style="margin-left: 8px">
                {{ batchDoneCount(row.last_batch) }}/{{ row.last_batch.total }} 完成
                <template v-if="row.last_batch.counts.failed"> · 失败 {{ row.last_batch.counts.failed }}</template>
                <template v-if="row.last_batch.counts.aborted"> · 中止 {{ row.last_batch.counts.aborted }}</template>
              </span>
              <div class="muted">{{ row.last_batch.code }} · {{ formatTime(row.last_batch.created_at) }}</div>
            </template>
            <span v-else class="muted">还没跑过</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="open(row)">打开</el-button>
            <el-button
              size="small"
              text
              type="primary"
              :loading="launching === row.id"
              @click="runSuite(row)"
            >
              运行
            </el-button>
            <el-button size="small" text @click="copySuite(row)">复制</el-button>
            <el-button size="small" text type="danger" @click="removeSuite(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>
