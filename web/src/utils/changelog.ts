import { marked } from 'marked'

/**
 * 更新日志（markdown）解析与渲染，供 UpdateLogModal（登录自动弹出）和
 * UpdateLog 页面（底部导航「更多」入口）共用，避免两处逻辑漂移。
 */

export type ChangeTag = 'feature' | 'fix' | 'improve' | 'other'

export interface ChangeItem {
  id: string
  tag: ChangeTag
  html: string
}

export interface ChangeEntry {
  id: string
  version: string
  date: string
  latest: boolean
  items: ChangeItem[]
}

export const CHANGE_TAG_LABEL: Record<ChangeTag, string> = {
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
 * 不转义就等于把 <script>/onerror 直接插进页面。
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
export function parseChangelog(markdown: string): ChangeEntry[] {
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

/** 解析不出结构时的整段回退渲染（已转义原始 HTML） */
export function renderChangelogRawHtml(markdown: string): string {
  if (!markdown)
    return ''
  try {
    return marked.parse(escapeHtmlForMarkdown(markdown), { gfm: true, breaks: false }) as string
  }
  catch {
    return escapeHtmlForMarkdown(markdown)
  }
}
