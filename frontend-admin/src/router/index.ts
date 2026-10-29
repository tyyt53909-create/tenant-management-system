import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/login/index.vue'),
    meta: { title: '登录' },
  },
  {
    // 公开看房页（P1 / T155）：无需登录，只展示可租房源，不含任何租客信息
    path: '/viewing',
    name: 'PublicViewing',
    component: () => import('@/views/public/index.vue'),
    meta: { title: '在租房源', public: true },
  },
  {
    path: '/',
    component: () => import('@/components/layout/MainLayout.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: '/dashboard',
        name: 'Dashboard',
        component: () => import('@/views/dashboard/index.vue'),
        meta: { title: '仪表板', icon: 'DataLine', roles: ['ADMIN'] },
      },
      {
        path: '/rooms',
        name: 'Rooms',
        component: () => import('@/views/rooms/index.vue'),
        meta: { title: '房源管理', icon: 'House', roles: ['ADMIN', 'CLEANER'] },
      },
      {
        path: '/space',
        name: 'Space',
        component: () => import('@/views/space/index.vue'),
        meta: { title: '房源模型', icon: 'Grid', roles: ['ADMIN', 'CLEANER'] },
      },
      {
        path: '/space/editor',
        name: 'SpaceEditor',
        component: () => import('@/views/space/editor.vue'),
        meta: { title: '编辑平面图', roles: ['ADMIN'] },
      },
      {
        path: '/cleaning',
        name: 'Cleaning',
        component: () => import('@/views/cleaning/index.vue'),
        meta: { title: '保洁管理', icon: 'Brush', roles: ['ADMIN', 'CLEANER'] },
      },
      {
        path: '/tenants',
        name: 'Tenants',
        component: () => import('@/views/tenants/index.vue'),
        meta: { title: '租客管理', icon: 'User', roles: ['ADMIN'] },
      },
      {
        path: '/buildings',
        name: 'Buildings',
        component: () => import('@/views/buildings/index.vue'),
        meta: { title: '楼栋管理', icon: 'OfficeBuilding', roles: ['ADMIN'] },
      },
      {
        path: '/contracts',
        name: 'Contracts',
        component: () => import('@/views/contracts/index.vue'),
        meta: { title: '合同管理', icon: 'Document', roles: ['ADMIN'] },
      },
      { path: '/expenses', name: 'Expenses', component: () => import('@/views/expenses/index.vue'), meta: { title: '支出记录', roles: ['ADMIN', 'FINANCIAL'] } },
      {
        path: '/bills',
        name: 'Bills',
        component: () => import('@/views/bills/index.vue'),
        meta: { title: '账单管理', icon: 'Tickets', roles: ['ADMIN'] },
      },
      {
        path: '/prepay',
        name: 'Prepay',
        component: () => import('@/views/prepay/index.vue'),
        meta: { title: '预付账户', icon: 'Wallet', roles: ['ADMIN'] },
      },
      {
        path: '/maintenance',
        name: 'Maintenance',
        component: () => import('@/views/maintenance/index.vue'),
        meta: { title: '报修管理', icon: 'Tools', roles: ['ADMIN'] },
      },
      {
        path: '/meters',
        name: 'Meters',
        component: () => import('@/views/meters/index.vue'),
        meta: { title: '水电表管理', icon: 'Odometer', roles: ['ADMIN'] },
      },
      {
        path: '/checkout',
        name: 'Checkout',
        component: () => import('@/views/checkout/index.vue'),
        meta: { title: '退租管理', icon: 'Switch', roles: ['ADMIN'] },
      },
      {
        path: '/announcements',
        name: 'Announcements',
        component: () => import('@/views/announcements/index.vue'),
        meta: { title: '公告管理', icon: 'ChatDotSquare', roles: ['ADMIN'] },
      },
      {
        path: '/notifications',
        name: 'Notifications',
        component: () => import('@/views/notifications/index.vue'),
        meta: { title: '通知提醒', icon: 'Bell', roles: ['ADMIN', 'CLEANER', 'TENANT'] },
      },
      {
        path: '/audit',
        name: 'Audit',
        component: () => import('@/views/audit/index.vue'),
        meta: { title: '审计日志', icon: 'Document', roles: ['ADMIN'] },
      },
      {
        path: '/statistics',
        name: 'Statistics',
        component: () => import('@/views/statistics/index.vue'),
        meta: { title: '统计报表', icon: 'TrendCharts', roles: ['ADMIN'] },
      },
      {
        path: '/settings',
        name: 'Settings',
        component: () => import('@/views/settings/index.vue'),
        meta: { title: '系统设置', roles: ['ADMIN'] },
      },
      {
        path: '/forbidden',
        name: 'Forbidden',
        component: () => import('@/views/forbidden/index.vue'),
        meta: { title: '无权访问' },
      },
    ],
  },
];

import { useUserStore } from '@/stores/user';
import { canAccessRoute } from '@/utils/access';

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// 路由守卫
router.beforeEach(async (to) => {
  // 公开路由（登录页、公开看房页）无需鉴权
  if (to.path === '/login' || to.meta?.public) {
    return true;
  }

  const userStore = useUserStore();
  if (!userStore.token) {
    const success = await userStore.restoreSession();
    if (!success) {
      return '/login';
    }
  }

  // 角色校验（FE-01）：未登录时上面已处理；用户信息缺失时先取一次再判断，
  // 否则刷新页面首次导航会因为 user=null 被误判成无权限。
  if (!userStore.user) {
    await userStore.fetchUserInfo();
  }
  if (to.path !== '/forbidden' && !canAccessRoute(userStore.user?.role, to.meta)) {
    return { path: '/forbidden', query: { from: to.fullPath } };
  }

  return true;
});

export default router;
