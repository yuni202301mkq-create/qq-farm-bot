<script setup lang="ts">
import type { UserRole } from '@/stores/user'
import axios from 'axios'
import { computed, nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const appStore = useAppStore()
const toast = useToastStore()

type Mode = 'login' | 'register' | 'renew'

const initialMode = computed<Mode>(() => {
  const raw = String(route.query.mode || 'login')
  return raw === 'register' || raw === 'renew' ? raw : 'login'
})

const mode = ref<Mode>(initialMode.value)

const PANEL = {
  login: {
    badge: 'FARM CONTROL CENTER',
    title: ['把农场交给', '更聪明的自动化'],
    desc: '统一管理账号、自动任务与活动奖励，让每一次登录都更简单、更安心。',
    tips: ['实时运行状态', '账号安全守护', '活动奖励不漏过'],
    statusLabel: '当前系统在线',
    statusDot: 'pulse',
  },
  register: {
    badge: 'CREATE ACCOUNT',
    title: ['注册账号', '开启托管之旅'],
    desc: '填写用户名和卡密即可开通 QQ 农场 Bot 账号，卡密决定有效期与可添加账号数。',
    tips: ['卡密即刻生效', '支持中文用户名', '注册后自动登录'],
    statusLabel: '注册通道开放',
    statusDot: 'live',
  },
  renew: {
    badge: 'ACCOUNT RENEWAL',
    title: ['账号续费', '卡密即时生效'],
    desc: '输入用户名和卡密，即可为账号延长有效期或补充可添加账号额度。',
    tips: ['支持时间卡与额度卡', '卡密信息无需准确确认', '续费成功后自动返回登录'],
    statusLabel: '续费通道在线',
    statusDot: 'live',
  },
} as const

const panel = computed(() => PANEL[mode.value])

const username = ref('')
const password = ref('')
const cardKey = ref('')
const showPassword = ref(false)
const loading = ref(false)
const errorMsg = ref('')
const renewResult = ref('')
const passwordRef = ref<HTMLInputElement | null>(null)

// 用户名输入回车后自动聚焦到密码框，提升移动端流畅度
function focusPassword() {
  if (mode.value === 'renew') {
    submit()
    return
  }
  passwordRef.value?.focus()
}

// 密码输入框回车根据模式提交或跳到卡密
function handleEnterSubmit() {
  if (mode.value === 'register') {
    nextTick(() => {
      const cardEl = document.getElementById('auth-card') as HTMLInputElement | null
      cardEl?.focus()
    })
    return
  }
  submit()
}

// 夜间/白天模式，同步全局主题
const useDark = ref(appStore.isDark)

function toggleDark() {
  const nextDark = !useDark.value
  useDark.value = nextDark
  // 同步全局主题：白天 → 清新绿，夜间 → 深海蓝
  appStore.applyTheme(nextDark ? 'dark-blue' : 'light-green')
}

function switchTo(next: Mode) {
  mode.value = next
  errorMsg.value = ''
  renewResult.value = ''
  router.replace({ path: '/login', query: next === 'login' ? {} : { mode: next } })
}

function handleForgotPassword() {
  toast.info('忘记密码？请通过卡密续费或联系管理员重置账号。')
}

function applySession(data: any) {
  userStore.token = String(data.token || '')
  userStore.userInfo = {
    username: String(data.user?.username || ''),
    role: (data.role === 'super_admin' ? 'super_admin' : 'user') as UserRole,
    card: data.card ?? null,
    accountLimit: Number(data.accountLimit || 2),
    expiresAt: data.expiresAt ?? null,
  }
}

async function submit() {
  if (loading.value)
    return
  errorMsg.value = ''
  renewResult.value = ''

  if (mode.value === 'renew') {
    if (!username.value.trim() || !cardKey.value.trim()) {
      errorMsg.value = '请输入用户名和卡密'
      return
    }
  }
  else if (!username.value.trim() || !password.value) {
    errorMsg.value = mode.value === 'register' ? '请输入用户名、密码和卡密' : '请输入用户名和密码'
    return
  }
  if (mode.value === 'register' && !cardKey.value.trim()) {
    errorMsg.value = '注册需要填写卡密'
    return
  }

  loading.value = true
  try {
    if (mode.value === 'login') {
      const { data } = await axios.post('/api/login', {
        username: username.value.trim(),
        password: password.value,
      })
      if (!data?.ok)
        throw new Error(data?.error || '登录失败')
      applySession(data.data)
      router.replace('/')
    }
    else if (mode.value === 'register') {
      const { data } = await axios.post('/api/register', {
        username: username.value.trim(),
        password: password.value,
        cardKey: cardKey.value.trim(),
      })
      if (!data?.ok)
        throw new Error(data?.error || '注册失败')
      applySession(data.data)
      router.replace('/')
    }
    else {
      const { data } = await axios.post('/api/renew', {
        username: username.value.trim(),
        cardKey: cardKey.value.trim(),
      })
      if (!data?.ok)
        throw new Error(data?.error || '续费失败')
      const d = data.data
      renewResult.value = `续费成功：已为 ${d.username} 增加 ${d.days} 天，请重新登录`
      cardKey.value = ''
    }
  }
  catch (error: any) {
    errorMsg.value = error?.response?.data?.error || error?.message || '操作失败，请稍后重试'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div
    class="auth-shell"
    :class="{ 'is-dark': useDark }"
  >
    <!-- 背景装饰：渐进式柔和光晕 -->
    <div class="bg-blob bg-blob--emerald" />
    <div class="bg-blob bg-blob--amber" />
    <div class="bg-blob bg-blob--mint" />

    <!-- 右上角夜间/白天切换按钮 -->
    <button
      type="button"
      class="theme-toggle"
      :aria-label="useDark ? '切换到白天模式' : '切换到夜间模式'"
      @click="toggleDark"
    >
      <span class="theme-toggle__icon" :class="useDark ? 'i-carbon-sun' : 'i-carbon-moon'" />
      <span class="theme-toggle__label">{{ useDark ? '夜间' : '白天' }}</span>
    </button>

    <div class="auth-card">
      <!-- 左侧品牌区 -->
      <aside class="brand-side">
        <div class="brand-side__inner">
          <div class="brand-side__badge">
            <span class="dot" /> {{ panel.badge }}
          </div>

          <div class="brand-side__hero">
            <h1 class="brand-side__title">
              <span v-for="line in panel.title" :key="line" class="brand-side__title-line">
                {{ line }}
              </span>
            </h1>
            <p class="brand-side__desc">
              {{ panel.desc }}
            </p>
          </div>

          <div class="brand-side__foot">
            <ul class="brand-side__tips">
              <li v-for="tip in panel.tips" :key="tip" class="brand-side__tip">
                <span class="brand-side__tip-dot" />
                <span>{{ tip }}</span>
              </li>
            </ul>

            <div class="brand-side__status">
              <span class="brand-side__status-line" />
              <span class="brand-side__status-dot" />
              <span class="brand-side__status-label">{{ panel.statusLabel }}</span>
            </div>
          </div>
        </div>
      </aside>

      <!-- 右侧表单区 -->
      <section class="form-side">
        <header class="form-side__head">
          <div class="form-side__brand">
            <div>
              <div class="form-side__brand-title">
                QQ农场 Bot
              </div>
              <div class="form-side__brand-sub">
                {{ mode === 'login'
                  ? '轻松管理农场，安心享受收获'
                  : mode === 'register'
                    ? '填写信息与卡密即可开通账号'
                    : '填写用户名和卡密，完成账号续费' }}
              </div>
            </div>
          </div>
        </header>

        <!-- 模式标签 -->
        <div v-if="mode !== 'login'" class="form-side__mode-tag">
          <span :class="mode === 'register' ? 'i-carbon-user-follow' : 'i-carbon-search-locate'" class="text-base" />
          <span>{{ mode === 'register' ? '注册新号' : '使用卡密续费' }}</span>
        </div>

        <form class="form-side__form" @submit.prevent="submit">
          <div class="form-side__field">
            <label class="form-side__label" for="auth-username">用户名</label>
            <input
              id="auth-username"
              v-model="username"
              v-model.lazy="username"
              type="text"
              autocomplete="username"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              inputmode="text"
              enterkeyhint="next"
              placeholder="请输入用户名"
              class="form-side__input"
              @keydown.enter.prevent="focusPassword"
            >
          </div>

          <div v-if="mode !== 'renew'" class="form-side__field">
            <label class="form-side__label" for="auth-password">
              {{ mode === 'register' ? '设置登录密码' : '密码' }}
            </label>
            <div class="form-side__input-wrap">
              <input
                id="auth-password"
                ref="passwordRef"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                inputmode="text"
                :enterkeyhint="mode === 'register' ? 'next' : 'done'"
                placeholder="请输入密码"
                class="form-side__input form-side__input--with-icon"
                @keydown.enter.prevent="handleEnterSubmit"
              >
              <button
                type="button"
                class="form-side__eye"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                @click="showPassword = !showPassword"
              >
                <span :class="showPassword ? 'i-carbon-view-off' : 'i-carbon-view'" />
              </button>
            </div>
          </div>

          <div v-if="mode !== 'login'" class="form-side__field">
            <label class="form-side__label" for="auth-card">卡密</label>
            <input
              id="auth-card"
              v-model="cardKey"
              v-model.lazy="cardKey"
              type="text"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              inputmode="text"
              enterkeyhint="done"
              placeholder="请输入卡密"
              class="form-side__input"
              @keydown.enter.prevent="submit"
            >
            <p class="form-side__hint">
              {{ mode === 'register'
                ? '注册卡密与充值卡密是两种卡，请分开办理'
                : '卡密注册后立即生效，有效期自动叠加' }}
            </p>
          </div>

          <p v-if="errorMsg" class="form-side__alert form-side__alert--error">
            <span class="i-carbon-warning" />
            <span>{{ errorMsg }}</span>
          </p>
          <p v-if="renewResult" class="form-side__alert form-side__alert--success">
            <span class="i-carbon-checkmark-filled" />
            <span>{{ renewResult }}</span>
          </p>

          <button
            type="submit"
            :disabled="loading"
            class="form-side__submit"
          >
            <span v-if="loading" class="i-svg-spinners-90-ring-with-bg" />
            <span>{{ mode === 'login'
              ? '进入农场'
              : mode === 'register'
                ? '完成注册'
                : '立即续费' }}</span>
          </button>
        </form>

        <div class="form-side__links">
          <button
            type="button"
            class="form-side__link"
            :class="{ 'is-active': mode === 'register' }"
            @click="switchTo('register')"
          >
            注册新号
          </button>
          <span class="form-side__sep">·</span>
          <button
            type="button"
            class="form-side__link"
            @click="handleForgotPassword"
          >
            忘记密码
          </button>
          <span class="form-side__sep">·</span>
          <button
            type="button"
            class="form-side__link"
            :class="{ 'is-active': mode === 'renew' }"
            @click="switchTo('renew')"
          >
            账号续费
          </button>
          <template v-if="mode !== 'login'">
            <span class="form-side__sep">·</span>
            <button
              type="button"
              class="form-side__link"
              @click="switchTo('login')"
            >
              返回登录
            </button>
          </template>
        </div>

        <div class="form-side__divider" />

        <div class="form-side__footer">
          <div class="form-side__version">
            <span class="i-carbon-time" />
            <span>更新日志 · V2.5.4</span>
          </div>
          <div class="form-side__build">
            游戏版本 1.13.3.11, 20260826
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* ============== Shell ============== */
.auth-shell {
  position: relative;
  min-height: 100vh;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  overflow: hidden;
  font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background:
    radial-gradient(ellipse 60% 50% at 18% 50%, rgba(16, 185, 129, 0.18) 0%, transparent 60%),
    radial-gradient(ellipse 50% 50% at 82% 50%, rgba(251, 191, 36, 0.18) 0%, transparent 60%),
    linear-gradient(135deg, #ecfdf5 0%, #f0fdfa 50%, #fef9c3 100%);
  color: #14532d;
  transition: background 600ms ease, color 400ms ease;
}

.auth-shell.is-dark {
  background:
    radial-gradient(ellipse 60% 50% at 18% 50%, rgba(16, 185, 129, 0.22) 0%, transparent 60%),
    radial-gradient(ellipse 50% 50% at 82% 50%, rgba(251, 191, 36, 0.10) 0%, transparent 60%),
    linear-gradient(135deg, #052e16 0%, #0b1410 50%, #1c1917 100%);
  color: #d1fae5;
}

/* 背景模糊光斑 */
.bg-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.55;
  pointer-events: none;
  transition: opacity 600ms ease;
}
.bg-blob--emerald {
  width: 520px;
  height: 520px;
  top: -120px;
  left: -160px;
  background: radial-gradient(circle, rgba(16, 185, 129, 0.45), transparent 70%);
}
.bg-blob--amber {
  width: 480px;
  height: 480px;
  top: -80px;
  right: -120px;
  background: radial-gradient(circle, rgba(252, 211, 77, 0.5), transparent 70%);
}
.bg-blob--mint {
  width: 600px;
  height: 600px;
  bottom: -200px;
  left: 35%;
  background: radial-gradient(circle, rgba(110, 231, 183, 0.4), transparent 70%);
}
.is-dark .bg-blob {
  opacity: 0.35;
}

/* ============== Theme Toggle ============== */
.theme-toggle {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 30;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 10px 25px rgba(15, 23, 42, 0.08);
  color: #14532d;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 280ms ease;
}
.theme-toggle:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.12);
  background: rgba(255, 255, 255, 0.9);
}
.theme-toggle__icon {
  font-size: 16px;
  display: inline-block;
}
.is-dark .theme-toggle {
  background: rgba(15, 23, 42, 0.6);
  border-color: rgba(148, 163, 184, 0.25);
  color: #e2e8f0;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
}
.is-dark .theme-toggle:hover {
  background: rgba(15, 23, 42, 0.75);
}

/* ============== Card ============== */
.auth-card {
  position: relative;
  z-index: 1;
  display: flex;
  width: 100%;
  max-width: 960px;
  min-height: 560px;
  border-radius: 28px;
  overflow: hidden;
  background: #ffffff;
  box-shadow:
    0 30px 60px -15px rgba(6, 95, 70, 0.18),
    0 18px 36px -18px rgba(6, 95, 70, 0.18),
    0 0 0 1px rgba(255, 255, 255, 0.4);
  transition: background 400ms ease, box-shadow 400ms ease;
}
.is-dark .auth-card {
  background: #111c17;
  box-shadow:
    0 30px 60px -15px rgba(0, 0, 0, 0.55),
    0 18px 36px -18px rgba(0, 0, 0, 0.4),
    0 0 0 1px rgba(148, 163, 184, 0.08);
}

/* ============== Brand Side (Left) ============== */
.brand-side {
  position: relative;
  width: 46%;
  color: #ecfdf5;
  background:
    radial-gradient(ellipse 80% 60% at 80% 20%, rgba(110, 231, 183, 0.4), transparent 60%),
    radial-gradient(ellipse 70% 60% at 0% 100%, rgba(20, 83, 45, 0.6), transparent 60%),
    linear-gradient(160deg, #064e3b 0%, #047857 55%, #065f46 100%);
  overflow: hidden;
}
.brand-side::before {
  /* 顶部细圆环装饰，呼应参考图 */
  content: '';
  position: absolute;
  width: 280px;
  height: 280px;
  border-radius: 50%;
  border: 1px solid rgba(167, 243, 208, 0.35);
  top: -90px;
  right: -90px;
}
.brand-side::after {
  content: '';
  position: absolute;
  width: 360px;
  height: 360px;
  border-radius: 50%;
  border: 1px solid rgba(167, 243, 208, 0.18);
  bottom: -160px;
  left: -120px;
}
.is-dark .brand-side {
  background:
    radial-gradient(ellipse 80% 60% at 80% 20%, rgba(110, 231, 183, 0.22), transparent 60%),
    radial-gradient(ellipse 70% 60% at 0% 100%, rgba(2, 44, 34, 0.8), transparent 60%),
    linear-gradient(160deg, #022c22 0%, #064e3b 55%, #052e16 100%);
}

.brand-side__inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
  padding: 44px 40px;
  min-height: 560px;
}

.brand-side__badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  letter-spacing: 0.3em;
  color: rgba(167, 243, 208, 0.85);
  font-weight: 600;
}
.brand-side__badge .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6ee7b7;
  box-shadow: 0 0 8px rgba(110, 231, 183, 0.8);
}

.brand-side__hero {
  margin-top: 32px;
}

.brand-side__title {
  font-size: 34px;
  line-height: 1.2;
  font-weight: 700;
  color: #ffffff;
  margin: 0;
  letter-spacing: -0.01em;
}
.brand-side__title-line {
  display: block;
}

.brand-side__desc {
  margin-top: 18px;
  font-size: 13px;
  line-height: 1.75;
  color: rgba(209, 250, 229, 0.85);
  max-width: 320px;
}

.brand-side__foot {
  margin-top: 40px;
}

.brand-side__tips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}
.brand-side__tip {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: rgba(236, 253, 245, 0.92);
}
.brand-side__tip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #6ee7b7;
  box-shadow: 0 0 0 4px rgba(110, 231, 183, 0.18);
  flex-shrink: 0;
}

