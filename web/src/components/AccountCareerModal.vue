<script setup lang="ts">
import type { Account } from '@/stores/account'
import { computed, onBeforeUnmount, watch } from 'vue'

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

const harvestedItems = computed(() => (props.items || [])
  .filter(item => Number(item.harvestCount) > 0)
  .sort((a, b) => Number(b.harvestCount) - Number(a.harvestCount)))

const totalHarvest = computed(() => Number(props.profile?.totalHarvestCount ?? harvestedItems.value.reduce((sum, item) => sum + Number(item.harvestCount || 0), 0)))
const topItems = computed(() => harvestedItems.value.slice(0, 3))
const name = computed(() => String(props.profile?.name || props.account?.nick || props.account?.name || '农场主'))
const avatar = computed(() => String(props.profile?.avatar || props.account?.avatar || ''))
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
  if (event.key === 'Escape' && props.show)
    emit('close')
}

watch(() => props.show, (show) => {
  document.body.style.overflow = show ? 'hidden' : ''
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
      <section class="career-panel max-h-[72vh] flex w-[min(84vw,380px)] flex-col overflow-hidden rounded-3xl bg-[#f7f5ef] shadow-2xl dark:bg-gray-900 md:max-h-[min(88vh,820px)] md:w-full md:max-w-2xl">
        <header class="relative flex flex-none items-center gap-3 border-b border-amber-100 px-4 py-3 dark:border-gray-700 sm:px-7 sm:py-5">
          <div class="h-11 w-11 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-amber-100 ring-2 ring-white dark:bg-gray-700 dark:ring-gray-600 sm:h-16 sm:w-16">
            <img v-if="avatar" :src="avatar" :alt="name" class="h-full w-full object-cover">
            <span v-else class="text-xl text-amber-700 font-bold">{{ name.slice(0, 1) }}</span>
          </div>
          <div class="min-w-0">
            <h2 class="truncate text-base text-gray-900 font-bold dark:text-white sm:text-xl">
              {{ name }}
            </h2>
            <div class="mt-1 flex flex-wrap items-center gap-1.5 text-xs sm:mt-2 sm:gap-2 sm:text-sm">
              <span class="rounded-lg bg-amber-100 px-2 py-1 text-amber-700 font-semibold dark:bg-amber-900/30 dark:text-amber-300">Lv.{{ level }}</span>
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

        <div class="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5 md:p-7">
          <div class="mb-3 text-center text-lg text-amber-700 font-bold dark:text-amber-300 sm:mb-4 sm:text-2xl">
            生涯
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
            <div class="grid grid-cols-2 gap-2 sm:gap-3">
              <div class="rounded-2xl bg-white p-3 text-center shadow-sm dark:bg-gray-800 sm:p-4" :title="`精确数量：${formatNumber(totalHarvest)}`">
                <div class="flex items-center justify-center gap-2 text-xs text-orange-600 dark:text-orange-300 sm:text-sm">
                  <img src="/game-config/career/harvest.png" alt="" class="h-7 w-6 object-contain sm:h-9 sm:w-8">
                  <span>历史累计收获</span>
                </div>
                <div class="mt-1 text-xl text-orange-600 font-bold sm:text-2xl">
                  {{ formatCompactNumber(totalHarvest) }}
                </div>
              </div>
              <div class="rounded-2xl bg-white p-3 text-center shadow-sm dark:bg-gray-800 sm:p-4" :title="`精确数量：${formatNumber(totalStealCount)}`">
                <div class="flex items-center justify-center gap-2 text-xs text-rose-600 dark:text-rose-300 sm:text-sm">
                  <img src="/game-config/career/steal.png" alt="" class="h-7 w-7 object-contain sm:h-9 sm:w-9">
                  <span>摘取好友作物</span>
                </div>
                <div class="mt-1 text-xl text-rose-600 font-bold sm:text-2xl">
                  {{ formatCompactNumber(totalStealCount) }}
                </div>
                <div class="mt-0.5 text-[10px] text-gray-400">
                  官方生涯统计
                </div>
              </div>
            </div>

            <div v-if="topItems.length" class="grid grid-cols-3 mt-4 gap-2 border-t border-amber-100 pt-4 dark:border-gray-700 sm:mt-5 sm:gap-3 sm:pt-5">
              <div v-for="(item, index) in topItems" :key="item.seedId" class="text-center">
                <div class="mx-auto mb-1.5 h-6 w-6 flex items-center justify-center rounded-full text-xs text-white font-bold sm:mb-2 sm:h-7 sm:w-7 sm:text-sm" :class="index === 0 ? 'bg-amber-400' : index === 1 ? 'bg-slate-400' : 'bg-orange-400'">
                  {{ index + 1 }}
                </div>
                <div class="mx-auto h-11 w-11 flex items-center justify-center sm:h-16 sm:w-16">
                  <img v-if="item.image" :src="item.image" :alt="item.name" class="max-h-full max-w-full object-contain">
                  <div v-else class="i-carbon-sprout text-3xl text-green-400 sm:text-4xl" />
                </div>
                <div class="mt-1.5 truncate text-xs text-gray-600 dark:text-gray-300 sm:mt-2 sm:text-sm">
                  {{ item.name }}
                </div>
                <div class="text-base text-amber-800 font-bold dark:text-amber-300 sm:text-lg">
                  {{ formatNumber(Number(item.harvestCount)) }}
                </div>
              </div>
            </div>

            <div class="mb-3 mt-5 flex items-baseline gap-2 sm:mt-7">
              <h3 class="text-base text-gray-900 font-bold dark:text-white sm:text-lg">
                收获明细
              </h3>
              <span class="text-xs text-gray-400 sm:text-sm">({{ harvestedItems.length }})</span>
            </div>
            <div v-if="harvestedItems.length" class="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
              <div v-for="item in harvestedItems" :key="item.seedId" class="rounded-xl bg-white p-2 text-center shadow-sm dark:bg-gray-800 sm:p-3">
                <div class="mx-auto h-10 w-10 flex items-center justify-center sm:h-12 sm:w-12">
                  <img v-if="item.image" :src="item.image" :alt="item.name" class="max-h-full max-w-full object-contain">
                  <div v-else class="i-carbon-sprout text-3xl text-green-400" />
                </div>
                <div class="mt-1.5 truncate text-xs text-gray-600 dark:text-gray-300 sm:mt-2">
                  {{ item.name }}
                </div>
                <div class="mt-0.5 text-sm text-gray-900 font-bold dark:text-white">
                  {{ formatNumber(Number(item.harvestCount)) }}
                </div>
              </div>
            </div>
            <div v-else class="rounded-2xl bg-white py-10 text-center text-sm text-gray-400 dark:bg-gray-800 sm:py-12">
              暂无收获记录
            </div>
          </template>
        </div>
      </section>
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
