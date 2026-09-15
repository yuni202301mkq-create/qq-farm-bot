import { StorageSerializers, useStorage } from '@vueuse/core'
import axios from 'axios'
import NProgress from 'nprogress'
import { createRouter, createWebHistory } from 'vue-router'
import { menuRoutes } from './menu'
import 'nprogress/nprogress.css'

NProgress.configure({ showSpinner: false })

const adminToken = useStorage('admin_token', '')
const userInfo = useStorage<Record<string, any> | null>('user_info', null, undefined, { serializer: StorageSerializers.object })

const PUBLIC_PATHS = new Set(['/login'])
// 强制改密页：登录后必须完成改密才能去别的页面
const FORCE_PASSWORD_PATH = '/force-password'

function clearSession() {
  adminToken.value = ''
  userInfo.value = null
}

/** 用本地 token 校验会话是否有效，有效则刷新本地用户信息 */
async function verifySession(): Promise<boolean> {
  const token = adminToken.value
  if (!token)
    return false
  try {
    const { data } = await axios.get('/api/user/me', {
      headers: { 'x-admin-token': token },
      timeout: 6000,
    })
    if (!data?.ok)
      return false
    userInfo.value = {
      username: data.data.username,
      role: data.data.role === 'super_admin' ? 'super_admin' : 'user',
      card: data.data.card ?? null,
      accountLimit: data.data.accountLimit ?? 1,
      expiresAt: data.data.expiresAt ?? null,
      mustChangePassword: data.data.mustChangePassword === true,
    }
    return true
  }
  catch {
    return false
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('@/layouts/DefaultLayout.vue'),
      children: menuRoutes.map(route => ({
        path: route.path,
        name: route.name,
        component: route.component,
      })),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/AuthView.vue'),
    },
    {
      path: FORCE_PASSWORD_PATH,
      name: 'force-password',
      component: () => import('@/views/ForcePasswordView.vue'),
    },
    { path: '/admin', redirect: '/settings?tab=system' },
    { path: '/renewal', redirect: '/login?mode=renew' },
    { path: '/register', redirect: '/login?mode=register' },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  NProgress.start()

  // 登录页：已登录则直接进入应用（注册/续费模式除外，方便已登录用户用卡密续费）
  if (PUBLIC_PATHS.has(to.path)) {
    const cardMode = to.query.mode === 'renew' || to.query.mode === 'register'
    if (!cardMode && adminToken.value && await verifySession())
      return '/'
    return true
  }

  // 其他页面都需要有效会话
  if (!adminToken.value) {
    clearSession()
    return '/login'
  }
  if (!(await verifySession())) {
    clearSession()
    return '/login'
  }

  // 仍在使用出厂初始口令：只允许停留在强制改密页
  if (userInfo.value?.mustChangePassword === true) {
    if (to.path !== FORCE_PASSWORD_PATH)
      return FORCE_PASSWORD_PATH
    return true
  }
  // 已改过密码就不必再停在改密页
  if (to.path === FORCE_PASSWORD_PATH)
    return '/'

  return true
})

router.afterEach(() => NProgress.done())

export default router
