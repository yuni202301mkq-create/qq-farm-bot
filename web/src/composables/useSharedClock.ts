import { onScopeDispose, ref } from 'vue'

/**
 * 全局共享的秒级时钟。
 *
 * 背景：土地卡片、倒计时等组件此前每个实例各起一个 `setInterval(..., 1000)`，
 * 几十块地就是几十个定时器，每秒触发几十次组件重渲染，在低端手机上明显掉帧。
 *
 * 这里改成单例：整页只有一个定时器，按订阅引用计数启停；页面切到后台自动停表，
 * 回到前台立即校准一次，避免后台空转耗电。
 */
const now = ref(Date.now())

const TICK_MS = 1000

let timer: ReturnType<typeof setInterval> | null = null
let subscribers = 0
let visibilityBound = false

function tick() {
  now.value = Date.now()
}

function isDocumentVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

function startTimer() {
  if (timer !== null || subscribers <= 0 || !isDocumentVisible())
    return
  tick()
  timer = setInterval(tick, TICK_MS)
}

function stopTimer() {
  if (timer === null)
    return
  clearInterval(timer)
  timer = null
}

function syncTimer() {
  if (subscribers > 0 && isDocumentVisible())
    startTimer()
  else
    stopTimer()
}

function handleVisibilityChange() {
  if (isDocumentVisible())
    tick()
  syncTimer()
}

function bindVisibility() {
  if (visibilityBound || typeof document === 'undefined')
    return
  visibilityBound = true
  document.addEventListener('visibilitychange', handleVisibilityChange)
}

/**
 * 订阅全局共享时钟。返回的 ref 每秒更新一次（毫秒时间戳）。
 * 组件卸载时自动退订，最后一个订阅者退订后定时器会被清理。
 */
export function useSharedClock() {
  subscribers += 1
  bindVisibility()
  syncTimer()

  onScopeDispose(() => {
    subscribers = Math.max(0, subscribers - 1)
    syncTimer()
  })

  return now
}

/** 不订阅、只读取当前时刻，用于事件回调等一次性场景。 */
export function sharedClockNow() {
  return now.value
}
