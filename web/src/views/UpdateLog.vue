<script setup lang="ts">
import axios from 'axios'
import { computed, onMounted, ref } from 'vue'
import { CHANGE_TAG_LABEL, parseChangelog, renderChangelogRawHtml } from '@/utils/changelog'

const TAG_LABEL = CHANGE_TAG_LABEL

const content = ref('')
const loading = ref(false)
const error = ref('')

async function load() {
  if (loading.value)
    return
  loading.value = true
  error.value = ''
  try {
    const { data } = await axios.get('/api/changelog')
    if (!data?.ok)
      throw new Error(data?.error || '获取更新日志失败')
    content.value = String(data.data || '')
  }
  catch (err: any) {
    error.value = err?.response?.data?.error || err?.message || '获取更新日志失败'
  }
  finally {
    loading.value = false
  }
}

onMounted(load)

const entries = computed(() => parseChangelog(content.value))
const hasEntries = computed(() => entries.value.length > 0)
const currentVersion = computed(() => entries.value.find(entry => entry.version)?.version || '')

const rawHtml = computed(() => {
  if (hasEntries.value || !content.value)
    return ''
  return renderChangelogRawHtml(content.value)
})
</script>

<template>
  <div class="mx-auto max-w-3xl w-full">
    <!-- 页头 -->
    <header class="page-header mb-4 flex items-center gap-3 rounded-2xl p-4">
      <span class="page-header__icon h-11 w-11 flex flex-none items-center justify-center rounded-2xl text-[22px] text-white">
        <span class="i-carbon-catalog" />
      </span>
      <div class="min-w-0 flex-1">
        <h1 class="m-0 truncate text-lg text-gray-900 font-bold dark:text-gray-100">
          更新日志
        </h1>
        <p class="m-0 truncate text-xs text-gray-500 dark:text-gray-400">
          系统版本迭代记录
        </p>
      </div>
      <span
        v-if="currentVersion"
        class="page-header__version shrink-0 rounded-full px-3 py-1 text-xs font-bold tabular-nums"
      >{{ currentVersion }}</span>
      <button
        type="button"
        class="page-header__refresh h-10 w-10 flex flex-none cursor-pointer items-center justify-center rounded-xl transition"
        title="刷新"
        :disabled="loading"
        @click="load"
      >
        <span class="i-carbon-renew text-lg" :class="{ 'animate-spin': loading }" />
      </button>
    </header>

    <!-- 加载中 -->
    <div v-if="loading" class="state grid justify-items-center gap-2.5 py-14 text-sm text-gray-500 dark:text-gray-400">
      <span class="state__spinner" />
      <span>正在加载更新日志…</span>
    </div>

    <!-- 加载失败 -->
    <div v-else-if="error" class="state state--error grid justify-items-center gap-2.5 py-14 text-sm">
      <span class="i-carbon-warning text-2xl" />
      <span>{{ error }}</span>
      <button type="button" class="retry cursor-pointer rounded-lg px-5 py-2 text-sm text-white font-bold transition" @click="load">
        重试
      </button>
    </div>

    <!-- 时间线 -->
    <ol v-else-if="entries.length" class="timeline m-0 list-none p-0">
      <li
        v-for="entry in entries"
        :key="entry.id"
        class="entry relative pb-5 pl-6 last:pb-0"
        :class="{ 'is-latest': entry.latest }"
      >
        <span class="entry__dot absolute left-0 top-1.5 h-3 w-3 border-2 rounded-full bg-white dark:bg-gray-900" />
        <div class="mb-2.5 flex flex-wrap items-center gap-2">
          <span class="entry__version text-base text-gray-900 font-extrabold tabular-nums dark:text-gray-100">
            {{ entry.version || entry.date || '未标注版本' }}
          </span>
          <span v-if="entry.version && entry.date" class="text-xs text-gray-400 tabular-nums dark:text-gray-500">
            {{ entry.date }}
          </span>
          <span v-if="entry.latest" class="entry__latest rounded px-2 py-0.5 text-[11px] text-white font-bold">最新</span>
        </div>
        <ul class="grid m-0 list-none gap-1.5 p-0">
          <li v-for="item in entry.items" :key="item.id" class="flex items-start gap-2 text-sm text-gray-700 leading-relaxed dark:text-gray-300">
            <span
              v-if="item.tag !== 'other'"
              class="entry__tag mt-0.5 shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-xs font-bold"
              :class="`is-${item.tag}`"
            >{{ TAG_LABEL[item.tag] }}</span>
            <span v-else class="entry__bullet mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600" />
            <span class="entry__text min-w-0" v-html="item.html" />
          </li>
        </ul>
      </li>
    </ol>

    <!-- 整段回退渲染 -->
    <article v-else-if="rawHtml" class="raw text-sm text-gray-700 leading-relaxed dark:text-gray-300" v-html="rawHtml" />

    <!-- 空数据 -->
    <div v-else class="state grid justify-items-center gap-2.5 py-14 text-sm text-gray-500 dark:text-gray-400">
      <span class="i-carbon-document text-2xl" />
      <span>暂无更新日志。</span>
    </div>
  </div>
