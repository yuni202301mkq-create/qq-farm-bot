<script setup lang="ts">
import { computed } from 'vue'
import BagSeedPriorityPanel from '@/components/settings/BagSeedPriorityPanel.vue'
import RunModeSelector from '@/components/settings/RunModeSelector.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

interface SelectOption<T = string | number> {
  label: string
  value: T
  disabled?: boolean
}

interface StrategySettings {
  plantingStrategy: string
  prioritize2x2Crops: boolean
  prioritizeGrowthTasks: boolean
  plantRandomOrder: boolean
  plantDelaySec: number
  stealDelaySec: number
  bagSeedPriority: number[]
  bagSeedKnownIds: number[]
  bagSeedExcludedIds: number[]
  bagSeedFallbackStrategy: string
  intervals: {
    farmMin: number
    farmMax: number
    helpMin: number
    helpMax: number
    stealMin: number
    stealMax: number
  }
  friendQuietHours: {
    enabled: boolean
    start: string
    end: string
  }
}

const props = withDefaults(defineProps<{
  currentAccountName: string | null
  currentAccountId: string | number | null | undefined
  loading: boolean
  saving: boolean
  plantingStrategyOptions: SelectOption[]
  bagFallbackStrategyOptions: SelectOption[]
  strategyPreviewLabel: string | null
  strategyPreviewLoading?: boolean
  title?: string
  saveLabel?: string
  showActions?: boolean
  /** 为 false 时不强制要求已选账号（默认方案编辑等场景） */
  requireAccount?: boolean
}>(), {
  title: '策略设置',
  saveLabel: '保存策略设置',
  showActions: true,
  strategyPreviewLoading: false,
  requireAccount: true,
})

const emit = defineEmits<{
  save: []
}>()

const settings = defineModel<StrategySettings>('settings', { required: true })

const hasFallbackStrategy = computed(() => ['bag_priority', 'task_priority'].includes(settings.value.plantingStrategy))

// 默认方案没有真实账号上下文，选种预览直接展示所选策略名。
const previewLabel = computed(() => {
  if (props.strategyPreviewLabel)
    return props.strategyPreviewLabel
  if (!props.currentAccountId)
    return props.plantingStrategyOptions.find(option => option.value === settings.value.plantingStrategy)?.label || '暂无匹配种子'
  return '暂无匹配种子'
})

function selectPlantingStrategy(value: string | number | undefined) {
  if (value === undefined)
    return
  const strategy = String(value)
  settings.value.plantingStrategy = strategy
  settings.value.prioritizeGrowthTasks = strategy === 'task_priority'
}

function selectBagFallbackStrategy(value: string | number) {
  settings.value.bagSeedFallbackStrategy = String(value)
}

function isBagFallbackStrategySelected(value: string | number) {
  return settings.value.bagSeedFallbackStrategy === value
}

function intervalModel(key: keyof StrategySettings['intervals']) {
  return computed({
    get: () => settings.value.intervals[key],
    set: (value: number | string) => {
      const parsed = Number.parseInt(String(value), 10)
      settings.value = {
        ...settings.value,
        intervals: {
          ...settings.value.intervals,
          [key]: Number.isFinite(parsed) ? parsed : 1,
        },
      }
    },
  })
}

const farmMin = intervalModel('farmMin')
const farmMax = intervalModel('farmMax')
const helpMin = intervalModel('helpMin')
const helpMax = intervalModel('helpMax')
const stealMin = intervalModel('stealMin')
const stealMax = intervalModel('stealMax')

// 种植/偷菜操作延迟（秒）：与巡查间隔同一套数字输入与校验口径，0 表示仅保留基础随机间隔。
function delayModel(key: 'plantDelaySec' | 'stealDelaySec') {
  return computed({
    get: () => settings.value[key],
    set: (value: number | string) => {
      const parsed = Number.parseInt(String(value), 10)
      settings.value = {
        ...settings.value,
        [key]: Number.isFinite(parsed) ? Math.max(0, Math.min(120, parsed)) : 0,
      }
    },
  })
}

const plantDelaySec = delayModel('plantDelaySec')
const stealDelaySec = delayModel('stealDelaySec')

// 偷菜巡查间隔的动态灰字说明：间隔值变化时实时更新提示内容。
const stealIntervalHint = computed(() => {
  const min = Number(settings.value.intervals.stealMin) || 0
  const max = Number(settings.value.intervals.stealMax) || 0
  if (min > 0 && max > 0 && max < 60)
    return `偷菜巡查间隔为 ${min}~${max} 秒，频率较高，请注意风控风险`
  return `偷菜巡查按 ${min}~${max} 秒的随机间隔执行`
})

// 「背包种子优先顺序」面板在排序/移出/放回时回传最新值，
// 这里同步进 model，让外层保存按钮一并落库。
function handleBagSeedPriorityChange(payload: { priority: number[], excludedIds: number[] }) {
  settings.value.bagSeedPriority = [...payload.priority]
  settings.value.bagSeedExcludedIds = [...payload.excludedIds]
}
</script>

