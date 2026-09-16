<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/api'
import AdminSystemPanel from '@/components/admin/AdminSystemPanel.vue'
import CardKeyPanel from '@/components/admin/CardKeyPanel.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import AccountSettingsTab from '@/components/settings/AccountSettingsTab.vue'
import AutomationControlPanel from '@/components/settings/AutomationControlPanel.vue'
import AutoCodeRefreshCard from '@/components/settings/AutoCodeRefreshCard.vue'
import ChangePasswordCard from '@/components/settings/ChangePasswordCard.vue'
import DefaultPlanTab from '@/components/settings/DefaultPlanTab.vue'
import DeviceProtocolCard from '@/components/settings/DeviceProtocolCard.vue'
import OfflineReminderCard from '@/components/settings/OfflineReminderCard.vue'
import PerformanceModeCard from '@/components/settings/PerformanceModeCard.vue'
import StrategySettingsPanel from '@/components/settings/StrategySettingsPanel.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountSettings } from '@/composables/settings/useAccountSettings'
import { useAutomationSettings } from '@/composables/settings/useAutomationSettings'
import { useStrategySettings } from '@/composables/settings/useStrategySettings'
import { useUserSettings } from '@/composables/settings/useUserSettings'
import { useAdminSystemConfig } from '@/composables/useAdminSystemConfig'
import { useSettingStore } from '@/stores/setting'
import { useUserStore } from '@/stores/user'

const settingStore = useSettingStore()
const userStore = useUserStore()
const route = useRoute()

type SettingsTabKey = 'account' | 'strategy' | 'automation' | 'default-plan' | 'system' | 'cardkey'

const SETTINGS_TAB_KEYS: SettingsTabKey[] = ['account', 'strategy', 'automation', 'default-plan', 'system', 'cardkey']
const LEGACY_SETTINGS_TABS: Record<string, SettingsTabKey> = {
  'strategy': 'strategy',
  'automation': 'automation',
  'default-plan': 'default-plan',
  'user': 'system',
  'usermgmt': 'system',
  'account-config': 'strategy',
  'notification': 'system',
  'capture': 'system',
  'performance': 'system',
}

function getInitialSettingsTab(): SettingsTabKey {
  const requested = String(route.query.tab || '')
  if (LEGACY_SETTINGS_TABS[requested])
    return LEGACY_SETTINGS_TABS[requested]
  if (SETTINGS_TAB_KEYS.includes(requested as SettingsTabKey))
    return requested as SettingsTabKey
  const saved = localStorage.getItem('settings-active-tab')
  if (saved && LEGACY_SETTINGS_TABS[saved])
    return LEGACY_SETTINGS_TABS[saved]
  return SETTINGS_TAB_KEYS.includes(saved as SettingsTabKey)
    ? saved as SettingsTabKey
    : 'account'
}

const activeTab = ref<SettingsTabKey>(getInitialSettingsTab())
const settingsTabsNav = ref<HTMLElement | null>(null)

async function scrollActiveTabIntoView() {
  await nextTick()
  const button = settingsTabsNav.value?.querySelector<HTMLElement>(`[data-settings-tab="${activeTab.value}"]`)
  button?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
}

watch(activeTab, (newTab) => {
  localStorage.setItem('settings-active-tab', newTab)
  void scrollActiveTabIntoView()
})

// 普通用户没有卡密设置页签，避免停留在不可见的 tab 上
watch(() => userStore.isSuperAdmin, (isSuper) => {
  if (!isSuper && activeTab.value === 'cardkey')
    activeTab.value = 'account'
}, { immediate: true })

const tabs = computed(() => {
  const all = [
    { key: 'account', label: '账号管理', icon: 'i-carbon-user-settings' },
    { key: 'strategy', label: '策略设置', icon: 'i-carbon-settings-adjust' },
    { key: 'automation', label: '自动控制', icon: 'i-carbon-settings' },
    { key: 'default-plan', label: '默认方案', icon: 'i-carbon-renew' },
    { key: 'system', label: '系统配置', icon: 'i-carbon-settings-services' },
    { key: 'cardkey', label: '卡密设置', icon: 'i-carbon-ticket' },
  ] as const
  // 卡密设置仅超级管理员可见；系统配置对全部用户开放（普通用户其中仅见用户管理和通知设置）
  return userStore.isSuperAdmin ? all : all.filter(tab => tab.key !== 'cardkey')
})

