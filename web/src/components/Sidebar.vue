<script setup lang="ts">
import { useDateFormat, useIntervalFn, useNow } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'

import RenewCardModal from '@/components/RenewCardModal.vue'
import { menuRoutes } from '@/router/menu'
import { useAccountStore } from '@/stores/account'
import { useAppStore } from '@/stores/app'
import { useShopStore } from '@/stores/shop'
import { useStatusStore } from '@/stores/status'
import { useUserStore } from '@/stores/user'
import { accountAvatarUrl } from '@/utils/avatar'

const accountStore = useAccountStore()
const statusStore = useStatusStore()
const appStore = useAppStore()
const userStore = useUserStore()
const shopStore = useShopStore()
const router = useRouter()
const { currentAccount, currentAccountId } = storeToRefs(accountStore)
const { status, realtimeConnected } = storeToRefs(statusStore)
const { mysteryOffer, mysteryOfferAccountId } = storeToRefs(shopStore)
const { loginPageConfig } = storeToRefs(appStore)

const wsErrorNotifiedAt = ref<Record<string, number>>({})

const systemConnected = ref(true)
const serverUptimeBase = ref(0)
const lastPingTime = ref(Date.now())
const now = useNow()
const formattedTime = useDateFormat(now, 'YYYY-MM-DD HH:mm:ss')

async function checkConnection() {
  try {
    const res = await api.get('/api/ping')
    systemConnected.value = true
    if (res.data.ok && res.data.data) {
      if (res.data.data.uptime) {
        serverUptimeBase.value = res.data.data.uptime
        lastPingTime.value = Date.now()
      }
    }
    const accountRef = currentAccount.value?.id || currentAccount.value?.uin
    if (accountRef) {
      statusStore.connectRealtime(String(accountRef))
    }
  }
  catch {
    systemConnected.value = false
  }
}

async function refreshStatusFallback() {
  if (realtimeConnected.value)
    return

  const accountRef = currentAccount.value?.id || currentAccount.value?.uin
  if (accountRef) {
    await statusStore.fetchStatus(String(accountRef))
  }
}

onMounted(() => {
  appStore.fetchLoginPageConfig()
  accountStore.fetchAccounts()
  checkConnection()
  // 获取当前用户信息
  userStore.fetchUserInfo()
})

onBeforeUnmount(() => {
  statusStore.disconnectRealtime()
})

useIntervalFn(checkConnection, 30000)
useIntervalFn(() => {
  refreshStatusFallback()
  accountStore.fetchAccounts()
}, 10000)

watch(() => currentAccount.value?.id || currentAccount.value?.uin || '', () => {
  const accountRef = currentAccount.value?.id || currentAccount.value?.uin
  statusStore.connectRealtime(String(accountRef || ''))
  refreshStatusFallback()
}, { immediate: true })

watch(() => status.value?.wsError, (wsError: any) => {
  if (!wsError || Number(wsError.code) !== 400 || !currentAccount.value)
    return

  const errAt = Number(wsError.at) || 0
  const accId = String(currentAccount.value.id || currentAccount.value.uin || '')
  const lastNotified = wsErrorNotifiedAt.value[accId] || 0
  if (errAt <= lastNotified)
    return

  wsErrorNotifiedAt.value[accId] = errAt
  router.push('/settings')
}, { deep: true })

