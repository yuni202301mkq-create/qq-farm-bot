<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import AutomationControlPanel from '@/components/settings/AutomationControlPanel.vue'
import StrategySettingsPanel from '@/components/settings/StrategySettingsPanel.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import api from '@/api'

interface SelectOption {
  label: string
  value: string | number
  disabled?: boolean
}

const props = defineProps<{
  currentAccountId: string | number | null | undefined
  currentAccountName: string | null
  plantingStrategyOptions: SelectOption[]
  bagFallbackStrategyOptions: SelectOption[]
  fertilizerLandTypeOptions: { label: string, value: string }[]
  fertilizerOptions: { label: string, value: string | number }[]
}>()

type PlanSubTab = 'strategy' | 'automation'

const PLAN_STRATEGY_FIELDS = [
  'plantingStrategy',
  'prioritize2x2Crops',
  'prioritizeGrowthTasks',
  'plantRandomOrder',
  'plantDelaySec',
  'stealDelaySec',
  'bagSeedPriority',
  'bagSeedKnownIds',
  'bagSeedExcludedIds',
  'bagSeedFallbackStrategy',
  'intervals',
  'friendQuietHours',
] as const

const PLAN_AUTOMATION_NUMBER_FIELDS = [
  'autoAcceptFriendMinLevel',
  'fertilizerBuyOrganicCount',
  'fertilizerBuyOrganicThresholdHours',
  'fertilizerBuyNormalCount',
  'fertilizerBuyNormalThresholdHours',
  'fertilizerBuyCheckIntervalMinutes',
  'goldenBugKeepCount',
  'goldenBugRoundLimit',
] as const

const loading = ref(true)
const saving = ref(false)
const importing = ref(false)
const resetting = ref(false)
const subTab = ref<PlanSubTab>('strategy')

const planExists = ref(false)
const planEnabled = ref(true)
const planUpdatedAt = ref(0)
// 服务端返回的完整 plan config，保存时合并表单字段，
// 避免 autoCodeRefresh 等未在本页编辑的字段被重置。
const basePlanConfig = ref<Record<string, any>>({})

const planStrategy = ref<any>(createDefaultStrategyForm())
const planAutomation = ref<any>(createDefaultAutomationForm())

function createDefaultStrategyForm() {
  return {
    plantingStrategy: 'max_exp',
    prioritize2x2Crops: false,
    prioritizeGrowthTasks: false,
    plantRandomOrder: false,
    plantDelaySec: 2,
    stealDelaySec: 1,
    bagSeedPriority: [] as number[],
    bagSeedKnownIds: [] as number[],
    bagSeedExcludedIds: [] as number[],
    bagSeedFallbackStrategy: 'level',
    intervals: { farmMin: 2, farmMax: 5, helpMin: 30, helpMax: 35, stealMin: 180, stealMax: 300 },
    friendQuietHours: { enabled: false, start: '01:00', end: '07:30' },
  }
}

function createDefaultAutomationForm() {
  return {
    automation: {},
    autoAcceptFriendMinLevel: 0,
    fertilizerBuyOrganicCount: 1,
    fertilizerBuyOrganicThresholdHours: 10,
    fertilizerBuyNormalCount: 1,
    fertilizerBuyNormalThresholdHours: 10,
    fertilizerBuyCheckIntervalMinutes: 60,
    goldenBugKeepCount: 0,
    goldenBugRoundLimit: 24,
  }
}

function fillFormsFromConfig(config: Record<string, any> | null | undefined) {
  const cfg = config && typeof config === 'object' ? config : {}
  basePlanConfig.value = { ...cfg }
  const strategy: any = createDefaultStrategyForm()
  for (const field of PLAN_STRATEGY_FIELDS) {
    if (cfg[field] !== undefined && cfg[field] !== null)
      strategy[field] = JSON.parse(JSON.stringify(cfg[field]))
  }
  if (!strategy.intervals || typeof strategy.intervals !== 'object')
    strategy.intervals = createDefaultStrategyForm().intervals
  if (!strategy.friendQuietHours || typeof strategy.friendQuietHours !== 'object')
    strategy.friendQuietHours = createDefaultStrategyForm().friendQuietHours
  planStrategy.value = strategy

  const automationForm: any = createDefaultAutomationForm()
  if (cfg.automation && typeof cfg.automation === 'object')
    automationForm.automation = { ...cfg.automation }
  for (const field of PLAN_AUTOMATION_NUMBER_FIELDS) {
    if (cfg[field] !== undefined && cfg[field] !== null)
      automationForm[field] = Number(cfg[field])
  }
  planAutomation.value = automationForm
}

