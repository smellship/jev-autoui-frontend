import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { authApi } from '@/api'
import { TOKEN_KEY } from '@/api/client'
import type { User } from '@/api/types'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem(TOKEN_KEY) || '')
  const user = ref<User | null>(null)
  const loaded = ref(false)

  const isLoggedIn = computed(() => Boolean(token.value))
  const isAdmin = computed(() => Boolean(user.value?.is_admin))
  const displayName = computed(() => user.value?.name || user.value?.account || '')

  function setToken(value: string): void {
    token.value = value
    if (value) localStorage.setItem(TOKEN_KEY, value)
    else localStorage.removeItem(TOKEN_KEY)
  }

  /** 改自己的昵称：成功后同步顶栏与设置页显示。 */
  async function updateName(name: string): Promise<void> {
    user.value = await authApi.updateMe(name)
  }

  async function login(account: string, password: string): Promise<void> {
    const result = await authApi.login(account, password)
    setToken(result.token)
    user.value = result.user
    loaded.value = true
  }

  async function loadMe(): Promise<void> {
    if (!token.value) {
      loaded.value = true
      return
    }
    try {
      user.value = await authApi.me()
    } catch {
      setToken('')
      user.value = null
    } finally {
      loaded.value = true
    }
  }

  function logout(): void {
    setToken('')
    user.value = null
  }

  return { token, user, loaded, isLoggedIn, isAdmin, displayName, login, loadMe, updateName, logout }
})
