<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

import { envApi } from '@/api'
import type { ProbeResult } from '@/api/types'
import { formatTime } from '@/utils/format'

const props = defineProps<{ envId: number | null; envName?: string }>()

const loading = ref(false)
const visible = ref(false)
const result = ref<ProbeResult | null>(null)

function authText(value: boolean | null, yes: string, no: string): string {
  if (value === null || value === undefined) return '未知'
  return value ? yes : no
}

async function probe(): Promise<void> {
  if (!props.envId) {
    ElMessage.warning('先在顶栏选一个环境，或去「环境管理」建一个')
    return
  }
  loading.value = true
  try {
    result.value = await envApi.probe(props.envId)
    visible.value = true
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <span>
    <el-button size="small" :loading="loading" @click="probe">探针</el-button>
    <el-dialog v-model="visible" title="探针结果（服务器侧只读打开）" width="560px">
      <el-descriptions v-if="result" :column="1" border size="small">
        <el-descriptions-item label="环境">{{ result.env }}</el-descriptions-item>
        <el-descriptions-item label="最终地址">
          <span class="mono">{{ result.final_url }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="标题">{{ result.title || '（无）' }}</el-descriptions-item>
        <el-descriptions-item label="元素数">{{ result.element_count }}</el-descriptions-item>
        <el-descriptions-item label="登录页">
          {{ authText(result.needs_login, '是', '否') }}
        </el-descriptions-item>
        <el-descriptions-item label="有密码框">
          {{ authText(result.has_password_field, '是', '否') }}
        </el-descriptions-item>
        <el-descriptions-item label="时间">{{ formatTime(result.at) }}</el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <span class="muted">探测结果同时写入环境的页清单（§8.6）</span>
        <el-button type="primary" @click="visible = false">知道了</el-button>
      </template>
    </el-dialog>
  </span>
</template>
