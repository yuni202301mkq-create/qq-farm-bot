<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import draggable from 'vuedraggable'
import api from '@/api'

export interface BagSeedPrioritySeed {
  seedId: number
  name: string
  count: number
  requiredLevel: number
  plantSize: number
  image?: string
  /** 在「我的背包」中被锁定：仍显示在列表里，但不参与种植。 */
  locked?: boolean
}

const props = defineProps<{
  currentAccountId: string | number | null | undefined
  priority: number[]
  excludedIds: number[]
  saving: boolean
}>()

const emit = defineEmits<{
  /** 顺序或排除列表变化时，把最新值抛给上层（由上层连同其它策略一起保存）。 */
  change: [payload: { priority: number[], excludedIds: number[] }]
}>()

const bagSeeds = ref<BagSeedPrioritySeed[]>([])
const bagSeedsLoading = ref(false)
const bagSeedsError = ref('')
const loadedAccountId = ref('')

// 本地可编辑副本：避免直接改 props，统一在 change 时上抛。
const localPriority = ref<number[]>([...(props.priority || [])])
const localExcludedIds = ref<number[]>([...(props.excludedIds || [])])

watch(() => props.priority, (value) => {
  localPriority.value = [...(value || [])]
})
watch(() => props.excludedIds, (value) => {
  localExcludedIds.value = [...(value || [])]
})

const excludedIdSet = computed(() => new Set(localExcludedIds.value.map(Number)))

const seedById = computed(() => {
  const map = new Map<number, BagSeedPrioritySeed>()
  for (const seed of bagSeeds.value)
    map.set(Number(seed.seedId), seed)
  return map
})

// 展示顺序 = 已排顺序（过滤掉被移出 / 已不在背包的）+ 新增未排种子追加到末尾。
const sortedBagSeeds = computed<BagSeedPrioritySeed[]>(() => {
  const order: number[] = []
  const seen = new Set<number>()
  for (const id of localPriority.value) {
    const num = Number(id)
    if (num <= 0 || seen.has(num) || excludedIdSet.value.has(num))
      continue
    if (!seedById.value.has(num))
      continue
    seen.add(num)
    order.push(num)
  }
  for (const seed of bagSeeds.value) {
    const num = Number(seed.seedId)
    if (num <= 0 || seen.has(num) || excludedIdSet.value.has(num))
      continue
    seen.add(num)
    order.push(num)
  }
  return order
    .map(id => seedById.value.get(id))
    .filter((seed): seed is BagSeedPrioritySeed => Boolean(seed))
})

// 被移出的种子仍在背包中，只是不参与优先种植。
const excludedBagSeeds = computed<BagSeedPrioritySeed[]>(() => {
  return localExcludedIds.value
    .map(Number)
    .map(id => seedById.value.get(id))
    .filter((seed): seed is BagSeedPrioritySeed => Boolean(seed))
})

// vuedraggable 绑定列表：与 sortedBagSeeds 保持同步（仅当顺序变化时替换，避免回环）。
const dragList = ref<BagSeedPrioritySeed[]>([])
watch(sortedBagSeeds, (val) => {
  const cur = dragList.value.map(s => s.seedId).join(',')
  const next = val.map(s => s.seedId).join(',')
  if (cur !== next)
    dragList.value = [...val]
}, { immediate: true })

function emitChange() {
  // 只提交仍然存在于背包中的 id，避免把失效 id 写回后端。
  const bagIdSet = new Set(bagSeeds.value.map(s => Number(s.seedId)))
  const priority = localPriority.value
    .map(Number)
    .filter((id, i, arr) => id > 0 && arr.indexOf(id) === i && bagIdSet.has(id) && !excludedIdSet.value.has(id))
  const excludedIds = localExcludedIds.value
    .map(Number)
    .filter((id, i, arr) => id > 0 && arr.indexOf(id) === i && bagIdSet.has(id))
  localPriority.value = priority
  localExcludedIds.value = excludedIds
  emit('change', { priority: [...priority], excludedIds: [...excludedIds] })
}

