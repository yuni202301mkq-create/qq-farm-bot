<script setup lang="ts">
import { ref } from 'vue'
import BagPanel from '@/components/BagPanel.vue'
import FarmPanel from '@/components/FarmPanel.vue'
import TaskPanel from '@/components/TaskPanel.vue'

const currentTab = ref<'farm' | 'bag' | 'task'>('farm')

const tabs = [
  { key: 'farm' as const, label: '我的农场', icon: 'i-carbon-sprout' },
  { key: 'bag' as const, label: '我的背包', icon: 'i-carbon-box' },
  { key: 'task' as const, label: '我的任务', icon: 'i-carbon-task' },
]
</script>

<template>
  <div class="h-full flex flex-col p-4">
    <div class="mb-4 flex gap-2">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="flex-1 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
        :class="currentTab === tab.key
          ? 'text-white shadow-md'
          : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
        :style="currentTab === tab.key ? { backgroundColor: 'var(--theme-primary)' } : {}"
        @click="currentTab = tab.key"
      >
        <div class="flex items-center justify-center gap-2">
          <div :class="`${tab.icon} text-lg`" />
          <span>{{ tab.label }}</span>
        </div>
      </button>
    </div>

    <div class="flex-1 overflow-hidden overflow-y-auto">
      <Transition
        mode="out-in"
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="transform opacity-0 scale-95"
        enter-to-class="transform opacity-100 scale-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="transform opacity-100 scale-100"
        leave-to-class="transform opacity-0 scale-95"
      >
        <component :is="currentTab === 'farm' ? FarmPanel : (currentTab === 'bag' ? BagPanel : TaskPanel)" />
      </Transition>
    </div>
  </div>
</template>
