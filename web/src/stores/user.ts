import { StorageSerializers, useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'
import api from '@/api'

export type UserRole = 'super_admin' | 'user'

export interface AdminUser {
  username: string
  role: UserRole
  card: string | null
  accountLimit: number
  expiresAt?: number | null
  avatar?: string
  /** 仍在使用出厂初始口令，必须先改密才能使用面板 */
  mustChangePassword?: boolean
}

export const useUserStore = defineStore('user', () => {
  const token = useStorage('admin_token', '')
  // 长期登录用的 refresh token（服务端落盘），bot 重启后凭它换新的 session token
  const refreshToken = useStorage('admin_refresh_token', '')
  const userInfo = useStorage<AdminUser | null>('user_info', null, undefined, { serializer: StorageSerializers.object })
  const isLoggedIn = computed(() => !!token.value)
  // 超级管理员
  const isSuperAdmin = computed(() => userInfo.value?.role === 'super_admin')
  // 兼容旧字段：管理员=超级管理员
  const isAdmin = isSuperAdmin
  const username = computed(() => userInfo.value?.username || '')
  const avatar = computed(() => userInfo.value?.avatar || '')
  const accountLimit = computed(() =>
    isSuperAdmin.value ? Number.MAX_SAFE_INTEGER : Number(userInfo.value?.accountLimit || 0))
  const expiresAt = computed(() => userInfo.value?.expiresAt || null)
  const isExpired = computed(() =>
    !isSuperAdmin.value && Boolean(expiresAt.value && Date.now() > Number(expiresAt.value)))
  const mustChangePassword = computed(() => userInfo.value?.mustChangePassword === true)

  function clearSession() {
    token.value = ''
    refreshToken.value = ''
    userInfo.value = null
  }

  /** 改密成功后本地同步，避免路由守卫再次把用户送回强制改密页 */
  function markPasswordChanged() {
    if (userInfo.value)
      userInfo.value = { ...userInfo.value, mustChangePassword: false }
  }

  async function fetchUserInfo() {
    try {
      const { data } = await api.get('/api/user/me')
      if (data?.ok) {
        userInfo.value = {
          username: data.data.username,
          role: data.data.role === 'super_admin' ? 'super_admin' : 'user',
          card: data.data.card ?? null,
          accountLimit: data.data.accountLimit ?? 1,
          expiresAt: data.data.expiresAt ?? null,
          mustChangePassword: data.data.mustChangePassword === true,
        }
      }
      return data
    }
    catch {
      return { ok: false }
    }
  }

  return {
    token,
    refreshToken,
    userInfo,
    isLoggedIn,
    isAdmin,
    isSuperAdmin,
    username,
    avatar,
    accountLimit,
    expiresAt,
    isExpired,
    mustChangePassword,
    clearSession,
    markPasswordChanged,
    fetchUserInfo,
  }
})
