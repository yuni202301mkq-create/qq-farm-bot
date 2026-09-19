<script setup lang="ts">
import axios from 'axios'
import { storeToRefs } from 'pinia'
import { onMounted, ref } from 'vue'
import BottomTabBar from '@/components/BottomTabBar.vue'
import UpdateLogModal from '@/components/login/UpdateLogModal.vue'
import MysteryMerchantBanner from '@/components/shop/MysteryMerchantBanner.vue'
import Sidebar from '@/components/Sidebar.vue'
import TopAccountMenu from '@/components/TopAccountMenu.vue'
import { useMemorialDay } from '@/composables/useMemorialDay'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const { loginPageConfig } = storeToRefs(appStore)
const { memorialText } = useMemorialDay()

// ============ 更新日志：登录成功进入主界面后自动弹出一次 ============
const showUpdateLog = ref(false)
const changelogContent = ref('')
const changelogLoading = ref(false)
const changelogError = ref('')

async function loadChangelog(autoOpen = false) {
  if (changelogLoading.value)
    return
  changelogLoading.value = true
  changelogError.value = ''
  try {
    const { data } = await axios.get('/api/changelog')
    if (!data?.ok)
      throw new Error(data?.error || '获取更新日志失败')
    changelogContent.value = String(data.data || '')
  }
  catch (error: any) {
    // 自动弹出时接口失败：静默收起，避免每次进入都顶一个错误框
    if (autoOpen) {
      if (!changelogContent.value)
        showUpdateLog.value = false
      return
    }
    changelogError.value = error?.response?.data?.error || error?.message || '获取更新日志失败'
  }
  finally {
    changelogLoading.value = false
  }
}

onMounted(() => {
  appStore.fetchLoginPageConfig()
  // 登录成功进入主界面后弹出更新日志：先开弹窗（自带加载态），再异步取内容，避免弹出延迟
  showUpdateLog.value = true
  loadChangelog(true)
})
</script>

<template>
  <div class="w-screen flex overflow-hidden bg-gray-50 dark:bg-gray-900" style="height: 100dvh;">
    <Sidebar />

    <main class="relative h-full min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden">
      <header class="glass-panel relative z-30 mx-2 mt-2 h-16 flex shrink-0 items-center justify-between rounded-lg px-3 md:mx-4 md:mt-4 md:px-5">
        <div class="min-w-0 flex items-center gap-2 sm:gap-3">
          <div class="min-w-0 flex items-center gap-2 sm:gap-2.5">
            <div
              class="h-8 w-8 flex flex-none items-center justify-center rounded-xl text-white shadow-md sm:h-9 sm:w-9"
              style="background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 55%, #f97316 100%); box-shadow: 0 4px 12px rgba(245, 158, 11, 0.35);"
            >
              <div class="i-carbon-sprout text-lg" />
            </div>
            <div class="min-w-0">
              <div class="truncate text-base text-gray-900 font-bold md:text-lg dark:text-gray-100">
                {{ loginPageConfig.title || '农场智能助手' }}
              </div>
              <!-- 移动端顶栏高度有限，纪念日文案放不下会截断成"2026年…"，只在 sm 及以上展示 -->
              <div v-if="memorialText" class="hidden truncate text-xs text-gray-900 font-bold sm:block dark:text-white">
                {{ memorialText }}
              </div>
            </div>
          </div>
        </div>

        <TopAccountMenu />
      </header>

      <!-- Main Content Area -->
      <div class="min-h-0 flex flex-1 flex-col overflow-hidden">
        <MysteryMerchantBanner />
        <div class="custom-scrollbar min-h-0 flex flex-1 flex-col overflow-y-auto p-3 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-6 sm:p-4 lg:pb-6 md:pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-[calc(5.25rem+env(safe-area-inset-bottom))]">
          <RouterView v-slot="{ Component, route }">
            <Transition name="slide-fade" mode="out-in">
              <component :is="Component" :key="route.path" />
            </Transition>
          </RouterView>
        </div>
      </div>
    </main>

    <!-- 移动端底部导航：概览 / 个人 / 更多 / 活动 / 设置 -->
    <BottomTabBar />
    <!-- 更新日志弹窗：登录进入主界面后自动弹出，只展示最新一条，完整列表在「更多 → 更新日志」页面 -->
    <UpdateLogModal
      :show="showUpdateLog"
      :content="changelogContent"
      latest-only
      :loading="changelogLoading"
      :error="changelogError"
      @close="showUpdateLog = false"
      @retry="loadChangelog()"
    />
  </div>
</template>

<style scoped>
/* 弹窗动画 */
.modal-fade-enter-active {
  animation: modal-in 0.4s ease-out;
}

.modal-fade-leave-active {
  animation: modal-out 0.3s ease-in;
}

@keyframes modal-in {
  0% {
    opacity: 0;
    transform: scale(0.9);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes modal-out {
  0% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(0.9);
  }
}

/* 弹窗样式 */
.warning-modal {
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-5px);
  }
}

/* 水波纹背景 */
.ripple-bg {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
}

.ripple {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(239, 68, 68, 0.1) 0%, transparent 70%);
  animation: ripple-effect 4s ease-out infinite;
}

.ripple-1 {
  width: 200px;
  height: 200px;
  animation-delay: 0s;
}

.ripple-2 {
  width: 300px;
  height: 300px;
  animation-delay: 1.3s;
}

.ripple-3 {
  width: 400px;
  height: 400px;
  animation-delay: 2.6s;
}

/* Slide Fade Transition */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease-out;
}

.slide-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.3);
  border-radius: 3px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
}

.custom-scrollbar {
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
</style>
