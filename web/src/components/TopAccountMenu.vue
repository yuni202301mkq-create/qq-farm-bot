<script setup lang="ts">
import type { Account } from '@/stores/account'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import api from '@/api'
import AccountCareerModal from '@/components/AccountCareerModal.vue'
import AccountModal from '@/components/AccountModal.vue'
import AccountStartupModal from '@/components/AccountStartupModal.vue'
import RemarkModal from '@/components/RemarkModal.vue'
import { getPlatformClass, getPlatformLabel, useAccountStore } from '@/stores/account'
import { useStatusStore } from '@/stores/status'
import { accountAvatarUrl } from '@/utils/avatar'

const accountStore = useAccountStore()
const statusStore = useStatusStore()
const { accounts, currentAccount } = storeToRefs(accountStore)
const { currentStatusReady, status } = storeToRefs(statusStore)

const showAccountDropdown = ref(false)
const showAccountModal = ref(false)
const showRemarkModal = ref(false)
const showCareerModal = ref(false)
const careerLoading = ref(false)
const careerError = ref('')
const careerItems = ref<any[]>([])
const careerProfile = ref<Record<string, any>>({})
const accountToEdit = ref<any>(null)
// 顶部菜单新增账号后，驱动启动进度弹窗；编辑账号保持 null
const startupAccount = ref<{ id: string, name?: string, platform?: string } | null>(null)
const failedAvatars = ref(new Set<string>())

const triggerRef = useTemplateRef<HTMLElement>('trigger')
const dropdownPos = ref({ top: 0, left: 0, width: 320 })

function onScroll() {
  if (showAccountDropdown.value) {
    updateDropdownPos()
  }
}

function onResize() {
  if (showAccountDropdown.value) {
    updateDropdownPos()
  }
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onResize)
})

const platform = computed(() => getPlatformLabel(currentAccount.value?.platform))

function cleanText(value: unknown) {
  return String(value || '').trim()
}

function liveAccountName() {
  if (!currentStatusReady.value)
    return ''
  const name = cleanText(status.value?.status?.name)
  return name && name !== '未登录' ? name : ''
}

function accountDisplayName(acc?: Account | null) {
  if (!acc)
    return '选择账号'

  const liveName = currentAccount.value?.id === acc.id ? liveAccountName() : ''
  const nick = cleanText(liveName || acc.nick)
  const remark = cleanText(acc.name)
  if (nick && remark && nick !== remark)
    return `${nick} (${remark})`
  if (nick)
    return nick
  if (remark)
    return remark
  return cleanText(acc.uin || acc.qq || acc.id) || '选择账号'
}

function accountSubtitle(acc?: Account | null) {
  if (!acc)
    return ''
  return cleanText(acc.uin || acc.qq || acc.id)
}

// 头像统一走后端代理（同源 /api/avatar/:id）：腾讯 qlogo.cn 对非 QQ 来源 Referer
// 返回 0 字节占位图，生产 CSP img-src 也只放行同源；代理会带 Referer: https://im.qq.com/。
// uin 兜底也由后端做（acc.uin / acc.qq → q1.qlogo.cn）。
function avatarSource(acc?: Account | null) {
  return accountAvatarUrl(acc)
}

function avatarKey(acc?: Account | null) {
  return cleanText(acc?.id || acc?.uin || acc?.qq || acc?.wxid || '')
}

function shouldShowAvatar(acc?: Account | null) {
  const key = avatarKey(acc)
  return !!avatarSource(acc) && !!key && !failedAvatars.value.has(key)
}

function markAvatarFailed(acc?: Account | null) {
  const key = avatarKey(acc)
  if (!key)
    return
  const next = new Set(failedAvatars.value)
  next.add(key)
  failedAvatars.value = next
}

function avatarInitial(acc?: Account | null) {
  return accountDisplayName(acc).replace(/[()（）\s]/g, '').slice(0, 1) || '账'
}

async function loadCareer() {
  const accountId = cleanText(currentAccount.value?.id)
  if (!accountId)
    return
  careerLoading.value = true
  careerError.value = ''
  try {
    const { data } = await api.get('/api/career', {
      headers: { 'x-account-id': accountId },
    })
    if (!data?.ok)
      throw new Error(data?.error || '生涯记录读取失败')
    careerProfile.value = data.data || {}
    careerItems.value = data.data?.items || []
  }
  catch (error: any) {
    careerError.value = error?.response?.data?.error || error?.message || '生涯记录读取失败'
  }
  finally {
    careerLoading.value = false
  }
}

