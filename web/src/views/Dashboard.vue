<script setup lang="ts">
import type { RuntimeLogEntry } from '@/utils/runtime-log'
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import api from '@/api'
import ConsumptionModal from '@/components/ConsumptionModal.vue'
import RenewCardModal from '@/components/RenewCardModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { formatCouponAmount, formatGoldAmount, formatGoldBeanAmount } from '@/utils/number-format'
import { matchesRuntimeLog, normalizeRuntimeLog } from '@/utils/runtime-log'

const statusStore = useStatusStore()
const accountStore = useAccountStore()
const bagStore = useBagStore()
const toastStore = useToastStore()
const userStore = useUserStore()

const {
  status,
  logs: statusLogs,
  accountLogs: statusAccountLogs,
  realtimeConnected,
  currentStatusReady,
} = storeToRefs(statusStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { dashboardItems } = storeToRefs(bagStore)

const logContainer = ref<HTMLElement | null>(null)
const autoScroll = ref(true)
const lastBagFetchAt = ref(0)
const illustratedLevels = ref({ crop: 0, mutant: 0 })
let illustratedLevelRequestId = 0
const clearingLogs = ref(false)
const refreshingLogs = ref(false)
const pendingLogCount = ref(0)
const logScrollStates = new Map<string, { top: number, atBottom: boolean }>()
// 消费明细弹窗：条数来自状态轮询里的 consumptionCount
const showConsumption = ref(false)
const consumptionCount = computed(() => Number(status.value?.consumptionCount || 0))

const filter = reactive({
  module: '',
  event: '',
  keyword: '',
})

const hasActiveLogFilter = computed(() =>
  !!(filter.module || filter.event || filter.keyword),
)
const currentAccountDisconnected = computed(() =>
  currentStatusReady.value && !status.value?.connection?.connected,
)
// 自动偷菜开关关闭时，偷菜 tick 会被后端「停放」（占位 15 分钟），倒计时无意义，
// 概览偷菜栏直接显示「已关闭」。
const stealAutomationDisabled = computed(() =>
  status.value?.automation ? status.value.automation.friend_steal === false : false,
)

// 账号到期提醒：与侧栏账号卡同口径（天数向上取整，29天23小时显示为「还有30天到期」）
const nowMs = ref(Date.now())
useIntervalFn(() => {
  nowMs.value = Date.now()
}, 60_000)
const expireMs = computed(() => {
  const value = Number(userStore.expiresAt)
  return Number.isFinite(value) && value > 0 ? value : 0
})
const userExpired = computed(() =>
  !userStore.isSuperAdmin && expireMs.value > 0 && expireMs.value <= nowMs.value,
)
const daysLeft = computed(() => {
  if (!expireMs.value || userExpired.value)
    return null
  return Math.max(1, Math.ceil((expireMs.value - nowMs.value) / 86_400_000))
})
// 到期角标：所有人可见——超管/未设到期显示「永久」，普通用户显示剩余天数/已过期
const expiryBadgeText = computed(() => {
  if (userStore.isSuperAdmin || !expireMs.value)
    return '永久'
  return userExpired.value ? '已过期' : `还有${daysLeft.value}天到期`
})
const expiryBadgeClass = computed(() => {
  if (userStore.isSuperAdmin || !expireMs.value)
    return 'rounded-lg bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-white/5 dark:text-gray-400'
  if (userExpired.value || (daysLeft.value ?? 99) <= 3)
    return 'rounded-lg bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/30 dark:text-red-300'
  return 'rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-600 dark:bg-amber-900/30 dark:text-amber-300'
})
const showRenewModal = ref(false)

const allLogs = computed(() => {
  const merged = [
    ...(statusLogs.value || []).map((log: any) => normalizeRuntimeLog(log)),
    ...(statusAccountLogs.value || []).map((log: any) => normalizeRuntimeLog(log, true)),
  ]
  const unique = new Map<string, RuntimeLogEntry>()
  for (const log of merged)
    unique.set(log.id, log)
  return [...unique.values()].sort((a, b) => a.ts - b.ts)
})

const filteredLogs = computed(() => allLogs.value.filter((log) => {
  return matchesRuntimeLog(log, filter)
}))

// 日志显示照 QQ-farm-BOT-GO 版：服务端给什么显示什么，平铺、不折叠、不去重
const visibleLogs = computed(() => filteredLogs.value)

const modules = [
  { label: '全部模块', value: '' },
  { label: '农场', value: 'farm' },
  { label: '好友', value: 'friend' },
  { label: '仓库', value: 'warehouse' },
  { label: '商城', value: 'shop' },
  { label: '任务', value: 'task' },
  { label: '活动', value: 'activity' },
  { label: '宠物', value: 'pet' },
  { label: '系统', value: 'system' },
]

const events = [
  { label: '全部事件', value: '' },
  { label: '农场巡查', value: '农场循环' },
  { label: '收获作物', value: '收获作物' },
  { label: '清理枯枝', value: '铲除植物' },
  { label: '种植种子', value: '种植种子' },
  { label: '施加化肥', value: '施肥' },
  { label: '土地提醒', value: '土地推送通知' },
  { label: '选择种子', value: '选择种子' },
  { label: '购买种子', value: '购买种子' },
  { label: '购买化肥', value: '购买化肥' },
  { label: '开启礼盒', value: '开启化肥礼包' },
  { label: '获取任务', value: '扫描任务' },
  { label: '完成任务', value: '领取任务' },
  { label: '免费礼包', value: 'mall_free_gifts' },
  { label: '分享奖励', value: 'daily_share' },
  { label: '会员礼包', value: 'vip_daily_gift' },
  { label: '月卡礼包', value: 'month_card_gift' },
  { label: '图鉴奖励', value: '图鉴奖励' },
  { label: '邮箱领取', value: 'email_rewards' },
  { label: '出售成功', value: 'sell_success' },
  { label: '神秘商人', value: '神秘商人自动购买' },
  { label: '土地升级', value: '升级土地' },
  { label: '土地解锁', value: '解锁土地' },
  { label: '好友巡查', value: '好友巡查循环' },
  { label: '访问好友', value: '进入农场' },
  { label: '激活宠物', value: '激活宠物' },
  { label: '派出宠物', value: '派出宠物' },
  { label: '召回宠物', value: '召回宠物' },
  { label: '喂食宠物', value: '喂食宠物' },
  { label: '资本模式派出', value: '资本模式派出' },
  { label: '资本模式召回', value: '资本模式召回' },
]

const eventLabelMap: Record<string, string> = Object.fromEntries(
  events.filter(event => event.value).map(event => [event.value, event.label]),
)

const displayName = computed(() => {
  const account = accountStore.currentAccount
  const gameName = status.value?.status?.name

  if (gameName) {
    if (account?.name)
      return `${gameName} (${account.name})`
    return gameName
  }

  if (currentAccountDisconnected.value) {
    if (account) {
      if (account.name && account.nick)
        return `${account.nick} (${account.name})`
      return account.name || account.nick || '未登录'
    }
    return '未登录'
  }

  if (account) {
    if (account.name && account.nick)
      return `${account.nick} (${account.name})`
    return account.name || account.nick || '未命名'
  }

  return '未命名'
})

const expRate = computed(() => {
  const gain = status.value?.sessionExpGained || 0
  const uptime = status.value?.uptime || 0
  if (!uptime)
    return '0/小时'
  const rate = gain / (uptime / 3600)
  return `${Math.floor(rate)}/小时`
})

const timeToLevel = computed(() => {
  const gain = status.value?.sessionExpGained || 0
  const uptime = status.value?.uptime || 0
  const current = status.value?.levelProgress?.current || 0
  const needed = status.value?.levelProgress?.needed || 0

  if (!needed || !uptime || gain <= 0)
    return ''

  const ratePerHour = gain / (uptime / 3600)
  if (ratePerHour <= 0)
    return ''

  const expNeeded = Math.max(0, needed - current)
  const minsToLevel = expNeeded / (ratePerHour / 60)

  if (minsToLevel < 60)
    return `约 ${Math.ceil(minsToLevel)} 分钟后升级`
  return `约 ${(minsToLevel / 60).toFixed(1)} 小时后升级`
})

const fertilizerNormal = computed(() => dashboardItems.value.find((item: any) => Number(item.id) === 1011))
const fertilizerOrganic = computed(() => dashboardItems.value.find((item: any) => Number(item.id) === 1012))

const nextFarmCheck = ref('--:--:--')
const nextHelpCheck = ref('--:--:--')
// 偷菜有独立的调度节奏（成熟驱动 + stealMin/stealMax 兜底），倒计时独立推送。
const nextStealCheck = ref('--:--:--')
const localUptime = ref(0)

let localNextFarmRemainSec = 0
let localNextHelpRemainSec = 0
let localNextStealRemainSec = 0
const farmCountdownTotal = ref(1)
const helpCountdownTotal = ref(1)
const stealCountdownTotal = ref(1)

function resetDashboardState() {
  illustratedLevelRequestId += 1
  illustratedLevels.value = { crop: 0, mutant: 0 }
  lastBagFetchAt.value = 0
  localUptime.value = 0
  localNextFarmRemainSec = 0
  localNextHelpRemainSec = 0
  localNextStealRemainSec = 0
  farmCountdownTotal.value = 1
  helpCountdownTotal.value = 1
  stealCountdownTotal.value = 1
  nextFarmCheck.value = '--:--:--'
  nextHelpCheck.value = '--:--:--'
  nextStealCheck.value = '--:--:--'
}

function syncCountdownTotal(total: typeof farmCountdownTotal, remain: number, previousRemain: number) {
  if (remain > previousRemain || total.value <= 1)
    total.value = Math.max(1, remain)
}

// 倒计时防「时间倒流」：本地还在递减（>0）且推送值更大时保持本地值，
// 减到 0（检查中）后无条件采用推送值，保证任务真正跑完后能刷新新一轮倒计时。
function clampNextRemain(local: number, pushed: number) {
  if (local > 0 && pushed > local)
    return local
  return pushed
}

function getCountdownProgress(remain: number, total: number) {
  return Math.max(0, Math.min(100, (remain / Math.max(1, total)) * 100))
}

function getCountdownRingStyle(remain: number, total: number, color: string) {
  const progress = getCountdownProgress(remain, total)
  return {
    background: `conic-gradient(${color} ${progress}%, color-mix(in srgb, ${color} 14%, transparent) 0)`,
  }
}

const OP_META: Record<string, { label: string, icon: string, color: string, badge: string }> = {
  harvest: { label: '收获', icon: 'i-carbon-crop-growth', color: 'text-green-500', badge: 'bg-green-500/15' },
  water: { label: '浇水', icon: 'i-carbon-rain-drop', color: 'text-blue-400', badge: 'bg-blue-400/15' },
  weed: { label: '除草', icon: 'i-carbon-cut', color: 'text-yellow-500', badge: 'bg-yellow-500/15' },
  bug: { label: '除虫', icon: 'i-carbon-pest', color: 'text-red-400', badge: 'bg-red-400/15' },
  farming: { label: '一键务农', icon: 'i-carbon-clean', color: 'text-teal-500', badge: 'bg-teal-500/15' },
  fertilize: { label: '施肥', icon: 'i-carbon-chemistry', color: 'text-emerald-500', badge: 'bg-emerald-500/15' },
  plant: { label: '种植', icon: 'i-carbon-tree', color: 'text-lime-500', badge: 'bg-lime-500/15' },
  steal: { label: '偷菜', icon: 'i-carbon-run', color: 'text-orange-500', badge: 'bg-orange-500/15' },
  helpWater: { label: '帮浇水', icon: 'i-carbon-rain-drop', color: 'text-blue-300', badge: 'bg-blue-300/15' },
  goldenBugClear: { label: '清黄金虫', icon: 'i-carbon-clean', color: 'text-amber-500', badge: 'bg-amber-500/15' },
  goldenBugPut: { label: '放黄金虫', icon: 'i-carbon-pest', color: 'text-yellow-500', badge: 'bg-yellow-500/15' },
  helpWeed: { label: '帮除草', icon: 'i-carbon-cut', color: 'text-yellow-400', badge: 'bg-yellow-400/15' },
  helpBug: { label: '帮除虫', icon: 'i-carbon-pest', color: 'text-red-300', badge: 'bg-red-300/15' },
  taskClaim: { label: '任务', icon: 'i-carbon-task-complete', color: 'text-indigo-500', badge: 'bg-indigo-500/15' },
  sell: { label: '出售', icon: 'i-carbon-shopping-cart', color: 'text-pink-500', badge: 'bg-pink-500/15' },
  tongQiGift: { label: '同气礼包', icon: 'i-carbon-gift', color: 'text-rose-500', badge: 'bg-rose-500/15' },
}

function getOpBadge(key: string) {
  return OP_META[key]?.badge || 'bg-gray-500/15'
}

const filteredOperations = computed(() => {
  const operations = status.value?.operations || {}
  const result: Record<string, number> = {}

  for (const key of Object.keys(operations)) {
    if (key !== 'upgrade' && key !== 'levelUp')
      result[key] = operations[key]
  }

  return result
})

function getEventLabel(event: string) {
  return eventLabelMap[event] || event
}

function formatBucketTime(item: any) {
  if (!item)
    return '0.0h'
  if (item.hoursText)
    return item.hoursText.replace('小时', 'h')
  return `${(Number(item.count || 0) / 3600).toFixed(1)}h`
}

function updateCountdowns() {
  if (currentAccountDisconnected.value) {
    nextFarmCheck.value = '账号未登录'
    nextHelpCheck.value = '账号未登录'
    nextStealCheck.value = '账号未登录'
    return
  }

  if (stealAutomationDisabled.value) {
    nextStealCheck.value = '已关闭'
    localNextStealRemainSec = 0
    stealCountdownTotal.value = 1
  }

  localUptime.value++

  if (localNextFarmRemainSec > 0) {
    localNextFarmRemainSec--
    nextFarmCheck.value = formatDuration(localNextFarmRemainSec)
  }
  else {
    nextFarmCheck.value = '检查中...'
  }

  if (localNextHelpRemainSec > 0) {
    localNextHelpRemainSec--
    nextHelpCheck.value = formatDuration(localNextHelpRemainSec)
  }
  else {
    nextHelpCheck.value = '检查中...'
  }

  if (stealAutomationDisabled.value) {
    nextStealCheck.value = '已关闭'
  }
  else if (localNextStealRemainSec > 0) {
    localNextStealRemainSec--
    nextStealCheck.value = formatDuration(localNextStealRemainSec)
  }
  else {
    nextStealCheck.value = '检查中...'
  }
}

watch(status, (newVal) => {
  if (newVal?.nextChecks) {
    const farmRemainSec = newVal.nextChecks.farmRemainSec || 0
    // 帮助/偷菜倒计时做防倒流钳制：推送值比本地还大时（调度被推迟、重新随机等），
    // 保持本地值继续递减到 0（检查中）后再刷新，避免界面时间「往回跳」。
    // 偷菜与帮助各自独立调度：偷菜倒计时来自后端的 stealRemainSec。
    const helpRemainSec = clampNextRemain(localNextHelpRemainSec, newVal.nextChecks.helpRemainSec || 0)
    const stealRemainSec = clampNextRemain(localNextStealRemainSec, newVal.nextChecks.stealRemainSec || 0)
    syncCountdownTotal(farmCountdownTotal, farmRemainSec, localNextFarmRemainSec)
    syncCountdownTotal(helpCountdownTotal, helpRemainSec, localNextHelpRemainSec)
    syncCountdownTotal(stealCountdownTotal, stealRemainSec, localNextStealRemainSec)
    localNextFarmRemainSec = farmRemainSec
    localNextHelpRemainSec = helpRemainSec
    localNextStealRemainSec = stealRemainSec
    updateCountdowns()
  }

  if (newVal?.uptime !== undefined)
    localUptime.value = newVal.uptime
}, { deep: true })

function formatDuration(seconds: number) {
  if (seconds <= 0)
    return '00:00:00'

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainSeconds = Math.floor(seconds % 60)
  const pad = (value: number) => value.toString().padStart(2, '0')

  if (days > 0)
    return `${days}天 ${pad(hours)}:${pad(minutes)}:${pad(remainSeconds)}`
  return `${pad(hours)}:${pad(minutes)}:${pad(remainSeconds)}`
}

function getLogTagClass(tag: string) {
  if (tag === '错误')
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  if (tag === '系统')
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (tag === '活动')
    return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
  if (tag === '宠物')
    return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300'
  if (tag === '警告')
    return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
  return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
}

function getLogRowClass(log: RuntimeLogEntry) {
  if (log.level === 'error')
    return 'border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/20'
  if (log.level === 'warn')
    return 'border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20'
  return 'border-transparent hover:bg-white/55 dark:hover:bg-gray-800/45'
}

function getLogMsgClass(tag: string) {
  if (tag === '错误')
    return 'text-red-600 dark:text-red-400'
  return 'text-gray-700 dark:text-gray-300'
}

function formatLogTime(timeStr: string) {
  if (!timeStr)
    return ''
  const parts = timeStr.split(' ')
  return parts.length > 1 ? parts[1] : timeStr
}

function formatLogTimeRange(log: RuntimeLogEntry) {
  const start = formatLogTime(log.time)
  if (!log.lastTs || log.lastTs === log.ts)
    return start
  return `${start}–${new Date(log.lastTs).toLocaleTimeString('zh-CN', { hour12: false })}`
}

function getLogScrollStateKey() {
  return [currentAccountId.value, filter.module, filter.event, filter.keyword].join('|')
}

function restoreLogScroll() {
  nextTick(() => {
    const element = logContainer.value
    if (!element)
      return
    const saved = logScrollStates.get(getLogScrollStateKey())
    if (saved && !saved.atBottom) {
      element.scrollTop = saved.top
      autoScroll.value = false
    }
    else {
      scrollToBottom()
    }
  })
}

async function refreshRuntimeLogs() {
  if (!currentAccountId.value || refreshingLogs.value)
    return
  refreshingLogs.value = true
  try {
    await Promise.all([
      statusStore.fetchLogs(currentAccountId.value, { limit: 300 }),
      statusStore.fetchAccountLogs(currentAccountId.value, 300),
    ])
    toastStore.success('日志已刷新')
  }
  finally {
    refreshingLogs.value = false
  }
}

function getOpName(key: string | number) {
  return OP_META[String(key)]?.label || String(key)
}

function getOpIcon(key: string | number) {
  return OP_META[String(key)]?.icon || 'i-carbon-circle-dash'
}

function getOpColor(key: string | number) {
  return OP_META[String(key)]?.color || 'text-gray-400'
}

function getExpPercent(progress: any) {
  if (!progress || !progress.needed)
    return 0
  return Math.min(100, Math.max(0, (progress.current / progress.needed) * 100))
}

async function refreshBag(force = false) {
  if (!currentAccountId.value || !currentAccount.value?.running || !currentStatusReady.value || !status.value?.connection?.connected)
    return

  const now = Date.now()
  if (!force && now - lastBagFetchAt.value < 2500)
    return

  lastBagFetchAt.value = now
  await bagStore.fetchBag(currentAccountId.value)
}

async function refreshIllustratedLevels() {
  if (!currentAccountId.value || !status.value?.connection?.connected)
    return

  const accountId = currentAccountId.value
  const requestId = ++illustratedLevelRequestId
  const headers = { 'x-account-id': accountId }
  try {
    const [crop, mutant] = await Promise.all([
      api.get('/api/illustrated', { params: { illustrated_type: 1 }, headers }),
      api.get('/api/illustrated', { params: { illustrated_type: 2 }, headers }),
    ])
    if (requestId !== illustratedLevelRequestId || accountId !== currentAccountId.value)
      return
    illustratedLevels.value = {
      crop: Number(crop.data?.data?.level) || 0,
      mutant: Number(mutant.data?.data?.level) || 0,
    }
  }
  catch {
    if (requestId === illustratedLevelRequestId)
      illustratedLevels.value = { crop: 0, mutant: 0 }
  }
}

// 运行日志照 QQ-farm-BOT-GO 版：每 5 秒整列表轮询替换，不依赖实时推送
async function pollLogs() {
  if (!currentAccountId.value || refreshingLogs.value)
    return
  await Promise.all([
    statusStore.fetchLogs(currentAccountId.value, { limit: 300 }),
    statusStore.fetchAccountLogs(currentAccountId.value, 300),
  ])
}

async function refresh() {
  if (!currentAccountId.value)
    return

  const account = currentAccount.value
  if (!account)
    return

  // 断线回退时走 HTTP 拉状态；日志由 pollLogs 每 5 秒整列表轮询
  if (!realtimeConnected.value)
    await statusStore.fetchStatus(currentAccountId.value)

  // 仅在账号运行且连接稳定后再拉背包，避免启动阶段出现 500。
  await refreshBag()
}

function syncRealtimeAccount() {
  if (currentAccountId.value)
    statusStore.connectRealtime(currentAccountId.value)
}

function onLogFilterChange() {
  pendingLogCount.value = 0
  restoreLogScroll()
}

function onLogSearchTrigger() {
  pendingLogCount.value = 0
  restoreLogScroll()
}

watch(currentAccountId, async (newId, oldId) => {
  if (oldId !== undefined && newId !== oldId) {
    statusStore.clearAccountScopedData()
    bagStore.clearBag()
    resetDashboardState()
  }
  syncRealtimeAccount()
  await refresh()
  await pollLogs()
  await refreshIllustratedLevels()
  scrollToBottom()
})

watch(() => status.value?.connection?.connected, (connected) => {
  if (connected) {
    refreshBag(true)
    refreshIllustratedLevels()
  }
})

watch(() => JSON.stringify(status.value?.operations || {}), (next, prev) => {
  if (!realtimeConnected.value || next === prev)
    return
  refreshBag()
})

function onLogScroll(event: Event) {
  const element = event.target as HTMLElement
  if (!element)
    return
  autoScroll.value = element.scrollHeight - element.scrollTop - element.clientHeight < 50
  logScrollStates.set(getLogScrollStateKey(), { top: element.scrollTop, atBottom: autoScroll.value })
  if (autoScroll.value)
    pendingLogCount.value = 0
}

async function clearLogs() {
  if (!currentAccountId.value)
    return
  if (!window.confirm('确认清空当前账号的页面运行记录？此操作不会删除磁盘诊断日志。'))
    return

  clearingLogs.value = true
  try {
    const { data } = await api.delete('/api/logs')
    if (data?.ok) {
      toastStore.success('日志已清空')
      await pollLogs()
    }
    else {
      toastStore.error(`清空失败: ${data?.error || '未知错误'}`)
    }
  }
  catch (error: any) {
    const message = error?.response?.data?.error || error?.message || '请求失败'
    toastStore.error(`清空失败: ${message}`)
  }
  finally {
    clearingLogs.value = false
  }
}

watch(filteredLogs, (next, previous) => {
  nextTick(() => {
    if (logContainer.value && autoScroll.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
      pendingLogCount.value = 0
    }
    else if (next.length > (previous?.length || 0)) {
      pendingLogCount.value += next.length - (previous?.length || 0)
    }
  })
}, { deep: true })

function scrollToBottom() {
  nextTick(() => {
    if (logContainer.value)
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    autoScroll.value = true
    pendingLogCount.value = 0
  })
}

onMounted(async () => {
  statusStore.setRealtimeLogsEnabled(true)
  syncRealtimeAccount()
  await refresh()
  await pollLogs()
  await refreshIllustratedLevels()
  scrollToBottom()
})

// Auto refresh fallback every 10s (WS 断开或启用筛选时回退 HTTP)
useIntervalFn(refresh, 10000)
// 运行日志每 5 秒整列表轮询替换（照 QQ-farm-BOT-GO 版）
useIntervalFn(pollLogs, 5000)
// Countdown timer (every 1s)
useIntervalFn(updateCountdowns, 1000)
</script>

<template>
  <div class="flex flex-col gap-5 pt-1 md:h-full md:min-h-0 md:overflow-hidden md:pt-2">
    <div class="grid grid-cols-1 shrink-0 gap-4 lg:grid-cols-3 sm:grid-cols-2">
      <div class="ui-card metric-card min-h-[168px] flex flex-col rounded-lg p-5">
        <div class="mb-2 flex items-start justify-between">
          <div class="flex items-center gap-1.5 text-sm text-gray-500">
            <div class="i-fas-user-circle" />
            账号
          </div>
          <div class="flex max-w-[62%] flex-wrap items-center justify-end gap-1.5">
            <span class="shrink-0" :class="expiryBadgeClass">{{ expiryBadgeText }}</span>
            <button
              type="button"
              title="续费卡密"
              class="shrink-0 rounded-lg bg-amber-500 px-2 py-0.5 text-xs font-medium text-white transition-colors hover:bg-amber-600"
              @click="showRenewModal = true"
            >
              续费
            </button>
            <div class="rounded-lg bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              Lv.{{ status?.status?.level || 0 }}
            </div>
          </div>
        </div>
        <div class="mb-1 truncate text-xl font-bold" :title="displayName">
          {{ displayName }}
        </div>
        <div class="mt-auto">
          <div class="mb-1 flex justify-between text-xs text-gray-500">
            <div class="flex items-center gap-1">
              <div class="i-fas-bolt text-blue-400" />
              <span>EXP</span>
            </div>
            <span>{{ status?.levelProgress?.current || 0 }} / {{ status?.levelProgress?.needed || '?' }}</span>
          </div>
          <div class="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
            <div
              class="h-full rounded-full bg-blue-500 transition-all duration-500"
              :style="{ width: `${getExpPercent(status?.levelProgress)}%` }"
            />
          </div>
          <div class="mt-2 flex justify-between text-xs text-gray-400">
            <span>效率: {{ expRate }}</span>
            <span>{{ timeToLevel }}</span>
          </div>
        </div>
      </div>

      <div class="ui-card metric-card min-h-[168px] flex flex-col justify-between rounded-lg p-5">
        <!-- 金币/点券/钻石/金豆：四张独立小卡片；数值独占一行（与图标同行时窄卡放不下完整数字） -->
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div class="min-w-0 rounded-xl border border-gray-100 bg-gray-50/70 px-2.5 py-2 dark:border-gray-700/60 dark:bg-gray-800/40">
            <div class="flex items-center gap-1.5">
              <img src="/game-config/resource-icons/gold.png" alt="金币" class="h-7 w-7 shrink-0 object-contain">
              <span class="truncate text-xs text-gray-500 dark:text-gray-400">金币</span>
            </div>
            <div class="mt-0.5 truncate text-sm text-yellow-600 font-bold tabular-nums dark:text-yellow-500" :title="formatGoldAmount(status?.status?.gold || 0)">
              {{ formatGoldAmount(status?.status?.gold || 0) }}
            </div>
            <div
              v-if="(status?.sessionGoldGained || 0) !== 0"
              class="truncate text-[10px]"
              :class="(status?.sessionGoldGained || 0) > 0 ? 'text-green-500' : 'text-red-500'"
            >
              {{ (status?.sessionGoldGained || 0) > 0 ? '+' : '' }}{{ formatGoldAmount(status?.sessionGoldGained || 0) }}
            </div>
          </div>
          <div class="min-w-0 rounded-xl border border-gray-100 bg-gray-50/70 px-2.5 py-2 dark:border-gray-700/60 dark:bg-gray-800/40">
            <div class="flex items-center gap-1.5">
              <img src="/game-config/resource-icons/coupon.png" alt="点券" class="h-7 w-7 shrink-0 object-contain">
              <span class="truncate text-xs text-gray-500 dark:text-gray-400">点券</span>
            </div>
            <div class="mt-0.5 truncate text-sm text-emerald-500 font-bold tabular-nums dark:text-emerald-400" :title="formatCouponAmount(status?.status?.coupon || 0)">
              {{ formatCouponAmount(status?.status?.coupon || 0) }}
            </div>
            <div
              v-if="(status?.sessionCouponGained || 0) !== 0"
              class="truncate text-[10px]"
              :class="(status?.sessionCouponGained || 0) > 0 ? 'text-green-500' : 'text-red-500'"
            >
              {{ (status?.sessionCouponGained || 0) > 0 ? '+' : '' }}{{ formatCouponAmount(status?.sessionCouponGained || 0) }}
            </div>
          </div>
          <div class="min-w-0 rounded-xl border border-gray-100 bg-gray-50/70 px-2.5 py-2 dark:border-gray-700/60 dark:bg-gray-800/40">
            <div class="flex items-center gap-1.5">
              <img src="/game-config/resource-icons/diamond.png" alt="钻石" class="h-7 w-7 shrink-0 object-contain">
              <span class="truncate text-xs text-gray-500 dark:text-gray-400">钻石</span>
            </div>
            <div class="mt-0.5 truncate text-sm text-cyan-600 font-bold tabular-nums dark:text-cyan-400" :title="formatCouponAmount(status?.status?.diamond || 0)">
              {{ formatCouponAmount(status?.status?.diamond || 0) }}
            </div>
          </div>
          <div class="min-w-0 rounded-xl border border-gray-100 bg-gray-50/70 px-2.5 py-2 dark:border-gray-700/60 dark:bg-gray-800/40">
            <div class="flex items-center gap-1.5">
              <img src="/game-config/resource-icons/gold-bean.png" alt="金豆豆" class="h-7 w-7 shrink-0 object-contain">
              <span class="truncate text-xs text-gray-500 dark:text-gray-400">金豆</span>
            </div>
            <div class="mt-0.5 truncate text-sm text-amber-500 font-bold tabular-nums dark:text-amber-400" :title="formatGoldBeanAmount(status?.status?.goldBean || 0)">
              {{ formatGoldBeanAmount(status?.status?.goldBean || 0) }}
            </div>
          </div>
        </div>
        <!-- 查看消费明细入口：条数随状态轮询自动刷新 -->
        <button
          type="button"
          class="mt-3 w-full flex items-center gap-2.5 border rounded-full px-2.5 py-1.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50"
          :style="{
            borderColor: 'color-mix(in srgb, var(--theme-primary) 45%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--theme-primary) 7%, transparent)',
          }"
          :disabled="!currentAccountId"
          title="查看消费明细"
          @click="showConsumption = true"
        >
          <span
            class="h-7 w-7 flex shrink-0 items-center justify-center rounded-full text-white"
            :style="{ backgroundColor: 'var(--theme-primary)' }"
          >
            <div class="i-carbon-receipt text-base" />
          </span>
          <span
            class="flex-1 truncate text-sm font-semibold"
            :style="{ color: 'color-mix(in srgb, var(--theme-primary) 85%, var(--theme-text))' }"
          >
            查看消费明细
          </span>
          <span
            class="rounded-full px-1.5 py-0.5 text-[11px] leading-none font-medium"
            :style="{
              color: 'var(--theme-primary)',
              backgroundColor: 'color-mix(in srgb, var(--theme-primary) 14%, transparent)',
            }"
          >
            {{ consumptionCount }} 条
          </span>
          <span
            class="i-carbon-chevron-right shrink-0 text-sm opacity-60"
            :style="{ color: 'var(--theme-primary)' }"
          />
        </button>

        <div class="mt-4 border-t border-gray-100/80 pt-3 dark:border-gray-700/80">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="h-2.5 w-2.5 rounded-full" :class="status?.connection?.connected ? 'bg-green-500' : currentStatusReady ? 'bg-red-500' : 'bg-gray-300'" />
              <span class="text-xs font-bold">{{ status?.connection?.connected ? '在线' : currentStatusReady ? '离线' : '检查中' }}</span>
            </div>
            <div class="flex items-center gap-1.5 text-xs text-gray-400">
              <div class="i-fas-clock text-purple-400" />
              {{ formatDuration(localUptime) }}
            </div>
          </div>
        </div>
      </div>

      <div class="ui-card metric-card min-h-[168px] flex flex-col rounded-lg p-5">
        <!-- 2×2 独立小卡片：格子高度有限（约 60px），横向排布（图标左、文字右）避免三行堆叠挤压 -->
        <div class="grid flex-1 grid-cols-2 content-center gap-2 sm:gap-3">
          <div class="flex min-w-0 items-center gap-2.5 rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2 dark:border-gray-700/60 dark:bg-gray-800/40">
            <img src="/game-config/resource-icons/fertilizer-normal.png" alt="普通化肥" class="h-8 w-8 shrink-0 object-contain">
            <div class="min-w-0 flex flex-col">
              <span class="truncate text-xs text-gray-500 dark:text-gray-400">普通化肥</span>
              <span class="truncate font-bold tabular-nums" :title="formatBucketTime(fertilizerNormal)">
                {{ formatBucketTime(fertilizerNormal) }}
              </span>
            </div>
          </div>
          <div class="flex min-w-0 items-center gap-2.5 rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2 dark:border-gray-700/60 dark:bg-gray-800/40">
            <img src="/game-config/resource-icons/fertilizer-organic.png" alt="有机化肥" class="h-8 w-8 shrink-0 object-contain">
            <div class="min-w-0 flex flex-col">
              <span class="truncate text-xs text-gray-500 dark:text-gray-400">有机化肥</span>
              <span class="truncate font-bold tabular-nums" :title="formatBucketTime(fertilizerOrganic)">
                {{ formatBucketTime(fertilizerOrganic) }}
              </span>
            </div>
          </div>
          <div class="flex min-w-0 items-center gap-2.5 rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2 dark:border-gray-700/60 dark:bg-gray-800/40">
            <img src="/game-config/resource-icons/illustrated-crop.png" alt="作物图鉴" class="h-8 w-8 shrink-0 object-contain">
            <div class="min-w-0 flex flex-col">
              <span class="truncate text-xs text-gray-500 dark:text-gray-400">作物图鉴</span>
              <span class="truncate font-bold tabular-nums">Lv.{{ illustratedLevels.crop }}</span>
            </div>
          </div>
          <div class="flex min-w-0 items-center gap-2.5 rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2 dark:border-gray-700/60 dark:bg-gray-800/40">
            <img src="/game-config/resource-icons/illustrated-mutant.png" alt="超变图鉴" class="h-8 w-8 shrink-0 object-contain">
            <div class="min-w-0 flex flex-col">
              <span class="truncate text-xs text-gray-500 dark:text-gray-400">超变图鉴</span>
              <span class="truncate font-bold tabular-nums">Lv.{{ illustratedLevels.mutant }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="flex flex-1 flex-col items-stretch gap-5 md:min-h-0 md:flex-row">
      <div class="flex flex-1 flex-col gap-5 md:min-h-0 md:w-3/4">
        <div class="ui-card-elevated flex flex-1 flex-col rounded-lg p-3 md:min-h-0 md:overflow-hidden sm:p-5">
          <div class="mb-4 flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h3 class="flex items-center gap-2 text-lg font-medium">
                <div class="i-carbon-document" />
                <span>运行日志</span>
                <!-- 计数用折叠前的原始条数：visibleLogs 是 2 分钟窗口折叠后的行数，
                     补发旧日志合并折叠区时行数会不增反降（如 65→64），看起来像丢日志 -->
                <span class="text-xs text-gray-400 font-normal">{{ filteredLogs.length }} 条</span>
              </h3>
            </div>

            <div class="flex flex-wrap items-center gap-2 text-sm">
              <BaseInput
                v-model="filter.keyword"
                placeholder="搜索日志内容"
                class="min-w-48 flex-1 sm:max-w-72"
                clearable
                @keyup.enter="onLogSearchTrigger"
                @clear="onLogSearchTrigger"
              />

              <BaseSelect
                v-model="filter.module"
                :options="modules"
                class="w-36"
                @change="onLogFilterChange"
              />

              <BaseSelect
                v-model="filter.event"
                :options="events"
                class="w-36"
                @change="onLogFilterChange"
              />

              <BaseButton
                v-if="hasActiveLogFilter"
                variant="ghost"
                size="sm"
                @click="Object.assign(filter, { module: '', event: '', keyword: '' }); onLogFilterChange()"
              >
                <div class="i-carbon-filter-remove mr-1" />
                重置
              </BaseButton>

              <BaseButton
                variant="secondary"
                size="sm"
                :loading="refreshingLogs"
                @click="refreshRuntimeLogs"
              >
                <div class="i-carbon-renew mr-1" />
                刷新
              </BaseButton>

              <BaseButton
                variant="secondary"
                size="sm"
                :loading="clearingLogs"
                @click="clearLogs"
              >
                <div class="i-carbon-trash-can mr-1" />
                清空
              </BaseButton>
            </div>
          </div>

          <div ref="logContainer" class="ui-subtle-panel relative max-h-[50vh] min-h-0 flex-1 overflow-x-hidden overflow-y-auto rounded-lg p-1.5 text-sm md:max-h-none sm:p-2" @scroll="onLogScroll">
            <div v-if="!visibleLogs.length" class="py-8 text-center text-gray-400">
              <div class="i-carbon-document-blank mx-auto mb-3 text-3xl text-gray-300" />
              <div class="text-sm text-gray-500 dark:text-gray-400">
                {{ hasActiveLogFilter ? '没有符合条件的日志' : '暂无日志' }}
              </div>
              <div class="mt-1 text-xs text-gray-400">
                {{ hasActiveLogFilter ? '可以调整或重置筛选条件。' : '运行账号后，这里会持续追加巡查、种植、任务和出售记录。' }}
              </div>
            </div>
            <div
              v-for="log in visibleLogs"
              :key="log.id"
              class="grid grid-cols-1 mb-0.5 gap-x-2 gap-y-1 border rounded-md px-2.5 py-1.5 transition-colors sm:grid-cols-[auto_1fr] sm:gap-y-0"
              :class="getLogRowClass(log)"
            >
              <span class="select-none whitespace-nowrap pt-0.5 text-xs text-gray-400 font-mono">{{ formatLogTimeRange(log) }}</span>
              <div class="min-w-0">
                <div class="flex flex-wrap items-start gap-1">
                  <span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-bold" :class="getLogTagClass(log.tag)">{{ log.tag }}</span>
                  <span v-if="log.event && log.source !== 'account'" class="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-500 dark:bg-blue-900/20 dark:text-blue-400">{{ getEventLabel(log.event) }}</span>
                  <span class="min-w-0 break-words leading-5" :class="getLogMsgClass(log.tag)">{{ log.msg }}</span>
                </div>
              </div>
            </div>

            <button
              v-if="pendingLogCount"
              class="sticky bottom-2 left-1/2 z-10 flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-white shadow-lg -translate-x-1/2"
              style="background: var(--theme-primary)"
              @click="scrollToBottom"
            >
              <div class="i-carbon-arrow-down" />
              {{ pendingLogCount }} 条新日志
            </button>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-4 md:min-h-0 md:w-1/4 md:overflow-hidden">
        <div class="ui-card flex shrink-0 flex-col rounded-lg p-3.5">
          <h3 class="mb-3 flex items-center gap-2 text-base font-medium 2xl:text-lg">
            <div class="i-carbon-hourglass" />
            <span>下次检查倒计时</span>
          </h3>
          <div class="grid grid-cols-3 gap-2">
            <div class="min-w-0 flex flex-col items-center text-center">
              <div
                class="h-18 w-18 flex items-center justify-center rounded-full p-1"
                :style="getCountdownRingStyle(localNextFarmRemainSec, farmCountdownTotal, '#22c55e')"
              >
                <div class="h-full w-full flex flex-col items-center justify-center rounded-full bg-white dark:bg-gray-800">
                  <div class="i-carbon-sprout text-xl text-green-500" />
                  <span class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">农场</span>
                </div>
              </div>
              <div class="mt-1.5 w-full truncate text-sm font-bold font-mono 2xl:text-base" :title="nextFarmCheck">
                {{ nextFarmCheck }}
              </div>
            </div>
            <div class="min-w-0 flex flex-col items-center text-center">
              <div
                class="h-18 w-18 flex items-center justify-center rounded-full p-1"
                :style="getCountdownRingStyle(localNextHelpRemainSec, helpCountdownTotal, '#3b82f6')"
              >
                <div class="h-full w-full flex flex-col items-center justify-center rounded-full bg-white dark:bg-gray-800">
                  <div class="i-carbon-user-multiple text-xl text-blue-500" />
                  <span class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">好友巡查</span>
                </div>
              </div>
              <div class="mt-1.5 w-full truncate text-sm font-bold font-mono 2xl:text-base" :title="nextHelpCheck">
                {{ nextHelpCheck }}
              </div>
            </div>
            <div class="min-w-0 flex flex-col items-center text-center">
              <div
                class="h-18 w-18 flex items-center justify-center rounded-full p-1"
                :style="getCountdownRingStyle(localNextStealRemainSec, stealCountdownTotal, '#f97316')"
              >
                <div class="h-full w-full flex flex-col items-center justify-center rounded-full bg-white dark:bg-gray-800">
                  <div class="i-carbon-run text-xl text-orange-500" />
                  <span class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">偷菜</span>
                </div>
              </div>
              <div class="mt-1.5 w-full truncate text-sm font-bold font-mono 2xl:text-base" :title="nextStealCheck">
                {{ nextStealCheck }}
              </div>
            </div>
          </div>
        </div>

        <div class="ui-card min-h-0 flex flex-1 flex-col overflow-hidden rounded-lg p-4">
          <h3 class="mb-3 flex items-center gap-2 text-base font-medium 2xl:text-lg">
            <div class="i-carbon-chart-column" />
            <span>今日统计</span>
          </h3>
          <div v-if="currentAccountDisconnected" class="ui-subtle-panel flex flex-col items-center justify-center gap-3 rounded-lg p-5 text-center text-gray-500">
            <div class="i-carbon-connection-signal-off text-4xl text-gray-400" />
            <div class="flex flex-col">
              <div class="text-lg text-gray-700 font-medium dark:text-gray-300">
                账号未登录
              </div>
              <div class="mt-1 text-sm text-gray-400">
                请先运行账号或检查网络连接。
              </div>
            </div>
          </div>
          <div v-else-if="!Object.keys(filteredOperations).length" class="ui-subtle-panel flex flex-col items-center justify-center gap-2 rounded-lg p-5 text-center">
            <div class="i-carbon-chart-column text-3xl text-gray-300" />
            <div class="text-sm text-gray-600 font-medium dark:text-gray-300">
              暂无主动作统计
            </div>
            <div class="text-xs text-gray-400">
              通常是刚启动、刚切换账号，或本轮巡查尚未完成。
            </div>
          </div>
          <div v-else class="grid auto-rows-fr grid-cols-2 min-h-0 flex-1 gap-1.5 2xl:gap-2">
            <div
              v-for="(val, key) in filteredOperations"
              :key="key"
              class="group min-w-0 flex items-center justify-between rounded-xl border border-gray-200/60 bg-white/50 px-2 py-1.5 transition-all duration-200 hover:-translate-y-px hover:border-gray-300 hover:shadow-md dark:border-gray-700/50 dark:bg-gray-800/40 dark:hover:border-gray-600 2xl:px-2.5"
            >
              <div class="min-w-0 flex items-center gap-2">
                <span
                  class="h-6 w-6 flex flex-none items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-110 2xl:h-7 2xl:w-7 2xl:text-base"
                  :class="getOpBadge(key)"
                >
                  <div class="text-sm 2xl:text-base" :class="[getOpIcon(key), getOpColor(key)]" />
                </span>
                <div class="truncate text-xs text-gray-500 2xl:text-sm" :title="getOpName(key)">
                  {{ getOpName(key) }}
                </div>
              </div>
              <div
                class="text-sm font-bold tabular-nums transition-colors 2xl:text-base"
                :class="val > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-300 dark:text-gray-600'"
              >
                {{ val }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ConsumptionModal
      :show="showConsumption"
      :account-id="currentAccountId"
      @close="showConsumption = false"
    />

    <Teleport to="body">
      <RenewCardModal
        :show="showRenewModal"
        @close="showRenewModal = false"
      />
    </Teleport>
  </div>
</template>
