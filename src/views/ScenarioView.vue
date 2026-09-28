<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

import { caseApi, scenarioApi } from '@/api'
import type { CaseBrief, Scenario } from '@/api/types'
import CaseDialog from '@/components/CaseDialog.vue'
import ScenarioDialog from '@/components/ScenarioDialog.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useRunStarter } from '@/composables/useRunStarter'
import { useUiStore } from '@/stores/ui'
import { formatDateTime, formatTime } from '@/utils/format'
import { showApiError } from '@/utils/notify'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const { runCase, runScenario } = useRunStarter()

const scenarioId = computed(() => String(route.params.id || ''))
const scenario = ref<Scenario | null>(null)
const cases = ref<CaseBrief[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const editVisible = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    const [detail, list] = await Promise.all([
      scenarioApi.detail(scenarioId.value),
      scenarioApi.cases(scenarioId.value),
    ])
    scenario.value = detail
    cases.value = list.items
  } catch (error) {
    showApiError(error, '场景加载失败')
  } finally {
    loading.value = false
  }
}

function openCase(row: CaseBrief): void {
  void router.push({ name: 'case-detail', params: { id: row.id } })
}

async function copyCase(row: CaseBrief): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('新用例名称', `复制「${row.name}」`, {
      inputValue: `${row.name} 副本`,
      inputValidator: (text: string) => Boolean(text && text.trim()) || '名称必填',
    })
    const created = await caseApi.copy(row.id, { name: value.trim() })
    ElMessage.success(`已复制为 ${created.id}`)
    await load()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showApiError(error, '复制失败')
  }
}

async function deleteCase(row: CaseBrief): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除用例「${row.name}」？（软删除，YAML 先落 trash）`, '二次确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await caseApi.remove(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showApiError(error, '删除失败')
  }
}

watch(scenarioId, () => void load())

onMounted(async () => {
  await ui.loadEnvs()
  await load()
})
</script>

<template>
  <div class="page" v-loading="loading">
    <div class="crumb">
      <span class="link" @click="router.push({ name: 'cases' })">用例管理</span>
      <span> / </span>
      <b>{{ scenario?.name || scenarioId }}</b>
      <span v-if="scenario" class="muted" style="margin-left: 8px">{{ scenario.id }}</span>
    </div>

    <el-card style="margin-bottom: 12px">
      <template #header>
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
          <b>{{ scenario?.name }}</b>
          <el-tag size="small" disable-transitions>{{ scenario?.priority }}</el-tag>
          <el-tag v-for="tag in scenario?.tags || []" :key="tag" size="small" type="info" disable-transitions>{{ tag }}</el-tag>
          <span class="muted">负责人 {{ scenario?.owner || '—' }}</span>
          <span class="muted">
            默认环境 {{ ui.envs.find((item) => item.id === scenario?.env_id)?.name || '未指定' }}
          </span>
          <div style="flex: 1" />
          <el-button size="small" @click="editVisible = true">编辑场景</el-button>
          <el-button size="small" @click="runScenario(scenarioId, scenario?.name || '场景')">整场景串跑</el-button>
          <el-button size="small" type="primary" @click="dialogVisible = true">+ 新建用例</el-button>
        </div>
      </template>
      <div v-if="scenario?.description" class="muted">{{ scenario.description }}</div>
      <div v-if="scenario?.last_run" class="muted" style="margin-top: 6px">
        最近一次运行：{{ formatTime(scenario.last_run.created_at) }} ·
        {{ scenario.last_run.case_name }} ·
        <StatusTag :status="scenario.last_run.status" />
      </div>
    </el-card>

    <el-card>
      <template #header>
        <div style="display: flex; align-items: center; gap: 8px">
          <b>用例</b>
          <span class="muted">共 {{ cases.length }} 个</span>
        </div>
      </template>
      <el-table :data="cases" size="small" empty-text="这个场景下还没有用例">
        <el-table-column label="用例" min-width="220">
          <template #default="{ row }">
            <span class="link" style="color: #409eff; cursor: pointer" @click="openCase(row)">{{ row.name }}</span>
            <div class="muted">{{ row.id }} · v{{ row.version }} · {{ row.updated_by }} {{ formatDateTime(row.updated_at) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="优先级" width="80">
          <template #default="{ row }"><el-tag size="small" disable-transitions>{{ row.priority }}</el-tag></template>
        </el-table-column>
        <el-table-column label="标签" width="140">
          <template #default="{ row }">
            <span v-if="row.tags?.length" class="muted">{{ row.tags.join(' / ') }}</span>
            <span v-else class="muted">—</span>
          </template>
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
        <el-table-column label="操作" width="190">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openCase(row)">打开</el-button>
            <el-button size="small" text type="primary" @click="runCase(row.id)">运行</el-button>
            <el-dropdown trigger="click">
              <el-button size="small" text>更多</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="copyCase(row)">复制</el-dropdown-item>
                  <el-dropdown-item divided @click="deleteCase(row)">删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <CaseDialog
      v-model="dialogVisible"
      :scenario-id="scenarioId"
      :scenario-name="scenario?.name || ''"
      :priority="scenario?.priority || 'P2'"
      :owner="scenario?.owner || ''"
      :cases="cases"
      @saved="load"
    />
    <ScenarioDialog v-model="editVisible" :scenario="scenario" :envs="ui.envs" @saved="load" />
  </div>
</template>