const modalVisible = ref(false)
const defaultPlanSettingId = ref('')
const defaultPlanApplyingId = ref('')
const defaultPlanConfirmation = ref<{
  action: 'set' | 'apply'
  account: any
} | null>(null)
const defaultPlanConfirmationVisible = computed(() => !!defaultPlanConfirmation.value)
const defaultPlanConfirmationTitle = computed(() =>
  defaultPlanConfirmation.value?.action === 'set' ? '设置默认方案' : '应用默认方案',
)
const defaultPlanConfirmationMessage = computed(() => {
  const pending = defaultPlanConfirmation.value
  if (!pending)
    return ''
  const accountName = pending.account?.name || pending.account?.id
  return pending.action === 'set'
    ? `确定将 ${accountName} 的当前配置设置为默认方案吗？这会覆盖此前保存的默认方案。`
    : `确定将默认方案应用到 ${accountName} 吗？这会覆盖该账号当前的相关配置。`
})
const modalConfig = ref({
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  isAlert: true,
})

function showAlert(message: string, type: 'primary' | 'danger' = 'primary') {
  modalConfig.value = {
    title: type === 'danger' ? '错误' : '提示',
    message,
    type,
    isAlert: true,
  }
  modalVisible.value = true
}

const {
  systemConfigSaving,
  captureConfigSaving,
  captureConfigTesting,
  localSystemConfig,
  defaultSystemConfig,
  localCaptureConfig,
  platformOptions,
  osOptions,
  loadCaptureConfig,
  handleTestCaptureConfig,
  loadSystemConfig,
  handleResetSystemConfig,
} = useAdminSystemConfig({ showAlert })

const {
  offlineSaving,
  offlineTesting,
  deviceProtocolLoading,
  deviceProtocolSaving,
  deviceProtocolPresetOptions,
  selectedDevicePreset,
  deviceProtocolForm,
  localOffline,
  channelOptions,
  currentChannelDocUrl,
  openChannelDocs,
  fillRandomDeviceMac,
  fillRandomDeviceId,
  fillRandomImei,
  applyDevicePreset,
  fetchDeviceProtocol,
  syncLocalOfflineSettings,
  handleSaveOffline,
  handleTestOffline,
} = useUserSettings(showAlert)

const {
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
  openAddModal,
  openEditModal,
  handleDelete,
  confirmDelete,
  toggleAccount,
  refreshWxCodesNow,
  handleSaved,
  closeStartupModal,
  selectAccount,
  openClearStoppedConfirm,
  confirmClearStopped,
} = useAccountSettings(showAlert)

const {
  localAutomationSettings,
  localAutoCodeRefresh,
  autoCodeRefreshing,
  fertilizerLandTypeOptions,
  fertilizerOptions,
  syncLocalAutomationSettings,
  runAutoCodeRefreshNow,
} = useAutomationSettings({
  currentAccountId,
  showAlert,
})

const {
  localStrategySettings,
  plantingStrategyOptions,
  bagFallbackStrategyOptions,
  strategyPreviewLabel,
  strategyPreviewLoading,
  syncLocalStrategySettings,
  fetchAccountSettings,
  loadSeedPreview,
  loadStrategyData,
  resetStrategyState,
} = useStrategySettings({
  currentAccountId,
  getAutomationSettings: () => localAutomationSettings.value,
  showAlert,
})

const accountSettingsSaving = ref(false)
const autoCodeRefreshSaving = ref(false)
const systemSettingsSaving = ref(false)
// 用户是否已经在本页改过开关（含开关自动保存）：改过之后后台刷新不再回写本地表单，
// 避免服务端旧值把刚切换的开关回退掉。
const accountSettingsDirty = ref(false)
const anySystemSaving = computed(() => systemSettingsSaving.value || systemConfigSaving.value || captureConfigSaving.value || deviceProtocolSaving.value)