const uptime = computed(() => {
  const diff = Math.floor(serverUptimeBase.value + (now.value.getTime() - lastPingTime.value) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  return `${h}h ${m}m ${s}s`
})

const connectionStatus = computed(() => {
  if (!systemConnected.value) {
    return {
      text: '系统离线',
      color: 'bg-red-500',
      pulse: false,
    }
  }

  if (!currentAccount.value?.id) {
    return {
      text: '请添加账号',
      color: 'bg-gray-400',
      pulse: false,
    }
  }

  const isConnected = status.value?.connection?.connected
  if (isConnected) {
    return {
      text: '运行中',
      color: 'bg-green-500',
      pulse: true,
    }
  }

  return {
    text: '未连接',
    color: 'bg-gray-400', // Or red? Old version uses gray/offline class which is gray usually
    pulse: false,
  }
})

// 根据用户角色过滤导航菜单
const navItems = computed(() => {
  const isAdmin = userStore.isAdmin
  return menuRoutes
    .filter(item => item.showInNav !== false
      && (!item.adminOnly || isAdmin)
      && (!item.normalUserOnly || !isAdmin))
    .map(item => ({
      path: item.path ? `/${item.path}` : '/',
      label: item.label,
      icon: item.icon,
    }))
})

const hasActiveMysteryOffer = computed(() => {
  const offer = mysteryOffer.value
  if (!currentAccountId.value || mysteryOfferAccountId.value !== String(currentAccountId.value))
    return false
  if (!offer?.active || offer.purchased)
    return false
  const endTime = Number(offer.endTime || 0)
  const endMs = endTime > 10_000_000_000 ? endTime : endTime * 1000
  return !endMs || endMs > Date.now()
})

const version = __APP_VERSION__

const showThemeDropdown = ref(false)

// ============ 侧栏账号卡：登录用户时长/额度/过期时间 + 续费与退出 ============
const showAccountCard = ref(false)
const showRenewModal = ref(false)
const nowMs = ref(Date.now())
useIntervalFn(() => {
  nowMs.value = Date.now()
}, 30_000)

const expireMs = computed(() => {
  const value = Number(userStore.expiresAt)
  return Number.isFinite(value) && value > 0 ? value : 0
})
const userExpired = computed(() =>
  !userStore.isSuperAdmin && expireMs.value > 0 && expireMs.value <= nowMs.value)
// 剩余天数向上取整：29天23小时显示为「剩30天」（与问候卡「还有30天到期」同口径）
const remainingDays = computed(() => {
  if (!expireMs.value || userExpired.value)
    return null
  return Math.max(1, Math.ceil((expireMs.value - nowMs.value) / 86_400_000))
})
const remainingBadge = computed(() => {
  if (userStore.isSuperAdmin || !expireMs.value)
    return '永久'
  if (userExpired.value)
    return '已过期'
  return `剩${remainingDays.value}天`
})
const remainingBadgeStyle = computed(() => {
  if (userExpired.value || (remainingDays.value ?? 99) <= 3)
    return 'color: #ef4444; font-weight: 600;'
  if (userStore.isSuperAdmin || !expireMs.value)
    return 'opacity: 0.6; color: var(--theme-text);'
  return 'color: #f59e0b; font-weight: 600;'
})
const remainingDurationText = computed(() => {
  if (userStore.isSuperAdmin || !expireMs.value)
    return '永久'
  if (userExpired.value)
    return '已过期'
  const diff = expireMs.value - nowMs.value
  const days = Math.floor(diff / 86_400_000)
  const hours = Math.floor((diff % 86_400_000) / 3_600_000)
  return `${days}天${hours}小时`
})
const expireAtText = computed(() => {
  if (userStore.isSuperAdmin || !expireMs.value)
    return '永久'
  const date = new Date(expireMs.value)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
})
// 剩余额度 = 账号数上限 - 已添加账号数；超管不设限
const remainingQuota = computed(() => {
  if (userStore.isSuperAdmin)
    return null
  return Math.max(0, Number(userStore.accountLimit || 0) - accountStore.accounts.length)
})
const roleLabel = computed(() => (userStore.isSuperAdmin ? '超级管理员' : '普通用户'))
const userInitial = computed(() => (userStore.username || '用').slice(0, 1).toUpperCase())
// 账号卡头像：显示登录用户当前农场账号的 QQ 头像（按账号 id 走后端代理，同账号管理页），无账号时回退用户名首字
const accountAvatar = computed(() => accountAvatarUrl(currentAccount.value))

function handleLogout() {
  const refreshToken = userStore.refreshToken
  // 接口失败也要退出本地，所以不 await、不阻塞跳转
  api
    .post('/api/logout', refreshToken ? { refreshToken } : {}, { skipErrorToast: true } as any)
    .catch(() => {})
  userStore.clearSession()
  router.replace('/login')
}
</script>

<template>
  <!-- 移动端导航已改为底部 tab 栏（BottomTabBar），侧栏仅桌面端展示 -->
  <aside
    class="hidden h-full w-72 flex-none flex-col border-r border-gray-200/60 p-3 lg:static lg:flex dark:border-gray-700/60"
    :style="{ background: 'color-mix(in srgb, var(--surface-1) 90%, transparent)', color: 'var(--theme-text)' }"
  >
    <!-- Brand -->
    <div class="liquid-glass liquid-glass-static relative mb-3 flex-none rounded-2xl p-3">
      <div class="flex items-center justify-between">
        <div class="min-w-0 flex items-center gap-3">
          <div
            class="h-11 w-11 flex flex-none items-center justify-center rounded-2xl text-white shadow-lg"
            style="background: linear-gradient(135deg, #f472b6 0%, #a855f7 55%, #6366f1 100%); box-shadow: 0 4px 14px rgba(168, 85, 247, 0.35);"
          >
            <div class="i-carbon-sprout text-2xl" />
          </div>
          <div class="min-w-0">
            <div class="truncate text-[15px] font-bold tracking-tight" style="color: var(--theme-text);">
              {{ loginPageConfig.title || '农场智能助手' }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 渐变分隔线 -->
    <div class="mx-2 mb-3 h-px flex-none" style="background: linear-gradient(90deg, color-mix(in srgb, var(--theme-primary) 45%, transparent), transparent);" />

    <!-- 账号卡：登录用户时长/额度/过期时间 + 续费与退出 -->
    <div class="liquid-glass mb-3 flex-none rounded-2xl">
      <button
        class="w-full flex items-center gap-2.5 p-3 text-left"
        :aria-expanded="showAccountCard"
        @click="showAccountCard = !showAccountCard"
      >
        <div
          class="h-9 w-9 flex flex-none items-center justify-center overflow-hidden rounded-full text-sm text-white font-bold shadow"
          style="background: var(--theme-gradient);"
        >
          <img
            v-if="accountAvatar"
            :src="accountAvatar"
            :alt="userStore.username"
            class="h-full w-full object-cover"
          >
          <span v-else>{{ userInitial }}</span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-semibold" style="color: var(--theme-text);">
            {{ userStore.username || '未登录' }}
          </div>
          <div class="mt-0.5 flex items-center gap-1.5 text-[11px]">
            <span
              class="rounded px-1 py-0.2 text-[10px] leading-tight"
              :style="{ background: 'color-mix(in srgb, var(--theme-primary) 14%, transparent)', color: 'var(--theme-primary)' }"
            >
              {{ roleLabel }}
            </span>
            <span :style="remainingBadgeStyle">{{ remainingBadge }}</span>
            <span v-if="remainingQuota !== null" class="opacity-60" style="color: var(--theme-text);">
              {{ remainingQuota }}额度
            </span>
            <span v-else class="opacity-60" style="color: var(--theme-text);">∞额度</span>
          </div>
        </div>
        <div
          class="i-carbon-chevron-down shrink-0 text-xs opacity-50 transition-transform duration-200"
          :class="{ 'rotate-180': showAccountCard }"
          style="color: var(--theme-text);"
        />
      </button>

      <div
        v-show="showAccountCard"
        class="border-t px-3 pb-3 pt-2.5 text-xs space-y-1.5"
        style="border-color: color-mix(in srgb, var(--theme-text) 10%, transparent);"
      >
        <div class="flex items-center justify-between">
          <span class="opacity-55" style="color: var(--theme-text);">角色</span>
          <span style="color: var(--theme-text);">{{ roleLabel }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="opacity-55" style="color: var(--theme-text);">时长</span>
          <span class="font-medium" :class="userExpired ? 'text-red-500' : ''" style="color: var(--theme-text);">{{ remainingDurationText }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="opacity-55" style="color: var(--theme-text);">剩余额度</span>
          <span style="color: var(--theme-text);">{{ remainingQuota === null ? '∞' : remainingQuota }}</span>
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="shrink-0 opacity-55" style="color: var(--theme-text);">过期时间</span>
          <span class="truncate font-mono" style="color: var(--theme-text);">{{ expireAtText }}</span>
        </div>

        <div class="pt-2 space-y-1.5">
          <button
            class="w-full flex items-center justify-center gap-1.5 border rounded-lg py-2 text-sm font-medium transition hover:brightness-105"
            style="border-color: color-mix(in srgb, #f59e0b 45%, transparent); background: color-mix(in srgb, #f59e0b 12%, transparent); color: #f59e0b;"
            @click="showRenewModal = true"
          >
            <div class="i-carbon-renew text-base" />
            续费卡密/额度
          </button>
          <button
            class="w-full flex items-center justify-center gap-1.5 border rounded-lg py-2 text-sm text-red-500 font-medium transition hover:brightness-105"
            style="border-color: color-mix(in srgb, #ef4444 40%, transparent); background: color-mix(in srgb, #ef4444 10%, transparent);"
            @click="handleLogout"
          >
            <div class="i-carbon-logout text-base" />
            退出登录
          </button>
        </div>
      </div>

      <!-- Teleport 到 body：liquid-glass 的 backdrop-filter 会把 fixed 定位框在卡片内，导致弹窗居中失效 -->
      <Teleport to="body">
        <RenewCardModal :show="showRenewModal" @close="showRenewModal = false" />
      </Teleport>
    </div>

    <!-- Navigation -->
    <nav class="custom-scrollbar flex-1 overflow-y-auto px-1 py-1 space-y-1">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        :active-class="item.path === '/' ? '' : 'router-link-active'"
        :exact-active-class="item.path === '/' ? 'router-link-active' : 'router-link-exact-active'"
        class="nav-item group relative flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors duration-200"
      >
        <span class="nav-icon h-9 w-9 flex flex-none items-center justify-center rounded-lg text-[22px] transition-colors duration-200">
          <div :class="[item.icon]" />
        </span>
        <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ item.label }}</span>
        <span
          v-if="item.path === '/shop' && hasActiveMysteryOffer"
          class="h-2 w-2 shrink-0 rounded-full bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.15)]"
          title="神秘商人已出现"
        />
      </router-link>
    </nav>

    <!-- Footer Status -->
    <div class="relative mt-4 flex-none rounded-xl px-3 py-2.5" style="background: color-mix(in srgb, var(--surface-2) 80%, transparent);">
      <div class="flex items-center justify-between text-xs">
        <div class="flex items-center gap-1.5 font-medium" style="color: var(--theme-text);">
          <span class="h-2 w-2 rounded-full" :class="[connectionStatus.color, { 'animate-pulse': connectionStatus.pulse }]" />
          <span>{{ connectionStatus.text }}</span>
        </div>
        <span class="font-mono opacity-60" style="color: var(--theme-text);">{{ uptime }}</span>
      </div>

      <div class="mt-2 flex items-center justify-between border-t pt-2 text-xs opacity-80" style="border-color: color-mix(in srgb, var(--theme-text) 10%, transparent); color: var(--theme-text);">
        <span class="font-mono">{{ formattedTime }}</span>
        <!-- 主题调色盘按钮 -->
        <button
          class="h-9 w-9 flex items-center justify-center rounded-lg transition-colors hover:bg-gray-200/60 dark:hover:bg-gray-700/60"
          title="主题设置"
          @click="showThemeDropdown = !showThemeDropdown"
        >
          <div class="i-carbon-color-palette text-sm" :style="{ color: 'var(--theme-primary)' }" />
        </button>
      </div>

      <div class="mt-1 flex items-center justify-end text-[11px] font-mono opacity-45" style="color: var(--theme-text);">
        <span>v{{ version }}</span>
      </div>

      <!-- 主题选择弹出面板 -->
      <div
        v-show="showThemeDropdown"
        class="glass-panel absolute bottom-full left-0 right-0 z-50 grid grid-cols-4 mb-2 gap-1.5 rounded-lg p-2"
      >
        <button
          v-for="(t, theme) in appStore.themes"
          :key="theme"
          class="group relative flex flex-col items-center justify-center gap-1 rounded-lg p-2 transition-all hover:scale-105"
          :class="{
            'ring-2 ring-offset-1': appStore.currentTheme === theme,
          }"
          :style="{
            'background': t.gradient,
            '--tw-ring-color': t.primary,
            '--tw-ring-offset-color': 'var(--theme-bg)',
          }"
          :title="t.name"
          @click="appStore.applyTheme(theme as any); showThemeDropdown = false"
        >
          <div :class="t.icon" class="text-base text-white" />
          <span class="text-[10px] text-white font-medium leading-tight">{{ t.name }}</span>
          <div
            v-if="appStore.currentTheme === theme"
            class="absolute right-1 top-1 h-3 w-3 flex items-center justify-center rounded-full bg-white shadow"
          >
            <div class="i-carbon-checkmark text-xs" :style="{ color: t.primary }" />
          </div>
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.3);
  border-radius: 2px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
}

/* ===== 导航菜单项 ===== */

/* 默认态 */
.nav-item {
  opacity: 0.82;
}
.nav-item:hover {
  background: var(--surface-2);
  opacity: 1;
}

/* 图标容器 */
.nav-item .nav-icon {
  color: color-mix(in srgb, var(--theme-text) 58%, transparent);
}
.nav-item:hover .nav-icon {
  background: color-mix(in srgb, var(--theme-text) 7%, transparent);
  color: var(--theme-text);
}

/* 选中态：渐变图标胶囊 + 左侧指示条 */
.router-link-active.nav-item,
.router-link-exact-active.nav-item {
  background: color-mix(in srgb, var(--theme-primary) 9%, transparent) !important;
  color: var(--theme-primary) !important;
  opacity: 1;
}

.router-link-active .nav-icon,
.router-link-exact-active .nav-icon {
  background: var(--theme-gradient) !important;
  color: #fff !important;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--theme-primary) 28%, transparent);
}

.router-link-active::before,
.router-link-exact-active::before {
  content: '';
  position: absolute;
  top: 50%;
  left: -4px;
  width: 3px;
  height: 56%;
  transform: translateY(-50%);
  border-radius: 0 4px 4px 0;
  background: var(--theme-gradient);
}
</style>
