<script setup lang="ts">
import axios from 'axios'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  close: []
  success: [username: string]
}>()

type Step = 'verify' | 'reset' | 'done'

const step = ref<Step>('verify')
const cardKey = ref('')
const username = ref('')
const resetToken = ref('')
const expiresAt = ref(0)
const newPassword = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const verifying = ref(false)
const resetting = ref(false)
const errorMsg = ref('')
// 本地锁定冷却：后端 429 时按返回的分钟数倒计时禁用按钮，到点后允许重试（仍由服务端最终裁决）
const lockUntil = ref(0)

// 5 分钟重置凭据倒计时：单个弹窗实例用一个 setInterval 即可，不必复用共享时钟
const now = ref(Date.now())
let tickTimer: number | null = null

function startTick() {
  if (tickTimer !== null)
    return
  now.value = Date.now()
  tickTimer = window.setInterval(() => {
    now.value = Date.now()
  }, 1000)
}

function stopTick() {
  if (tickTimer !== null) {
    window.clearInterval(tickTimer)
    tickTimer = null
  }
}

const remainingSec = computed(() => Math.max(0, Math.round((expiresAt.value - now.value) / 1000)))
const countdownText = computed(() => {
  const m = Math.floor(remainingSec.value / 60)
  const s = remainingSec.value % 60
  return `${m}:${String(s).padStart(2, '0')}`
})

const locked = computed(() => lockUntil.value > now.value)

const newRef = ref<HTMLInputElement | null>(null)
const confirmRef = ref<HTMLInputElement | null>(null)

function focusNew() {
  nextTick(() => newRef.value?.focus())
}
function focusConfirm() {
  nextTick(() => confirmRef.value?.focus())
}

function parseLockMinutes(msg: string): number {
  const m = msg.match(/约\s*(\d+)\s*分钟/)
  return m ? Number(m[1]) : 10
}

async function verify() {
  if (verifying.value || locked.value)
    return
  errorMsg.value = ''
  if (!cardKey.value.trim()) {
    errorMsg.value = '请输入卡密'
    return
  }
  verifying.value = true
  try {
    const { data } = await axios.post('/api/forgot-password/verify', { cardKey: cardKey.value.trim() })
    if (!data?.ok)
      throw new Error(data?.error || '验证失败')
    username.value = String(data.data.username || '')
    resetToken.value = String(data.data.resetToken || '')
    expiresAt.value = Date.now() + Number(data.data.expiresInSec || 300) * 1000
    step.value = 'reset'
    newPassword.value = ''
    confirmPassword.value = ''
    startTick()
    focusNew()
  }
  catch (e: any) {
    const msg = e?.response?.data?.error || e?.message || '验证失败，请稍后重试'
    errorMsg.value = msg
    if (e?.response?.status === 429) {
      lockUntil.value = Date.now() + parseLockMinutes(msg) * 60 * 1000
      startTick()
    }
  }
  finally {
    verifying.value = false
  }
}

async function reset() {
  if (resetting.value || locked.value)
    return
  errorMsg.value = ''
  if (!newPassword.value) {
    errorMsg.value = '请输入新密码'
    return
  }
  if (newPassword.value.length < 6) {
    errorMsg.value = '新密码至少 6 位'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    errorMsg.value = '两次输入的新密码不一致'
    return
  }
  resetting.value = true
  try {
    const { data } = await axios.post('/api/forgot-password/reset', {
      resetToken: resetToken.value,
      newPassword: newPassword.value,
    })
    if (!data?.ok)
      throw new Error(data?.error || '重置失败')
    step.value = 'done'
  }
  catch (e: any) {
    const msg = e?.response?.data?.error || e?.message || '重置失败，请稍后重试'
    errorMsg.value = msg
    if (e?.response?.status === 429) {
      lockUntil.value = Date.now() + parseLockMinutes(msg) * 60 * 1000
      startTick()
    }
    else if (/重新验证卡密/.test(msg)) {
      // 凭据失效（过期/已被使用）：退回步骤一重新验证
      step.value = 'verify'
      resetToken.value = ''
      expiresAt.value = 0
      stopTick()
    }
  }
  finally {
    resetting.value = false
  }
}

