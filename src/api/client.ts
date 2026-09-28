import axios, { type AxiosError, type AxiosRequestConfig } from 'axios'

export const TOKEN_KEY = 'ui_web_token'

export interface ApiErrorBody {
  code: string
  message: string
  detail: Record<string, unknown>
}

/** 后端统一错误体（§11）：code / message / detail。 */
export class ApiError extends Error {
  status: number
  code: string
  detail: Record<string, unknown>

  constructor(status: number, body: Partial<ApiErrorBody> = {}) {
    super(body.message || '请求失败')
    this.name = 'ApiError'
    this.status = status
    this.code = body.code || 'unknown_error'
    this.detail = body.detail || {}
  }
}

let unauthorizedHandler: (() => void) | null = null

/** 由 auth store 注册：token 失效时统一跳登录。 */
export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler
}

/** 401 里只有这几类算「会话失效」。口令校验失败（bad_credentials/bad_password）是业务错误，
    只是这一次没通过，不能顺手把人踢下线。 */
const SESSION_EXPIRED_CODES = ['unauthorized', 'token_invalid', 'account_disabled']

export const http = axios.create({ baseURL: '/api/v1', timeout: 180_000 })

http.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorBody>) => {
    const status = error.response?.status ?? 0
    const body = error.response?.data
    const normalized =
      body && typeof body === 'object' && 'code' in body
        ? new ApiError(status, body)
        : new ApiError(status, { code: 'network_error', message: error.message || '网络异常', detail: {} })
    if (status === 401 && (!body || SESSION_EXPIRED_CODES.includes(normalized.code))) {
      localStorage.removeItem(TOKEN_KEY)
      unauthorizedHandler?.()
    }
    return Promise.reject(normalized)
  },
)

export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const { data } = await http.get<T>(url, { params })
  return data
}

export async function post<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const { data } = await http.post<T>(url, body ?? {}, config)
  return data
}

export async function put<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await http.put<T>(url, body ?? {})
  return data
}

export async function patch<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await http.patch<T>(url, body ?? {})
  return data
}

export async function del(url: string, params?: Record<string, unknown>): Promise<void> {
  await http.delete(url, { params })
}
