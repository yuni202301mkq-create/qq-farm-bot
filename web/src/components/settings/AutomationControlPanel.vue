<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { CHARITY_FLOWER_ACTIVITY_WINDOW, isWithinActivityWindowMs, PET_DIARY_ACTIVITY_WINDOW, RAIN_POEM_ACTIVITY_WINDOW } from '@/constants/activity-windows'

interface AutomationForm {
  automation: Record<string, any>
  autoAcceptFriendMinLevel: number
  fertilizerBuyOrganicCount: number
  fertilizerBuyOrganicThresholdHours: number
  fertilizerBuyNormalCount: number
  fertilizerBuyNormalThresholdHours: number
  fertilizerBuyCheckIntervalMinutes: number
  goldenBugKeepCount: number
  goldenBugRoundLimit: number
}

withDefaults(defineProps<{
  currentAccountName: string | null
  currentAccountId: string | number | null | undefined
  loading: boolean
  saving: boolean
  fertilizerLandTypeOptions: { label: string, value: string }[]
  fertilizerOptions: { label: string, value: string | number }[]
  title?: string
  saveLabel?: string
  showActions?: boolean
  /** 为 false 时不强制要求已选账号（默认方案编辑等场景） */
  requireAccount?: boolean
}>(), {
  title: '自动控制',
  saveLabel: '保存自动控制',
  showActions: true,
  requireAccount: true,
})

const emit = defineEmits<{
  save: []
}>()

const settings = defineModel<AutomationForm>('automation', { required: true })

const automation = computed(() => settings.value.automation || {})

function isFastMatureFertilizerMode(mode: string) {
  return mode === 'smart' || mode === 'smart_only' || mode === 'smart_normal'
}

// ===== 神秘商人货币范围弹窗 =====
const mysteryShopSettingsVisible = ref(false)

// ===== 限时活动可见性 =====
const nowMs = ref(Date.now())
let nowTimer: ReturnType<typeof window.setInterval> | null = null
const showRainPoemActivity = computed(() => isWithinActivityWindowMs(RAIN_POEM_ACTIVITY_WINDOW, nowMs.value))
const showCharityFlowerActivity = computed(() => isWithinActivityWindowMs(CHARITY_FLOWER_ACTIVITY_WINDOW, nowMs.value))
const showPetDiaryActivity = computed(() => isWithinActivityWindowMs(PET_DIARY_ACTIVITY_WINDOW, nowMs.value))

function isLandTypeSelected(value: string) {
  return Array.isArray(automation.value.fertilizer_land_types)
    && automation.value.fertilizer_land_types.includes(value)
}

function toggleLandType(value: string) {
  const current = Array.isArray(automation.value.fertilizer_land_types)
    ? [...automation.value.fertilizer_land_types]
    : []
  settings.value.automation = {
    ...automation.value,
    fertilizer_land_types: current.includes(value)
      ? current.filter(item => item !== value)
      : [...current, value],
  }
}

const selectedLandTypeCount = computed(() => Array.isArray(automation.value.fertilizer_land_types) ? automation.value.fertilizer_land_types.length : 0)

onMounted(() => {
  nowTimer = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 60000)
})
onUnmounted(() => {
  if (nowTimer)
    window.clearInterval(nowTimer)
})
</script>

