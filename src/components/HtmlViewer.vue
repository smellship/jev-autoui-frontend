<script setup lang="ts">
import { computed } from 'vue'

import { useArtifactUrl } from '@/utils/artifact'

const props = defineProps<{ modelValue: boolean; url: string; title?: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; 'open-tab': [] }>()

const visible = computed(() => props.modelValue)
const source = computed(() => (visible.value && props.url ? props.url : null))
const { url: blobUrl, error } = useArtifactUrl(() => source.value)
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title || '产物预览'"
    width="90%"
    top="4vh"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- 报告由内核按用例文本生成，禁脚本执行；要交互就到新标签里看 -->
    <div v-loading="!blobUrl && !error" style="height: 72vh">
      <el-alert
        v-if="error"
        type="error"
        :closable="false"
        :title="`读取失败：${error}`"
      />
      <iframe
        v-else-if="blobUrl"
        :src="blobUrl"
        sandbox="allow-same-origin"
        style="width: 100%; height: 100%; border: 1px solid #ebeef5; border-radius: 4px"
      />
    </div>
    <template #footer>
      <el-button text type="primary" @click="emit('open-tab')">新标签打开</el-button>
      <el-button @click="emit('update:modelValue', false)">关闭</el-button>
    </template>
  </el-dialog>
</template>