// 拖拽结束后，把列表顺序回写到优先序列。
function onDragEnd() {
  localPriority.value = dragList.value.map(s => Number(s.seedId))
  emitChange()
}

function moveBagSeedUp(seedId: number) {
  const list = sortedBagSeeds.value.map(s => Number(s.seedId))
  const idx = list.indexOf(Number(seedId))
  if (idx <= 0)
    return
  const prev = list[idx - 1] as number
  const cur = list[idx] as number
  list[idx - 1] = cur
  list[idx] = prev
  localPriority.value = list
  emitChange()
}

function moveBagSeedDown(seedId: number) {
  const list = sortedBagSeeds.value.map(s => Number(s.seedId))
  const idx = list.indexOf(Number(seedId))
  if (idx < 0 || idx >= list.length - 1)
    return
  const cur = list[idx] as number
  const next = list[idx + 1] as number
  list[idx] = next
  list[idx + 1] = cur
  localPriority.value = list
  emitChange()
}

function removeBagSeedFromPriority(seedId: number) {
  const num = Number(seedId)
  localPriority.value = localPriority.value.filter(id => Number(id) !== num)
  if (!localExcludedIds.value.includes(num))
    localExcludedIds.value.push(num)
  emitChange()
}

function restoreBagSeedToPriority(seedId: number) {
  const num = Number(seedId)
  localExcludedIds.value = localExcludedIds.value.filter(id => Number(id) !== num)
  if (!localPriority.value.includes(num))
    localPriority.value.push(num)
  emitChange()
}

function restoreAllExcludedBagSeeds() {
  for (const id of [...localExcludedIds.value]) {
    const num = Number(id)
    if (!localPriority.value.includes(num))
      localPriority.value.push(num)
  }
  localExcludedIds.value = []
  emitChange()
}

function resetBagSeedPriority() {
  // 重置为游戏内背包顺序（接口返回的原始顺序），并清空移出列表。
  localPriority.value = bagSeeds.value.map(s => Number(s.seedId))
  localExcludedIds.value = []
  emitChange()
}

async function fetchBagSeeds(force = false) {
  const accountId = props.currentAccountId
  if (!accountId)
    return
  const requestedId = String(accountId)
  if (!force && bagSeeds.value.length > 0 && loadedAccountId.value === requestedId)
    return
  bagSeedsLoading.value = true
  bagSeedsError.value = ''
  try {
    const { data } = await api.get('/api/bag/seeds', {
      headers: { 'x-account-id': accountId },
    })
    if (String(props.currentAccountId || '') !== requestedId)
      return
    if (data && data.ok && data.data) {
      const rawSeeds = Array.isArray(data.data.seeds) ? data.data.seeds : []
      bagSeeds.value = rawSeeds.map((seed: any) => ({
        seedId: Number(seed.seedId) || 0,
        name: String(seed.name || `种子#${seed.seedId}`),
        count: Number(seed.count) || 0,
        requiredLevel: Number(seed.requiredLevel) || 0,
        plantSize: Number(seed.plantSize) || 1,
        image: typeof seed.image === 'string' ? seed.image : undefined,
        locked: seed.locked === true,
      }))
      loadedAccountId.value = requestedId
      // 后端可能据此返回了修正后的 priority，与本地合并一遍。
      if (Array.isArray(data.data.priority) && localPriority.value.length === 0)
        localPriority.value = data.data.priority.map(Number).filter((n: number) => n > 0)
    }
    else {
      bagSeedsError.value = String((data && data.error) || '读取背包种子失败')
      bagSeeds.value = []
    }
  }
  catch (e: any) {
    if (String(props.currentAccountId || '') === requestedId) {
      bagSeedsError.value = String(e?.response?.data?.error || e?.message || '读取背包种子失败')
      bagSeeds.value = []
    }
  }
  finally {
    if (String(props.currentAccountId || '') === requestedId)
      bagSeedsLoading.value = false
  }
}

watch(() => props.currentAccountId, () => {
  loadedAccountId.value = ''
  fetchBagSeeds()
}, { immediate: true })

defineExpose({ fetchBagSeeds })
</script>