.brand-side__status {
  margin-top: 28px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.brand-side__status-line {
  width: 28px;
  height: 1px;
  background: rgba(167, 243, 208, 0.6);
}
.brand-side__status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.25);
  animation: statusPulse 2.2s ease-in-out infinite;
}
.brand-side__status-label {
  font-size: 12px;
  color: rgba(209, 250, 229, 0.85);
  letter-spacing: 0.02em;
}

@keyframes statusPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.45); }
  50% { box-shadow: 0 0 0 8px rgba(52, 211, 153, 0); }
}

/* ============== Form Side (Right) ============== */
.form-side {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 44px 48px;
  background: #ffffff;
  color: #1f2937;
}
.is-dark .form-side {
  background: #111c17;
  color: #e2e8f0;
}

.form-side__head {
  margin-bottom: 24px;
}

.form-side__brand {
  display: flex;
  align-items: center;
  gap: 14px;
}
.form-side__brand-title {
  font-size: 17px;
  font-weight: 700;
  color: #111827;
  line-height: 1.2;
}
.is-dark .form-side__brand-title {
  color: #f1f5f9;
}
.form-side__brand-sub {
  margin-top: 3px;
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.4;
}
.is-dark .form-side__brand-sub {
  color: #94a3b8;
}

.form-side__mode-tag {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 18px;
  padding: 8px 14px;
  border-radius: 12px;
  background: rgba(16, 185, 129, 0.1);
  color: #047857;
  font-size: 13px;
  font-weight: 500;
}
.is-dark .form-side__mode-tag {
  background: rgba(16, 185, 129, 0.15);
  color: #6ee7b7;
}

