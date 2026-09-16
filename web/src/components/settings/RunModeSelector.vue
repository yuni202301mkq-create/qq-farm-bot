<script setup lang="ts">
import { computed } from 'vue'

/**
 * 运行模式：一组「巡查节奏」预设。
 * 模式本身不单独入库，选中后直接写入农场/帮助巡查间隔；
 * 回显时用当前间隔值反查命中的预设，都不匹配则视为「自定义节奏」。
 */
interface RunModePreset {
  key: string
  label: string
  description: string
  farmMin: number
  farmMax: number
  helpMin: number
  helpMax: number
  stealMin: number
  stealMax: number
}

const RUN_MODE_PRESETS: RunModePreset[] = [
  {
    key: 'conservative',
    label: '保守模式',
    description: '保守模式：低频巡查，随机种植，适合长期稳定运行',
    farmMin: 40,
    farmMax: 70,
    helpMin: 180,
    helpMax: 300,
    stealMin: 180,
    stealMax: 300,
  },
  {
    key: 'balanced',
    label: '均衡模式',
    description: '均衡模式：兼顾经验与收益，操作频率适合日常方案',
    farmMin: 25,
    farmMax: 35,
    helpMin: 60,
    helpMax: 100,
    stealMin: 60,
    stealMax: 100,
  },
  {
    key: 'profit',
    label: '高收益模式',
    description: '高收益模式：优先净利润并提高巡查频率，适合短时间快速获取收益',
    farmMin: 15,
    farmMax: 20,
    helpMin: 20,
    helpMax: 30,
    stealMin: 20,
    stealMax: 30,
  },
  {
    key: 'aggressive',
    label: '暴力模式',
    description: '暴力模式：极速收益最高频率操作，容易触发账号异常将被额外标记，谨慎使用',
    farmMin: 3,
    farmMax: 3,
    helpMin: 3,
    helpMax: 3,
    stealMin: 3,
    stealMax: 3,
  },
]

const props = defineProps<{
  disabled?: boolean
}>()

const intervals = defineModel<{ farmMin?: number, farmMax?: number, helpMin?: number, helpMax?: number, stealMin?: number, stealMax?: number }>('intervals', { required: true })

function toInt(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

const activeModeKey = computed<string | null>(() => {
  const current = intervals.value || {}
  const match = RUN_MODE_PRESETS.find(preset =>
    toInt(current.farmMin) === preset.farmMin
    && toInt(current.farmMax) === preset.farmMax
    && toInt(current.helpMin) === preset.helpMin
    && toInt(current.helpMax) === preset.helpMax
    && toInt(current.stealMin) === preset.stealMin
    && toInt(current.stealMax) === preset.stealMax,
  )
  return match?.key ?? null
})

const activeModeDescription = computed(() => {
  const preset = RUN_MODE_PRESETS.find(item => item.key === activeModeKey.value)
  return preset?.description ?? '自定义节奏：当前巡查间隔为手动设置，可直接点击上方模式一键套用推荐值。'
})

function applyMode(preset: RunModePreset) {
  intervals.value = {
    ...intervals.value,
    farmMin: preset.farmMin,
    farmMax: preset.farmMax,
    helpMin: preset.helpMin,
    helpMax: preset.helpMax,
    stealMin: preset.stealMin,
    stealMax: preset.stealMax,
  }
}
</script>

<template>
  <div class="space-y-2">
    <h4 class="text-sm text-gray-900 font-semibold dark:text-gray-100">
      运行模式
    </h4>
    <div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <button
        v-for="preset in RUN_MODE_PRESETS"
        :key="preset.key"
        type="button"
        class="min-h-11 border rounded-lg px-3 py-2 text-sm font-medium transition"
        :class="activeModeKey === preset.key
          ? 'border-[var(--theme-primary)] bg-[var(--theme-primary)] text-white shadow-sm'
          : 'border-gray-200 bg-white/80 text-gray-600 hover:border-[var(--theme-primary)] hover:text-[var(--theme-primary)] dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:border-white/20 dark:hover:bg-white/10 dark:hover:text-gray-200'"
        :aria-pressed="activeModeKey === preset.key"
        :disabled="disabled"
        @click="applyMode(preset)"
      >
        {{ preset.label }}
      </button>
    </div>
    <p class="text-xs text-gray-500 dark:text-gray-400">
      {{ activeModeDescription }}
    </p>
  </div>
</template>
