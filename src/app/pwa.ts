import { t } from '@/i18n';
import { signal } from '@preact/signals';
import { createPwaClient, initialPwaState } from './pwaClient';
import { parseRoute } from './router';
import { isNativeApp } from './platform';

export const pwaState = signal(initialPwaState());
let client: ReturnType<typeof createPwaClient> | undefined;
export function startPwa(checkUpdates: boolean) {
  if (!import.meta.env.PROD) return;
  // App 版资源打包在安装包中，升级走 APK，不注册 Service Worker。
  if (isNativeApp) return;
  if (!('serviceWorker' in navigator)) {
    pwaState.value = {
      ...pwaState.value,
      error: t('当前环境不支持离线安装，请使用系统浏览器和 HTTPS 地址。'),
    };
    return;
  }
  if (!client) {
    client = createPwaClient(
      navigator.serviceWorker,
      (value) => {
        pwaState.value = value;
      },
      {
        online: () => navigator.onLine,
        visible: () => document.visibilityState === 'visible',
        shelf: () => parseRoute(location.hash).page === 'shelf',
        reload: () => location.reload(),
      },
    );
    document.addEventListener('visibilitychange', () => void client?.check());
    window.addEventListener('online', () => void client?.check());
  }
  void client.start(checkUpdates);
}
export function applyPwaUpdate() {
  client?.apply();
}
export function checkPwaUpdate() {
  return client?.check(true);
}
