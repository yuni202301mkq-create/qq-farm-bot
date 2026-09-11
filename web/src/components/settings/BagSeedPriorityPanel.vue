<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

// ─── 长按拖动排序 ───
// 「短时长 + 即时反馈」策略：
//   · 按住 100ms 即激活（按住期间卡片已有高亮 + 阴影，明显提示「已进入拖动模式」）
//   · 计时窗口内只要位移 >12px 就取消——避免误触；同时给下滑滚动留余地
//   · 目标判定用「DOM 顺序 + 几何行/列二分」，不依赖 elementsFromPoint：
//     指针在首张卡左侧 = 插到首张之前；在末张卡右侧 = 插到末张之后；行内过中线决定前/后
//     （跨多列网格、多行、不同卡片高度都稳定，且不会被浮起的拖动卡挡住命中）
//   · pointercancel 不 commit；pointerup 才提交；中途松手落到空区也只重置、不动数据
//   · 原位置用 `bag-seed-ghost` 占位 + 被拖卡 `invisible` 隐藏，避免「消失又出现」
const LONG_PRESS_MS = 100
const MOVE_CANCEL_PX = 12

interface DragState {
  seedId: number
  pointerId: number
  startX: number
  startY: number
  active: boolean
  pressedSeedId: number // 按下时的高亮种子（即使没激活拖动也给视觉反馈）
  // 拖动期间的命中目标与插入位置（相对于按 DOM 顺序的原始 list）
  hoverTargetId: number | null // 命中的目标卡 id（null=拖到空区）
  hoverInsertAfter: boolean // true=插到目标卡后面，false=插到前面
}

const draggingSeedId = ref<number | null>(null)
const pressedSeedId = ref<number | null>(null)
const ghostSeedId = ref<number | null>(null) // 原位置占位标记
const dropHoverTargetId = ref<number | null>(null)
const dropHoverInsertAfter = ref(false)

let dragState: DragState | null = null
let longPressTimer: ReturnType<typeof setTimeout> | null = null
let ghostWidth = 0
let ghostHeight = 0
let touchScrollBlocker: EventListener | null = null

function clearLongPressTimer() {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

function removeTouchScrollBlocker() {
  if (touchScrollBlocker) {
    document.removeEventListener('touchmove', touchScrollBlocker)
    touchScrollBlocker = null
  }
}

function resetDragState() {
  clearLongPressTimer()
  removeTouchScrollBlocker()
  dragState = null
  draggingSeedId.value = null
  pressedSeedId.value = null
  ghostSeedId.value = null
  dropHoverTargetId.value = null
  dropHoverInsertAfter.value = false
}

// 把当前 sortedBagSeeds（按展示顺序）重新排列成一份「用户编辑的优先列表」——这只用来前端展示，
// 真正下发的优先序列在 commitDrop 时基于原始 DOM 顺序计算，避免 ghost 占位扰乱 indexOf。
function visibleList(): BagSeedPrioritySeed[] {
  return sortedBagSeeds.value
}

function findDropTarget(state: DragState, clientX: number, clientY: number): { targetId: number | null, insertAfter: boolean } {
  // 收集所有非被拖的 .bag-seed-item，按当前 DOM 顺序排列
  const items = Array.from(document.querySelectorAll<HTMLElement>('.bag-seed-item'))
    .filter((el) => Number(el.dataset.seedId) !== state.seedId)
  if (items.length === 0)
    return { targetId: null, insertAfter: false }

  // 计算每张卡在网格中的几何「行带」（按 top 分组，相近 top 视为同一行），便于「指针在两行之间时按 Y 选行」
  const rows: HTMLElement[][] = []
  const sortedByTop = [...items].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
  for (const el of sortedByTop) {
    const r = el.getBoundingClientRect()
    const lastRow = rows[rows.length - 1]
    if (lastRow && lastRow.length > 0) {
      const lastElInRow = lastRow[lastRow.length - 1] as HTMLElement
      const lastTop = lastElInRow.getBoundingClientRect().top
      if (Math.abs(r.top - lastTop) <= r.height * 0.6) {
        lastRow.push(el)
        continue
      }
    }
    rows.push([el])
  }
  // 行内按 left 排序
  for (const row of rows)
    row.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)

  // 选指针所在行：取行内卡平均 top 与 clientY 距离最小的行
  let bestRow = rows[0]
  let bestRowDist = Number.POSITIVE_INFINITY
  for (const row of rows) {
    const avgTop = row.reduce((s, el) => s + el.getBoundingClientRect().top, 0) / row.length
    const d = Math.abs(clientY - avgTop)
    if (d < bestRowDist) {
      bestRowDist = d
      bestRow = row
    }
  }
  if (!bestRow || bestRow.length === 0)
    return { targetId: null, insertAfter: false }
  const firstEl = bestRow[0]
  const lastEl = bestRow[bestRow.length - 1]
  if (!firstEl || !lastEl)
    return { targetId: null, insertAfter: false }

  // 在选中的行里按 X 找目标：
  //   指针 X 落在某张卡的 [left, right] 内 → 该卡为 target，根据 X 是否过中线决定 insertAfter
  //   指针 X 落在网格首张卡的左外侧 → target = 首张卡, insertAfter = false（插到它前面）
  //   指针 X 落在网格末张卡的右外侧 → target = 末张卡, insertAfter = true（插到它后面）
  for (const el of bestRow) {
    const r = el.getBoundingClientRect()
    if (clientX >= r.left && clientX <= r.right) {
      const id = Number(el.dataset.seedId)
      if (!Number.isFinite(id) || id <= 0)
        return { targetId: null, insertAfter: false }
      const insertAfter = clientX > r.left + r.width / 2
      return { targetId: id, insertAfter }
    }
  }
  // 指针不在任何卡的 X 范围内：在行的最左/最右兜底
  const firstRect = firstEl.getBoundingClientRect()
  const lastRect = lastEl.getBoundingClientRect()
  if (clientX < firstRect.left) {
    const id = Number(firstEl.dataset.seedId)
    if (!Number.isFinite(id) || id <= 0)
      return { targetId: null, insertAfter: false }
    return { targetId: id, insertAfter: false }
  }
  if (clientX > lastRect.right) {
    const id = Number(lastEl.dataset.seedId)
    if (!Number.isFinite(id) || id <= 0)
      return { targetId: null, insertAfter: false }
    return { targetId: id, insertAfter: true }
  }
  // 兜底（指针 X 在行内卡之间但被卡间隙吃掉）：取离指针 X 最近的一张
  let nearest: HTMLElement = firstEl
  let nearestDist = Number.POSITIVE_INFINITY
  for (const el of bestRow) {
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const d = Math.abs(clientX - cx)
    if (d < nearestDist) {
      nearestDist = d
      nearest = el
    }
  }
  const r = nearest.getBoundingClientRect()
  const id = Number(nearest.dataset.seedId)
  if (!Number.isFinite(id) || id <= 0)
    return { targetId: null, insertAfter: false }
  return { targetId: id, insertAfter: clientX > r.left + r.width / 2 }
}

