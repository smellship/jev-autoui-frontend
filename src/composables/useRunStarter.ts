import { ElMessage } from 'element-plus'

import { runApi } from '@/api'
import type { Mode, RunBrief } from '@/api/types'
import { useUiStore } from '@/stores/ui'
import { showApiError } from '@/utils/notify'

/** 运行入口统一走这里：环境取顶栏当前环境，模式默认取顶栏模式（用例页可单独指定）。 */
export function useRunStarter() {
  const ui = useUiStore()

  function requireEnv(): number | null {
    if (!ui.envId) {
      ElMessage.warning('先在顶栏选一个环境')
      return null
    }
    return ui.envId
  }

  async function runCase(caseId: string, mode?: Mode): Promise<RunBrief | null> {
    const envId = requireEnv()
    if (envId === null) return null
    const chosen = mode || ui.mode
    try {
      const run = await runApi.create({ case_id: caseId, env_id: envId, mode: chosen })
      ElMessage.success(run.queue_position ? `已入队（${chosen}），前面还有 ${run.queue_position - 1} 个` : `已开始（${chosen}）`)
      await ui.refreshQueue()
      return run
    } catch (error) {
      showApiError(error, '发起运行失败')
      return null
    }
  }

  return { runCase }
}