function buildCurrentAccountConfig() {
  return {
    ...settingStore.settings,
    ...localStrategySettings.value,
    ...localAutomationSettings.value,
    autoCodeRefresh: localAutoCodeRefresh.value,
  }
}

async function saveCurrentAccountSettings(_module?: string, quiet = false) {
  if (!currentAccountId.value || accountSettingsSaving.value)
    return
  accountSettingsSaving.value = true
  accountSettingsDirty.value = true
  try {
    const result = await settingStore.saveSettings(String(currentAccountId.value), buildCurrentAccountConfig())
    if (!result.ok)
      throw new Error(result.error || '保存失败')
    if (!quiet)
      showAlert('账号设置已保存')
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '账号设置保存失败', 'danger')
  }
  finally {
    accountSettingsSaving.value = false
  }
}

async function saveAutoCodeRefreshSettings() {
  if (!currentAccountId.value || autoCodeRefreshSaving.value)
    return
  autoCodeRefreshSaving.value = true
  try {
    const result = await settingStore.saveAutoCodeRefresh(String(currentAccountId.value), localAutoCodeRefresh.value)
    if (!result.ok)
      throw new Error(result.error || '保存失败')
    showAlert('微信定时刷新重登设置已保存')
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '刷新设置保存失败', 'danger')
  }
  finally {
    autoCodeRefreshSaving.value = false
  }
}

async function openAccountSettings(account: any) {
  selectAccount(account)
  activeTab.value = 'strategy'
}

async function saveSystemSettings() {
  if (anySystemSaving.value)
    return
  systemSettingsSaving.value = true
  try {
    const devicePayload = {
      enabled: !!deviceProtocolForm.value.enabled,
      userAgent: String(deviceProtocolForm.value.userAgent || '').trim(),
      deviceBrand: String(deviceProtocolForm.value.deviceBrand || '').trim(),
      deviceModel: String(deviceProtocolForm.value.deviceModel || '').trim(),
      deviceMac: String(deviceProtocolForm.value.deviceMac || '').trim(),
      deviceId: String(deviceProtocolForm.value.deviceId || '').trim(),
      imei: String(deviceProtocolForm.value.imei || '').trim(),
    }
    const [systemResult, captureResult, deviceResult] = await Promise.all([
      api.post('/api/admin/system-config', { ...localSystemConfig.value, confirmed: true }),
      api.post('/api/admin/capture-config', { ...localCaptureConfig.value, confirmed: true }),
      api.post('/api/user/device-protocol', devicePayload),
    ])
    if (!systemResult.data?.ok || !captureResult.data?.ok || !deviceResult.data?.ok)
      throw new Error('部分系统配置保存失败')
    await Promise.all([loadSystemConfig(), loadCaptureConfig(), fetchDeviceProtocol()])
    showAlert('系统配置已统一保存并生效')
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '系统配置保存失败', 'danger')
  }
  finally {
    systemSettingsSaving.value = false
  }
}

async function applyDefaultPlan(account: any) {
  if (!account?.id || defaultPlanSettingId.value || defaultPlanApplyingId.value)
    return
  const accountId = String(account.id)
  defaultPlanApplyingId.value = accountId
  try {
    const { data } = await api.post('/api/settings/default-plan/apply', {}, {
      headers: { 'x-account-id': accountId },
    })
    if (!data?.ok)
      throw new Error(data?.error || '应用失败')
    if (String(currentAccountId.value || '') === accountId) {
      settingStore.clearSettingsState()
      resetStrategyState()
      await loadStrategyData()
      syncLocalAutomationSettings()
    }
    showAlert(`已将默认方案应用到 ${account.name || account.id}`)
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '应用默认方案失败', 'danger')
  }
  finally {
    defaultPlanApplyingId.value = ''
  }
}

