# Android 预览版

当前修复版为 `1.0.1`，包名 `dev.jingye.reader`，versionCode `4`，支持 Android 7.0（API 24）及以上。网页版本继续为 `0.0.1` 预览版，两者共用源码，各自保存数据。

本次签名 APK 为 6393007 字节，SHA-256：`7eaab8707bd31cee57a386fbbebde166e3715b6b302fabed5f5ba74eb2f3a0e5`。签名证书 SHA-256 为 `c666e187df75ec1d2d61ac7ea73f64d88a0d6f4a5dad22938b7dd23b05e22949`，与此前 code 2 / 3 相同。下载时可对照同页的 `.sha256` 附件。

### 1.0.1 修复内容

修复“几 MB 的文件却提示超过 50 MB”：WebView JSON 中的普通偏移量是 `Integer`，Capacitor `PluginCall.getLong` 只接受 `Long`，原实现会退回 0，反复读取文件开头直到触发总大小保护。现在从原始 JSONObject 读取数值，保留实际偏移量。50 MB 单文件和 100 MB 单次分享限制保持有效。

已在连接的物理手机上以同一组测试验证旧版失败、新版通过：真实 Android JSON、FileProvider content URI、4.43 MB 分块字节、精确分块末尾与负偏移量。另有 6 项 JVM Java 测试及用户提供 EPUB 的本地分块 SHA / 解析检查。测试使用临时缓存文件，未清空书架；更新后请从文件管理器重新分享原文件，旧的失败提示不会自动变成已导入的书。

## 安装与迁移

从 [GitHub Releases](https://github.com/liaozhiliang222-cloud/reader/releases) 下载 `jingye-reader-1.0.1.apk`，在文件管理器中打开，按系统提示允许该文件管理器安装应用。部分手机会要求确认侧载安装。安装后首次打开即可离线使用。

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

既有荣耀 Android 16 真机记录保留在 `ANDROID_PLAN.md`；本次复核不代替完整物理手机回归。30 MB 以上备份保存/恢复、微信/QQ 的真实 content URI、旧 Android/WebView、长时间常亮与完整迁移链路仍需验证，因此本次标记为预览发布。TTS 仅有计划，尚未实现；项目许可证待定。
