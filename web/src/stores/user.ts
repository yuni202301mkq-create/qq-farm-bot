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
}

export const useUserStore = defineStore('user', () => {
  const token = useStorage('admin_token', '')
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

  function clearSession() {
    token.value = ''
    userInfo.value = null
  }

  async function fetchUserInfo() {
    try {
      const { data } = await api.get('/api/user/me')
      if (data?.ok) {
        userInfo.value = {
          username: data.data.username,
          role: data.data.role === 'super_admin' ? 'super_admin' : 'user',
          card: data.data.card ?? null,
          accountLimit: data.data.accountLimit ?? 2,
          expiresAt: data.data.expiresAt ?? null,
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
    userInfo,
    isLoggedIn,
    isAdmin,
    isSuperAdmin,
    username,
    avatar,
    accountLimit,
    expiresAt,
    isExpired,
    clearSession,
    fetchUserInfo,
  }
})
