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
    path: '/',
    component: () => import('@/components/layout/MainLayout.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: '/dashboard',
        name: 'Dashboard',
        component: () => import('@/views/dashboard/index.vue'),
        meta: { title: '仪表板', icon: 'DataLine' },
      },
      {
        path: '/rooms',
        name: 'Rooms',
        component: () => import('@/views/rooms/index.vue'),
        meta: { title: '房源管理', icon: 'House' },
      },
      {
        path: '/cleaning',
        name: 'Cleaning',
        component: () => import('@/views/cleaning/index.vue'),
        meta: { title: '保洁管理', icon: 'Brush' },
      },
      {
        path: '/tenants',
        name: 'Tenants',
        component: () => import('@/views/tenants/index.vue'),
        meta: { title: '租客管理', icon: 'User' },
      },
      {
        path: '/buildings',
        name: 'Buildings',
        component: () => import('@/views/buildings/index.vue'),
        meta: { title: '楼栋管理', icon: 'OfficeBuilding' },
      },
      {
        path: '/contracts',
        name: 'Contracts',
        component: () => import('@/views/contracts/index.vue'),
        meta: { title: '合同管理', icon: 'Document' },
      },
      {
        path: '/bills',
        name: 'Bills',
        component: () => import('@/views/bills/index.vue'),
        meta: { title: '账单管理', icon: 'Tickets' },
      },
      {
        path: '/prepay',
        name: 'Prepay',
        component: () => import('@/views/prepay/index.vue'),
        meta: { title: '预付账户', icon: 'Wallet' },
      },
      {
        path: '/maintenance',
        name: 'Maintenance',
        component: () => import('@/views/maintenance/index.vue'),
        meta: { title: '报修管理', icon: 'Tools' },
      },
      {
        path: '/meters',
        name: 'Meters',
        component: () => import('@/views/meters/index.vue'),
        meta: { title: '水电表管理', icon: 'Odometer' },
      },
      {
        path: '/checkout',
        name: 'Checkout',
        component: () => import('@/views/checkout/index.vue'),
        meta: { title: '退租管理', icon: 'Switch' },
      },
    ],
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// 路由守卫
router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem('access_token');

  if (to.path === '/login') {
    next();
  } else if (!token) {
    next('/login');
  } else {
    next();
  }
});

export default router;