<template>
  <div class="space-y-4">
    <!-- 标题行：左侧标题 + 右侧保存按钮 -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="flex min-w-0 items-center gap-2 text-lg text-gray-900 font-bold dark:text-gray-100">
        <span class="i-carbon-settings-adjust shrink-0 text-lg" />
        <span class="truncate">{{ title }}</span>
        <span v-if="currentAccountName" class="text-sm text-gray-500 font-normal dark:text-gray-400">
          ({{ currentAccountName }})
        </span>
      </h3>
      <BaseButton
        v-if="showActions"
        variant="primary"
        size="sm"
        :loading="saving"
        @click="emit('save')"
      >
        {{ saveLabel }}
      </BaseButton>
    </div>

    <div v-if="loading" class="py-4 text-center text-gray-500">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl" />
      <p>加载中...</p>
    </div>

    <div v-else-if="requireAccount && !currentAccountId" class="py-8 text-center text-gray-500">
      <div class="i-carbon-settings-adjust mx-auto mb-2 text-3xl text-gray-400" />
      <p>请先选择账号</p>
    </div>

    <div v-else class="space-y-4">
      <!-- 运行模式 -->
      <RunModeSelector v-model:intervals="settings.intervals" :disabled="saving" />

      <!-- 种植策略 -->
      <section class="liquid-glass space-y-3 rounded-2xl p-4">
        <h4 class="text-sm text-gray-900 font-semibold dark:text-gray-100">
          种植策略
        </h4>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <BaseSelect
            v-model="settings.plantingStrategy"
            label="种植策略"
            :options="plantingStrategyOptions"
            @update:model-value="selectPlantingStrategy"
          />
          <div class="flex flex-col gap-1.5">
            <label class="text-sm text-gray-700 font-medium dark:text-gray-300">
              {{ hasFallbackStrategy ? '第二优先策略预览' : '策略选种预览' }}
            </label>
            <div
              class="liquid-glass-sub w-full flex items-center justify-between border border-gray-200 rounded-lg border-dashed bg-gray-50 px-3 py-2 text-gray-500 dark:border-gray-600 dark:bg-gray-800/50 dark:text-gray-400"
              title="根据当前策略自动匹配，仅供预览"
            >
              <span v-if="strategyPreviewLoading" class="flex min-w-0 items-center gap-2">
                <span class="i-svg-spinners-ring-resize shrink-0 text-sm" />
                <span class="truncate">加载中...</span>
              </span>
              <span v-else class="truncate">{{ previewLabel }}</span>
              <span class="i-carbon-information shrink-0 text-base text-gray-400" />
            </div>
          </div>
        </div>

        <!-- 第二优先策略 -->
        <div v-if="hasFallbackStrategy" class="flex flex-col gap-2">
          <span class="text-sm text-gray-700 font-medium dark:text-gray-300">第二优先策略</span>
          <div class="grid grid-cols-1 gap-2 lg:grid-cols-3 sm:grid-cols-2">
            <button
              v-for="option in bagFallbackStrategyOptions"
              :key="option.value"
              type="button"
              class="min-h-11 flex items-center justify-between gap-3 border rounded-lg px-3 py-2 text-left text-sm transition"
              :class="isBagFallbackStrategySelected(option.value)
                ? 'border-[var(--theme-primary)] bg-[color-mix(in_srgb,var(--theme-primary)_10%,transparent)] text-gray-900 shadow-sm dark:text-gray-100'
                : 'border-gray-200 bg-white/80 text-gray-600 hover:border-[var(--theme-primary)] hover:text-[var(--theme-primary)] dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:border-white/20 dark:hover:bg-white/10 dark:hover:text-gray-200'"
              :aria-pressed="isBagFallbackStrategySelected(option.value)"
              @click="selectBagFallbackStrategy(option.value)"
            >
              <span class="min-w-0 break-words font-medium leading-5">{{ option.label }}</span>
              <span
                class="grid h-5 w-5 shrink-0 place-items-center border rounded-full text-xs transition"
                :class="isBagFallbackStrategySelected(option.value)
                  ? 'border-[var(--theme-primary)] bg-[var(--theme-primary)] text-white'
                  : 'border-gray-300 text-transparent dark:border-gray-600'"
              >
                <span class="i-carbon-checkmark text-sm" />
              </span>
            </button>
          </div>
        </div>

        <!-- 背包种子优先顺序 -->
        <BagSeedPriorityPanel
          v-if="settings.plantingStrategy === 'bag_priority'"
          :current-account-id="currentAccountId"
          :priority="settings.bagSeedPriority"
          :excluded-ids="settings.bagSeedExcludedIds"
          :saving="saving"
          @change="handleBagSeedPriorityChange"
        />
      </section>

      <!-- 行为与节奏：两张并排白底卡 -->
      <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <!-- 优先种植 2×2 作物 -->
        <div class="liquid-glass rounded-2xl p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span class="text-sm text-gray-900 font-semibold dark:text-gray-100">优先种植 2×2 作物</span>
            <BaseSwitch v-model="settings.prioritize2x2Crops" />
          </div>
          <p class="liquid-glass-sub mt-2.5 border border-emerald-200/60 rounded-lg bg-emerald-50/70 px-3 py-2 text-xs leading-5 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-900/15 dark:text-emerald-300">
            开启后会根据背包中的四格种子预留完整 2×2 区域；预留区收获后暂不补种普通作物，四块全部空闲时自动种植。四格种子不会从商城购买。
          </p>
        </div>

        <!-- 种植顺序随机 + 操作延迟 -->
        <div class="liquid-glass rounded-2xl p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span class="text-sm text-gray-900 font-semibold dark:text-gray-100">种植顺序随机</span>
            <BaseSwitch v-model="settings.plantRandomOrder" />
          </div>
          <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label class="flex flex-col gap-1.5">
              <span class="text-sm text-gray-700 font-medium dark:text-gray-300">种植延迟 (秒)</span>
              <input
                v-model.number="plantDelaySec"
                type="number"
                min="0"
                max="120"
                class="h-9 w-full border border-gray-200 rounded bg-white px-3 text-sm text-gray-900 outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              >
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-sm text-gray-700 font-medium dark:text-gray-300">偷菜延迟 (秒)</span>
              <input
                v-model.number="stealDelaySec"
                type="number"
                min="0"
                max="120"
                class="h-9 w-full border border-gray-200 rounded bg-white px-3 text-sm text-gray-900 outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              >
            </label>
          </div>
          <p class="mt-2.5 text-xs leading-5 text-gray-500 dark:text-gray-400">
            每次种植请求之间、偷完一位好友的作物之后至少等待该秒数（附带随机抖动）；填 0 表示仅保留基础随机间隔。
          </p>
        </div>
      </div>

      <!-- 巡查间隔 -->
      <section class="liquid-glass space-y-3 rounded-2xl p-4">
        <h4 class="text-sm text-gray-900 font-semibold dark:text-gray-100">
          巡查间隔
        </h4>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label class="flex flex-col gap-1.5">
            <span class="text-sm text-gray-700 font-medium dark:text-gray-300">农场巡查最小 (秒)</span>
            <input
              v-model.number="farmMin"
              type="number"
              min="1"
              class="h-9 w-full border border-gray-200 rounded bg-white px-3 text-sm text-gray-900 outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-sm text-gray-700 font-medium dark:text-gray-300">农场巡查最大 (秒)</span>
            <input
              v-model.number="farmMax"
              type="number"
              min="1"
              class="h-9 w-full border border-gray-200 rounded bg-white px-3 text-sm text-gray-900 outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-sm text-gray-700 font-medium dark:text-gray-300">帮助巡查最小 (秒)</span>
            <input
              v-model.number="helpMin"
              type="number"
              min="1"
              class="h-9 w-full border border-gray-200 rounded bg-white px-3 text-sm text-gray-900 outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-sm text-gray-700 font-medium dark:text-gray-300">帮助巡查最大 (秒)</span>
            <input
              v-model.number="helpMax"
              type="number"
              min="1"
              class="h-9 w-full border border-gray-200 rounded bg-white px-3 text-sm text-gray-900 outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-sm text-gray-700 font-medium dark:text-gray-300">偷菜巡查最小 (秒)</span>
            <input
              v-model.number="stealMin"
              type="number"
              min="1"
              class="h-9 w-full border border-gray-200 rounded bg-white px-3 text-sm text-gray-900 outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-sm text-gray-700 font-medium dark:text-gray-300">偷菜巡查最大 (秒)</span>
            <input
              v-model.number="stealMax"
              type="number"
              min="1"
              class="h-9 w-full border border-gray-200 rounded bg-white px-3 text-sm text-gray-900 outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
          </label>
        </div>
        <p class="text-xs text-gray-400 dark:text-gray-500">
          {{ stealIntervalHint }}
        </p>
      </section>

      <!-- 静默时段 -->
      <section class="liquid-glass space-y-3 rounded-2xl p-4">
        <h4 class="text-sm text-gray-900 font-semibold dark:text-gray-100">
          静默时段
        </h4>

        <div class="flex flex-wrap items-center gap-4">
          <BaseSwitch v-model="settings.friendQuietHours.enabled" label="启用静默时段" />
          <div class="flex items-center gap-2">
            <input
              v-model="settings.friendQuietHours.start"
              type="time"
              class="h-9 w-24 border border-gray-200 rounded bg-white px-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              :disabled="!settings.friendQuietHours.enabled"
            >
            <span class="text-xs text-gray-500">-</span>
            <input
              v-model="settings.friendQuietHours.end"
              type="time"
              class="h-9 w-24 border border-gray-200 rounded bg-white px-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              :disabled="!settings.friendQuietHours.enabled"
            >
          </div>
          <p v-if="!settings.friendQuietHours.enabled" class="text-xs text-gray-400">
            开启后可设置起止时间
          </p>
        </div>
      </section>
    </div>
  </div>
</template>
