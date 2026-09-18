import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

type AlertType = 'primary' | 'danger'

export function useAccountSettings(showAlert: (message: string, type?: AlertType) => void) {
  const router = useRouter()
  const accountStore = useAccountStore()
  const toastStore = useToastStore()
  const userStore = useUserStore()
  const { accounts, loading: accountsLoading, currentAccountId } = storeToRefs(accountStore)

  const showModal = ref(false)
  const showDeleteConfirm = ref(false)
  const deleteLoading = ref(false)
  const editingAccount = ref<any>(null)
  const accountToDelete = ref<any>(null)
  const showClearStoppedConfirm = ref(false)
  const clearStoppedLoading = ref(false)
  const refreshWxCodesLoading = ref(false)
  // 新增账号保存成功后置为目标账号，驱动启动进度弹窗；编辑账号保持 null
  const startupAccount = ref<{ id: string, name?: string, platform?: string, startErrorAt?: number } | null>(null)

  const userIsAdmin = computed(() => userStore.isAdmin)
  const isAccountOpsDisabled = computed(() => !userStore.isAdmin && userStore.isExpired)
  const quotaLimit = computed(() => {
    const limit = userStore.accountLimit
    if (limit === undefined || limit === null)
      return 1
    return limit
  })
  const isOverQuota = computed(() => {
    if (userStore.isAdmin)
      return false
    const limit = quotaLimit.value
    if (limit === -1)
      return false
    return accounts.value.length >= limit
  })
  const isAddAccountDisabled = computed(() => isAccountOpsDisabled.value || isOverQuota.value)
  const addAccountDisabledReason = computed(() => {
    if (isAccountOpsDisabled.value)
      return '账号已到期，无法添加账号'
    if (isOverQuota.value)
      return '已超过配额，无法添加账号'
    return ''
  })

  const stoppedAccounts = computed(() => accounts.value.filter((acc: any) => !acc.running))
  const stoppedAccountsCount = computed(() => stoppedAccounts.value.length)
  const currentAccountName = computed(() => {
    const acc = accounts.value.find((item: any) => item.id === currentAccountId.value)
    return acc ? (acc.name || acc.nick || acc.id) : null
  })

  useIntervalFn(() => {
    accountStore.fetchAccounts()
  }, 3000)

  // 账号启动失败时，在右上角弹出可重试的通知
  // 记录每个账号上次已提示过的失败时间戳，避免轮询期间重复弹窗
  const notifiedStartErrors = new Map<string, number>()

  // 通知里不展示内部错误码和 rid 等技术细节，完整信息保留在账号卡片的悬停提示里
  function formatStartError(message: unknown): string {
    const text = String(message || '').trim()
    if (!text)
      return '未知错误'
    return text
      .replace(/\s*msg=[\s\S]*$/, '')
      .replace(/\s*code=\S*/g, '')
      .replace(/[:\s]+$/, '')
      .trim() || text
  }

  watch(accounts, (list) => {
    if (!Array.isArray(list))
      return
    const alive = new Set<string>()
    for (const acc of list) {
      if (!acc || acc.id === undefined || acc.id === null)
        continue
      const id = String(acc.id)
      alive.add(id)
      if (acc.startError && !acc.running) {
        const stamp = Number(acc.startErrorAt || 0)
        if (notifiedStartErrors.get(id) !== stamp) {
          notifiedStartErrors.set(id, stamp)
          const name = acc.name || acc.nick || id
          toastStore.add(
            `账号「${name}」启动失败：${formatStartError(acc.startError)}`,
            'error',
            3000,
            {
              label: acc.platform === 'wx' ? '重新获取微信Code' : '重新获取',
              handler: () => {
                void retryStartAccount(acc)
              },
            },
          )
        }
      }
      else if (!acc.startError) {
        notifiedStartErrors.delete(id)
      }
    }
    for (const id of Array.from(notifiedStartErrors.keys())) {
      if (!alive.has(id))
        notifiedStartErrors.delete(id)
    }
  }, { deep: true })

  async function fetchAccounts() {
    await accountStore.fetchAccounts()
  }

  function selectFirstAccountIfNeeded() {
    if (!currentAccountId.value && accounts.value.length > 0 && accounts.value[0]) {
      accountStore.selectAccount(String(accounts.value[0].id))
    }
  }

  function openSettings(account: any) {
    accountStore.selectAccount(account.id)
    router.push('/settings')
  }

  function openAddModal() {
    editingAccount.value = null
    showModal.value = true
  }

  function openEditModal(account: any) {
    editingAccount.value = { ...account }
    showModal.value = true
  }

  function handleDelete(account: any) {
    accountToDelete.value = account
    showDeleteConfirm.value = true
  }

  async function confirmDelete() {
    if (accountToDelete.value) {
      try {
        deleteLoading.value = true
        await accountStore.deleteAccount(accountToDelete.value.id)
        accountToDelete.value = null
        showDeleteConfirm.value = false
      }
      finally {
        deleteLoading.value = false
      }
    }
  }

  // 启动账号是「排队 + 后台执行」的：微信账号还要先刷新 Code（实测约 9 秒）才拉起
  // worker。等 /start 接口返回再弹窗会直接错过「启动中」阶段，所以点击启动后立刻展示
  // 启动进度弹窗，由它自己轮询 /api/status 与 /api/accounts 跟踪真实结果。
  function openStartupModal(account: any) {
    if (!account || account.id === undefined || account.id === null)
      return
    startupAccount.value = {
      id: String(account.id),
      name: account.name || account.nick || '',
      platform: account.platform || '',
      // 带上打开时的失败时间戳，弹窗据此忽略重试前的旧 startError
      startErrorAt: Number(account.startErrorAt || 0),
    }
  }

  async function toggleAccount(account: any) {
    if (account.running) {
      await accountStore.stopAccount(account.id)
      return
    }
    openStartupModal(account)
    try {
      await accountStore.startAccount(account.id)
    }
    catch (error) {
      // 启动请求本身失败（无权访问 / 账号已到期 / 账号不存在）时不能留下一直转圈的弹窗
      startupAccount.value = null
      throw error
    }
  }

  // 启动失败后重试：清理该账号的失败提示，重新拉起启动
  async function retryStartAccount(account: any) {
    if (!account || !account.id)
      return
    notifiedStartErrors.delete(String(account.id))
    openStartupModal(account)
    try {
      await accountStore.startAccount(account.id)
      await accountStore.fetchAccounts()
    }
    catch (error: any) {
      startupAccount.value = null
      const name = account.name || account.nick || account.id
      toastStore.error(`账号「${name}」重新获取失败：${error?.response?.data?.error || error?.message || '请稍后重试'}`)
    }
  }

  async function refreshWxCodesNow() {
    if (refreshWxCodesLoading.value)
      return

    refreshWxCodesLoading.value = true
    try {
      const result = await accountStore.refreshWxCodes()
      const data = result.data
      if (!result.ok) {
        if (data && data.total > 0) {
          showAlert(`微信 Code 刷新完成：成功 ${data.success} 个，失败 ${data.failed} 个`, 'danger')
        }
        else {
          showAlert(result.error || '没有可刷新的微信账号', 'danger')
        }
        return
      }

      const skippedText = data && data.skipped > 0 ? `，跳过 ${data.skipped} 个非微信账号` : ''
      showAlert(`微信 Code 刷新完成：成功 ${data?.success || 0} 个${skippedText}`, 'primary')
    }
    catch (error: any) {
      showAlert(error.response?.data?.error || error.message || '刷新微信 Code 失败', 'danger')
    }
    finally {
      refreshWxCodesLoading.value = false
    }
  }

  // AccountModal 保存成功后会带上账号信息：新增与「编辑并提交新凭证」都会由
  // 后端排队后台启动（startup.accountId 回传），这里交给启动进度弹窗跟踪启动结果。
  function handleSaved(payload?: {
    created?: { id?: string, name?: string, platform?: string } | null
    startup?: { queued?: boolean, accountId?: string } | null
  }) {
    accountStore.fetchAccounts()
    const created = payload?.created
    const startupAccountId = payload?.startup?.accountId ? String(payload.startup.accountId) : ''
    const target = created?.id
      ? created
      : (startupAccountId ? { id: startupAccountId, name: '', platform: '' } : null)
    if (target?.id) {
      startupAccount.value = {
        id: String(target.id),
        name: target.name || '',
        platform: target.platform || '',
      }
    }
  }

  function closeStartupModal() {
    startupAccount.value = null
  }

  function selectAccount(account: any) {
    if (!account || !account.id)
      return
    accountStore.selectAccount(String(account.id))
  }

  function openClearStoppedConfirm() {
    if (stoppedAccountsCount.value === 0) {
      showAlert('没有已停止的账号需要清理', 'primary')
      return
    }
    showClearStoppedConfirm.value = true
  }

  async function confirmClearStopped() {
    clearStoppedLoading.value = true
    try {
      const stoppedIds = stoppedAccounts.value.map((acc: any) => acc.id)
      let deletedCount = 0
      for (const id of stoppedIds) {
        try {
          await accountStore.deleteAccount(id)
          deletedCount++
        }
        catch (e) {
          console.error(`删除账号 ${id} 失败:`, e)
        }
      }
      showClearStoppedConfirm.value = false
      showAlert(`成功清理 ${deletedCount} 个已停止的账号`, 'primary')
      await accountStore.fetchAccounts()
    }
    finally {
      clearStoppedLoading.value = false
    }
  }

  return {
    accounts,
    accountsLoading,
    currentAccountId,
    currentAccountName,
    userIsAdmin,
    showModal,
    showDeleteConfirm,
    deleteLoading,
    editingAccount,
    accountToDelete,
    showClearStoppedConfirm,
    clearStoppedLoading,
    refreshWxCodesLoading,
    startupAccount,
    stoppedAccountsCount,
    isAddAccountDisabled,
    addAccountDisabledReason,
    isAccountOpsDisabled,
    fetchAccounts,
    selectFirstAccountIfNeeded,
    openSettings,
    openAddModal,
    openEditModal,
    handleDelete,
    confirmDelete,
    toggleAccount,
    retryStartAccount,
    refreshWxCodesNow,
    handleSaved,
    closeStartupModal,
    selectAccount,
    openClearStoppedConfirm,
    confirmClearStopped,
  }
}
