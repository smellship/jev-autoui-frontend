import { ElMessage } from 'element-plus'

import { ApiError } from '@/api/client'
import type { LintItem } from '@/api/types'

/** 后端错误体统一处理：校验类错误把行号带出来（§8.8 校验失败给行号）。 */
export function showApiError(error: unknown, fallback = '操作失败'): void {
  if (error instanceof ApiError) {
    const errors = (error.detail?.errors as LintItem[] | undefined) || []
    if (errors.length) {
      const first = errors[0]
      ElMessage.error({ message: `${error.message}：第 ${first.line} 行 ${first.message}`, duration: 6000 })
      return
    }
    ElMessage.error({ message: error.message, duration: 4000 })
    return
  }
  ElMessage.error({ message: error instanceof Error ? error.message : fallback, duration: 4000 })
}
