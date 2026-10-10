# 静页 · 安卓 App 打包计划

> 状态：A0–A3 已实施并有部分真机记录；2026-10-10 正在复核源码和首个 APK 预览发布。完整真机回归仍待补。
> 范围：把现有 PWA 打包为安卓 App，补齐 WebView 下缺失的能力，并为原生听书（`TTS_PLAN.md`）铺路。
> 任务卡格式、复杂度定义与工作流沿用 `DEV_PLAN.md` 第 0 章。iOS 暂不涉及（没有 Mac）。

---

## 1. 结论与目标

- **采用 Capacitor 原生壳**，不用原计划 M4-05 的 TWA。TWA 本质上是用 Chrome 打开网站，做不到音量键翻页和锁屏听书，与 M4-07「原生增强」的目标矛盾。
- **网页版和 App 版共用一套代码**：`src/` 不分叉，平台差异集中在一个“平台层”，UI 不感知自己运行在哪里。
- **App 不申请联网权限**（需 A0-02 验证可行）。这样「零联网」就是系统层面可以验证的事实。
- **首个发布渠道是 GitHub Releases 的签名 APK**，商店上架放到最后，单独评估资质。

### App 版相对 PWA 的收益

| 能力                   | PWA                                        | 安卓 App                                 |
| ---------------------- | ------------------------------------------ | ---------------------------------------- |
| 首次打开即可离线       | 要等 Service Worker 预缓存完（实测约 13s） | 资源在安装包里，装完即可离线             |
| 联网                   | 由浏览器决定，靠 CSP 自我约束              | 不申请 INTERNET 权限，系统层面断网       |
| 数据被系统清理         | 浏览器存储可能被清理                       | App 私有存储，卸载前不会被清             |
| 用「打开方式」导入文件 | 依赖安装后的 `file_handlers`，支持有限     | 注册 Intent，文件管理器、微信、QQ 都能用 |
| 音量键翻页             | 做不到                                     | 可以                                     |
| 锁屏听书               | 做不到                                     | 可以（前台服务 + 媒体会话，见 TTS_PLAN） |
| 更新                   | 部署后即时生效                             | 要重新出包、重新安装                     |

---

## 2. 技术选型

| 方案                              | 说明                                                  | 结论                                                              |
| --------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| TWA（Bubblewrap / PWABuilder）    | Chrome 打开已部署的网站，外面套一个 App               | **不采用**：没有原生能力，还要依赖线上域名                        |
| **Capacitor**                     | 系统 WebView 加载打包进 APK 的 `dist`，可以写原生插件 | **采用**：现有代码几乎不用改，原生能力按需补                      |
| 纯原生重写（Kotlin / Flutter 等） | 重新实现阅读器                                        | **不采用**：分页、定位、标注、备份等约 2 万行逻辑要重写，风险最高 |

依赖原则（遵守 AGENTS.md）：

- 只引入 Capacitor 官方核心包和确实需要的官方插件；社区插件逐个评估，能自己写的小功能（打开方式、音量键）用项目内的本地插件实现。
- 版本选择发布超过 7 天的稳定版并锁定版本号；每个新依赖都记录用途和 gzip 后的 JS 体积（以实际构建结果为准）。
- 原生插件仅在 App 内执行。当前使用运行时平台判断，网页版仍包含 Capacitor 核心和惰性桥模块，PWA 会缓存它们；“网页零增量”尚未达到，体积以实际构建为准。

---

## 3. 现有代码的适配清单

以下根据当前代码梳理。“需验证”的项目在 A0 阶段实测确认，不以本文推断为准。