async function setDefaultPlan(account: any) {
  if (!account?.id || defaultPlanSettingId.value || defaultPlanApplyingId.value)
    return
  const accountId = String(account.id)
  defaultPlanSettingId.value = accountId
  try {
    const { data } = await api.post('/api/settings/default-plan/import', {}, {
      headers: { 'x-account-id': accountId },
    })
    if (!data?.ok)
      throw new Error(data?.error || '设置失败')
    showAlert(`已将 ${account.name || account.id} 的配置设置为默认方案`)
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '设置默认方案失败', 'danger')
  }
  finally {
    defaultPlanSettingId.value = ''
  }
}

function requestDefaultPlanConfirmation(action: 'set' | 'apply', account: any) {
  if (!account?.id || defaultPlanSettingId.value || defaultPlanApplyingId.value)
    return
  defaultPlanConfirmation.value = { action, account }
}

function closeDefaultPlanConfirmation() {
  defaultPlanConfirmation.value = null
}

function confirmDefaultPlanOperation() {
  const pending = defaultPlanConfirmation.value
  if (!pending)
    return
  closeDefaultPlanConfirmation()
  if (pending.action === 'set')
    void setDefaultPlan(pending.account)
  else
    void applyDefaultPlan(pending.account)
}

// 账号设置数据就绪标记：只有在「当前账号还没有任何设置数据」时才整页显示加载态。
// 之前这里把 settingsLoading 也算进加载条件，导致每次保存（含开关自动保存）都会
// 整页闪回「加载中...」；而且种子列表要走游戏协议，慢的时候会连带面板一起等。
const accountDataReady = ref(settingStore.hasSettingsFor(currentAccountId.value))
const accountSettingsLoading = computed(() => !accountDataReady.value && !!currentAccountId.value)

// 用 store 里已缓存的设置填满本地表单，让面板立刻显示真实值（而不是默认值）
function applyCachedAccountSettings() {
  syncLocalStrategySettings()
  syncLocalAutomationSettings()
  syncLocalOfflineSettings()
  accountDataReady.value = true
}

let accountSettingsLoadToken = 0

async function loadCurrentAccountSettings() {
  const accountId = currentAccountId.value
  if (!accountId) {
    accountDataReady.value = true
    return
  }
  const token = ++accountSettingsLoadToken
  // 有该账号的缓存 → 先渲染再后台刷新；没有 → 才显示加载态
  const hadCache = settingStore.hasSettingsFor(accountId)
  if (hadCache)
    applyCachedAccountSettings()
  else
    accountDataReady.value = false

  await fetchAccountSettings()
  if (token !== accountSettingsLoadToken || String(currentAccountId.value || '') !== String(accountId))
    return
  if (!hadCache || !accountSettingsDirty.value) {
    syncLocalStrategySettings()
    syncLocalAutomationSettings()
    syncLocalOfflineSettings()
  }
  accountDataReady.value = true
  loadSeedPreview()
}

watch(currentAccountId, async (newId, previousId) => {
  if (String(newId || '') === String(previousId || ''))
    return
  // 切号：先清掉上一个账号的设置，避免在加载完成前显示旧账号的开关状态
  settingStore.clearSettingsState()
  resetStrategyState()
  accountDataReady.value = false
  accountSettingsDirty.value = false
  await loadCurrentAccountSettings()
})

// 账号启动/停止后，种子列表（进而「策略选种预览」）需要重新获取。
// 未启动时后端会返回「账号未运行」，此时预览显示提示文案；启动后自动刷新成真实结果。
watch(() => accounts.value.find((a: any) => String(a.id) === String(currentAccountId.value || ''))?.running, (running, previous) => {
  if (running === previous)
    return
  if (!currentAccountId.value)
    return
  loadSeedPreview()
})

