# T0 安卓听书探针

独立 applicationId `dev.jingye.ttsprobe`，仅使用原创测试文本。正式阅读器不依赖本模块；只有 Gradle 参数 `-PttsProbe` 才包含它，并禁用 release variant。测试不能代替正式阅读器的 TTS-17 验收。

## 构建

从仓库根目录执行：

```powershell
pnpm exec tsc --noEmit -p android/tts-probe/web/tsconfig.json
node scripts/build-tts-probe-web.mjs
cd android
.\gradlew.bat -PttsProbe :tts-probe:testDebugUnitTest :tts-probe:lintDebug :tts-probe:assembleDebug
```

Windows 中文路径如导致 Java 类加载失败，可临时映射空闲盘符后在该盘符的 `android` 下构建；完成后撤销映射，不删除工作区。不要在正在进行锁屏测试时安装新包或运行会重启探针进程的 instrumentation。

## 测试范围与数据

- 主界面检查引擎语音、生成 10 万 / 200 万字队列，显式点播放才出声。锁屏后完全由原生服务取文，不运行 WebView 补货。
- 飞行模式实测需要同时确认 Wi-Fi 关闭且无活动网络；语音引擎本身的 INTERNET 权限单独列出。结束后恢复测试前的网络设置。
- `files/voices-*.json` 保存引擎/语音属性；`files/events.jsonl`、`files/checkpoint.json` 只含合成文本序号与状态，不记录用户正文。
- 原生生成报告 `files/prepare-*.json` 仅表示原生探针队列耗时，不能当作 TS/桥接准备性能。
- 「桥接准备性能」使用实际共享 TS 分句/批次和 Java `SpeechQueueStore`（仅复制两份纯 Java 源文件编译），在本机 WebView 与 JavaScriptInterface 之间逐批 ACK、校验并 fsync。报告 `files/bridge-*.json` 分开记录 10 万字单章、200 万字千章/单章。测试不含真实 EPUB/IndexedDB 读取和 Capacitor 开销；内存为采样值，不能声称精确峰值。
- 取消或离开准备页会取消准备；成功、失败或取消后清理探针私有临时正文。读回报告核对 `queueRemoved`，不能仅看界面提示。
- `scripts/tts-probe-monitor.ps1` 只读采集每 30 秒的屏幕、电源、网络和播放检查点。连续锁屏须检查整个区间，不能把服务总存活时间当作锁屏时长；手动亮屏后重新计时。
- 通知显示、真正出声、耳机断开、来电等必须记录物理设备结果。ADB 直接 MediaSession 控制或焦点测试只证明相应软件路径，不能代替实际耳机/电话。

## 发布隔离检查

先构建正式 `:app:assembleRelease`，然后在根目录执行：

```powershell
node scripts/check-tts-probe-isolation.mjs path/to/app-release.apk
```

该脚本检查 release Manifest、全部 DEX 及网页资源，报告绑定 APK SHA-256。当前结果与未完成项统一记录在仓库 `DEVELOPMENT_STATUS.md`，不在这里复制易过期的通过状态。
