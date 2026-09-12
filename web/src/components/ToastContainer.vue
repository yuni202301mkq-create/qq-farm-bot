<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()
const { toasts } = storeToRefs(toastStore)

function getIcon(type: string) {
  switch (type) {
    case 'success': return 'i-carbon-checkmark-filled text-green-500'
    case 'error': return 'i-carbon-error-filled text-red-500'
    case 'warning': return 'i-carbon-warning-filled text-yellow-500'
    case 'info': return 'i-carbon-information-filled text-blue-500'
    default: return 'i-carbon-information-filled text-blue-500'
  }
}

function getBgColor(_type: string) {
  // Tailwind colors with some transparency?
  // Actually, standard white/dark background with colored border/icon is usually cleaner.
  return 'bg-white dark:bg-gray-800 border-l-4'
}

function getBorderColor(type: string) {
  switch (type) {
    case 'success': return 'border-green-500'
    case 'error': return 'border-red-500'
    case 'warning': return 'border-yellow-500'
    case 'info': return 'border-blue-500'
    default: return 'border-gray-500'
  }
}
</script>

<template>
  <div class="pointer-events-none fixed right-3 top-20 z-[9997] max-w-[calc(100vw-1.5rem)] flex flex-col gap-2 md:right-4 md:top-24">
    <TransitionGroup name="toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="pointer-events-auto max-w-full w-80 flex items-start gap-3 rounded p-4 shadow-lg transition-all duration-300"
        :class="[getBgColor(toast.type), getBorderColor(toast.type)]"
      >
        <div :class="getIcon(toast.type)" class="mt-0.5 shrink-0 text-xl" />
        <div class="min-w-0 flex-1">
          <div class="break-words text-sm text-gray-700 dark:text-gray-200">
            {{ toast.message }}
          </div>
          <button
            v-if="toast.action"
            type="button"
            class="mt-2 inline-flex items-center gap-1 border border-red-200 rounded-md bg-red-50 px-2.5 py-1 text-xs text-red-600 font-medium transition-colors dark:border-red-800 dark:bg-red-900/20 hover:bg-red-100 dark:text-red-400 focus:outline-none focus:ring-2 focus:ring-red-500 dark:hover:bg-red-900/30"
            @click="toastStore.runAction(toast.id)"
          >
            <div class="i-carbon-renew" />
            {{ toast.action.label }}
          </button>
        </div>
        <button
          class="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          @click="toastStore.remove(toast.id)"
        >
          <div class="i-carbon-close text-lg" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(30px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(30px);
}
</style>