function handleCardPointerDown(event: PointerEvent, seedId: number) {
  // 点在按钮（上移/下移/移出）上时不启动长按拖动
  if ((event.target as HTMLElement | null)?.closest('button'))
    return
  if (event.pointerType === 'mouse' && event.button !== 0)
    return

  // 单指/单鼠标才允许拖，多指按下直接放弃
  if (dragState) {
    resetDragState()
  }

  const sourceEl = event.currentTarget as HTMLElement | null
  const rect = sourceEl?.getBoundingClientRect()
  ghostWidth = rect?.width || 0
  ghostHeight = rect?.height || 0

  const seedNum = Number(seedId)
  pressedSeedId.value = seedNum

  dragState = {
    seedId: seedNum,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    pressedSeedId: seedNum,
    hoverTargetId: null,
    hoverInsertAfter: false,
  }

  longPressTimer = setTimeout(() => {
    longPressTimer = null
    if (!dragState)
      return
    dragState.active = true
    draggingSeedId.value = dragState.seedId
    ghostSeedId.value = dragState.seedId
    try { sourceEl?.setPointerCapture(dragState.pointerId) } catch { /* ignore */ }
    // 触屏进入拖动后阻止页面滚动，把整段手势留给拖动。
    const blocker: EventListener = (e) => {
      const te = e as TouchEvent
      if (dragState?.active && te.cancelable)
        te.preventDefault()
    }
    touchScrollBlocker = blocker
    document.addEventListener('touchmove', blocker, { passive: false })
    nextTick(() => {
      // 进入拖动后立即根据当前指针位置计算一次目标，给用户即时反馈
      handleCardPointerMove(event)
    })
  }, LONG_PRESS_MS)
}

