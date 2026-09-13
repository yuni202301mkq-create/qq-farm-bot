<script setup lang="ts">
import { ref, watch } from 'vue'
import api from '@/api'

const props = defineProps<{
  show: boolean
  accountId?: string | number | null
}>()

const emit = defineEmits<{ close: [] }>()

interface ConsumptionRecord {
  id: string
  title: string
  detail: string
  amount: number
  currency: string
  currencyLabel: string
  ts: number
}

const records = ref<ConsumptionRecord[]>([])
const loading = ref(false)
const errorMsg = ref('')

const CURRENCY_ICONS: Record<string, string> = {
  gold: '/game-config/resource-icons/gold.png',
  coupon: '/game-config/resource-icons/coupon.png',
  diamond: '/game-config/resource-icons/diamond.png',
  goldBean: '/game-config/resource-icons/gold-bean.png',
}

function currencyIcon(currency: string) {
  return CURRENCY_ICONS[currency] || '/game-config/resource-icons/gold.png'
}

function formatRecordTime(ts: number) {
  const d = new Date(Number(ts))
  if (Number.isNaN(d.getTime()))
    return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function loadRecords() {
  if (!props.accountId) {
    errorMsg.value = '请先选择账号'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const { data } = await api.get('/api/consumption-records', {
      headers: { 'x-account-id': String(props.accountId) },
    })
    if (!data?.ok)
      throw new Error(data?.error || '获取消费明细失败')
    records.value = Array.isArray(data.data) ? data.data : []
  }
  catch (error: any) {
    errorMsg.value = error?.response?.data?.error || error?.message || '获取消费明细失败'
  }
  finally {
    loading.value = false
  }
}

watch(() => props.show, (show) => {
  if (show)
    loadRecords()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="consumption-modal">
      <div
        v-if="show"
        class="consumption-overlay"
        @click="emit('close')"
      >
        <div
          class="consumption-modal"
          @click.stop
        >
          <header class="consumption-head">
            <div class="consumption-head__icon">
              <div class="i-carbon-receipt" />
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="consumption-head__title">
                消费明细
              </h3>
              <p class="consumption-head__sub">
                <template v-if="loading">
                  加载中...
                </template>
                <template v-else-if="errorMsg">
                  {{ errorMsg }}
                </template>
                <template v-else>
                  本次在线共 {{ records.length }} 条记录
                </template>
              </p>
            </div>
            <button
              type="button"
              class="consumption-head__close"
              aria-label="关闭"
              @click="emit('close')"
            >
              <div class="i-carbon-close" />
            </button>
          </header>

          <div class="consumption-body custom-scrollbar">
            <div v-if="loading && records.length === 0" class="consumption-empty">
              <div class="i-svg-spinners-90-ring-with-bg mb-2 inline-block text-2xl" />
              <div>正在加载消费明细...</div>
            </div>
            <div v-else-if="errorMsg && records.length === 0" class="consumption-empty">
              <div class="i-carbon-warning mb-2 inline-block text-2xl text-red-400" />
              <div>{{ errorMsg }}</div>
              <button
                type="button"
                class="mt-3 rounded-lg bg-gray-100 px-4 py-1.5 text-xs text-gray-600 transition dark:bg-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-600"
                @click="loadRecords"
              >
                重试
              </button>
            </div>
            <div v-else-if="records.length === 0" class="consumption-empty">
              <div class="i-carbon-receipt mb-2 inline-block text-3xl text-gray-300 dark:text-gray-600" />
              <div>本次在线暂无消费记录</div>
            </div>
            <ul v-else class="consumption-list">
              <li
                v-for="record in records"
                :key="record.id"
                class="consumption-item"
              >
                <div class="consumption-item__icon">
                  <img :src="currencyIcon(record.currency)" alt="" class="h-full w-full object-contain">
                </div>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm text-gray-900 font-semibold dark:text-gray-100">
                    {{ record.title }}
                  </div>
                  <div class="mt-0.5 truncate text-xs text-gray-400">
                    <template v-if="record.detail">
                      {{ record.detail }}
                    </template>
                    <template v-else>
                      —
                    </template>
                    <span v-if="record.ts" class="ml-1">{{ formatRecordTime(record.ts) }}</span>
                  </div>
                </div>
                <div class="shrink-0 text-right">
                  <div class="text-sm text-red-500 font-bold">
                    -{{ record.amount }}
                  </div>
                  <div class="text-xs text-gray-400">
                    {{ record.currencyLabel }}
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.consumption-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(4px);
}

.consumption-modal {
  display: flex;
  width: min(100%, 440px);
  max-height: min(70vh, 560px);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--surface-border);
  border-radius: 20px;
  background: var(--surface-1);
  box-shadow:
    0 18px 56px rgba(15, 23, 42, 0.2),
    0 8px 28px rgba(15, 23, 42, 0.14);
}

.consumption-head {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 12px;
  padding: 18px 18px 14px;
}

.consumption-head__icon {
  display: flex;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: color-mix(in srgb, #ef4444 12%, transparent);
  color: #ef4444;
  font-size: 20px;
}

.consumption-head__title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: var(--theme-text, #1f2937);
  line-height: 1.3;
}

.consumption-head__sub {
  margin: 2px 0 0;
  font-size: 12px;
  color: #94a3b8;
}

.consumption-head__close {
  display: flex;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #94a3b8;
  font-size: 18px;
  cursor: pointer;
  transition:
    background 160ms ease,
    color 160ms ease;
}

.consumption-head__close:hover {
  background: rgba(148, 163, 184, 0.15);
  color: #64748b;
}

.consumption-body {
  min-height: 120px;
  overflow-y: auto;
  padding: 0 12px 14px;
}

.consumption-empty {
  padding: 36px 16px;
  text-align: center;
  font-size: 13px;
  color: #94a3b8;
}

.consumption-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.consumption-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 8px;
  border-radius: 12px;
  transition: background 140ms ease;
}

.consumption-item:hover {
  background: color-mix(in srgb, var(--theme-primary, #10b981) 6%, transparent);
}

.consumption-item__icon {
  display: flex;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: color-mix(in srgb, #f59e0b 12%, transparent);
  padding: 6px;
}

.consumption-enter-active,
.consumption-leave-active {
  transition: opacity 0.2s ease;
}

.consumption-enter-from,
.consumption-leave-to {
  opacity: 0;
}

.consumption-enter-active .consumption-modal,
.consumption-leave-active .consumption-modal {
  transition: transform 0.2s ease;
}

.consumption-enter-from .consumption-modal,
.consumption-leave-to .consumption-modal {
  transform: translateY(10px) scale(0.98);
}
</style>