| #   | 现有实现                                                                          | WebView 中的情况                                                                      | App 版处理                                                                                                                |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | Service Worker 离线与更新（`src/sw.ts`、`src/app/pwa.ts`、`pwaClient.ts`）        | 不需要：资源已经在安装包里                                                            | App 构建不注册 SW；设置页「离线与更新」换成“版本号 + 前往发布页查看更新”                                                  |
| 2   | 安装引导（`src/app/install.ts`、引导页里的“添加到主屏幕”）                        | 不适用                                                                                | App 中隐藏安装相关的步骤和提示                                                                                            |
| 3   | 分享导入 `share_target`、`launchQueue`（`src/app/fileLaunch.ts`、`incoming*.ts`） | 不可用                                                                                | 原生 Intent（`ACTION_VIEW` / `ACTION_SEND`）读取 `content://` 文件后，转成现有的 `IncomingData`，复用现有的导入流程和暂存 |
| 4   | 下载：`downloadBlob` 用 `<a download>` 下载 blob（备份、笔记导出）                | WebView 默认不处理 blob 下载（需验证）                                                | 改用系统“另存为”选择位置保存，或调用系统分享                                                                              |
| 5   | 分享：`navigator.share`（备份、笔记）                                             | WebView 不支持 Web Share（需验证）                                                    | 调用原生分享面板                                                                                                          |
| 6   | 剪贴板：读取剪贴板（粘贴页）、写入（复制链接）                                    | 读取可能受限（需验证）                                                                | 写入沿用现有的兜底逻辑；读取失败时沿用现有提示“请长按粘贴”                                                                |
| 7   | 全屏：`requestFullscreen`（`src/reader/useImmersive.ts`）                         | WebView 里通常无效（需验证）                                                          | 改为原生沉浸模式：隐藏状态栏和导航栏                                                                                      |
| 8   | 屏幕常亮：Screen Wake Lock（`src/reader/WakeLock.ts`）                            | 需验证                                                                                | 不可用时改用原生的保持亮屏标志，`ReaderWakeLock` 的接口不变                                                               |
| 9   | 持久化存储申请（`src/app/storage.ts`）                                            | 不需要                                                                                | 隐藏「申请持久化存储」，存储信息照常显示                                                                                  |
| 10  | 可选文楷字体（`src/app/optionalFont.ts`）                                         | `fetch` 同源地址，在 App 里读的是安装包内的文件，不联网；Cache Storage 是否可用需验证 | 保留现有流程，文案从“下载”改为“启用”；Cache Storage 不可用时直接从安装包加载                                              |
| 11  | 环境提示（`src/app/environment.ts`：iOS 版本、微信/QQ 内置浏览器）                | 不适用                                                                                | App 中不显示这些提示                                                                                                      |
| 12  | 返回键（`src/app/useBackClose.ts` 基于 history）                                  | 系统返回键需要接到 WebView 的历史记录                                                 | 原生返回键转成 `history.back()`；在书架首页再按一次返回才退出 App                                                         |
| 13  | 外部链接（关于页的源码、Issues、邮箱）                                            | WebView 内不应打开外部网页                                                            | 用系统浏览器或邮件 App 打开（我们的 App 本身仍不联网）                                                                    |
| 14  | 状态栏颜色（`theme-color`）                                                       | 不生效                                                                                | 主题切换时同步原生状态栏颜色和图标深浅                                                                                    |
| 15  | CSP（`scripts/security-policy.ts` 注入的 meta）                                   | Capacitor 页面来源为 `https://localhost`，需要确认 meta CSP 与原生桥接兼容            | 保留 CSP，不放宽 `connect-src`；如有冲突，只针对桥接做最小调整并写入安全记录                                              |
| 16  | 备份格式与 IndexedDB                                                              | 正常可用，但 App 和网页版的数据**互不相通**                                           | 引导页提供「从网页版迁移」：网页版导出完整备份，App 内恢复                                                                |

### 平台层设计

新增 `src/app/platform/`，用接口隔离差异，现有的调用点改为调用平台层：

```ts
interface Platform {
  kind: 'web' | 'android';
  saveFile(blob: Blob, name: string): Promise<void>;
  shareFile(blob: Blob, name: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  setImmersive(on: boolean): Promise<void>;
  keepAwake(on: boolean): Promise<void>;
  setStatusBar(theme: ReadingSettings['theme']): void;
  onIncoming(handler: (data: IncomingData) => Promise<void>): void;
  onBack(handler: () => boolean): void; // 返回 false 表示交给系统处理（退出）
  onVolumeKey?(handler: (dir: 1 | -1) => boolean): () => void;
}
```

