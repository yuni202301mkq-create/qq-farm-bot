<script setup lang="ts">
import { computed } from 'vue'
import { usePerformanceMode } from '@/composables/usePerformanceMode'

const { preference, liteEffects, autoNeedsLite, setPreference } = usePerformanceMode()

const options: { value: 'auto' | 'on' | 'off', label: string, hint: string }[] = [
  { value: 'auto', label: '自动', hint: '手机/平板自动开启，电脑保持完整动效' },
  { value: 'on', label: '始终开启', hint: '任何设备都精简动效' },
  { value: 'off', label: '始终关闭', hint: '任何设备都保留完整动效' },
]

const currentHint = computed(() =>
  options.find(item => item.value === preference.value)?.hint || '',
)
</script>

<template>
  <div class="border border-gray-200 rounded-xl p-4 dark:border-gray-700">
    <div class="mb-4">
      <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
        流畅模式
      </h3>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
        关闭地块变异光效、天气粒子等装饰性动画，并去掉毛玻璃模糊，静态配色与滤镜保持不变。
        手机上农场页掉帧、滑动发涩时建议开启。
      </p>
    </div>

    <div class="flex flex-wrap gap-2">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        class="border rounded-lg px-3 py-1.5 text-sm transition"
        :class="preference === option.value
          ? 'border-pink-500 bg-pink-500 text-white'
          : 'border-gray-300 text-gray-600 hover:border-pink-400 hover:text-pink-600 dark:border-gray-600 dark:text-gray-300 dark:hover:border-pink-400 dark:hover:text-pink-300'"
        @click="setPreference(option.value)"
      >
        {{ option.label }}
      </button>
    </div>

    <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">
      {{ currentHint }}
    </p>

    <div class="mt-3 flex flex-wrap items-center gap-2 border border-gray-200 rounded-lg bg-gray-50/70 px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-900/20">
      <span class="text-gray-500 dark:text-gray-400">当前状态</span>
      <span
        class="rounded-full px-2 py-0.5 font-semibold"
        :class="liteEffects
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
          : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'"
      >
        {{ liteEffects ? '流畅模式已开启' : '完整动效' }}
      </span>
      <span v-if="preference === 'auto'" class="text-gray-400 dark:text-gray-500">
        （设备自动判定：{{ autoNeedsLite ? '建议开启' : '无需开启' }}）
      </span>
    </div>

    <p class="mt-3 text-xs text-gray-400 dark:text-gray-500">
      设置保存在本机浏览器，立即生效，无需刷新页面。
    </p>
  </div>
</template>
