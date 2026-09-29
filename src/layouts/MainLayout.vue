<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ProbeButton from '@/components/ProbeButton.vue'
import type { Mode } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { formatDuration } from '@/utils/format'

const ui = useUiStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const NAV = [
  { name: 'cases', label: '用例管理' },
  { name: 'scenes', label: '场景管理' },
  { name: 'runs', label: '运行记录' },
  { name: 'envs', label: '环境管理' },
  { name: 'settings', label: '用户/设置' },
]

const activeNav = computed(() => {
  const name = String(route.name || '')
  if (name === 'scenario' || name === 'case-detail') return 'cases'
  if (name === 'scene-new' || name === 'scene-detail') return 'scenes'
  return name
})

const now = ref(Date.now())
let ticker: number | null = null

const elapsed = computed(() => {
  const run = ui.running
  if (!run) return ''
  const started = run.started_at ? new Date(run.started_at).getTime() : new Date(run.created_at || '').getTime()
  if (!started || Number.isNaN(started)) return ''
  void now.value
  return formatDuration(Date.now() - started)
})

function onModeChange(value: string | number | boolean | undefined): void {
  ui.setMode(value as Mode)
}

function openRunning(): void {
  const run = ui.running
  if (run?.case_id) void router.push({ name: 'case-detail', params: { id: run.case_id } })
  else void router.push({ name: 'runs' })
}

function logout(): void {
  auth.logout()
  ui.stopQueuePolling()
  void router.replace({ name: 'login' })
}

watch(
  () => auth.isLoggedIn,
  (loggedIn) => {
    if (loggedIn) {
      ui.startQueuePolling()
      void ui.loadEnvs()
    } else {
      ui.stopQueuePolling()
    }
  },
  { immediate: true },
)

onMounted(() => {
  ticker = window.setInterval(() => (now.value = Date.now()), 1000)
})

onUnmounted(() => {
  if (ticker !== null) window.clearInterval(ticker)
  ui.stopQueuePolling()
})
</script>

<template>
  <div style="height: 100%">
    <header class="topbar">
      <div class="brand">UI 测试平台</div>

      <span style="display: flex; align-items: center; gap: 6px">
        <span class="muted">环境</span>
        <el-select
          :model-value="ui.envId"
          size="small"
          style="width: 220px"
          placeholder="未选环境"
          @update:model-value="ui.setEnv($event as number | null)"
        >
          <el-option
            v-for="env in ui.envs"
            :key="env.id"
            :label="env.label ? `${env.label}（${env.name}）` : env.name"
            :value="env.id"
            :disabled="!env.configured"
          >
            <span>{{ env.label ? `${env.label}（${env.name}）` : env.name }}</span>
            <span v-if="!env.configured" class="muted" style="margin-left: 8px">未配地址</span>
          </el-option>
        </el-select>
        <ProbeButton :env-id="ui.envId" />
      </span>

      <span style="display: flex; align-items: center; gap: 6px">
        <span class="muted">模式</span>
        <el-radio-group
          :model-value="ui.mode"
          size="small"
          @update:model-value="onModeChange($event as Mode)"
        >
          <el-radio-button value="debug">debug</el-radio-button>
          <el-radio-button value="ci">ci</el-radio-button>
        </el-radio-group>
      </span>

      <div class="spacer" />

      <span class="queue-pill" @click="openRunning">
        <template v-if="ui.running">
          运行中：{{ ui.running.case_name }}<span v-if="elapsed"> · {{ elapsed }}</span>
        </template>
        <template v-else>队列 {{ ui.pending }}</template>
      </span>

      <el-dropdown>
        <span style="cursor: pointer">{{ auth.displayName || '未登录' }}</span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item disabled>{{ auth.user?.account }}</el-dropdown-item>
            <el-dropdown-item divided @click="logout">退出登录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </header>

    <div style="display: flex; height: calc(100% - var(--app-header-height))">
      <aside class="side">
        <div
          v-for="item in NAV"
          :key="item.name"
          class="nav-item"
          :class="{ active: activeNav === item.name }"
          @click="router.push({ name: item.name })"
        >
          {{ item.label }}
        </div>
        <div class="foot">
          <div v-if="ui.envLabel">环境：{{ ui.envLabel }}</div>
          <div>模式：{{ ui.mode }}（可覆盖）</div>
        </div>
      </aside>

      <main style="flex: 1; min-width: 0; overflow: auto">
        <router-view />
      </main>
    </div>
  </div>
</template>