- `web.ts`：包装现有实现，行为完全不变，现有单测和 E2E 继续覆盖。
- `android.ts`：调用 Capacitor 插件，只在 App 构建中通过动态 `import()` 加载。
- 构建：`pnpm build:android` 使用 `vite build --mode android`，关掉 PWA 插件、不生成 `sw.js`，再执行 `cap sync`。

---

## 4. 网络权限策略

1. 目标：`AndroidManifest.xml` 中**不声明** `android.permission.INTERNET`。
2. 风险：Capacitor 的模板默认带有这个权限；需要实测去掉后本地页面加载、Worker、IndexedDB、字体加载是否都正常（A0-02）。
3. 开发调试：热更新需要联网，所以只在 debug 构建的清单中加这个权限，release 构建不带。
4. 退路：如果去掉权限后无法运行，就保留权限，并用 CSP 加上 Android 的 Network Security Config 禁止所有明文和外部连接，同时把隐私说明改为如实描述。这个决定记录在本文件第 9 节。

---

## 5. 签名、版本与分发

- **签名密钥**：生成 release keystore，**你自己保管两份离线备份**。密钥丢失后就无法再给已安装的用户发布更新；密钥和密码不得进入仓库或 CI 日志。
- **应用 ID**：需要你确定，例如 `io.github.<你的用户名>.jingye`。一旦发布就不能再改。
- **版本号**：`versionName` 与 `package.json` 的 `version` 保持一致；`versionCode` 每次发布递增。
- **首发渠道**：GitHub Releases 发布签名 APK，并附上 SHA-256。关于页增加“检查更新：前往发布页”（由用户手动点击，App 本身不联网检查）。
- **以后上架**（单独评估，规则以各平台现行要求为准）：
  - Google Play：需要开发者账号；新的个人账号在正式上架前通常要先做封闭测试。
  - 国内应用商店：一般需要软件著作权和 App 备案等资质，个人开发者的门槛较高。

---

## 6. 测试策略

| 层次     | 方式                                                 | 说明                                                                      |
| -------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| 共用逻辑 | 现有 Vitest 和 Playwright                            | 网页版的覆盖不减少；平台层 `web.ts` 必须保持现有行为                      |
| 平台层   | Vitest + 模拟插件                                    | 覆盖 `android.ts` 的分支：保存失败、取消分享、Intent 数据转换、返回键分发 |
| App 冒烟 | 真机手动清单（第 7 节各验收项）                      | WebView 版本各不相同，**真机验收是硬性退出条件**                          |
| 可选     | Playwright 实验性的安卓支持（通过 adb 连接 WebView） | A3 阶段评估，不作为必需项                                                 |

真机矩阵（至少）：

- 你的主力安卓手机（记录品牌、系统版本、WebView 版本）。
- 一台国产 ROM 的旧机型，或安卓模拟器中较低的系统版本。

---

## 7. 开发计划

### 阶段总览

| 阶段          | 任务数 | 目标                                            | 退出条件                                                 |
| ------------- | ------ | ----------------------------------------------- | -------------------------------------------------------- |
| A0 环境与验证 | 3      | 装好工具链，确认关键能力在 WebView 中的实际行为 | 第 3 节所有“需验证”项都有实测结论                        |
| A1 壳与适配   | 6      | 现有全部功能在 App 中可用                       | 真机上完整走一遍：导入、阅读、标注、备份恢复、主题、离线 |
| A2 原生增强   | 3      | 打开方式导入、音量键翻页、沉浸模式              | 真机验收通过，自用一周                                   |
| A3 发布       | 3      | 签名 APK 发布到 GitHub Releases                 | 安装、升级、数据保留全部验证                             |
| 之后          | —      | 原生听书                                        | 见 `TTS_PLAN.md`（需按 App 方向修订）                    |

### 7.1 A0 环境与验证

#### A0-01 安装工具链 `S`