function reVerify() {
  step.value = 'verify'
  resetToken.value = ''
  expiresAt.value = 0
  newPassword.value = ''
  confirmPassword.value = ''
  errorMsg.value = ''
  stopTick()
}

function onSuccessDone() {
  const u = username.value
  emit('success', u)
  emit('close')
}

function close() {
  emit('close')
}

function handleKeydown(e: KeyboardEvent) {
  // 弹窗没打开时不响应 Esc
  if (e.key === 'Escape' && props.show)
    emit('close')
}

// 打开时重置到第一步；关闭时清理定时器
watch(() => props.show, (open) => {
  if (open) {
    step.value = 'verify'
    cardKey.value = ''
    username.value = ''
    resetToken.value = ''
    expiresAt.value = 0
    newPassword.value = ''
    confirmPassword.value = ''
    errorMsg.value = ''
    lockUntil.value = 0
  }
  else {
    stopTick()
  }
})

// 凭据倒计时归零：自动退回验证，避免用户拿着已失效的 token 卡在第二步
watch(remainingSec, (s) => {
  if (s <= 0 && step.value === 'reset') {
    step.value = 'verify'
    resetToken.value = ''
    stopTick()
    errorMsg.value = '验证凭据已过期，请重新输入卡密验证'
  }
})

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  stopTick()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="reset-modal">
      <div
        v-if="show"
        class="reset-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-title"
        @click.self="close"
      >
        <section class="reset-panel">
          <header class="reset-header">
            <div class="reset-header__icon">
              <span class="i-carbon-password" />
            </div>
            <div class="reset-header__titles">
              <h2 id="reset-title" class="reset-title">
                {{ step === 'verify' ? '找回登录密码' : step === 'reset' ? '设置新密码' : '重置成功' }}
              </h2>
              <p class="reset-sub">
                {{
                  step === 'verify'
                    ? '输入账号绑定过的卡密验证身份'
                    : step === 'reset'
                      ? `正在为账号 ${username} 重置密码`
                      : `账号 ${username} 的密码已更新`
                }}
              </p>
            </div>
            <button type="button" class="reset-close" aria-label="关闭" title="关闭" @click="close">
              <span class="i-carbon-close" />
            </button>
          </header>

          <div class="reset-body">
            <!-- 步骤 1：验证卡密 -->
            <div v-if="step === 'verify'" class="reset-step">
              <label class="reset-label" for="reset-card">卡密</label>
              <input
                id="reset-card"
                v-model="cardKey"
                type="text"
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                :disabled="locked"
                enterkeyhint="done"
                placeholder="请输入注册或续费时使用过的卡密"
                class="reset-input"
                @keydown.enter.prevent="verify"
              >
              <p class="reset-hint">
                注册卡或续费卡均可验证，验证通过后可自助重置登录密码，无需联系管理员。
              </p>
            </div>

            <!-- 步骤 2：设置新密码 -->
            <div v-else-if="step === 'reset'" class="reset-step">
              <div class="reset-token">
                <span class="reset-token__dot" />
                <span class="reset-token__label">重置凭据剩余</span>
                <strong class="reset-token__time">{{ countdownText }}</strong>
                <button type="button" class="reset-reverify" @click="reVerify">
                  重新验证卡密
                </button>
              </div>

              <label class="reset-label" for="reset-new">新密码</label>
              <div class="reset-input-wrap">
                <input
                  id="reset-new"
                  ref="newRef"
                  v-model="newPassword"
                  :type="showPassword ? 'text' : 'password'"
                  autocomplete="new-password"
                  autocapitalize="off"
                  autocorrect="off"
                  spellcheck="false"
                  :disabled="locked"
                  enterkeyhint="next"
                  placeholder="请输入新密码（至少 6 位）"
                  class="reset-input reset-input--with-icon"
                  @keydown.enter.prevent="focusConfirm"
                >
                <button
                  type="button"
                  class="reset-eye"
                  :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                  @click="showPassword = !showPassword"
                >
                  <span :class="showPassword ? 'i-carbon-view-off' : 'i-carbon-view'" />
                </button>
              </div>

              <label class="reset-label" for="reset-confirm">确认新密码</label>
              <div class="reset-input-wrap">
                <input
                  id="reset-confirm"
                  ref="confirmRef"
                  v-model="confirmPassword"
                  :type="showPassword ? 'text' : 'password'"
                  autocomplete="new-password"
                  autocapitalize="off"
                  autocorrect="off"
                  spellcheck="false"
                  :disabled="locked"
                  enterkeyhint="done"
                  placeholder="请再次输入新密码"
                  class="reset-input reset-input--with-icon"
                  @keydown.enter.prevent="reset"
                >
                <button
                  type="button"
                  class="reset-eye"
                  :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                  @click="showPassword = !showPassword"
                >
                  <span :class="showPassword ? 'i-carbon-view-off' : 'i-carbon-view'" />
                </button>
              </div>
            </div>

            <!-- 步骤 3：成功 -->
            <div v-else class="reset-step reset-step--done">
              <div class="reset-success">
                <span class="i-carbon-checkmark-filled" />
              </div>
              <p class="reset-done-text">
                密码已重置成功，请用新密码重新登录。
              </p>
            </div>

            <p v-if="errorMsg" class="reset-alert">
              <span class="i-carbon-warning" />
              <span>{{ errorMsg }}</span>
            </p>
          </div>

          <footer class="reset-footer">
            <button
              v-if="step === 'verify'"
              type="button"
              class="reset-btn"
              :disabled="verifying || locked"
              @click="verify"
            >
              <span v-if="verifying" class="i-svg-spinners-90-ring-with-bg" />
              <span>{{ locked ? '已锁定' : '验证卡密' }}</span>
            </button>
            <button
              v-else-if="step === 'reset'"
              type="button"
              class="reset-btn"
              :disabled="resetting || locked"
              @click="reset"
            >
              <span v-if="resetting" class="i-svg-spinners-90-ring-with-bg" />
              <span>{{ locked ? '已锁定' : '重置密码' }}</span>
            </button>
            <button v-else type="button" class="reset-btn" @click="onSuccessDone">
              <span>返回登录</span>
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.reset-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.38);
  backdrop-filter: blur(5px);
}

