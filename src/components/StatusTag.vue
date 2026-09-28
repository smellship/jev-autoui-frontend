<script setup lang="ts">
import { computed } from 'vue'

import { runStatusText, runStatusType, stepStatusText, stepStatusType } from '@/utils/format'

const props = defineProps<{
  status: string
  kind?: 'run' | 'step'
  size?: 'small' | 'default'
}>()

const text = computed(() => (props.kind === 'step' ? stepStatusText(props.status) : runStatusText(props.status)))
const type = computed(() => (props.kind === 'step' ? stepStatusType(props.status) : runStatusType(props.status)))
</script>

<template>
  <el-tag :type="type" :size="size || 'small'" disable-transitions>{{ text }}</el-tag>
</template>
