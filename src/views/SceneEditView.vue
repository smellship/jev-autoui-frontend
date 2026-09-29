<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

import { batchApi, caseApi, nodeApi, suiteApi } from '@/api'
import type { BatchBrief, CaseListItem, Node, RunBrief, SuiteDetail } from '@/api/types'
import StatusTag from '@/components/StatusTag.vue'
import { useUiStore } from '@/stores/ui'
import { formatDuration } from '@/utils/format'
import { showApiError } from '@/utils/notify'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()

const suiteId = computed(() => (route.name === 'scene-detail' ? String(route.params.id || '') : ''))
const isSuite = computed(() => Boolean(suiteId.value))
const pageTitle = computed(() => (isSuite.value ? suite.value?.name || suiteId.value : '临时串跑'))

// ---------- 串跑清单（有序） ----------
const chosen = ref<CaseListItem[]>([])
const dirty = ref(false)
const missing = ref<Array<{ id: string; name: string }>>([])
const suite = ref<SuiteDetail | null>(null)
const loadingSuite = ref(false)
const saving = ref(false)

// ---------- 用例池 ----------
const tree = ref<Node[]>([])
const nodeId = ref<number | null>(null)
const keyword = ref('')
const pool = ref<CaseListItem[]>([])
const poolTotal = ref(0)
const poolLoading = ref(false)
const poolSelection = ref<CaseListItem[]>([])
const poolTable = ref<{ clearSelection: () => void } | null>(null)

// ---------- 批次进度 ----------
const batch = ref<BatchBrief | null>(null)
const starting = ref(false)
let batchTimer: number | null = null

const chosenIds = computed(() => new Set(chosen.value.map((item) => item.id)))

const doneCount = computed(() => {
  const counts = batch.value?.counts
  if (!counts) return 0
  return counts.passed + counts.failed + counts.aborted + counts.unverified + counts.error
})

const countsText = computed(() => {
  const counts = batch.value?.counts
  if (!counts) return ''
  const parts: string[] = []
  if (counts.passed) parts.push(`通过 ${counts.passed}`)
  if (counts.failed) parts.push(`失败 ${counts.failed}`)
  if (counts.aborted) parts.push(`中止 ${counts.aborted}`)
  if (counts.error) parts.push(`错误 ${counts.error}`)
  if (counts.unverified) parts.push(`未验收 ${counts.unverified}`)
  if (counts.running) parts.push(`运行中 ${counts.running}`)
  if (counts.queued) parts.push(`排队 ${counts.queued}`)
  return parts.join(' · ')
})

const batchStatus = computed(() => {
  const item = batch.value
  if (!item) return ''
  if (!item.done) return item.counts.running ? 'running' : 'queued'
  const counts = item.counts
  if (counts.failed) return 'failed'
  if (counts.error) return 'error'
  if (counts.aborted) return 'aborted'
  if (counts.unverified) return 'unverified'
  return 'passed'
})

async function refreshTree(): Promise<void> {
  try {
    const data = await nodeApi.tree()
    tree.value = data.items
  } catch (error) {
    showApiError(error, '取节点树失败')
  }
}

async function refreshPool(): Promise<void> {
  poolLoading.value = true
  try {
    const data = await caseApi.list({
      ...(nodeId.value === null ? {} : { node_id: nodeId.value }),
      ...(keyword.value.trim() ? { q: keyword.value.trim() } : {}),
      size: 200,
    })
    pool.value = data.items
    poolTotal.value = data.total
  } catch (error) {
    showApiError(error, '取用例池失败')
  } finally {
    poolLoading.value = false
  }
}

async function loadSuite(): Promise<void> {
  loadingSuite.value = true
  try {
    const data = await suiteApi.detail(suiteId.value)
    suite.value = data
    chosen.value = data.items
    missing.value = data.missing
    dirty.value = false
  } catch (error) {
    showApiError(error, '取套件失败')
    void router.replace({ name: 'scenes' })
  } finally {
    loadingSuite.value = false
  }
}

function selectNode(id: number | null): void {
  nodeId.value = id
  void refreshPool()
}

function appendItems(items: CaseListItem[]): void {
  const have = new Set(chosen.value.map((item) => item.id))
  let added = 0
  for (const item of items) {
    if (have.has(item.id)) continue
    have.add(item.id)
    chosen.value.push(item)
    added += 1
  }
  if (added) {
    dirty.value = true
    ElMessage.success(`已加入 ${added} 个用例`)
  } else {
    ElMessage.info('这些用例都已经在清单里了')
  }
}