- 依赖：无
- 目标：Windows 上可以构建并安装 debug 包到真机
- 涉及：本机环境；`AGENTS.md` 补充安卓相关命令
- AI 要点：安装 Android Studio（自带 JDK 和 SDK）；手机开启 USB 调试；用 `adb devices` 确认能连上；在 AGENTS.md 中记录 JDK / SDK 版本和常用命令
- 验收：
  - ☐ `adb devices` 能看到你的手机
  - ☐ Android Studio 的示例项目能装到手机上

#### A0-02 最小壳与能力探针 `M`

- 依赖：A0-01
- 目标：用当前 `dist` 生成一个 debug App，实测第 3 节的“需验证”项
- 涉及：`capacitor.config.ts`、`android/`（Capacitor 生成）、`package.json`
- AI 要点：初始化 Capacitor，`webDir` 指向 `dist`；分别在**保留**和**去掉** INTERNET 权限的情况下各装一次；逐项记录：页面加载、解析 Worker、IndexedDB、Cache Storage、blob 下载、Web Share、剪贴板读写、`requestFullscreen`、Screen Wake Lock、CSP 报错、系统返回键的行为；记录 WebView 版本
- 验收：
  - ☐ App 能打开书架并导入一本 TXT、一本 EPUB、一本 MD
  - ☐ 结果表写入本文件第 9 节，每项标注“可用 / 不可用 / 需替换”

#### A0-03 方案确认 `S`

- 依赖：A0-02
- 目标：根据实测结果确认联网权限策略、需要的插件清单和 A1 的范围
- 涉及：本文件第 4 节、第 9 节
- 验收：
  - ☐ 插件清单写明用途、来源和 JS 体积
  - ☐ 由你确认应用 ID 和最低支持的安卓版本

### 7.2 A1 壳与适配

#### A1-01 平台层与 Android 构建模式 `M`

- 依赖：A0-03
- 目标：`src/app/platform/` 落地；`pnpm build:android` 不生成 SW，网页版构建产物不变
- 涉及：`src/app/platform/*`、`vite.config.ts`、`package.json`、`src/main.tsx`、`src/app/pwa.ts`
- AI 要点：网页版构建前后的 `dist` 资源清单和 SHA 保持一致（`prepare-deployment` 验证）；平台识别不依赖 UA 字符串；App 构建中的 PWA 安装、更新、环境提示相关代码不执行
- 验收：
  - ☐ 网页版全量 E2E 结果和改动前一致
  - ☐ App 中设置页显示版本号，不显示“离线与更新”和“申请持久化存储”

#### A1-02 保存与分享文件 `M`

- 依赖：A1-01
- 目标：完整备份、轻量备份、笔记 Markdown 能在 App 中保存到用户选择的位置，或通过系统分享发出
- 涉及：`src/app/files.ts`、`src/app/platform/android.ts`、`BackupPanel.tsx`、`NotesPanel.tsx`
- AI 要点：大文件（完整备份可能几十 MB）分块写入，避免一次性把整个 base64 放进内存；用户取消保存不算报错；保存成功后的提示与网页版文案统一
- 验收：
  - ☐ 保存 30MB 以上的完整备份，在文件管理器中能找到，并且能恢复
  - ☐ 笔记能通过系统分享发到微信或其他 App

#### A1-03 返回键、外链与状态栏 `S`

- 依赖：A1-01
- 目标：系统返回键与现有的浮层关闭顺序一致；外部链接用系统浏览器打开；状态栏颜色跟随主题
- 涉及：`src/app/platform/android.ts`、`src/app/useBackClose.ts`、`src/app/theme.ts`、`src/pages/About/AboutPage.tsx`
- 验收：
  - ☐ 阅读页按返回键的顺序：浮层 → 菜单 → 书架 → 再按一次退出
  - ☐ 4 套主题下状态栏颜色和图标的深浅都正确

#### A1-04 沉浸模式与屏幕常亮 `S`

- 依赖：A1-01
- 目标：「全屏阅读」在 App 中隐藏系统状态栏和导航栏；「阅读时常亮」在 App 中生效
- 涉及：`src/reader/useImmersive.ts`、`src/reader/WakeLock.ts`、`src/app/platform/android.ts`
- AI 要点：保持 `ReaderWakeLock` 的状态语义（含“5 分钟无操作”）；退出阅读页时恢复系统栏
- 验收：
  - ☐ 全屏后从屏幕边缘滑动可以临时呼出系统栏，阅读位置不变
  - ☐ 常亮 3 种模式在真机上的表现符合设置

