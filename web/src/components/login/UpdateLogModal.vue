<script setup lang="ts">
import { marked } from 'marked'
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'

const props = defineProps<{
  show: boolean
  content: string
  loading?: boolean
  error?: string
}>()

const emit = defineEmits<{
  close: []
  retry: []
}>()

type ChangeTag = 'feature' | 'fix' | 'improve' | 'other'

interface ChangeItem {
  id: string
  tag: ChangeTag
  html: string
}

interface ChangeEntry {
  id: string
  version: string
  date: string
  latest: boolean
  items: ChangeItem[]
}

const TAG_LABEL: Record<ChangeTag, string> = {
  feature: '新增',
  fix: '修复',
  improve: '优化',
  other: '其他',
}

// 只有「新增/修复/优化」会显示标签胶囊，命中后把前缀从正文里摘掉，避免标签和文字重复
const PREFIX_RULES: { tag: ChangeTag, pattern: RegExp }[] = [
  { tag: 'feature', pattern: /^(新增|添加|上线|增加)/ },
  { tag: 'fix', pattern: /^(修复|修正|解决)/ },
  { tag: 'improve', pattern: /^(优化|改进|调整|完善)/ },
]

// 只匹配行首「前缀」，正文用 slice + trim 取：避免 \s+ 与 .* 交叠触发 super-linear backtracking
const HEADING_PATTERN = /^\s*#{1,6}\s+/
const LIST_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+/
const DATE_PATTERN = /(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})/
const VERSION_PATTERN = /v?\d+(?:\.\d+)+[a-z0-9]*/i

const RE_AMPERSAND = /&/g
const RE_LESS_THAN = /</g
const RE_GREATER_THAN = />/g
const RE_CRLF = /\r\n?/g

// 链接/图片只放行安全协议；其余（javascript:、data:、vbscript: 等）一律置空。
// 用白名单而不是黑名单，避免 java\tscript: 这类插空字符的绕过写法。
const SAFE_URL_PATTERN = /^(?:https?:|mailto:|tel:|[#/.])/i

marked.use({
  walkTokens(token) {
    if (token.type !== 'link' && token.type !== 'image')
      return
    const href = String(token.href || '').trim()
    if (href && !SAFE_URL_PATTERN.test(href))
      token.href = ''
  },
})

function hashText(text: string) {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1)
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  return (hash >>> 0).toString(36)
}

function escapeHtml(text: string) {
  return text
    .replace(RE_AMPERSAND, '&amp;')
    .replace(RE_LESS_THAN, '&lt;')
    .replace(RE_GREATER_THAN, '&gt;')
}

/**
 * 整段 markdown 渲染前的转义：marked 不会消毒原始 HTML，日志内容又可能来自远端回退源，
 * 不转义就等于把 <script>/onerror 直接插进登录页。
 * 这里刻意只转义 & 和 <：转义 > 会把 markdown 引用块（> 开头）打坏，
 * 而单独一个 > 无法开启标签，不转义是安全的。
 */
function escapeHtmlForMarkdown(text: string) {
  return text
    .replace(RE_AMPERSAND, '&amp;')
    .replace(RE_LESS_THAN, '&lt;')
}

// 条目正文只支持行内 markdown（加粗/行内代码/链接），先把 HTML 实体转义再交给 marked
function renderInline(text: string) {
  try {
    return marked.parseInline(escapeHtml(text), { gfm: true, breaks: false }) as string
  }
  catch {
    return escapeHtml(text)
  }
}

function createItem(entryId: string, index: number, raw: string): ChangeItem {
  let tag: ChangeTag = 'other'
  let text = raw
  for (const rule of PREFIX_RULES) {
    const matched = raw.match(rule.pattern)
    if (!matched)
      continue
    tag = rule.tag
    text = raw.slice(matched[0].length).trim() || raw
    break
  }
  return {
    id: `${entryId}-item-${index}`,
    tag,
    html: renderInline(text),
  }
}

// 「2026/9/1」这类日期补零成 2026/09/01
function formatDate(matched: RegExpMatchArray) {
  const [, year = '', month = '', day = ''] = matched
  return `${year}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`
}

/**
 * 把 UPDATE_LOG.md 这类「# 日期 版本号 + - 条目」的 markdown 解析成结构化版本列表。
 * 解析不出任何条目时返回空数组，由调用方回退到整段渲染。
 */
function parseChangelog(markdown: string): ChangeEntry[] {
  const normalized = String(markdown || '').replace(RE_CRLF, '\n')
  if (!normalized.trim())
    return []

  const result: ChangeEntry[] = []
  let current: ChangeEntry | null = null

  const flush = () => {
    if (current && current.items.length)
      result.push(current)
    current = null
  }

  for (const line of normalized.split('\n')) {
    const heading = line.match(HEADING_PATTERN)
    if (heading) {
      flush()
      const raw = line.slice(heading[0].length).trim()
      const date = raw.match(DATE_PATTERN)
      const version = raw.match(VERSION_PATTERN)
      current = {
        id: `entry-${result.length}-${hashText(raw)}`,
        version: version ? version[0].toUpperCase() : '',
        date: date ? formatDate(date) : '',
        latest: false,
        items: [],
      }
      continue
    }

    const bullet = line.match(LIST_PATTERN)
    const text = (bullet ? line.slice(bullet[0].length) : line).trim()
    if (!text)
      continue

    // 没有标题就出现条目（非标准日志）：兜一个「未标注版本」的条目，别整段丢掉
    if (!current)
      current = { id: `entry-${result.length}-loose`, version: '', date: '', latest: false, items: [] }
    current.items.push(createItem(current.id, current.items.length, text))
  }

  flush()

  // 最新的那条打「最新」标：优先认带版本号的，纯日期标题则退回第一条
  const latestEntry = result.find(entry => entry.version) || result[0]
  if (latestEntry)
    latestEntry.latest = true

  return result
}

const entries = computed(() => parseChangelog(props.content))

const hasEntries = computed(() => entries.value.length > 0)
const currentVersion = computed(() => entries.value.find(entry => entry.version)?.version || '')

const rawHtml = computed(() => {
  if (hasEntries.value || !props.content)
    return ''
  try {
    return marked.parse(escapeHtmlForMarkdown(props.content), { gfm: true, breaks: false }) as string
  }
  catch {
    return escapeHtmlForMarkdown(props.content)
  }
})

let previousBodyOverflow = ''

function handleKeydown(event: KeyboardEvent) {
  // 组件常驻挂载，弹窗没打开时不能响应 Esc，否则会误关
  if (event.key === 'Escape' && props.show)
    emit('close')
}

watch(() => props.show, (open) => {
  if (typeof document === 'undefined')
    return
  if (open) {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return
  }
  document.body.style.overflow = previousBodyOverflow
}, { immediate: true })

onMounted(() => window.addEventListener('keydown', handleKeydown))

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  if (typeof document !== 'undefined')
    document.body.style.overflow = previousBodyOverflow
})
</script>