.reset-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(440px, 100%);
  max-height: min(86vh, 620px);
  overflow: hidden;
  background: #ffffff;
  border: 1px solid #d1fae5;
  border-radius: 18px;
  box-shadow: 0 24px 72px rgba(6, 95, 70, 0.22);
  font-family:
    'DM Sans',
    -apple-system,
    BlinkMacSystemFont,
    'PingFang SC',
    'Microsoft YaHei',
    sans-serif;
}

.reset-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid #e5e7eb;
}

.reset-header__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  border-radius: 12px;
  background: rgba(16, 185, 129, 0.12);
  color: #047857;
  font-size: 20px;
}

.reset-header__titles {
  flex: 1;
  min-width: 0;
}

.reset-title {
  margin: 0;
  color: #064e3b;
  font-size: 1.1rem;
  line-height: 1.35;
  font-weight: 700;
}

.reset-sub {
  margin: 3px 0 0;
  color: #6b7280;
  font-size: 0.8rem;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reset-close {
  display: inline-flex;
  flex: 0 0 36px;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  color: #64748b;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  transition: 0.2s ease;
}
.reset-close:hover {
  color: #064e3b;
  background: #f0fdfa;
  border-color: #d1fae5;
}

.reset-body {
  min-height: 0;
  padding: 18px 22px 6px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.reset-step {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.reset-label {
  font-size: 12px;
  color: #6b7280;
  font-weight: 500;
}

.reset-input {
  width: 100%;
  padding: 11px 14px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #ffffff;
  font-size: 14px;
  color: #111827;
  outline: none;
  font-family: inherit;
  -webkit-appearance: none;
  appearance: none;
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  /* 同登录页：退回默认文本渲染，避免每次输入都重算字距/连字 */
  text-rendering: auto;
  transition:
    border-color 200ms ease,
    box-shadow 200ms ease,
    background-color 200ms ease;
}
.reset-input::placeholder {
  color: #9ca3af;
}
.reset-input:focus {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
  background: #ffffff;
}
.reset-input:disabled {
  background: #f3f4f6;
  color: #9ca3af;
  cursor: not-allowed;
}
.reset-input--with-icon {
  padding-right: 40px;
}

.reset-input-wrap {
  position: relative;
}

.reset-eye {
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
.reset-eye:hover {
  color: #047857;
}

.reset-hint {
  margin: 0;
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.5;
}

/* 步骤 2 顶部：凭据倒计时 + 重新验证 */
.reset-token {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  padding: 9px 12px;
  border-radius: 10px;
  background: rgba(16, 185, 129, 0.08);
  color: #047857;
  font-size: 12px;
}
.reset-token__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.2);
  animation: resetPulse 2s ease-in-out infinite;
}
.reset-token__label {
  color: #6b7280;
}
.reset-token__time {
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  color: #047857;
}
.reset-reverify {
  margin-left: auto;
  padding: 4px 10px;
  color: #047857;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  background: rgba(16, 185, 129, 0.14);
  border: 1px solid transparent;
  border-radius: 999px;
  transition: background 160ms ease;
}
.reset-reverify:hover {
  background: rgba(16, 185, 129, 0.24);
}

@keyframes resetPulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.4);
  }
  50% {
    box-shadow: 0 0 0 7px rgba(52, 211, 153, 0);
  }
}