.form-side__form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-side__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-side__label {
  font-size: 12px;
  color: #6b7280;
  font-weight: 500;
}
.is-dark .form-side__label {
  color: #94a3b8;
}

.form-side__input {
  width: 100%;
  padding: 11px 14px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #ffffff;
  font-size: 14px;
  color: #111827;
  outline: none;
  transition: all 200ms ease;
  font-family: inherit;
  -webkit-appearance: none;
  appearance: none;
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
  /* iOS 上阻止点击输入框时的灰块高亮 */
  touch-action: manipulation;
}
.form-side__input::placeholder {
  color: #9ca3af;
}
.form-side__input:focus {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
  background: #ffffff;
}
.form-side__input--with-icon {
  padding-right: 40px;
}
.is-dark .form-side__input {
  background: rgba(15, 23, 42, 0.45);
  border-color: rgba(148, 163, 184, 0.2);
  color: #e2e8f0;
}
.is-dark .form-side__input::placeholder {
  color: #64748b;
}
.is-dark .form-side__input:focus {
  border-color: #34d399;
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.2);
  background: rgba(15, 23, 42, 0.6);
}

.form-side__input-wrap {
  position: relative;
}
.form-side__eye {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: #9ca3af;
  cursor: pointer;
  transition: color 180ms ease;
}
.form-side__eye:hover {
  color: #047857;
}
.is-dark .form-side__eye:hover {
  color: #6ee7b7;
}

