<script setup lang="ts">
import { useEventListener, useIntervalFn } from '@vueuse/core'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'

export interface StartupAccount {
  id: string
  name?: string
  platform?: string
  /**
   * 打开弹窗时账号上已有的失败时间戳。
   * 重试启动的账号会带着上一次失败留下的 startError，用它区分「旧失败」与
   * 「本次启动产生的新失败」，避免弹窗刚打开就直接跳到「启动失败」。
   */
  startErrorAt?: number
}

const props = defineProps<{
  show: boolean
  account?: StartupAccount | null
}>()

const emit = defineEmits<{
  close: []
}>()

// 后端的新增账号启动是「排队 + 后台执行」，没有细粒度的阶段事件，
// 但有两个可靠的真实信号可以映射成阶段：
//   /api/accounts 里该账号的 running             -> 节点已响应（worker 已创建）
//   /api/status 的 connection.connected === true -> 登录成功
//   /api/accounts 里该账号的 startError 非空      -> 启动失败
// 阶段文案与进度基准值都只由这两个真实信号决定，不编造中间态。
const TICK_INTERVAL_MS = 250
const POLL_INTERVAL_MS = 1500
// 与后端 worker-manager 的 WATCHDOG_TIMEOUT_MS 对齐，作为「预期耗时」参考值
const EXPECTED_TIMEOUT_SEC = 90
const RING_RADIUS = 20
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

// 进度条基准值来自真实信号，与参考视频一致：
//   提交启动请求 -> 8%，节点已响应（worker 已创建）-> 至少 20%。
// 但两个阶段本身没有进度事件，如果只在阶段切换时跳变，等待期间进度条会长时间停在
// 同一个数上看起来像卡死。所以上限随时间渐近抬升，进度条全程实时前进，
// 登录成功时再由 succeed() 收到 100%。
// 上限只逼近 99%，避免还没登录就显示「完成」。
const PROGRESS_SUBMIT_BASE = 8
const PROGRESS_NODE_READY_BASE = 20
const PROGRESS_CEILING = 99
// 上限的时间常数：约 10 秒走完一半、30 秒到 94%
const PROGRESS_CEILING_TAU = 10
// 每 tick 追赶剩余距离的比例与保底步进：保证肉眼可见地动，接近上限时也不停滞
const PROGRESS_STEP_RATIO = 0.25
const PROGRESS_MIN_STEP = 0.05

const phase = ref<'starting' | 'success' | 'failed'>('starting')
const elapsedSec = ref(0)
const errorText = ref('')
// worker 已创建 = 节点已响应，由 /api/accounts 的 running 驱动
const nodeReady = ref(false)
// 当前进度值，只增不减
const progressValue = ref(PROGRESS_SUBMIT_BASE)
// 打开弹窗时账号上已有的失败时间戳：只认比它更新的失败，忽略重试前的旧失败
const startErrorBaseline = ref(0)
let polling = false

const accountId = computed(() => String(props.account?.id || ''))
const accountName = computed(() => props.account?.name || accountId.value || '当前账号')

const progress = computed(() => {
  if (phase.value === 'success')
    return 100
  return Math.min(PROGRESS_CEILING, Math.round(progressValue.value))
})

/** 按时间推进进度：上限随 elapsedSec 渐近抬升，进度值向它逼近且永不回退 */
function advanceProgress() {
  if (phase.value !== 'starting')
    return
  const timeCeiling = PROGRESS_CEILING
    - (PROGRESS_CEILING - PROGRESS_SUBMIT_BASE) * Math.exp(-elapsedSec.value / PROGRESS_CEILING_TAU)
  const stageFloor = nodeReady.value ? PROGRESS_NODE_READY_BASE : PROGRESS_SUBMIT_BASE
  const ceiling = Math.max(stageFloor, timeCeiling)
  const gap = ceiling - progressValue.value
  if (gap <= 0)
    return
  progressValue.value = Math.min(
    PROGRESS_CEILING,
    progressValue.value + Math.max(gap * PROGRESS_STEP_RATIO, PROGRESS_MIN_STEP),
  )
}

const ringOffset = computed(() => RING_CIRCUMFERENCE * (1 - progress.value / 100))

