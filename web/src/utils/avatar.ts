/**
 * 头像统一走后端代理（同源 /api/avatar/*）：
 * 1. 生产 CSP 的 img-src 只放行同源，直连腾讯头像域会被整个拦掉；
 * 2. 腾讯 qlogo.cn 对非 QQ 来源 Referer 返回 0 字节占位图，代理在服务端带
 *    Referer: https://im.qq.com/ 拉真实图片。
 * 代理侧 SSRF 护栏只放行腾讯头像域，这里传入的 URL 会先经过 base64url 编码。
 */

function encodeBase64Url(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 账号头像：按账号 id 走代理，后端负责 uin 兜底（acc.uin / acc.qq → q1.qlogo.cn） */
export function accountAvatarUrl(acc?: { id?: unknown } | null) {
  const id = String(acc?.id ?? '').trim()
  return id ? `/api/avatar/${id}` : ''
}

/** QQ 号头像：按纯数字 QQ 号走代理 */
export function qqAvatarUrl(uin?: unknown) {
  const qq = String(uin ?? '').trim()
  return /^\d+$/.test(qq) ? `/api/avatar/qq/${qq}` : ''
}

/** 远程头像 URL（好友列表等接口下发的 thirdqq.qlogo.cn 地址）：编码后走代理 */
export function remoteAvatarUrl(url?: unknown) {
  const raw = String(url ?? '').trim()
  if (!raw)
    return ''
  return `/api/avatar/u/${encodeBase64Url(raw)}`
}

/** 通用入口：优先用接口下发的头像 URL，否则按 QQ 号兜底 */
export function resolveAvatarUrl(source: { avatarUrl?: unknown, avatar?: unknown, uin?: unknown }) {
  const direct = remoteAvatarUrl(source.avatarUrl || source.avatar)
  if (direct)
    return direct
  return qqAvatarUrl(source.uin)
}