function addSelected(): void {
  appendItems(poolSelection.value)
  poolTable.value?.clearSelection()
}

function moveAt(index: number, delta: number): void {
  const target = index + delta
  if (target < 0 || target >= chosen.value.length) return
  const list = chosen.value.slice()
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item)
  chosen.value = list
  dirty.value = true
}

function removeAt(index: number): void {
  chosen.value = chosen.value.filter((_, at) => at !== index)
  dirty.value = true
}

function clearAll(): void {
  chosen.value = []
  dirty.value = true
}

async function saveList(quiet = false): Promise<boolean> {
  if (!isSuite.value) return true
  saving.value = true
  try {
    await suiteApi.setCases(suiteId.value, chosen.value.map((item) => item.id))
    dirty.value = false
    if (!quiet) ElMessage.success('清单已保存')
    return true
  } catch (error) {
    showApiError(error, '保存清单失败')
    return false
  } finally {
    saving.value = false
  }
}

async function removeMissingRefs(): Promise<void> {
  missing.value = []
  const ok = await saveList()
  if (ok) ElMessage.success('已移除已删除用例的引用')
}

async function startBatch(): Promise<void> {
  if (!ui.envId) {
    ElMessage.warning('先在顶栏选一个环境')
    return
  }
  if (missing.value.length) {
    ElMessage.warning('套件里有已删除的用例，先「移除这些引用」再运行')
    return
  }
  if (!chosen.value.length) {
    ElMessage.warning('清单还是空的：从左边把用例加进来')
    return
  }
  if (isSuite.value && dirty.value) {
    const ok = await saveList(true)
    if (!ok) return
  }
  starting.value = true
  try {
    const data = isSuite.value
      ? await suiteApi.run(suiteId.value, { env_id: ui.envId, mode: ui.mode })
      : await batchApi.create({
          case_ids: chosen.value.map((item) => item.id),
          env_id: ui.envId,
          mode: ui.mode,
        })
    batch.value = data
    void router.replace({ query: { ...route.query, batch: data.code } })
    watchBatch(data.code)
    await ui.refreshQueue()
    ElMessage.success(`已开始串跑（${chosen.value.length} 个用例依次执行）`)
  } catch (error) {
    showApiError(error, '发起串跑失败')
  } finally {
    starting.value = false
  }
}

async function stopBatch(): Promise<void> {
  const code = batch.value?.code
  if (!code) return
  try {
    await batchApi.stop(code)
    ElMessage.success('已停止批次')
    await refreshBatch(code)
  } catch (error) {
    showApiError(error, '停止批次失败')
  }
}

function stopBatchPolling(): void {
  if (batchTimer !== null) window.clearInterval(batchTimer)
  batchTimer = null
}

async function refreshBatch(code: string): Promise<void> {
  try {
    const data = await batchApi.detail(code)
    batch.value = data
    if (data.done) {
      stopBatchPolling()
      await ui.refreshQueue()
    }
  } catch (error) {
    stopBatchPolling()
    showApiError(error, '取批次进度失败')
  }
}

function watchBatch(code: string): void {
  stopBatchPolling()
  void refreshBatch(code)
  batchTimer = window.setInterval(() => void refreshBatch(code), 1200)
}

function closeBatch(): void {
  stopBatchPolling()
  batch.value = null
  const rest = { ...route.query }
  delete rest.batch
  void router.replace({ query: rest })
}

function openRun(row: RunBrief): void {
  void router.push({ name: 'case-detail', params: { id: row.case_id }, query: { run: row.id } })
}

async function saveAsSuite(): Promise<void> {
  if (!chosen.value.length) {
    ElMessage.warning('清单还是空的：先加用例')
    return
  }
  try {
    const { value } = await ElMessageBox.prompt('给这条串跑清单起个名字', '存为套件', {
      inputValue: '临时串跑',
      inputValidator: (text: string) => Boolean(text && text.trim()) || '名称必填',
    })
    const created = await suiteApi.create({ name: value.trim() })
    await suiteApi.setCases(created.id, chosen.value.map((item) => item.id))
    ElMessage.success(`已存为套件 ${created.id}`)
    void router.push({
      name: 'scene-detail',
      params: { id: created.id },
      query: batch.value ? { batch: batch.value.code } : {},
    })
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showApiError(error, '存为套件失败')
  }
}

