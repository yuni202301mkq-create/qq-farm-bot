<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useToastStore } from '@/stores/toast'

// 卡密分两类，一类只带一种效果：
//   duration 时效卡密 —— 只延长有效期，注册/登录前与登录后都能激活
//   quota    额度账号卡密 —— 只增加账号数量上限，必须登录后在应用内激活
type CardKeyType = 'duration' | 'quota'

interface CardKey {
  code: string
  type: CardKeyType
  typeText?: string
  days: number
  accountLimit: number
  note: string
  used: boolean
  usedBy: string | null
  createdAtText: string
  usedAtText: string
}

interface UserRow {
  username: string
  role: string
  card: string | null
  accountLimit: number
  expiresAt: number | null
  expiresAtText: string
  expired: boolean
  disabled: boolean
  createdAtText: string
}

const toastStore = useToastStore()

// ---- 生成卡密 ----
const genCount = ref(1)
const genType = ref<CardKeyType>('duration')
const genDays = ref(30)
const genLimit = ref(1)
const genNote = ref('')
const generating = ref(false)
const lastGenerated = ref<string[]>([])

const typeOptions = [
  { label: '时效卡密（延长有效期）', value: 'duration' },
  { label: '额度账号卡密（增加账号数）', value: 'quota' },
]

const genTypeText = computed(() => (genType.value === 'quota' ? '额度账号卡密' : '时效卡密'))

// ---- 卡密列表 ----
const keys = ref<CardKey[]>([])
const keysLoading = ref(false)

// ---- 用户管理 ----
const users = ref<UserRow[]>([])
const usersLoading = ref(false)

const resetTarget = ref('')
const resetPassword = ref('')
const resetVisible = ref(false)
const resetSaving = ref(false)

async function loadKeys() {
  keysLoading.value = true
  try {
    const { data } = await api.get('/api/card-keys')
    if (data?.ok)
      keys.value = data.data || []
  }
  catch {}
  finally {
    keysLoading.value = false
  }
}

async function loadUsers() {
  usersLoading.value = true
  try {
    const { data } = await api.get('/api/users')
    if (data?.ok)
      users.value = data.data || []
  }
  catch {}
  finally {
    usersLoading.value = false
  }
}

function refresh() {
  void loadKeys()
  void loadUsers()
}

async function generate() {
  if (generating.value)
    return
  generating.value = true
  try {
    // 按类型只提交自己那一项，避免后端把两种效果一起写进同一张卡
    const payload: Record<string, unknown> = {
      count: genCount.value,
      type: genType.value,
      note: genNote.value,
    }
    if (genType.value === 'duration')
      payload.days = genDays.value
    else
      payload.accountLimit = genLimit.value

    const { data } = await api.post('/api/card-keys/generate', payload)
    if (data?.ok) {
      lastGenerated.value = (data.data || []).map((k: CardKey) => k.code)
      toastStore.success(`已生成 ${lastGenerated.value.length} 个${genTypeText.value}`)
      await loadKeys()
    }
  }
  catch (e: any) {
    toastStore.error(e?.response?.data?.error || '生成失败')
  }
  finally {
    generating.value = false
  }
}

async function copyKey(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    toastStore.success('已复制卡密')
  }
  catch {
    toastStore.warning('复制失败，请手动选择复制')
  }
}

async function copyAll() {
  try {
    await navigator.clipboard.writeText(lastGenerated.value.join('\n'))
    toastStore.success('已复制全部卡密')
  }
  catch {
    toastStore.warning('复制失败，请手动选择复制')
  }
}

function downloadTxt() {
  if (!lastGenerated.value.length)
    return
  saveTxt(`卡密_${timestamp()}.txt`, lastGenerated.value)
  toastStore.success(`已下载 ${lastGenerated.value.length} 个卡密`)
}

/** 导出卡密列表里全部未使用的卡密（已使用的没有分发价值，不导出） */
function downloadKeysTxt() {
  const unused = keys.value.filter(key => !key.used).map(key => key.code)
  if (!unused.length) {
    toastStore.warning('没有未使用的卡密可导出')
    return
  }
  saveTxt(`卡密导出_${timestamp()}.txt`, unused)
  toastStore.success(`已导出 ${unused.length} 个未使用卡密`)
}

function timestamp() {
  return new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
}