</template>

<style scoped>
/* ===== 页头 ===== */
.page-header {
  background: linear-gradient(135deg, #f0fdf4 0%, transparent 70%);
  border: 1px solid var(--surface-border);
  background-color: color-mix(in srgb, var(--surface-1) 92%, transparent);
}
.dark .page-header {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, transparent 70%);
}

.page-header__icon {
  background: linear-gradient(135deg, #22c55e, #0d9488);
  box-shadow: 0 6px 16px rgba(22, 163, 74, 0.28);
}

.page-header__version {
  color: #166534;
  background: #dcfce7;
  border: 1px solid #bbf7d0;
}
.dark .page-header__version {
  color: #86efac;
  background: rgba(34, 197, 94, 0.14);
  border-color: rgba(34, 197, 94, 0.3);
}

.page-header__refresh {
  color: #64748b;
  background: transparent;
  border: 1px solid transparent;
}
.page-header__refresh:hover {
  color: #14532d;
  background: #f0fdf4;
  border-color: #dcfce7;
}
.dark .page-header__refresh {
  color: #94a3b8;
}
.dark .page-header__refresh:hover {
  color: #bbf7d0;
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.25);
}
.page-header__refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ===== 时间线 ===== */
.entry::before {
  content: '';
  position: absolute;
  top: 18px;
  bottom: 0;
  left: 5px;
  width: 2px;
  background: #dfe9e2;
  border-radius: 2px;
}
.dark .entry::before {
  background: rgba(148, 163, 184, 0.25);
}
.entry:last-child::before {
  display: none;
}

.entry__dot {
  border-color: #cbd5e1;
}
.entry.is-latest .entry__dot {
  border-color: #16a34a;
  box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.16);
}
.dark .entry.is-latest .entry__dot {
  border-color: #4ade80;
  background: #052e16;
}

.entry__latest {
  background: linear-gradient(135deg, #22c55e, #0d9488);
}

.entry__tag.is-feature {
  color: #166534;
  background: #dcfce7;
}
.entry__tag.is-fix {
  color: #b91c1c;
  background: #fee2e2;
}
.entry__tag.is-improve {
  color: #1d4ed8;
  background: #dbeafe;
}
.dark .entry__tag.is-feature {
  color: #86efac;
  background: rgba(34, 197, 94, 0.14);
}
.dark .entry__tag.is-fix {
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.14);
}
.dark .entry__tag.is-improve {
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.14);
}

.entry__text :deep(strong) {
  font-weight: 700;
  color: #1f2937;
}
.dark .entry__text :deep(strong) {
  color: #f3f4f6;
}
.entry__text :deep(a) {
  color: #15803d;
  text-decoration: underline;
}
.dark .entry__text :deep(a) {
  color: #4ade80;
}
.entry__text :deep(code) {
  padding: 1px 5px;
  color: #9f1239;
  background: #fff1f2;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.85em;
}
.dark .entry__text :deep(code) {
  color: #fda4af;
  background: rgba(244, 63, 94, 0.12);
}

/* ===== 状态占位 ===== */
.state--error {
  color: #b91c1c;
}
.dark .state--error {
  color: #f87171;
}

.state__spinner {
  width: 26px;
  height: 26px;
  border: 3px solid #dcfce7;
  border-top-color: #16a34a;
  border-radius: 50%;
  animation: ulg-spin 0.8s linear infinite;
}

@keyframes ulg-spin {
  to {
    transform: rotate(360deg);
  }
}

.retry {
  background: linear-gradient(135deg, #16a34a, #0d9488);
}

/* ===== 回退渲染 ===== */
.raw :deep(h1) {
  margin: 18px 0 8px;
  color: #166534;
  font-size: 1.3rem;
}
.raw :deep(h2) {
  margin: 22px 0 10px;
  padding-bottom: 7px;
  color: #1f2937;
  font-size: 1.02rem;
  border-bottom: 1px solid #e5e7eb;
}
.dark .raw :deep(h1) {
  color: #4ade80;
}
.dark .raw :deep(h2) {
  color: #f3f4f6;
  border-color: #374151;
}
.raw :deep(p) {
  margin: 8px 0;
}
.raw :deep(ul) {
  display: grid;
  gap: 7px;
  margin: 8px 0;
  padding-left: 20px;
}
.raw :deep(li::marker) {
  color: #16a34a;
}
.raw :deep(code) {
  padding: 2px 5px;
  color: #9f1239;
  background: #fff1f2;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.84em;
}
.dark .raw :deep(code) {
  color: #fda4af;
  background: rgba(244, 63, 94, 0.12);
}
</style>
