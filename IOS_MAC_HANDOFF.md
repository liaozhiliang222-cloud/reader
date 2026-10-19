# iOS R0–R2：Mac 构建与验收交接

本次交付为“微光阅读 / LumiRead”R2 中英文源码测试候选。以 Devin 的 `b28ec9c` 改名版本为基线；此前 Mac 构建和 6 XCTest 的通过记录不代表本轮新增 Swift 与资源已编译。本轮 Windows 检查、Mac 原生验收分别见 DEVELOPMENT_STATUS.md。没有发布 IPA，没有合并 main，没有部署网页。

## 1. 拉取与准备

```bash
git clone --branch codex/ios-r0-r2 https://github.com/liaozhiliang222-cloud/reader.git
cd reader
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm check:i18n
pnpm build:ios
pnpm check:ios
pnpm test:ios
open ios/App/App.xcodeproj
```

使用满足 package.json 要求的 Node（建议 24）和 pnpm 11.21.0。先在 Xcode Settings 安装 iOS Simulator runtime，并确认 `xcode-select -p` 指向完整 Xcode。`pnpm test:ios` 自动选择可用 iPhone 模拟器，执行 App Scheme 的 XCTest，结果写入忽略目录 `artifacts/*.xcresult`。依赖下载只发生在开发准备时。

保留应用身份 `dev.weiguang.reader`（原 `dev.jingye.reader`，已按用户注册的 App ID 变更）。源码候选版本 1.2.0，构建号 4；如果 App Store Connect 或设备已有该构建号或更高构建号，在两套 Build Settings 中递增。不要以卸载重装代替数据升级测试。

## 2. 本地 StoreKit 测试

App Store Connect 尚未创建商品。用户确认暂用 `dev.jingye.reader.pro`，非消耗型一次性购买。

在 Xcode 的 **Product → Scheme → Edit Scheme → Run → Options → StoreKit Configuration** 选择 `ios/App/JingyePro.storekit`。配置文件的 `1.00` 是本地模拟价格，不是定价决定，不会打真实款，也不会随应用资源发布。默认 App Scheme 不启用模拟购买；发布 Archive 必须保持 StoreKit Configuration 为 None。

从设置打开“购买与恢复购买”，主动查看价格，再测试购买、取消、Ask to Buy 等待批准、批准、恢复购买、退款/撤销、断网重开和系统账号变化。用 Xcode 的 StoreKit Transaction Manager 控制本地交易。只有原生 StoreKit 验证的非消耗型交易可以授予权益，JS/localStorage 开关不能解锁。