function buildPlanConfigPayload() {
  return {
    ...basePlanConfig.value,
    ...planStrategy.value,
    ...planAutomation.value,
  }
}

const strategyPreviewLabel = computed(() => {
  const match = props.plantingStrategyOptions.find(option => option.value === planStrategy.value.plantingStrategy)
  return match?.label || null
})

const updatedAtLabel = computed(() => {
  if (!planUpdatedAt.value)
    return ''
  const date = new Date(planUpdatedAt.value)
  if (Number.isNaN(date.getTime()))
    return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
})

const planStatusText = computed(() => {
  if (!planExists.value)
    return '尚未保存默认方案，新账号将使用系统默认配置'
  return `已保存默认方案${updatedAtLabel.value ? ` · 更新于 ${updatedAtLabel.value}` : ''}`
})

const alertModal = ref<{ title: string, message: string, type: 'primary' | 'danger' } | null>(null)
const confirmModal = ref<{ action: 'import' | 'reset', title: string, message: string } | null>(null)

function showAlert(message: string, type: 'primary' | 'danger' = 'primary') {
  alertModal.value = {
    title: type === 'danger' ? '错误' : '提示',
    message,
    type,
  }
}

async function loadPlan() {
  loading.value = true
  try {
    const { data } = await api.get('/api/settings/default-plan')
    if (!data?.ok)
      throw new Error(data?.error || '默认方案加载失败')
    planExists.value = data.data?.exists === true
    planEnabled.value = data.data?.enabled !== false
    planUpdatedAt.value = Number(data.data?.updatedAt) || 0
    fillFormsFromConfig(data.data?.config)
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '默认方案加载失败', 'danger')
  }
  finally {
    loading.value = false
  }
}

async function savePlan(notify = true) {
  saving.value = true
  try {
    const { data } = await api.put('/api/settings/default-plan', {
      config: buildPlanConfigPayload(),
      enabled: planEnabled.value,
    })
    if (!data?.ok)
      throw new Error(data?.error || '默认方案保存失败')
    planExists.value = true
    planEnabled.value = data.data?.enabled !== false
    planUpdatedAt.value = Number(data.data?.updatedAt) || Date.now()
    fillFormsFromConfig(data.data?.config)
    if (notify)
      showAlert('默认方案已保存')
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '默认方案保存失败', 'danger')
  }
  finally {
    saving.value = false
  }
}

async function handleToggleEnabled(enabled: boolean) {
  planEnabled.value = enabled
  await savePlan(true)
}

function requestImport() {
  if (!props.currentAccountId) {
    showAlert('请先在账号管理中选择一个账号，再从当前账号导入配置', 'danger')
    return
  }
  confirmModal.value = {
    action: 'import',
    title: '从当前账号导入',
    message: `确定将「${props.currentAccountName || props.currentAccountId}」的当前配置导入为默认方案吗？这会覆盖已保存的默认方案。`,
  }
}

function requestReset() {
  confirmModal.value = {
    action: 'reset',
    title: '恢复系统默认',
    message: '确定将默认方案恢复为系统默认配置吗？这会覆盖已保存的默认方案。',
  }
}

async function importFromCurrentAccount() {
  if (!props.currentAccountId || importing.value)
    return
  importing.value = true
  try {
    const { data } = await api.post('/api/settings/default-plan/import', {}, {
      headers: { 'x-account-id': String(props.currentAccountId) },
    })
    if (!data?.ok)
      throw new Error(data?.error || '导入失败')
    planExists.value = true
    planEnabled.value = data.data?.enabled !== false
    planUpdatedAt.value = Number(data.data?.updatedAt) || Date.now()
    fillFormsFromConfig(data.data?.config)
    showAlert('已从当前账号导入默认方案')
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '导入默认方案失败', 'danger')
  }
  finally {
    importing.value = false
  }
}

async function resetToSystemDefault() {
  if (resetting.value)
    return
  resetting.value = true
  try {
    const { data } = await api.post('/api/settings/default-plan/reset')
    if (!data?.ok)
      throw new Error(data?.error || '恢复失败')
    planExists.value = true
    planEnabled.value = data.data?.enabled !== false
    planUpdatedAt.value = Number(data.data?.updatedAt) || Date.now()
    fillFormsFromConfig(data.data?.config)
    showAlert('已恢复系统默认方案')
  }
  catch (error: any) {
    showAlert(error.response?.data?.error || error.message || '恢复系统默认失败', 'danger')
  }
  finally {
    resetting.value = false
  }
}

function confirmPendingAction() {
  const pending = confirmModal.value
  confirmModal.value = null
  if (!pending)
    return
  if (pending.action === 'import')
    void importFromCurrentAccount()
  else
    void resetToSystemDefault()
}