#### A1-05 首次引导与网页版数据迁移 `S`

- 依赖：A1-02
- 目标：App 首次打开时说明数据不与网页版互通，并给出迁移步骤
- 涉及：`src/pages/Onboarding/Onboarding.tsx`
- AI 要点：去掉“添加到主屏幕”步骤；新增“已有网页版数据？在网页版设置中导出完整备份，再到这里恢复”
- 验收：
  - ☐ 网页版的完整备份在 App 中恢复后，书、进度、书签、笔记全部保留

#### A1-06 App 全功能真机回归 `M`

- 依赖：A1-02 ～ A1-05
- 目标：按 `DEV_PLAN.md` 第 8 章的回归清单在 App 中完整走一遍
- 涉及：`DEVELOPMENT_STATUS.md` 记录结果
- 验收：
  - ☐ 飞行模式下首次安装即可正常阅读
  - ☐ 千章 TXT、大 EPUB、MD 图文包在真机上能导入和阅读
  - ☐ 杀掉进程后重新打开，进度正确

### 7.3 A2 原生增强

#### A2-01 用「打开方式」导入 `M`

- 依赖：A1-06
- 目标：在文件管理器、微信、QQ 中把 EPUB / TXT / MD 文件用静页打开，或分享给静页
- 涉及：`android/app/src/main/AndroidManifest.xml`、本地插件（Kotlin）、`src/app/platform/android.ts`、`src/app/incoming*.ts`
- AI 要点：处理 `ACTION_VIEW` 和 `ACTION_SEND` / `ACTION_SEND_MULTIPLE`；通过 `ContentResolver` 读取 `content://`，不申请存储权限；按文件头和扩展名判断类型，不信任 MIME；复用现有的暂存和导入流程，冷启动和 App 已打开两种情况都要处理
- 验收：
  - ☐ 冷启动和热启动下，从微信打开 EPUB 都能导入
  - ☐ 一次分享多个文件，失败的文件能保留并重试（与网页版 SHARE-MIXED 的行为一致）

#### A2-02 音量键翻页 `M`

- 依赖：A1-06
- 目标：阅读页中音量键翻页；其他页面音量键照常调节音量
- 涉及：本地插件（`MainActivity` 拦截按键）、`src/app/platform/android.ts`、`ReaderView.tsx`、`ReadingControls.tsx`（新增开关，默认关闭）
- AI 要点：只在阅读页、开关打开且没有浮层时拦截；长按不连续翻页；听书播放时不拦截（留给音量调节）；设置项进入备份
- 验收：
  - ☐ 音量下键下一页、上键上一页；打开菜单或目录时音量键恢复调音量

#### A2-03 应用图标与启动画面 `S`

- 依赖：A1-06
- 目标：自适应图标、启动画面与纸色主题一致，冷启动不出现白屏闪烁
- 涉及：`android/app/src/main/res/`、`public/icons/`
- 验收：
  - ☐ 浅色、深色系统下图标和启动画面都正常

### 7.4 A3 发布

#### A3-01 签名与 release 构建 `S`

- 依赖：A2-01 ～ A2-03
- 目标：本地可以构建签名的 release APK
- 涉及：`android/app/build.gradle`、`.gitignore`、`DEPLOYMENT.md`
- AI 要点：密钥路径和密码只从本机环境变量或不入库的配置读取；release 清单中不包含 INTERNET 权限（如果 A0-03 确认可行）；开启代码压缩前先确认插件的混淆规则
- 验收：
  - ☐ `aapt dump permissions`（或 Android Studio 的 APK 分析器）确认权限清单符合预期
  - ☐ 密钥文件不在 `git status` 中出现

#### A3-02 升级与数据保留验证 `S`