function openCareer(event?: Event) {
  event?.stopPropagation()
  if (!currentAccount.value)
    return
  closeDropdown()
  showCareerModal.value = true
  loadCareer()
}

const displayName = computed(() => accountDisplayName(currentAccount.value))
const currentAvatarSrc = computed(() => avatarSource(currentAccount.value))
const currentSubtitle = computed(() => accountSubtitle(currentAccount.value))

async function openDropdown() {
  updateDropdownPos()
  showAccountDropdown.value = true
  await nextTick()
  updateDropdownPos()
}

function closeDropdown() {
  showAccountDropdown.value = false
}

function toggleDropdown() {
  if (showAccountDropdown.value) {
    closeDropdown()
    return
  }
  openDropdown()
}

function updateDropdownPos() {
  const el = triggerRef.value
  if (!el)
    return

  const rect = el.getBoundingClientRect()
  const viewportGap = 8
  const width = Math.min(320, window.innerWidth - viewportGap * 2)
  const left = Math.min(
    Math.max(viewportGap, rect.right - width),
    window.innerWidth - width - viewportGap,
  )

  dropdownPos.value = {
    top: rect.bottom + viewportGap,
    left,
    width,
  }
}

function selectAccount(acc: any) {
  accountStore.setCurrentAccount(acc)
  closeDropdown()
}

function openAddAccount() {
  accountToEdit.value = null
  showAccountModal.value = true
  closeDropdown()
}

function openRemarkModal(acc: any) {
  accountToEdit.value = acc
  showRemarkModal.value = true
  closeDropdown()
}

async function handleAccountSaved(payload?: { created?: { id?: string, name?: string, platform?: string } | null }) {
  showAccountModal.value = false
  showRemarkModal.value = false
  accountToEdit.value = null
  // 新增账号（后端已排队后台启动）才弹启动进度；改备注/编辑账号不会带 created。
  // 必须先置状态再刷新列表：fetchAccounts 是网络请求，放在前面会让弹窗晚几百毫秒才出现。
  const created = payload?.created
  if (created?.id) {
    startupAccount.value = {
      id: String(created.id),
      name: created.name,
      platform: created.platform,
    }
  }
  await accountStore.fetchAccounts()
}
</script>