<template>
  <Teleport to="body">
    <Transition name="ulm">
      <div
        v-if="show"
        class="ulm-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ulm-title"
        @click.self="emit('close')"
      >
        <section class="ulm-panel">
          <header class="ulm-header">
            <div class="ulm-header__main">
              <span class="ulm-header__icon">
                <span class="i-carbon-catalog" />
              </span>
              <h2 id="ulm-title" class="ulm-header__title">
                更新日志
              </h2>
            </div>
            <div class="ulm-header__side">
              <span v-if="currentVersion" class="ulm-header__version">{{ currentVersion }}</span>
              <button
                type="button"
                class="ulm-close"
                aria-label="关闭更新日志"
                title="关闭"
                @click="emit('close')"
              >
                <span class="i-carbon-close" />
              </button>
            </div>
          </header>

          <div class="ulm-body">
            <div v-if="loading" class="ulm-state">
              <span class="ulm-spinner" />
              <span>正在加载更新日志…</span>
            </div>

            <div v-else-if="error" class="ulm-state ulm-state--error">
              <span class="ulm-state__icon i-carbon-warning" />
              <span>{{ error }}</span>
              <button type="button" class="ulm-retry" @click="emit('retry')">
                重试
              </button>
            </div>

            <ol v-else-if="entries.length" class="ulm-timeline">
              <li
                v-for="entry in entries"
                :key="entry.id"
                class="ulm-entry"
                :class="{ 'is-latest': entry.latest }"
              >
                <span class="ulm-entry__dot" />
                <div class="ulm-entry__head">
                  <span class="ulm-entry__version">{{ entry.version || entry.date || '未标注版本' }}</span>
                  <span v-if="entry.version && entry.date" class="ulm-entry__date">{{ entry.date }}</span>
                  <span v-if="entry.latest" class="ulm-entry__latest">最新</span>
                </div>
                <ul class="ulm-items">
                  <li v-for="item in entry.items" :key="item.id" class="ulm-item">
                    <span
                      v-if="item.tag !== 'other'"
                      class="ulm-item__tag"
                      :class="`is-${item.tag}`"
                    >{{ TAG_LABEL[item.tag] }}</span>
                    <span v-else class="ulm-item__bullet" />
                    <span class="ulm-item__text" v-html="item.html" />
                  </li>
                </ul>
              </li>
            </ol>

            <article v-else-if="rawHtml" class="ulm-raw" v-html="rawHtml" />

            <div v-else class="ulm-state">
              <span class="ulm-state__icon i-carbon-document" />
              <span>暂无更新日志。</span>
            </div>
          </div>

          <footer class="ulm-footer">
            <span class="ulm-footer__hint">按 Esc 或点击空白处可关闭</span>
            <button type="button" class="ulm-footer__btn" @click="emit('close')">
              我知道了
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ulm-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(6px);
}