onMounted(async () => {
  const accountIdBeforeFetch = String(currentAccountId.value || '')
  // 已有该账号的缓存设置时立即渲染，不必等系统配置和种子列表
  if (settingStore.hasSettingsFor(accountIdBeforeFetch))
    applyCachedAccountSettings()

  // 系统配置/抓包配置/设备协议仅超管可见，普通用户不请求，避免 403 报错弹窗。
  // 与账号数据并行加载，不再阻塞账号设置面板。
  const systemConfigTask = userStore.isSuperAdmin
    ? Promise.all([loadSystemConfig(), loadCaptureConfig()])
        .then(() => fetchDeviceProtocol())
        .catch(() => {})
    : Promise.resolve()

  await fetchAccounts()
  selectFirstAccountIfNeeded()
  // 账号没变时由这里加载；账号变了说明上面的 watcher 已接管，避免重复请求
  if (String(currentAccountId.value || '') === accountIdBeforeFetch)
    await loadCurrentAccountSettings()

  await scrollActiveTabIntoView()
  void systemConfigTask
})
</script>

<template>
  <div class="settings-page relative">
    <!-- 液态玻璃氛围光斑：给磨砂卡片提供可被模糊折射的色彩层次 -->
    <div aria-hidden="true" class="pointer-events-none absolute inset-0 overflow-hidden">
      <div class="bg-blob settings-blob settings-blob-1" />
      <div class="bg-blob settings-blob settings-blob-2" />
      <div class="bg-blob settings-blob settings-blob-3" />
    </div>

    <div class="relative mb-4">
      <h1 class="text-2xl text-gray-900 font-bold dark:text-gray-100">
        设置
      </h1>
    </div>

    <div class="liquid-glass liquid-glass-static relative z-10 rounded-2xl">
      <div class="border-b border-white/50 dark:border-white/10">
        <nav ref="settingsTabsNav" class="flex gap-1 overflow-x-auto p-2">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :data-settings-tab="tab.key"
            class="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all"
            :class="activeTab === tab.key
              ? 'text-white shadow-sm'
              : 'text-gray-600 hover:bg-white/50 dark:text-gray-400 dark:hover:bg-white/10'"
            :style="activeTab === tab.key ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="activeTab = tab.key"
          >
            <div :class="tab.icon" />
            {{ tab.label }}
          </button>
        </nav>
      </div>

      <div class="p-4">
        <!-- 账号管理 -->
        <AccountSettingsTab
          v-if="activeTab === 'account'"
          :accounts="accounts"
          :accounts-loading="accountsLoading"
          :current-account-id="currentAccountId"
          :user-is-admin="userIsAdmin"
          :stopped-accounts-count="stoppedAccountsCount"
          :is-add-account-disabled="isAddAccountDisabled"
          :add-account-disabled-reason="addAccountDisabledReason"
          :is-account-ops-disabled="isAccountOpsDisabled"
          :show-modal="showModal"
          :editing-account="editingAccount"
          :show-delete-confirm="showDeleteConfirm"
          :delete-loading="deleteLoading"
          :account-to-delete="accountToDelete"
          :show-clear-stopped-confirm="showClearStoppedConfirm"
          :clear-stopped-loading="clearStoppedLoading"
          :refresh-wx-codes-loading="refreshWxCodesLoading"
          :default-plan-setting-id="defaultPlanSettingId"
          :default-plan-applying-id="defaultPlanApplyingId"
          :startup-account="startupAccount"
          @add="openAddModal"
          @clear-stopped="openClearStoppedConfirm"
          @refresh-wx-codes="refreshWxCodesNow"
          @select="selectAccount"
          @toggle="toggleAccount"
          @settings="openAccountSettings"
          @set-default-plan="requestDefaultPlanConfirmation('set', $event)"
          @apply-default-plan="requestDefaultPlanConfirmation('apply', $event)"
          @edit="openEditModal"
          @delete="handleDelete"
          @saved="handleSaved"
          @close-startup="closeStartupModal"
          @close-modal="showModal = false"
          @close-delete-confirm="showDeleteConfirm = false"
          @confirm-delete="confirmDelete"
          @close-clear-stopped-confirm="showClearStoppedConfirm = false"
          @confirm-clear-stopped="confirmClearStopped"
        />

        <!-- 策略设置 -->
        <StrategySettingsPanel
          v-else-if="activeTab === 'strategy'"
          v-model:settings="localStrategySettings"
          :current-account-name="currentAccountName"
          :current-account-id="currentAccountId"
          :loading="accountSettingsLoading"
          :saving="accountSettingsSaving"
          :planting-strategy-options="plantingStrategyOptions"
          :bag-fallback-strategy-options="bagFallbackStrategyOptions"
          :strategy-preview-label="strategyPreviewLabel"
          :strategy-preview-loading="strategyPreviewLoading"
          @save="saveCurrentAccountSettings('strategy')"
        />

        <!-- 自动控制 -->
        <div v-else-if="activeTab === 'automation'" class="space-y-5">
          <AutomationControlPanel
            v-model:automation="localAutomationSettings"
            :current-account-name="currentAccountName"
            :current-account-id="currentAccountId"
            :loading="accountSettingsLoading"
            :saving="accountSettingsSaving"
            :fertilizer-land-type-options="fertilizerLandTypeOptions"
            :fertilizer-options="fertilizerOptions"
            @save="saveCurrentAccountSettings('automation')"
          />

          <!-- 定时刷新重登按账号保存，可见范围由账号归属决定，因此对所有用户开放 -->
          <AutoCodeRefreshCard
            v-model:config="localAutoCodeRefresh"
            :current-account-name="currentAccountName"
            :current-account-id="currentAccountId"
            :loading="accountSettingsLoading"
            :saving="autoCodeRefreshSaving"
            :refreshing="autoCodeRefreshing"
            @save="saveAutoCodeRefreshSettings"
            @refresh="runAutoCodeRefreshNow"
          />
        </div>

        <!-- 默认方案 -->
        <DefaultPlanTab
          v-else-if="activeTab === 'default-plan'"
          :current-account-id="currentAccountId"
          :current-account-name="currentAccountName"
          :planting-strategy-options="plantingStrategyOptions"
          :bag-fallback-strategy-options="bagFallbackStrategyOptions"
          :fertilizer-land-type-options="fertilizerLandTypeOptions"
          :fertilizer-options="fertilizerOptions"
        />

        <div v-else-if="activeTab === 'system'" class="space-y-5">
          <!-- 系统配置标题与保存按钮（吸顶），置于页签最顶部 -->
          <div v-if="userStore.isSuperAdmin" class="sticky top-0 z-10 flex items-center justify-between py-1">
            <div>
              <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
                系统配置
              </h3>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                统一管理用户账号、连接参数、设备协议、抓包服务和离线通知。
              </p>
            </div>
            <BaseButton size="sm" :loading="anySystemSaving" @click="saveSystemSettings">
              保存系统配置
            </BaseButton>
          </div>

          <!-- 用户管理（含修改密码）对所有用户开放 -->
          <ChangePasswordCard />

          <!-- 连接参数、设备协议、抓包服务均为超管专属，普通用户不渲染也不请求 -->
          <template v-if="userStore.isSuperAdmin">
            <AdminSystemPanel
              v-model:local-system-config="localSystemConfig"
              v-model:local-capture-config="localCaptureConfig"
              section="system"
              :show-heading="false"
              :show-save="false"
              :default-system-config="defaultSystemConfig"
              :platform-options="platformOptions"
              :os-options="osOptions"
              :system-config-saving="systemConfigSaving"
              :capture-config-saving="captureConfigSaving"
              :capture-config-testing="captureConfigTesting"
              @reset-system="handleResetSystemConfig"
              @test-capture="handleTestCaptureConfig"
            />

            <DeviceProtocolCard
              v-model:form="deviceProtocolForm"
              v-model:selected-preset="selectedDevicePreset"
              :loading="deviceProtocolLoading"
              :saving="deviceProtocolSaving"
              :preset-options="deviceProtocolPresetOptions"
              :show-save="false"
              @apply-preset="applyDevicePreset"
              @random-mac="fillRandomDeviceMac"
              @random-device-id="fillRandomDeviceId"
              @random-imei="fillRandomImei"
            />

            <AdminSystemPanel
              v-model:local-system-config="localSystemConfig"
              v-model:local-capture-config="localCaptureConfig"
              section="capture"
              :show-heading="false"
              :show-save="false"
              :default-system-config="defaultSystemConfig"
              :platform-options="platformOptions"
              :os-options="osOptions"
              :system-config-saving="systemConfigSaving"
              :capture-config-saving="captureConfigSaving"
              :capture-config-testing="captureConfigTesting"
              @test-capture="handleTestCaptureConfig"
            />
          </template>

          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
                通知设置
              </h3>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                配置账号离线后的通知渠道和消息内容。
              </p>
            </div>
            <BaseButton size="sm" :loading="offlineSaving" :disabled="offlineTesting" @click="handleSaveOffline">
              保存通知设置
            </BaseButton>
          </div>
          <OfflineReminderCard
            v-model:config="localOffline"
            :channel-options="channelOptions"
            :current-channel-doc-url="currentChannelDocUrl"
            :saving="offlineSaving"
            :testing="offlineTesting"
            :show-save="false"
            @open-docs="openChannelDocs"
            @test="handleTestOffline"
          />

          <!-- 界面性能：原独立页签并入系统配置（原 performance 页签已移除） -->
          <div>
            <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
              界面性能
            </h3>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              控制前端动效强度，用于在低端设备上换取更流畅的操作体验。开启后将关闭地块变异光效、天气粒子等装饰性动画，并去掉毛玻璃模糊。
            </p>
          </div>
          <PerformanceModeCard />
        </div>

        <div v-else-if="activeTab === 'cardkey'" class="space-y-4">
          <div>
            <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
              卡密设置
            </h3>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              生成注册 / 续期卡密，管理用户账号和有效期。
            </p>
          </div>
          <CardKeyPanel v-if="userStore.isSuperAdmin" />
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="defaultPlanConfirmationVisible"
      :title="defaultPlanConfirmationTitle"
      :message="defaultPlanConfirmationMessage"
      type="danger"
      confirm-text="确认执行"
      @confirm="confirmDefaultPlanOperation"
      @close="closeDefaultPlanConfirmation"
      @cancel="closeDefaultPlanConfirmation"
    />

    <ConfirmModal
      :show="modalVisible"
      :title="modalConfig.title"
      :message="modalConfig.message"
      :type="modalConfig.type"
      :is-alert="modalConfig.isAlert"
      confirm-text="知道了"
      @confirm="modalVisible = false"
      @close="modalVisible = false"
      @cancel="modalVisible = false"
    />
  </div>