function saveTxt(filename: string, lines: string[]) {
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

async function removeKey(code: string) {
  try {
    const { data } = await api.delete(`/api/card-keys/${encodeURIComponent(code)}`)
    if (data?.ok) {
      toastStore.success('已删除')
      await loadKeys()
    }
  }
  catch (e: any) {
    toastStore.error(e?.response?.data?.error || '删除失败')
  }
}

async function extendUser(username: string) {
  try {
    const { data } = await api.patch(`/api/users/${encodeURIComponent(username)}`, { extendDays: 30 })
    if (data?.ok) {
      toastStore.success(`已为 ${username} 续期 30 天`)
      await loadUsers()
    }
  }
  catch (e: any) {
    toastStore.error(e?.response?.data?.error || '续期失败')
  }
}

function openReset(username: string) {
  resetTarget.value = username
  resetPassword.value = ''
  resetVisible.value = true
}

async function submitReset() {
  if (resetSaving.value)
    return
  if (!resetPassword.value || resetPassword.value.length < 6) {
    toastStore.warning('新密码至少 6 位')
    return
  }
  resetSaving.value = true
  try {
    const { data } = await api.post(`/api/users/${encodeURIComponent(resetTarget.value)}/reset-password`, {
      password: resetPassword.value,
    })
    if (data?.ok) {
      toastStore.success(`已重置 ${resetTarget.value} 的密码，该用户需重新登录`)
      resetVisible.value = false
    }
  }
  catch (e: any) {
    toastStore.error(e?.response?.data?.error || '重置失败')
  }
  finally {
    resetSaving.value = false
  }
}

async function removeUser(username: string) {
  if (!window.confirm(`确定删除用户「${username}」吗？该操作不可恢复。`))
    return
  try {
    const { data } = await api.delete(`/api/users/${encodeURIComponent(username)}`)
    if (data?.ok) {
      toastStore.success('已删除')
      await loadUsers()
    }
  }
  catch (e: any) {
    toastStore.error(e?.response?.data?.error || '删除失败')
  }
}

onMounted(refresh)
</script>

<template>
  <div class="space-y-4">
    <!-- 卡密生成 -->
    <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
        <div class="i-carbon-ticket" />
        生成卡密
      </h4>
      <div class="grid gap-3 md:grid-cols-4">
        <BaseSelect v-model="genType" label="卡密类型" :options="typeOptions" />
        <BaseInput v-model="genCount" type="number" label="生成数量（1-100）" />
        <BaseInput v-if="genType === 'duration'" v-model="genDays" type="number" label="有效天数（1-3650）" />
        <BaseInput v-else v-model="genLimit" type="number" label="账号数上限（1-50）" />
        <BaseInput v-model="genNote" type="text" label="备注（可选）" />
      </div>
      <p class="mt-2 text-xs text-gray-400">
        <template v-if="genType === 'duration'">
          时效卡密只延长有效期，用户可在注册页或登录后激活。
        </template>
        <template v-else>
          额度账号卡密只增加账号数量上限，用户必须在登录后于应用内激活，注册/续费页无法使用。
        </template>
      </p>
      <div class="mt-3 flex items-center gap-2">
        <BaseButton variant="primary" size="sm" :loading="generating" @click="generate">
          生成卡密
        </BaseButton>
        <BaseButton v-if="lastGenerated.length" variant="ghost" size="sm" @click="copyAll">
          复制全部（{{ lastGenerated.length }}）
        </BaseButton>
        <BaseButton v-if="lastGenerated.length" variant="ghost" size="sm" @click="downloadTxt">
          下载 TXT
        </BaseButton>
      </div>
      <div v-if="lastGenerated.length" class="mt-3 rounded-xl bg-emerald-50 p-3 dark:bg-emerald-900/20">
        <div class="mb-1 text-xs text-emerald-700 dark:text-emerald-300">
          最新生成（{{ genTypeText }}）：
        </div>
        <div class="max-h-32 overflow-y-auto text-sm text-emerald-800 font-mono dark:text-emerald-200">
          <div v-for="code in lastGenerated" :key="code">
            {{ code }}
          </div>
        </div>
      </div>
    </div>

    <!-- 卡密列表 -->
    <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div class="mb-3 flex items-center justify-between">
        <h4 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
          <div class="i-carbon-list" />
          卡密列表（{{ keys.length }}）
        </h4>
        <div class="flex items-center gap-2">
          <BaseButton variant="ghost" size="sm" :disabled="!keys.length" @click="downloadKeysTxt">
            导出 TXT
          </BaseButton>
          <BaseButton variant="ghost" size="sm" :loading="keysLoading" @click="loadKeys">
            刷新
          </BaseButton>
        </div>
      </div>
      <div class="custom-scrollbar max-h-72 overflow-auto">
        <table class="w-full text-left text-sm">
          <thead class="text-xs text-gray-400">
            <tr>
              <th class="py-2 pr-3">
                卡密
              </th>
              <th class="py-2 pr-3">
                类型
              </th>
              <th class="py-2 pr-3">
                天数
              </th>
              <th class="py-2 pr-3">
                账号上限
              </th>
              <th class="py-2 pr-3">
                状态
              </th>
              <th class="py-2 pr-3">
                使用者
              </th>
              <th class="py-2 pr-3">
                创建时间
              </th>
              <th class="py-2">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="key in keys" :key="key.code" class="border-t border-gray-100 dark:border-gray-700">
              <td class="py-2 pr-3 text-xs font-mono">
                <div class="flex items-center gap-2">
                  <button
                    class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-blue-500 transition hover:bg-blue-50 dark:hover:bg-blue-900/20"
                    title="复制卡密"
                    @click="copyKey(key.code)"
                  >
                    <span class="i-carbon-copy text-sm" />
                    <span class="text-xs">复制</span>
                  </button>
                  <span class="select-all">{{ key.code }}</span>
                </div>
              </td>
              <td class="py-2 pr-3">
                <span
                  class="whitespace-nowrap rounded px-1.5 py-0.5 text-xs"
                  :class="key.type === 'quota'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    : 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300'"
                >
                  {{ key.type === 'quota' ? '额度账号' : '时效' }}
                </span>
              </td>
              <td class="py-2 pr-3">
                {{ key.type === 'duration' ? `${key.days}天` : '-' }}
              </td>
              <td class="py-2 pr-3">
                {{ key.type === 'quota' ? key.accountLimit : '-' }}
              </td>
              <td class="py-2 pr-3">
                <span :class="key.used ? 'text-gray-400' : 'text-emerald-600 font-semibold'">
                  {{ key.used ? '已使用' : '未使用' }}
                </span>
              </td>
              <td class="py-2 pr-3">
                {{ key.usedBy || '-' }}
              </td>
              <td class="py-2 pr-3 text-xs text-gray-400">
                {{ key.createdAtText }}
              </td>
              <td class="py-2">
                <button
                  class="text-xs text-red-500 hover:underline"
                  @click="removeKey(key.code)"
                >
                  删除
                </button>
              </td>
            </tr>
            <tr v-if="!keys.length">
              <td colspan="8" class="py-6 text-center text-sm text-gray-400">
                暂无卡密，先在上方生成一批
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 用户管理 -->
    <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div class="mb-3 flex items-center justify-between">
        <h4 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
          <div class="i-carbon-user-multiple" />
          用户管理（{{ users.length }}）
        </h4>
        <BaseButton variant="ghost" size="sm" :loading="usersLoading" @click="loadUsers">
          刷新
        </BaseButton>
      </div>
      <div class="custom-scrollbar max-h-72 overflow-auto">
        <table class="w-full text-left text-sm">
          <thead class="text-xs text-gray-400">
            <tr>
              <th class="py-2 pr-3">
                用户名
              </th>
              <th class="py-2 pr-3">
                角色
              </th>
              <th class="py-2 pr-3">
                账号上限
              </th>
              <th class="py-2 pr-3">
                到期时间
              </th>
              <th class="py-2 pr-3">
                状态
              </th>
              <th class="py-2">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in users" :key="user.username" class="border-t border-gray-100 dark:border-gray-700">
              <td class="py-2 pr-3 font-medium">
                {{ user.username }}
              </td>
              <td class="py-2 pr-3">
                <span
                  class="rounded px-1.5 py-0.5 text-xs"
                  :class="user.role === 'super_admin'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    : 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300'"
                >
                  {{ user.role === 'super_admin' ? '超级管理员' : '普通用户' }}
                </span>
              </td>
              <td class="py-2 pr-3">
                {{ user.role === 'super_admin' ? '不限' : user.accountLimit }}
              </td>
              <td class="py-2 pr-3 text-xs">
                {{ user.role === 'super_admin' ? '永久' : user.expiresAtText }}
              </td>
              <td class="py-2 pr-3">
                <span v-if="user.role === 'super_admin'" class="text-gray-400">-</span>
                <span v-else-if="user.disabled" class="text-red-500">已禁用</span>
                <span v-else-if="user.expired" class="text-red-500">已过期</span>
                <span v-else class="text-emerald-600">正常</span>
              </td>
              <td class="py-2">
                <template v-if="user.role !== 'super_admin'">
                  <button class="mr-2 text-xs text-blue-500 hover:underline" @click="extendUser(user.username)">
                    续期30天
                  </button>
                  <button class="mr-2 text-xs text-amber-600 hover:underline" @click="openReset(user.username)">
                    重置密码
                  </button>
                  <button class="text-xs text-red-500 hover:underline" @click="removeUser(user.username)">
                    删除
                  </button>
                </template>
                <span v-else class="text-xs text-gray-300">-</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 重置密码弹窗 -->
    <div
      v-if="resetVisible"
      class="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50 p-4"
      @click.self="resetVisible = false"
    >
      <div class="max-w-sm w-full rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-800">
        <h4 class="mb-3 text-base font-bold">
          重置「{{ resetTarget }}」的密码
        </h4>
        <BaseInput v-model="resetPassword" type="text" label="新密码（至少 6 位）" />
        <div class="mt-4 flex justify-end gap-2">
          <BaseButton variant="ghost" size="sm" @click="resetVisible = false">
            取消
          </BaseButton>
          <BaseButton variant="primary" size="sm" :loading="resetSaving" @click="submitReset">
            确认重置
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
