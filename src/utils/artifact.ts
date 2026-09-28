import { onUnmounted, ref, watch } from 'vue'

import { http } from '@/api/client'

/** 产物访问要带 Bearer 头，<img>/<a> 带不了 → 先取 blob 再转 object URL。 */
export function useArtifactUrl(source: () => string | null) {
  const url = ref('')
  const error = ref('')
  let objectUrl = ''

  const revoke = (): void => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
      objectUrl = ''
    }
  }

  watch(
    source,
    async (src) => {
      revoke()
      url.value = ''
      error.value = ''
      if (!src) return
      try {
        const response = await http.get<Blob>(src, { baseURL: '', responseType: 'blob', timeout: 60_000 })
        objectUrl = URL.createObjectURL(response.data)
        url.value = objectUrl
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err)
      }
    },
    { immediate: true },
  )

  onUnmounted(revoke)
  return { url, error }
}

export async function fetchArtifactText(url: string): Promise<string> {
  const response = await http.get<string>(url, { baseURL: '', responseType: 'text', timeout: 60_000 })
  return typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2)
}

/** report.html 也要带 token，转成 blob 再新开标签页。 */
export async function openArtifactTab(url: string): Promise<void> {
  // 先同步开空白页：await 之后 window.open 会丢掉用户手势，被浏览器弹窗拦截拦住
  const tab = window.open('', '_blank')
  try {
    const response = await http.get<Blob>(url, { baseURL: '', responseType: 'blob', timeout: 60_000 })
    const objectUrl = URL.createObjectURL(response.data)
    if (tab) tab.location.href = objectUrl
    else window.open(objectUrl, '_blank')
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  } catch (err) {
    tab?.close()
    throw err
  }
}

export async function downloadArtifact(url: string, filename: string): Promise<void> {
  const response = await http.get<Blob>(url, { baseURL: '', responseType: 'blob', timeout: 60_000 })
  const objectUrl = URL.createObjectURL(response.data)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}
