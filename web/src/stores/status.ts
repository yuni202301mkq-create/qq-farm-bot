import type { Socket } from 'socket.io-client'
import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { io } from 'socket.io-client'
import { computed, ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

// Define interfaces for better type checking
interface DailyGift {
  key: string
  label: string
  enabled?: boolean
  doneToday: boolean
  lastAt?: number
  completedCount?: number
  totalCount?: number
  tasks?: any[]
}

interface DailyGiftsResponse {
  date: string
  growth: DailyGift
  gifts: DailyGift[]
}

export const useStatusStore = defineStore('status', () => {
  const status = ref<any>(null)
  const logs = ref<any[]>([])
  const accountLogs = ref<any[]>([])
  const dailyGifts = ref<DailyGiftsResponse | null>(null)
  const statusAccountId = ref('')
  const loading = ref(false)
  const error = ref('')
  const realtimeConnected = ref(false)
  const realtimeLogsEnabled = ref(true)
  const currentRealtimeAccountId = ref('')
  const subscribedAccountId = ref('')
  const tokenRef = useStorage('admin_token', '')

  let socket: Socket | null = null

  function getCurrentAccountId() {
    const accountStore = useAccountStore()
    return String((accountStore.currentAccountId as { value?: string })?.value ?? accountStore.currentAccountId ?? '')
  }

  function isCurrentAccount(accountId: string) {
    return getCurrentAccountId() === String(accountId)
  }

  const currentStatusReady = computed(() => {
    const currentId = getCurrentAccountId()
    return !!currentId && !!status.value && statusAccountId.value === currentId
  })

  function normalizeStatusPayload(input: any) {
    return (input && typeof input === 'object') ? { ...input } : {}
  }

  function clearAccountScopedData() {
    status.value = null
    statusAccountId.value = ''
    logs.value = []
    accountLogs.value = []
    dailyGifts.value = null
    error.value = ''
  }

  function normalizeLogEntry(input: any) {
    const entry = (input && typeof input === 'object') ? { ...input } : {}
    const ts = Number(entry.ts) || Date.parse(String(entry.time || '').replace(' ', 'T')) || Date.now()
    return {
      ...entry,
      ts,
      time: entry.time || new Date(ts).toISOString().replace('T', ' ').slice(0, 19),
    }
  }

  function shouldHideLogEntryInFrontend(entry: any) {
    const text = [
      entry?.tag,
      entry?.msg,
      entry?.reason,
      entry?.action,
      entry?.meta ? JSON.stringify(entry.meta) : '',
    ].filter(Boolean).join(' ')
    return /\b(?:ACE|TSDK)\b/i.test(text)
  }

  function getLogIdentity(entry: any, source: 'runtime' | 'account') {
    if (entry?.logId)
      return String(entry.logId)
    const ts = Number(entry?.ts) || Date.parse(String(entry?.time || '').replace(' ', 'T')) || 0
    return [source, entry?.accountId || entry?.id || '', ts, entry?.action || '', entry?.tag || '', entry?.msg || ''].join('|')
  }

  function uniqueLogs(list: any[], source: 'runtime' | 'account') {
    const seen = new Set<string>()
    return list.filter((entry) => {
      const identity = getLogIdentity(entry, source)
      if (seen.has(identity))
        return false
      seen.add(identity)
      return true
    })
  }

  // 客户端聚合上限：超过后从最旧开始丢弃，防止长时间运行内存无限增长
  const RUNTIME_LOG_CLIENT_CAP = 2000
  const ACCOUNT_LOG_CLIENT_CAP = 1000

  /** 与服务端一致的 UTC+8 日期 key（每日零点清理口径） */
  function utc8DayKey(ts: number) {
    const d = new Date((Number(ts) || 0) + 8 * 60 * 60 * 1000)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }

  /**
   * 按身份合并日志：轮询/快照到达时与现有列表取并集，而不是整表替换。
   * 服务端各缓冲是滑动窗口，整表替换会让面板日志随新日志到来一条条从
   * 头部消失（表现为「日志一点一点变少」）；合并后单次会话内日志只增不减，
   * 跨天条目按服务端每日清理口径过滤，超上限再从最旧丢弃。
   */
  function mergeLogsById(existing: any[], incoming: any[], source: 'runtime' | 'account', cap: number) {
    const map = new Map<string, any>()
    for (const item of existing || [])
      map.set(getLogIdentity(item, source), item)
    for (const item of incoming || [])
      map.set(getLogIdentity(item, source), item)
    const todayKey = utc8DayKey(Date.now())
    return [...map.values()]
      .filter(item => utc8DayKey(Number(item?.ts) || 0) === todayKey)
      .sort((a, b) => (Number(a?.ts) || 0) - (Number(b?.ts) || 0))
      .slice(-cap)
  }

  function pushRealtimeLog(entry: any) {
    const next = normalizeLogEntry(entry)
    if (shouldHideLogEntryInFrontend(next))
      return
    if (logs.value.some(item => getLogIdentity(item, 'runtime') === getLogIdentity(next, 'runtime')))
      return
    logs.value.push(next)
    if (logs.value.length > RUNTIME_LOG_CLIENT_CAP)
      logs.value = logs.value.slice(-RUNTIME_LOG_CLIENT_CAP)
  }

  function pushRealtimeAccountLog(entry: any) {
    const next = (entry && typeof entry === 'object') ? entry : {}
    if (shouldHideLogEntryInFrontend(next))
      return
    if (accountLogs.value.some(item => getLogIdentity(item, 'account') === getLogIdentity(next, 'account')))
      return
    accountLogs.value.push(next)
    if (accountLogs.value.length > ACCOUNT_LOG_CLIENT_CAP)
      accountLogs.value = accountLogs.value.slice(-ACCOUNT_LOG_CLIENT_CAP)
  }

  function handleRealtimeStatus(payload: any) {
    const body = (payload && typeof payload === 'object') ? payload : {}
    const accountId = String(body.accountId || '')
    // 未选择账号时服务端会以 'all' 广播所有账号的状态，这里必须拒收：
    // 否则 Dashboard / 侧边栏会显示成别人账号的昵称与在线状态（串台）。
    if (!currentRealtimeAccountId.value)
      return
    if (accountId && accountId !== currentRealtimeAccountId.value)
      return
    if (body.status && typeof body.status === 'object') {
      status.value = normalizeStatusPayload(body.status)
      statusAccountId.value = accountId || currentRealtimeAccountId.value || getCurrentAccountId()
      error.value = ''
    }
  }

  function handleRealtimeLog(payload: any) {
    if (!realtimeLogsEnabled.value)
      return
    const body = (payload && typeof payload === 'object') ? payload : {}
    const accountId = String(body.accountId || body.id || '')
    if (currentRealtimeAccountId.value && accountId && accountId !== currentRealtimeAccountId.value)
      return
    pushRealtimeLog(payload)
  }

  function handleRealtimeAccountLog(payload: any) {
    const body = (payload && typeof payload === 'object') ? payload : {}
    const accountId = String(body.accountId || '')
    if (currentRealtimeAccountId.value && accountId && accountId !== currentRealtimeAccountId.value)
      return
    pushRealtimeAccountLog(payload)
  }

  function handleRealtimeLogsSnapshot(payload: any) {
    const body = (payload && typeof payload === 'object') ? payload : {}
    const accountId = String(body.accountId || '')
    if (currentRealtimeAccountId.value && accountId && accountId !== 'all' && accountId !== currentRealtimeAccountId.value)
      return
    const list = Array.isArray(body.logs) ? body.logs : []
    logs.value = mergeLogsById(
      logs.value,
      uniqueLogs(list, 'runtime')
        .map((item: any) => normalizeLogEntry(item))
        .filter((item: any) => !shouldHideLogEntryInFrontend(item)),
      'runtime',
      RUNTIME_LOG_CLIENT_CAP,
    )
  }

  function handleRealtimeAccountLogsSnapshot(payload: any) {
    const body = (payload && typeof payload === 'object') ? payload : {}
    const list = Array.isArray(body.logs) ? body.logs : []
    const incoming = currentRealtimeAccountId.value
      ? list
          .filter((item: any) => String(item?.accountId || item?.id || '') === currentRealtimeAccountId.value)
          .filter((item: any) => !shouldHideLogEntryInFrontend(item))
      : list.filter((item: any) => !shouldHideLogEntryInFrontend(item))
    accountLogs.value = mergeLogsById(accountLogs.value, uniqueLogs(incoming, 'account'), 'account', ACCOUNT_LOG_CLIENT_CAP)
  }

  function ensureRealtimeSocket() {
    if (socket)
      return socket

    socket = io('/', {
      path: '/socket.io',
      autoConnect: false,
      transports: ['websocket', 'polling'],
      upgrade: true,
      timeout: 10000,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      auth: {
        token: tokenRef.value,
      },
    })

    socket.on('connect', () => {
      realtimeConnected.value = true
      if (currentRealtimeAccountId.value) {
        socket?.emit('subscribe', { accountId: currentRealtimeAccountId.value })
        subscribedAccountId.value = currentRealtimeAccountId.value
      }
      else {
        socket?.emit('subscribe', { accountId: 'all' })
        subscribedAccountId.value = ''
      }
    })

    socket.on('disconnect', () => {
      realtimeConnected.value = false
    })

    socket.on('connect_error', (err) => {
      realtimeConnected.value = false
      console.error('[realtime] 连接失败:', err.message)
    })

    socket.on('status:update', handleRealtimeStatus)
    socket.on('log:new', handleRealtimeLog)
    socket.on('account-log:new', handleRealtimeAccountLog)
    socket.on('logs:snapshot', handleRealtimeLogsSnapshot)
    socket.on('account-logs:snapshot', handleRealtimeAccountLogsSnapshot)
    return socket
  }

  function connectRealtime(accountId: string) {
    const nextAccountId = String(accountId || '').trim()
    // 未选择账号时不做全局订阅：多账号下面板只跟随当前选中的账号，
    // 避免订阅 'all' 把所有账号（或他人的）日志合并推送进来
    if (!nextAccountId) {
      disconnectRealtime()
      return
    }
    currentRealtimeAccountId.value = nextAccountId
    if (!tokenRef.value)
      return

    const client = ensureRealtimeSocket()
    client.auth = {
      token: tokenRef.value,
      accountId: currentRealtimeAccountId.value || 'all',
    }

    if (client.connected) {
      // 已连接且账号没变：不重复 subscribe，避免服务端每 30s 心跳回推一次
      // 被截断的快照（上限 100/过滤后更少）把刷新得到的长列表整体覆盖短
      if (subscribedAccountId.value === currentRealtimeAccountId.value)
        return
      client.emit('subscribe', { accountId: currentRealtimeAccountId.value || 'all' })
      subscribedAccountId.value = currentRealtimeAccountId.value
      return
    }
    client.connect()
  }

  function disconnectRealtime() {
    if (!socket)
      return
    socket.off('connect')
    socket.off('disconnect')
    socket.off('connect_error')
    socket.off('status:update', handleRealtimeStatus)
    socket.off('log:new', handleRealtimeLog)
    socket.off('account-log:new', handleRealtimeAccountLog)
    socket.off('logs:snapshot', handleRealtimeLogsSnapshot)
    socket.off('account-logs:snapshot', handleRealtimeAccountLogsSnapshot)
    socket.disconnect()
    socket = null
    realtimeConnected.value = false
    subscribedAccountId.value = ''
  }

  async function fetchStatus(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    loading.value = true
    try {
      const { data } = await api.get('/api/status', {
        headers: { 'x-account-id': accountId },
      })
      if (!isCurrentAccount(requestedId))
        return
      if (data.ok) {
        status.value = normalizeStatusPayload(data.data)
        statusAccountId.value = requestedId
        error.value = ''
      }
      else {
        error.value = data.error
      }
    }
    catch (e: any) {
      error.value = e.message
    }
    finally {
      loading.value = false
    }
  }

  async function fetchLogs(accountId: string, options: any = {}) {
    if (!accountId && options.accountId !== 'all')
      return
    const requestedId = String(accountId || options.accountId || '')
    const params: any = { limit: 100, ...options }
    const headers: any = {}
    if (accountId && accountId !== 'all') {
      headers['x-account-id'] = accountId
    }
    else {
      params.accountId = 'all'
    }

    try {
      const { data } = await api.get('/api/logs', { headers, params })
      if (requestedId && requestedId !== 'all' && !isCurrentAccount(requestedId))
        return
      if (data.ok) {
        // 保留 5 秒轮询节奏，但与现有列表按 id 取并集，日志在单次会话内只增不减
        const incoming = Array.isArray(data.data)
          ? data.data
              .map((item: any) => normalizeLogEntry(item))
              .filter((item: any) => !shouldHideLogEntryInFrontend(item))
          : []
        logs.value = mergeLogsById(logs.value, incoming, 'runtime', RUNTIME_LOG_CLIENT_CAP)
        error.value = ''
      }
    }
    catch (e: any) {
      console.error(e)
    }
  }

  async function fetchDailyGifts(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    try {
      const { data } = await api.get('/api/daily-gifts', {
        headers: { 'x-account-id': accountId },
      })
      if (!isCurrentAccount(requestedId))
        return
      if (data.ok) {
        dailyGifts.value = data.data
      }
    }
    catch (e) {
      console.error('获取每日奖励失败', e)
    }
  }

  async function fetchAccountLogs(accountId = '', limit = 100) {
    const requestedId = String(accountId || '')
    try {
      const headers: Record<string, string> = {}
      if (requestedId)
        headers['x-account-id'] = requestedId
      const res = await api.get(`/api/account-logs?limit=${Math.max(1, Number(limit) || 100)}`, { headers })
      if (Array.isArray(res.data)) {
        if (requestedId && !isCurrentAccount(requestedId))
          return
        // 同运行日志：按 id 并集合并，整表替换会让旧日志一条条消失
        const incoming = (requestedId
          ? res.data
              .filter((item: any) => String(item?.accountId || item?.id || '') === requestedId)
              .filter((item: any) => !shouldHideLogEntryInFrontend(item))
          : res.data.filter((item: any) => !shouldHideLogEntryInFrontend(item)))
        accountLogs.value = mergeLogsById(accountLogs.value, incoming, 'account', ACCOUNT_LOG_CLIENT_CAP)
      }
    }
    catch (e) {
      console.error(e)
    }
  }

  function setRealtimeLogsEnabled(enabled: boolean) {
    realtimeLogsEnabled.value = !!enabled
  }

  /** 清空按钮专用：服务端已清空，客户端聚合列表必须一并清掉，否则并集合并会把旧日志救回来 */
  function clearClientLogs() {
    logs.value = []
    accountLogs.value = []
  }

  return {
    status,
    statusAccountId,
    currentStatusReady,
    logs,
    accountLogs,
    dailyGifts,
    loading,
    error,
    realtimeConnected,
    realtimeLogsEnabled,
    clearAccountScopedData,
    fetchStatus,
    fetchLogs,
    fetchAccountLogs,
    fetchDailyGifts,
    setRealtimeLogsEnabled,
    clearClientLogs,
    connectRealtime,
    disconnectRealtime,
  }
})