- 依赖：A3-01
- 目标：用同一个密钥签名的新版本覆盖安装后，数据完整保留
- 验收：
  - ☐ 旧版本写入的书、进度、书签、笔记、设置在升级后全部还在

#### A3-03 GitHub Releases 发布 `S`

- 依赖：A3-02
- 目标：发布第一个 APK 版本
- 涉及：`CHANGELOG.md`、`README.md`、关于页
- AI 要点：附上 APK 的 SHA-256；README 说明安装方法（允许安装未知来源应用）、和网页版数据不互通、迁移方法；如实写明只在列出的机型上验证过
- 验收：
  - ☐ 从 Releases 下载的 APK 在另一台手机上能安装运行

---

## 8. 风险

| #   | 风险                                                        | 影响                       | 对策                                                        |
| --- | ----------------------------------------------------------- | -------------------------- | ----------------------------------------------------------- |
| R1  | 去掉 INTERNET 权限后 App 无法运行                           | “系统级断网”这个卖点不成立 | A0-02 先验证；按第 4 节退路处理并如实描述                   |
| R2  | 各手机的 WebView 版本差异（如 CSS Highlight API、分页排版） | 部分机型排版或高亮异常     | 记录最低 WebView 版本；高亮已有降级方案；真机矩阵覆盖旧机型 |
| R3  | 签名密钥丢失                                                | 无法再给用户推送更新       | 两份离线备份；写入 DEPLOYMENT.md 的检查项                   |
| R4  | 大备份文件经过 JS 与原生的桥接时内存过高                    | 保存时闪退                 | A1-02 分块写入，用 30MB 以上的备份测试                      |
| R5  | 两个版本数据不互通，用户困惑                                | 体验问题                   | 引导页和 README 明确说明，并提供迁移步骤                    |
| R6  | App 引入的改动影响网页版                                    | 线上回归                   | 平台层隔离；网页版构建产物前后 SHA 对比；网页版全量 E2E     |
| R7  | 测试面变大，自动化覆盖不到 WebView                          | 真机问题漏测               | 真机回归是每个阶段的硬性退出条件，并记录机型和 WebView 版本 |

---

## 9. 需要你决定 / 验证记录

**需要你决定**：

1. 应用 ID（包名），一旦发布就不能改。当前临时值：`dev.jingye.reader`。
2. 是否把「不申请联网权限」作为硬性目标（实测见下）。
3. App 版是否收费：建议首发免费，与网页版保持一致；以后有商店版时再考虑付费差异。
4. 文楷字体在 App 中是否默认启用（安装包本来就带着它，不再需要“下载”）。

**验证记录**（A0-02，2026-10-10 实测）：

机型：荣耀 PTP-AN10，Android 16，WebView = Chrome/138.0.7204.179。测试包：debug 版，**不含 INTERNET 权限**（`aapt2 dump permissions` 确认清单内无 INTERNET）。

| 项目                               | 结果 | 说明                                                                                    |
| ---------------------------------- | ---- | --------------------------------------------------------------------------------------- |
| 无 INTERNET 权限加载本地资源       | ✅   | 完整渲染、JS/Worker/IndexedDB 正常，`fetch('https://example.com')` 失败＝系统级断网成立 |
| Service Worker                     | ✅   | 意外之喜：`sw.js` 在 `https://localhost` 下正常注册、控制页面并完成了约 6MB 预缓存      |
| IndexedDB / Cache Storage          | ✅   | `jingye` 库和字体缓存、SW 预缓存均落盘                                                  |
| `navigator.share`                  | ❌   | API 不存在 → 需原生分享                                                                 |
| blob `<a download>` 下载           | ❌   | 点击静默丢弃，Download 目录无文件 → 需原生保存                                          |
| `clipboard.writeText` / `readText` | ⚠️   | 写入成功；读取在无手势时被拒（`NotAllowedError`），真实点击大概率可用，手动验证         |
| `requestFullscreen`                | ⚠️   | API 成功但状态栏仍在 → 需原生沉浸模式                                                   |
| Screen Wake Lock                   | ✅   | `wakeLock.request('screen')` 成功                                                       |
| `launchQueue` / share_target       | ❌   | 不可用 → A2-01 原生 Intent                                                              |
| 系统返回键                         | ⚠️   | 不弹 history、直接退 App → A1-03 必须用 `backButton` 事件接管                           |
| `storage.persisted()`              | ⚠️   | 返回 false；App 私有目录不受影响，只影响设置页按钮的显示策略                            |
| `<input type=file>` 文件选择器     | ⏳   | Capacitor 已实现 `onShowFileChooser`，待手动验证                                        |
| 保存文件到用户可见位置             | ⏳   | 方案：Filesystem 写公共 Documents 或 SAF 选择器，A1-02 实做                             |

