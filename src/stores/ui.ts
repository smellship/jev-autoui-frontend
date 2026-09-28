import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { envApi, healthApi, runApi } from '@/api'
import type { Env, Mode, RunBrief } from '@/api/types'

const ENV_KEY = 'ui_web_env_id'
const MODE_KEY = 'ui_web_mode'

export const useUiStore = defineStore('ui', () => {
  const envs = ref<Env[]>([])
  const envId = ref<number | null>(Number(localStorage.getItem(ENV_KEY)) || null)
  const mode = ref<Mode>((localStorage.getItem(MODE_KEY) as Mode) || 'debug')
  const pending = ref(0)
  const running = ref<RunBrief | null>(null)
  let timer: number | null = null

  const currentEnv = computed(() => envs.value.find((item) => item.id === envId.value) || null)
  const envLabel = computed(() => {
    if (!currentEnv.value) return ''
    const env = currentEnv.value
    return env.label ? `${env.label}（${env.name}）` : env.name
  })

  async function loadEnvs(): Promise<void> {
    const data = await envApi.list()
    envs.value = data.items
    if (envId.value === null || !envs.value.some((item) => item.id === envId.value)) {
      const firstConfigured = envs.value.find((item) => item.configured) || envs.value[0]
      setEnv(firstConfigured ? firstConfigured.id : null)
    }
  }

  function setEnv(id: number | null): void {
    envId.value = id
    if (id === null) localStorage.removeItem(ENV_KEY)
    else localStorage.setItem(ENV_KEY, String(id))
  }

  function setMode(value: Mode): void {
    mode.value = value
    localStorage.setItem(MODE_KEY, value)
  }

  /** 队列：后端串行执行，这里只读健康检查与"当前运行中"的那一条。 */
  async function refreshQueue(): Promise<void> {
    try {
      const health = await healthApi.health()
      const queue = (health.queue || {}) as { pending?: number }
      pending.value = queue.pending ?? 0
    } catch {
      pending.value = 0
    }
    try {
      const data = await runApi.list({ status: 'running', size: 1 })
      running.value = data.items[0] || null
    } catch {
      running.value = null
    }
  }

  function startQueuePolling(): void {
    if (timer !== null) return
    void refreshQueue()
    timer = window.setInterval(() => void refreshQueue(), 5000)
  }

  function stopQueuePolling(): void {
    if (timer !== null) window.clearInterval(timer)
    timer = null
  }

  return {
    envs,
    envId,
    mode,
    pending,
    running,
    currentEnv,
    envLabel,
    loadEnvs,
    setEnv,
    setMode,
    refreshQueue,
    startQueuePolling,
    stopQueuePolling,
  }
})
