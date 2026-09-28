<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

import { scenarioApi } from '@/api'
import type { Env, Scenario } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { PRIORITIES } from '@/utils/format'
import { showApiError } from '@/utils/notify'

const props = defineProps<{
  modelValue: boolean
  scenario?: Scenario | null
  nodeId?: number | null
  envs: Env[]
}>()

const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [] }>()

const auth = useAuthStore()
const saving = ref(false)

const form = reactive({
  name: '',
  priority: 'P2',
  owner: '',
  tags: [] as string[],
  description: '',
  env_id: null as number | null,
})

const title = computed(() => (props.scenario ? `编辑场景 · ${props.scenario.name}` : '添加场景'))

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return
    const scenario = props.scenario
    form.name = scenario?.name || ''
    form.priority = scenario?.priority || 'P2'
    form.owner = scenario?.owner || auth.displayName
    form.tags = [...(scenario?.tags || [])]
    form.description = scenario?.description || ''
    form.env_id = scenario?.env_id ?? null
  },
)

function close(): void {
  emit('update:modelValue', false)
}

async function submit(): Promise<void> {
  if (!form.name.trim()) {
    ElMessage.warning('场景名称必填')
    return
  }
  saving.value = true
  try {
    if (props.scenario) {
      await scenarioApi.update(props.scenario.id, {
        name: form.name.trim(),
        priority: form.priority,
        owner: form.owner,
        tags: form.tags,
        description: form.description,
        env_id: form.env_id,
      })
    } else {
      if (!props.nodeId) {
        ElMessage.warning('先在左侧选一个节点')
        return
      }
      await scenarioApi.create({
        node_id: props.nodeId,
        name: form.name.trim(),
        priority: form.priority,
        owner: form.owner,
        tags: form.tags,
        description: form.description,
        env_id: form.env_id,
      })
    }
    ElMessage.success('已保存')
    emit('saved')
    close()
  } catch (error) {
    showApiError(error, '保存场景失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" :title="title" width="520px" @update:model-value="emit('update:modelValue', $event)">
    <el-form label-width="88px">
      <el-form-item label="名称" required>
        <el-input v-model="form.name" placeholder="如：手工查验" maxlength="128" />
      </el-form-item>
      <el-form-item label="优先级" required>
        <el-radio-group v-model="form.priority">
          <el-radio-button v-for="item in PRIORITIES" :key="item" :value="item">{{ item }}</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="负责人">
        <el-input v-model="form.owner" placeholder="默认当前登录用户" />
      </el-form-item>
      <el-form-item label="标签">
        <el-select v-model="form.tags" multiple filterable allow-create default-first-option
                   placeholder="冒烟 / 回归 …" style="width: 100%" />
      </el-form-item>
      <el-form-item label="默认环境">
        <el-select v-model="form.env_id" clearable placeholder="不指定则用顶栏环境" style="width: 100%">
          <el-option v-for="env in envs" :key="env.id" :label="env.label ? `${env.label}（${env.name}）` : env.name"
                     :value="env.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="form.description" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>