插件清单（待装）：`@capacitor/app`（返回键）、`@capacitor/share`（分享）、`@capacitor/filesystem`（保存文件）、`@capacitor/status-bar`（状态栏配色）；沉浸模式、常亮兜底、音量键、Intent 导入用项目内本地插件实现。

环境：Android Studio `D:\新建文件夹3`；JDK 21 `D:\Android\jdk\jdk-21.0.12.1+1`（JBR 自带 Java 25 不被 Gradle 8.14 支持）；SDK `D:\Android\Sdk`；Gradle 需走 `~/.gradle/gradle.properties` 代理 + `init.d/mirrors.gradle` 阿里云镜像；项目路径含非 ASCII 字符需 `android.overridePathCheck=true`（已在 `android/gradle.properties`）。

**A1 实测记录**（2026-10-10，同机型，debug 包经 `adb install -r` + Chrome DevTools 远程调试实测）：

| 项目                | 结果 | 说明                                                                                                                                                                            |
| ------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 平台识别            | ✅   | `Capacitor.isNativePlatform()` 为 true；native 模块仅在原生构建加载                                                                                                             |
| Service Worker 清理 | ✅   | 旧包遗留的 SW 注册与 precache 已在新版启动时清除（`cleanupServiceWorkers`）；注意旧 SW 会拦截并服务旧资源，升级到本版需 `pm clear` 或等新版代码执行一次                         |
| 文件导入            | ✅   | 书架「导入书籍」→ 隐藏 `input[type=file]` 注入 EPUB/TXT/MD 三本全部解析上架（系统文件选择器本体待手动点验）                                                                     |
| 原生保存（SAF）     | ✅   | 「生成完整备份 → 下载备份」弹出 DocumentsUI 选择器，选「下载」目录后 `静页备份_2026-10-10.zip` 落盘 `/sdcard/Download/`（8732 B），writeUri 分块写入正常                        |
| 原生分享            | ✅   | `shareChunk`+`shareCacheFile` 写 cache 并弹出系统 ChooserActivityLauncher                                                                                                       |
| 返回键              | ✅   | 弹层 `<dialog>` → cancel 关闭；`useBackClose` 浮层 → history 回退；阅读页 → 书架；书架再按 → 退出（`canGoBack` 兜底）                                                           |
| 外链                | ✅   | `target=_blank` 在 WebView 中无 `onCreateWindow`，已改原生 `openUrl`（ACTION_VIEW）——GitHub 链接打开荣耀浏览器；站内 `licenses.txt` 转当前页导航，返回键经 `canGoBack` 回到应用 |
| 状态栏              | ✅   | targetSdk 35+ 下 `Window.setStatusBarColor` 失效，改给 DecorView 上色：米白/墨黑两主题底色与图标明暗均正确（截图 `.review/bar-*.png`）                                          |
| 沉浸模式            | ✅   | `WindowInsetsControllerCompat.hide(systemBars)` 截图确认状态栏与手势条隐藏、可退出（`.review/imm-*.png`）                                                                       |
| 常亮                | ✅   | `FLAG_KEEP_SCREEN_ON` 桥方法调用成功（实际不息屏表现待目视确认）                                                                                                                |

实现调整：`@capacitor/status-bar` 已移除（被自有 `JyNative.statusBar` 取代）。发布复核中同时移除了未被调用的 `@capacitor/filesystem` 和 `@capacitor/share`；官方插件只保留 `@capacitor/app`，文件能力使用本地 `JyNative` 桥。

