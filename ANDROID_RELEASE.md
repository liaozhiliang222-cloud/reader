# Android 预览版

## 本地听书测试版 1.1.0-preview（2026-10-13，未公开发布）

本地安装包为 `release/jingye-reader-1.1.0-preview.apk`，versionCode 5、6475630 字节，SHA-256 `81fe3f5530ef732ae2befa239aea897ff0a6cab500e323706e6876ada2a1022b`。签名证书沿用 `c666e187df75ec1d2d61ac7ea73f64d88a0d6f4a5dad22938b7dd23b05e22949`。已经同签名覆盖安装到连接的荣耀 PTP-AN10 / Android 16，四本原有书籍及进度保留；已安装 base.apk 与交付文件哈希一致。

使用：打开书籍 → 阅读菜单 → 更多 → 听书，选择已安装的离线语音，再点「从本页听」。播放条提供暂停/继续、上下句、语速与定时；手动翻页会暂停，继续听书回到原朗读句。返回书架或关闭听书停止声音。锁屏后由原生服务自行读私有队列；锁屏媒体信息隐藏书名与章节名。

正文由独立的系统语音引擎处理，静页只允许标记为无需联网且已安装的语音。静页没有 INTERNET 权限，但这不代表引擎没有联网能力。首次选择和设置页说明此边界；停止、取消、失败清理私有临时正文和单句音频。未新增运行依赖；探针与测试替身不进入正式 APK。

本轮内部验收：431 项 Vitest、21 项产品 JVM、6 项实际 Android instrumentation、4 项 Chromium/WebKit 界面测试通过；后者仅使用无音频原生后端替身。正式 App 实际引擎的离线合成/播放、章末定时和缓存清理通过；实际阅读页播放/媒体暂停/手动翻页/同句回跳/读完停止通过。独立探针的中文声音与后台朗读由用户两次听觉确认。用户明确接受已有测试，取消反复重计连续 60 分钟及缺少耳机/第二台电话的内部验收阻断，因此这些严格场景未标为通过；旧 API、其他品牌、长时分钟定时与 200 万字真机性能仍待扩大验证。T2 选区起读/继续浏览、网页/iOS 听书按各自后续计划推进。本轮没有上传或公开发布。

重现听书检查：`pnpm check:speech-ui`；产品 Java 用 `testReleaseUnitTest -PsignedDeviceTest`，真机用同签名 `assembleReleaseAndroidTest -PsignedDeviceTest` 与 `SpeechAcceptanceTest`。隔离核查脚本 `node scripts/check-tts-probe-isolation.mjs <APK路径>` 检查 Manifest、全部 DEX 和网页资源。完整源码路径与结果见 `DEVELOPMENT_STATUS.md`。

## 公开版本 1.0.1

当前修复版为 `1.0.1`，包名 `dev.jingye.reader`，versionCode `4`，支持 Android 7.0（API 24）及以上。网页版本继续为 `0.0.1` 预览版，两者共用源码，各自保存数据。

包含导入、按钮和启动优化的本地签名 APK 为 6394187 字节，SHA-256：`db3ebbc910f3114530b39c904d2d0045cb3b0f8e04bc13aae825cd16785c8d2c`。签名证书 SHA-256 为 `c666e187df75ec1d2d61ac7ea73f64d88a0d6f4a5dad22938b7dd23b05e22949`，与此前 code 2 / 3 相同。校验文件位于 `release/jingye-reader-1.0.1.apk.sha256`。

### 1.0.1 修复内容

修复“几 MB 的文件却提示超过 50 MB”：WebView JSON 中的普通偏移量是 `Integer`，Capacitor `PluginCall.getLong` 只接受 `Long`，原实现会退回 0，反复读取文件开头直到触发总大小保护。现在从原始 JSONObject 读取数值，保留实际偏移量。50 MB 单文件和 100 MB 单次分享限制保持有效。

已在连接的物理手机上以同一组测试验证旧版失败、新版通过：真实 Android JSON、FileProvider content URI、4.43 MB 分块字节、精确分块末尾与负偏移量。另有 6 项 JVM Java 测试及用户提供 EPUB 的本地分块 SHA / 解析检查。测试使用临时缓存文件，未清空书架；更新后请从文件管理器重新分享原文件，旧的失败提示不会自动变成已导入的书。

