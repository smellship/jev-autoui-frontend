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
    <!-- teleported：必须挂到 body。留在 .shot-card 里会被 `.shot-card img` 的缩略图样式套住
         （大图被裁成 100%×132 的横条，看着像空白），点关闭的点击还会冒泡回卡片的 @click 立刻重开 -->
    <el-image-viewer
      v-if="visible && src"
      :url-list="[src]"
      teleported
      hide-on-click-modal
      @close="visible = false"
    />
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