待手动/未覆盖项：SAF 选目录的完整人工体验、分享面板实际发出、恢复备份的完整链路、剪贴板读取手势、状态栏在浅灰/护眼绿下的复核、文楷字体在 App 中的加载路径。

**A2 实测记录**（2026-10-10，同机型）：

| 项目             | 结果 | 说明                                                                                                                                                                                               |
| ---------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 「打开方式」VIEW | ✅   | intent-filter 注册成功（MIME 过滤 + content/file 扩展名兜底两组）；`am start` file:// VIEW 实测进入 `#/incoming/` 流程，无存储权限的 file:// 读取失败被如实记入待处理分享（符合 SHARE-MIXED 语义） |
| 分享到（SEND）   | ✅   | `pm query-activities` 确认 text/plain、epub+zip 均解析到 MainActivity；SEND_MULTIPLE 与 EXTRA_TEXT 已支持，经真实微信/QQ 分享的链路待手动验证                                                      |
| 音量键翻页       | ✅   | 「排版 → 音量键翻页 → 开」后阅读页实测：音量减下一页（2→3）、音量加上一页（3→2）；菜单打开时音量键恢复调音量不翻页；离开阅读页取消接管；长按重复事件被消费不连翻                                   |
| 启动画面         | ✅   | Android 12+ SplashScreen API：纸色 #F5F0E6 背景 + 书形矢量图标，冷启动无白屏闪烁（截图 `.review/sp1.png`）                                                                                         |
| 图标             | ✅   | 自适应图标（纸色底 + 书形矢量前景）+ API24/25 位图兜底（方形圆角 + 圆形，PIL 生成）；启动画面图标复用同一书形                                                                                      |

设置项：`ReadingSettings.volumeKeys`（默认关，随备份导出）；`importText` 按扩展名分发解析器，故「打开方式」文件名缺扩展名时按 MIME 补后缀。

**A3 实测记录**（2026-10-10，同机型，release 包）：

| 项目         | 结果 | 说明                                                                                                                                        |
| ------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 签名配置     | ✅   | `android/keystore.properties`（已 gitignore）从仓库外 `D:\Android\keystore\jingye-release.keystore` 读签名；keystore 不在 `git status` 中   |
| release 构建 | ✅   | `assembleRelease` 产出 `app-release.apk`（约 6.5MB）；包名 `dev.jingye.reader`，versionCode 2 / versionName 1.0.0，minSdk 24 / targetSdk 36 |
| 签名验证     | ✅   | `apksigner verify` 通过，SHA-256 `c666e187…e22949`；APK SHA-256 `397721f5…c4b6b0`                                                           |
| 权限清单     | ✅   | `aapt dump permissions` 仅见动态接收器权限，**无 INTERNET**                                                                                 |
| 覆盖安装     | ✅   | code 1（内部构建）→ code 2 同签名 `install -r` 成功，无签名冲突                                                                             |
| 升级数据保留 | ✅   | v1 中切「墨黑夜读」主题写入设置 → 升级 v2 后启动仍是夜间主题且直入书架，IndexedDB 保留                                                      |
| 发行版重载   | ✅   | 最终发布产物（code 2 / 1.0.0）重装后正常启动、数据仍在，即手机上运行的就是发布文件                                                          |
| 安全提示     | ⚠️   | 荣耀侧载安装弹「安全确认」，勾选「已了解」后正常安装——属预期，README 需说明侧载步骤                                                         |
| CDP 调试     | —    | release 构建不可调试（`webview_devtools_remote` 无响应），真机验证改用 `input tap` + 截图驱动；后续回归如需 DevTools 须用 debug 包          |

历史产物：`release/jingye-reader-1.0.0.apk`（code 2，已 gitignore）。用户已授权同时上传源码与 APK；发布复核会将 code 升至 3 并重建同签名 1.0.0。GitHub 网页已登录，可直接发布，无须额外配置 gh。**签名密钥需用户自行离线备份两份**。当前复核和下载说明见 [ANDROID_RELEASE.md](./ANDROID_RELEASE.md)。