function handleCardPointerMove(event: PointerEvent) {
  const state = dragState
  if (!state || event.pointerId !== state.pointerId)
    return

  if (!state.active) {
    // 长按计时内出现明显位移 = 用户想滚动页面，放弃本次长按
    const moved = Math.hypot(event.clientX - state.startX, event.clientY - state.startY)
    if (moved > MOVE_CANCEL_PX) {
      pressedSeedId.value = null
      resetDragState()
    }
    return
  }

  if (event.cancelable)
    event.preventDefault()

  // 让被拖卡片跟随指针
  const dragEl = document.querySelector<HTMLElement>(`.bag-seed-item[data-seed-id="${state.seedId}"]`)
  if (dragEl) {
    const offsetX = event.clientX - state.startX
    const offsetY = event.clientY - state.startY
    dragEl.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(1.04)`
    dragEl.style.boxShadow = '0 12px 28px rgba(0,0,0,0.18)'
    dragEl.style.opacity = '0.95'
  }

  // 计算插入位置
  const { targetId, insertAfter } = findDropTarget(state, event.clientX, event.clientY)
  state.hoverTargetId = targetId
  state.hoverInsertAfter = insertAfter
  dropHoverTargetId.value = targetId
  dropHoverInsertAfter.value = insertAfter
}

function commitDrop() {
  const state = dragState
  if (!state?.active) {
    cleanupDraggedElementStyle(state?.seedId ?? null)
    resetDragState()
    return
  }
  const list = visibleList().map(s => Number(s.seedId))
  const fromIdx = list.indexOf(state.seedId)
  if (fromIdx < 0) {
    cleanupDraggedElementStyle(state.seedId)
    resetDragState()
    return
  }
  // 移除被拖的那张
  list.splice(fromIdx, 1)

  let insertAt: number
  if (state.hoverTargetId === null || state.hoverTargetId === undefined) {
    // 没命中具体目标卡（拖到了空白区域）→ 落到末尾
    insertAt = list.length
  }
  else {
    // 命中目标卡：在「已移除被拖卡」的 list 上找目标的索引
    const targetIdx = list.indexOf(state.hoverTargetId)
    if (targetIdx < 0) {
      // 目标卡不在 list 里了（理论不会发生），兜底落到末尾
      insertAt = list.length
    }
    else {
      insertAt = state.hoverInsertAfter ? targetIdx + 1 : targetIdx
    }
  }
  // 边界保护
  insertAt = Math.max(0, Math.min(insertAt, list.length))
  list.splice(insertAt, 0, state.seedId)
  localPriority.value = list
  emitChange()
  resetDragState()
}

function cleanupDraggedElementStyle(seedId?: number | null) {
  if (seedId === undefined || seedId === null)
    return
  const dragEl = document.querySelector<HTMLElement>(`.bag-seed-item[data-seed-id="${seedId}"]`)
  if (dragEl) {
    dragEl.style.transform = ''
    dragEl.style.boxShadow = ''
    dragEl.style.opacity = ''
  }
}

function handleCardPointerEnd(event: PointerEvent) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return
  }
  // pointercancel 不提交：用户取消了手势，不应改数据，但清掉拖动样式
  if (event.type === 'pointercancel') {
    cleanupDraggedElementStyle(dragState.seedId)
    resetDragState()
    return
  }
  commitDrop()
}

function handleGlobalPointerCancel(event: PointerEvent) {
  // 当任何 pointercancel 发生时（例如来电、系统弹窗）也要兜底清理
  if (dragState && event.pointerId === dragState.pointerId) {
    cleanupDraggedElementStyle(dragState.seedId)
    resetDragState()
  }
}

onBeforeUnmount(() => {
  if (typeof document !== 'undefined')
    document.removeEventListener('pointercancel', handleGlobalPointerCancel)
  resetDragState()
})

onMounted(() => {
  if (typeof document !== 'undefined')
    document.addEventListener('pointercancel', handleGlobalPointerCancel)
})

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
  <div class="bag-seed-panel border border-amber-200 rounded-lg bg-amber-50/70 p-3 space-y-3 dark:border-amber-800/50 dark:bg-amber-900/20">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div class="text-sm text-amber-900 font-semibold dark:text-amber-200">
          背包种子优先顺序
        </div>
        <p class="mt-1 text-xs text-amber-700/90 dark:text-amber-300/90">
          先按下方顺序消耗背包中的种子；背包种子不足时，再按“第二优先策略”补种。
          四格（2×2）作物同样按此顺序参与种植；「优先种植 2×2 作物」开关只控制其他策略下是否让四格作物插队先种，不影响本顺序。
        </p>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-1 border border-amber-300 rounded-md px-2.5 py-1 text-xs text-amber-800 font-medium transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40"
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
        class="border border-amber-300 rounded-md px-2.5 py-1 text-xs text-amber-800 font-medium transition-colors hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40"
        @click="fetchBagSeeds(true)"
      >
        重新加载
      </button>
    </div>
    <div v-else-if="sortedBagSeeds.length === 0 && excludedBagSeeds.length === 0" class="py-4 text-center text-sm text-amber-700 dark:text-amber-300">
      背包中暂无可种植的种子
    </div>

    <div v-else class="bag-seed-grid grid gap-x-2 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
      <template v-for="(seed, index) in sortedBagSeeds" :key="seed.seedId">
        <!--
          被拖动卡的处理：永远渲染 .bag-seed-item（避免 Vue v-if 把它从 DOM 移除后丢失事件 + E2E 难定位）。
          - 拖动期间给它 position:fixed + transform，脱离网格布局
          - 原位置由 .bag-seed-ghost 同步占位，宽度高度与原卡一致
        -->
        <div
          v-if="ghostSeedId === Number(seed.seedId)"
          class="bag-seed-ghost border-2 border-dashed border-amber-300 rounded-xl dark:border-amber-700/60"
          :style="{ width: ghostWidth ? `${ghostWidth}px` : undefined, height: ghostHeight ? `${ghostHeight}px` : undefined }"
          aria-hidden="true"
        />
        <div
          class="bag-seed-item relative flex select-none items-center gap-2.5 border border-amber-200 rounded-xl bg-white py-2 pl-5 pr-2.5 transition-shadow dark:border-amber-700/50 dark:bg-gray-800"
          :class="{
            // 锁定种子：把默认 1px 浅橙边换成 2px 深橙边，背景也染成 amber-50 提示，单层醒目不再叠 ring 出现双边框
            '!border-2 !border-amber-500 !bg-amber-50 dark:!border-amber-400 dark:!bg-amber-900/30': seed.locked,
            'z-30 cursor-grabbing': draggingSeedId === Number(seed.seedId),
            'ring-2 ring-dashed ring-emerald-500 dark:ring-emerald-400': dropHoverTargetId === Number(seed.seedId)
              && draggingSeedId !== Number(seed.seedId),
            'cursor-grab ring-2 ring-amber-300 dark:ring-amber-600': pressedSeedId === Number(seed.seedId) && draggingSeedId !== Number(seed.seedId),
            'invisible': draggingSeedId === Number(seed.seedId),
          }"
          :data-seed-id="seed.seedId"
          :style="draggingSeedId === Number(seed.seedId)
            ? {
                position: 'fixed',
                left: '0px',
                top: '0px',
                width: ghostWidth ? `${ghostWidth}px` : undefined,
                transform: `translate(0px, 0px) scale(1.04)`,
                willChange: 'transform',
                pointerEvents: 'none',
                zIndex: 50,
              }
            : undefined"
          :title="seed.locked ? '该种子已在「我的背包」中锁定，不参与种植' : undefined"
          @pointerdown="handleCardPointerDown($event, seed.seedId)"
          @pointermove="handleCardPointerMove"
          @pointerup="handleCardPointerEnd"
          @pointercancel="handleCardPointerEnd"
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

          <!-- 右侧操作：上移 / 下移 / 移出优先列表 -->
          <div class="flex shrink-0 items-center gap-0.5">
            <div class="flex flex-col items-center">
              <button
                type="button"
                class="h-4 w-5 grid place-items-center rounded text-gray-400 transition-colors hover:text-amber-600 disabled:opacity-30 dark:hover:text-amber-300"
                :disabled="index === 0"
                title="上移"
                aria-label="上移"
                @click="moveBagSeedUp(seed.seedId)"
              >
                <span class="i-carbon-chevron-up block h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                class="h-4 w-5 grid place-items-center rounded text-gray-400 transition-colors hover:text-amber-600 disabled:opacity-30 dark:hover:text-amber-300"
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
              class="h-7 w-7 shrink-0 grid place-items-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
              title="移出优先列表（不参与背包优先种植）"
              aria-label="移出优先列表"
              @click="removeBagSeedFromPriority(seed.seedId)"
            >
              <span class="i-carbon-close block h-4 w-4" />
            </button>
          </div>
        </div>
      </template>

      <!-- 末尾的「拖到这里」提示 -->
      <div
        v-if="draggingSeedId !== null && dropHoverTargetId === null"
        class="bag-seed-tail-hint border-2 border-dashed border-emerald-500 rounded-xl dark:border-emerald-400 grid place-items-center text-xs text-emerald-700 font-semibold dark:text-emerald-300"
        :style="{ minHeight: ghostHeight ? `${ghostHeight}px` : '60px' }"
      >
        松手即可移动到末尾
      </div>
    </div>

    <!-- 已移出优先列表的种子：可一键放回 -->
    <div v-if="excludedBagSeeds.length > 0" class="border-t border-amber-200 pt-2 dark:border-amber-800/50">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="text-xs text-amber-800 dark:text-amber-300">
          已移出优先列表（{{ excludedBagSeeds.length }}）
        </div>
        <button
          type="button"
          class="border border-amber-300 rounded-md px-2 py-0.5 text-xs text-amber-800 font-medium transition-colors hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40"
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
          class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[11px] text-amber-800 transition-colors hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/70"
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
