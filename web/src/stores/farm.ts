import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

export interface Land {
  id: number
  plantName?: string
  phaseName?: string
  phase?: number
  imagePhase?: number
  seedImage?: string
  plantImage?: string
  status: string
  matureInSec: number
  phaseStartTime?: number
  phaseEndTime?: number
  needWater?: boolean
  needWeed?: boolean
  needBug?: boolean
  [key: string]: any
}

export const useFarmStore = defineStore('farm', () => {
  const lands = ref<Land[]>([])
  const seeds = ref<any[]>([])
  const summary = ref<any>({})
  const weather = ref<any>(null)
  const loading = ref(false)
  const seedsLoading = ref(false)
  const seedsLoaded = ref(false)
  const seedsError = ref('')
  const dogSkillGiftPendingCount = ref(0)
  const dogSkillGiftLoading = ref(false)
  const dogSkillGiftError = ref('')

  function clearFarmData() {
    lands.value = []
    seeds.value = []
    summary.value = {}
    weather.value = null
    seedsLoading.value = false
    seedsLoaded.value = false
    seedsError.value = ''
    dogSkillGiftPendingCount.value = 0
    dogSkillGiftError.value = ''
  }

  function isCurrentAccount(accountId: string) {
    const accountStore = useAccountStore()
    const currentId = String((accountStore.currentAccountId as { value?: string })?.value ?? accountStore.currentAccountId ?? '')
    return currentId === String(accountId)
  }

  async function fetchLands(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    loading.value = true
    try {
      const { data } = await api.get('/api/lands', {
        headers: { 'x-account-id': accountId },
      })
      if (!isCurrentAccount(requestedId))
        return
      if (data && data.ok) {
        lands.value = data.data.lands || []
        summary.value = data.data.summary || {}
        weather.value = data.data.weather || null
      }
    }
    finally {
      loading.value = false
    }
  }

  async function fetchSeeds(accountId: string) {
    if (!accountId)
      return
    const requestedId = String(accountId)
    seedsLoading.value = true
    seedsError.value = ''
    try {
      const { data } = await api.get('/api/seeds', {
        headers: { 'x-account-id': accountId },
      })
      if (!isCurrentAccount(requestedId))
        return
      if (data && data.ok) {
        seeds.value = data.data || []
        seedsLoaded.value = true
      }
      else {
        // 账号未启动时后端返回 { ok: false, error: '账号未运行' }。
        // 之前这里静默丢弃，导致「第二优先策略预览」永远停在「加载中...」。
        seeds.value = []
        seedsLoaded.value = true
        seedsError.value = String((data && data.error) || '获取种子列表失败')
      }
    }
    catch (e: any) {
      if (!isCurrentAccount(requestedId))
        return
      seeds.value = []
      seedsLoaded.value = true
      seedsError.value = String(e?.response?.data?.error || e?.message || '获取种子列表失败')
    }
    finally {
      if (isCurrentAccount(requestedId))
        seedsLoading.value = false
    }
  }

  async function fetchDogSkillGiftStatus(accountId: string) {
    if (!accountId)
      return
    dogSkillGiftLoading.value = true
    dogSkillGiftError.value = ''
    try {
      const { data } = await api.get('/api/dog/skill-gifts', {
        headers: { 'x-account-id': accountId },
      })
      if (isCurrentAccount(accountId) && data?.ok)
        dogSkillGiftPendingCount.value = Math.max(0, Number(data.data?.pendingCount) || 0)
    }
    catch (error: any) {
      if (isCurrentAccount(accountId))
        dogSkillGiftError.value = String(error?.response?.data?.error || error?.message || '礼包状态读取失败')
    }
    finally {
      dogSkillGiftLoading.value = false
    }
  }

  async function claimDogSkillGifts(accountId: string) {
    if (!accountId)
      return null
    dogSkillGiftLoading.value = true
    dogSkillGiftError.value = ''
    try {
      const { data } = await api.post('/api/dog/skill-gifts/claim', {}, {
        headers: { 'x-account-id': accountId },
      })
      if (!data?.ok)
        throw new Error(data?.error || '礼包拾取失败')
      if (isCurrentAccount(accountId))
        dogSkillGiftPendingCount.value = Math.max(0, Number(data.data?.pending) || 0)
      return data.data
    }
    catch (error: any) {
      if (isCurrentAccount(accountId))
        dogSkillGiftError.value = String(error?.response?.data?.error || error?.message || '礼包拾取失败')
      return null
    }
    finally {
      dogSkillGiftLoading.value = false
    }
  }

  async function operate(accountId: string, opType: string) {
    if (!accountId)
      return
    await api.post('/api/farm/operate', { opType }, {
      headers: { 'x-account-id': accountId },
    })
    await fetchLands(accountId)
  }

  async function fertilizeLand(accountId: string, landId: number) {
    if (!accountId)
      return
    const { data } = await api.post('/api/land/fertilize', { landId }, {
      headers: { 'x-account-id': accountId },
    })
    await fetchLands(accountId)
    return data
  }

  async function removePlant(accountId: string, landId: number) {
    if (!accountId)
      return
    const { data } = await api.post('/api/land/remove', { landId }, {
      headers: { 'x-account-id': accountId },
    })
    await fetchLands(accountId)
    return data
  }

  async function removeAllPlants(accountId: string) {
    if (!accountId)
      return
    const { data } = await api.post('/api/land/remove-all', {}, {
      headers: { 'x-account-id': accountId },
    })
    await fetchLands(accountId)
    return data
  }

  return {
    lands,
    summary,
    weather,
    seeds,
    seedsLoading,
    seedsLoaded,
    seedsError,
    loading,
    dogSkillGiftPendingCount,
    dogSkillGiftLoading,
    dogSkillGiftError,
    clearFarmData,
    fetchLands,
    fetchSeeds,
    fetchDogSkillGiftStatus,
    claimDogSkillGifts,
    operate,
    fertilizeLand,
    removePlant,
    removeAllPlants,
  }
})