onMounted(() => {
  void loadPlan()
})
</script>

<template>
  <div class="space-y-4">
    <!-- 顶部：默认方案 + 新账号自动应用 + 导入/恢复 -->
    <div class="liquid-glass flex flex-wrap items-start justify-between gap-3 rounded-2xl p-4">
      <div class="min-w-0 space-y-2">
        <div class="flex flex-wrap items-center gap-3">
          <h3 class="flex items-center gap-2 text-lg text-gray-900 font-bold dark:text-gray-100">
            <div class="i-carbon-renew text-lg" />
            默认方案
          </h3>
          <BaseSwitch
            :model-value="planEnabled"
            label="新账号自动应用"
            :disabled="saving || loading"
            @update:model-value="handleToggleEnabled(!!$event)"
          />
        </div>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          {{ loading ? '默认方案加载中...' : planStatusText }}
        </p>
      </div>
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <BaseButton
          variant="secondary"
          size="sm"
          :loading="importing"
          :disabled="loading || saving"
          @click="requestImport"
        >
          <span class="i-carbon-import-export mr-1" />
          从当前账号导入
        </BaseButton>
        <BaseButton
          variant="secondary"
          size="sm"
          :loading="resetting"
          :disabled="loading || saving"
          @click="requestReset"
        >
          <span class="i-carbon-rotate-clockwise mr-1" />
          恢复系统默认
        </BaseButton>
      </div>
    </div>

    <!-- 子页签：策略设置 / 自动控制 -->
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="flex items-center gap-1.5 border rounded-lg px-3.5 py-2 text-sm font-medium transition"
        :class="subTab === 'strategy'
          ? 'border-transparent bg-[var(--theme-primary)] text-white shadow-sm'
          : 'border-gray-200 bg-white/80 text-gray-600 hover:border-[var(--theme-primary)] hover:text-[var(--theme-primary)] dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:border-white/20 dark:hover:bg-white/10 dark:hover:text-gray-200'"
        @click="subTab = 'strategy'"
      >
        <span class="i-carbon-settings-adjust text-base" />
        策略设置
      </button>
      <button
        type="button"
        class="flex items-center gap-1.5 border rounded-lg px-3.5 py-2 text-sm font-medium transition"
        :class="subTab === 'automation'
          ? 'border-transparent bg-[var(--theme-primary)] text-white shadow-sm'
          : 'border-gray-200 bg-white/80 text-gray-600 hover:border-[var(--theme-primary)] hover:text-[var(--theme-primary)] dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:border-white/20 dark:hover:bg-white/10 dark:hover:text-gray-200'"
        @click="subTab = 'automation'"
      >
        <span class="i-carbon-settings text-base" />
        自动控制
      </button>
    </div>

    <div v-if="loading" class="py-10 text-center text-gray-500">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl" />
      <p>默认方案加载中...</p>
    </div>

    <template v-else>
      <!-- 策略设置 -->
      <StrategySettingsPanel
        v-show="subTab === 'strategy'"
        v-model:settings="planStrategy"
        :current-account-name="null"
        :current-account-id="null"
        :loading="false"
        :saving="saving"
        :planting-strategy-options="plantingStrategyOptions"
        :bag-fallback-strategy-options="bagFallbackStrategyOptions"
        :strategy-preview-label="strategyPreviewLabel"
        :strategy-preview-loading="false"
        title="默认策略"
        save-label="保存默认方案"
        :require-account="false"
        @save="savePlan()"
      />

      <!-- 自动控制 -->
      <AutomationControlPanel
        v-show="subTab === 'automation'"
        v-model:automation="planAutomation"
        :current-account-name="null"
        :current-account-id="null"
        :loading="false"
        :saving="saving"
        :fertilizer-land-type-options="fertilizerLandTypeOptions"
        :fertilizer-options="fertilizerOptions"
        title="默认策略"
        save-label="保存默认方案"
        :require-account="false"
        @save="savePlan()"
      />
    </template>

    <ConfirmModal
      :show="!!confirmModal"
      :title="confirmModal?.title || ''"
      :message="confirmModal?.message || ''"
      type="danger"
      confirm-text="确认执行"
      @confirm="confirmPendingAction"
      @close="confirmModal = null"
      @cancel="confirmModal = null"
    />

    <ConfirmModal
      :show="!!alertModal"
      :title="alertModal?.title || ''"
      :message="alertModal?.message || ''"
      :type="alertModal?.type || 'primary'"
      :is-alert="true"
      confirm-text="知道了"
      @confirm="alertModal = null"
      @close="alertModal = null"
      @cancel="alertModal = null"
    />
  </div>
</template>
