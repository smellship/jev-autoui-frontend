<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

import { scenarioApi } from '@/api'
import type { CaseBrief, Priority } from '@/api/types'
import { PRIORITIES } from '@/utils/format'
import { showApiError } from '@/utils/notify'

const props = defineProps<{
  modelValue: boolean
  scenarioId: string
  scenarioName: string
  priority: string
  owner: string
  cases: CaseBrief[]
}>()

const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [CaseBrief] }>()

const name = ref('')
const chosenPriority = ref<Priority>('P2')
const template = ref<'blank' | 'copy'>('blank')
const copyFrom = ref('')
const submitting = ref(false)

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return
    name.value = ''
    chosenPriority.value = (props.priority as Priority) || 'P2'
    template.value = 'blank'
    copyFrom.value = ''
  },
)

async function submit(): Promise<void> {
  if (!name.value.trim()) {
    ElMessage.warning('名称必填')
    return
  }
  if (template.value === 'copy' && !copyFrom.value) {
    ElMessage.warning('选一个要被复制的用例')
    return
  }
  submitting.value = true
  try {
    const created = await scenarioApi.createCase(props.scenarioId, {
      name: name.value.trim(),
      priority: chosenPriority.value,
      owner: props.owner,
      template: template.value,
      ...(template.value === 'copy' ? { copy_from: copyFrom.value } : {}),
    })
    ElMessage.success(`已新建 ${created.id}（id 由后端分配）`)
    emit('saved', created)
    emit('update:modelValue', false)
  } catch (error) {
    showApiError(error, '新建用例失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="`在「${scenarioName}」下新建用例`"
    width="480px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-form label-width="86px" @submit.prevent>
      <el-form-item label="用例名称" required>
        <el-input v-model="name" placeholder="例如：登录后能看到工作台" maxlength="80" />
      </el-form-item>
      <el-form-item label="优先级">
        <el-select v-model="chosenPriority" style="width: 140px">
          <el-option v-for="item in PRIORITIES" :key="item" :label="item" :value="item" />
        </el-select>
        <span class="muted" style="margin-left: 8px">默认继承场景</span>
      </el-form-item>
      <el-form-item label="模板">
        <el-radio-group v-model="template">
          <el-radio value="blank">空白</el-radio>
          <el-radio value="copy" :disabled="!cases.length">复制现有</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="template === 'copy'" label="复制自">
        <el-select v-model="copyFrom" filterable style="width: 100%" placeholder="选一个用例">
          <el-option v-for="item in cases" :key="item.id" :label="`${item.name}（${item.id}）`" :value="item.id" />
        </el-select>
      </el-form-item>
      <div class="muted" style="margin-left: 86px">id 由后端按场景自动分配（如 sc-0001-01）；创建即落 v1。</div>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">新建</el-button>
    </template>
  </el-dialog>
</template>