</template>

<style scoped>
/* 液态玻璃氛围光斑：缓慢漂浮的大色块，被卡片的 backdrop-blur 折射出磨砂层次。
   带 bg-blob 类：perf-lite（界面性能模式）下会被全局规则直接隐藏。 */
.settings-blob {
  position: absolute;
  border-radius: 9999px;
  filter: blur(56px);
  opacity: 0.6;
  animation: settings-blob-float 32s ease-in-out infinite;
}

.settings-blob-1 {
  top: -150px;
  left: -90px;
  width: 560px;
  height: 560px;
  background: color-mix(in srgb, var(--theme-primary) 62%, transparent);
}

.settings-blob-2 {
  top: 26%;
  right: -130px;
  width: 500px;
  height: 500px;
  background: rgba(45, 212, 191, 0.44);
  animation-delay: -7s;
}

.settings-blob-3 {
  bottom: -170px;
  left: 18%;
  width: 580px;
  height: 580px;
  background: rgba(244, 114, 182, 0.38);
  animation-delay: -14s;
}

.dark .settings-blob {
  opacity: 0.42;
}

@keyframes settings-blob-float {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }

  50% {
    transform: translate3d(32px, -26px, 0) scale(1.06);
  }
}

@media (prefers-reduced-motion: reduce) {
  .settings-blob {
    animation: none;
  }
}
</style>