async function renameSuite(): Promise<void> {
  if (!suite.value) return
  try {
    const { value } = await ElMessageBox.prompt('套件名称', `重命名「${suite.value.name}」`, {
      inputValue: suite.value.name,
      inputValidator: (text: string) => Boolean(text && text.trim()) || '名称必填',
    })
    const updated = await suiteApi.update(suite.value.id, { name: value.trim() })
    suite.value.name = updated.name
    ElMessage.success('已重命名')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showApiError(error, '重命名失败')
  }
}

let searchTimer: number | null = null
watch(keyword, () => {
  if (searchTimer !== null) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void refreshPool(), 250)
})

watch(suiteId, async (value, old) => {
  if (value === old) return
  stopBatchPolling()
  batch.value = null
  missing.value = []
  chosen.value = []
  dirty.value = false
  suite.value = null
  if (value) await loadSuite()
  const code = route.query.batch
  if (typeof code === 'string' && code) watchBatch(code)
})

onMounted(async () => {
  await ui.loadEnvs()
  await refreshTree()
  if (isSuite.value) await loadSuite()
  await refreshPool()
  const code = route.query.batch
  if (typeof code === 'string' && code) watchBatch(code)
})

onBeforeUnmount(() => {
  stopBatchPolling()
  if (searchTimer !== null) window.clearTimeout(searchTimer)
})
</script>

