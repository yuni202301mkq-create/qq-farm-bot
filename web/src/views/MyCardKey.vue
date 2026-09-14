<script setup lang="ts">
import { watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import MyCardKeyCard from '@/components/MyCardKeyCard.vue'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

// 我的卡密信息仅普通用户可见，超管直达时回概览
watchEffect(() => {
  if (userStore.isAdmin)
    router.replace('/')
})
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <h1 class="mb-4 text-2xl text-gray-900 font-bold dark:text-gray-100">
      我的卡密信息
    </h1>
    <MyCardKeyCard />
  </div>
</template>