<template>
  <div class="relative">
    <button
      ref="trigger"
      class="max-w-[min(76vw,280px)] flex items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-gray-100/70 dark:hover:bg-gray-700/50"
      @click="toggleDropdown"
    >
      <span
        class="h-12 w-12 flex shrink-0 cursor-pointer items-center justify-center rounded-full -m-1.5"
        role="button"
        tabindex="0"
        aria-label="查看角色生涯"
        title="查看角色生涯"
        @click="openCareer"
        @keydown.enter.prevent="openCareer"
      >
        <div class="h-9 w-9 flex items-center justify-center overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200 transition dark:bg-gray-700 hover:ring-2 dark:ring-gray-600 hover:ring-[var(--theme-primary)]">
          <img
            v-if="shouldShowAvatar(currentAccount)"
            :src="currentAvatarSrc"
            :alt="displayName"
            class="h-full w-full object-cover"
            @error="markAvatarFailed(currentAccount)"
          >
          <span v-else class="text-sm text-gray-500 font-semibold dark:text-gray-300">
            {{ avatarInitial(currentAccount) }}
          </span>
        </div>
      </span>
      <div class="min-w-0 flex flex-col">
        <span class="truncate text-sm text-gray-900 font-semibold dark:text-gray-100">
          {{ displayName }}
        </span>
        <span class="mt-0.5 flex items-center gap-1.5 text-xs text-gray-400">
          <span
            v-if="platform"
            class="rounded px-1 py-0.2 text-[10px] font-medium leading-tight"
            :class="getPlatformClass(currentAccount?.platform)"
          >
            {{ platform }}
          </span>
          <span v-if="currentSubtitle" class="truncate">{{ currentSubtitle }}</span>
        </span>
      </div>
      <div
        class="i-carbon-chevron-down shrink-0 text-gray-400 transition-transform duration-200"
        :class="{ 'rotate-180': showAccountDropdown }"
      />
    </button>

    <Teleport to="body">
      <div
        v-if="showAccountDropdown"
        class="fixed inset-0 z-[9998] bg-transparent"
        @click="closeDropdown"
      />

      <div
        v-if="showAccountDropdown"
        class="fixed z-[9999] overflow-hidden border border-gray-200/70 rounded-xl bg-white/95 py-1 shadow-xl backdrop-blur-sm dark:border-gray-700/70 dark:bg-gray-900/95"
        :style="{ top: `${dropdownPos.top}px`, left: `${dropdownPos.left}px`, width: `${dropdownPos.width}px` }"
      >
        <div class="custom-scrollbar max-h-72 overflow-y-auto">
          <template v-if="accounts.length > 0">
            <button
              v-for="acc in accounts"
              :key="acc.id || acc.uin"
              class="w-full flex items-center gap-3 px-4 py-2 transition-colors hover:bg-gray-100/60 dark:hover:bg-gray-700/50"
              :style="{ backgroundColor: currentAccount?.id === acc.id ? 'color-mix(in srgb, var(--theme-primary) 10%, transparent)' : undefined }"
              @click="selectAccount(acc)"
            >
              <div class="h-7 w-7 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
                <img
                  v-if="shouldShowAvatar(acc)"
                  :src="avatarSource(acc)"
                  :alt="accountDisplayName(acc)"
                  class="h-full w-full object-cover"
                  @error="markAvatarFailed(acc)"
                >
                <span v-else class="text-xs text-gray-500 font-semibold dark:text-gray-300">
                  {{ avatarInitial(acc) }}
                </span>
              </div>
              <div class="min-w-0 flex flex-1 flex-col items-start">
                <span class="w-full truncate text-left text-sm font-medium">
                  {{ accountDisplayName(acc) }}
                </span>
                <div class="flex items-center gap-1.5">
                  <span
                    v-if="getPlatformLabel(acc.platform)"
                    class="rounded px-1 py-0.2 text-[10px] font-medium leading-tight"
                    :class="getPlatformClass(acc.platform)"
                  >
                    {{ getPlatformLabel(acc.platform) }}
                  </span>
                  <span v-if="accountSubtitle(acc)" class="text-xs text-gray-400">{{ accountSubtitle(acc) }}</span>
                </div>
              </div>
              <button
                class="rounded-full p-1 text-gray-400 transition-colors hover:bg-blue-50/50 hover:text-blue-500 dark:hover:bg-blue-900/20"
                title="修改备注"
                @click.stop="openRemarkModal(acc)"
              >
                <div class="i-carbon-edit" />
              </button>
              <div v-if="currentAccount?.id === acc.id" class="i-carbon-checkmark shrink-0" :style="{ color: 'var(--theme-primary)' }" />
            </button>
          </template>
          <div v-else class="px-4 py-3 text-center text-sm text-gray-400">
            暂无账号
          </div>
        </div>
        <div class="mt-1 border-t border-gray-100 pt-1 dark:border-gray-700">
          <button
            class="w-full flex items-center gap-2 px-4 py-2.5 text-sm transition-colors hover:bg-gray-100/50 dark:hover:bg-gray-700/50"
            :style="{ color: 'var(--theme-primary)' }"
            @click="openCareer()"
          >
            <div class="i-carbon-chart-histogram" />
            <span>角色生涯</span>
          </button>
          <button
            class="w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-gray-100/50 dark:hover:bg-gray-700/50"
            :style="{ color: 'var(--theme-primary)' }"
            @click="openAddAccount"
          >
            <div class="i-carbon-add" />
            <span>添加账号</span>
          </button>
          <router-link
            to="/settings"
            class="w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-gray-100/50 dark:hover:bg-gray-700/50"
            :style="{ color: 'var(--theme-primary)' }"
            @click="closeDropdown"
          >
            <div class="i-carbon-add-alt" />
            <span>管理账号</span>
          </router-link>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <AccountModal
        :show="showAccountModal"
        :edit-data="accountToEdit"
        @close="showAccountModal = false; accountToEdit = null"
        @saved="handleAccountSaved"
      />

      <AccountStartupModal
        :show="!!startupAccount"
        :account="startupAccount"
        @close="startupAccount = null"
      />

      <RemarkModal
        :show="showRemarkModal"
        :account="accountToEdit"
        @close="showRemarkModal = false"
        @saved="handleAccountSaved"
      />

      <AccountCareerModal
        :show="showCareerModal"
        :account="currentAccount"
        :profile="careerProfile"
        :items="careerItems"
        :loading="careerLoading"
        :error="careerError"
        @close="showCareerModal = false"
        @refresh="loadCareer"
      />
    </Teleport>
  </div>
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
</style>