<template>
  <div class="bag-seed-panel liquid-glass-sub border border-amber-200 rounded-lg bg-amber-50/70 p-3 space-y-3 dark:border-amber-800/50 dark:bg-amber-900/20">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="text-sm text-amber-900 font-semibold dark:text-amber-200">
          背包种子优先顺序
        </div>
        <p class="mt-1 text-xs text-amber-700/90 dark:text-amber-300/90">
          先按下方顺序消耗背包中的种子；背包种子不足时，再按“第二优先策略”补种。
        </p>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-1 border border-amber-300 rounded-md px-2.5 py-1 text-xs text-amber-800 font-medium transition-colors dark:border-amber-700 hover:bg-amber-100 dark:text-amber-200 disabled:opacity-50 dark:hover:bg-amber-900/40"
        :disabled="saving || sortedBagSeeds.length === 0"
        @click="resetBagSeedPriority"
      >
        重置顺序
      </button>
    </div>

    <div v-if="bagSeedsLoading" class="py-4 text-center text-sm text-amber-700 dark:text-amber-300">
      加载中...
    </div>
    <div v-else-if="bagSeedsError" class="flex flex-col items-center gap-2 py-4 text-center text-sm text-red-600 dark:text-red-400">
      <span>{{ bagSeedsError }}</span>
      <button
        type="button"
        class="border border-amber-300 rounded-md px-2.5 py-1 text-xs text-amber-800 font-medium transition-colors dark:border-amber-700 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
        @click="fetchBagSeeds(true)"
      >
        重新加载
      </button>
    </div>
    <div v-else-if="sortedBagSeeds.length === 0 && excludedBagSeeds.length === 0" class="py-4 text-center text-sm text-amber-700 dark:text-amber-300">
      背包中暂无可种植的种子
    </div>

    <draggable
      v-else
      v-model="dragList"
      item-key="seedId"
      :animation="160"
      ghost-class="bag-seed-ghost"
      chosen-class="bag-seed-chosen"
      drag-class="bag-seed-drag"
      :disabled="saving"
      :delay="120"
      :delay-on-touch-only="true"
      filter=".seed-act"
      :prevent-on-filter="false"
      class="bag-seed-grid grid gap-x-2 gap-y-7 sm:grid-cols-2 xl:grid-cols-3"
      @end="onDragEnd"
    >
      <template #item="{ element: seed, index }">
        <div
          class="bag-seed-item relative flex select-none items-center gap-2.5 border border-amber-200 rounded-xl bg-white py-2 pl-5 pr-2.5 transition-shadow dark:border-amber-700/50 dark:bg-gray-800"
          :class="{
            // 锁定种子：把默认 1px 浅橙边换成 2px 深橙边，背景也染成 amber-50 提示，单层醒目不再叠 ring 出现双边框
            '!border-2 !border-amber-500 !bg-amber-50 dark:!border-amber-400 dark:!bg-amber-900/30': seed.locked,
          }"
          :data-seed-id="seed.seedId"
          :title="seed.locked ? '该种子已在「我的背包」中锁定，不参与种植' : '拖动可调整优先顺序'"
        >
          <!-- 左上角序号徽标，压在卡片边角上 -->
          <span
            class="absolute left-0 top-0 z-10 grid h-6 w-6 place-items-center border border-amber-300 rounded-full bg-amber-400 text-[11px] text-amber-950 font-bold shadow-sm -translate-x-1/2 -translate-y-1/2 dark:border-amber-500 dark:bg-amber-500"
            :title="`优先顺序第 ${index + 1} 位`"
          >
            {{ index + 1 }}
          </span>

          <!-- 种子图标 -->
          <div class="h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-amber-50 dark:bg-gray-700">
            <img
              v-if="seed.image"
              :src="seed.image"
              :alt="`${seed.name}种子`"
              class="h-10 w-10 object-contain"
              loading="lazy"
            >
            <span v-else class="i-carbon-sprout block h-6 w-6 text-amber-500 dark:text-amber-300" />
          </div>

          <!-- 名称与库存/等级 -->
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span class="truncate text-sm text-gray-800 font-semibold dark:text-gray-200">
                {{ seed.name }}
              </span>
              <span
                v-if="Number(seed.plantSize) === 2"
                class="shrink-0 border border-emerald-300 rounded bg-emerald-50 px-1 py-0.5 text-[10px] text-emerald-700 font-semibold leading-none dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                title="四格作物，占用 2×2 土地"
              >
                &lt;2x2&gt;
              </span>
              <span
                v-if="seed.locked"
                class="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-700 font-semibold dark:bg-amber-900/50 dark:text-amber-300"
                title="已在「我的背包」中锁定，不参与种植"
              >
                <span class="i-carbon-locked block h-2.5 w-2.5" />
                已锁定
              </span>
            </div>
            <div class="mt-0.5 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
              <span>库存 {{ seed.count }}</span>
              <span>等级{{ seed.requiredLevel }}</span>
            </div>
          </div>

          <!-- 右侧操作：上移 / 下移 / 移出优先列表（这些按钮不参与拖拽） -->
          <div class="seed-act flex shrink-0 items-center gap-0.5">
            <div class="flex flex-col items-center">
              <button
                type="button"
                class="grid h-4 w-5 place-items-center rounded text-gray-400 transition-colors hover:text-amber-600 disabled:opacity-30 dark:hover:text-amber-300"
                :disabled="index === 0"
                title="上移"
                aria-label="上移"
                @click="moveBagSeedUp(seed.seedId)"
              >
                <span class="i-carbon-chevron-up block h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                class="grid h-4 w-5 place-items-center rounded text-gray-400 transition-colors hover:text-amber-600 disabled:opacity-30 dark:hover:text-amber-300"
                :disabled="index === sortedBagSeeds.length - 1"
                title="下移"
                aria-label="下移"
                @click="moveBagSeedDown(seed.seedId)"
              >
                <span class="i-carbon-chevron-down block h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
              title="移出优先列表（不参与背包优先种植）"
              aria-label="移出优先列表"
              @click="removeBagSeedFromPriority(seed.seedId)"
            >
              <span class="i-carbon-close block h-4 w-4" />
            </button>
          </div>
        </div>
      </template>
    </draggable>

    <!-- 已移出优先列表的种子：可一键放回 -->
    <div v-if="excludedBagSeeds.length > 0" class="border-t border-amber-200 pt-2 dark:border-amber-800/50">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="text-xs text-amber-800 dark:text-amber-300">
          已移出优先列表（{{ excludedBagSeeds.length }}）
        </div>
        <button
          type="button"
          class="border border-amber-300 rounded-md px-2 py-0.5 text-xs text-amber-800 font-medium transition-colors dark:border-amber-700 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
          @click="restoreAllExcludedBagSeeds"
        >
          全部放回
        </button>
      </div>
      <p class="mt-1 text-[11px] text-amber-700/80 dark:text-amber-300/80">
        这些种子不会参与背包优先种植，但仍留在背包中。点名称可放回列表。
      </p>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <button
          v-for="seed in excludedBagSeeds"
          :key="seed.seedId"
          type="button"
          class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[11px] text-amber-800 transition-colors dark:bg-amber-900/40 hover:bg-amber-200 dark:text-amber-200 dark:hover:bg-amber-900/70"
          :title="`放回优先列表：${seed.name}`"
          @click="restoreBagSeedToPriority(seed.seedId)"
        >
          <span class="i-carbon-add block h-3 w-3" />
          {{ seed.name }} · 库存 {{ seed.count }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 拖拽占位（留在原列表中的虚线框） */
.bag-seed-ghost {
  opacity: 0.4;
  border: 2px dashed rgb(217 119 6 / 0.7);
  border-radius: 0.75rem;
  background: rgb(255 237 213 / 0.35);
}
/* 被选中准备拖拽的卡片 */
.bag-seed-chosen {
  box-shadow: 0 0 0 2px rgb(16 185 129 / 0.5);
}
/* 跟随指针的拖拽影像 */
.bag-seed-drag {
  opacity: 0.92;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18);
}
</style>