const stageText = computed(() => nodeReady.value
  ? '节点已响应，正在等待游戏登录'
  : '启动请求已提交，正在连接运行节点')

const { pause: pauseTick, resume: resumeTick } = useIntervalFn(() => {
  elapsedSec.value += TICK_INTERVAL_MS / 1000
  advanceProgress()
}, TICK_INTERVAL_MS, { immediate: false })

const { pause: pausePoll, resume: resumePoll } = useIntervalFn(() => { void pollOnce() }, POLL_INTERVAL_MS, { immediate: false })

function stopTimers() {
  pauseTick()
  pausePoll()
}

function succeed() {
  if (phase.value !== 'starting')
    return
  phase.value = 'success'
  stopTimers()
}

function fail(message: string) {
  if (phase.value !== 'starting')
    return
  phase.value = 'failed'
  errorText.value = message
  stopTimers()
}

async function checkStatusSignal() {
  try {
    const { data } = await api.get('/api/status', { headers: { 'x-account-id': accountId.value } })
    if (data?.ok && data.data?.connection?.connected)
      succeed()
  }
  catch {
    // 单次请求失败不影响后续轮询，等待下一个周期重试
  }
}

async function checkAccountSignal() {
  try {
    const { data } = await api.get('/api/accounts')
    const list = data?.data?.accounts
    if (!Array.isArray(list))
      return
    const target = list.find((acc: any) => String(acc?.id) === accountId.value)
    if (!target)
      return
    // worker 已创建 -> 节点已响应，进入等待游戏登录阶段，进度至少抬到 20%
    if (target.running && !nodeReady.value) {
      nodeReady.value = true
      progressValue.value = Math.max(progressValue.value, PROGRESS_NODE_READY_BASE)
    }
    if (target.startError) {
      // 重试启动时账号仍带着上一次失败留下的 startError，只有本次启动之后新产生的
      // 失败才算这次的结果，否则弹窗会在刚打开时就直接跳到「启动失败」。
      const errorAt = Number(target.startErrorAt || 0)
      if (errorAt > startErrorBaseline.value)
        fail(String(target.startError))
    }
  }
  catch {
    // 同上
  }
}

async function pollOnce() {
  if (!props.show || !accountId.value || phase.value !== 'starting' || polling)
    return
  polling = true
  try {
    await checkStatusSignal()
    if (phase.value !== 'starting')
      return
    await checkAccountSignal()
  }
  finally {
    polling = false
  }
}

function startFlow() {
  phase.value = 'starting'
  elapsedSec.value = 0
  errorText.value = ''
  nodeReady.value = false
  progressValue.value = PROGRESS_SUBMIT_BASE
  startErrorBaseline.value = Number(props.account?.startErrorAt || 0)
  stopTimers()
  resumeTick()
  resumePoll()
  void pollOnce()
}

function handleClose() {
  stopTimers()
  emit('close')
}

watch(
  () => [props.show, accountId.value] as const,
  ([visible]) => {
    if (visible && accountId.value)
      startFlow()
    else
      stopTimers()
  },
  { immediate: true },
)

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.show)
    handleClose()
})

onBeforeUnmount(stopTimers)
</script>

