# Android 预览版

首个 APK 为 `1.0.0`，包名 `dev.jingye.reader`，versionCode `3`，支持 Android 7.0（API 24）及以上。网页版本继续为 `0.0.1` 预览版，两者共用源码，各自保存数据。

本次签名 APK 为 6393003 字节，SHA-256：`1fbd7aebf67276bd9a1289cbf4dc55b4d234c244633a4d6120a4322dbf7e057f`。签名证书 SHA-256 为 `c666e187df75ec1d2d61ac7ea73f64d88a0d6f4a5dad22938b7dd23b05e22949`，与此前本地 code 2 相同。下载时可对照同页的 `.sha256` 附件。

## 安装与迁移

从 [GitHub Releases](https://github.com/liaozhiliang222-cloud/reader/releases) 下载 `jingye-reader-1.0.0.apk`，在文件管理器中打开，按系统提示允许该文件管理器安装应用。部分手机会要求确认侧载安装。安装后首次打开即可离线使用。

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

## 验证范围

新增回归覆盖超过 512 KB 的原生分块导入、批量导入部分失败、停滞响应、音量键设置备份、退出阅读页恢复系统栏和常亮申请失败。Java 测试覆盖不支持 skip 的 provider、文件变短和精确 EOF。CI 同时检查网页和 Android，CI 不使用发布密钥。

既有荣耀 Android 16 真机记录保留在 `ANDROID_PLAN.md`；本次复核不代替完整物理手机回归。30 MB 以上备份保存/恢复、微信/QQ 的真实 content URI、旧 Android/WebView、长时间常亮与完整迁移链路仍需验证，因此本次标记为预览发布。TTS 仅有计划，尚未实现；项目许可证待定。
