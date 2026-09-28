<script setup lang="ts">
import { ref } from 'vue'

import { useArtifactUrl } from '@/utils/artifact'

const props = withDefaults(defineProps<{ url: string; caption?: string; height?: number }>(), {
  caption: '',
  height: 132,
})

const { url: src, error } = useArtifactUrl(() => props.url)
const visible = ref(false)
</script>

<template>
  <div class="shot-card" @click="src && (visible = true)">
    <img v-if="src" :src="src" :style="{ height: `${height}px` }" alt="截图" />
    <div v-else-if="error" class="shot-ph err">加载失败</div>
    <div v-else class="shot-ph">加载中…</div>
    <div class="cap">{{ caption }}</div>
    <el-image-viewer v-if="visible && src" :url-list="[src]" @close="visible = false" />
  </div>
</template>

<style scoped>
.shot-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 132px;
  background: #f5f7fa;
  color: #909399;
  font-size: 12px;
}

.shot-ph.err {
  color: #f56c6c;
}
</style>
