import { useIntervalFn } from '@vueuse/core'
import { computed, ref } from 'vue'
import solarlunar from 'solarlunar'

/**
 * 纪念日提醒：扫描今天起 30 天内最近的纪念日（公历节日 + 农历节日 + 重要纪念日），
 * 生成「最近的纪念日是：2026年9月18日(八月初八)，九一八事变纪念日，还有1天」文案，
 * 展示在顶栏品牌区副标题位置；30 天内没有任何纪念日时为空串（不显示）。
 */

interface MemorialDay {
  name: string
  /** 公历月/日；lunar=true 时表示农历月/日 */
  month: number
  day: number
  lunar?: boolean
}

const SOLAR_MEMORIALS: MemorialDay[] = [
  { name: '元旦', month: 1, day: 1 },
  { name: '妇女节', month: 3, day: 8 },
  { name: '植树节', month: 3, day: 12 },
  { name: '劳动节', month: 5, day: 1 },
  { name: '青年节', month: 5, day: 4 },
  { name: '儿童节', month: 6, day: 1 },
  { name: '建党节', month: 7, day: 1 },
  { name: '建军节', month: 8, day: 1 },
  { name: '教师节', month: 9, day: 10 },
  { name: '九一八事变纪念日', month: 9, day: 18 },
  { name: '烈士纪念日', month: 9, day: 30 },
  { name: '国庆节', month: 10, day: 1 },
  { name: '南京大屠杀死难者国家公祭日', month: 12, day: 13 },
  { name: '澳门回归纪念日', month: 12, day: 20 },
]

const LUNAR_MEMORIALS: MemorialDay[] = [
  { name: '春节', month: 1, day: 1, lunar: true },
  { name: '元宵节', month: 1, day: 15, lunar: true },
  { name: '龙抬头', month: 2, day: 2, lunar: true },
  { name: '端午节', month: 5, day: 5, lunar: true },
  { name: '七夕节', month: 7, day: 7, lunar: true },
  { name: '中秋节', month: 8, day: 15, lunar: true },
  { name: '重阳节', month: 9, day: 9, lunar: true },
  { name: '腊八节', month: 12, day: 8, lunar: true },
]

const LOOKAHEAD_DAYS = 30

// 每 10 分钟刷新，跨天（午夜）自动重算；模块级单例，多组件共享
const nowTick = ref(Date.now())
useIntervalFn(() => {
  nowTick.value = Date.now()
}, 600_000)

interface MatchedDay {
  name: string
  /** 展示文本：2026年9月18日(八月初八) */
  dateText: string
  /** 距今天数，0 = 就是今天 */
  daysUntil: number
}

const upcoming = computed<MatchedDay | null>(() => {
  const base = new Date(nowTick.value)
  base.setHours(0, 0, 0, 0)

  for (let offset = 0; offset <= LOOKAHEAD_DAYS; offset++) {
    const day = new Date(base)
    day.setDate(day.getDate() + offset)
    const y = day.getFullYear()
    const m = day.getMonth() + 1
    const d = day.getDate()

    const lunar = solarlunar.solar2lunar(y, m, d)
    const lunarText = `${lunar.monthCn}${lunar.dayCn}`
    const dateText = `${y}年${m}月${d}日(${lunarText})`

    // 除夕：农历腊月最后一天，即「明天是正月初一」
    const next = new Date(day)
    next.setDate(next.getDate() + 1)
    const nextLunar = solarlunar.solar2lunar(next.getFullYear(), next.getMonth() + 1, next.getDate())
    const isChuxi = nextLunar.monthCn === '正月' && nextLunar.dayCn === '初一'

    let name = ''
    for (const item of LUNAR_MEMORIALS) {
      if (lunar.monthCn === solarlunar.toChinaMonth(item.month) && lunar.dayCn === solarlunar.toChinaDay(item.day)) {
        name = item.name
        break
      }
    }
    if (!name && isChuxi) {
      name = '除夕'
    }
    if (!name) {
      for (const item of SOLAR_MEMORIALS) {
        if (m === item.month && d === item.day) {
          name = item.name
          break
        }
      }
    }

    if (name) {
      return { name, dateText, daysUntil: offset }
    }
  }
  return null
})

const memorialText = computed(() => {
  if (!upcoming.value)
    return ''
  return upcoming.value.daysUntil === 0
    ? `今天是：${upcoming.value.dateText}，${upcoming.value.name}`
    : `最近的纪念日是：${upcoming.value.dateText}，${upcoming.value.name}，还有${upcoming.value.daysUntil}天`
})

export function useMemorialDay() {
  return { memorialText }
}
