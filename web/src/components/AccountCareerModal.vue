<script setup lang="ts">
import type { Account } from '@/stores/account'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { accountAvatarUrl, remoteAvatarUrl } from '@/utils/avatar'

interface CareerItem {
  seedId: number
  name: string
  image?: string
  harvestCount?: number
}

const props = defineProps<{
  show: boolean
  account?: Account | null
  profile?: Record<string, any> | null
  items?: CareerItem[]
  loading?: boolean
  error?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'refresh'): void
}>()

const avatarPreview = ref(false)

const harvestedItems = computed(() => (props.items || [])
  .filter(item => Number(item.harvestCount) > 0)
  .sort((a, b) => Number(b.harvestCount) - Number(a.harvestCount)))

const totalHarvest = computed(() => Number(props.profile?.totalHarvestCount ?? harvestedItems.value.reduce((sum, item) => sum + Number(item.harvestCount || 0), 0)))
const topItems = computed(() => harvestedItems.value.slice(0, 3))
const name = computed(() => String(props.profile?.name || props.account?.nick || props.account?.name || '农场主'))
// 头像统一走同源代理：远程头像 URL 编码代理，兜底按账号 id 取后端代理头像
const avatar = computed(() =>
  remoteAvatarUrl(props.profile?.avatar || props.account?.avatar) || accountAvatarUrl(props.account))
const level = computed(() => Number(props.profile?.level || 0))
const exp = computed(() => Number(props.profile?.exp || 0))
const gid = computed(() => String(props.profile?.gid || ''))
const totalStealCount = computed(() => Number(props.profile?.totalStealCount || 0))

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(Number(value || 0))
}

function formatCompactNumber(value: number) {
  const numericValue = Number(value || 0)
  const units = [
    { threshold: 100000000, divisor: 100000000, suffix: '亿' },
    { threshold: 10000000, divisor: 10000000, suffix: '千万' },
    { threshold: 1000000, divisor: 1000000, suffix: '百万' },
    { threshold: 10000, divisor: 10000, suffix: '万' },
    { threshold: 1000, divisor: 1000, suffix: '千' },
  ]
  const unit = units.find(item => Math.abs(numericValue) >= item.threshold)
  if (!unit)
    return formatNumber(numericValue)
  const compactValue = numericValue / unit.divisor
  const digits = compactValue >= 100 ? 0 : 1
  // 注意：不能使用正则后行断言 (?<=...)，iOS Safari < 16.4 / 微信内置浏览器不支持，
  // 会抛出 "Invalid regular expression: invalid group specifier name"
  const text = compactValue.toFixed(digits)
    .replace(/(\.\d)0+$/, '$1') // 100.50 -> 100.5
    .replace(/\.0$/, '') // 100.0 -> 100
  return `${text}${unit.suffix}`
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.show) {
    if (avatarPreview.value)
      avatarPreview.value = false
    else
      emit('close')
  }
}

watch(() => props.show, (show) => {
  document.body.style.overflow = show ? 'hidden' : ''
  if (!show)
    avatarPreview.value = false
  if (show)
    window.addEventListener('keydown', onKeydown)
  else
    window.removeEventListener('keydown', onKeydown)
}, { immediate: true })

