import { createRouter, createWebHistory } from 'vue-router'

import { onUnauthorized } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true, title: '登录' },
    },
    {
      path: '/',
      component: () => import('@/layouts/MainLayout.vue'),
      children: [
        { path: '', redirect: '/cases' },
        { path: 'cases', name: 'cases', component: () => import('@/views/CaseManageView.vue'), meta: { title: '用例管理' } },
        {
          path: 'scenarios/:id',
          name: 'scenario',
          component: () => import('@/views/ScenarioView.vue'),
          meta: { title: '场景' },
        },
        {
          path: 'cases/:id',
          name: 'case-detail',
          component: () => import('@/views/CaseDetailView.vue'),
          meta: { title: '用例详情' },
        },
        { path: 'runs', name: 'runs', component: () => import('@/views/RunsView.vue'), meta: { title: '运行记录' } },
        { path: 'envs', name: 'envs', component: () => import('@/views/EnvsView.vue'), meta: { title: '环境管理' } },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/UserSettingsView.vue'),
          meta: { title: '用户/设置' },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/cases' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.loaded && auth.isLoggedIn) await auth.loadMe()
  if (to.meta.public) {
    return auth.isLoggedIn ? { path: '/cases' } : true
  }
  if (!auth.isLoggedIn) {
    return { name: 'login', query: to.fullPath === '/' ? {} : { next: to.fullPath } }
  }
  return true
})

onUnauthorized(() => {
  const auth = useAuthStore()
  auth.logout()
  if (router.currentRoute.value.name !== 'login') {
    void router.replace({ name: 'login', query: { next: router.currentRoute.value.fullPath } })
  }
})

export default router
