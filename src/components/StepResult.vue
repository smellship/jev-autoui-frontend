<script setup lang="ts">
import { computed } from 'vue'

import ArtifactImage from '@/components/ArtifactImage.vue'
import StatusTag from '@/components/StatusTag.vue'
import type { Artifact, RunDetail, StepResult } from '@/api/types'
import { formatSize } from '@/utils/format'

const props = defineProps<{ run: RunDetail }>()

interface Shot extends Artifact {
  caption: string
}

function shotsOf(dir: string): Shot[] {
  const prefix = `steps/${dir}/screenshots/`
  return props.run.artifacts
    .filter((item) => item.path.startsWith(prefix))
    .map((item) => ({ ...item, caption: item.path.split('/').pop() || item.path }))
}

const rootShots = computed<Shot[]>(() =>
  props.run.artifacts
    .filter((item) => item.kind === 'screenshot' && !item.path.startsWith('steps/'))
    .map((item) => ({ ...item, caption: item.path.split('/').pop() || item.path })),
)

const steps = computed<StepResult[]>(() => props.run.steps_detail || [])

function totalShots(): number {
  return rootShots.value.length + steps.value.reduce((sum, step) => sum + shotsOf(step.dir).length, 0)
}
</script>

<template>
  <div>
    <el-alert
      v-if="!steps.length"
      type="info"
      :closable="false"
      title="这次运行还没有逐步结果（可能还在跑，或运行在入队前就被中止）"
      style="margin-bottom: 10px"
    />

    <el-table v-if="steps.length" :data="steps" size="small" style="margin-bottom: 12px">
      <el-table-column label="#" width="46">
        <template #default="{ row }">
          {{ row.index }}<span v-if="row.attempt > 1" class="muted">-{{ row.attempt }}</span>
        </template>
      </el-table-column>
      <el-table-column label="步骤（目标）" min-width="200">
        <template #default="{ row }">
          <div>{{ row.goal }}</div>
          <div v-if="row.detail" class="muted">{{ row.detail }}</div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="96">
        <template #default="{ row }"><StatusTag kind="step" :status="row.status" /></template>
      </el-table-column>
      <el-table-column label="断言与证据" min-width="240">
        <template #default="{ row }">
          <div v-if="!row.checks?.length" class="muted">无断言（不计为成功）</div>
          <div v-for="(check, index) in row.checks" :key="index" style="font-size: 12.5px">
            <span :style="{ color: check.ok ? '#67c23a' : '#f56c6c' }">
              {{ check.ok ? '✓' : '✗' }} {{ check.kind }}『{{ check.expected }}』
            </span>
            <span v-if="!check.ok && check.evidence" class="muted"> — {{ check.evidence }}</span>
          </div>
          <el-tag v-if="false" />
        </template>
      </el-table-column>
      <el-table-column label="决策" width="66">
        <template #default="{ row }"><span class="muted">{{ row.decisions }}</span></template>
      </el-table-column>
      <el-table-column label="缺陷候选" min-width="140">
        <template #default="{ row }">
          <div v-if="!row.defects?.length" class="muted">—</div>
          <div v-for="(defect, index) in row.defects" :key="index" style="color: #e6a23c; font-size: 12.5px">
            {{ defect }}
          </div>
        </template>
      </el-table-column>
    </el-table>

    <el-divider content-position="left">截图（{{ totalShots() }} 张）</el-divider>
    <div v-if="!totalShots()" class="muted">
      ci 模式只留失败那一张；这张没有失败就没截图。要看逐步过程请用 debug 模式跑。
    </div>
    <template v-else>
      <div v-for="step in steps" :key="step.dir">
        <div v-if="shotsOf(step.dir).length" style="margin-bottom: 6px" class="muted">
          步骤 {{ step.index }} · {{ step.goal }}
        </div>
        <div class="shot-wall" style="margin-bottom: 10px">
          <ArtifactImage
            v-for="shot in shotsOf(step.dir)"
            :key="shot.path"
            :url="shot.url"
            :caption="`${shot.caption} · ${formatSize(shot.size)}`"
          />
        </div>
      </div>
      <div v-if="rootShots.length">
        <div class="muted" style="margin-bottom: 6px">运行目录根</div>
        <div class="shot-wall">
          <ArtifactImage
            v-for="shot in rootShots"
            :key="shot.path"
            :url="shot.url"
            :caption="`${shot.caption} · ${formatSize(shot.size)}`"
          />
        </div>
      </div>
    </template>
  </div>
</template>
