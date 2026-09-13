<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const errorMessage = ref('')
const oldRef = ref<HTMLInputElement | null>(null)

// 出厂初始口令就是 admin，这里做个提示但不预填，避免用户直接跳过改密
const usingDefaultPassword = computed(() => oldPassword.value === 'admin')

const rules = computed(() => [
  { label: '至少 6 位', ok: newPassword.value.length >= 6 },
  { label: '与新密码一致', ok: !!newPassword.value && newPassword.value === confirmPassword.value },
  { label: '不同于原密码', ok: !!newPassword.value && newPassword.value !== oldPassword.value },
])

const canSubmit = computed(() =>
  !loading.value
  && !!oldPassword.value
  && rules.value.every(rule => rule.ok),
)

async function submit() {
  if (loading.value)
    return
  errorMessage.value = ''

  if (!oldPassword.value) {
    errorMessage.value = '请输入当前密码'
    return
  }
  if (!newPassword.value || newPassword.value.length < 6) {
    errorMessage.value = '新密码至少 6 位'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    errorMessage.value = '两次输入的新密码不一致'
    return
  }
  if (newPassword.value === oldPassword.value) {
    errorMessage.value = '新密码不能与原密码相同'
    return
  }

  loading.value = true
  try {
    const { data } = await api.post('/api/user/change-password', {
      oldPassword: oldPassword.value,
      newPassword: newPassword.value,
    })
    if (!data?.ok)
      throw new Error(data?.error || '修改失败')
    // 服务端已清掉强制改密标记，这里同步本地，避免路由守卫再把人送回来
    userStore.markPasswordChanged()
    await router.replace('/')
  }
  catch (error: any) {
    errorMessage.value = error?.response?.data?.error || error?.message || '修改失败'
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  // 页面只承担一件事：改掉出厂口令。进来自动聚焦，减少一步操作
  nextTick(() => oldRef.value?.focus())
})
</script>

<template>
  <div class="force-password">
    <section class="force-password__card">
      <div class="force-password__badge">
        <span class="i-carbon-warning-alt" />
        安全提示
      </div>
      <h1>请先修改初始密码</h1>
      <p class="force-password__desc">
        当前账号仍在使用出厂初始口令，继续使用前必须先设置新密码。修改完成后即可正常使用面板。
      </p>

      <form class="force-password__form" @submit.prevent="submit">
        <label class="force-password__field">
          <span>当前密码</span>
          <input
            ref="oldRef"
            v-model="oldPassword"
            type="password"
            autocomplete="current-password"
            placeholder="请输入当前使用的密码"
          >
        </label>
        <p v-if="usingDefaultPassword" class="force-password__hint">
          检测到你填的是出厂口令，请务必改成只有你知道的密码。
        </p>

        <label class="force-password__field">
          <span>新密码</span>
          <input
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            placeholder="至少 6 位"
          >
        </label>

        <label class="force-password__field">
          <span>确认新密码</span>
          <input
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            placeholder="再次输入新密码"
          >
        </label>

        <ul class="force-password__rules">
          <li
            v-for="rule in rules"
            :key="rule.label"
            :class="{ 'is-ok': rule.ok }"
          >
            <span :class="rule.ok ? 'i-carbon-checkmark' : 'i-carbon-circle-dash'" />
            {{ rule.label }}
          </li>
        </ul>

        <p v-if="errorMessage" class="force-password__error">
          {{ errorMessage }}
        </p>

        <button type="submit" class="force-password__submit" :disabled="!canSubmit">
          {{ loading ? '提交中…' : '修改密码并进入面板' }}
        </button>
      </form>

      <p class="force-password__footer">
        忘记当前密码？可在登录页用绑定的卡密自助重置。
      </p>
    </section>
  </div>
</template>

<style scoped>
.force-password {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 24px;
  background: linear-gradient(160deg, #f0fdf4 0%, #f8fafc 55%, #eef6f1 100%);
  font-family:
    'DM Sans',
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    'PingFang SC',
    'Microsoft YaHei',
    sans-serif;
}

.force-password__card {
  width: min(420px, 100%);
  padding: 28px 26px 22px;
  background: #fff;
  border: 1px solid #dbe4dc;
  border-radius: 16px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
}

.force-password__badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  color: #b45309;
  font-size: 0.75rem;
  font-weight: 700;
  background: #fef3c7;
  border-radius: 999px;
}

.force-password__card h1 {
  margin: 14px 0 0;
  color: #14532d;
  font-size: 1.25rem;
  line-height: 1.4;
}

.force-password__desc {
  margin: 8px 0 0;
  color: #64748b;
  font-size: 0.83rem;
  line-height: 1.6;
}

.force-password__form {
  display: grid;
  gap: 13px;
  margin-top: 20px;
}

.force-password__field {
  display: grid;
  gap: 6px;
}

.force-password__field span {
  color: #475569;
  font-size: 0.78rem;
  font-weight: 600;
}

.force-password__field input {
  width: 100%;
  padding: 10px 12px;
  color: #1f2937;
  font-size: 0.9rem;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 9px;
  outline: none;
  transition: 0.18s ease;
}

.force-password__field input:focus {
  border-color: #86efac;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.14);
}

.force-password__hint {
  margin: -4px 0 0;
  color: #b45309;
  font-size: 0.75rem;
}

.force-password__rules {
  display: grid;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.force-password__rules li {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #94a3b8;
  font-size: 0.76rem;
}

.force-password__rules li.is-ok {
  color: #15803d;
}

.force-password__error {
  margin: 0;
  padding: 9px 12px;
  color: #b91c1c;
  font-size: 0.8rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
}

.force-password__submit {
  padding: 11px 16px;
  color: #fff;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  background: linear-gradient(135deg, #16a34a, #0d9488);
  border: 0;
  border-radius: 9px;
  box-shadow: 0 8px 20px rgba(22, 163, 74, 0.22);
  transition: 0.18s ease;
}

.force-password__submit:hover:not(:disabled) {
  filter: brightness(1.06);
}

.force-password__submit:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  box-shadow: none;
}

.force-password__footer {
  margin: 16px 0 0;
  padding-top: 14px;
  color: #94a3b8;
  font-size: 0.75rem;
  text-align: center;
  border-top: 1px solid #eef3ef;
}
</style>