正式沙盒/TestFlight 前，在 App Store Connect 配置同一商品 ID、类型、本地化名称/说明、价格和审核资料。购买页显示 `Product.displayPrice`，没有写死价格；家庭共享目前关闭。相关实现依据 [Apple currentEntitlements](https://developer.apple.com/documentation/storekit/transaction/currententitlements) 与 [Apple StoreKit](https://developer.apple.com/storekit/)。

本地 `.storekit` 已添加 `en_US` 与 `zh_CN` 商品信息，价格仍仅为模拟数据。Release 继续排除该测试文件及 `JY_SK_TEST` 解锁路径。App 内语言不决定商店币种。

### 中英文新增验收

1. 更新后保留既有中文书籍、听书声音、进度和划线。在“设置 → 界面语言”选择 English，重开后仍为英文；切回简体中文后原文和位置不变。无选择记录时跟随系统，日语/法语等未支持语言回退英文。
2. 分别用英文与中文 iOS 应用语言启动，检查桌面名称、文件导入、分享取消、StoreKit 商品不可用和购买错误。桌面名称由 iOS 的应用语言决定；应用内的语言开关不修改系统语言。
3. 选择英文声音，在断网下起播、锁屏跨章、控制中心暂停继续、耳机断开和来电打断；保留已保存声音，不因切换界面语言擅自更换它。检查英文缩写、小数、长单词与原文定位。
4. 检查 320px 视口与 iPad：引导、书架、设置、听书面板、购买、笔记、备份确认均无横向溢出；中英文动态字号另验。
5. 英文界面导出单条与批量 Markdown、读后整理模板和多页 PNG：用户原文和想法不翻译，说明和落款为英文，两个批量模板文件名不同，中文标签可用逗号输入；本机回原文链接继续有效。
6. 英文界面使用实际 Apple 沙盒测试购买、取消、等待批准、恢复、撤销与离线权益。浏览器原生桥替身及本地 StoreKit 不作为服务器沙盒通过证据。

语言目录、界面和导出离线打包；本机界面偏好不随备份迁移。旧 Markdown 解析结果及规范正文中的自动占位文字保留原样，切换语言不会重解析已有书籍。

`ProStoreTests.swift` 新增 2 项 XCTest，检查系统语言回退与实际 App 包内两种显示名资源。连同原有 6 项，Mac 应运行 8 项；新增两项尚未在 Windows 执行。

### App Store Connect 可填写的中英文文案

以下为本轮源码对应的首发草稿，名称可用性、正式截图、价格和公开隐私/支持页面仍由账户持有人确认并配置。

| 字段         | 简体中文                       | English (U.S.)                   |
| ------------ | ------------------------------ | -------------------------------- |
| App 名称     | 微光阅读                       | LumiRead                         |
| 副标题       | 本地阅读，让注意力回到书页     | Quiet reading, local books       |
| Pro 显示名称 | 微光阅读 Pro                   | LumiRead Pro                     |
| Pro 说明     | 一次解锁离线听书与笔记整理工具 | Offline listening and note tools |

英文介绍草稿：

> Make time for reading. LumiRead is a quiet local reader for your own EPUB, TXT, and Markdown files. Import from Files, choose a paper-like theme, and return to the page.
>
> Read, bookmark, highlight, and write notes without an app account. Export Markdown notes and save backups of your library. Your books, reading progress, and notes stay on your device; there is no feed, advertising, AI, or reading analytics.
>
> An optional one-time Pro purchase unlocks local listening with installed system voices, cross-book note organization and review, batch exports, and quote images. Core reading, existing notes, basic exports, and backups remain available without Pro.
>
> Download the voices you need in iOS Settings and test them offline before listening. Purchases and restoration use Apple's services and require an internet connection. Save backups outside the app before uninstalling.

App ID 和商品 ID 为 `dev.weiguang.reader` / `dev.jingye.reader.pro`（Bundle ID 已变更，商品 ID 不变），两种语言共用同一商品。不要把测试价格或浏览器测试截图当作正式定价和商店截图。App 内 About 页面已提供英文隐私说明；公开隐私政策 URL 和支持 URL 需配置可访问的对应页面。

## 3. 必须补的原生验证

| 任务         | Mac / 设备操作                                                            | 通过条件                                                         |
| ------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| IOS-R0-01/03 | 干净安装依赖、build:ios、Xcode 构建与 XCTest                              | Swift 编译和原生测试真实通过，保存 SHA 与 xcresult               |
| IOS-R0-02    | 旧版安装写入原创 TXT/Markdown、进度、划线，覆盖安装本版                   | 原件字节、位置、设置、标注保留；备份 v1–v4 可恢复                |
| IOS-R1-01    | Files 本地/已下载提供者文件；中文名；多选；取消；失败重选；冷/热启动      | 原件 SHA 一致，失败不覆盖已有进度；未下载文件有明确处理          |
| IOS-R1-02    | 混合 ZIP，选中部分 TXT/EPUB/MD，含坏文件、重复与路径穿越                  | 支持项逐本导入；失败不影响成功项；不递归解包                     |
| IOS-R1-03    | 大队列 XCTest，再在 iPhone 已安装声音下断网起播、锁屏跨批/章              | 原生完整队列连续消费，不依赖 JS 补货；实际声音与进度一致         |
| IOS-R1-04/05 | 句中暂停/继续、控制中心、耳机、来电/Siri、断耳机、15 分钟与章末定时、重开 | 不双播、不突然外放/自动出声；最长重读当前句；章末不记为全书 100% |
| IOS-R2-01/02 | 多书划线、标签/时间/待回顾、回原文、批量 Markdown/整理模板                | 摘录与想法完整；链接仅回本机；旧笔记仍可免费导出                 |
| IOS-R2-03    | 长摘录 PNG 多页、四主题、系统保存/分享、iPad 弹窗                         | 无截字；真实落盘/分享；用户取消后可继续操作                      |
| IOS-R2-04/05 | 上述 StoreKit 本地状态、实际沙盒、退款、离线权益                          | 验证权益才能新增 Pro 服务；原书/已建笔记/备份与单条取回不被锁    |

至少实际 iPhone 验证离线声音、锁屏及硬件中断；模拟器和浏览器替身不替代这些证据。补最低支持系统与 iPad 布局/分屏。若文件提供者尚未下载，原生请求下载并通过文件协调获取副本；提供者不能交付时提示重新选择，必须实际验证相应提供者行为。

原生 XCTest 覆盖跨批跨章读取、幂等重传、异内容拒绝、未完成队列拒绝、路径/句子边界，以及序列化大于 64 MiB、压缩落盘仍在配额内的原创大队列。使用 Foundation LZFSE、CryptoKit 和 Compression，无第三方运行依赖。

## 4. 数据与范围

数据库 v4 增加本机身份表及书籍原文件指纹字段；身份表不随备份迁移。旧文本 Locator 的 UTF-16 语义不变，文本/PDF 模式类型与安全读取接口已定义；本轮没有新增 PDF 阅读、云同步或改写旧定位。

备份 v5 保留新标签、回顾标记和删书后的摘录副本，继续读取 v1–v4。旧应用不能读取 v5，升级前后保留原备份。删除书籍默认仍删除标注，勾选“保留划线和想法副本”才留下摘录，副本不能回跳；重新导入原书不会擅自重新挂接已标记的副本。

应用书籍/正文/笔记仍只在本机。唯一新增联网边界是 Apple 购买/恢复/系统交易更新；iCloud、WebDAV、OPDS、局域网服务及 R3–R6 没有接入。Pro 仅门控 iOS 的新增服务；Android 既有听书不受 iOS 购买状态影响。

源码包含 **iOS native validation** 手动工作流；工作流进入仓库默认分支后，可在 GitHub Actions 选择待测分支执行。当前先在 Mac 本地运行上述命令，该工作流不签名、不发布。Windows 的 `pnpm build:ios` 仅生成网页资源和同步 Xcode 项目；必须等 Xcode/XCTest、实际设备与 StoreKit 沙盒检查完成后，才将对应任务标为验收通过。
