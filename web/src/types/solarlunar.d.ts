declare module 'solarlunar' {
  export interface SolarLunarResult {
    lYear: number
    lMonth: number
    lDay: number
    /** 农历月中文，如「八月」「闰二月」「腊月」 */
    monthCn: string
    /** 农历日中文，如「初八」「十五」 */
    dayCn: string
    /** 当天节气名，无则为空串 */
    term: string
    animal: string
    gzYear: string
    gzMonth: string
    gzDay: string
    cYear: number
    cMonth: number
    cDay: number
    isToday: boolean
    isTerm: boolean
    [key: string]: unknown
  }

  const solarlunar: {
    solar2lunar(year: number, month: number, day: number): SolarLunarResult
    lunar2solar(year: number, month: number, day: number, isLeapMonth?: boolean): SolarLunarResult
    toChinaMonth(month: number): string
    toChinaDay(day: number): string
    getFestivals(): Record<string, unknown>
    addFestival(festivals: Record<string, unknown>): void
    clearFestivals(): void
  }

  export default solarlunar
}
