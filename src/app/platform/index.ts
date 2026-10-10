import { signal } from '@preact/signals';
import { Capacitor } from '@capacitor/core';

/** 当前运行在 Capacitor 原生壳内（Android App），还是普通浏览器/PWA。 */
export const isNativeApp = Capacitor.isNativePlatform();
export const platformKind: 'web' | 'android' = isNativeApp ? 'android' : 'web';

/** 原生沉浸模式状态（隐藏系统状态栏与导航栏）。 */
export const nativeImmersive = signal(false);

/** 原生能力仅在 App 内执行；共享网页构建也包含惰性桥模块，体积以实际构建为准。 */
export const nativeApp = () => import('./native');
