import { computed, ref, watch } from 'vue'

/**
 * 流畅模式（perf-lite）。
 *
 * 农场页面在移动端卡顿的主因之一是装饰性无限动画：每块地都有金色光环/闪光、冰晶、
 * 爱心、黑化烟雾、水滴、闪电等若干层 `animation: ... infinite`，几十块地叠起来就是
 * 上百个逐帧动画 + `backdrop-filter` 毛玻璃，低端机 GPU 扛不住。
 *
 * 开启后在 <html> 上挂 `.perf-lite`，由 src/style.css 里的降级规则关掉这些重动效
 * （保留静态配色和滤镜，外观基本不变，只是不再动）。
 */

export type PerformancePreference = 'auto' | 'on' | 'off'

const STORAGE_KEY = 'qq-farm-perf-lite'
const CLASS_NAME = 'perf-lite'
const MOBILE_QUERY = '(max-width: 820px)'

function isMobileLike() {
  if (typeof window === 'undefined')
    return false
  if (window.matchMedia?.(MOBILE_QUERY).matches)
    return true
  return /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent || '')
}

function detectNeedsLite() {
  if (typeof window === 'undefined')
    return false
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
  // 系统层面要求减少动效，或用户开了省流量，一律降级
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    return true
  if (nav.connection?.saveData)
    return true
  // 手机/平板默认降级，桌面默认保留完整动效
  return isMobileLike()
}

function readPreference(): PerformancePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'on' || raw === 'off' || raw === 'auto')
      return raw
  }
  catch {
    // localStorage 不可用（隐私模式等）时忽略
  }
  return 'auto'
}

const preference = ref<PerformancePreference>(readPreference())
const autoNeedsLite = ref(detectNeedsLite())

const liteEffects = computed(() =>
  preference.value === 'auto' ? autoNeedsLite.value : preference.value === 'on',
)

watch(
  liteEffects,
  (enabled) => {
    if (typeof document === 'undefined')
      return
    document.documentElement.classList.toggle(CLASS_NAME, enabled)
  },
  { immediate: true },
)

// 桌面浏览器把窗口缩窄、或平板横竖屏切换时重新判定
if (typeof window !== 'undefined') {
  try {
    window.matchMedia?.(MOBILE_QUERY)?.addEventListener?.('change', () => {
      autoNeedsLite.value = detectNeedsLite()
    })
  }
  catch {
    // 老 Safari 不支持 addEventListener，忽略即可（首次判定结果仍然有效）
  }
}

function setPreference(next: PerformancePreference) {
  preference.value = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  }
  catch {
    // 忽略写入失败
  }
}

export function usePerformanceMode() {
  return {
    /** 用户偏好：auto=跟随设备自动判定，on=强制流畅，off=强制完整动效 */
    preference,
    /** 当前是否处于流畅模式 */
    liteEffects,
    /** 自动判定的结果（仅 preference=auto 时生效） */
    autoNeedsLite,
    setPreference,
  }
}
