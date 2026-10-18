import { useState } from 'react';

/**
 * 布局外壳状态：移动端抽屉与侧栏折叠。
 */
export function useShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('postflare-sidebar') === 'collapsed',
  );

  const toggleSidebar = () => {
    setSidebarCollapsed(current => {
      const next = !current;

      localStorage.setItem(
        'postflare-sidebar',
        next ? 'collapsed' : 'expanded',
      );

      return next;
    });
  };

  return {
    drawerOpen,
    setDrawerOpen,
    closeDrawer: () => setDrawerOpen(false),
    sidebarCollapsed,
    toggleSidebar,
  };
}
