<script setup lang="ts">
import type { Theme } from '@/stores/app'
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import ToastContainer from '@/components/ToastContainer.vue'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()

// 立即应用保存的主题（在组件挂载前）
const savedTheme = localStorage.getItem('ui_theme') as Theme
if (savedTheme && appStore.themes[savedTheme]) {
  appStore.applyTheme(savedTheme)
}

onMounted(() => {
  appStore.fetchTheme()
})
</script>

<template>
  <div class="app-root h-[100dvh] w-full overflow-hidden" :style="{ color: 'var(--theme-text)' }">
    <RouterView />
    <ToastContainer />
  </div>
</template>

<style>
/* Global styles */
body {
  margin: 0;
  font-family: 'DM Sans', sans-serif;
  background: var(--app-bg);
  color: var(--theme-text);
  font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
}

/* Color theme variables */
:root {
  --theme-bg: #f8fafc;
  --theme-text: #172033;
  --theme-primary: #3b82f6;
  --theme-secondary: #2563eb;
  --theme-gradient: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
  --app-bg: linear-gradient(180deg, #f6f8fb 0%, #eef3f8 100%);
  --surface-1: color-mix(in srgb, var(--theme-bg) 8%, #ffffff);
  --surface-2: color-mix(in srgb, var(--theme-bg) 22%, #ffffff);
  --surface-3: color-mix(in srgb, var(--theme-bg) 40%, #ffffff);
  --surface-border: rgba(15, 23, 42, 0.09);
  --surface-border-strong: rgba(15, 23, 42, 0.14);
  --surface-shadow: 0 16px 45px rgba(15, 23, 42, 0.08);
  --surface-shadow-soft: 0 8px 24px rgba(15, 23, 42, 0.06);
  --muted-text: #64748b;
  --input-bg: rgba(255, 255, 255, 0.84);
  --panel-glow: color-mix(in srgb, var(--theme-primary) 14%, transparent);
}

.dark {
  --app-bg:
    radial-gradient(circle at top left, color-mix(in srgb, var(--theme-primary) 16%, transparent) 0, transparent 28rem),
    linear-gradient(180deg, #0b1020 0%, color-mix(in srgb, var(--theme-bg) 74%, #020617) 100%);
  --surface-1: color-mix(in srgb, var(--theme-bg) 72%, #ffffff 9%);
  --surface-2: color-mix(in srgb, var(--theme-bg) 78%, #ffffff 6%);
  --surface-3: color-mix(in srgb, var(--theme-bg) 84%, #ffffff 4%);
  --surface-border: rgba(255, 255, 255, 0.09);
  --surface-border-strong: rgba(255, 255, 255, 0.14);
  --surface-shadow: 0 18px 55px rgba(0, 0, 0, 0.34);
  --surface-shadow-soft: 0 10px 28px rgba(0, 0, 0, 0.24);
  --muted-text: #9ca3af;
  --input-bg: rgba(15, 23, 42, 0.54);
  --panel-glow: color-mix(in srgb, var(--theme-primary) 18%, transparent);
}

.app-root {
  background: var(--app-bg);
}

/* SaaS surface system */
.bg-white {
  background-color: var(--surface-1) !important;
}

.dark .bg-gray-800,
.dark .bg-gray-900 {
  background-color: var(--surface-1) !important;
}

.bg-gray-50 {
  background-color: var(--surface-2) !important;
}

.dark .bg-gray-700 {
  background-color: var(--surface-3) !important;
}

.ui-card {
  border: 1px solid var(--surface-border);
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface-1) 96%, #ffffff 4%), var(--surface-1));
  box-shadow: var(--surface-shadow-soft);
}

.ui-card-elevated {
  border: 1px solid var(--surface-border);
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface-1) 92%, #ffffff 8%), var(--surface-1));
  box-shadow: var(--surface-shadow);
}

.ui-subtle-panel {
  border: 1px solid var(--surface-border);
  background: color-mix(in srgb, var(--surface-2) 86%, transparent);
}

.glass-panel {
  border: 1px solid var(--surface-border);
  /* 浮动面板（下拉菜单/顶栏/弹出面板）必须实色：半透明 + backdrop-filter 会让
     底层文字透出来（perf-lite 关闭模糊后更明显），且逐帧模糊采样拖累滚动性能 */
  background: var(--surface-1);
  box-shadow: var(--surface-shadow-soft);
}

/* ==========================================================================
   3D 液态磨砂玻璃卡片（设置页）
   .liquid-glass         主卡片：磨砂玻璃底 + 液态高光渐层 + 3D 悬浮投影
   .liquid-glass-static  在主卡片基础上关闭悬停上浮（页面外壳/吸顶栏用）
   .liquid-glass-sub     内嵌子面板：轻磨砂 + 顶部高光线，保留原有的彩色边框底色
   颜色走主题 token（--theme-primary），深色模式自动适配；
   perf-lite 模式下全局 backdrop-filter 已被关闭，仅保留静态配色。
   ========================================================================== */
.liquid-glass {
  border: 1px solid rgba(255, 255, 255, 0.7);
  background:
    radial-gradient(130% 74% at 8% -6%, rgba(255, 255, 255, 0.66), transparent 56%),
    radial-gradient(120% 64% at 104% 110%, color-mix(in srgb, var(--theme-primary) 17%, transparent), transparent 62%),
    linear-gradient(152deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0.4) 46%, rgba(255, 255, 255, 0.54));
  -webkit-backdrop-filter: blur(12px) saturate(1.3);
  backdrop-filter: blur(12px) saturate(1.3);
  box-shadow:
    0 24px 48px -20px rgba(15, 23, 42, 0.3),
    0 0 0 1px rgba(15, 23, 42, 0.06),
    0 4px 12px -4px rgba(15, 23, 42, 0.07),
    inset 0 1px 0 rgba(255, 255, 255, 0.85),
    inset 0 -1px 1px rgba(255, 255, 255, 0.28),
    inset 0 0 28px rgba(255, 255, 255, 0.16) !important;
  transition: transform 0.28s ease, box-shadow 0.28s ease;
}

.liquid-glass:hover {
  transform: translateY(-2px);
  box-shadow:
    0 32px 60px -22px rgba(15, 23, 42, 0.34),
    0 0 0 1px rgba(15, 23, 42, 0.07),
    0 6px 16px -6px rgba(15, 23, 42, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    inset 0 -1px 1px rgba(255, 255, 255, 0.3),
    inset 0 0 30px rgba(255, 255, 255, 0.18) !important;
}

.liquid-glass-static:hover {
  transform: none;
}

.dark .liquid-glass {
  border-color: rgba(255, 255, 255, 0.14);
  background:
    radial-gradient(130% 74% at 8% -6%, rgba(255, 255, 255, 0.13), transparent 56%),
    radial-gradient(120% 64% at 104% 110%, color-mix(in srgb, var(--theme-primary) 24%, transparent), transparent 62%),
    linear-gradient(152deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.04) 46%, rgba(255, 255, 255, 0.08));
  box-shadow:
    0 26px 52px -22px rgba(0, 0, 0, 0.62),
    0 4px 12px -4px rgba(0, 0, 0, 0.32),
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    inset 0 -1px 1px rgba(255, 255, 255, 0.05),
    inset 0 0 28px rgba(255, 255, 255, 0.045) !important;
}

.dark .liquid-glass:hover {
  box-shadow:
    0 34px 66px -24px rgba(0, 0, 0, 0.68),
    0 6px 16px -6px rgba(0, 0, 0, 0.36),
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 0 -1px 1px rgba(255, 255, 255, 0.06),
    inset 0 0 30px rgba(255, 255, 255, 0.05) !important;
}

.liquid-glass-sub {
  /* 不加 backdrop-filter：sub 面板一页可达十个，滚动时每个都在采样模糊背景，
     是设置页桌面端滚动卡顿的主因；其背板是主玻璃卡的平滑渐变，去掉模糊肉眼无差异 */
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.6),
    0 10px 22px -14px rgba(15, 23, 42, 0.18);
}

.dark .liquid-glass-sub {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    0 10px 22px -14px rgba(0, 0, 0, 0.4);
}

@media (prefers-reduced-motion: reduce) {
  .liquid-glass {
    transition: none;
  }

  .liquid-glass:hover {
    transform: none;
  }
}

.metric-card {
  position: relative;
  overflow: hidden;
}

.metric-card::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(135deg, var(--panel-glow), transparent 42%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.12), transparent 34%);
}

.metric-card > * {
  position: relative;
}

.shadow,
.shadow-sm,
.shadow-md {
  box-shadow: var(--surface-shadow-soft) !important;
}

/* Use CSS variables for theme colors */
.btn-primary {
  background: var(--theme-gradient);
  border-color: var(--theme-primary);
}

.btn-primary:hover {
  background: var(--theme-secondary);
}

.text-primary {
  color: var(--theme-primary);
}

.bg-primary {
  background-color: var(--theme-primary);
}

.border-primary {
  border-color: var(--theme-primary);
}

.bg-gradient-primary {
  background: var(--theme-gradient);
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--theme-primary) 50%, #94a3b8);
  border-radius: 999px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--theme-secondary);
  opacity: 0.8;
}
</style>
