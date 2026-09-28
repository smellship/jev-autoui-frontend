import { TOKEN_KEY } from '@/api/client'
import type { TraceRow } from '@/api/types'

export interface RunEventHandlers {
  status?: (data: Record<string, unknown>) => void
  trace?: (row: TraceRow) => void
  done?: (data: Record<string, unknown>) => void
  error?: (error: unknown) => void
}

/**
 * 订阅运行事件。
 * 浏览器原生 EventSource 不能带 Authorization 头，所以这里用 fetch 读流自己切 SSE 帧。
 * 返回取消订阅函数。
 */
export function subscribeRunEvents(runId: string, handlers: RunEventHandlers): () => void {
  const controller = new AbortController()
  const token = localStorage.getItem(TOKEN_KEY) || ''

  const dispatch = (frame: string): void => {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (!dataLines.length) return
    let payload: unknown
    try {
      payload = JSON.parse(dataLines.join('\n'))
    } catch {
      return
    }
    if (event === 'status') handlers.status?.(payload as Record<string, unknown>)
    else if (event === 'trace') handlers.trace?.(payload as TraceRow)
    else if (event === 'done') handlers.done?.(payload as Record<string, unknown>)
  }

  void (async () => {
    try {
      const response = await fetch(`/api/v1/runs/${encodeURIComponent(runId)}/events`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        signal: controller.signal,
      })
      if (!response.ok || !response.body) throw new Error(`事件流不可用（HTTP ${response.status}）`)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        for (;;) {
          const cut = buffer.indexOf('\n\n')
          if (cut < 0) break
          const frame = buffer.slice(0, cut)
          buffer = buffer.slice(cut + 2)
          if (!frame.startsWith(':')) dispatch(frame)
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      handlers.error?.(error)
    }
  })()

  return () => controller.abort()
}
