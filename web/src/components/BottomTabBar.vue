<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api'
import RenewCardModal from '@/components/RenewCardModal.vue'
import { menuRoutes } from '@/router/menu'
import { useAccountStore } from '@/stores/account'
import { useAppStore } from '@/stores/app'
import { useShopStore } from '@/stores/shop'
import { useUserStore } from '@/stores/user'
import { accountAvatarUrl } from '@/utils/avatar'

const route = useRoute()
const router = useRouter()
const accountStore = useAccountStore()
const appStore = useAppStore()
const userStore = useUserStore()
const shopStore = useShopStore()
const { currentAccount } = storeToRefs(accountStore)
const { mysteryOffer, mysteryOfferAccountId } = storeToRefs(shopStore)

const showMore = ref(false)
const showThemes = ref(false)
const showRenewModal = ref(false)

// 导航入口全部从 menuRoutes 派生（与 Sidebar 同一套过滤规则），保持单一数据源。
// 收进「更多」卡片的页面；其余按 menuRoutes 顺序作为固定 tab。
const MORE_KEYS = new Set(['friends', 'pet', 'shop', 'illustrated', 'analytics'])

interface NavEntry {
  path: string
  label: string
  icon: string
}

const visibleMenuItems = computed(() => {
  const isAdmin = userStore.isAdmin
  return menuRoutes.filter(item => item.showInNav !== false
    && (!item.adminOnly || isAdmin)
    && (!item.normalUserOnly || !isAdmin))
})

// 固定 tab：概览 / 个人 / 活动 / 设置（更多按钮插在第 2、3 项之间）
const mainTabs = computed<NavEntry[]>(() => visibleMenuItems.value
  .filter(item => !MORE_KEYS.has(item.name))
  .map(item => ({
    path: item.path ? `/${item.path}` : '/',
    label: item.label,
    icon: item.icon,
  })))

const moreItems = computed<NavEntry[]>(() => visibleMenuItems.value
  .filter(item => MORE_KEYS.has(item.name))
  .map(item => ({
    path: item.path ? `/${item.path}` : '/',
    label: item.label,
    icon: item.icon,
  })))

// 更新日志是独立页面（showInNav:false 不进侧栏/tab），手动补进「更多」宫格
const CHANGELOG_ENTRY: NavEntry = { path: '/changelog', label: '更新日志', icon: 'i-carbon-catalog' }

const moreGrid = computed<NavEntry[]>(() => [...moreItems.value, CHANGELOG_ENTRY])

const morePaths = computed(() => new Set([...moreItems.value.map(item => item.path), CHANGELOG_ENTRY.path]))

function isActive(path: string) {
  return route.path === path
}

const isMoreActive = computed(() => morePaths.value.has(route.path))

// 神秘商人出现时在「更多」tab 上提示（商城入口收在更多卡片里）
const hasActiveMysteryOffer = computed(() => {
  const offer = mysteryOffer.value
  if (!currentAccount.value || mysteryOfferAccountId.value !== String(currentAccount.value.id || currentAccount.value.uin || ''))
    return false
  if (!offer?.active || offer.purchased)
    return false
  const endTime = Number(offer.endTime || 0)
  const endMs = endTime > 10_000_000_000 ? endTime : endTime * 1000
  return !endMs || endMs > Date.now()
})

watch(() => route.path, () => {
  showMore.value = false
})

watch(showMore, (open) => {
  if (!open)
    showThemes.value = false
})

function closeMore() {
  showMore.value = false
}