控件默认的蓝色触摸高亮已关闭，按钮仅在按下时以正文色和背景色混合出很淡的底色，松开恢复，无额外动画。四种主题的真实浏览器按压和 2px 键盘焦点已检查；本地新版已同签名覆盖安装到连接手机，设备 APK SHA 与本地一致。手机上的实际触摸观感仍待用户确认。

启动时先等待原生分享检查，不再提前显示旧导入错误页；已处理的旧分享路由回到书架，失败原文件仍留在本机可重试。读取与解析统一使用轻柔翻页动效，显示文件名、实际读取量和批次；动效跟随四种主题，系统“减少动态效果”开启时静止显示。连续热分享串行读取，加载层不卸载当前阅读或导入页面，真正失败仍显示原因。旧代码的两项回归先失败，修复后启动/原生/分享专项 20 项通过，完整 388 单测与生产构建通过；四主题在 390px 浏览器视口检查无横向溢出。物理手机上的启动观感仍待用户确认。

## 安装与迁移

从 [Android 1.0.1 Release](https://github.com/liaozhiliang222-cloud/reader/releases/tag/android-v1.0.1) 下载 `jingye-reader-1.0.1.apk`；本地产物保存在 `release/`。APK 可在文件管理器中打开，按系统提示允许该文件管理器安装应用。部分手机会要求确认侧载安装。安装后首次打开即可离线使用。

覆盖安装同包名、同证书的新版会保留应用数据；卸载、清除应用数据会删除书架和笔记。升级或迁移前，在“设置 → 备份与恢复”导出完整备份。网页版与 App 数据独立：在网页版导出完整备份，在 App 内选择该文件恢复。

App 无 INTERNET 权限，不参与系统云备份与自动换机传输。外链由用户点击后交给系统浏览器，主动分享的文件交给用户选择的应用。

## 本地构建

安装 Node.js、pnpm、JDK 21、Android SDK 36（含 build-tools 36.0.0）。设置 `JAVA_HOME` 和 `ANDROID_HOME`，或在被忽略的 `android/local.properties` 中设置 SDK 路径；Windows 盘符冒号应转义，例如 `sdk.dir=D\:/Android/Sdk`。

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build:android
cd android
# Windows 使用 .\gradlew.bat，其他系统使用 bash ./gradlew
bash ./gradlew testDebugUnitTest lintRelease assembleDebug
```

Windows 的中文工作目录可能导致 Gradle Java 测试找不到已编译的类。本次用空闲盘符临时映射项目目录后测试通过，结束时撤销映射；可以从英文路径检出仓库进行 Android 构建。这个问题与 APK 打包或产品功能不同。

发布签名从 `android/keystore.properties` 读取。参考 `android/keystore.properties.example`，密钥放在仓库之外，实际属性文件和密码不能提交。缺少签名配置时，`assembleRelease` 生成未签名产物，不会回退到调试签名。正式发布需保管原密钥并运行：

```sh
bash ./gradlew lintRelease assembleRelease
```

通过 `apksigner verify --print-certs` 核对签名，使用 `aapt dump permissions` 确认没有 INTERNET 权限，再将 `android/app/build/outputs/apk/release/app-release.apk` 作为 Release 附件上传；APK 不进入 Git 源码历史。

原生分块真机专项位于 `NativeImportTest`。可通过 `assembleReleaseAndroidTest -PsignedDeviceTest` 构建同证书的测试包，在已安装的签名 release 上运行 AndroidJUnitRunner，无需卸载主应用。测试完成后仅卸载 `dev.jingye.reader.test`。新增 `org.json:json:20250517` 仅用于 JVM 测试（与 Capacitor 自身测试版本一致），用于覆盖真实 JSON 数值类型；不进入 APK 或网页，gzip 交付增量为 0。

## 验证范围

新增回归覆盖超过 512 KB 的原生分块导入、批量导入部分失败、停滞响应、音量键设置备份、退出阅读页恢复系统栏和常亮申请失败。Java 测试覆盖不支持 skip 的 provider、文件变短和精确 EOF。CI 同时检查网页和 Android，CI 不使用发布密钥。

既有荣耀 Android 16 真机记录保留在 `ANDROID_PLAN.md`；1.0.1 的复核不代替完整物理手机回归。30 MB 以上备份保存/恢复、微信/QQ 的真实 content URI、旧 Android/WebView、长时间常亮与完整迁移链路仍需验证，因此公开版标记为预览发布。1.0.1 没有 TTS，听书由上述本地 1.1.0-preview 提供；项目许可证待定。
