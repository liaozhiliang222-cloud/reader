import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // 临时应用 ID，首个公开发布前可在本文件确认后修改（见 ANDROID_PLAN.md 第 9 节）
  appId: 'dev.jingye.reader',
  appName: '微光阅读',
  webDir: 'dist',
  android: {
    // 构建产物已包含全部离线资源，无需远程加载
    allowMixedContent: false,
  },
};

export default config;
