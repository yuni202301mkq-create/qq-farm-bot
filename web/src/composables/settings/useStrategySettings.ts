import type { Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { ref, watchEffect } from 'vue'
import api from '@/api'
import { useFarmStore } from '@/stores/farm'
import { useSettingStore } from '@/stores/setting'

interface AutomationSettingsSnapshot {
  automation: Record<string, unknown>
}

type AlertType = 'primary' | 'danger'

const analyticsSortByMap: Record<string, string> = {
  max_exp: 'exp',
  max_fert_exp: 'fert',
  max_profit: 'profit',
  max_fert_profit: 'fert_profit',
}

/**
 * 把后端 provider 的原始报错转成用户能看懂、且能指导下一步操作的文案。
 * 后端在账号未启动时返回 `账号未运行`，直接展示对普通用户没有意义。
 */
function friendlySeedError(raw: unknown): string {
  const message = String(raw || '').trim()
  if (!message)
    return '预览加载失败，请稍后重试'
  if (message.includes('账号未运行') || message.includes('未连接'))
    return '账号未启动，无法预览（启动账号后自动刷新）'
  if (message.includes('API Timeout') || message.includes('timeout'))
    return '预览加载超时，请稍后重试'
  return message
}

export function useStrategySettings({
  currentAccountId,
  getAutomationSettings,
  showAlert,
}: {
  currentAccountId: Ref<string | number | null | undefined>
  getAutomationSettings: () => AutomationSettingsSnapshot
  showAlert: (message: string, type?: AlertType) => void
}) {
  const settingStore = useSettingStore()
  const farmStore = useFarmStore()
  const { settings, loading: settingsLoading } = storeToRefs(settingStore)
  const { seeds, seedsLoaded, seedsError } = storeToRefs(farmStore)

  const strategySaving = ref(false)

  const localStrategySettings = ref({
    plantingStrategy: 'max_exp',
    prioritize2x2Crops: false,
    prioritizeGrowthTasks: false,
    bagSeedPriority: [] as number[],
    bagSeedKnownIds: [] as number[],
    bagSeedExcludedIds: [] as number[],
    bagSeedFallbackStrategy: 'level',
    intervals: { farmMin: 2, farmMax: 5, helpMin: 10, helpMax: 15 },
    friendQuietHours: { enabled: true, start: '23:00', end: '07:00' },
  })

  const plantingStrategyOptions = [
    { label: '背包种子优先', value: 'bag_priority' },
    { label: '任务作物优先', value: 'task_priority' },
    { label: '最高等级作物', value: 'level' },
    { label: '最大经验/时', value: 'max_exp' },
    { label: '最大普通肥经验/时', value: 'max_fert_exp' },
    { label: '最大净利润/时', value: 'max_profit' },
    { label: '最大普通肥净利润/时', value: 'max_fert_profit' },
  ]

  const bagFallbackStrategyOptions = [
    { label: '最高等级作物', value: 'level' },
    { label: '最大经验/时', value: 'max_exp' },
    { label: '最大普通肥经验/时', value: 'max_fert_exp' },
    { label: '最大净利润/时', value: 'max_profit' },
    { label: '最大普通肥净利润/时', value: 'max_fert_profit' },
  ]

  let strategyPreviewRequestId = 0

  const strategyPreviewLabel = ref<string | null>(null)
  // 区分「正在加载」与「加载完了但没有结果」两种状态。
  // 之前只用 strategyPreviewLabel 单个 ref 表示，null 既代表加载中也代表无结果，
  // 模板 `?? '加载中...'` 就会把「无结果」也渲染成「加载中...」，永久卡住。
  const strategyPreviewLoading = ref(false)

  watchEffect(async (onCleanup) => {
    const requestId = ++strategyPreviewRequestId
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })

    let strategy = localStrategySettings.value.plantingStrategy
    if (strategy === 'bag_priority' || strategy === 'task_priority')
      strategy = localStrategySettings.value.bagSeedFallbackStrategy || 'level'

    const applyLabel = (label: string | null, loading = false) => {
      if (cancelled || requestId !== strategyPreviewRequestId)
        return
      strategyPreviewLabel.value = label
      strategyPreviewLoading.value = loading
    }

    const accountId = currentAccountId.value
    if (!accountId) {
      applyLabel('请先选择账号')
      return
    }

    // seeds 还没加载完 → 保持「加载中」
    if (!seedsLoaded.value) {
      applyLabel(null, true)
      return
    }

    if (seedsError.value) {
      applyLabel(friendlySeedError(seedsError.value))
      return
    }

    const allSeeds = seeds.value || []
    if (allSeeds.length === 0) {
      applyLabel('暂无可选种子')
      return
    }

    const available = allSeeds.filter(s => !s.locked && !s.soldOut)
    if (available.length === 0) {
      applyLabel('暂无可用种子')
      return
    }

    if (strategy === 'level') {
      const best = [...available].sort((a, b) => (b.requiredLevel || 0) - (a.requiredLevel || 0))[0]
      applyLabel(best ? `${best.requiredLevel}级 ${best.name}` : '暂无匹配种子')
      return
    }

    const sortBy = analyticsSortByMap[strategy]
    if (!sortBy) {
      applyLabel('暂无匹配种子')
      return
    }

    const requestedId = String(accountId)
    applyLabel(null, true)
    try {
      const res = await api.get(`/api/analytics?sort=${sortBy}`, {
        headers: { 'x-account-id': accountId },
      })
      if (cancelled || requestId !== strategyPreviewRequestId
        || String(currentAccountId.value || '') !== requestedId) {
        return
      }
      if (!res.data?.ok) {
        applyLabel(friendlySeedError(res.data?.error))
        return
      }
      const rankings: any[] = res.data.data || []
      const availableIds = new Set(available.map(s => s.seedId))
      const match = rankings.find(r => availableIds.has(Number(r.seedId)))
      if (match) {
        const seed = available.find(s => s.seedId === Number(match.seedId))
        applyLabel(seed ? `${seed.requiredLevel}级 ${seed.name}` : '暂无匹配种子')
      }
      else {
        applyLabel('暂无匹配种子')
      }
    }
    catch (e: any) {
      applyLabel(friendlySeedError(e?.response?.data?.error || e?.message))
    }
  })

  function syncLocalStrategySettings() {
    if (settings.value) {
      localStrategySettings.value = JSON.parse(JSON.stringify({
        plantingStrategy: settings.value.prioritizeGrowthTasks === true
          ? 'task_priority'
          : settings.value.plantingStrategy,
        prioritize2x2Crops: settings.value.prioritize2x2Crops === true,
        prioritizeGrowthTasks: settings.value.prioritizeGrowthTasks === true,
        bagSeedPriority: settings.value.bagSeedPriority ?? [],
        bagSeedKnownIds: settings.value.bagSeedKnownIds ?? [],
        bagSeedExcludedIds: settings.value.bagSeedExcludedIds ?? [],
        bagSeedFallbackStrategy: settings.value.bagSeedFallbackStrategy ?? 'level',
        intervals: settings.value.intervals,
        friendQuietHours: settings.value.friendQuietHours,
      }))
    }
  }

  async function loadStrategyData() {
    if (currentAccountId.value) {
      const accountId = String(currentAccountId.value)
      await settingStore.fetchSettings(accountId)
      syncLocalStrategySettings()
      await farmStore.fetchSeeds(accountId)
    }
  }

  async function saveStrategySettings() {
    if (!currentAccountId.value)
      return
    strategySaving.value = true
    try {
      const fullSettings = {
        ...settings.value,
        ...localStrategySettings.value,
        prioritizeGrowthTasks: localStrategySettings.value.plantingStrategy === 'task_priority',
        automation: getAutomationSettings().automation,
      }
      const res = await settingStore.saveSettings(String(currentAccountId.value), fullSettings)
      if (res.ok) {
        showAlert('策略设置已保存', 'primary')
      }
      else {
        showAlert(`保存失败: ${res.error}`, 'danger')
      }
    }
    finally {
      strategySaving.value = false
    }
  }

  function resetStrategyState() {
    strategyPreviewLabel.value = null
    strategyPreviewLoading.value = false
  }

  return {
    settings,
    settingsLoading,
    strategySaving,
    localStrategySettings,
    plantingStrategyOptions,
    bagFallbackStrategyOptions,
    strategyPreviewLabel,
    strategyPreviewLoading,
    syncLocalStrategySettings,
    loadStrategyData,
    saveStrategySettings,
    resetStrategyState,
  }
}