// ============ 账号条：登录用户时长/额度 + 续费、主题、退出（原侧栏能力在移动端的入口） ============
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
// 剩余天数向上取整（与侧栏账号卡同口径）
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
const remainingQuota = computed(() => {
  if (userStore.isSuperAdmin)
    return null
  return Math.max(0, Number(userStore.accountLimit || 0) - accountStore.accounts.length)
})
const roleLabel = computed(() => (userStore.isSuperAdmin ? '超级管理员' : '普通用户'))
const userInitial = computed(() => (userStore.username || '用').slice(0, 1).toUpperCase())
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
  <!-- 更多卡片：遮罩 + 居中圆角卡片 -->
  <Transition name="btt-fade">
    <div
      v-if="showMore"
      class="fixed inset-0 z-[90] grid place-items-center bg-gray-950/50 p-4 backdrop-blur-md lg:hidden"
      @click.self="closeMore"
    >
      <Transition name="btt-pop" appear>
        <div
          class="more-card max-w-[23rem] w-full overflow-hidden rounded-[28px]"
          style="color: var(--theme-text);"
          role="dialog"
          aria-label="更多功能"
        >
          <!-- 账号条 -->
          <div
            class="flex items-center gap-2.5 border-b p-3.5"
            style="border-color: color-mix(in srgb, var(--theme-text) 10%, transparent);"
          >
            <div
              class="more-card__avatar h-11 w-11 flex flex-none items-center justify-center overflow-hidden rounded-full text-sm text-white font-bold"
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
              <div class="flex items-center gap-1.5">
                <span class="truncate text-sm font-semibold">{{ userStore.username || '未登录' }}</span>
                <span
                  class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-tight"
                  :style="{ background: 'color-mix(in srgb, var(--theme-primary) 15%, transparent)', color: 'var(--theme-primary)' }"
                >{{ roleLabel }}</span>
                <span class="shrink-0 text-[11px]" :style="remainingBadgeStyle">{{ remainingBadge }}</span>
              </div>
              <div class="mt-0.5 text-[11px] opacity-60">
                剩余额度：{{ remainingQuota === null ? '∞' : remainingQuota }}
              </div>
            </div>
          </div>

          <!-- 操作按钮行 -->
          <div class="flex items-center gap-2 p-3.5 pb-1">
            <button
              class="btn-renew h-9 flex flex-1 cursor-pointer items-center justify-center gap-1.5 text-[13px] font-bold transition active:scale-95"
              @click="showRenewModal = true"
            >
              <div class="i-carbon-renew text-sm" />
              续费卡密
            </button>
            <button
              class="btn-ghost h-9 w-9 flex flex-none cursor-pointer items-center justify-center rounded-xl transition active:scale-95"
              title="主题设置"
              :aria-expanded="showThemes"
              @click="showThemes = !showThemes"
            >
              <div class="i-carbon-color-palette text-base" :style="{ color: 'var(--theme-primary)' }" />
            </button>
            <button
              class="btn-ghost btn-ghost--danger h-9 w-9 flex flex-none cursor-pointer items-center justify-center rounded-xl transition active:scale-95"
              title="退出登录"
              @click="handleLogout"
            >
              <div class="i-carbon-logout text-base" />
            </button>
          </div>

          <!-- 主题选择面板 -->
          <div
            v-show="showThemes"
            class="grid grid-cols-4 gap-1.5 p-3.5 pt-2"
          >
            <button
              v-for="(t, theme) in appStore.themes"
              :key="theme"
              class="relative flex flex-col cursor-pointer items-center justify-center gap-1 rounded-xl p-2 transition active:scale-95"
              :class="{ 'ring-2 ring-offset-1': appStore.currentTheme === theme }"
              :style="{
                'background': t.gradient,
                '--tw-ring-color': t.primary,
                '--tw-ring-offset-color': 'var(--theme-bg)',
              }"
              :title="t.name"
              @click="appStore.applyTheme(theme as any); showThemes = false"
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

          <!-- 导航宫格 -->
          <nav
            class="grid grid-cols-3 gap-1.5 p-3.5 pt-2"
            :class="showThemes ? '' : 'pt-1'"
          >
            <router-link
              v-for="item in moreGrid"
              :key="item.path"
              :to="item.path"
              class="more-entry flex flex-col cursor-pointer items-center gap-2 rounded-2xl px-2 py-3.5 transition-colors duration-200"
              :class="isActive(item.path) ? 'is-active' : ''"
              :aria-current="isActive(item.path) ? 'page' : undefined"
            >
              <span class="more-entry__icon h-11 w-11 flex items-center justify-center rounded-[15px] text-[22px]">
                <div :class="item.icon" />
              </span>
              <span class="relative text-xs font-medium">
                {{ item.label }}
                <span
                  v-if="item.path === '/shop' && hasActiveMysteryOffer"
                  class="absolute h-2 w-2 rounded-full bg-red-500 -right-1.5 -top-0.5"
                  title="神秘商人已出现"
                />
              </span>
            </router-link>
          </nav>
        </div>
      </Transition>
    </div>
  </Transition>

  <!-- 底部 tab 栏：悬浮圆角毛玻璃卡片 -->
  <nav
    class="fixed inset-x-3 bottom-[calc(0.625rem+env(safe-area-inset-bottom))] z-[80] lg:hidden"
    aria-label="底部导航"
  >
    <div class="bt-bar mx-auto h-[58px] max-w-md flex items-stretch">
      <template v-for="(tab, index) in mainTabs" :key="tab.path">
        <router-link
          :to="tab.path"
          class="tab-item flex flex-1 flex-col cursor-pointer items-center justify-center gap-0.5 transition-colors duration-200"
          :class="isActive(tab.path) ? 'is-active' : ''"
          :aria-current="isActive(tab.path) ? 'page' : undefined"
        >
          <span class="tab-item__icon h-7 w-12 flex items-center justify-center rounded-full text-[21px]">
            <div :class="tab.icon" />
          </span>
          <span class="text-[10px] font-medium leading-none">{{ tab.label }}</span>
        </router-link>

        <!-- 更多按钮插在「个人」和「活动」之间 -->
        <button
          v-if="index === 1"
          type="button"
          class="tab-item flex flex-1 flex-col cursor-pointer items-center justify-center gap-0.5 transition-colors duration-200"
          :class="isMoreActive || showMore ? 'is-active' : ''"
          :aria-expanded="showMore"
          aria-label="更多功能"
          @click="showMore = !showMore"
        >
          <span class="tab-item__icon relative h-7 w-12 flex items-center justify-center rounded-full text-[21px]">
            <div class="i-carbon-overflow-menu-horizontal" />
            <span
              v-if="hasActiveMysteryOffer && !showMore"
              class="absolute right-2 top-0 h-2 w-2 rounded-full bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.15)]"
              title="神秘商人已出现"
            />
          </span>
          <span class="text-[10px] font-medium leading-none">更多</span>
        </button>
      </template>
    </div>
  </nav>

  <Teleport to="body">
    <RenewCardModal :show="showRenewModal" @close="showRenewModal = false" />
  </Teleport>
