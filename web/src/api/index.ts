import { useStorage } from '@vueuse/core'
import axios from 'axios'
import { useToastStore } from '@/stores/toast'

const tokenRef = useStorage('admin_token', '')
// 长期登录：落盘在服务端、存这里的 refresh token，bot 重启后用来换新的 session token
const refreshTokenRef = useStorage('admin_refresh_token', '')
const accountIdRef = useStorage('current_account_id', '')

const api = axios.create({
  baseURL: '/',
  timeout: 20000,
})

let lastNetworkToastAt = 0
function showNetworkToast(message: string) {
  const now = Date.now()
  if (now - lastNetworkToastAt < 5000)
    return
  lastNetworkToastAt = now
  useToastStore().error(message)
}

/** 清掉本地登录态并跳登录页 */
function clearAuthAndRedirect(message: string) {
  tokenRef.value = ''
  refreshTokenRef.value = ''
  if (!window.location.pathname.includes('/login')) {
    window.location.href = '/login'
  }
  if (message)
    useToastStore().warning(message)
}

// 并发请求同时 401 时只发一次刷新，避免把 refresh token 轮换掉导致互相踩踏
let refreshPromise: Promise<string> | null = null

async function requestNewSessionToken(): Promise<string> {
  const current = refreshTokenRef.value
  if (!current)
    throw new Error('no refresh token')
  const { data } = await axios.post(
    '/api/auth/refresh',
    { refreshToken: current },
    { timeout: 15000 },
  )
  const payload = data?.data || {}
  if (!payload?.token)
    throw new Error('refresh failed')
  tokenRef.value = payload.token
  // rotate 会签发新的 refresh token，旧的同时作废
  if (payload.refreshToken)
    refreshTokenRef.value = payload.refreshToken
  return payload.token
}

function ensureRefresh(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = requestNewSessionToken().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

api.interceptors.request.use((config) => {
  const token = tokenRef.value
  if (token) {
    config.headers['x-admin-token'] = token
  }
  const accountId = accountIdRef.value
  if (accountId) {
    config.headers['x-account-id'] = accountId
  }
  return config
}, error => Promise.reject(error))

api.interceptors.response.use((response) => {
  return response
}, async (error) => {
  if (axios.isCancel(error) || error?.code === 'ERR_CANCELED') {
    return Promise.reject(error)
  }

  // 401 先自救：拿长期 refresh token 换新的 session token，成功就重放原请求。
  // 这样 bot 重启（内存 session 全丢）后用户不会被踢去重新登录。
  if (error.response?.status === 401) {
    const config = error.config as (typeof error.config & { __retried?: boolean }) | undefined
    const onLoginPage = window.location.pathname.includes('/login')
    const isRefreshCall = String(config?.url || '').includes('/api/auth/refresh')

    if (config && !onLoginPage && !isRefreshCall && !config.__retried && refreshTokenRef.value) {
      config.__retried = true
      try {
        const newToken = await ensureRefresh()
        config.headers = { ...(config.headers || {}), 'x-admin-token': newToken }
        return api.request(config)
      }
      catch {
        // 刷新失败（过期 / 被撤销 / 服务端没启用），落到下面统一的「清 token + 跳登录」
      }
    }
  }

  if (error?.config?.skipErrorToast === true)
    return Promise.reject(error)

  const toast = useToastStore()

  if (error.response) {
    if (error.response.status === 401) {
      if (!window.location.pathname.includes('/login')) {
        clearAuthAndRedirect('登录已过期，请重新登录')
      }
    }
    else if (error.response.status >= 500) {
      const backendError = String(error.response.data?.error || error.response.data?.message || '')
      if (backendError === '账号未运行' || backendError === 'API Timeout' || backendError === 'Request Timeout') {
        return Promise.reject(error)
      }
      toast.error(`服务器错误 ${error.response.status} ${error.response.statusText}`)
    }
    else if (error.response.status === 404) {
      toast.error('接口不存在（404），请将服务端更新到最新版本并重启')
    }
    else {
      const backendError = String(error.response.data?.error || error.response.data?.message || '').trim()
      toast.error(backendError || `请求失败 (${error.response.status})`)
    }
  }
  else if (error.request) {
    if (error.code === 'ECONNABORTED') {
      showNetworkToast('请求超时，请稍后重试')
    }
    else {
      showNetworkToast('网络错误，无法连接到服务器')
    }
  }
  else {
    toast.error(`错误: ${error.message}`)
  }

  return Promise.reject(error)
})

export default api