<template>
  <div class="space-y-5">
    <!-- 标题行：左侧标题 + 右侧保存按钮 -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="min-w-0 flex items-center gap-2 text-lg text-gray-900 font-bold dark:text-gray-100">
        <span class="i-carbon-settings-adjust shrink-0 text-lg" />
        <span class="truncate">{{ title }}</span>
        <span v-if="currentAccountName" class="text-sm text-gray-500 font-normal dark:text-gray-400">
          ({{ currentAccountName }})
        </span>
      </h3>
      <BaseButton
        v-if="showActions"
        variant="primary"
        size="sm"
        :loading="saving"
        @click="emit('save')"
      >
        {{ saveLabel }}
      </BaseButton>
    </div>

    <div v-if="loading" class="py-4 text-center text-gray-500">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl" />
      <p>加载中...</p>
    </div>

    <div v-else-if="requireAccount && !currentAccountId" class="py-8 text-center text-gray-500">
      <div class="i-carbon-settings-adjust mx-auto mb-2 text-3xl text-gray-400" />
      <p>请先选择账号</p>
    </div>

    <div v-else class="space-y-4">
      <!-- 农场生产 -->
      <section class="liquid-glass rounded-2xl p-5">
        <div class="mb-4 flex items-center gap-3">
          <span class="inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300">
            <span class="i-carbon-sprout text-lg" />
          </span>
          <div>
            <h4 class="text-sm text-gray-900 font-semibold dark:text-gray-100">
              农场生产
            </h4>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              种植、收获、卖果与土地养护
            </p>
          </div>
        </div>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <BaseSwitch v-model="automation.farm" label="自动播种收获" />
          <BaseSwitch v-model="automation.farm_push" label="推送触发巡田" />
          <BaseSwitch v-model="automation.sell" label="自动卖果实" />
          <BaseSwitch v-model="automation.land_upgrade" label="自动升级土地" />
          <BaseSwitch v-model="automation.fertilizer_buy_normal" label="自动购买无机化肥" />
          <BaseSwitch v-model="automation.fertilizer_buy_organic" label="自动购买有机化肥" />
          <BaseSwitch v-model="automation.fertilizer_gift" label="自动填充化肥" />
          <BaseSwitch v-model="automation.skip_own_weed_bug" label="不除自己草虫" />
        </div>

        <!-- 自动补肥参数 -->
        <div v-if="automation.fertilizer_buy_organic || automation.fertilizer_buy_normal" class="liquid-glass-sub mt-4 border border-emerald-200/60 rounded-lg bg-emerald-50/60 p-3 text-sm space-y-3 dark:border-emerald-800/50 dark:bg-emerald-900/15">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <template v-if="automation.fertilizer_buy_organic">
              <BaseInput v-model.number="settings.fertilizerBuyOrganicCount" label="有机肥购买数量" type="number" min="1" max="999" />
              <BaseInput v-model.number="settings.fertilizerBuyOrganicThresholdHours" label="有机肥触发阈值 (小时)" type="number" min="1" max="720" />
            </template>
            <template v-if="automation.fertilizer_buy_normal">
              <BaseInput v-model.number="settings.fertilizerBuyNormalCount" label="无机肥购买数量" type="number" min="1" max="999" />
              <BaseInput v-model.number="settings.fertilizerBuyNormalThresholdHours" label="无机肥触发阈值 (小时)" type="number" min="1" max="720" />
            </template>
            <BaseInput v-model.number="settings.fertilizerBuyCheckIntervalMinutes" label="检测间隔 (分钟)" type="number" min="1" max="1440" />
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            系统按检测间隔定时检查化肥容器剩余量，低于触发阈值时自动购买，保存设置后会立即检测一次。同时开启两种化肥时优先购买有机化肥。
          </p>
        </div>
      </section>

      <!-- 活动与资源 -->
      <section class="liquid-glass rounded-2xl p-5">
        <div class="mb-4 flex items-center gap-3">
          <span class="inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">
            <span class="i-carbon-events text-lg" />
          </span>
          <div>
            <h4 class="text-sm text-gray-900 font-semibold dark:text-gray-100">
              活动与资源
            </h4>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              日常任务、限时活动与神秘商人
            </p>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <BaseSwitch v-model="automation.task" label="自动做任务" />
          <div class="max-w-full w-fit inline-flex items-center gap-1.5">
            <BaseSwitch v-model="automation.mystery_shop_auto_buy" label="自动购买神秘商人商品" />
            <button
              class="inline-grid h-7 w-7 shrink-0 place-items-center rounded-md text-gray-400 transition hover:bg-gray-100 dark:text-gray-500 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              type="button"
              title="设置允许使用的货币"
              aria-label="设置神秘商人自动购买"
              @click="mysteryShopSettingsVisible = true"
            >
              <span class="i-carbon-settings text-base" />
            </button>
          </div>
        </div>

        <!-- 限时活动（按活动窗口自动显示） -->
        <div v-if="showRainPoemActivity || showCharityFlowerActivity" class="grid grid-cols-1 mt-4 gap-3 md:grid-cols-2">
          <template v-if="showRainPoemActivity">
            <div class="rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-900/30">
              <BaseSwitch v-model="automation.rain_poem_bottle_buy" label="购买天气采集瓶" />
            </div>
            <div class="rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-900/30">
              <BaseSwitch v-model="automation.rain_poem_weather_collect" label="采集好友雷雨" />
            </div>
            <div class="rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-900/30">
              <BaseSwitch v-model="automation.rain_poem_summon_use" label="使用雷雨召唤瓶" />
            </div>
            <div class="rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-900/30">
              <BaseSwitch v-model="automation.rain_poem_prank_use" label="使用青蛙与乌云使坏瓶" />
            </div>
            <div class="rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-900/30">
              <BaseSwitch v-model="automation.rain_poem_research_unlock" label="解锁气象研究" />
            </div>
          </template>
          <template v-if="showCharityFlowerActivity">
            <div class="rounded-lg bg-rose-50/60 px-4 py-3 dark:bg-rose-900/10">
              <BaseSwitch v-model="automation.charity_flower_share_claim" label="领取每日分享奖励" />
            </div>
            <div class="rounded-lg bg-rose-50/60 px-4 py-3 dark:bg-rose-900/10">
              <BaseSwitch v-model="automation.charity_flower_donate" label="送出全部爱心" />
            </div>
            <div class="rounded-lg bg-rose-50/60 px-4 py-3 dark:bg-rose-900/10">
              <BaseSwitch v-model="automation.charity_flower_reward_claim" label="领取爱心档位奖励" />
            </div>
            <div class="rounded-lg bg-rose-50/60 px-4 py-3 dark:bg-rose-900/10">
              <BaseSwitch v-model="automation.charity_flower_public_fund_claim" label="领取并送出 1 元公益金" />
            </div>
          </template>
        </div>

        <!-- 萌宠成长日记 -->
        <div v-if="showPetDiaryActivity" class="liquid-glass-sub mt-4 border border-violet-200/70 rounded-lg p-4 dark:border-violet-900/40">
          <div class="mb-3">
            <div class="text-sm text-gray-900 font-medium dark:text-gray-100">
              萌宠成长日记
            </div>
            <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              比熊养成、爪印手记、宝藏护送与节令赠礼
            </div>
          </div>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <BaseSwitch v-model="automation.pet_diary_adopt" label="领养并领取比熊" />
            <BaseSwitch v-model="automation.pet_diary_feed" label="自动投喂（每日 16 次）" />
            <BaseSwitch v-model="automation.pet_diary_draw" label="自动寻宝（每日 10 次）" />
            <BaseSwitch v-model="automation.pet_diary_story_claim" label="领取爪印手记奖励" />
            <BaseSwitch v-model="automation.pet_diary_seed_claim" label="领取活动种子礼包" />
            <BaseSwitch v-model="automation.pet_diary_solar_claim" label="领取节令赠礼" />
            <BaseSwitch v-model="automation.pet_diary_treasure_open" label="护送完成后开启宝藏" />
            <BaseSwitch v-model="automation.pet_diary_compensation_claim" label="领取夺宝补偿" />
            <BaseSwitch v-model="automation.pet_diary_battle" label="自动好友夺宝" />
            <BaseSwitch v-model="automation.pet_diary_charm_equip" label="自动选择锦囊（含免费刷新）" />
          </div>
          <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">
            投喂与寻宝消耗萌宠元气糕，元气糕来自收获活动作物，元气糕不足时自动跳过。锦囊只使用每日免费刷新额度，不消耗点券或钻石。
          </p>
          <p class="mt-2 text-xs text-amber-600 dark:text-amber-400">
            自动夺宝轮转检查好友并跳过好友黑名单，按初级、中级、高级顺序使用宝藏允许的已有挑战书，不自动购买。拾物小铺兑换仍需手动选择商品。
          </p>
        </div>
      </section>

      <!-- 好友互动 -->
      <section class="liquid-glass rounded-2xl p-5">
        <div class="mb-4 flex items-center gap-3">
          <div class="min-w-0 flex items-center gap-3">
            <span class="inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300">
              <span class="i-carbon-user-multiple text-lg" />
            </span>
            <div>
              <h4 class="text-sm text-gray-900 font-semibold dark:text-gray-100">
                好友互动
              </h4>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                偷菜、帮忙与好友农场操作
              </p>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <BaseSwitch v-if="automation.friend" v-model="automation.friend_steal" label="自动偷菜" />
          <BaseSwitch v-if="automation.friend" v-model="automation.friend_help" label="自动帮忙" />
          <BaseSwitch v-if="automation.friend" v-model="automation.friend_bad" label="自动捣乱" />
          <BaseSwitch v-if="automation.friend" v-model="automation.friend_golden_bug" label="自动放黄金虫" />
          <BaseSwitch v-if="automation.friend" v-model="automation.golden_bug_clear" label="自动清除黄金虫" />
          <BaseSwitch v-if="automation.friend" v-model="automation.friend_help_exp_limit" label="经验满只帮护主犬" />
          <BaseSwitch v-model="automation.friend" label="自动好友互动" />
          <BaseSwitch v-if="automation.friend" v-model="automation.friend_auto_accept" label="自动通过好友申请" />
        </div>

        <template v-if="automation.friend">
          <!-- 黄金虫策略 -->
          <div v-if="automation.friend_golden_bug" class="liquid-glass-sub mt-4 border border-amber-200/70 rounded-lg bg-amber-50/60 p-3 dark:border-amber-800/50 dark:bg-amber-900/15">
            <div class="mb-2 text-sm text-amber-800 font-medium dark:text-amber-300">
              黄金虫策略
            </div>
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <BaseInput v-model.number="settings.goldenBugKeepCount" label="黄金虫保留数量" type="number" min="0" max="9999" />
              <BaseInput v-model.number="settings.goldenBugRoundLimit" label="黄金虫单轮上限" type="number" min="1" max="100" />
            </div>
          </div>

          <!-- 施肥范围 -->
          <div class="liquid-glass-sub mt-4 border border-amber-200 rounded-lg bg-amber-50/60 p-3 dark:border-amber-800/60 dark:bg-amber-900/10">
            <div class="mb-2 flex items-center justify-between gap-3">
              <span class="text-sm text-amber-800 font-medium dark:text-amber-300">施肥范围</span>
              <span class="text-xs text-gray-500 dark:text-gray-400">已选 {{ selectedLandTypeCount }}/{{ fertilizerLandTypeOptions.length }}</span>
            </div>
            <div class="grid grid-cols-2 gap-2 md:grid-cols-5">
              <label
                v-for="option in fertilizerLandTypeOptions"
                :key="option.value"
                class="flex cursor-pointer items-center gap-1.5 rounded bg-white px-2 py-1.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300"
              >
                <input
                  type="checkbox"
                  class="h-3.5 w-3.5"
                  :checked="isLandTypeSelected(option.value)"
                  @change="toggleLandType(option.value)"
                >
                <span>{{ option.label }}</span>
              </label>
            </div>
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
              施肥前会优先按土地类型过滤，仅对命中范围的地块执行施肥策略。
            </p>
          </div>

          <!-- 施肥策略 -->
          <div class="mt-4 space-y-3">
            <BaseSelect
              v-model="automation.fertilizer"
              label="施肥策略"
              :options="fertilizerOptions"
            />
            <BaseSwitch
              v-model="automation.fertilizer_multi_season"
              label="多季补肥"
            />
            <div v-if="isFastMatureFertilizerMode(automation.fertilizer)" class="liquid-glass-sub border border-gray-200 rounded-lg bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/20">
              <div class="mb-2 text-sm text-gray-900 font-medium dark:text-gray-100">
                快成熟判定秒数
              </div>
              <div class="flex flex-wrap items-end gap-4">
                <BaseInput
                  v-model.number="automation.fertilizer_smart_seconds"
                  label="秒数"
                  type="number"
                  min="60"
                  max="7200"
                  class="w-40"
                />
                <span class="pb-2 text-xs text-gray-500 dark:text-gray-400">
                  距离成熟时间 ≤ 此秒数时施肥（默认300秒=5分钟）
                </span>
              </div>
            </div>
          </div>

          <!-- 自动通过好友最低等级 -->
          <div v-if="automation.friend_auto_accept" class="liquid-glass-sub mt-4 border border-sky-200/70 rounded-lg bg-sky-50/60 p-3 dark:border-sky-800/50 dark:bg-sky-900/15">
            <div class="mb-2 text-sm text-sky-800 font-medium dark:text-sky-300">
              自动通过好友最低等级
            </div>
            <BaseInput
              v-model.number="settings.autoAcceptFriendMinLevel"
              label="最低等级"
              type="number"
              min="0"
              max="200"
              class="max-w-xs"
            />
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
              设为 0 表示不限制等级；开启自动通过好友申请后，系统会按这里的最低等级处理申请。
            </p>
          </div>
        </template>
        <p v-else class="text-xs text-gray-500 dark:text-gray-400">
          开启「自动好友互动」后，可自动执行偷菜、帮忙、捣乱、黄金虫等好友农场操作。
        </p>
      </section>
    </div>

    <!-- 神秘商人货币范围弹窗（Teleport 到 body：玻璃卡 backdrop-filter 会困住 fixed 弹窗） -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="mysteryShopSettingsVisible" class="fixed inset-0 z-[200] grid items-start justify-items-center overflow-y-auto bg-gray-950/45 p-4 backdrop-blur-[2px]" @click.self="mysteryShopSettingsVisible = false">
          <div class="my-auto max-h-[calc(100dvh-2rem)] max-w-lg w-full overflow-y-auto border border-gray-200 rounded-2xl bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
            <div class="flex items-start justify-between border-b border-gray-100 px-6 py-5 dark:border-gray-700">
              <div>
                <div class="flex items-center gap-2">
                  <span class="inline-grid h-8 w-8 place-items-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300">
                    <span class="i-carbon-store text-lg" />
                  </span>
                  <h3 class="text-lg text-gray-900 font-semibold dark:text-gray-100">
                    神秘商人自动购买
                  </h3>
                </div>
                <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  选择自动购买时可以使用的货币。
                </p>
              </div>
              <button class="inline-grid h-8 w-8 shrink-0 place-items-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200" type="button" aria-label="关闭" @click="mysteryShopSettingsVisible = false">
                <span class="i-carbon-close text-xl" />
              </button>
            </div>
            <div class="px-6 py-5 space-y-2">
              <div class="flex items-center justify-between gap-4 border border-gray-200 rounded-xl px-4 py-3 dark:border-gray-700">
                <div class="min-w-0 flex items-center gap-3">
                  <span class="inline-grid h-9 w-9 shrink-0 place-items-center rounded-full bg-yellow-50 text-yellow-600 dark:bg-yellow-900/25 dark:text-yellow-300"><span class="i-carbon-currency-dollar text-lg" /></span>
                  <div>
                    <div class="text-sm text-gray-800 font-medium dark:text-gray-100">
                      金币
                    </div><div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      允许使用金币自动购买
                    </div>
                  </div>
                </div>
                <BaseSwitch v-model="automation.mystery_shop_allow_gold" />
              </div>
              <div class="flex items-center justify-between gap-4 border border-gray-200 rounded-xl px-4 py-3 dark:border-gray-700">
                <div class="min-w-0 flex items-center gap-3">
                  <span class="inline-grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/25 dark:text-blue-300"><span class="i-carbon-ticket text-lg" /></span>
                  <div>
                    <div class="text-sm text-gray-800 font-medium dark:text-gray-100">
                      点券
                    </div><div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      允许使用点券自动购买
                    </div>
                  </div>
                </div>
                <BaseSwitch v-model="automation.mystery_shop_allow_coupon" />
              </div>
              <div class="flex items-center justify-between gap-4 border border-gray-200 rounded-xl px-4 py-3 dark:border-gray-700">
                <div class="min-w-0 flex items-center gap-3">
                  <span class="inline-grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-900/25 dark:text-emerald-300"><span class="i-carbon-crop-health text-lg" /></span>
                  <div>
                    <div class="text-sm text-gray-800 font-medium dark:text-gray-100">
                      金豆豆
                    </div><div class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      允许使用金豆豆自动购买
                    </div>
                  </div>
                </div>
                <BaseSwitch v-model="automation.mystery_shop_allow_gold_bean" />
              </div>
            </div>
            <div class="flex justify-end border-t border-gray-100 bg-gray-50/70 px-6 py-4 dark:border-gray-700 dark:bg-gray-900/20">
              <BaseButton class="min-w-24" size="sm" @click="mysteryShopSettingsVisible = false">
                完成
              </BaseButton>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
