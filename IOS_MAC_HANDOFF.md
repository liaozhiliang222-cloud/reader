# iOS R0–R2：Mac 构建与验收交接

本次交付为 R2 源码测试候选。Windows 检查不证明 Swift 编译、签名、实际购买或真机听书通过；最终结果见 DEVELOPMENT_STATUS.md。没有发布 IPA，没有合并 main，没有部署网页。

## 1. 拉取与准备

```bash
git clone --branch codex/ios-r0-r2 https://github.com/liaozhiliang222-cloud/reader.git
cd reader
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build:ios
pnpm check:ios
pnpm test:ios
open ios/App/App.xcodeproj
```

使用满足 package.json 要求的 Node（建议 24）和 pnpm 11.21.0。先在 Xcode Settings 安装 iOS Simulator runtime，并确认 `xcode-select -p` 指向完整 Xcode。`pnpm test:ios` 自动选择可用 iPhone 模拟器，执行 App Scheme 的 XCTest，结果写入忽略目录 `artifacts/*.xcresult`。依赖下载只发生在开发准备时。

保留应用身份 `dev.jingye.reader`。源码候选版本 1.2.0，构建号 2；如果设备已有更高构建号，在两套 Build Settings 中递增。不要以卸载重装代替数据升级测试。

## 2. 本地 StoreKit 测试

App Store Connect 尚未创建商品。用户确认暂用 `dev.jingye.reader.pro`，非消耗型一次性购买。

在 Xcode 的 **Product → Scheme → Edit Scheme → Run → Options → StoreKit Configuration** 选择 `ios/App/JingyePro.storekit`。配置文件的 `1.00` 是本地模拟价格，不是定价决定，不会打真实款，也不会随应用资源发布。默认 App Scheme 不启用模拟购买；发布 Archive 必须保持 StoreKit Configuration 为 None。

从设置打开“购买与恢复购买”，主动查看价格，再测试购买、取消、Ask to Buy 等待批准、批准、恢复购买、退款/撤销、断网重开和系统账号变化。用 Xcode 的 StoreKit Transaction Manager 控制本地交易。只有原生 StoreKit 验证的非消耗型交易可以授予权益，JS/localStorage 开关不能解锁。

正式沙盒/TestFlight 前，在 App Store Connect 配置同一商品 ID、类型、本地化名称/说明、价格和审核资料。购买页显示 `Product.displayPrice`，没有写死价格；家庭共享目前关闭。相关实现依据 [Apple currentEntitlements](https://developer.apple.com/documentation/storekit/transaction/currententitlements) 与 [Apple StoreKit](https://developer.apple.com/storekit/)。

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