onBeforeUnmount(() => {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Transition name="career-fade">
    <div v-if="show" class="fixed inset-0 z-[10020] flex items-center justify-center bg-black/45 p-3 backdrop-blur-sm" @click.self="emit('close')">
      <section class="career-panel relative max-h-[72vh] w-[min(84vw,380px)] flex flex-col overflow-hidden rounded-3xl bg-gradient-to-b from-[#fdfaf2] to-[#f4eddc] shadow-2xl md:max-h-[min(88vh,820px)] md:max-w-2xl md:w-full dark:border dark:border-amber-500/15 dark:from-[#232030] dark:via-[#1c1928] dark:to-gray-900">
        <!-- 顶部氛围光 -->
        <div class="pointer-events-none absolute -top-20 left-1/2 h-44 w-72 -translate-x-1/2 rounded-full bg-amber-400/15 blur-3xl sm:h-56 sm:w-96" />
        <div class="pointer-events-none absolute -left-16 top-24 h-36 w-36 rounded-full bg-orange-400/10 blur-3xl" />
        <div class="pointer-events-none absolute -right-16 top-32 h-36 w-36 rounded-full bg-rose-400/10 blur-3xl" />

        <header class="relative flex flex-none items-center gap-3 border-b border-amber-100/80 bg-gradient-to-r from-amber-400/10 via-transparent to-rose-400/10 px-4 py-3 dark:border-gray-700/80 sm:px-7 sm:py-5">
          <div
            class="h-11 w-11 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-amber-100 shadow-lg shadow-amber-500/20 ring-2 ring-white transition sm:h-16 sm:w-16 dark:bg-gray-700 dark:shadow-black/40 dark:ring-gray-600"
            :class="avatar ? 'cursor-zoom-in hover:ring-amber-300' : ''"
            :title="avatar ? '点击查看大图' : ''"
            @click="avatar && (avatarPreview = true)"
          >
            <img v-if="avatar" :src="avatar" :alt="name" class="h-full w-full object-cover">
            <span v-else class="text-xl text-amber-700 font-bold">{{ name.slice(0, 1) }}</span>
          </div>
          <div class="min-w-0">
            <h2 class="truncate text-base text-gray-900 font-bold sm:text-xl dark:text-white">
              {{ name }}
            </h2>
            <div class="mt-1 flex flex-wrap items-center gap-1.5 text-xs sm:mt-2 sm:gap-2 sm:text-sm">
              <span class="rounded-lg bg-gradient-to-r from-amber-400/25 to-orange-400/25 px-2 py-1 text-amber-700 font-semibold dark:bg-gradient-to-r dark:from-amber-500/25 dark:to-orange-500/25 dark:text-amber-300">Lv.{{ level }}</span>
              <span class="rounded-lg bg-blue-50 px-2 py-1 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">经验 {{ formatNumber(exp) }}</span>
            </div>
            <p v-if="gid" class="mt-1 text-xs text-gray-400 sm:mt-2">
              角色编号：{{ gid }}
            </p>
          </div>
          <button class="absolute right-3 top-3 h-8 w-8 flex items-center justify-center rounded-full text-gray-400 transition hover:bg-black/5 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-white" aria-label="关闭" @click="emit('close')">
            <div class="i-carbon-close text-xl sm:text-2xl" />
          </button>
        </header>

        <div class="custom-scrollbar relative min-h-0 flex-1 overflow-y-auto p-4 md:p-7 sm:p-5">
          <div class="mb-3 flex items-center justify-center gap-3 sm:mb-4">
            <span class="h-px w-10 bg-gradient-to-r from-transparent to-amber-400/60 sm:w-16" />
            <span class="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-lg font-extrabold tracking-widest text-transparent sm:text-2xl dark:from-amber-300 dark:to-orange-300">生涯</span>
            <span class="h-px w-10 bg-gradient-to-l from-transparent to-amber-400/60 sm:w-16" />
          </div>

          <div v-if="loading" class="h-56 flex flex-col items-center justify-center gap-3 text-gray-400">
            <div class="i-carbon-circle-dash animate-spin text-3xl" />
            <span>正在读取角色生涯...</span>
          </div>

          <div v-else-if="error" class="h-48 flex flex-col items-center justify-center gap-3 text-center">
            <div class="i-carbon-warning-alt text-3xl text-amber-500" />
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {{ error }}
            </p>
            <button class="rounded-lg bg-amber-500 px-4 py-2 text-sm text-white hover:bg-amber-600" @click="emit('refresh')">
              重新加载
            </button>
          </div>

          <template v-else>
            <!-- 核心统计 -->
            <div class="grid grid-cols-2 gap-2 sm:gap-4">
              <div
                class="relative overflow-hidden rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-500/15 via-orange-500/8 to-transparent p-3 sm:p-5"
                :title="`精确数量：${formatNumber(totalHarvest)}`"
              >
                <div class="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-amber-400/20 blur-2xl sm:h-24 sm:w-24" />
                <div class="flex items-center gap-2">
                  <div class="h-8 w-8 flex flex-none items-center justify-center rounded-xl bg-amber-400/20 sm:h-10 sm:w-10">
                    <img src="/game-config/career/harvest.png" alt="" class="h-6 w-5 object-contain sm:h-8 sm:w-7">
                  </div>
                  <span class="text-xs text-amber-600/90 font-medium sm:text-sm dark:text-amber-300/90">历史累计收获</span>
                </div>
                <div class="mt-2 bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-right text-2xl font-extrabold text-transparent tabular-nums sm:mt-3 sm:text-3xl">
                  {{ formatCompactNumber(totalHarvest) }}
                </div>
              </div>
              <div
                class="relative overflow-hidden rounded-2xl border border-rose-400/25 bg-gradient-to-br from-rose-500/15 via-pink-500/8 to-transparent p-3 sm:p-5"
                :title="`精确数量：${formatNumber(totalStealCount)}`"
              >
                <div class="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-rose-400/20 blur-2xl sm:h-24 sm:w-24" />
                <div class="flex items-center gap-2">
                  <div class="h-8 w-8 flex flex-none items-center justify-center rounded-xl bg-rose-400/20 sm:h-10 sm:w-10">
                    <img src="/game-config/career/steal.png" alt="" class="h-6 w-6 object-contain sm:h-8 sm:w-8">
                  </div>
                  <span class="text-xs text-rose-600/90 font-medium sm:text-sm dark:text-rose-300/90">摘取好友作物</span>
                </div>
                <div class="mt-2 bg-gradient-to-r from-rose-500 to-pink-500 bg-clip-text text-right text-2xl font-extrabold text-transparent tabular-nums sm:mt-3 sm:text-3xl">
                  {{ formatCompactNumber(totalStealCount) }}
                </div>
                <div class="mt-0.5 text-right text-[10px] text-gray-400">
                  官方生涯统计
                </div>
              </div>
            </div>

            <!-- 收获三甲（领奖台） -->
            <div v-if="topItems.length" class="mt-4 rounded-2xl border border-gray-200/70 bg-white/60 p-4 sm:mt-5 sm:p-6 dark:border-gray-700/60 dark:bg-gray-800/40">
              <div class="mb-3 flex items-center justify-center gap-2 sm:mb-4">
                <div class="i-fas-trophy text-amber-400" />
                <span class="text-sm text-gray-500 font-semibold tracking-wide sm:text-base dark:text-gray-400">收获三甲</span>
              </div>
              <div class="flex items-end justify-center gap-3 sm:gap-6">
                <div
                  v-for="(item, index) in topItems"
                  :key="item.seedId"
                  class="flex w-1/3 max-w-32 flex-col items-center"
                  :class="index === 0 ? 'order-2' : index === 1 ? 'order-1' : 'order-3'"
                >
                  <div
                    class="mb-1.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white shadow-md sm:mb-2 sm:h-7 sm:w-7 sm:text-sm"
                    :class="index === 0
                      ? 'bg-gradient-to-br from-amber-300 to-amber-500 shadow-amber-500/40'
                      : index === 1
                        ? 'bg-gradient-to-br from-slate-300 to-slate-500 shadow-slate-500/40'
                        : 'bg-gradient-to-br from-orange-300 to-orange-500 shadow-orange-500/40'"
                  >
                    {{ index + 1 }}
                  </div>
                  <div class="h-12 w-12 flex items-center justify-center drop-shadow-lg sm:h-16 sm:w-16">
                    <img v-if="item.image" :src="item.image" :alt="item.name" class="max-h-full max-w-full object-contain">
                    <div v-else class="i-carbon-sprout text-3xl text-green-400 sm:text-4xl" />
                  </div>
                  <div class="mt-1.5 w-full max-w-full truncate text-center text-xs text-gray-600 sm:mt-2 sm:text-sm dark:text-gray-300">
                    {{ item.name }}
                  </div>
                  <div
                    class="mt-1 flex w-full items-end justify-center rounded-t-lg border-t border-x"
                    :class="index === 0
                      ? 'h-14 border-amber-400/50 bg-gradient-to-b from-amber-400/25 to-amber-400/5 sm:h-20'
                      : index === 1
                        ? 'h-10 border-slate-400/50 bg-gradient-to-b from-slate-400/25 to-slate-400/5 sm:h-14'
                        : 'h-7 border-orange-400/50 bg-gradient-to-b from-orange-400/25 to-orange-400/5 sm:h-10'"
                  >
                    <span class="mb-1 text-xs font-bold tabular-nums sm:text-sm" :class="index === 0 ? 'text-amber-600 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'">
                      {{ formatNumber(Number(item.harvestCount)) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 收获明细 -->
            <div class="mb-3 mt-5 flex items-baseline gap-2 sm:mt-7">
              <h3 class="text-base text-gray-900 font-bold sm:text-lg dark:text-white">
                收获明细
              </h3>
              <span class="text-xs text-gray-400 sm:text-sm">({{ harvestedItems.length }})</span>
            </div>
            <div v-if="harvestedItems.length" class="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
              <div
                v-for="item in harvestedItems"
                :key="item.seedId"
                class="group relative overflow-hidden rounded-xl border border-gray-200/70 bg-white p-2.5 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-400/50 hover:shadow-lg hover:shadow-amber-500/10 dark:border-gray-700/60 dark:bg-gray-800 sm:p-3"
              >
                <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                <div class="relative mx-auto h-10 w-10 flex items-center justify-center rounded-lg bg-gradient-to-b from-green-500/10 to-transparent sm:h-12 sm:w-12">
                  <img v-if="item.image" :src="item.image" :alt="item.name" class="max-h-full max-w-full object-contain drop-shadow-md">
                  <div v-else class="i-carbon-sprout text-3xl text-green-400" />
                </div>
                <div class="mt-1.5 truncate text-xs text-gray-600 sm:mt-2 dark:text-gray-300">
                  {{ item.name }}
                </div>
                <div class="mt-0.5 text-sm text-gray-900 font-bold tabular-nums dark:text-white">
                  {{ formatNumber(Number(item.harvestCount)) }}
                </div>
                <div class="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                  <div
                    class="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500"
                    :style="{ width: `${Math.max(4, Math.round(Number(item.harvestCount) / Math.max(1, Number(harvestedItems[0]?.harvestCount) || 1)) * 100)}%` }"
                  />
                </div>
              </div>
            </div>
            <div v-else class="rounded-2xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-800/40 sm:py-12">
              暂无收获记录
            </div>
          </template>
        </div>
      </section>

      <!-- 头像大图预览 -->
      <div
        v-if="avatarPreview && avatar"
        class="fixed inset-0 z-[10030] flex items-center justify-center bg-black/75 p-6"
        @click="avatarPreview = false"
      >
        <img :src="avatar" :alt="name" class="max-h-full max-w-full rounded-2xl object-contain shadow-2xl">
        <button
          class="absolute right-4 top-4 h-10 w-10 flex items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          aria-label="关闭预览"
          @click.stop="avatarPreview = false"
        >
          <div class="i-carbon-close text-2xl" />
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.career-fade-enter-active,
.career-fade-leave-active {
  transition: opacity 0.18s ease;
}
.career-fade-enter-from,
.career-fade-leave-to {
  opacity: 0;
}
.custom-scrollbar::-webkit-scrollbar {
  width: 5px;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgb(156 163 175 / 45%);
}
</style>