<template>
  <div class="page" v-loading="loadingSuite">
    <div class="crumb" style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
      <el-button size="small" text @click="router.push({ name: 'scenes' })">← 场景管理</el-button>
      <b>{{ pageTitle }}</b>
      <span v-if="isSuite" class="muted mono">{{ suiteId }}</span>
      <el-button v-if="isSuite" size="small" text type="primary" @click="renameSuite()">改名</el-button>
      <span class="muted">环境：{{ ui.envLabel || '未选（顶栏）' }} · 模式：{{ ui.mode }}（顶栏可改）</span>
      <div style="flex: 1" />
      <template v-if="isSuite">
        <span v-if="dirty" style="color: #e6a23c; font-size: 12px">有未保存改动，开始串跑会先自动保存</span>
        <el-button size="small" :disabled="!dirty" :loading="saving" @click="saveList()">保存清单</el-button>
      </template>
      <el-button v-else size="small" @click="saveAsSuite()">存为套件</el-button>
      <el-button
        size="small"
        type="primary"
        :loading="starting"
        :disabled="!!missing.length"
        @click="startBatch()"
      >
        开始串跑（{{ chosen.length }}）
      </el-button>
    </div>

    <el-alert
      v-if="missing.length"
      type="error"
      :closable="false"
      style="margin-bottom: 12px"
      :title="`套件里有 ${missing.length} 个用例已被删除：${missing.map((item) => item.name).join('、')}`"
    >
      <template #default>
        <div style="display: flex; align-items: center; gap: 10px">
          <span>先修套件再运行。</span>
          <el-button size="small" type="danger" plain @click="removeMissingRefs()">移除这些引用</el-button>
        </div>
      </template>
    </el-alert>

    <el-card v-if="batch" style="margin-bottom: 12px">
      <template #header>
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
          <b>批次 {{ batch.code }}</b>
          <span class="muted">{{ batch.label }} · {{ batch.env }} · {{ batch.mode }}</span>
          <StatusTag :status="batchStatus" />
          <span>{{ doneCount }}/{{ batch.total }} 完成</span>
          <span v-if="countsText" class="muted">{{ countsText }}</span>
          <div style="flex: 1" />
          <el-button v-if="!batch.done" size="small" type="warning" @click="stopBatch()">停止批次</el-button>
          <el-button size="small" text @click="closeBatch()">关闭</el-button>
        </div>
      </template>
      <el-table
        class="batch-table"
        :data="batch.items"
        size="small"
        empty-text="批次里还没有运行"
        @row-click="(row: RunBrief) => openRun(row)"
      >
        <el-table-column type="index" label="#" width="44" />
        <el-table-column label="用例" min-width="200">
          <template #default="{ row }">
            <span>{{ row.case_name }}</span>
            <span class="muted" style="margin-left: 8px">{{ row.case_id }}</span>
          </template>
        </el-table-column>
        <el-table-column label="结果" width="120">
          <template #default="{ row }">
            <StatusTag :status="row.status" />
            <span v-if="row.kernel_status" class="muted" style="margin-left: 6px">{{ row.kernel_status }}</span>
          </template>
        </el-table-column>
        <el-table-column label="用时" width="90">
          <template #default="{ row }">
            <span class="muted">{{ formatDuration(row.duration_ms) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="detail" label="说明" min-width="220" show-overflow-tooltip />
      </el-table>
    </el-card>

    <div style="display: flex; gap: 12px; align-items: flex-start">
      <el-card style="flex: 1; min-width: 0">
        <template #header>
          <div style="display: flex; align-items: center; gap: 10px">
            <b>用例池</b>
            <span class="muted">共 {{ poolTotal }} 个</span>
            <div style="flex: 1" />
            <el-input
              v-model="keyword"
              size="small"
              placeholder="搜用例名 / 编号"
              style="width: 200px"
              clearable
            />
          </div>
        </template>
        <div style="display: flex; gap: 12px; align-items: flex-start">
          <div style="width: 180px; flex: none">
            <div
              class="tree-item"
              :class="{ active: nodeId === null }"
              style="padding: 4px 8px; border-radius: 4px; cursor: pointer; margin-bottom: 4px"
              @click="selectNode(null)"
            >
              全部场景
            </div>
            <el-tree
              :data="tree"
              node-key="id"
              :props="{ label: 'name' }"
              highlight-current
              :current-node-key="nodeId ?? undefined"
              :expand-on-click-node="false"
              default-expand-all
              empty-text="还没有节点"
              @node-click="(data: Node) => selectNode(data.id)"
            />
          </div>
          <div style="flex: 1; min-width: 0">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px">
              <el-button
                size="small"
                type="primary"
                :disabled="!poolSelection.length"
                @click="addSelected()"
              >
                加入选中（{{ poolSelection.length }}）→
              </el-button>
              <span class="muted" style="font-size: 12px">顺序就是执行顺序，加入后在右边调整</span>
            </div>
            <el-table
              ref="poolTable"
              v-loading="poolLoading"
              :data="pool"
              size="small"
              row-key="id"
              empty-text="这个范围下没有用例"
              @selection-change="(rows: CaseListItem[]) => (poolSelection = rows)"
            >
              <el-table-column
                type="selection"
                width="40"
                :selectable="(row: CaseListItem) => !chosenIds.has(row.id)"
              />
              <el-table-column label="用例" min-width="170">
                <template #default="{ row }">
                  <span>{{ row.name }}</span>
                  <span class="muted" style="margin-left: 6px">{{ row.id }}</span>
                </template>
              </el-table-column>
              <el-table-column label="场景" width="120">
                <template #default="{ row }"><span class="muted">{{ row.scenario_name }}</span></template>
              </el-table-column>
              <el-table-column label="优先" width="70">
                <template #default="{ row }">
                  <el-tag
                    size="small"
                    disable-transitions
                    :type="row.priority === 'P0' ? 'danger' : row.priority === 'P1' ? 'warning' : 'info'"
                  >
                    {{ row.priority }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="最近结果" width="90">
                <template #default="{ row }">
                  <StatusTag v-if="row.last_run" :status="row.last_run.status" />
                  <span v-else class="muted">—</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="90">
                <template #default="{ row }">
                  <span v-if="chosenIds.has(row.id)" class="muted">已在清单</span>
                  <el-button v-else size="small" text type="primary" @click="appendItems([row])">加入</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-card>

      <el-card style="width: 430px; flex: none">
        <template #header>
          <div style="display: flex; align-items: center; gap: 10px">
            <b>串跑清单</b>
            <span class="muted">{{ chosen.length }} 个 · 按序执行</span>
            <div style="flex: 1" />
            <el-button size="small" text :disabled="!chosen.length" @click="clearAll()">清空</el-button>
          </div>
        </template>
        <el-table :data="chosen" size="small" empty-text="从左边把用例加进来">
          <el-table-column type="index" label="#" width="44" />
          <el-table-column label="用例" min-width="140">
            <template #default="{ row }">
              <span>{{ row.name }}</span>
              <div class="muted">{{ row.scenario_name }}</div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200">
            <template #default="{ $index }">
              <el-button size="small" text :disabled="$index === 0" @click="moveAt($index, -1)">上移</el-button>
              <el-button
                size="small"
                text
                :disabled="$index === chosen.length - 1"
                @click="moveAt($index, 1)"
              >
                下移
              </el-button>
              <el-button size="small" text type="danger" @click="removeAt($index)">移除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.tree-item:hover {
  background: #f5f7fa;
}

.tree-item.active {
  background: #ecf5ff;
  color: #409eff;
  font-weight: 600;
}

.batch-table :deep(.el-table__row) {
  cursor: pointer;
}
</style>