/* 步骤 3 成功态 */
.reset-step--done {
  align-items: center;
  gap: 14px;
  padding: 14px 0 8px;
}
.reset-success {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(16, 185, 129, 0.12);
  color: #047857;
  font-size: 32px;
  animation: resetPop 320ms ease;
}
.reset-done-text {
  margin: 0;
  color: #374151;
  font-size: 0.9rem;
  line-height: 1.6;
  text-align: center;
}
@keyframes resetPop {
  0% {
    transform: scale(0.6);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.reset-alert {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 6px;
  padding: 10px 14px;
  border-radius: 10px;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 12px;
  line-height: 1.5;
}

.reset-footer {
  display: flex;
  justify-content: stretch;
  padding: 14px 22px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
}
.reset-btn {
  width: 100%;
  height: 46px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, #047857 0%, #065f46 100%);
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow:
    0 10px 20px -8px rgba(6, 95, 70, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
  transition:
    transform 160ms ease,
    box-shadow 200ms ease,
    opacity 200ms ease;
}
.reset-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    0 14px 26px -8px rgba(6, 95, 70, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}
.reset-btn:active:not(:disabled) {
  transform: translateY(0);
}
.reset-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.reset-modal-enter-active,
.reset-modal-leave-active {
  transition: opacity 0.2s ease;
}
.reset-modal-enter-active .reset-panel,
.reset-modal-leave-active .reset-panel {
  transition: transform 0.2s ease;
}
.reset-modal-enter-from,
.reset-modal-leave-to {
  opacity: 0;
}
.reset-modal-enter-from .reset-panel,
.reset-modal-leave-to .reset-panel {
  transform: translateY(10px);
}

/* 移动端保持居中弹窗，仅收紧边距、放大触控目标，避免 iOS 输入框聚焦缩放 */
@media (max-width: 640px) {
  .reset-overlay {
    padding: 16px;
  }
  .reset-panel {
    max-height: min(86vh, 560px);
  }
  .reset-header,
  .reset-footer {
    padding-right: 18px;
    padding-left: 18px;
  }
  .reset-body {
    padding-right: 18px;
    padding-left: 18px;
  }
  .reset-input {
    /* iOS Safari 会对 font-size < 16px 的输入框强制放大整页 */
    font-size: 16px;
    min-height: 48px;
  }
  .reset-eye {
    width: 44px;
    height: 44px;
    right: 2px;
  }
  .reset-btn {
    height: 50px;
  }
}
</style>
