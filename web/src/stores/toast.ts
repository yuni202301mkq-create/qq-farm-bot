import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastAction {
  label: string
  handler: () => void
}

export interface Toast {
  id: number
  message: string
  type: ToastType
  duration?: number
  action?: ToastAction
}

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([])
  const recentMessages = new Set<string>()
  let nextId = 1

  function add(message: string, type: ToastType = 'info', duration = 3000, action?: ToastAction) {
    const key = `${type}:${message}`

    // Prevent duplicate toasts if one with the same message and type is already visible
    if (toasts.value.some(t => t.message === message && t.type === type)) {
      return
    }

    // Prevent rapid re-appearance (debounce)
    if (recentMessages.has(key)) {
      return
    }

    recentMessages.add(key)
    setTimeout(() => recentMessages.delete(key), 2000)

    const id = nextId++
    const toast: Toast = { id, message, type, duration, action }
    toasts.value.push(toast)

    // duration > 0 时按 duration 自动消失；duration 传 0 表示需要用户手动关闭。
    // 带操作按钮的通知同样遵守 duration：调用方显式给了 3000，就应当在 3 秒后消失，
    // 不能因为带了按钮就永久驻留。
    if (duration > 0) {
      setTimeout(() => {
        remove(id)
      }, duration)
    }
  }

  function remove(id: number) {
    const index = toasts.value.findIndex(t => t.id === id)
    if (index !== -1) {
      toasts.value.splice(index, 1)
    }
  }

  function runAction(id: number) {
    const toast = toasts.value.find(t => t.id === id)
    if (!toast || !toast.action)
      return
    try {
      toast.action.handler()
    }
    finally {
      remove(id)
    }
  }

  function success(message: string, duration = 3000) {
    add(message, 'success', duration)
  }

  function error(message: string, duration = 5000) {
    add(message, 'error', duration)
  }

  function warning(message: string, duration = 4000) {
    add(message, 'warning', duration)
  }

  function info(message: string, duration = 3000) {
    add(message, 'info', duration)
  }

  return {
    toasts,
    add,
    remove,
    runAction,
    success,
    error,
    warning,
    info,
  }
})
