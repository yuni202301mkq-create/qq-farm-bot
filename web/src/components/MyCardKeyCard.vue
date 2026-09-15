<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()

const loading = ref(false)
const activating = ref(false)
const cardKey = ref('')
const errorMsg = ref('')
const successMsg = ref('')
const nowMs = ref(Date.now())
let nowTimer: ReturnType<typeof window.setInterval> | null = null

const accountLimit = computed(() => Number(userStore.userInfo?.accountLimit) || 0)
const expiresAt = computed(() => {
  const value = Number(userStore.userInfo?.expiresAt)
  return Number.isFinite(value) && value > 0 ? value : 0
})
const expired = computed(() => expiresAt.value > 0 && expiresAt.value <= nowMs.value)

const expiresAtText = computed(() => {
  if (!expiresAt.value)
    return '未知'
  const date = new Date(expiresAt.value)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
})

const remainingText = computed(() => {
  if (!expiresAt.value)
    return '未知'
  const diff = expiresAt.value - nowMs.value
  if (diff <= 0)
    return '已过期'
  const totalSeconds = Math.floor(diff / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${days}天 ${hours}小时 ${minutes}分钟 ${seconds}秒`
})

async function fetchProfile() {
  loading.value = true
  try {
    await userStore.fetchUserInfo()
  }
  catch {}
  finally {
    loading.value = false
  }
}

async function activate() {
  const key = cardKey.value.trim()
  if (!key || activating.value)
    return
  activating.value = true
  errorMsg.value = ''
  successMsg.value = ''
  try {
    const { data } = await api.post('/api/user/card-redeem', { cardKey: key })
    if (!data?.ok)
      throw new Error(data?.error || '激活失败')
    // 按卡密类型只汇报对应效果：时效卡密延长有效期，额度账号卡密增加账号数
    const d = data.data || {}
    if (d.type === 'quota')
      successMsg.value = `激活成功，账号额度 +${d.accountLimitAdded || 0}，当前共 ${d.accountLimit ?? accountLimit.value} 个账号`
    else
      successMsg.value = `激活成功，已延长 ${d.days || 0} 天`
    cardKey.value = ''
    await userStore.fetchUserInfo()
  }
  catch (e: any) {
    errorMsg.value = e?.response?.data?.error || e?.message || '激活失败'
  }
  finally {
    activating.value = false
  }
}

onMounted(() => {
  fetchProfile()
  nowTimer = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  if (nowTimer)
    window.clearInterval(nowTimer)
})
</script>

<template>
  <div class="ui-card rounded-lg p-5">
    <div class="mb-4 flex items-center justify-between">
      <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
        我的卡密信息
      </h3>
      <button
        class="text-xs text-gray-400 transition hover:text-gray-600 dark:hover:text-gray-300"
        :disabled="loading"
        @click="fetchProfile"
      >
        刷新
      </button>
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div class="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/40">
        <div class="text-sm text-gray-500">
          账号状态
        </div>
        <div class="mt-2">
          <span
            class="inline-block rounded-md px-3 py-1 text-sm font-medium"
            :class="expired
              ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'"
          >
            {{ expired ? '已过期' : '正常' }}
          </span>
        </div>
      </div>
      <div class="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/40">
        <div class="text-sm text-gray-500">
          账号额度
        </div>
        <div class="mt-2 text-xl text-blue-600 font-bold dark:text-blue-400">
          {{ accountLimit }} 个账号
        </div>
      </div>
      <div class="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/40">
        <div class="text-sm text-gray-500">
          到期时间
        </div>
        <div class="mt-2 text-lg text-gray-900 font-bold dark:text-gray-100">
          {{ expiresAtText }}
        </div>
      </div>
      <div class="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/40">
        <div class="text-sm text-gray-500">
          剩余时间
        </div>
        <div class="mt-2 text-lg font-bold" :class="expired ? 'text-red-500' : 'text-green-600 dark:text-green-400'">
          {{ remainingText }}
        </div>
      </div>
    </div>

    <div class="mt-5 border-t border-gray-100 pt-4 dark:border-gray-700">
      <h4 class="text-base text-gray-900 font-bold dark:text-gray-100">
        激活卡密
      </h4>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
        时效卡密延长使用时长，额度账号卡密增加可添加账号数，卡密可叠加使用。
      </p>
      <div class="mt-3 flex gap-2">
        <input
          v-model="cardKey"
          type="text"
          placeholder="请输入卡密"
          class="h-10 flex-1 border border-gray-200 rounded-lg bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          @keyup.enter="activate"
        >
        <BaseButton size="md" class="shrink-0" :loading="activating" @click="activate">
          激活
        </BaseButton>
      </div>
      <p v-if="successMsg" class="mt-2 text-xs text-green-600 dark:text-green-400">
        {{ successMsg }}
      </p>
      <p v-if="errorMsg" class="mt-2 text-xs text-red-500">
        {{ errorMsg }}
      </p>
    </div>

    <ul class="mt-4 list-disc space-y-1 border-t border-gray-100 pl-5 pt-4 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
      <li>时效卡密激活后自动延长账号到期时间</li>
      <li>额度账号卡密激活后增加可添加账号数，只能在此页登录后激活</li>
      <li>多张卡密可叠加使用，效果累加</li>
    </ul>
  </div>
</template>