<template>
  <div
    v-if="show"
    class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4"
    @click.self="handleClose"
  >
    <div class="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl shadow-xl" :style="{ background: 'var(--theme-bg)' }">
      <!-- 启动中 -->
      <template v-if="phase === 'starting'">
        <div class="flex items-center gap-4 p-5">
          <div class="relative h-12 w-12 shrink-0">
            <svg viewBox="0 0 48 48" class="h-12 w-12 -rotate-90">
              <circle
                cx="24" cy="24" :r="RING_RADIUS" fill="none" stroke-width="4"
                :stroke="'color-mix(in srgb, var(--theme-text) 12%, transparent)'"
              />
              <circle
                cx="24" cy="24" :r="RING_RADIUS" fill="none" stroke-width="4" stroke-linecap="round"
                :stroke="'var(--theme-primary)'"
                :stroke-dasharray="RING_CIRCUMFERENCE"
                :stroke-dashoffset="ringOffset"
                class="transition-[stroke-dashoffset] duration-300 ease-out"
              />
            </svg>
            <span class="absolute inset-0 flex items-center justify-center">
              <span class="h-2 w-2 animate-pulse rounded-full" :style="{ background: 'var(--theme-primary)' }" />
            </span>
          </div>
          <div class="min-w-0">
            <span
              class="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
              :style="{ background: 'color-mix(in srgb, var(--theme-primary) 16%, transparent)', color: 'var(--theme-primary)' }"
            >
              正在启动
            </span>
            <h3 class="mt-1 text-xl text-gray-900 font-bold dark:text-gray-100">
              账号启动中
            </h3>
            <p class="mt-0.5 truncate text-sm text-gray-500 dark:text-gray-400">
              {{ accountName }}
            </p>
          </div>
        </div>

        <div class="border-t px-5 py-4" :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 10%, transparent)' }">
          <div class="mb-2 flex items-center justify-between text-sm">
            <span class="text-gray-600 dark:text-gray-300">登录检测进度</span>
            <span class="font-semibold tabular-nums" :style="{ color: 'var(--theme-primary)' }">{{ progress }}%</span>
          </div>
          <div class="h-2 w-full overflow-hidden rounded-full" :style="{ background: 'color-mix(in srgb, var(--theme-text) 12%, transparent)' }">
            <div
              class="h-full rounded-full transition-[width] duration-300 ease-out"
              :style="{ width: `${progress}%`, background: 'var(--theme-primary)' }"
            />
          </div>

          <div
            class="mt-4 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm"
            :style="{ background: 'color-mix(in srgb, var(--theme-text) 6%, transparent)' }"
          >
            <span class="flex min-w-0 items-center gap-2">
              <span class="h-1.5 w-1.5 shrink-0 rounded-full" :style="{ background: 'var(--theme-primary)' }" />
              <span class="truncate text-gray-600 dark:text-gray-300">{{ stageText }}</span>
            </span>
            <span class="shrink-0 text-gray-500 tabular-nums dark:text-gray-400">
              {{ Math.floor(elapsedSec) }} / {{ EXPECTED_TIMEOUT_SEC }} 秒
            </span>
          </div>
        </div>
      </template>

      <!-- 启动结束：成功 / 失败 -->
      <div v-else class="p-5">
        <div class="flex items-start gap-3">
          <span
            class="h-9 w-9 flex shrink-0 items-center justify-center rounded-full"
            :style="{ background: phase === 'success' ? 'rgb(34 197 94)' : 'rgb(239 68 68)' }"
          >
            <div :class="phase === 'success' ? 'i-carbon-checkmark' : 'i-carbon-close'" class="text-xl text-white" />
          </span>
          <div class="min-w-0">
            <h3 class="text-xl text-gray-900 font-bold dark:text-gray-100">
              {{ phase === 'success' ? '账号启动成功' : '账号启动失败' }}
            </h3>
            <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {{ phase === 'success' ? '网站已经开始托管' : '未能完成托管' }}
            </p>
          </div>
        </div>

        <p class="mt-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          {{ phase === 'success'
            ? '当前账号已经由网站保持在线，并开始执行已开启的自动化任务。'
            : (errorText || '启动过程中出现异常，请稍后在账号列表重新获取并启动。') }}
        </p>

        <div
          v-if="phase === 'success'"
          class="mt-4 rounded-xl border p-4"
          :style="{ background: 'rgba(239, 68, 68, 0.07)', borderColor: 'rgba(239, 68, 68, 0.3)' }"
        >
          <div class="flex items-start gap-3">
            <span class="h-6 w-6 flex shrink-0 items-center justify-center rounded-full" :style="{ background: 'rgba(239, 68, 68, 0.15)' }">
              <div class="i-carbon-warning-alt text-sm text-red-500" />
            </span>
            <div class="min-w-0">
              <p class="text-sm text-red-500 font-semibold">
                重要提醒
              </p>
              <p class="mt-1 text-base text-red-500 font-semibold">
                托管期间不能自己登录农场游戏
              </p>
              <p class="mt-1 text-sm leading-relaxed text-red-400">
                否则当前托管账号会被挤下线，已经开启的自动化任务也会停止。
              </p>
            </div>
          </div>
        </div>

        <div class="mt-5 flex justify-end">
          <BaseButton variant="primary" @click="handleClose">
            {{ phase === 'success' ? '我知道了' : '关闭' }}
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