</template>

<style scoped>
/* ==========================================================================
   悬浮 tab 栏：iOS 液态玻璃质感——大圆角、强模糊、顶部内高光、柔和投影
   perf-lite 模式下全局 backdrop-filter: none，剩余 80%+ 不透明底色保证可读
   ========================================================================== */
.bt-bar {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0) 45%),
    color-mix(in srgb, var(--surface-1) 82%, transparent);
  -webkit-backdrop-filter: blur(28px) saturate(1.8);
  backdrop-filter: blur(28px) saturate(1.8);
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 24px;
  box-shadow:
    0 16px 40px -12px rgba(15, 23, 42, 0.28),
    0 2px 8px rgba(15, 23, 42, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
}
.dark .bt-bar {
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow:
    0 16px 40px -12px rgba(0, 0, 0, 0.6),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

/* ===== 更多居中卡片（实色背景，不透底） =====
   暗色主题的 --surface-1 本身只有 81% 不透明度（color-mix 权重 72%+9%），
   直接用会透底；这里垫一层不透明的 --theme-bg 再叠表面色，保证任何主题下都不透明 */
.more-card {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0) 40%),
    linear-gradient(var(--surface-1), var(--surface-1)), var(--theme-bg);
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow:
    0 24px 64px -16px rgba(15, 23, 42, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
}
.dark .more-card {
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow:
    0 24px 64px -16px rgba(0, 0, 0, 0.65),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.more-card__avatar {
  background: var(--theme-gradient);
  box-shadow: 0 4px 10px -2px color-mix(in srgb, var(--theme-primary) 45%, transparent);
}

/* ===== 质感按钮 ===== */
.btn-renew {
  color: #fff;
  background: linear-gradient(180deg, #fbbf24, #f59e0b);
  border: none;
  border-radius: 12px;
  box-shadow:
    0 4px 12px -3px rgba(245, 158, 11, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}
.btn-renew:hover {
  filter: brightness(1.05);
}

.btn-ghost {
  color: color-mix(in srgb, var(--theme-text) 65%, transparent);
  background: color-mix(in srgb, var(--theme-text) 7%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-text) 10%, transparent);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
}
.btn-ghost:hover {
  background: color-mix(in srgb, var(--theme-text) 11%, transparent);
}
.btn-ghost--danger {
  color: #ef4444;
  background: color-mix(in srgb, #ef4444 10%, transparent);
  border-color: color-mix(in srgb, #ef4444 24%, transparent);
}
.btn-ghost--danger:hover {
  background: color-mix(in srgb, #ef4444 15%, transparent);
}

/* ===== tab 项 ===== */
.tab-item {
  color: color-mix(in srgb, var(--theme-text) 55%, transparent);
  -webkit-tap-highlight-color: transparent;
}
.tab-item:active {
  transform: scale(0.94);
}
.tab-item__icon {
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    box-shadow 0.2s ease;
}
.tab-item.is-active {
  color: var(--theme-primary);
}
.tab-item.is-active .tab-item__icon {
  background: var(--theme-gradient);
  color: #fff;
  box-shadow:
    0 6px 14px -4px color-mix(in srgb, var(--theme-primary) 55%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
}
.tab-item.is-active span:last-child {
  font-weight: 700;
}

/* ===== 更多宫格项：质感图标瓷片 ===== */
.more-entry {
  color: color-mix(in srgb, var(--theme-text) 72%, transparent);
  -webkit-tap-highlight-color: transparent;
}
.more-entry__icon {
  color: color-mix(in srgb, var(--theme-text) 62%, transparent);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.75), rgba(255, 255, 255, 0.25)),
    color-mix(in srgb, var(--theme-primary) 7%, var(--surface-2));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.75),
    0 3px 8px -3px rgba(15, 23, 42, 0.22);
  transition:
    background-color 0.2s ease,
    color 0.2s ease,
    box-shadow 0.2s ease;
}
.dark .more-entry__icon {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.02)),
    color-mix(in srgb, var(--theme-primary) 10%, var(--surface-2));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    0 3px 8px -3px rgba(0, 0, 0, 0.5);
}
.more-entry:hover {
  background: color-mix(in srgb, var(--theme-text) 5%, transparent);
}
.more-entry:active .more-entry__icon {
  transform: scale(0.94);
}
.more-entry.is-active {
  color: var(--theme-primary);
}
.more-entry.is-active .more-entry__icon {
  background: var(--theme-gradient);
  color: #fff;
  box-shadow:
    0 8px 18px -6px color-mix(in srgb, var(--theme-primary) 60%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
}

/* ===== 过渡动画 ===== */
.btt-fade-enter-active,
.btt-fade-leave-active {
  transition: opacity 0.2s ease;
}
.btt-fade-enter-from,
.btt-fade-leave-to {
  opacity: 0;
}

.btt-pop-enter-active {
  transition:
    opacity 0.24s ease,
    transform 0.24s cubic-bezier(0.34, 1.4, 0.64, 1);
}
.btt-pop-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}
.btt-pop-enter-from,
.btt-pop-leave-to {
  opacity: 0;
  transform: scale(0.92) translateY(10px);
}

@media (prefers-reduced-motion: reduce) {
  .tab-item,
  .tab-item__icon,
  .more-entry,
  .more-entry__icon {
    transition: none;
  }
  .btt-fade-enter-active,
  .btt-fade-leave-active,
  .btt-pop-enter-active,
  .btt-pop-leave-active {
    transition: none;
  }
}
</style>
