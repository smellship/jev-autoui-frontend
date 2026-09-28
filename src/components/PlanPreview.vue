<script setup lang="ts">
import { computed, ref } from 'vue'

interface PlanStep {
  goal?: string
  url?: string
  checks?: Array<{ kind?: string; value?: string; expected?: string; role?: string }>
}

interface Plan {
  name?: string
  url?: string
  steps?: PlanStep[]
  vars?: Record<string, string>
  notes?: string
}

const props = defineProps<{
  plan: Plan | Record<string, unknown> | null
  loading?: boolean
}>()

const showRaw = ref(false)

const typed = computed<Plan | null>(() => (props.plan as Plan) || null)
const raw = computed(() => JSON.stringify(props.plan ?? {}, null, 2))

function checkText(check: { kind?: string; value?: string; expected?: string; role?: string }): string {
  const value = check.value || check.expected || ''
  const role = check.role ? ` role=${check.role}` : ''
  return `${check.kind || '?'}『${value}』${role}`
}
</script>

<template>
  <div v-loading="loading">
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px">
      <span class="muted">与运行用的是同一份；保存或点「校验」后刷新</span>
      <div style="flex: 1" />
      <el-button size="small" text type="primary" @click="showRaw = !showRaw">
        {{ showRaw ? '看结构化' : '看原始 JSON' }}
      </el-button>
    </div>

    <div v-if="!typed" class="empty-block">
      还没有编译结果<br />
      <span class="muted">点「校验」或保存后自动编译</span>
    </div>

    <template v-else-if="!showRaw">
      <div class="plan-tree">
        <div><span class="muted">name:</span> {{ typed.name || '—' }}</div>
        <div>
          <span class="muted">url:</span>
          {{ typed.url || '""（环境注入）' }}
        </div>
        <div style="margin-top: 6px"><span class="muted">steps:</span></div>
        <div v-for="(step, index) in typed.steps || []" :key="index" style="margin-left: 6px">
          <div>{{ index + 1 }} {{ step.goal }}</div>
          <div v-for="(check, ci) in step.checks || []" :key="ci" style="margin-left: 16px; color: #67c23a">
            ✓ {{ checkText(check) }}
          </div>
          <div v-if="step.url" style="margin-left: 16px" class="muted">url: {{ step.url }}</div>
        </div>
        <template v-if="typed.vars && Object.keys(typed.vars).length">
          <div style="margin-top: 6px"><span class="muted">vars:</span></div>
          <div v-for="(_, key) in typed.vars" :key="key" style="margin-left: 6px">
            {{ key }}=••••
          </div>
        </template>
        <div v-else style="margin-top: 6px" class="muted">vars: 无（不引密钥）</div>
      </div>
    </template>

    <pre v-else class="plan-tree" style="max-height: 60vh; overflow: auto">{{ raw }}</pre>
  </div>
</template>
