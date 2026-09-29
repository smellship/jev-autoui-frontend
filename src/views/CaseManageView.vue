<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

import { nodeApi, scenarioApi } from '@/api'
import type { Node, Scenario } from '@/api/types'
import ScenarioDialog from '@/components/ScenarioDialog.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useUiStore } from '@/stores/ui'
import { formatTime } from '@/utils/format'
import { showApiError } from '@/utils/notify'

const router = useRouter()
const ui = useUiStore()

const tree = ref<Node[]>([])
const scenarios = ref<Scenario[]>([])
const nodeId = ref<number | null>(null)
const keyword = ref('')
const loading = ref(false)
const dialogVisible = ref(false)
const editing = ref<Scenario | null>(null)

const currentNode = computed(() => (nodeId.value === null ? null : findNode(tree.value, nodeId.value)))

function findNode(nodes: Node[], id: number): Node | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const hit = findNode(node.children || [], id)
    if (hit) return hit
  }
  return null
}

function siblingsOf(id: number): Node[] {
  const flat: Node[] = []
  const walk = (nodes: Node[], parent: Node | null): void => {
    for (const node of nodes) {
      flat.push(node)
      walk(node.children || [], node)
    }
    void parent
  }
  walk(tree.value, null)
  const self = flat.find((item) => item.id === id)
  if (!self) return []
  return flat.filter((item) => item.parent_id === self.parent_id)
}

async function refreshTree(): Promise<void> {
  const data = await nodeApi.tree()
  tree.value = data.items
  if (nodeId.value !== null && !findNode(tree.value, nodeId.value)) nodeId.value = null
}

async function refreshScenarios(): Promise<void> {
  loading.value = true
  try {
    const data = await scenarioApi.list({
      ...(nodeId.value === null ? {} : { node_id: nodeId.value }),
      ...(keyword.value.trim() ? { q: keyword.value.trim() } : {}),
    })
    scenarios.value = data.items
  } catch (error) {
    showApiError(error, '取场景列表失败')
  } finally {
    loading.value = false
  }
}

function selectNode(id: number | null): void {
  nodeId.value = id
  void refreshScenarios()
}

async function addNode(parent: Node | null): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(
      parent ? `在「${parent.name}」下新增子节点` : '新增一级节点',
      parent ? '新增子节点' : '新增一级节点',
      { inputPlaceholder: '节点名称', inputValidator: (text: string) => Boolean(text && text.trim()) || '名称必填' },
    )
    await nodeApi.create({ parent_id: parent?.id ?? null, name: value.trim() })
    await refreshTree()
    ElMessage.success('已新增')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showApiError(error, '新增节点失败')
  }
}

async function renameNode(node: Node): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('新名称', `重命名「${node.name}」`, {
      inputValue: node.name,
      inputValidator: (text: string) => Boolean(text && text.trim()) || '名称必填',
    })
    await nodeApi.update(node.id, { name: value.trim() })
    await refreshTree()
    ElMessage.success('已重命名')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showApiError(error, '重命名失败')
  }
}

