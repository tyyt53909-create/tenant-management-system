import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getUnreadCount } from '@/api/notifications';

/**
 * 未读数共享状态：侧边栏菜单 Badge 与通知列表页共用，
 * 列表页增删改后用 setUnreadCount 同步，避免两处数字打架。
 */
export const useNotificationStore = defineStore('notification', () => {
  const unreadCount = ref(0);

  const setUnreadCount = (value: number) => {
    unreadCount.value = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  };

  /** 拉取最新未读数；失败时保留旧值（错误提示由 request 拦截器统一处理） */
  const fetchUnreadCount = async () => {
    try {
      const res = await getUnreadCount();
      setUnreadCount(res?.unreadCount ?? 0);
    } catch {
      /* 保留旧值 */
    }
  };

  return { unreadCount, setUnreadCount, fetchUnreadCount };
});
