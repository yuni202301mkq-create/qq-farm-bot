<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useUserStore } from '@/stores/user'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits(['close', 'redeemed'])

const userStore = useUserStore()

const cardKey = ref('')
const loading = ref(false)
const inspecting = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const inspectedCard = ref<{ code: string, days: number, accountLimit: number, note: string } | null>(null)

const quotaLabel = computed(() => {
  if (userStore.isSuperAdmin)
    return '不限额度'
  return `${userStore.accountLimit} 个额度`
})

const expiryLabel = computed(() => {
  if (userStore.isSuperAdmin)
    return '永不过期'
  if (!userStore.expiresAt)
    return '未设置有效期'
  return `至 ${formatTime(userStore.expiresAt)}`
})

function formatTime(value: number | null | undefined) {
  if (!value)
    return '-'
  const d = new Date(Number(value))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

watch(() => props.show, (val) => {
  if (val) {
    cardKey.value = ''
    errorMessage.value = ''
    successMessage.value = ''
    inspectedCard.value = null
    loading.value = false
    inspecting.value = false
  }
})

function close() {
  emit('close')
}

async function inspectCard() {
  const code = cardKey.value.trim()
  if (!code) {
    errorMessage.value = '请输入卡密'
    return
  }
  inspecting.value = true
  errorMessage.value = ''
  successMessage.value = ''
  inspectedCard.value = null
  try {
    const { data } = await api.post('/api/user/card-inspect', { cardKey: code })
    if (!data?.ok)
      throw new Error(data?.error || '卡密查询失败')
    inspectedCard.value = data.data
  }
  catch (error: any) {
    if (error?.response?.status === 404)
      errorMessage.value = '续费接口不存在，请将服务端更新到最新版本并重启'
    else
      errorMessage.value = error?.response?.data?.error || error?.message || '卡密查询失败'
  }
  finally {
    inspecting.value = false
  }
}

async function redeemCard() {
  if (!inspectedCard.value || loading.value)
    return
  loading.value = true
  errorMessage.value = ''
  try {
    const { data } = await api.post('/api/user/card-redeem', { cardKey: inspectedCard.value.code })
    if (!data?.ok)
      throw new Error(data?.error || '卡密使用失败')
    const d = data.data
    const parts: string[] = []
    if (d.days > 0)
      parts.push(`有效期 +${d.days} 天`)
    if (d.accountLimitAdded > 0)
      parts.push(`额度 +${d.accountLimitAdded}`)
    successMessage.value = `兑换成功：${parts.join('，')}（当前额度 ${d.accountLimit} 个）`
    inspectedCard.value = null
    cardKey.value = ''
    await userStore.fetchUserInfo()
    emit('redeemed')
  }
  catch (error: any) {
    if (error?.response?.status === 404)
      errorMessage.value = '续费接口不存在，请将服务端更新到最新版本并重启'
    else
      errorMessage.value = error?.response?.data?.error || error?.message || '卡密使用失败'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" @click.self="close">
    <div class="max-w-sm w-full overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-800">
      <div class="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
        <div class="flex items-center gap-2">
          <h3 class="text-lg font-semibold">
            续费卡密
          </h3>
          <span
            class="rounded-full px-2 py-0.5 text-xs font-medium"
            :style="{
              color: 'var(--theme-primary)',
              backgroundColor: 'color-mix(in srgb, var(--theme-primary) 12%, transparent)',
            }"
          >
            {{ quotaLabel }}
          </span>
        </div>
        <BaseButton variant="ghost" class="!p-1" @click="close">
          <div class="i-carbon-close text-xl" />
        </BaseButton>
      </div>

      <div class="p-4 space-y-4">
        <p class="text-xs text-gray-500 dark:text-gray-400">
          查询卡密后确认，即可为当前账号延长有效期或增加账号额度。
        </p>

        <!-- 当前额度状态 -->
        <div class="border border-gray-200 rounded-xl bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
          <div class="flex items-center gap-2 text-sm font-medium">
            <div class="i-carbon-checkmark-filled text-base" :style="{ color: 'var(--theme-primary)' }" />
            当前额度状态
          </div>
          <div class="mt-1.5 pl-6 text-sm" :style="{ color: 'var(--theme-primary)' }">
            {{ quotaLabel }}
          </div>
          <div class="ml-6 mt-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            有效期 {{ expiryLabel }}
          </div>
        </div>

        <div v-if="userStore.isSuperAdmin" class="rounded-xl bg-gray-100 px-3 py-2.5 text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
          超级管理员账号无额度上限、永不过期，无需使用卡密。如需发卡请到「卡密设置」。
        </div>

        <template v-if="!userStore.isSuperAdmin">
          <!-- 卡密输入 -->
          <div>
            <label class="mb-1.5 block text-sm font-medium">卡密</label>
            <input
              v-model="cardKey"
              type="text"
              placeholder="请输入卡密"
              class="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none transition dark:border-gray-600 focus:border-[var(--theme-primary)] dark:bg-gray-900 dark:text-gray-100"
              :disabled="!!inspectedCard"
              @keyup.enter="inspectedCard ? redeemCard() : inspectCard()"
            >
          </div>

          <!-- 卡密信息 -->
          <div v-if="inspectedCard" class="border border-emerald-200 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
            <div class="font-medium">
              卡密可用
            </div>
            <div class="mt-1 text-xs space-y-0.5">
              <div v-if="inspectedCard.days > 0">
                有效天数：+{{ inspectedCard.days }} 天
              </div>
              <div v-if="inspectedCard.accountLimit > 0">
                新增额度：+{{ inspectedCard.accountLimit }} 个
              </div>
              <div v-if="inspectedCard.note">
                备注：{{ inspectedCard.note }}
              </div>
            </div>
          </div>

          <p v-if="errorMessage" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
            {{ errorMessage }}
          </p>
          <p v-if="successMessage" class="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
            {{ successMessage }}
          </p>

          <div class="flex justify-end gap-2">
            <BaseButton variant="outline" @click="close">
              取消
            </BaseButton>
            <template v-if="!userStore.isSuperAdmin">
              <BaseButton
                v-if="!inspectedCard"
                variant="primary"
                :loading="inspecting"
                @click="inspectCard"
              >
                查询卡密
              </BaseButton>
              <BaseButton
                v-else
                variant="primary"
                :loading="loading"
                @click="redeemCard"
              >
                确认使用
              </BaseButton>
            </template>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
