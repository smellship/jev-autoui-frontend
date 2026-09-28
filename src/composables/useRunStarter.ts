import { ElMessage, ElMessageBox } from 'element-plus'

import { runApi, scenarioApi } from '@/api'
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

  /** 整场景串跑：逐个入队（服务端串行执行，不并发）。 */
  async function runScenario(scenarioId: string, name: string, mode?: Mode): Promise<void> {
    const envId = requireEnv()
    if (envId === null) return
    const chosen = mode || ui.mode
    let items: Array<{ id: string; name: string }> = []
    try {
      const data = await scenarioApi.cases(scenarioId)
      items = data.items
    } catch (error) {
      showApiError(error, '取用例列表失败')
      return
    }
    if (!items.length) {
      ElMessage.warning('这个场景下还没有用例')
      return
    }
    try {
      await ElMessageBox.confirm(
        `把「${name}」下的 ${items.length} 个用例按顺序入队（${chosen}），服务端串行执行。`,
        '整场景串跑',
        { type: 'info', confirmButtonText: '入队', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    const failed: string[] = []
    let queued = 0
    for (const item of items) {
      try {
        await runApi.create({ case_id: item.id, env_id: envId, mode: chosen })
        queued += 1
      } catch {
        failed.push(item.name)
      }
    }
    await ui.refreshQueue()
    if (failed.length) {
      ElMessage.warning(`入队 ${queued} 个；${failed.length} 个没入队：${failed.join('、')}`)
    } else {
      ElMessage.success(`已入队 ${queued} 个（${chosen}）`)
    }
  }

  return { runCase, runScenario }
}
