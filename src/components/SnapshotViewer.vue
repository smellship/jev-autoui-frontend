<script setup lang="ts">
import { ref, watch } from 'vue'

import { fetchArtifactText } from '@/utils/artifact'

const props = defineProps<{
  modelValue: boolean
  url: string | null
  title?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const text = ref('')
const loading = ref(false)
const error = ref('')

watch(
  () => [props.modelValue, props.url] as const,
  async ([visible, url]) => {
    if (!visible || !url) return
    loading.value = true
    error.value = ''
    text.value = ''
    try {
      const raw = await fetchArtifactText(url)
      try {
        text.value = JSON.stringify(JSON.parse(raw), null, 2)
      } catch {
        text.value = raw
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title || '喂给模型的那份 state（快照）'"
    width="72%"
    top="6vh"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-loading="loading" style="max-height: 68vh; overflow: auto">
      <el-alert v-if="error" type="error" :closable="false" :title="error" />
      <pre v-else class="plan-tree" style="max-height: 66vh; overflow: auto">{{ text }}</pre>
    </div>
    <template #footer>
      <span class="muted">用来回答「它当时看到什么、为什么点这个」</span>
      <el-button type="primary" @click="emit('update:modelValue', false)">关闭</el-button>
    </template>
  </el-dialog>
</template>
