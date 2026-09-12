<script setup lang="ts">
import { ref } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const showOld = ref(false)
const showNew = ref(false)
const showConfirm = ref(false)
const loading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

async function submit() {
  if (loading.value)
    return
  errorMessage.value = ''
  successMessage.value = ''

  if (!oldPassword.value) {
    errorMessage.value = '请输入当前密码'
    return
  }
  if (!newPassword.value || newPassword.value.length < 6) {
    errorMessage.value = '新密码至少 6 位'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    errorMessage.value = '两次输入的新密码不一致'
    return
  }
  if (newPassword.value === oldPassword.value) {
    errorMessage.value = '新密码不能与当前密码相同'
    return
  }

  loading.value = true
  try {
    const { data } = await api.post('/api/user/change-password', {
      oldPassword: oldPassword.value,
      newPassword: newPassword.value,
    })
    if (!data?.ok)
      throw new Error(data?.error || '修改失败')
    successMessage.value = '密码修改成功，下次登录请使用新密码'
    oldPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  }
  catch (error: any) {
    errorMessage.value = error?.response?.data?.error || error?.message || '修改失败'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="border border-gray-200 rounded-xl bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
    <div class="border-b border-gray-100 px-4 py-3 dark:border-gray-700">
      <h3 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
        <div class="i-carbon-user-role text-lg" :style="{ color: 'var(--theme-primary)' }" />
        用户管理
      </h3>
    </div>

    <div class="p-4">
      <div class="border border-gray-100 rounded-lg bg-gray-50/60 p-4 dark:border-gray-700 dark:bg-gray-900/40">
        <div class="mb-3 flex items-center gap-2 text-sm font-semibold">
          <div class="i-carbon-password text-base" :style="{ color: 'var(--theme-primary)' }" />
          修改用户密码
        </div>

        <form class="space-y-3" @submit.prevent="submit">
          <div>
            <label class="mb-1 block text-xs text-gray-500 dark:text-gray-400">当前密码</label>
            <div class="relative">
              <input
                v-model="oldPassword"
                :type="showOld ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="当前用户密码"
                class="w-full border border-gray-200 rounded-lg px-3 py-2.5 pr-10 text-sm outline-none transition dark:border-gray-600 focus:border-[var(--theme-primary)] dark:bg-gray-900 dark:text-gray-100"
              >
              <button
                type="button"
                class="absolute right-2 top-1/2 p-1 text-gray-400 -translate-y-1/2 hover:text-gray-600"
                @click="showOld = !showOld"
              >
                <div :class="showOld ? 'i-carbon-view-off' : 'i-carbon-view'" />
              </button>
            </div>
          </div>

          <div>
            <label class="mb-1 block text-xs text-gray-500 dark:text-gray-400">新密码</label>
            <div class="relative">
              <input
                v-model="newPassword"
                :type="showNew ? 'text' : 'password'"
                autocomplete="new-password"
                placeholder="至少 6 位"
                class="w-full border border-gray-200 rounded-lg px-3 py-2.5 pr-10 text-sm outline-none transition dark:border-gray-600 focus:border-[var(--theme-primary)] dark:bg-gray-900 dark:text-gray-100"
              >
              <button
                type="button"
                class="absolute right-2 top-1/2 p-1 text-gray-400 -translate-y-1/2 hover:text-gray-600"
                @click="showNew = !showNew"
              >
                <div :class="showNew ? 'i-carbon-view-off' : 'i-carbon-view'" />
              </button>
            </div>
          </div>

          <div>
            <label class="mb-1 block text-xs text-gray-500 dark:text-gray-400">确认新密码</label>
            <div class="relative">
              <input
                v-model="confirmPassword"
                :type="showConfirm ? 'text' : 'password'"
                autocomplete="new-password"
                placeholder="再次输入新密码"
                class="w-full border border-gray-200 rounded-lg px-3 py-2.5 pr-10 text-sm outline-none transition dark:border-gray-600 focus:border-[var(--theme-primary)] dark:bg-gray-900 dark:text-gray-100"
              >
              <button
                type="button"
                class="absolute right-2 top-1/2 p-1 text-gray-400 -translate-y-1/2 hover:text-gray-600"
                @click="showConfirm = !showConfirm"
              >
                <div :class="showConfirm ? 'i-carbon-view-off' : 'i-carbon-view'" />
              </button>
            </div>
          </div>

          <p v-if="errorMessage" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
            {{ errorMessage }}
          </p>
          <p v-if="successMessage" class="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
            {{ successMessage }}
          </p>

          <div class="flex justify-end">
            <BaseButton variant="primary" size="sm" :loading="loading" @click="submit">
              修改用户密码
            </BaseButton>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
