import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
import { useAccountStore } from './account'

/**
 * 种子锁定：被锁定的种子在背包中不可出售（单个/批量），可单个或批量锁定/解锁。
 */
export const useSeedLockStore = defineStore('seed-lock', () => {
  const locks = ref<number[]>([])
  const loading = ref(false)
  let fetchRequestId = 0

  function isCurrentAccount(accountId: string) {
    const accountStore = useAccountStore()
    const currentId = String((accountStore.currentAccountId as { value?: string })?.value ?? accountStore.currentAccountId ?? '')
    return currentId === String(accountId)
  }

  function isLocked(seedId: number | string) {
    return locks.value.includes(Number(seedId))
  }

  function clearSeedLockData() {
    locks.value = []
    loading.value = false
  }

  async function fetchSeedLocks() {
    const accountStore = useAccountStore()
    const accountId = accountStore.currentAccountId
    if (!accountId)
      return
    const requestedId = String(accountId)
    const requestId = ++fetchRequestId
    loading.value = true
    try {
      const res = await api.get('/api/seed-locks', {
        headers: { 'x-account-id': accountId },
      })
      if (requestId !== fetchRequestId || !isCurrentAccount(requestedId))
        return
      if (res.data.ok)
        locks.value = res.data.data || []
    }
    catch { /* ignore */ }
    finally {
      if (requestId === fetchRequestId)
        loading.value = false
    }
  }

  /** 锁定单个或批量 */
  async function lockSeedIds(seedIds: number | number[]) {
    const accountStore = useAccountStore()
    const accountId = accountStore.currentAccountId
    if (!accountId)
      return
    const ids = (Array.isArray(seedIds) ? seedIds : [seedIds]).map(Number).filter(id => Number.isFinite(id) && id > 0)
    if (!ids.length)
      return
    const requestedId = String(accountId)
    const res = await api.post('/api/seed-locks', { seedIds: ids }, {
      headers: { 'x-account-id': accountId },
    })
    if (isCurrentAccount(requestedId) && res.data.ok)
      locks.value = res.data.data || []
  }

  /** 解锁单个或批量；不传参则全部解锁 */
  async function unlockSeedIds(seedIds?: number | number[]) {
    const accountStore = useAccountStore()
    const accountId = accountStore.currentAccountId
    if (!accountId)
      return
    const ids = seedIds === undefined
      ? []
      : (Array.isArray(seedIds) ? seedIds : [seedIds]).map(Number).filter(id => Number.isFinite(id) && id > 0)
    const requestedId = String(accountId)
    const res = await api.delete('/api/seed-locks', {
      headers: { 'x-account-id': accountId },
      data: ids.length ? { seedIds: ids } : {},
    })
    if (isCurrentAccount(requestedId) && res.data.ok)
      locks.value = res.data.data || []
  }

  return {
    locks,
    loading,
    isLocked,
    fetchSeedLocks,
    lockSeedIds,
    unlockSeedIds,
    clearSeedLockData,
  }
})