.form-side__hint {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 2px;
  line-height: 1.4;
}

.form-side__alert {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
}
.form-side__alert--error {
  background: #fef2f2;
  color: #b91c1c;
}
.form-side__alert--success {
  background: #ecfdf5;
  color: #047857;
}
.is-dark .form-side__alert--error {
  background: rgba(239, 68, 68, 0.12);
  color: #fca5a5;
}
.is-dark .form-side__alert--success {
  background: rgba(16, 185, 129, 0.15);
  color: #6ee7b7;
}

.form-side__submit {
  margin-top: 6px;
  width: 100%;
  height: 46px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #047857 0%, #065f46 100%);
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow:
    0 10px 20px -8px rgba(6, 95, 70, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
  transition: transform 160ms ease, box-shadow 200ms ease, opacity 200ms ease;
}
.form-side__submit:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    0 14px 26px -8px rgba(6, 95, 70, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}
.form-side__submit:active:not(:disabled) {
  transform: translateY(0);
}
.form-side__submit:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.form-side__links {
  margin-top: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  font-size: 12px;
}
.form-side__link {
  border: none;
  background: none;
  color: #047857;
  cursor: pointer;
  font-size: 12px;
  transition: color 160ms ease, font-weight 160ms ease;
  padding: 0;
}
.form-side__link:hover {
  color: #064e3b;
}
.form-side__link.is-active {
  font-weight: 600;
}
.is-dark .form-side__link {
  color: #6ee7b7;
}
.is-dark .form-side__link:hover {
  color: #a7f3d0;
}
.form-side__sep {
  color: #e5e7eb;
}
.is-dark .form-side__sep {
  color: rgba(148, 163, 184, 0.3);
}

.form-side__divider {
  margin-top: 22px;
  height: 1px;
  background: linear-gradient(90deg, transparent, #e5e7eb, transparent);
}
.is-dark .form-side__divider {
  background: linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.2), transparent);
}