async function deleteNode(node: Node): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除节点「${node.name}」？（有子节点或场景时会被拒绝）`, '二次确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await nodeApi.remove(node.id)
    if (nodeId.value === node.id) nodeId.value = null
    await refreshTree()
    await refreshScenarios()
    ElMessage.success('已删除')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showApiError(error, '删除节点失败')
  }
}

async function moveNode(node: Node, delta: number): Promise<void> {
  const siblings = siblingsOf(node.id).slice().sort((a, b) => a.sort - b.sort || a.id - b.id)
  const at = siblings.findIndex((item) => item.id === node.id)
  const target = siblings[at + delta]
  if (!target) return
  try {
    await nodeApi.update(node.id, { sort: target.sort })
    await nodeApi.update(target.id, { sort: node.sort })
    await refreshTree()
  } catch (error) {
    showApiError(error, '排序失败')
  }
}

function onNodeCommand(command: string, node: Node): void {
  if (command === 'child') void addNode(node)
  else if (command === 'rename') void renameNode(node)
  else if (command === 'up') void moveNode(node, -1)
  else if (command === 'down') void moveNode(node, 1)
  else if (command === 'delete') void deleteNode(node)
}

function openScenario(row: Scenario): void {
  void router.push({ name: 'scenario', params: { id: row.id } })
}

async function openScenarioDialog(row: Scenario | null): Promise<void> {
  editing.value = row
  if (!row && nodeId.value === null) {
    ElMessage.warning('先在左侧选一个节点，场景要挂在节点下')
    return
  }
  dialogVisible.value = true
}

async function copyScenario(row: Scenario): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('新场景名称', `复制「${row.name}」`, {
      inputValue: `${row.name} 副本`,
      inputValidator: (text: string) => Boolean(text && text.trim()) || '名称必填',
    })
    await scenarioApi.create({
      node_id: row.node_id,
      name: value.trim(),
      priority: row.priority,
      owner: row.owner,
      tags: row.tags,
      description: row.description,
      env_id: row.env_id,
    })
    await refreshScenarios()
    ElMessage.success('已复制')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showApiError(error, '复制失败')
  }
}

async function deleteScenario(row: Scenario): Promise<void> {
  try {
    await ElMessageBox.confirm(
      row.case_count
        ? `「${row.name}」下有 ${row.case_count} 个用例，会一起软删除（进 trash，可人工找回）。继续？`
        : `删除场景「${row.name}」？（软删除，DB 标记 + 入 trash）`,
      '二次确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
    await scenarioApi.remove(row.id, row.case_count > 0)
    await refreshTree()
    await refreshScenarios()
    ElMessage.success('已删除（软删除）')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showApiError(error, '删除失败')
  }
}

function onMoreCommand(command: string, row: Scenario): void {
  if (command === 'edit') void openScenarioDialog(row)
  else if (command === 'copy') void copyScenario(row)
  else if (command === 'delete') void deleteScenario(row)
}

let searchTimer: number | null = null
watch(keyword, () => {
  if (searchTimer !== null) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void refreshScenarios(), 250)
})

onMounted(async () => {
  await Promise.all([refreshTree(), ui.loadEnvs()])
  await refreshScenarios()
})
</script>

<template>
  <div class="page">
    <div style="display: flex; gap: 12px; align-items: flex-start">
      <el-card class="box-card" style="width: 230px; flex: none" body-style="padding: 8px">
        <div
          class="tree-item"
          :class="{ active: nodeId === null }"
          style="padding: 6px 8px; border-radius: 4px; cursor: pointer"
          @click="selectNode(null)"
        >
          全部场景
        </div>
        <el-tree
          :data="tree"
          node-key="id"
          highlight-current
          :current-node-key="nodeId ?? undefined"
          :expand-on-click-node="false"
          default-expand-all
          empty-text="还没有节点"
          @node-click="(data: Node) => selectNode(data.id)"
        >
          <template #default="{ data }">
            <span style="display: flex; align-items: center; justify-content: space-between; width: 100%">
              <span>{{ data.name }}</span>
              <el-dropdown trigger="click" @command="(cmd: string) => onNodeCommand(cmd, data)">
                <span style="color: #909399; padding: 0 4px" @click.stop>⋯</span>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="child">新增子节点</el-dropdown-item>
                    <el-dropdown-item command="rename">重命名</el-dropdown-item>
                    <el-dropdown-item command="up">上移</el-dropdown-item>
                    <el-dropdown-item command="down">下移</el-dropdown-item>
                    <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </span>
          </template>
        </el-tree>
        <el-button size="small" text type="primary" style="margin-top: 6px" @click="addNode(null)">
          + 一级节点
        </el-button>
      </el-card>

      <el-card style="flex: 1; min-width: 0">
        <template #header>
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
            <b>{{ currentNode?.name || '全部场景' }}</b>
            <span class="muted">共 {{ scenarios.length }} 个场景</span>
            <div style="flex: 1" />
            <el-input
              v-model="keyword"
              size="small"
              placeholder="搜场景名 / 用例名 / 标签 / id"
              style="width: 220px"
              clearable
            />
            <el-button type="primary" size="small" @click="openScenarioDialog(null)">+ 添加场景</el-button>
          </div>
        </template>

        <el-table v-loading="loading" :data="scenarios" size="small" empty-text="这个节点下还没有场景">
          <el-table-column label="场景" min-width="180">
            <template #default="{ row }">
              <span class="link" style="color: #409eff; cursor: pointer" @click="openScenario(row)">
                {{ row.name }}
              </span>
              <span v-if="row.tags?.length" class="muted" style="margin-left: 6px">{{ row.tags.join(' / ') }}</span>
            </template>
          </el-table-column>
          <el-table-column label="优先级" width="80">
            <template #default="{ row }">
              <el-tag size="small" :type="row.priority === 'P1' ? 'warning' : row.priority === 'P0' ? 'danger' : 'info'"
                      disable-transitions>
                {{ row.priority }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="用例数" width="80">
            <template #default="{ row }">{{ row.case_count }}</template>
          </el-table-column>
          <el-table-column label="最近结果" width="100">
            <template #default="{ row }">
              <StatusTag v-if="row.last_run" :status="row.last_run.status" />
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="最近运行" width="120">
            <template #default="{ row }">
              <span class="muted">{{ row.last_run ? formatTime(row.last_run.created_at) : '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150">
            <template #default="{ row }">
              <el-button size="small" text type="primary" @click="openScenario(row)">打开</el-button>
              <el-dropdown trigger="click" @command="(cmd: string) => onMoreCommand(cmd, row)">
                <el-button size="small" text>更多</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">改名 / 改优先级</el-dropdown-item>
                    <el-dropdown-item command="copy">复制</el-dropdown-item>
                    <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <ScenarioDialog
      v-model="dialogVisible"
      :scenario="editing"
      :node-id="nodeId"
      :envs="ui.envs"
      @saved="refreshScenarios"
    />
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
</style>