.ulm-panel {
  display: grid;
  /* minmax(0, 1fr)：不加这个，网格项默认 min-width:auto 会被内容（如不换行的头部副标题）
     撑宽整列，面板 overflow:hidden 就把右侧的关闭按钮和筛选胶囊裁掉 */
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(760px, 100%);
  max-height: min(84vh, 780px);
  overflow: hidden;
  background: #fff;
  border: 1px solid #dbe4dc;
  border-radius: 16px;
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.26);
}

/* 三个网格行都允许收缩到轨道宽度以内 */
.ulm-header,
.ulm-body,
.ulm-footer {
  min-width: 0;
}

/* ============== 头部 ============== */
.ulm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  background: linear-gradient(135deg, #f0fdf4 0%, #fff 68%);
  border-bottom: 1px solid #e6efe8;
}

.ulm-header__main {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.ulm-header__icon {
  display: inline-flex;
  flex: 0 0 42px;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  font-size: 22px;
  color: #fff;
  background: linear-gradient(135deg, #22c55e, #0d9488);
  border-radius: 12px;
  box-shadow: 0 6px 16px rgba(22, 163, 74, 0.28);
}

.ulm-header__title {
  min-width: 0;
  margin: 0;
  color: #14532d;
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1.35;
}

.ulm-header__side {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.ulm-header__version {
  padding: 5px 12px;
  color: #166534;
  font-size: 0.78rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  background: #dcfce7;
  border: 1px solid #bbf7d0;
  border-radius: 999px;
}

.ulm-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  color: #64748b;
  font-size: 18px;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 10px;
  transition: 0.18s ease;
}

.ulm-close:hover {
  color: #14532d;
  background: #f0fdf4;
  border-color: #dcfce7;
}

/* ============== 内容区 ============== */
.ulm-body {
  min-height: 0;
  padding: 16px 20px 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.ulm-timeline {
  margin: 0;
  padding: 0;
  list-style: none;
}

.ulm-entry {
  position: relative;
  padding: 0 0 18px 24px;
}

.ulm-entry:last-child {
  padding-bottom: 0;
}

/* 时间线竖线：每个条目一段，最后一条不画 */
.ulm-entry::before {
  content: '';
  position: absolute;
  top: 16px;
  bottom: 0;
  left: 5px;
  width: 2px;
  background: #dfe9e2;
  border-radius: 2px;
}

.ulm-entry:last-child::before {
  display: none;
}

.ulm-entry__dot {
  position: absolute;
  top: 5px;
  left: 0;
  width: 12px;
  height: 12px;
  background: #fff;
  border: 2px solid #cbd5e1;
  border-radius: 50%;
}

.ulm-entry.is-latest .ulm-entry__dot {
  border-color: #16a34a;
  box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.16);
}

.ulm-entry__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 9px;
}

.ulm-entry__version {
  color: #14532d;
  font-size: 0.95rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.ulm-entry__date {
  color: #94a3b8;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

.ulm-entry__latest {
  padding: 2px 8px;
  color: #fff;
  font-size: 0.68rem;
  font-weight: 700;
  background: linear-gradient(135deg, #22c55e, #0d9488);
  border-radius: 5px;
}

.ulm-items {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ulm-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: #1f2937;
  font-size: 0.9rem;
  line-height: 1.65;
}

.ulm-item__tag {
  flex: 0 0 auto;
  margin-top: 2px;
  padding: 2px 9px;
  font-size: 0.74rem;
  font-weight: 700;
  white-space: nowrap;
  border-radius: 5px;
}

.ulm-item__tag.is-feature {
  color: #166534;
  background: #dcfce7;
}

.ulm-item__tag.is-fix {
  color: #b91c1c;
  background: #fee2e2;
}

.ulm-item__tag.is-improve {
  color: #1d4ed8;
  background: #dbeafe;
}

.ulm-item__bullet {
  flex: 0 0 auto;
  width: 5px;
  height: 5px;
  margin-top: 8px;
  background: #cbd5e1;
  border-radius: 50%;
}

.ulm-item__text {
  min-width: 0;
}

.ulm-item__text :deep(strong) {
  color: #1f2937;
  font-weight: 700;
}

.ulm-item__text :deep(a) {
  color: #15803d;
  text-decoration: underline;
}

.ulm-item__text :deep(code) {
  padding: 1px 5px;
  color: #9f1239;
  background: #fff1f2;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.85em;
}

/* 解析不出结构时的整段回退渲染 */
.ulm-raw {
  color: #374151;
  font-size: 0.88rem;
  line-height: 1.72;
}

.ulm-raw :deep(h1) {
  margin: 18px 0 8px;
  color: #166534;
  font-size: 1.3rem;
}

.ulm-raw :deep(h2) {
  margin: 22px 0 10px;
  padding-bottom: 7px;
  color: #1f2937;
  font-size: 1.02rem;
  border-bottom: 1px solid #e5e7eb;
}

.ulm-raw :deep(p) {
  margin: 8px 0;
}

.ulm-raw :deep(ul) {
  display: grid;
  gap: 7px;
  margin: 8px 0;
  padding-left: 20px;
}

.ulm-raw :deep(li::marker) {
  color: #16a34a;
}

.ulm-raw :deep(code) {
  padding: 2px 5px;
  color: #9f1239;
  background: #fff1f2;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.84em;
}

/* ============== 状态占位 ============== */
.ulm-state {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 46px 0;
  color: #64748b;
  font-size: 0.88rem;
  text-align: center;
}

.ulm-state__icon {
  font-size: 26px;
  color: #cbd5e1;
}

.ulm-state--error {
  color: #b91c1c;
}

.ulm-state--error .ulm-state__icon {
  color: #f87171;
}

.ulm-spinner {
  width: 26px;
  height: 26px;
  border: 3px solid #dcfce7;
  border-top-color: #16a34a;
  border-radius: 50%;
  animation: ulm-spin 0.8s linear infinite;
}

@keyframes ulm-spin {
  to {
    transform: rotate(360deg);
  }
}

.ulm-retry {
  padding: 8px 20px;
  color: #fff;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  background: linear-gradient(135deg, #16a34a, #0d9488);
  border: 0;
  border-radius: 8px;
  transition: 0.18s ease;
}

.ulm-retry:hover {
  filter: brightness(1.06);
}

/* ============== 底部 ============== */
.ulm-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 20px;
  background: #f9fbfa;
  border-top: 1px solid #eef3ef;
}

.ulm-footer__hint {
  color: #94a3b8;
  font-size: 0.75rem;
}

.ulm-footer__btn {
  min-width: 96px;
  margin-left: auto;
  padding: 9px 18px;
  color: #fff;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  background: linear-gradient(135deg, #16a34a, #0d9488);
  border: 0;
  border-radius: 8px;
  box-shadow: 0 6px 16px rgba(22, 163, 74, 0.22);
  transition: 0.18s ease;
}

.ulm-footer__btn:hover {
  filter: brightness(1.06);
}

.ulm-footer__btn:active {
  transform: translateY(1px);
}

/* ============== 过渡 ============== */
.ulm-enter-active,
.ulm-leave-active {
  transition: opacity 0.2s ease;
}

.ulm-enter-active .ulm-panel,
.ulm-leave-active .ulm-panel {
  transition: transform 0.2s ease;
}

.ulm-enter-from,
.ulm-leave-to {
  opacity: 0;
}

.ulm-enter-from .ulm-panel,
.ulm-leave-to .ulm-panel {
  transform: translateY(12px);
}

/* ============== 移动端 ============== */
@media (max-width: 640px) {
  /* 移动端阅读为主，字号整体上调一档 */
  .ulm-item {
    font-size: 0.95rem;
    line-height: 1.7;
  }

  .ulm-item__tag {
    margin-top: 3px;
    font-size: 0.76rem;
  }

  .ulm-entry__head {
    margin-bottom: 10px;
  }

  .ulm-entry__version {
    font-size: 1.02rem;
  }

  .ulm-entry__date {
    font-size: 0.8rem;
  }

  .ulm-raw {
    font-size: 0.95rem;
    line-height: 1.78;
  }

  /* 居中紧凑弹窗：不做贴底全屏面板，四周留边 + 四角圆角 + 更低的高度上限 */
  .ulm-overlay {
    align-items: center;
    padding: 24px 20px;
  }

  .ulm-panel {
    width: min(100%, 420px);
    /* dvh 跟随可视高度收缩（避开 iOS 地址栏）；老浏览器回退到 62vh */
    max-height: 62vh;
    max-height: calc(100dvh - 5rem);
    border-radius: 16px;
  }

  .ulm-header {
    padding: 16px;
  }

  .ulm-header__icon {
    flex-basis: 38px;
    width: 38px;
    height: 38px;
    font-size: 20px;
    border-radius: 11px;
  }

  .ulm-body {
    padding: 14px 16px 18px;
  }

  .ulm-entry {
    padding-left: 20px;
  }

  .ulm-entry::before {
    left: 4px;
  }

  .ulm-entry__dot {
    width: 10px;
    height: 10px;
  }

  .ulm-footer {
    /* 避开 iPhone Home 指示条（viewport-fit=cover 后 env() 才生效） */
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  }

  .ulm-footer__hint {
    display: none;
  }

  .ulm-footer__btn {
    flex: 1 1 auto;
  }
}
</style>