.form-side__footer {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.form-side__version {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #047857;
  font-weight: 500;
}
.is-dark .form-side__version {
  color: #6ee7b7;
}
.form-side__build {
  font-size: 11px;
  color: #94a3b8;
}

/* ============== Responsive ============== */
@media (max-width: 860px) {
  .auth-card {
    flex-direction: column;
    max-width: 440px;
    min-height: 0;
  }
  .brand-side {
    width: 100%;
  }
  .brand-side__inner {
    min-height: 0;
    padding: 32px 28px 28px;
  }
  .brand-side__title {
    font-size: 26px;
  }
  .brand-side__hero {
    margin-top: 20px;
  }
  .brand-side__foot {
    margin-top: 24px;
  }
  .form-side {
    padding: 32px 28px;
  }
}

@media (max-width: 480px) {
  .auth-shell {
    padding: 16px;
    /* iOS 软键盘弹出时容器滚动到底部也能露出来 */
    -webkit-overflow-scrolling: touch;
  }
  .theme-toggle {
    top: 12px;
    right: 12px;
    padding: 8px 14px;
    font-size: 12px;
  }
  .form-side__input {
    /* 关键：>=16px 避免 iOS Safari 在聚焦时自动放大页面 */
    font-size: 16px;
    padding: 12px 14px;
  }
  .form-side__form {
    /* 键盘弹起时，input 滚动到视野的偏移量 */
    scroll-padding-bottom: 40vh;
  }
  /* iOS 上 form 容器需要可滚动，否则键盘弹出时输入框会被遮挡 */
  .auth-card {
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
}
</style>