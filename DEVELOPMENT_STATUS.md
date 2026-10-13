# 开发进度

更新日期：2026-10-13。

## 大书听书准备上限修复（2026-10-13，已完成本地修复与检查）

- 用户截图提示“听书准备内容过大，请从较后的章节开始”。用 66 万字原创短句样本复现旧代码失败：将每句重复定位信息等累计传输 JSON 字节当作 64 MiB 磁盘预算，较小正文也会被拒绝。
- 修复为原生按批 GZIP 私有落盘，按实际文件与清单占用限制 64 MiB；桥消息仍不超过 128 KiB/256 句、最多 10000 批次，SHA 校验后有界解压且只缓存一批。传输协议、原文、定位与完整剩余章节不改变，锁屏仍不靠 JS 补货；旧未压缩格式可读，无新增运行依赖。
- 旧代码的回归先失败，修复后通过；原生原创 204800 句累计 JSON 78438002 字节，实际批次缓存 2963092 字节，跨批/章定位、重开与清理通过。新增旧格式读取/重复 ACK 与解压超限回归通过，产品 JVM 共 24 项；准备逻辑专项 7 项通过。
- 完整 lint、95 文件 / 435 单测、strict 网页/Android 构建、产品 JVM 24 项、Gradle lintRelease/assembleRelease/assembleReleaseAndroidTest，以及双浏览器听书专项 4 项全部通过。实际问题的纯逻辑回归先失败、修复后通过，不重新做用户已放宽的长时锁屏测试。
- 修复包 `release/jingye-reader-1.1.1-preview.apk`，code6 / 1.1.1-preview，6475886 字节，SHA `b97860f2304da586ee2784fb87f165408c27e0ac0922ea20f9cfc93e93b62020`；原证书 `c666e187…22949`，Manifest/全部 DEX/网页资源隔离与无 INTERNET 检查通过。用户重新连接后，16:25 已同签名覆盖安装；firstInstallTime 保持 2026-10-10 18:22:42，安装的 base.apk SHA 与本地修复包相同，原书架与当前续读点保留。
- 已在用户此前出错的阅读位置实际复核：剩余章节准备成功，正式服务与媒体 session 进入 PLAYING，原上限提示消失，句子完成后页面继续跟随。短时复核后通过 App 暂停，UI 与媒体状态均为 PAUSED，保留会话供用户点“继续听书”；本轮不重跑长时锁屏或将状态回调冒充听觉确认。仅本地忽略目录保存设备证据，未上传用户书名/正文。
- 本次补丁继续更新现有 PR #4（`codex/android-tts`），没有合并 main、部署网页或公开发布 APK。代码提交 `04a9f57` 的 push/PR 两轮 checks/android CI 全部通过（38364945783 / 38364949946），deploy 均 skipped。构建 J: 临时映射已撤销。

## GitHub 安卓听书源码更新（2026-10-13）

- 用户明确授权上传本次安卓代码。提交分支 `codex/android-tts`，以远端 main `f01086b` 为合并目标；已整合该基线的 iOS 工程，没有改写远端历史。听书入口、设备设置、通知打开与协调器仅在 Android 启用，防止把安卓后端暴露给 iOS。
- 本轮整合检查通过：pnpm lint、95 文件 / 434 单测、strict 网页与 Android 构建、Chromium/WebKit 听书专项 4 项；新增三平台门控回归。此前 Java 21 项和真机 6 项的原生实现没有改动，证明范围仍按下方记录。
- 使用经 GitHub 认证核对的现有账号身份作命令级提交，没有配置或伪造全局作者。本次仅上传源码并创建 PR，未发布 APK、合并 main 或部署网页；前述实机 APK 是平台整合前的验收产物。独立 iOS 听书计划仍留在本地，私钥、安装包、测试书籍和原始设备日志不提交。

## 当前 Goal：安卓听书开发至验收通过（2026-10-13，已完成）

- 安卓 P0（TTS-01–17）已实现并完成用户认可范围的内部验收；主模型单代理执行。用户明确“刚才测试过了就行”，不再重计连续 60 分钟或因没有耳机/第二台电话阻断；未将这些严格场景冒充通过。T2/网页/iOS 与公开发布是后续范围。
- 最终正式服务使用已安装离线 TTS 合成私有短句音频，再由 App 的 MediaPlayer 播放；解决直接 TTS 出声导致媒体键归属引擎的问题。原生队列不依赖后台 JS 补货，媒体 session/FGS/焦点/唤醒锁/章末与分钟定时、取消与错误清理已接。锁屏隐藏书名/章名；无新运行依赖和 INTERNET 权限。
- 431 项 Vitest（94 文件）、21 项产品 JVM、6 项实际 Android instrumentation、4 项 Chromium/WebKit UI 测试通过；lint、strict 网页/Android 构建、Gradle lintRelease/assembleRelease 通过。浏览器仅把原生后端作为无音频测试替身，真实组件/Worker/IDB/分批照常运行，不进入 release。
- 荣耀 PTP-AN10 / Android 16，荣耀离线引擎 11.0.34.2。正式服务在 `Active default network: none` 时实际合成/MediaPlayer 播放、章末停止、临时正文/音频清理和冷恢复不自动播放通过（`android-offline-instrumentation.txt`）；探针真实中文声音由用户两次确认。
- 正式 ReaderView→桥→服务播放、系统媒体暂停、手动翻页暂停、同句继续回跳、自然读完 100% 停止实机通过。修复跟随缓存未重置导致同句续听不立即回跳；最终证据 `follow-before.xml` 8/10·79.4% → `follow-detached.xml` 7/10·62.5% → `follow-resumed.xml` 8/10·79.4%。修复服务已消失时残留进度许可、末句跳过状态与恢复终态原因。
- 原签名 code4→5 覆盖升级，原有四本书和进度保留，未卸载主 App 或清数据。最终 `release/jingye-reader-1.1.0-preview.apk`：6475630 字节，SHA `81fe3f5530ef732ae2befa239aea897ff0a6cab500e323706e6876ada2a1022b`，证书 `c666e187…22949`；已安装 base.apk 哈希一致。Manifest/全部 DEX/网页资源无探针、测试替身与 INTERNET，相比 1.0.1 APK 增加 81443 字节。
- 最终规定检查再次通过：pnpm lint、431 项 test、strict build、build:android；Gradle 产品 JVM/lintRelease/assembleRelease 通过，最终 APK 哈希和证书不变。停止听书后实际返回书架通过；仅删除本次原创验收文稿，原四本书保留。手机探针/测试包已卸载、ADB 无转发、网络恢复飞行模式关/Wi-Fi 开/移动数据开；构建 J: 临时映射在交付时撤销。
- 详细证据在忽略的 `artifacts/tts-probe/`，UI 原始结果在 `artifacts/speech-ui-results.json`；本地原创验收文稿与用户原书均未上传。分支 `codex/android-tts`；Git 作者未配置，未伪造身份提交，未推送或发布。Goal 按用户认可的内部验收范围完成；后续需要时进入 T2 或扩大机型验证。

### 本次开发历史检查点（以下不是最终状态）

- 最新实现检查点（13:22）：T1 正式服务/桥/协调器/入口已接入。`SpeechRuntime` 串行准备私有队列与持久续读，`SpeechService` 离线合成单句 WAV 后用 MediaPlayer 出声、框架 MediaSession/静默通知/焦点/耳机路由/原生定时/唤醒锁。没有新增依赖、INTERNET 或通知运行时权限。原生短句缓存 16MiB 上限，停止与失败清理。媒体键路线尚待正式 App 实机验证。
- 阅读页「更多 → 听书」提供离线引擎/语音选择与隐私说明；播放条上一/下一句、暂停/继续、0.75–2.0×、定时、关闭；动态预留高度、当前句高亮与跟随。手动导航前暂停并移交进度权，退出阅读页/回书架停止。设备语音偏好只在原生，备份仅含语速/定时。备份/恢复/改编码/清空/删除已接停止或清理。
- 数据库 v3 新增仅本机 `speech` 进度许可表，事务检查内容版本、leaseId、序号、原进度基线，ACK 在事务后；删除重导/恢复/重解析撤销许可，原页首写入受保护。5 项真实 IndexedDB 事务回归通过，已有迁移与阅读回归保留。通知冷/热打开对应书的桥已接，实际行为待验。
- 当前完整检查：pnpm lint、93 文件 / 427 单测、pnpm build、pnpm build:android、Java 20 项、Gradle lintRelease / assembleRelease 全部通过；构建仅有已有大分块提示。已修测试夹具重开 DB、原生通知接口测试替身和 strict Range/设置类型。预览 `release/jingye-reader-1.1.0-preview.apk`，6474202 字节、code5 / 1.1.0-preview、SHA `ac9088ccd06ebd174f66d77cb26a3e7fdc4d65bfa355791002b6e914da182eb7`，正式证书 `c666e187…22949`；Manifest/全部 DEX/网页资源无探针与 INTERNET。
- 下一具体动作：同签名覆盖安装正式预览包（尚未安装），用原创测试文稿完成实际 ReaderView→桥→服务→播放/暂停/续听/手动翻页/回书架流程，检查媒体键路由和位置保存；发现问题修复，再补必要的 UI/协调器验证并交付。不要重新启动 60 分钟硬性计时；用户已明确放宽。Goal 仍 active；未声称正式功能实机验收通过，未提交/推送/发布。J: 临时映射仍用于构建，最终收尾撤销。

- 最新用户调整（13:02）：明确“不要那么严谨，刚才测试过了就行”。接受本次离线真实出声、后台跨批次/跨章及暂停记录作为 T0 内部开发依据，取消反复重计 60 分钟和缺耳机/电话的阻断条件，继续 T1；不把未完成的连续 60 分钟写成通过。手机网络已恢复测试前设置，探针已停止，监测进程已结束。Goal 继续 active，正式听书功能仍须实现并验证。
- 全量 lint、92 文件 / 422 单测、strict build 已通过；新增纯进度仲裁 8 项。探针/正式 JVM 10 / 20 项通过。正式 APK 的 Manifest、全部 DEX、网页资源无探针/INTERNET，报告绑定 SHA 3bf971097dec09ccd3aa0f8b8bab922df000e637efb3f592a2644ad5bbd223eb（非最终听书包）。WebView→Java 10 万字实际 1194ms / 3082915 字节，队列清理成功；200 万字尚未手机实测。分支 `codex/android-tts`，保留原有修改，未提交/推送。
- 查明直接 TTS 出声归属荣耀引擎 UID，媒体键 session 为 null；增加独立探针短句 synthesizeToFile→MediaPlayer 路径待试，正式实现须解决控制路由。原生短句音频只在私有目录，单句上限 16MiB，停止/取消清理，无新增依赖。

- 用户要求按照开发计划开发安卓听书，并明确创建 Goal；Goal 已 active，当前主模型单代理执行，未切换模型/未委派。保留原有 TTS/iOS 计划未提交修改。
- 从 TTS-01 开始，新增物理隔离模块 `android/tts-probe`，包名 `dev.jingye.ttsprobe`，只在 `-PttsProbe` 时包含且禁用 release variant。正式 `:app` 不依赖探针。实现原创文本私有分批队列、框架 TTS/媒体会话/前台服务、暂停与回调代次、音频焦点/路由监听及原生定时；仍没有正式听书入口。
- 已连接荣耀 PTP-AN10 / Android 16。荣耀引擎 `com.hihonor.voiceengine` 11.0.34.2 有标记为离线、无缺数据标记的 zh/en 语音；Google 472 个语音全部不可选（联网或 notInstalled）。两引擎均拥有 INTERNET；探针不申请 INTERNET。清单在 `artifacts/tts-probe/voices-*.json`。
- 用户明确允许暂时断网和锁屏 60 分钟，并确认中文声音正常。测试前状态：飞行模式关、Wi-Fi 开、移动数据开、蓝牙关；USB 充电、电量 90%。当前飞行模式开、Wi-Fi 关，系统 Active default network: none。测试后须恢复原网络状态，不更改其他用户设置。
- 10 万字原生原创队列：1370 句、350321 字节、25ms；仅原生生成，不是 TS→桥全链路或峰值内存。用户确认多次手动查看手机，此前区间不计连续锁屏。再次熄屏后首个检查点 wallMs `1791866208880`、elapsedMs `8800899`（北京时间 12:36:48），session `13d613f3-5dd5-4f2a-a12a-5b02241b4ac3`、generation 7、句 101；需至少到 13:36:48 且日志无中断才计 60 分钟。`scripts/tts-probe-monitor.ps1` 每 30 秒只读保存屏幕/网络/原生状态。真实耳机/电话、媒体键路由、15 分钟定时、200 万字性能等仍待验。
- JVM 10 项通过，探针 lintDebug/assembleDebug 通过。中文路径最初造成 Java ClassNotFoundException，临时 `subst J: D:\电子书阅读器` 后成功；J: 映射仍在使用，收尾须撤销。Lint 仅对有效 MediaSession 通知加局部 NotificationPermission 豁免注释（官方规则），没有新增通知运行时权限。日志 `artifacts/tts-probe/jvm-lint-build.log`。
- 下一步：长时测试期间完成可独立验证的分句/过滤/协议纯逻辑；持续核对原生检查点，随后完成 T0 其他项目与 Go/No-Go。未通过 T0 前不将产品听书标为完成，最终还需正式 APK TTS-17 验收。不得把探针测试替代产品验收。
- 已补 TS 分句、UTF-16 多区间映射、MD 过滤、EPUB 原件语义掩码（不改变既有版本化段落）、逐章有界批次生成；新增 26 项纯逻辑测试通过。原生产品侧仅有未接入的协议、队列和状态机纯类，`:app:testDebugUnitTest` 20 项通过（原有 6 + 队列 7 + 状态 7）。尚未接入正式桥、服务、UI、进度仲裁；T0 通过后再接入。最近 pnpm lint 通过，全量 test/build 待本轮最终运行。

本次任务（2026-10-13，iOS 听书开发计划，仅文档）：新增 `IOS_TTS_PLAN.md` v1，基于同仓库远端 main 的 iOS 工程（f01086b）和后续 iOS 适配分支（ce05539），结合用户提供 IPA 的只读核查结果编写。现有平台分流、文件导入/分享和状态栏适配按已有实现复用；不从旧本地 Android-only 基线误判为尚无 iOS 应用。原生 iOS 听书与 Safari/PWA 前台降级明确分开，并在安卓计划补交叉引用。

计划内容：11 项任务，依次整合现有基线、真机探针、共享协议、文本抽取、Swift 私有队列/合成器/音频会话/媒体控制、进度协调、UI 与验收。首版使用系统离线语音，支持锁屏续听、来电/耳机中断、原生定时和句级续读；正文和缓存只在本机。IPA 与源码 Bundle ID 不同、具体提交无法由包确定，列为升级核验项；不直接修改应用身份。最低 iOS 15、飞行模式、锁屏跨章 60 分钟、文件保护和覆盖升级均有待执行验收标准。

本轮边界：只读取/更新远端引用并编写文档，未合并 iOS 分支、修改运行代码、实现听书、构建/签署 IPA 或发布。保留已有安卓计划和进度的未提交修改。下一项为 IOS-TTS-01 对齐现有 iOS 基线。

本轮文档检查：`pnpm lint`、88 文件 / 388 单测、`pnpm build` 全部通过，构建仅有既有大分块提示；11 个任务编号及执行依赖已核对，`git diff --check` 通过。检查基于本地现有代码，不代表远端 iOS 分支已编译或真机听书通过。工作区仅新增 iOS 计划并修改两份关联文档，未提交或推送。

本次任务（2026-10-13，完善安卓听书计划，仅文档）：在已有未提交的 `TTS_PLAN.md` v2 与本文件记录上继续修订，保留安卓原生优先、网页后续和 TTS 任务编号；计划升级为 v3。此次不实现听书，不改 PRD 已交付范围，不生成/上传 APK。

主要完善：前台分块准备私有临时文本队列，原生锁屏独立读队列，不以有限缓冲时长冒充持续后台；补 TextToSpeech 的 stop/句首续播、离线语音/缺数据处理、target 36 前台服务与音频焦点、暂停释放唤醒锁、原生定时和回调代次。对照现有 ReaderView 500ms 页首保存、contentRevision 和备份快照，设计唯一进度写入权、数据库基线与 ACK，明确手动跳转/重解析/删除/恢复的冲突处理。Markdown 代码/公式等过滤提前至 P0；入口建议放「更多」，沿用 BookLoading，避免准备时错误页闪现；语速统一 0.75–2.0，补临时文件清理与备份设备设置隔离。

验收计划：保留 T0–T4、18 张任务卡，补准备性能预算、锁屏跨批次/跨章 60 分钟、真实音频/焦点、数据冲突、升级与设备矩阵；自动化、测试替身和真实出声分开记录。官方平台出处已写入计划，所有真机 TTS 结论均为待测，不沿用既有阅读器验收作为听书证据。下一项为 TTS-01 独立 debug 真机探针，再按 TTS-02 门槛决定是否进入产品开发；暂无需用户逐项确认常规 UI 偏好。

本轮检查：`pnpm lint`、88 文件 / 388 单测、`pnpm build`（严格类型与生产构建）全部通过；构建仍有既有大分块体积提示，本轮未改依赖或运行代码。18 个任务编号无重复、依赖顺序与 P0/P1 行为已复核，`git diff --check` 通过。仅 `TTS_PLAN.md` 和本文件有改动，保留原先 v2 的未提交内容与历史记录；未提交、推送、发布或进行真机听书验收。

本次任务完成（2026-10-10，Android 1.0.1 启动与导入修复）：最终运行代码 b35e4b2e9ef608d8f133c18fea6bb08564078147；[1.0.1 预览 Release](https://github.com/liaozhiliang222-cloud/reader/releases/tag/android-v1.0.1) 已于 20:47（UTC+8）公开，Release 408916430，draft=false / prerelease=true。发布前用精确 lease 将尚未公开的 android-v1.0.1 对齐该提交，注解对象 68059462e4647314d6150c8078ee9fe41f118890；旧按钮版草稿附件已替换，当前公开源码与最终 APK 对齐。本轮仅发布 Android，没有部署网页，也没有 Goal、子代理或模型切换。

修复：原生启动检查完成前不挂载旧分享页；原生重开清理错误/已消费分享路由，尚在本机的失败原文件保留。新分享可替换旧错误路由；热分享串行读取，加载层保留当前页面。BookLoading 翻页动效用于启动、开书、分享和导入面板，显示文件名、实际读取 MB 与批次，跟随四主题并复用减少动态效果规则，无新依赖。

本地验收：旧代码两项回归先失败，修复后启动/原生/分享专项 20/20、完整 88 文件 388 单测、lint、strict 网页/Android 构建、安全 104 惰性 URL/PWA 资源检查通过。Gradle testDebugUnitTest / lintRelease / assembleRelease 通过；本机 Java 6 项任务复用既有结果，远程新 CI 另运行 6 项。Chrome 390×844 四主题、读取/解析状态与无横向溢出已检查；本地正式组件预览截图为 visualizations/import-loading-night.png，不代替物理手机启动 UI。用户 EPUB 本轮再次本地验证：4433334 字节、9 分块、原件 SHA 保留、174 章节、1775226 字、errors=[]，进度达到实际文件大小；原文件未进入源码、APK 或上传。

最终源码 [真实 main CI 38052163873](https://github.com/liaozhiliang222-cloud/reader/actions/runs/38052163873) 全部成功：388 单测、严格构建、安全/PWA、完整浏览器 102 通过/1 既有 Windows WebKit 离线环境 skip（12.3 分钟，无失败、flaky 或重试），完整报告核验、分页行高变异检出与恢复通过；Android 6 Java / 0 失败 / 0 错误 / 0 skip，lint 0 错误 / 11 既有 Warning，debug 构建成功。deploy 为 skipped。两个原始附件均实际下载与 GitHub digest/CRC 核验：Android 11670530097，31082 字节，SHA 99938d75632cc3256fd5a1ac81779656e4508774fe521f5345ba4100426deebe；浏览器 11669957293，690822 字节，SHA f33949c9e7243ad8400ec01d0bde9feec7d796fab24a7b7309709e96169fc83c。报告源码元数据均为 b35e4b2；完整 HTML/JSON、分页与备份记录独立保存在 artifacts/ci-38052163873/，未借用旧 CI。

公开 APK 附件 627925262：6394187 字节，SHA db3ebbc910f3114530b39c904d2d0045cb3b0f8e04bc13aae825cd16785c8d2c；SHA 文件附件 627925849：90 字节。已从两个公开下载地址重新下载，APK SHA 与本地、GitHub digest 一致，校验文件内容也一致，原字节保存在 artifacts/published-android-v1.0.1/。原证书 c666e187df75ec1d2d61ac7ea73f64d88a0d6f4a5dad22938b7dd23b05e22949、code 4 / 1.0.1、无 INTERNET / SW / 私钥 / 用户书籍，116 资源 SHA 与同步构建一致，ZIP CRC 通过。同签名 install -r 成功，手机 base.apk SHA 一致，未卸载主 App 或清数据；真实启动动效观感仍待用户确认。此前 9ee00b45 按钮版保存在 artifacts/jingye-reader-1.0.1-before-loading.apk。用户临时开启的扩展文件访问权限须手动关闭，工具不能操作扩展设置；本轮不声称已关闭。
当前任务（2026-10-10，暂停发布并优化按钮反馈）：用户明确要求先别上传。`src/styles/base.css` 已关闭按钮、链接、summary 与输入控件的 WebView 默认蓝色触摸高亮；启用按钮仅在 `:active` 时使用正文色 8% 与背景色的混色，无额外动画，保留原 `:focus-visible` 与正文选择。Chrome 390×844 实际按住按钮确认 paper/eink/green/night 四主题底色、透明触摸高亮、松开后恢复及导入面板操作；Shift+Tab 的 2px 主题色焦点仍有效。纯样式没有新增镜像单测或依赖。证据截图与计算样式 JSON 保存在本机 visualizations，手机触摸观感未代替用户验收。

本轮检查：pnpm lint、87 文件 / 380 单测、pnpm build、pnpm build:android 均通过；Android lintRelease / assembleRelease 通过（0 错误 / 11 条既有依赖和模板 Warning）。重打包为 `release/jingye-reader-1.0.1.apk`，6393139 字节，SHA `9ee00b45c966618a4de26a33d0f23ba5a8fd35f1a8f375eac2ffc34d31a88c06`；116 个内嵌资源与本轮构建 SHA 一致、ZIP CRC 通过、无 INTERNET / SW / 私钥 / 用户书籍。原证书、code 4；已 adb install -r 覆盖连接手机，安装成功且设备 base.apk SHA 完全一致，未卸载主 App 或清数据。本轮未重跑原生 IO 专项，上一轮红绿验证仍适用于未变化的 Java 代码。日志为 `artifacts/button-feedback-*.log`，包核验报告为 `artifacts/android-package-jingye-reader-1.0.1.apk.json`。

发布暂停检查点：上一轮原生修复源码 `bc0aa8e` 与 `android-v1.0.1` 标签已推送，旧 APK 曾开始传到草稿，未点击 Publish；本轮按钮改动与新包均未上传。公开 Release API 当前仅返回 1.0.0。旧浏览器草稿标签已关闭，未进一步修改草稿；旧包副本保存在 `artifacts/jingye-reader-1.0.1-before-tap-fix.apk`。用户恢复发布后，先对齐最终源码、发布标签、新 APK 和 SHA，再核对草稿旧附件是否存在；不能把旧草稿 SHA 或 bc0aa8e 标签当成本轮包的来源。继续暂停上传与发布，等待用户下一步指示。

当前任务（2026-10-10，Android 大文件误报修复）：用户提供 EPUB 实际为 4433334 字节。根因是 Capacitor PluginCall.getLong 仅接受 Long，实际 Android JSON 把 524288 等偏移量解析为 Integer，导致读取回退 0，反复累计第一块直到误报 50 MB。已改为 JSONObject.getLong，缺失偏移量也不再静默回到文件开头。新增 3 项 JVM JSON 回归，Java 总计 6 项通过；真实设备上同一个 instrumentation 测试包在原 code 3 全部失败（偏移 524288 返回开头字节），同证书覆盖安装 code 4 后 3 项全部通过，临时测试 App 已移除，主 App 未卸载/清数据。真机专项仅覆盖原生 JSON + FileProvider 分块，未冒充用户文件完整 UI 验收。

用户 EPUB 本地接收/解析专项：9 块、原始 SHA 完全保留、174 章节、1775226 字，错误列表为空。原文件没有复制进源码或 APK，专项脚本/报告均在被忽略的 .review / artifacts。原生修复初始 APK 为 6393007 字节，SHA `7eaab8707bd31cee57a386fbbebde166e3715b6b302fabed5f5ba74eb2f3a0e5`，code 4 / 1.0.1，仍为原证书、无 INTERNET，116 个应用资源 SHA 一致，无 SW；现已被上方按钮优化的新包替代。新增 org.json 20250517 仅为 JVM 测试，与 Capacitor 自身测试版本一致，APK/网页 gzip 增量 0。上一轮 lint / 380 单测 / build 与 Java 6 项均通过，源码已推送；补丁发布因用户要求暂停。

本次发布完成（2026-10-10）：运行代码提交 `6120947`，修复 CI 配置后的发布标签 `android-v1.0.0` 指向 `631a0ed12b218920ab42ee037ea7096642bff5a4`，二者仅 CI/进度文档不同。真实 main CI [38047760091](https://github.com/liaozhiliang222-cloud/reader/actions/runs/38047760091) 全部成功：lint、380 单测、strict 构建、安全/PWA、浏览器 102 通过/1 已知 Windows WebKit 离线 skip（9.49 分钟，无重试/失败/flaky），严格报告校验及行高变异检出/源码恢复通过；Android 3 Java 无失败、lint 0 错误/10 Warning、debug 构建通过。本次未启用网页部署，deploy 为 skipped。首次 Android CI 38047257314 因 sdkmanager 不在 PATH 失败，依据官方 runner 预装清单改为校验 SDK 36 / Build-tools 36.0.0 后通过。

[Android 1.0.0 预览 Release](https://github.com/liaozhiliang222-cloud/reader/releases/tag/android-v1.0.0) 已于 19:29（UTC+8）公开，Release 408896301，draft=false / prerelease=true；APK 附件 627774732 / 6393003 字节，GitHub digest 与本地 `1fbd7aebf67276bd9a1289cbf4dc55b4d234c244633a4d6120a4322dbf7e057f` 完全一致，90 字节 SHA256 附件 627775157；公开下载两个附件后再次验证原始 APK SHA 与校验文件内容完全一致。Android 报告附件 11668720877 ZIP SHA `56ce4d10c87a5a39752488eb2ed3ebfffa6b58b027a3c31838805c978b0a4ea0`、浏览器附件 11667953753 ZIP SHA `24be6a5dcba70ba768834ec6434ca92cf26f1fac856aabcfc3f704c37be4470b` 均实际下载核对；完整/备份/分页报告独立保存在 `artifacts/ci-38047760091/`，没有用旧报告代替。用户手动开启临时本地文件访问权限完成上传，上传后已请其关闭；浏览器工具禁止访问扩展设置，关闭状态仍待用户确认。

当前任务检查点（2026-10-10，Android 源码与 APK 发布复核）：用户授权上传最新源码和 1.0.0 APK。已修复超过 512 KB 的原生 Base64 分块导入、音量键开关备份丢失、退出阅读页未恢复系统栏、原生常亮申请失败、导入停滞/大小限制和异步监听清理；关闭系统云备份/自动换机，收窄 FileProvider，补 MD 图文 ZIP 的打开方式。发布签名缺失时只生成未签名包，禁止回退调试证书；移除未调用的 Filesystem/Share 插件、模板空测试，补齐 Capacitor 原生许可、Gradle 官方 SHA 和独立 Android CI。

当前自动检查：lint、87 文件/380 单测、网页与 Android strict 构建、安全 104 URL/PWA 资源检查通过。完整本地浏览器 102 通过/1 已知 Windows WebKit 离线 skip（10.0 分钟），随后原生分支小修由专项单测覆盖，最终代码完整浏览器已由上述 GitHub CI 验证。Android Java 3 项、lintRelease（0 错误/10 个模板或依赖提示）、assembleRelease 通过；中文路径导致的 Gradle 类加载故障经临时 J: 映射解决并撤销，本机 SDK 路径转义已修正。并未提高截图容忍度、重试或用模拟器冒充真机。

最终发布 APK：`release/jingye-reader-1.0.0.apk`，6393003 字节，SHA-256 `1fbd7aebf67276bd9a1289cbf4dc55b4d234c244633a4d6120a4322dbf7e057f`；包名 `dev.jingye.reader`、code 3 / 1.0.0、minSdk 24 / targetSdk 36，同原 code 2 证书 `c666e187df75ec1d2d61ac7ea73f64d88a0d6f4a5dad22938b7dd23b05e22949`，apksigner 验证通过，无 INTERNET、allowBackup=false，116 个包内资源逐个 SHA 与同步构建一致，无 SW/manifest。旧 code 2 产物保存在 `.review/android-review-original-code2.apk`；密钥/属性/构建/测试书/本机报告与 APK 均不会入源码历史。本轮没有重新安装或操作物理手机，既有荣耀记录仍为历史范围。

依赖说明：Capacitor Core 8.5.3 用于平台判断和原生桥，App 8.1.2 用于系统返回/退出。独立生产压缩为 3.242 / 4.146 KB gzip（App 包含共享 Core，不能相加）；CLI/Android 为构建工具及原生壳，不加入网页 JS，原生壳另保留 MIT 通知。实际全部网页 JS/CSS 为 1701.93 KB gzip，较上次已提交版本 1695.43 KB 增加约 6.50 KB。“网页零增量”尚未达到，当前 PWA 也预缓存惰性原生模块。APK 的 JS/CSS 含桥资源为 1696.51 KB gzip。用户已确认源码和 APK 同传；GitHub 网页现有登录可发布，无需 gh 登录。源码提交、远程 CI 和 Release 已完成，结果见上述记录；真机全量、30 MB 备份、旧 WebView、真实 content URI、迁移与 TTS 仍待办。

本轮完成检查点（2026-10-10）：用户指定仓库 reader 的代码提交 6ce56cd23baa62d3080f46d2f52d6fc4dd5fcf64 已通过真实 GitHub CI [38019710585](https://github.com/liaozhiliang222-cloud/reader/actions/runs/38019710585)：lint、85 文件/372 单测、strict 构建、安全/PWA、完整浏览器 102 通过/1 已知 Windows WebKit 离线 skip（11.5 分钟），严格报告校验及两个引擎的行高变异检出/恢复通过。下载的原生附件 11658261604 ZIP SHA 为 a13e4a56790f3ddc16f521be445206b1ba9d7d217988ae1e7e0fd8ec41eeec8a，已核对完整 JSON/HTML 与独立分页报告，没有用本地结果代替远程 CI。独立故意失败测试的 CI 38017213626 变红已确认，临时分支均已清理。

首次 CI 38017099524 为 98 通过/4 失败/1 skip。全屏切换在挂载后、effect 监听前结束会丢失按钮状态，已修复并增加先红后绿的进入/退出单测。两端 SimSun SHA 相同、默认布局/换行一致但字形绘制不同；Windows Server 六张图经诊断运行 38019268102 采集、逐张查看和 SHA 核验，保留本机原六张基线，没有提高像素容忍度、重试或自动更新截图。诊断采集第一次仅因 CSS 浮点序列化差异失败，修正几何比较精度后完成；采集本身不计完整 CI。分页专项使用独立配置与 JSON，实际核验完整报告未被覆盖。

本地修复后的完整回归 102 通过/1 skip（9.5 分钟），lint、372 单测、strict 构建、安全 104 URL/PWA 110 资源及行高变异/恢复均通过。原 Cloudflare 账号/项目 jingye-reader 的 Production/main 已更新为 dd14fa8b-c7a0-4959-acda-76b6a38aca76（Source 6ce56cd）：三地址各 113 资源 SHA/安全/缓存头、线上常规 4/4（45.1 秒）和引导/可信拖动专项 3/3（14.7 秒）通过。本轮 114 静态文件/7745744 字节，全部 JS/CSS 1695.43 KB gzip，无新依赖。上次 82ac11ae 的构建/三份 HTTP/4+2 浏览器证据原字节归档在 artifacts/deployment-history/m2-source-82ac11ae/，本轮未重跑旧客户端升级专项。README 已提供可下载的原创 MD 图文包。许可证、真机、七天自用、大库内存、自动部署 secrets、落地页与正式渠道发布仍待办；无新 Goal/子代理。

历史源码首次上传检查点（2026-10-10）：M2 引导/环境/可信触摸专项 17/17、本地完整浏览器 102 通过/1 已知 Windows WebKit 离线 skip（9.0 分钟）、lint、84 文件/369 单测、strict 构建、安全/PWA 通过。已修复弹窗焦点循环、WebKit 打开后恢复焦点和设置引导浏览器返回。用户授权上传的公开仓库 https://github.com/liaozhiliang222-cloud/reader 已由本机 GCM 登录推送，main 首次提交 576d65b6fdd56c68d8511111d9342a0815e50a88；376 远程文件逐个 Git blob SHA 与本地提交一致，无书籍/凭证/备份/本机报告。GitHub 连接写入 403 已由标准 Git 登录方式解决，不读取令牌，不改全局作者；提交使用真实账号名/Gmail。main 首次 CI 38017099524 随后为 98/4/1，最终修复结果见上述检查点；独立分支 c878d89 的 CI 38017213626 在指定故意失败测试处变红，已核对日志并删除该临时分支。原 Cloudflare 账号/项目 jingye-reader 的 Production/main 已部署 82ac11ae-9808-4233-a5a1-02a813860623（Source 576d65b）；三地址各 113 资源 SHA/安全/缓存头、线上常规 4/4 与引导返回/焦点 2/2 通过。上传 114 文件/7745740 字节，全部 JS/CSS 1695.46 KB gzip，无新增依赖。源码/Issues/mailto 已配置，反馈邮箱 liaozhiliang222@gmail.com。自动部署 job 已写入 CI，但未配置 Cloudflare secrets 或启用变量；许可证、真机、七天自用、大库内存、落地页与正式渠道发布仍待办。无新 Goal/子代理。本段为首次上传时的历史范围，最终代码/CI/部署见上述检查点；不将模拟 UA/受控安装事件/桌面移动视口计为物理手机验收。

历史部署检查点（2026-10-09）：Markdown 第二版已上线到原 Cloudflare 账户的 jingye-reader/main，最终记录 f4b42eaa-eb40-4d5c-8073-7f4f0b4e1aad；https://jingye-reader.pages.dev/ 与 https://reader.surveykit.cc/ 已同步。最终唯一/稳定/自定义地址各 113 个资源的 SHA、安全及缓存头全部通过；自定义域名 SW 缓存差异已修复。lint、84 文件/369 单测、strict 构建、安全/PWA 与 114 文件上传清单通过；7744280 字节，主包 index-DSPm7wbM.js。首次 MD 上传的线上常规 4/4、MD 8/8、真实旧客户端更新 2/2 均通过；最终仅 _headers 改变且 113 资源 SHA 不变，常规 4/4 再次通过。两次上传的证据各自绑定，不复用旧报告冒充新运行。本轮部署任务完成，无新 Goal/子代理/Git 身份；真机、CI 与完整阶段验收仍待办，详情见文末和 DEPLOYMENT.md。

历史补充（2026-10-03）：M2-04/05八项双引擎原生交互及六张选定截图复核通过，修复单手左上返回在文字选区期间误翻页。75文件337项单测、完整70项中69通过/1环境skip、线上4项及真实旧客户端更新2项通过，已部署3a4c2d69。21本EPUB/3来源的42项与44张截图保持前一D6构建的独立证据；原文/定位/备份不变，真机和7天自用继续待办。

恢复说明：用户于2026-10-03将本轮Goal收敛为最后代码检查与构建，收尾验证已通过，本轮执行结束。主模型单代理，无新增依赖或Git身份。稳定jingye-reader.pages.dev，16静态资源2248306字节，全部JS/CSS182.22KB gzip，150KB只作参考。真实21本数量目标及选定正文已验收；物理手机、DATA-01大库峰值与7天自用未完成。

## 本轮范围

此前 Goal 已按用户要求结束；2026-10-10 用户明确要求继续原计划，本轮执行 M2 浏览器验收/修复与已授权的源码上传、CI 和反馈配置。M1 导入、书架、阅读、标注、备份与 PWA 主要代码已接入；本轮进展不代表全部 M2/M3 退出条件通过。

| 任务           | 状态                      | 证据或待办                                                                                                                    |
| -------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| P-01 环境      | 已验证                    | Node 24.17.0、pnpm 11.21.0、Git 2.54.0                                                                                        |
| P-02 仓库      | 已上传并核验              | 用户指定公开 reader 仓库；main 576d65b，376 blob SHA 全部一致；真实账号命令级作者参数，gh 仍未登录                            |
| P-03 素材      | 部分完成                  | 已有 9 组编码样本；千章性能、无章节及 EPUB 样本待后续任务补齐                                                                 |
| P-04 真机通道  | 未完成                    | Cloudflare受信任HTTPS可访问；物理手机访问/安装仍待验证                                                                        |
| M0-01 脚手架   | 实现及自动检查通过        | Vite + Preact + strict TypeScript、Signals、路径别名、Vitest、ESLint、Prettier；开发日志面板；浏览器交互验收待补              |
| M0-02 工程规范 | 已完成                    | AGENTS.md 已写入产品原则、目录、命令及用户单代理规则                                                                          |
| M0-03 主题     | 实现与静态检查通过        | 夜读主题已通过桌面截图检查；其他主题视觉与手机手势待验收                                                                      |
| M0-04 编码     | 实现与单测通过            | UTF-8、GBK/GB18030、UTF-16；真实 GBK 网文待验收                                                                               |
| M0-05 章节切分 | 实现及单测通过            | 清洗、标题、前言、约5000字分段、10MB千章样本                                                                                  |
| M0-06 至 M0-10 | 实现，回归中              | TXT导入、分页、跨章、字号、Locator、Dexie持久化；尚需完整分页边界验证                                                         |
| M1-01 数据模型 | 实现及迁移测试通过        | v1→v2保留书、文件、章节、进度；新增标注与设置表                                                                               |
| M1-19 设置模型 | 实现与单测/浏览器检查通过 | 全局与单本设置分离，存储事务合并、刷新恢复已验证                                                                              |
| M1-04～30      | 主要代码及自动检查通过    | 导入/文稿/书架、阅读设置与标注、备份恢复已接入；具体浏览器、真机与性能待办见文末和 ISSUES.md                                  |
| M1-31/32       | 代码及自动检查通过        | Manifest、本地图标、全部应用资源离线缓存、冷启动书籍预载；安装/飞行模式/中端机耗时尚未验证                                    |
| M1-33          | 回归中                    | 369 单测；完整 E2E 102 通过/1 已知环境 skip；两台真机与七天自用待补                                                           |
| M2-16          | 本地及线上双版本通过      | 本地6条与Cloudflare实际旧→新客户端2条通过；阅读不刷新、显式更新、七表/原文SHA与新版缓存一致；窗口计时器快进，真机待补         |
| M2-01          | 代码及部分浏览器通过      | 六项真实POST/SW/IDB/Worker、失败重试与跨标签保留通过；WebKit文件限英文名，系统分享菜单/权限/后台启动待验收                    |
| M2-02/03       | 本地及线上浏览器通过      | 17 项专项含环境模拟/安装受控事件；320px/键盘/重载/故障/复看；线上引导 2/2，真实系统安装/微信仍待补                            |
| M2-04/05       | 原生浏览器通过            | 原八项双引擎交互及新增三项 Chromium CDP 可信触摸通过；物理长按/拇指误触/帧率待补                                              |
| M2-06/07/08    | 双引擎浏览器验收通过      | 10条真实Worker/IDB/下载、编码并发/取消、系统媒体/日期/周期重载；手机系统能力仍待补                                            |
| M2-09          | 代码及部分浏览器通过      | 长章六条含注音/图片/跨段与默认动态性能四条通过；开书62.2–126ms、WebKit百书211–224ms，DOM有界；真机帧率/内存待补               |
| M2-10          | 21本选定正文验收通过      | 20种原创结构另计；21本真实/3来源、42项原生检查及44张正文截图通过，数量目标达到；原件/位置保留，复杂SVG/整本其他页面及真机待补 |
| M2-11/12       | 本地双引擎验收通过        | TXT/EPUB全流程、6张分页基线、真实列表几何；行高变异两引擎检出，恢复通过；不证明真机能力                                       |
| M2-13          | 代码及浏览器检查通过      | 主动下载1.53MB同源文楷子集、SHA校验、缓存、重载/删除；Chromium断网通过，iOS真机待补                                           |
| M2-14          | 页面及本地许可/反馈通过   | 版本/隐私/第三方许可/字体许可、源码与 Issues/Gmail；两引擎无外部请求，项目许可证待定                                          |
| M2-15          | 本地加固及浏览器通过      | CSP响应头/meta、资源URL用途清单、依赖审计、ZIP预检/流/CRC与备份限额；线上15资源头/哈希通过；完整安全审计和大库内存未验收      |
| M3-01/02       | 源码上传与 CI 验收通过    | reader 仓库；main 6ce56cd 的 372 单测、完整 102/1 与像素变异/恢复通过；独立红色 CI 已确认，项目许可证待选                     |
| M3-03          | 原账号原项目上线通过      | Production/main dd14fa8b，Source 6ce56cd；三地址各 113 SHA/响应头，线上 4+3 项通过；自动发布凭证及真机安装待补                |
| M3-04/05       | 版本与反馈部分完成        | 0.0.1 关于/CHANGELOG、源码/Issues/Gmail 已提供；正式 tag、许可证与打赏地址待办                                                |
| M3-06/07       | 发布素材部分完成          | README 两张原创截图、可下载 MD 图文示例；落地页三图和正式渠道发布尚未执行                                                     |

## 验证记录

- pnpm peers check：无 peer 依赖冲突。TypeScript 7 与当前 typescript-eslint 不兼容，已使用 TypeScript 6.0.3，并生成版本锁文件供复现（Git 尚未提交）。
- pnpm lint：通过，包含 ESLint 和 Prettier。
- pnpm test：1 个文件、2 项测试通过，覆盖日志循环引用/错误格式化及容量边界。
- pnpm build：严格类型检查及生产构建通过。
- 生产资源：JS 12.10 KB / gzip 5.40 KB；CSS 1.75 KB / gzip 0.81 KB；合计 gzip 6.21 KB。该数值仅代表脚手架，不代表后续 MVP。
- 生产包搜索未发现开发日志面板、异常监听和日志序列化文案；动态导入在生产构建中被移除。
- 开发服务器启动成功；HTTP 请求 /?debug=1 返回 200，HTML 包含静页标题。
- 浏览器自动化工具启动因 Windows sandbox helper setup refresh 错误失败，未完成截图、真实 DOM 交互和视觉验收。此为工具运行故障，不是页面检查通过。
- 未执行 iOS/Android 真机验证，也未验证离线安装。

## 下一步

本轮源码上传、main CI 与线上更新已完成；本地/CI 完整浏览器均为 102 通过/1 已知环境 skip，线上 4+3 项通过。物理 Android/iOS 触摸/安装/性能、整本其他复杂页面、DATA-01 真机峰值与七天自用保留为独立待办。

本地 Git 作者仍未配置，gh 未登录；GitHub 连接读取用户指定仓库正常，写入被其 integration 权限拒绝。本机 GCM 已有用户账号，使用标准 Git 登录上传；提交仅用真实已确认账号名与邮箱的命令级参数，不修改全局配置。仓库可见性由用户创建时确定。

## M0-03 本轮交付与验证

- 已实现 src/styles/tokens.css：paper/eink/green/night 的背景、正文、辅助文字、强调色与 color-scheme；正文/背景与 PRD 6.5 一致。
- 衬线与无衬线系统字体栈通过 --font-serif / --font-sans 提供，data-font 可切换，不下载字体。
- base.css 全部界面颜色改用 Token，包含日志面板、按钮及焦点；添加伪元素盒模型、文本缩放一致性和 overscroll-behavior。
- 长按呼出限制仅作用于控件，touch-action: manipulation 限制控件双击放大；正文选择、原生页面滚动及双指缩放保留。手机浏览器上的具体行为待真机确认。
- 开发环境可用 ?theme=paper|eink|green|night 与 &font=serif|sans 验收；默认米白纸，不持久化、不增加正式设置面板。系统状态栏主题色同步仍属于 M1-21。
- 原朱砂在绿纸背景对比度仅 4.29:1，绿纸强调色微调为 #AD402B 后为 4.67:1；夜读强调色为 #D87965。四主题正文/辅助文字/强调色全部经颜色值计算达到 4.5:1，无新增依赖。
- pnpm lint、pnpm test（既有 2 项）、pnpm build 通过；本次纯样式改动不新增镜像实现的单测。
- 最终资源大小以本轮构建输出为准；此前脚手架体积保留作为基线。
- 主题预览地址 HTTP 200；浏览器工具重置重试仍出现 sandbox helper setup refresh 错误，尚未完成浏览器计算样式、截图和 iOS/Android 手势验收。M0-03 状态为实现及静态检查通过，真机验收待完成。

## M0-04 本轮交付与验证

- 新增 src/parsers/txt/encoding.ts，API 为 decodeText(ArrayBuffer)，返回 text 与 encoding。原生 TextDecoder 严格解码，无新增运行/开发依赖。
- BOM 优先；无 BOM 且有明显零字节端序特征时识别 UTF-16；其余按 UTF-8 → GB18030 → Big5 尝试。GBK/GB2312 统一使用兼容标签 gb18030。
- 明确 BOM 与正文不符、截断字节、不支持的 UTF-32 会抛出 TextDecodingError；不通过替换字符掩盖解码失败。不能保证检测所有文件损坏：无 BOM 的错误字节也可能恰好是另一种编码的有效文本。
- 自动识别有固有限制：Big5 与 GB18030 重叠时优先 GB18030，可能乱码；无 BOM 且缺乏 ASCII/空白零字节特征的 UTF-16 无法可靠判断。按计划在 M2-06 增加手动切换兜底。
- src/parsers/txt/fixtures 内含自编文字真实编码字节与独立 UTF-8 预期；generate.py 可复现 9 组样本并复制至 test-books/。Python 只用于再生成，应用与单测不依赖它。新增 .gitattributes 防止 Git 换行转换损坏预期样本。
- pnpm test：2 个文件共 20 项测试通过；包含合成 GBK 文本前 200 字与全文、GB18030 扩展汉字、UTF-16 端序、空文件、内部 BOM 与损坏输入。尚无用户真实 GBK 网文，保留该人工验收项。
- pnpm lint 与 pnpm build 均通过。解析器尚未接入页面，因此本轮生产 JS/CSS 体积不变（gzip 5.40/1.28 KB）；不能据此推断解析器未来打包体积。
- 浏览器故障补充：上一轮重试已成功连接现有标签并截图确认夜读首页，旧故障记录仅代表当时状态，不再是当前已知阻碍。真机验收仍未完成。

## Goal 持续执行检查点（2026-10-02）

- 用户授权：以 Goal 模式完成剩余计划，每阶段自行测试验收。保持单代理；不用反复等待确认。目标已创建，状态 active；不存在 token 预算。
- M0-05：新增 clean.ts / chapters.ts 与测试，无标题按段落边界约5000字切分。当前正则要求章序后有边界，需扩充“第一章静夜”这类无空格标题，避免影响常见格式识别率。
- M0-06~10 原型：ReaderView.tsx 使用 CSS columns + translateX，Range 字符二分计算锚点；单章渲染、前后跨章；Pointer/键盘翻页、字号14~28、ResizeObserver、生命周期保存；App 有 TXT 导入及简单书架。
- 存储：Dexie v1 books/chapters/progress/blobs，按章读取；原文件和解析内容原子事务写入，同哈希去重。Worker + Comlink 解析前置实现（M1-02 部分），SHA256 指纹前置实现（M1-03 部分）。新增 fake-indexeddb 仅开发测试，运行包贡献0；Dexie/Comlink 的实际合计影响包含在当前主包gzip42.71KB和Worker约3KB内，未单独拆包测量。
- 已验证：pnpm lint/test/build 通过，5文件45项单测；数据库重复导入不覆盖进度、写入失败事务回滚；11,417,891字节1000章合成书UI导入362ms（桌面机器、390×844视口），GBK样本导入133ms。50次下一页到第5章第3/12页；重新打开保留章节位置。
- 已修复：开发日志浮层遮挡底部翻页按钮，阅读时调整其位置；刚修复字号变动时锚点被新页首重写导致往前漂移，layout现在保留传入目标锚点，用户真正翻页才更新页首锚点。该最后修改尚需浏览器复测。
- 下一具体动作：复测18→24→18、横竖视口切换及刷新返回原页；检查每页行框不截断、跨章前后与快速点击不漏；修复菜单打开时正文点击应先关闭且不翻页、长按拖动不要翻页、Worker失败/超时退出等问题。给原型补可复现回归记录，不能仅凭45单测标记M0完成。
- 浏览器工具可用。cua_repl 当前 testTab 为浏览器2的标签2（http://127.0.0.1:5173/），已导入合成书 webnovel-1000ch 与 gbk；testBrowser 为浏览器2。临时视口390×844，结束浏览器测试时需 reset。旧标签1卡在内置连接拒绝错误页，不需反复操作，使用标签2。开发服务 exec session14989，若失效重新 pnpm dev。
- 仅读取DOM/UI：浏览器通过 cua_repl；已读 local-web-development/file-uploads 文档。文件选择使用 waitForEvent('filechooser') + 点击导入按钮 + chooser.setFiles。不要用其他浏览器控制技术。
- 真实设备、7天自用、HTTPS、Git作者/GitHub账户仍缺外部条件；保留事实，不因这些项停下可独立推进的M1/M2开发。
- test-books/ 已有 webnovel-1000ch.txt 与 no-chapter.txt（合成文本），目录被忽略。原始PRD/DEV_PLAN未修改。

## 最新检查点：M0 回归与 M1 数据层（2026-10-02 13:20）

上一 Goal 轮为实质进展，本轮亦为实质进展。目标保持 active。此前文末未完成项以下述最新证据为准。

- 本轮修复：无空格中文章标题；长按超过500ms再拖动不翻页；菜单打开时点击正文只关菜单；跨章加载期间队列保留快速翻页操作。增加 Worker error/messageerror 与120秒超时退出，finally释放代理和线程，不再无限挂起。
- 浏览器回归：新标签3恢复连接。390×844下第5章第3/12页 → 字号24第4/22页 → 18恢复第3/12页；横屏844×390变为第4/18页，转回第3/12页；刷新重开仍第5章第3/12页。所有结果等待实际内容style更新后读取。
- Range行框检测整章所有列：14px 200行框、18px 240行框、24px检测、28px 360行框，超出内容区上下边界的行框均为0。仅代表当前合成样本与浏览器，不扩称所有设备/书籍。截图 artifacts/m0-reader.png。
- 正式数据库：createDatabase在src/db/schema.ts，版本2新增bookmarks/highlights/settings；迁移旧book补fileBlobId=id，不改原文和进度。新增 migration单测和旧数据实际UI打开。Book支持txt/epub/paste，StoredChapter保留paragraphs并允许html/level，便于后续EPUB。
- 设置模型：src/app/settings.ts包含默认ReadingSettings、AppSettings、signal和effectiveReading；测试默认不被单本覆盖污染，变更全局时新书继承。注意目前还未调用该signal或写settings表，M1-19仅基础逻辑就绪，不能标全功能完成。
- 最终验证：pnpm lint/test/build 全通过，8文件53项测试；主包gzip43.07KB、CSS1.95KB、Worker原始6.26KB。
- 下一步：实现设置存取repository + hash路由/阅读设置接入，随后EPUB OPF/nav/安全净化/插图与粘贴、书架管理；M0仍可后续补充跨章快速操作浏览器回归和手机实际手势。用户不需逐项验收。
- 浏览器工具现状态：freshTab是浏览器2标签3，已markHandoff；testBrowser为浏览器2，临时视口已reset。之前标签2连接超时，不重复强连。新标签中有gbk、webnovel-1000ch合成测试书。

## 最新检查点：设置与路由接入（2026-10-02）

- 本轮为实质进展，Goal active。M1-19已接入数据库和阅读器；M1-10已完成书架/阅读/设置hash路由，粘贴路由仅解析，页面随M1-09补齐。M1-20多数排版设置已接入，尚缺翻页动效选项/可选字体；M1-21四主题/纹理/状态栏meta同步已实现，真机状态栏外观未验收。
- src/db/settings.ts事务合并全局设置/单本覆盖，App启动加载，保存lastBookId；autoResume开启且无显式hash时直达上次阅读。设置页已显示存储估算和持久化申请；清空/备份仍未做，不能标M1-27完成。
- Reader使用字号、行距、段距、边距、字体、对齐、缩进、页眉开关；纯净模式reservedHeight=32，普通112。排版设置通过effect保留Locator后重新分页。主题/纹理变化不触发排版重载；默认/书籍设置已分开。
- 浏览器验证：全局字体20+green，刷新设置页仍20+green，meta色#DCE8D6；webnovel单本改24+night并刷新read hash，仍24+night且第3/13页；再回全局设置确认仍20+green，说明单本没有污染全局。截图artifacts/m1-settings.png。
- 验证命令：pnpm lint/test/build全部通过，10个测试文件56项测试；主包gzip48.35KB，CSS2.48KB，Worker6.26KB原始。新增路由解析、并发设置事务、重开数据库恢复测试。
- 浏览器：旧标签3的focus CDP超时；新settingsTab浏览器2标签4可用，已markHandoff，处于#/settings。default桌面视口，未覆盖。proofFs仍是node:fs/promises可保存截图。两本合成样本书已存在，此次只改测试设置。
- 下一步依赖：M1-04~07 EPUB容器/OPF/nav/净化/图片与异常处理，接入Worker通道和统一导入面板；同时补EPUB合成样本与单测，然后M1-09粘贴、正式书架操作、目录/进度、标注、备份、PWA。当前正式设置模型已可复用。
- 注意：当前只有TXT，StoredChapter.html是为EPUB预留，Reader仍仅paragraphs文本。EPUB不能直接innerHTML未经净化；Worker无DOMParser，需要明确解析方案及相应测试。

## 最新检查点：EPUB 解析与阅读接入（2026-10-02）

- 本轮为实质进展，Goal 保持 active。M1-04/05 核心解析已实现，M1-06/07 安全渲染与异常提示接入；目录数据保存到 Book.toc，目录抽屉和跳转待 M1-15，不能称 UI 目录已验收。
- 新增 src/parsers/epub/{xml,sanitize,parse}.ts：container→OPF→spine；书名作者/封面；EPUB3 nav 与 EPUB2 NCX、多级目录/fragment定位、无目录回退。白名单节点保留常用段落/强调/列表/注音，丢弃脚本、事件、原始style、外链资源。原始HTML不送入innerHTML。Worker使用JSZip和xmldom，无DOMParser依赖。
- parse.worker.ts的parseFile统一TXT/EPUB；importText.ts仍保留旧函数名，支持两类扩展名、50MB前置限制；加密文件/损坏包/缺失结构报错。解压累计150MB限制目前在解压后判断，不能作为完整压缩炸弹防护；M2-15需补增量上限。存在encryption.xml即拒绝，目前也会拒绝仅字体混淆文件，兼容性回归需细分。
- 图片与原文在同一Dexie事务保存；reader/content.ts仅从本地图片Blob创建URL，切章/退出释放；BookCover显示本地封面并释放URL。CSS限制图片宽高。locator.ts改为遍历嵌套文本节点和图像段落，避免粗体/强调后定位丢失。
- 63项单测（11文件）全部通过，pnpm lint、pnpm build通过。构建主包gzip49.10KB、CSS2.64KB；Worker原始195.45KB/Node gzip64.47KB。新增JSZip3.10.2和xmldom0.9.12仅在Worker内，含解析逻辑的Worker较原约增加61KB gzip；README已说明理由及合计体积。
- scripts/epub-fixture.mjs可重建自编带图EPUB。浏览器实际导入3497字节/2章耗时257ms，正文仅一张本地Blob图片且naturalWidth=240，script/iframe/onclick节点0，远程图片被删除。390×844下第6/21页21.7%→字号24第8/32页21.7%→20恢复第6/21页21.7%，刷新仍第6/21页21.7%。书架显示封面、书名、作者。截图artifacts/m1-epub.png和m1-epub-shelf.png。
- 第一次导入被Vite依赖预构建刷新打断；稳定后重试成功，没有绕过浏览器安全限制。测试不代表所有EPUB或真实手机兼容性。
- 浏览器epubTab为浏览器2标签5，已markHandoff，位于书架；testBrowser/proofFs仍可复用。viewport已reset。旧标签连接可能过期，按已选浏览器创建新标签恢复，不重复选择浏览器。
- 下一步：M1-08多文件导入面板（逐文件状态、失败不阻断、重复提示），M1-09粘贴/编辑文本，再正式书架排序删除/信息、目录与进度、书签标注、备份与PWA。M1-13三章预排版尚未完成；本轮仅单章图文正确渲染。真实设备/7天自用/外部账号部署仍保留前置条件。

## 最新检查点：多文件、文稿与书架管理（2026-10-02）

- 上一 Goal 轮为进展，本轮同样有代码与验证进展；Goal 保持 active，完整目标未缩小。没有子代理或自动模型切换。本轮恢复文件证据后继续开发，原始 PRD/DEV_PLAN 未改动。
- M1-08 实现：ImportSheet 原生 dialog 底部面板，文件多选/粘贴入口；importBatch 串行解析、逐文件状态、单文件失败继续、重复提示；单本新导入直接阅读，多本留书架，已有书提供继续阅读。importText 返回 {book, duplicate}，同指纹不会覆盖既有数据，事务返回值处理并发重复。
- M1-09 实现：PastePage 标题可空、剪贴板按钮失败给出手动粘贴说明；parseDraft 在 Worker 中纯文本清洗、Markdown 标题与层级、自动首行30字标题、10万字解析测试。ID为 paste: 加正文原始UTF-8 SHA256，防止与同字节TXT混型。原文用 draftBlobId 存本地 Blob（fileBlobId 为空），便于无损编辑；完整备份需后续包含该Blob。
- 文稿编辑：路由 #/paste/<encoded-id>，信息页编辑正文。只改标题保留进度/书签/笔记；正文修改更换哈希并重置旧位置，已有标注时页面说明数量并要求确认。事务保留导入时间和排版，更新自动续读ID；冲突或写入失败回滚旧文稿、原文、标注。已测试首次保存排版保留（初版发现丢失后修复）。
- M1-11/12 实现：UI移到 src/pages/Bookshelf；批量读取书籍与进度，展示封面、作者、类型、阅读百分比/相对时间和继续阅读卡；最近阅读/导入时间/书名排序保存到全局 shelfSort。每行44px操作按钮与600ms长按/桌面右键，位移取消长按；书籍信息、重命名、删除二次确认并展示书签/笔记数量。deleteBook同事务清理 books/chapters/blobs/progress/bookmarks/highlights 和 lastBookId；未影响其他书的测试通过。
- 前置恢复接口：saveBook支持 missingFile 占位补导，保留原标题、进度与标注并写入原文件/章节；书架显示待补充文件并引导导入。轻量备份恢复页本身仍未实现，不称恢复功能完成。
- 自动检查通过：pnpm lint、pnpm test（15文件77项）、pnpm build。新增覆盖串行失败不阻断、文稿段落/标题/层级/哈希、空输入/10万字、>50MB拒绝、数据库编辑/冲突/回滚、删除释放记录、补导笔记保留、排序不变更输入及设置并发持久化。无新增依赖；构建主包gzip53.35KB、CSS3.15KB，Worker原始196.45KB/Node gzip64.82KB，合计约121.3KB。
- 浏览器验收未完成：cua_repl启动即报 windows sandbox failed / helper_unknown_error: setup refresh had errors；重置后同一浏览器2再次初始化亦失败，未进入页面。不是已验证的应用故障，也没有自动审批拒绝。exec_command默认也因同一沙箱辅助进程失败；只读/格式化/检查命令获沙箱外自动审批后成功。没有绕过浏览器工具改用其他浏览器控制。
- 待浏览器验证的明确清单：3文件多选（2成功1损坏）与重复状态；单本导航；文稿自动标题/章节/10万字进入阅读<1s；编辑标题保留位置，改正文警示及替换；进度百分比一致、排序刷新、长按手势与滚动、删除确认/关联数据；100本书首屏<500ms和滚动。单测不作为这些UI/性能条件通过的证明。当前无新截图；上一轮截图只代表旧版本。
- scripts/import-fixtures.mjs已生成 test-books/batch-first.txt、batch-broken.epub、batch-last.txt 和 long-article.md（1000段共10万正文字符）。全部自编，test-books被忽略。README已补入口、行为、限制及体积说明。
- 下一具体动作：浏览器工具可用时补以上真实UI证据；继续 M1-13 当前/前/后章节预排版与无闪烁衔接，M1-15目录抽屉/锚点跳转，M1-16进度拖动及返回前位置；再书签/划线/笔记、备份、PWA。M0/M1 真机和长期自用仍未验收；M3/M4外部前置条件仍保留。Git作者未配置，不伪造提交身份。
- 浏览器REPL已reset，旧绑定全部丢失；后续按工具首次初始化规则选择浏览器2现有项目页。开发服务器此前5173，若观测故障先检查原服务是否活着，不仅凭工具超时重启。

## 最新检查点：相邻章、目录、常亮与书签（2026-10-02）

- 本轮为实质代码与检查进展，Goal 保持 active。用户授权自行验收继续有效；完整目标未缩小，仍用单主代理，没有自动模型切换。
- M1-13 实现：ReaderEngine 统一 TXT/EPUB 渲染，ChapterWindow 保留当前章与前后相邻章；隐藏章在 DOM 中预排版且设 inert/aria-hidden。跨章等待期间保留原正文，成功后同步切换；排版变化复用当前 Locator，快速翻页串行排队。AbortSignal 与幂等释放清理取消的 DOM 和图片 URL，晚到结果不会污染新实例。章首标题留白、图片为行框预留高度已接入。连续五章无闪烁与带图分页仍需浏览器证据。
- M1-14/17 实现：菜单浮层、字号配置与分页引擎生命周期分离，页眉页脚开关改变可用高度；菜单按钮/进度控件不触发正文手势，表单和弹窗内键盘不翻页。此前单章原型的分页浏览器证据不扩称为本轮重构验收通过。
- M1-15/16 实现：左侧目录原生 dialog，多级缩进、当前项高亮并滚入视口；56px 行的虚拟列表只生成可见项附近记录。Book 缓存轻量 ChapterSummary，旧书逐章游标回填元数据，不一次加载全书正文。进度拖动显示章节与百分比，释放按字符位置跳转，保留跳转前 Locator 并提供返回。纯位置函数覆盖章边界、100%、空段、图片段及代理对偏移。
- M1-18 实现：阅读常亮 off/idle5m/always，前后台切换释放/重申请，五分钟计时在操作时重置；拒绝、系统释放和迟到请求不会产生重试循环或遗留锁。菜单全屏按钮及 Android 点击书籍的用户操作请求已接入，不支持时有说明。真实五分钟不熄屏、Android/iOS 全屏外观未验收。
- M1-22 实现：本地事务添加/去重/移除书签，存页首 Locator、章节名、50字摘要与时间；目录书签页按内容位置排序并跳转/删除。顶栏根据当前分页判断添加/移除，正文角标在重新排版后用锚点重算。并发重复、Unicode摘要与不同书籍删除隔离已有单测；改字号角标、刷新持久化 UI 待浏览器确认。
- 自动检查：pnpm lint、pnpm test（20文件91项）、pnpm build 通过。新增检查覆盖相邻窗释放与取消竞态、目录可见区、位置映射、旧书元数据回填、常亮假时钟与请求竞态、书签事务。无新增依赖；主包 gzip58.18KB、CSS3.54KB、Worker 原始196.45KB/此前实测gzip64.82KB，总计约126.5KB。
- 浏览器工具本轮 reset 后按原浏览器2初始化，仍在内核启动时失败，最新错误 windows sandbox failed / helper_unknown_error: read ACL run had errors。没有进入应用，没有新截图；不是应用验收通过或自动审批拒绝。继续使用正式浏览器工具，不绕过它启动别的控制方式。shell 默认同样受 helper 故障影响，必要的只读/检查操作通过沙箱外自动审批完成。
- 待 UI 验收：上一检查点的多文件/文稿/书架清单；连续跨5章、快速翻页与带图上下边界；排版/旋转/刷新锚点与菜单不移动正文；1000章目录打开<300ms与fragment跳转；50%滑块释放与返回原页；书签添加/移除/改字号角标/刷新；真机常亮与全屏。计时单测不能证明这些UI性能或真机行为。
- 下一具体动作：实现 M1-23～26 选择浮层、三色划线/清除、笔记编辑与列表、Markdown 导出；随后设置数据管理/备份及PWA。浏览器工具恢复后补当前未验收清单。M0 真机、M1 七天自用、M2 20种真实EPUB、M3/M4 外部发布条件仍按事实保留；Git 作者未配置，不伪造提交。

## 最新检查点：选区、划线笔记与导出（2026-10-02 14:29）

- 上一 Goal 轮和本轮均有代码与验证进展，完整目标保持 active。本轮推进 M1-23～26，不缩小目标，没有子代理或模型切换。PRD/DEV_PLAN 未修改，Git 作者仍未配置，未伪造提交身份。
- M1-23 实现：selectionchange 按帧更新自定义菜单，三色划线、笔记和复制；菜单按可见选区放上方，空间不足放下方并限制屏幕边界。正文选区或标注操作期间阻止翻页手势/快捷键。保留系统原生选择能力，未强制禁用原生菜单；iOS菜单是否遮挡仍待真机检查。Clipboard拒绝时尝试原生复制命令，失败保留原选区并提示系统菜单。
- M1-24 实现：src/reader/annotation.ts / selection.ts 将跨文本节点、跨段选区映射到单章 start/end 段落与UTF-16偏移；边界不拆代理对，空范围/越界拒绝。db/highlights.ts 从存储正文生成摘录，事务去重同范围，不信任调用者摘录；改色保留笔记，清空笔记保留划线，删除只影响指定书。已有划线点击编辑由Range实际矩形命中实现。
- 渲染：src/reader/highlight.ts 优先CSS Highlight，旧浏览器用mark分割文本节点，保留strong/em/ruby等结构。重叠范围用相同分段优先级，最新创建标注显示在上层；不丢其他范围。相邻章缓存与标注接入ReaderEngine；fallback对未变化的正文复用节点，避免预排版结果或笔记更新打断原生选区。释放清理mark、自有registry名称及定时器，不清空其他registry。上述DOM结构与时序已测，真实CSS分页位置未测。
- M1-25 实现：NoteEditor原生dialog编辑并保存；ContentsDrawer笔记Tab按章分组、按位置列出摘录/笔记/时间，可跳转或编辑。跳转后标注提示900ms，预排版刷新保留同一提示的剩余时序，不重启闪烁；prefers-reduced-motion下只静态提示。键盘导致的排版变化保留Locator，不以重新分页直接关闭笔记编辑。
- M1-26 实现：src/reader/exportNotes.ts生成单本Markdown，含书名、作者、按章排序的多段引用、笔记、ISO时间。原文与标题转义Markdown/HTML，清理下载文件名中的路径符和控制字符。src/app/files.ts提供Blob下载、文件/文本Web Share、复制；分享取消不自动重发，下载延迟15秒释放URL。本轮未实际在Obsidian或系统备忘录打开文件，不能以字符串测试代替该条件。
- 自动检查通过：pnpm lint、pnpm test（24文件109项）、pnpm build。新增测试包括嵌套强调/注音和元素端点选区、跨段代理对、原文保真、重叠标注/改色/删除、相邻章刷新不破坏选区、native与mark一致及registry隔离、提示时序、并发去重/笔记更新/写入失败回滚、Markdown分组转义、复制拒绝兜底/选区还原、下载清理与分享取消。测试首次运行暴露了测试数据库关闭后未重开和useRef严格类型问题，均修复；格式检查的文件名控制字符规则也已修复。
- 新增happy-dom20.14.5仅开发依赖（生产gzip贡献0），供DOM回归，不模拟真实布局。无新增运行依赖。Vite构建主包gzip64.01KB、CSS4.11KB、Worker原始196.45KB；scripts/bundle-size.mjs统一Node gzip实测主包63.41KB、CSS4.10KB、Worker64.82KB，总计132.34KB。静态颜色计算四主题的正文对三色背景和提示背景均≥4.5:1，最低夜间提示4.58:1；未称真实计算样式已验收。
- 浏览器重试：cua_repl按原浏览器2读取http://127.0.0.1:5173/#/，仍在内核启动时报 windows sandbox failed / helper_unknown_error: setup refresh had errors。没有进入应用，没有新截图。默认shell同样在辅助进程启动时失败，只读/格式化/检查命令获沙箱外自动审批后执行；未发生自动审批拒绝，未改用另一种浏览器控制绕过故障。
- 待验收项延续上一检查点，增加：iOS/Android长按/拖动原生选区与菜单稳定性；三色/重叠/跨页划线，字体/主题变化后位置准确；点击改色/笔记/删除及刷新；软键盘弹出时笔记编辑保持；抽屉分组/跳转一次提示；真实剪贴板、下载/系统分享、Obsidian/备忘录格式。109测试不证明真实手势、CSS半行或跨页视觉结果。
- 下一具体动作：M1-27数据管理清空确认及启动持久化申请，M1-28～30轻量/完整备份导出和预览合并/覆盖恢复；随后PWA。工具恢复后补浏览器与离线回归。真实设备、七天自用、真实EPUB兼容集与M3/M4外部账号/域名/密钥条件继续按事实记录。

## 最新检查点：数据管理与备份恢复（2026-10-02 14:55）

- 上一 Goal 轮和本轮均为代码及验证进展，完整目标保持 active。用户自行验收授权继续有效，保持单主代理；PRD/DEV_PLAN未修改。M1-27～30本轮代码已接入，不能以自动检查替代两台手机与浏览器交互验收。
- M1-27：App启动调用requestPersistence；设置页显示用量/配额/持久化状态，不支持时显示未知，不声称零用量或已批准。清空原生dialog要求输入“清空”，展示书籍/标注数量；七张表在单一事务内清理，signal回到默认值，不重新写入settings行。DOM交互测试验证错误确认词不清理、正确词提交后七表为空。
- M1-28：backup/snapshot.ts以只读事务快照导出元数据、进度、书签、划线笔记和设置，剔除本机fileBlobId/coverBlobId/draftBlobId，不含正文；BackupFile开放JSON格式schemaVersion=1（独立于Dexie v2），额外kind与files用于ZIP原文件映射。保存/分享交给浏览器后才更新lastBackupAt，页面提醒确认文件保存，未称已经写入磁盘。
- M1-29：archive.ts复用原parse.worker的JSZip，完整ZIP为backup.json+books/原文件；TXT/EPUB原始字节、文稿原始Markdown文本均保留。文稿ID的冒号路径转为%3A，Windows解压兼容。generateAsync streamFiles=true、STORE、进度节流100ms；最终Blob仍整体驻留内存，不声称完全流式落盘。原文缺失数量明确提示，剩余元数据与标注仍导出。
- M1-30：文件选择后在Worker读取JSON/ZIP并预览数量，默认合并；覆盖需要勾选确认。Worker在提交前重解析原文、验证size和SHA256，TXT按已存编码解码，EPUB重建净化节点/图片/目录，文稿重建章节但保留原始draft Blob。恢复失败不开始或回滚主数据库写入。原生复制/下载辅助模块新增文件分享，分享取消不更新时间。
- 合并：按书指纹去重，保留已在本机的原文、书名、排版与默认设置；缺原文占位可以补全。进度updatedAt、划线updatedAt、书签createdAt较新者胜出，平局保留本机；同标注ID跨书冲突拒绝并回滚。空设备采用备份设置。覆盖替换书架/标注/设置，删除备份外书籍及资源，同时复用备份内本机匹配原文。正文存在时检查位置与引用，缺文件时保存占位待补。
- 补导修复：正式saveBook补导更新实际size；saveDraft补导占位时保留备份书名/导入时间/进度/笔记，重置派生正文尺寸而不丢元数据。直接走repository补导TXT和文稿的回归通过；未以完整备份恢复流程替代此路径。书籍编辑的已有测试仍通过。
- 校验：validate.ts对app/版本、书籍指纹与类型、有限数字/非负偏移、设置枚举、重复ID、记录引用、原文件路径做白名单读取，丢弃本机Blob引用与未知原型字段。ZIP每份原文件增量读取按metadata.size终止超限，路径穿越与缺失拒绝。仍未限制backup.json解压体积/总备份规模，未验证整个ZIP CRC；原始书籍指纹验证在提交前完成，进一步安全与大库内存加固属M2，不能称安全审计已完成。
- 线程：客户端处理error/messageerror、五分钟超时及AbortSignal，离开设置页取消未提交工作并释放代理/Worker/计时器，迟到结果无效。线程取消测试模拟通信层；真实Worker与浏览器文件分享尚待UI验收。纯默认设置移至app/defaults.ts并维持settings.ts原导出，避免Worker间接加载Preact/signals界面代码。
- 自动检查：pnpm lint、pnpm test（30文件124项）、pnpm build通过。覆盖10本TXT+文稿ZIP读回、独立两数据库完整一致、EPUB封面/插图Blob/净化节点/目录恢复、轻量占位与正式补导、较新本地进度/笔记/书名/设置保留、覆盖清理其他书、写入失败整库回滚、标注ID冲突、非法位置/引用/路径、大小超限与截断、取消释放、清空确认词、存储API缺失/批准/拒绝。首次恢复样本lastReadAt与进度时间不一致已修正为与实际saveProgress一致，测试未用更弱断言掩盖差异；严格类型与规则问题也已修复。
- 独立ZIP验收：设置JINGYE_WRITE_BACKUP_FIXTURE=1运行archive.test.ts，由真实buildArchive生成test-books/generated-backups/backup-10books-972accb8-adae-4a5f-b368-9e7e0588bf86.zip（11781字节，自编10本TXT+1本文稿）。Windows Expand-Archive成功解压到同目录windows-972accb8-adae-4a5f-b368-9e7e0588bf86；11份文件逐个核对size及SHA256，全部匹配。该目录已由test-books/忽略，不包含真实用户/版权书。这是桌面独立解压证据，不扩称手机保存/恢复通过。
- 无新增依赖。最终Vite主包gzip69.75KB、CSS4.21KB，Worker原始205.97KB；统一Node gzip主包69.12KB、CSS4.20KB、Worker68.49KB，总计141.81KB，含全部Worker。只证明当前产物体积，不证明手机首次加载性能。
- 浏览器重试reset后按浏览器2初始化http://127.0.0.1:5173/#/，仍在内核启动时报windows sandbox failed / helper_unknown_error: setup refresh had errors。未进入应用、没有新截图，也未发生自动审批拒绝。必要shell检查通过沙箱外自动审批执行；未改用其他浏览器控制绕过故障。
- 待真实验收新增：存储状态实际显示/启动持久化、完整/轻量生成进度不冻结、浏览器下载/系统分享、恢复预览/覆盖确认与失败提示、跨设备完整一致及轻量补导、清空后实际书架为空与存储释放、大书库备份/恢复内存。此前多文件、书架、目录、标注的UI清单继续保留。
- 下一具体动作：M1-31 Manifest/图标/Service Worker/App Shell离线预缓存与更新入口，再M1-32冷启动续读及M1-33回归；工具恢复后补浏览器离线与前述验收。M0真机、七天自用、20本真实EPUB、M3/M4账号/域名/签发密钥等外部条件按事实保留，Git作者未配置，不伪造提交或公开发布。

## 最新检查点：PWA、更新与启动续读（2026-10-02）

- 上一 Goal 轮和本轮均为实质代码及验证进展，完整目标继续 active。本轮完成 M1-31/32 的实现与可执行自动检查，并前置 M2-16 更新入口。单主代理，无模型切换或委派，PRD/DEV_PLAN 保持原样；不能将 M1 全阶段、真机安装或七天自用标为完成。
- M1-31：新增 vite-plugin-pwa1.3.0 开发依赖，injectManifest 生成构建资源清单、standalone/orientation:any/zh-CN Manifest。public/icons 提供原创建书图 SVG 与192/512、maskable512、apple-touch180 PNG，scripts/icons.mjs 本地生成；已查看512 PNG，遮罩安全区内，未用字体或外链。Manifest 由构建生成，不维护可能过期的第二份静态清单。
- src/sw.ts + workers/offline.ts：全部同源应用壳/JS/CSS/解析Worker/图标预缓存，按清单SHA256和部署作用域分独立缓存；导航含query返回应用壳。首次完整下载才激活；失败删除不完整的新缓存，已有同版本内容不重下也不删除。只拦截GET导航、已列资源与本地assets，不缓存外源或用户文件。保留打开中旧标签所需的哈希资源；无窗口客户端激活时清理本作用域过期缓存，不操作书籍DB或其他作用域/字体缓存。
- M2-16：原生ServiceWorker注册+signal更新状态，安装成功/失败、旧版本等待、离线就绪和超时均处理。更新只在书架提示，明确点击才发送SKIP_WAITING；仅发起更新且仍停在书架的标签收到controllerchange时刷新。其他阅读标签、点击后已进入阅读及迟到激活事件均不自动刷新。设置有自动检查开关和手动检查；主动检查一小时一次且仅在线/前台，关闭后不定时请求，浏览器自身检查不由应用承诺禁用。开发环境不注册SW。
- M1-32：loadStartup 在首次路由前加载设置及目标书，App复用预载书籍，不再重复读同一本书；空hash+autoResume进入上次书，显式书架/设置/粘贴链接优先。已删除或missingFile书返回书架并给出提示；数据库重开后单本排版、原进度和笔记保留。中端手机冷启动正文<1秒尚未测量。
- 回归：137项/33文件全部通过，lint通过，strict TypeScript + pnpm build通过。新增13项覆盖断网导航/Worker、安装失败与相同清单缓存、作用域隔离、旧标签资源、只注册一次、主动更新/另一标签/迟到更新不打断阅读、检查开关/后台/断网/失败/超时、注册重试/安装失败、续读与缺失原文。新增ISSUES.md记录M1回归与已知M2加固待办；七天真实自用尚未开始。
- 生产产物验收：pnpm check:pwa在Node VM中执行实际dist/sw.js安装/激活/fetch/message，用仅允许dist文件的fetch加载后模拟断网；10份独立静态资源逐字节一致，包含parse.worker。外部请求不被拦截、导航query离线成功、未收到明确消息不skipWaiting，Manifest和PNG尺寸/iOS链接通过。此为真实产物的模拟Cache API测试，不等同浏览器ServiceWorker或飞行模式验收。
- 构建体积统一使用scripts/bundle-size.mjs递归读取dist全部JS/CSS，现包含根目录ServiceWorker；达到150000字节则失败。15:12最终校验主包70.65KB、CSS4.23KB、解析Worker68.49KB、SW1.40KB，总计144.77KB gzip，仍低于PRD150KB；Vite报告主包71.27KB/CSS4.24KB，不混用其口径。插件及构建依赖本身生产贡献0，新增注册/界面/缓存代码的实际贡献计入此总额。最终lint、137项测试、build和产物离线检查均通过。
- 本地正式预览exec session96995，http://127.0.0.1:4173/；/、manifest.webmanifest、sw.js和apple-touch PNG均HTTP200，MIME分别正确。原开发服务器5173仍HTTP200。浏览器cua_repl本轮仍在kernel启动报windows sandbox failed / helper_unknown_error: setup refresh had errors，未进入应用/新截图；未发生自动审批拒绝，也未使用其他浏览器控制绕过。
- 下一具体动作：继续 M2-01 Android Web Share Target 与 File Handling，然后 M2-02 首次引导/安装、M2-03 环境检测；同时补 M2-15 解压与备份安全限制。工具恢复后按ISSUES.md补当前完整浏览器与真机回归。真实设备/HTTPS、7天自用、20种真实EPUB和M3/M4账号/域名/签发密钥/真实发布仍为外部条件，不伪造Git作者或验收结果。

## 最新检查点：系统分享与文件打开接收（2026-10-02）

- 上一 Goal 轮和本轮均有实质代码及自动验收进展，完整目标保持 active，没有缩小目标，也未进入无法推进的 blocked 状态。M2-01本轮代码接入，真实Android系统分享菜单、浏览器权限/后台启动和File Handling支持系统仍未验收。保持单主代理，无模型切换/委派，PRD/DEV_PLAN未更改，Git作者与外部条件仍如前述。
- Manifest新增share_target：POST+multipart/form-data，title/text/url/files，EPUB/TXT的扩展名和MIME均声明；file_handlers指向#/incoming，包含两种格式。src/sw.ts在离线GET路由前精确拦截同源同作用域share-target POST；workers/shareTarget.ts按实际流字节限101MiB（含开销），不信任Content-Length，字段规范化后先提交IDB，再303跳回带UUID的接收页。空/坏格式、超限、存储失败跳对应提示，不把内容转发到服务器。
- src/db/incoming.ts使用原生IDB打开现有jingye数据库与blobs表，不带Dexie进入SW、不新增DB版本；首次库不存在时终止原生升级并提示先打开应用初始化，避免建立不兼容的空库。打开超时10秒、连接versionchange关闭、事务提交后返回。暂存ID为incoming:<encoded-scope>:<UUID>，按作用域列出，只删除指定记录；原文件用multipart Blob保留字节/类型/文件名，大小写敏感边界独立保留，文字/标题/错误元数据独立存储。
- 首轮测试暴露再次multipart编码将LF变CRLF，已改为文字元数据独立存储；严格文字/原文件字节断言保持，不靠更弱断言通过。接收规范化支持路径清理、按MIME（含charset参数）给无扩展名文件补.txt/.epub；显式不支持扩展名交给正式导入器报错，不把任意文件强转。有效总内容100MiB、文字50MiB，单文件原导入器仍限制50MiB。
- app/incomingJobs.ts复用importBatch+正式importText，单文件失败继续，同份任务重挂载共用一次解析/提交并释放旧进度监听；成功/已有书从暂存移除，只留失败原文、未保存文字与读取错误。失败可重试，清理失败留原文再去重。pages/Import/IncomingPage.tsx显示逐本结果与重试/放弃，单本成功或重复直接阅读，多本显示结果，仅文字直接进PastePage预填。#/incoming及#/paste-share路由优先于autoResume，不当作已有文稿ID。
- 混合分享文件/文字分别处理：PastePage保存失败不消费暂存；保存成功或正文重复后才清理文字，仍保留未导入文件。title/HTML/URL只作纯文本，不请求网页或执行HTML。书架显示待处理分享数量，可继续处理；正常编辑文稿或处理中遇到新文件不会被覆盖。clearAllData的既有七表事务会清理暂存；正式备份只收书籍原文，不将待导入分享混入书籍/进度/笔记。
- app/fileLaunch.ts按能力检测launchQueue并安装consumer；启动串行获取File，单个句柄读取拒绝列出错误但保留其他文件，前一启动存储失败不阻断下一启动。App在主库初始化后安装消费者，接收到的新数据持久化后才导航；处理分享/编辑页期间的新文件留在书架待处理。官方文档目前注明File Handling主要面向桌面系统，Android以已安装PWA的Share Target为主要入口，iOS保留选择文件；未声称任何真实系统已验证。
- 自动验收：38文件154项全通过，pnpm lint及pnpm build通过，新增17项覆盖原生IDB与Dexie重开互通、原文件/文字/边界、作用域和单份删除、同步写入失败原文保留、初始化失败不建库、清空和备份排除暂存、POST/303/空输入/存储错误/实际流上限/伪造长度、部分成功重试、重挂载、文字/混合分享、MIME/路径、文件队列与读取拒绝、UI自动跳转/忙碌禁用/预填/保存失败保留。happy-dom测试不证明真实系统菜单或实际分页。
- scripts/pwa-check.mjs在Node VM执行实际dist/sw.js，保留原有10资源断网检查，增加断网POST分享（文件+文字+外部URL）：真实multipart请求、原生fake-indexeddb提交后303、暂存原文件字节一致、链接无外部请求。Manifest共享参数与File Handling格式声明同时检查；不是浏览器或手机测试，不替代实际解析Worker通信。该测试不读取真实用户数据库。
- 无新增依赖。15:33最终Node gzip主包73.63KB、CSS4.23KB、解析Worker68.49KB、SW3.29KB，总计149.64KB，全部JS/CSS仍低于150KB，余量仅约0.36KB。Vite报告主包74.26KB/CSS4.24KB，仍不混合口径。后续引导等新增界面需先做生产构建体积优化；不漏算Worker、不修改预算、不将延迟资源排除总额。
- 浏览器重试getTab浏览器2、127.0.0.1:5173/?theme=night仍在kernel启动即报windows sandbox failed/helper_unknown_error/setup refresh had errors，无新UI截图，未发生自动审批拒绝，未绕用其他浏览器控制。新增真机待办已入ISSUES.md。开发与预览服务沿用既有进程，未因工具观察失败重复重启。
- 下一具体动作：先测量生产主包/Worker的压缩与构建选项并优化体积（M2性能范围），再继续M2-02三屏首次引导/安装、M2-03环境检测与其余M2任务；不是将M2-09大书性能指标标为完成。工具恢复后按ISSUES.md完成浏览器回归。完整Goal的M0/M1真机、七天自用、20种真实EPUB、M3/M4账号/域名/签发密钥/渠道发布/用户反馈均保留，不能伪造通过或Goal完成。
- 交付前交互审查新增修复：backup/restore.ts的overwrite现在在同一七表事务中保留incoming:开头的暂存Blob完整记录（含文字/边界元数据），替换书架不会误删尚未处理的分享；clearAllData仍清理全部。新增实际原生暂存→覆盖恢复→读取文件/文字→清空测试，未保留无关过期Blob。15:36最终lint、38文件155项测试、build及真实SW离线/分享检查全通过；Node gzip主包73.64KB/CSS4.23KB/解析Worker68.49KB/SW3.29KB，总计149.65KB，当前余量约0.35KB。此最终记录优先于本段前面的阶段中间数值。

## 最新检查点：引导、环境检测、动效与单手模式（2026-10-02）

- 完整Goal仍为active，已核实工具状态；中断后按用户“继续”恢复工作。目标没有标为完成，也没有缩小到已做功能。保持同一主模型、单代理，不委派、不切换模型；PRD/DEV_PLAN原文保留。Git仍为未提交的main，未伪造作者或发布。
- 用户本轮明确“超过一点点也无所谓”：150KB源于PRD8.1的首次加载性能目标，现按用户指令作为参考。scripts/bundle-size.mjs仍递归测全部JS/CSS、含解析Worker和SW，超出提示增长，不再设置失败退出码；功能/类型/离线检查依旧必须通过。README和ISSUES已记录该长期偏好，不能按旧检查点的硬阻断继续浪费开发时间。
- 体积实验：全局Terser使产物增大到156.88KB（Vite8的Worker路径并未同样压缩），已经回退。官方Dexie同版本现代ESM入口满足当前ES2022/Safari16.4基线，原有155项迁移/事务/恢复回归通过，先将总包从149.65KB降至147.75KB。预压缩Dexie、JSZip源入口及额外Worker压缩试验均未保留；无新增依赖，没有修改或裁剪第三方解析器以节省体积。
- 主页面分享暂存改用现有Dexie事务，SW仍用原生IDB。新增db/incomingRecord.ts共享作用域键及multipart编解码，db/incomingClient.ts提供主线程适配，db/incoming.ts保留原生连接/超时/初始化保护。未修改表版本、键或文件/文字格式；新增双向适配器往返、精确字节与LF、失败不覆盖、作用域/单份删除回归，原有覆盖恢复保留分享及清空测试继续通过。
- M2-02：App首次载入后显示≤3屏引导（本地数据/备份、添加到主屏幕、系统勿扰），跳过和完成均事务保存onboarded；设置可用原生dialog复看。保存失败明确说明并允许本次先阅读，不虚报标志保存。保留显式分享/续读路由，阅读器在引导结束后才挂载；不自动切系统勿扰。main.tsx渲染前捕获beforeinstallprompt，只在用户点击时同步调用prompt，一次事件只消费一次。取消/失败、新事件、appinstalled、standalone、等待及销毁/开发HMR处理齐备，选择accepted仅提示已提交，不冒称完成安装。iOS使用本地SVG/PNG三步图示，已安装仍说明从“文件”导入。
- M2-03：app/environment.ts只在本机解析UA和触点，微信/QQ内置浏览器提示系统浏览器；不把MQQBrowser独立浏览器或普通Mac误判。iPhone/iPad/iPad桌面UA识别旧于16.4的版本，未知版本不武断归为旧系统。引导、书架、设置显示可关闭提示，不上传/存储UA。媒体查询兼容addEventListener、旧addListener和能力缺失，避免支持语法的旧环境在安装检测时先抛错；不是承诺所有旧iOS可运行。
- PRD6.9安静提示：新reading.quietHint默认true，Reader显示“已进入安静阅读”两秒，可在菜单关闭/本书保存，设置页可更改默认值；定时取消、卸载清理，减弱动态无淡入。旧DB/备份缺该字段补默认，false值往返保留，非布尔备份值拒绝；不增加数据库/备份版本。
- M2-04：reader/PageMotion.ts采用WAAPI，先保存目标静态位移/锚点再覆盖视觉；220ms平移、160ms淡入、none静态。跨章旧页仅临时可见、仍inert/aria-hidden，完成/取消隐藏；快速连翻、布局变化、手势、减弱动态与销毁取消动画，不重建正文。finished Promise取消拒绝已处理，避免未捕获异常。菜单180ms、抽屉240ms关闭过程保留但不可访问/交互，然后卸载；usePresence快速重开取消旧计时，系统减弱动态实时立即卸载。CSS总降级覆盖菜单、抽屉、安静和标注等动画。菜单层级与点击区域已审查，避免透明动画层遮住全文或单手按钮盖住菜单。
- M2-05：ReadingControls增加翻页动效/点按模式与说明，全局/单本沿用原保存机制。单手模式两侧点按向前、左上角56px区域与52px语义按钮向后，中间菜单；横向滑动/键盘方向、长按选区和竖向取消保留。按钮事件不再进入正文手势，避免双翻。首/末页无可翻内容及章节读取失败后拖动归位的遗漏已修复；初次加载、跳转和旋转不应用翻页动效。
- 自动检查新增34项/7文件（累计45文件189项），覆盖引导持久化/跳过/设置复看/保存失败/路由保留、iOS图示及安装后说明、环境样本、安装生命周期、旧媒体监听、安静计时与旧数据、适配器互通、动画/跨章可访问性/取消/能力失败、浮层结束与实时减弱、单手规则、首尾/连续跨章/加载失败/销毁以及备份布尔校验。ReaderEngine测试明确使用两页几何模型和字体就绪模拟，不能证明真实CSS分页或帧率。严格类型检查发现的测试回调/Preact参数及Dexie Promise类型已修复，6个取消动画未处理拒绝也已修复，最终无未处理错误。
- 最终生产产物Node gzip：主包75.26KB、CSS4.84KB、解析Worker68.51KB、SW3.33KB，总计151.93KB（约比参考值多1.93KB），含全部资源。Vite主包76.00KB/CSS4.85KB，与Node口径不混算。pnpm lint、pnpm test、pnpm build及check:pwa通过；真实dist/sw.js模拟Cache/IDB离线和POST分享仍10份独立资源逐字节一致。仅证明产物和模拟API，不冒称浏览器安装/实际Worker通信通过。
- 既有5173开发和4173正式预览继续HTTP200，manifest/SW MIME正确，无重复重启。浏览器getTab按浏览器2重试仍在kernel启动报windows sandbox failed/helper_unknown_error/setup refresh had errors，未进入新UI、无新截图；没有审批拒绝，也未换浏览器工具绕过。新引导/浮层/动效/触摸/主屏幕安装、减弱动态实际系统、原生选区及55fps仍列入ISSUES待验收。
- 下一具体动作：M2-06用原文件手动切换TXT编码并保留百分比/处理标注，M2-07系统深浅主题，M2-08本地备份提醒，然后继续其余M2及具备前置条件的M3/M4。大书指标、M0/M1真机、7天真实自用、20种真实EPUB和账号/域名/密钥/真实发布反馈条件继续按事实保留，不能将功能自动检查扩称完整阶段或Goal验收完成。

## 最新检查点：手动编码、系统主题与备份提醒（2026-10-02 16:38）

- 完整Goal保持active，仍按用户授权由同一主模型单代理推进所有剩余任务，不委派、不换模型、不逐项请求验收。150KB继续为参考，本轮全部JS/CSS共155.54KB；未为小幅超出追加复杂压缩，不修改PRD/DEV_PLAN原文。Git仍为未提交main、作者与GitHub条件未配置，不伪造身份或提交。
- M2-06：新增parsers/recodeText.ts与pages/Reader/EncodingPanel.tsx，TXT菜单选择UTF-8/GB18030（兼容GBK）/Big5/UTF-16 LE/BE。原文件在Worker严格解码并核对SHA256，先提供500字预览再确认；取消或卸载中止RPC、清除超时/监听并终止线程。runWorkerTask增加可选AbortSignal和一次完成保护，既有导入/备份API兼容。
- db/recode.ts以六表事务核对当前书籍内容版本与原文件，原子替换章节、摘要、编码和按百分比重新计算的Locator。保持指纹、Blob字节、书名、导入时间及事务内最新排版；写入失败全部回滚。新增contentRevision（旧书默认0），Reader按ID+版本重新挂载，旧debounce/pagehide/unmount的进度保存被事务版本保护忽略，旧页面新增书签/划线也拒绝过期版本；菜单在初始位置就绪前禁用编码入口。
- 标注处理采用保守定位：完整章节标题与段落均未变时保留；改变章节的书签/划线/笔记不删除，标记unanchored，保留摘录、笔记、ID、原位置与时间。待确认记录不在正文渲染、页角显示或跳转；笔记单独分组，可编辑和Markdown导出，书签可查看/移除。不依赖短句搜索猜测新位置，也不在再切回后自动恢复不可靠锚点。备份白名单验证新布尔字段，待确认旧章节即使超出新章节数也可保存恢复，但仍验证书籍引用和合法数字；有效定位仍严格检查原文。
- 完整备份重解析已沿用meta.encoding；本轮修复轻量备份占位TXT补导：如果自动识别与已存手动编码不同，在同一解析Worker重新读取原文件按已选编码解析，再补全，不覆盖原进度/笔记/版本。人为GB18030乱码→Big5正确、UTF-16端序导致章节数改变、0/37.5/100%和代理对边界均有自动证据。
- M2-07：app/themePreference.ts区分存储偏好与显示主题，watchAppearance监听系统深浅并同步CSS数据及theme-color，离开/关闭时移除监听。跟随开关在设置页，全局或单本记住所选lightTheme，手动夜读不丢浅色历史；旧设置无字段时首次夜读仍记住已有浅色，单本继承全局浅色，完全无历史回退米白。系统变化不写数据库或改变阅读锚点；跟随时排版面板展示浅色选择，备份保持浅色历史和开关。
- M2-08：app/backupReminder.ts按严格超过30天且存在较新划线/笔记判定；未备份从第一条现存标注创建时间计算，无新记录或未来基准不提示。关闭保存baseline+cycle，仅当前30天周期隐藏，新周期/新备份基准重新判断。书架组件逐条读取时间统计，不把全部长笔记留在状态；返回可见、focus和一分钟本地时钟更新判断，卸载取消监听与计时。提示可直达#/settings/backup并聚焦/滚动备份区域，不弹系统通知或发网络请求。
- 备份时间修复：BackupPanel保留snapshot.exportedAt，只有下载/分享成功交给浏览器后记录该时间。只生成、取消分享或下载抛错均不记成功；稍后下载旧快照不能推进时间掩盖新笔记，也不会回退更晚备份，设置事务保留并发其他字段。仍提示用户确认文件实际保存在浏览器之外，不把API返回当成文件系统验收。
- 自动检查：本轮新增31项/8文件，累计53文件220项，无未处理错误。覆盖解码与原文件、章节变化/近似进度/UTF-16边界、事务回滚、旧保存及预览拒绝、标注去重隔离/保留/备份、Worker RPC取消释放/补导、预览确认和保存失败重试、系统深浅/颜色/监听销毁/能力缺失/旧设置历史/持久化、提醒边界/周期/日期/关闭失败、生成与下载快照时间、直接备份焦点/设置开关。界面使用happy-dom、线程使用RPC模型，不证明真实Worker通信、CSS分页或系统界面。
- 最终pnpm lint、pnpm test、pnpm build与check:pwa通过。Node gzip主包78.63KB（index-C1EKI4l9.js）、CSS4.88KB（index-BDIlQGQc.css）、解析Worker68.70KB（parse.worker-BnbZL-Gr.js）、SW3.33KB，总计155.54KB；Vite单独报告主包79.43/CSS4.89，不混算。无新增依赖，两个Worker和全部JS/CSS仍计入。实际dist/sw.js在Node VM中10资源逐字节离线检查及本地分享POST/303/fake-IDB提交通过，无外部拦截，只允许显式更新；不是浏览器安装证据。
- 5173开发与4173生产预览沿用已有服务，HTML/manifest/SW全部HTTP200且MIME正确。浏览器复查getTab在kernel启动仍报windows sandbox failed/helper_unknown_error/setup refresh had errors，未进入应用、没有新截图，也没有自动审批拒绝。未用另一控制方式绕开故障；真实乱码切换/系统深色/备份日期与下载分享、新界面和跨标签数据验收继续记在ISSUES。
- 下一具体动作：M2-09检查ReaderEngine/ChapterWindow/目录及书架，实现>5万字章节分块、1000章/100本基准、虚拟化及debug性能记录；实际中端机1.5秒/滚动/30分钟内存仍需手机证据。随后M2-10兼容与增量解压/字体混淆处理、E2E/截图、同源可选字体、关于/隐私、安全及符合条件的M3/M4。20本真实EPUB、7天自用、HTTPS/手机、Git账号/域名/商业密钥/发布与反馈继续按事实保留，当前仍有可独立推进工作，未达到Goal完成或blocked条件。

### 2026-10-02 17:07 检查点（M2-09 大书性能代码与模型验收）

- Goal保持active，继续用户授权的剩余计划；单代理、不换模型，不为150KB参考值中断。无新增依赖；数据库与持久化Locator格式不变。
- reader/chunks.ts为超过50000正文UTF-16单位或512段的章节生成原文范围，每块≤12000单位/128段，优先完整段落，单个长段可拆但不拆代理对。EPUB树截取保留强调/注音/列表/对齐及本地图像，边界图片/空段只归属一个块，未编号分隔/缩进仍按原顺序保留一次。
- ReaderEngine按需获取完整章节，章节源缓存至多当前与相邻逻辑章；ChapterWindow扩展键类型，正文DOM只保留当前与相邻块。Locator、选区、书签/划线始终使用原段落编号+全段偏移，片段DOM增加data-char-start；同段不同块的书签不会误算为本页，已存跨块划线只绘制当前交集。重排/百分比跳转/反向翻页保持原锚点，资源释放可取消且幂等。
- 长章完整页数逐块在空闲时测量，临时DOM测完立即释放，最多额外一个测量块。未测完只显示真实百分比，不展示不准确的章内总页数。导航/排版/关闭取消测量，后台停止并在可见时继续；等待期间已预排的邻块不重复构建；非取消失败块跳过，排版配置变化清空失败标志后可重测。返回缓存及迟到任务不能重建已关闭正文。
- Bookshelf/VirtualShelf只挂载视口+预读行，封面随卸载释放URL；完整目录/章节摘要逐条投影后不保留在书架状态，打开书籍重新读完整记录。目录沿用56px虚拟行，书架176px；二者支持方向键/Home/End/Tab跨窗口和聚焦行保留，aria-posinset/setsize对应完整列表，长书名仍保留完整可访问文本。未改变存储中的书籍字段。
- app/performance.ts在开发?debug=1记录读取、分块排版、正文就绪、书架查询/视口及目录视口，输出已有本地日志面板并马上清理Performance条目；生产构建的performance.mark/measure和“性能 ·”日志被移除。onIdle使用原生idle及可取消定时后备，没有新增运行依赖或网络请求。
- pnpm check:performance及artifacts/performance-model.json提供可复现模型：Node24.17.0/happy-dom/fake-IDB/390×844/两页几何，原创9951892-byte千章样本。独立记录解析10.41ms、入库80.92ms、模型首章就绪8.88ms、100次翻页119.54ms、百书查询124.81ms/首屏组件11.10ms；首次只读取3章，100次后53次读取、峰值3个阅读DOM，百书首尾均8行、书架驻留摘要0。数值只代表模型各路径，不含真实Worker/CSS/绘制，不宣称PRD性能通过。旧M0-10的11417891-byte桌面UI导入362ms路径与样本不同，不据此宣称速度提升。
- scripts/performance-fixtures.mjs生成同一千章文本、12万字单段、1000段长章及100本不同原创TXT到已忽略test-books/performance/，从空环境可复现，不含真实用户或版权书籍。
- 新增19项/8文件，累计61文件239项全部通过，无未处理错误；覆盖无损/代理对/空段/EPUB树与图片、片段选区和跨块mark、定位/翻页/缩放/书签/百分比、闲时失败/后台/关闭、百书投影不改原数据、虚拟书架/千章目录的键盘与焦点/动作ID/长按取消/封面释放、计时清理与模型缓存。模型不证明真实分页。
- 最终pnpm lint、pnpm test、pnpm build及真实dist/sw.js的Node VM离线/分享检查通过。统一Node gzip主包82.04KB（index-LqGxDjKN.js）、CSS4.97KB（index-D8dyQPLi.css）、解析Worker68.70KB（parse.worker-BnbZL-Gr.js）、SW3.33KB，总159.04KB，含全部JS/CSS；150KB仅参考。Vite主包82.88/CSS4.99的独立口径不混算。
- 浏览器两次重试仍在kernel初始化失败：先trusted Node process exited unexpectedly，再明确windows sandbox failed/helper_unknown_error/setup refresh had errors；未进入页面，无新真实截图/布局证据，无自动审批拒绝。M2-09真机1.5秒/滚动/55fps/30分钟内存、跨块行尾和图片/原生选区继续在ISSUES待验收。
- 下一具体动作：M2-10检查EPUB解析与JSZip流接口，限制增量解压及总量、区分规范字体混淆与DRM、补原创兼容样本和COMPAT记录（20本真实不同来源仍未具备）。同时复用ZIP限制加固备份metadata及CRC（M2-15相关），随后M2-11～15及符合条件M3/M4；所有外部验收门槛保持，仍有可独立推进工作，不将Goal标完成或blocked。

### 2026-10-02 18:04 检查点（M2-10 兼容修复、解析版本与备份保护）

- 上一Goal执行有M2-09代码/模型验收和检查点，属progress；本轮在中断后核对实际文件继续开发，也有实现及证据，完整Goal仍active。保留主模型单代理与150KB参考偏好，无新增依赖。M2-10尚未满足20本真实来源和视觉验收，不能标整阶段完成。
- 新parsers/zip.ts的BoundedZip以JSZip公开internalStream读取Uint8Array：输入50MiB、加载后最多20000条、单条50MiB、预检声明及累计实际解压150MiB。逐块检查声明/实际/累计大小，失败暂停输入、清除已积累分块并阻止后续读取；重复读取也计费，未引用文件流式验证后丢弃。拒绝目录穿越、绝对/盘符/反斜线/控制字符路径，非空资源按增量CRC32校验。未启用会先全量并发解压的loadAsync(checkCRC32)。
- ZIP限制如实保留：校验元数据使用JSZip3.10.x _data受守卫字段；JSZip会把声明为空的文件归一化并丢失原CRC，因此当前不能验证原始空条目CRC。条目数量检查发生在JSZip目录载入后；目录预扫描、重复归一化条目、ZIP64边界和完整ZIP审计继续列入M2-15。备份archive.ts尚未复用新ZIP限制，backup.json和完整恢复内存仍待加固。不能将本轮称完整安全审计或150MB进程内存验收。
- EPUB encryption.xml现在先识别算法：支持仅IDPF http://www.idpf.org/2008/embedding 的字体混淆；核对OPF字体MIME、实际文件、非spine/非nav，忽略包内字体，继续系统字体。EncryptedKey、AES、未知/混合算法拒绝；空或错误加密信息明确报错。Adobe RC混淆尚未支持，不误称所有字体混淆均兼容。依据W3C EPUB3.3字体混淆规范；未执行解密或载入第三方字体。
- normalize.ts新增v2结构规范化：混合li/blockquote中段前段后文字成为可定位段落；祖先容器和行内ID映射首个对应段落；表格保留caption并按行使用单元格分隔，诗歌br/对齐保留，pre使用受控pre-wrap。仍剥离脚本/事件/网络资源，复杂书内CSS及竖排统一为阅读器横排。decodeXml支持UTF-8、UTF-16LE/BE的BOM和XML字节签名，非法序列拒绝。
- 避免规范化改变旧数据位置：Book新增可选parserVersion，新导入EPUB保存2；旧书无字段视为1。sanitize.ts保留v1规则，parseFile/Worker传递版本，完整恢复和轻量占位补导按原版本解析。saveBook事务再次核对占位版本，防解析期间并发恢复造成旧章节覆盖新位置。不同解析规则的同指纹书籍拒绝直接合并/轻量覆盖，提示先备份本机再用完整备份覆盖；完整覆盖采用备份对应规则。原文指纹和内容版本不变，不自动改旧标注。
- 备份schemaVersion升为2，当前validate同时接受旧v1并规范化到v2，parserVersion仅接受1/2；v1携带新v2段落规则会拒绝。旧应用因版本不支持而拒绝新备份，避免忽略新字段后按错误规则恢复。新增回归覆盖v1/v2 ZIP往返、数据库恢复、同指纹冲突回滚与完整覆盖、旧EPUB Worker补导、事务并发保护。
- compatFixtures.ts包含20种原创结构，兼容单测逐个核对正文、目标ID和目录。scripts/compat-fixtures.mjs已生成test-books/generated-compat/case-01～20.epub与test-books/COMPAT.md；ZIP时间固定，指纹可复现，COMPAT首次创建后不覆盖人工记录。全部合成，不计作20本不同来源真实EPUB。真实合法来源可以继续自行查找，不能把缺少现成文件一概当成只能等用户的阻碍。
- 本轮新增38项（5新测试文件及既有测试补充），累计66文件277项全部通过，无未处理错误。覆盖流上限/伪造大小/CRC/路径/重复工作量、字体混淆与假字体/未知加密、结构与UTF16、20个合成样本，以及解析/备份/补导版本。最终pnpm lint、pnpm test、pnpm build通过；实际dist/sw.js在Node VM中10资源字节级离线、分享提交和外部不拦截检查通过。
- 最终统一Node gzip：主包82.37KB（index-DeMnQwPw.js）、CSS4.99KB（index-BNCWv4-X.css）、解析Worker71.13KB（parse.worker-K-Cm0Hjm.js）、SW3.33KB，全部JS/CSS161.82KB。Vite独立报告主包83.21/CSS5.00，不混算。体积仅提示，继续优先完整功能和稳定性。
- CUA本轮重试仍在kernel启动报windows sandbox failed/helper_unknown_error/setup refresh had errors，未进入页面，未得到新截图。没有自动审批拒绝。本轮新增UI样式/真实XML排版、原生选区、实际Worker通信与手机验收仍待；没有用模型测试冒充浏览器。
- 下一具体动作：获取合法公版/开放授权真实EPUB并在COMPAT记录来源、SHA与逐本结果；推进计划明确要求的M2-11/12本地Playwright测试与截图，检查正常项目测试CLI是否可用，使用隔离测试数据/浏览器，不控制用户现有标签。CUA故障不能直接证明测试CLI不可用；如实际执行受限按返回证据记录。随后M2-13字体、14关于/隐私、15安全（含上述ZIP/备份缺口）及满足条件M3/M4。账号/域名/商业密钥、真实手机、7天使用等门槛继续保留，当前没有达到Goal完成或blocked条件。

### 2026-10-02 18:42 检查点（M2-11/12 浏览器验收，M2-13/14 接入）

- 中断前后均有实现和新证据，上一Goal turn属progress；完整Goal继续active。按用户选定主模型单代理执行，不委派、不切换。150KB仅参考，继续计入全部JS/CSS和两个Worker。
- 新增开发依赖@playwright/test1.63.0与独立Chromium153/WebKit26.6引擎；运行包贡献0。playwright.config.ts使用生产预览4180、Pixel7/iPhone14描述符、系统字体、zh-CN、减弱动态、每测试隔离数据；WebKit不等同于物理Safari，DOM Range选区不等同于原生长按菜单。
- M2-11：两个格式×两个引擎的四条真实文件→Worker解析→IDB→翻页→返回并刷新恢复进度→划线/书签→ZIP浏览器下载→清空→完整恢复流程通过；解开下载ZIP核对摘录、书签、原文件。额外覆盖24本书、60章目录的真实高度/行位置与虚拟窗口End导航、Chromium断网重载和离线Worker导入；正常核心流程无pageerror或外部请求。
- E2E发现并修复Preact11数值style不自动补px：划线浮层越界、书架容器/行定位、目录容器/行位置/缩进均改成显式px。原模拟测试未发现，现由真实点击、视口与几何断言覆盖。
- Windows WebKit两项环境限制以独立最小程序实测：临时会话Blob写IDB失败、字节写入成功，持久临时会话均成功（probe-webkit-storage.mjs）；setOffline连最小SW本地生成响应也报internal error，而Chromium通过（probe-webkit-offline.mjs）。测试夹具仅该平台使用每用例独享临时持久目录；额外WebKit离线用例明确skip。正常PWA和字体测试保留SW；错误字节注入用例关闭SW以可靠路由。不能宣称iOS真机离线通过。
- M2-12：6张Windows基线已逐页查看，固定原创EPUB/默认设置，等待短暂提示消失、零像素差异。pnpm check:pagination把真实paginator行高乘1.15，两个引擎均因toHaveScreenshot像素差异失败；随后源码原字节恢复、构建与两个截图用例通过。artifacts/pagination-regression.json记录检出/恢复和源码SHA。后续e2e不更新基线也通过，不把自动生成基线算成独立证明。
- M2-13：官方霞鹜文楷Regular1.522子集生成public/fonts/wenkai-gb2312-v1.522.woff2，1600452字节/1.53MiB，7707Unicode映射；GB2312、拉丁和标点之外系统回退。源TTF和产物SHA、官方来源、OFL版权及复现路径见public/fonts/README.md和src/app/fontAsset.json。FontTools4.63.0/Brotli1.2.0仅开发环境，运行包贡献0。主名称改为Jingye Wenkai Web Subset/静页文楷，版权许可元数据保留，字体不作为桌面安装文件提供。
- optionalFont.ts无URL字体声明，启动只读本机Cache，只有用户点击才请求同源文件；大小和SHA校验、FontFace验证、缓存保存成功后才显示可用。缓冲字节加载避免隐式联网补字，按作用域缓存、可删除；全局/单本wenkai偏好与备份字段沿用原模型，缓存缺失时系统回退，字体可用状态变化触发Locator保持的重排。字体不随备份迁移。双引擎下载/校验失败重试/缓存重载/删除通过；Chromium断网后字体从缓存加载且不再请求，WebKit仅在线重载缓存通过。
- M2-14：新增#/about、设置入口、package.json版本、隐私本地存储/导出/删除说明、19个运行组件完整版权许可（scripts/licenses.mjs，JSZip选MIT）、同源字体OFL、只含版本和空白问题字段的本地反馈模板。页面与字体截图已查看；链接按主题颜色、44px触控区。正式项目发布许可、公开仓库、邮箱/Issue/打赏地址尚未配置，不伪造外部入口。
- 关于页E2E发现许可导航被SW错误返回首页：offline.respond现对已知缓存静态文件先返回本资源，普通路由再应用壳兜底。新增单测覆盖含查询参数的许可证导航；Node生产SW脚本扩展到12个唯一资源、许可证导航字节一致、可选字体不预缓存及资产SHA。
- 最终触控样式生产构建后的整套E2E复查已结束（session84082 exit0）：15pass/1明确skip，无失败；包含双引擎4条完整阅读备份流程、6张分页基线、字体与关于页。pnpm lint已通过，66文件278项Vitest通过，pnpm build通过；Node生产SW检查12资源、原文分享提交、离线字节、字体SHA和不预缓存均通过。这些检查不证明手机安装或系统菜单。
- 最新统一Node gzip主包85.36KB（index-hWO10gy8.js）、CSS5.06KB（index-mk-65mP3.css）、解析Worker71.13KB（parse.worker-K-Cm0Hjm.js）、SW3.42KB，全部JS/CSS164.97KB。Vite单独报告主包86.25/CSS5.08，不混算。可选字体1.53MiB不在首次预缓存，仍如实列为主动下载资产。
- M2-15已开始：pnpm audit --json返回已知漏洞各级均0，19运行/523开发依赖，原报告artifacts/dependency-audit.json。仅说明此次registry审计无报告项，不代表完整安全加固通过。下一具体动作：CSP meta与_headers、生产控制台检查、运行外部URL用途审查，ZIP目录/空条目CRC/备份metadata限制与大库恢复内存；补20本真实合法来源EPUB及长章图片/字号旋转/手势浏览器回归。手机/HTTPS/7天使用/Git身份/账号域名/签发密钥/正式发布反馈按事实保留。当前还有可独立完成工作，未达到完成或blocked条件。

### 2026-10-02 19:13 检查点（M2-15 安全边界与焦点回归）

- 完整 Goal 保持 active；本轮和上一轮均为 progress，没有相同阻碍连续三轮。保持用户主模型单代理、无委派/路由；150KB 仅参考，PRD/DEV_PLAN 原文未改。还有可独立完成的任务，不标记完成或 blocked。
- CSP：public/_headers 单一来源，productionSecurity 在 build/preview 启用，开发 HMR 不受影响。meta 在脚本/资源之前写入；禁止内联脚本/eval、外部资源连接、object/iframe/base；frame-ancestors 仅在响应头。动态布局仍允许内联样式。预览提供相同 CSP 与 nosniff/no-referrer/DENY；_headers 的 sw.js/HTML no-cache 与指纹资源 immutable 规则已准备，避免全局 Cache-Control 与资源规则合并冲突。外部部署尚未发生，不声称真实托管响应头验收。
- 生产资源全文审查：scripts/security-check.mjs 检查全部 JS/CSS/HTML/manifest、CSP 顺序、无内联脚本、meta/头一致及缓存规则。15处 URL 字符串对应12种已审查用途：XML命名空间、IDPF算法、版权与依赖错误帮助；不删除命名空间/版权，也不声称构建字面零URL。无未审查URL，报告 artifacts/security-resources.json。optionalFont 只引入 file/size/SHA 元数据，来源记录仍在源码与字体README。
- ZIP 原始目录预检在解压/名称规范化前完成：EOCD/中央目录范围和数量、限32MiB目录元数据/20,000条目、安全64位ZIP64、Unicode路径、两份名称/方法/声明一致、流描述符、重复有效名称/穿越/重叠数据、分卷/加密/符号链接拒绝。资源名支持UTF-8或有效Unicode扩展，其他旧编码明确要求重新打包；不是完整ZIP格式审计或真实书籍兼容证明。
- BoundedZip 移除 JSZip 私有_data元数据依赖，直接从原目录保存 CRC 与声明大小。File/Blob 切片读取，压缩输入最多64KiB、输出16KiB，实际累计/单条大小守卫、完整流结束与全部输入消费、空条目和未使用条目CRC均检查。失败清空当前结果，停止整包后续读取；STORE与DEFLATE、普通/ZIP64描述符、Unicode、真空DEFLATE、原CRC错误/伪空炸弹/没有终止块/多余尾字节/重复/头矛盾/重叠/大数等独立二进制样本通过。200kB随机字节两种方法跨输入块字节一致，并实测每次压缩数据切片≤64KiB，不以微小压缩样本代替分块证据。
- 备份使用同一有界读取器，避免完整ZIP原始arrayBuffer；JSON读取前32MiB、ZIP metadata解压32MiB，严格UTF-8；原文件50MiB与metadata大小、CRC验证后返回。读取metadata后包总预算收紧为引用原文件size之和加32MiB，未引用文件同样逐条校验并丢弃。真实浏览器生成的STORE/streamFiles ZIP仍完整恢复，原文SHA、定位版本与主库事务规则不变。全部原文件Blob/PreparedBook和最终导出ZIP仍聚合驻留，DATA-01只部分修复，不声称恒定总内存。
- 运行依赖新增pako3.0.2（带内置严格类型），原因：旧pako1高层API可把缺少终止末块当作结束，新的公开ended/onStart/ZStream.total_in支持完整流边界。JSZip仍导出并带旧pako1，两版如实计入。曾临时安装@types/pako3 stub与2.0.4，最终均移除，未留下开发依赖。20个运行组件的MIT/Apache/ISC/Zlib许可重新生成；pako1/3的源Zlib版权原文从已安装源码/source map保留，关于页补pako致谢。
- 新增双引擎6条安全E2E：恶意EPUB脚本/iframe/form/外图/事件属性净化，正常正文可读，无外部请求和CSP错误；响应头+meta及仅meta均阻止DOM注入脚本、外部fetch与iframe，外部路由未触达。自动夹具对所有正常用例收集CSP事件与相关控制台错误，仅明确负向用例豁免；不能只靠pageerror为空声称CSP通过。
- 首次全量E2E出现WebKit目录End失败（20pass/1fail/1既有skip）。查到原生dialog异步showModal与目录初始居中存在先后竞争；Modal改useLayoutEffect同步打开，目录改layout effect并在显式导航时取消初始帧、立即保留目标行。新增同步模态状态单测，目录测试专门在初次居中帧之前按End并核对滚动/焦点。测试类型错误修复前曾有针对旧dist的2case运行，该结果不作为新代码证据；之后新构建完整套件session11713 exit0：21pass/1环境skip，无失败，6张分页基线未更新。
- 最终检查已通过：pnpm lint、68文件286项Vitest、pnpm build；生产SW Node检查12个唯一预缓存资源、许可导航字节、字体SHA/不预缓存、离线字节、分享本地IDB、显式更新等通过。WindowsWebKit断网模拟skip仍保留，与手机能力分别记录。
- pnpm audit --json复查所有已知漏洞等级均0（20运行/523开发/总543依赖，artifacts/dependency-audit.json）；仅此次registry结果，不代表完整安全审计。统一Node gzip：主包85.22KB（index-ABHx-AM-.js）、CSS5.06KB、parserWorker83.11KB（parse.worker-C_XsSgNf.js）、SW3.43KB，全部176.81KB，较上一检查点164.97KB增加11.84KB，包含新版解压与目录安全逻辑。Vite主包86.09/CSS5.08不可混算；可选字体另为1.53MiB主动下载。
- Git仍unborn main、全部工程未追踪、无作者/gh登录/远程；没有伪造提交。CUA没有新重试成功证据；项目Playwright正常。暂无活跃E2E/检查会话，结束前再次执行工程必需检查；源码安全说明在SECURITY.md，待办已更新ISSUES.md。
- 下一具体动作：M2-16用本地隔离服务器切换两份真实生产产物，旧客户端阅读不被更新打断、回书架显式点击更新、数据库内容与进度/笔记保留、关闭自动检查/手动更新行为；不以mock生命周期代替真实SW。随后补20本合法真实来源EPUB及长章/图片/字号旋转/手势实际浏览器回归，再处理DATA-01大库内存。真实手机/HTTPS安装、7天自用、作者账号/域名/正式发布许可与反馈、商业密钥等外部门槛继续保留；M3需M2全部满足，不提前公开发布。

### 2026-10-02 19:52 检查点（真实更新与首批真实EPUB）

- 本轮和上一轮均有实质进展，完整Goal仍active；没有同一阻碍连续三轮，不标记complete/blocked。用户自行阶段验收与150KB参考偏好继续有效；单主模型，无委派/路由。PRD/DEV_PLAN原文未改，Git仍unborn main、无作者/登录/远程，不伪造提交。
- M2-16：globalSetup只复制src/public/必要构建输入到忽略的.e2e-update/<UUID>，副本版本0.0.1-e2e-a/b，项目原版本未改。两次真实Vite生产构建的主包和SW SHA不同；每测试独立localhost HTTP端口和浏览器数据。服务器切换实际产物/503，真实SW安装、等待、激活与HTTP不mock；仅窗口时钟快进。三场景×两引擎6条覆盖阅读中后台下载不刷新/书架显式启用、关闭定时检查但手动可用/下载失败不破坏旧版/修复重试、另一标签激活后旧阅读页继续翻页。
- 更新前后用原生readonly IDB比较books/chapters/progress/bookmarks/highlights/settings/blobs七表完整记录，原文件单独SHA-256；笔记/书签/页码和设置重新打开验证。真实全文报告artifacts/update-regression.json；pnpm check:update单独执行，完整e2e成功后可--collect汇总本轮六份证据，不等同新跑测试。HTTPS生产部署和物理手机分别保留。
- 完整回归首次新增多标签页用例出现Chromium七表时间差，只有lastReadAt/updatedAt变动：重开阅读后的500ms真实进度写入尚未落库。修正为快进窗口1000ms并等待原生IDB更新时间超过重开前值，再取基线；没有删字段或放宽七表比较。修正后全套通过。新夹具也观察已经存在的page，并清理监听。
- 真实兼容基础：scripts/real-epub-sources.json记录已核验官方下载/来源/开放依据；fetch-real-epubs.mjs最大50MiB、格式头/哈希验证，不改书籍字节。取得Gutenberg《九命奇冤》228220字节/SHA e239a896d71428c6b904f45b7e5700173e3c0277a47a873941476173b72493f7；作者官网Eloquent JavaScript 1376256字节/SHA d822672700433adc6202f9c04d74a0099a9699c31aaf5f6836a33176093554d0。官网首页第四版，但EPUB实际2018年第三版，记录按OPF/内容核对修正。test-books/全部忽略，原始版权与许可保留，不随应用分发。
- 失败来源不计数：Standard Ebooks先返回下载中转XHTML，读取其实际?source=download地址后传输60秒超时；BCcampus下载403网站验证页。未把HTML当书或宣称解析失败。独立playwright.compat.config.ts的缺文件4条明确skip；目前2本、2个制作来源，未达到20本。下载工具联网只用于测试，应用运行不请求这些来源。
- 真实文件发现并修复两项：Gutenberg nav只列许可页，v2解析对未列出的可读spine节补默认目录，保留原entry相对顺序/fragment/正文偏移，v1行为不变；新增纯解析回归比较段落与anchors。Eloquent链接/span图片段保留了首行缩进，图像越出分页边缘；renderNodes按实际无文字且含图片的段标记imageOnly，CSS无缩进/居中/不拆页，存储文字与定位版本不变。
- 新增image-layout.spec.ts使用仓库原创PNG/EPUB，两引擎前三页、28px字号与横屏窗口几何通过。测试先打开排版面板、Android按应用入口退出全屏再调窗口，避免把隐藏控件或Browser.setWindowBounds全屏限制当产品布局故障。真实书籍兼容测试改为指定正文目录项（含实际“跳转到”accessible label），不以许可页作正文证明；4条真实Worker/IDB/目录/翻页/重载/文件SHA/图片边界通过。四张修复后截图已查看、哈希记录artifacts/compatibility-progress.json及test-books/COMPAT.md；只是选定页面审查，SVG包装封面/矢量图和整本仍未验收。
- 最终源码检查：pnpm lint通过，68文件287项Vitest通过，strict TS+pnpm build通过；最终新dist全套session11801 exit0，30条中29pass/1既有WindowsWebKit离线模拟skip，6张分页基线未更新。独立真实兼容同会话4pass/4外部样本缺失skip；此前原创图片两引擎也通过。Node实际生产SW仍12资源/字节/许可导航/字体SHA/分享POST本地IDB/明确更新通过；CSP资源15处惰性URL用途审查通过，无未审查URL。没有新增依赖。
- 当前统一Node gzip：main85.24KB（index-YZfHKIzi.js）、CSS5.07KB（index-BYqrjGW5.css）、parserWorker83.21KB（parse.worker--Bs3Fke4.js）、SW3.43KB，总176.95KB，较上轮176.81增加0.14KB，含全部JS/CSS和两个Worker；可选字体仍另列1.53MiB。下载样本和测试代码不进入浏览器交付包。当前无活跃E2E/下载进程；CUA没有恢复证据，项目Playwright正常，结束前整理文档并重核格式。
- 下一具体动作：先为SVG包装的本地光栅封面/插图设计安全降级，同时保持已存parserVersion1/2 Locator兼容，不直接改变旧段落编号；再增加诗歌、注释、表格和日文竖排等合法真实EPUB，至少20本且制作来源多样。继续长章跨块/定位、编码/分享/系统主题/备份提醒真实浏览器回归和DATA-01聚合内存。物理iOS/Android、受信任HTTPS安装/离线/原生选区、7天自用、Git身份/发布账号域名/许可联系方式/商业密钥仍是实际外部门槛，M3不提前发布。

### 2026-10-02 20:28 检查点（SVG v3与Cloudflare上传）

- 最新Goal明确为M0/M1/M2与Cloudflare部署，M4不在范围；保持active。主模型单代理，用户允许超过150KB参考目标。最新授权允许此次部署，不把M2、完整M3或真机验收标为完成。Git仍unborn main，无提交/作者/远程；Wrangler会报告HEAD不存在，但已完成静态上传，没有伪造commit hash。
- EPUB新导入parserVersion=3：SVG包装中的已知本地光栅图转普通图片，基础静态矢量重建为image/svg+xml Blob。白名单图形/数值/本图ID引用，简单样式转属性；禁止脚本/事件/外链/动画/foreignObject/未知命名空间，use同图展开且循环停止；源/结果1MiB、节点20000、深度64、样式1024。复杂混合图层/滤镜/嵌入字体不完整支持。Object原型属性以Map规则拒绝；不向应用DOM插入原始SVG。
- 新图片段改变位置，旧书按v1/v2补导/重解析，不自动迁移；备份schema3向后读取1/2，同指纹不同版本拒绝合并。单测核对v2/v3位置差、进度/书签/笔记完整保留及旧备份兼容。双引擎原创SVG用例通过真实Worker/原生IDB、3图片解码/边界、目录/书签、ZIP清空恢复、全记录及Blob SHA比较。原文件ZIP只保存字节、不保留浏览器File MIME；派生图片MIME严格保持。
- 新增官方Gutenberg《唐诗三百首》99001字节，SHA4284f4c3ce65a33c981eb490f9f24c0b817ebdd946821056092f0c79b5728cef，原档案字节不改且仅本地忽略目录。当前3本真实书、2个制作来源，不达到20本。真实兼容6通过/4缺失skip；Eloquent当前DOM章节21个净化SVG资源已解码并核对边界。六张最终选定截图及Gutenberg包装封面已查看；Eloquent截图是光栅树，iPhone唐诗截图仍是metadata/title，不据此宣称矢量保真、诗歌正文或整本视觉完成，scope记录在artifacts/compatibility-progress.json。
- 默认完整E2E最终session15500：31pass/1既有WindowsWebKit离线模拟skip，6张分页基线未变；真实SW更新6份报告已收集到artifacts/update-regression.json。真实EPUB另6pass/4缺失skip。下载CLI支持按ID补取样本，刷新已存样本来源/哈希但不重复下载；缺失未选来源保留失败事实。
- 新部署前复核session66038：pnpm lint通过，69文件295项测试通过，strict TS及生产build通过；新增上传清单最初未允许parse.worker文件名中的点，已修正规则再核验16个静态文件/2239512字节。安全资源检查15惰性URL/12用途通过，SW12个唯一预缓存、字体SHA及不预缓存、许可导航字节、分享POST本地IDB和显式更新通过。Node gzip main85.27KB/CSS5.07KB/parser85.63KB/SW3.43KB，总179.40KB；可选同源字体另1.53MiB。无新增依赖。
- CUA Chrome工具仍失败windows sandbox/helper_unknown_error，没有成功控制用户Chrome；采用已安装并已登录的Wrangler4.110.0（pages写权限），未读取或输出凭证。已列出现有项目，新增jingye-reader并只上传dist，未覆盖无关站点；production分支main，实际上传完成URL https://f5394de4.jingye-reader.pages.dev，稳定地址https://jingye-reader.pages.dev。仅静态资源，无Functions/外部数据服务/分析SDK；部署清单artifacts/deployment-build.json，.wrangler忽略。
- 线上字节/安全头/缓存验收与独立浏览器HTTPS测试正在运行session81250。尚未将这些待完成结果记为通过。新的playwright.deployment.config.ts不启动本地服务器，使用真实HTTPS、独享临时浏览器数据；不使用用户Chrome资料。M3自动Git部署、自定义域名、开源许可/反馈和渠道发布未完成，用户当前只授权Cloudflare部署。部署项目Direct Upload以后接Git集成需新项目，不能声称CI已接入。
- 下一步完成线上HTTP与真实浏览器结果并修复实际问题，随后继续编码/系统主题/备份提醒、长章和DATA-01大库内存，以及真实EPUB数量。物理手机/7天使用等外部条件仍按事实保留，不把Windows引擎与设备名称当真机。

### 2026-10-02 20:36 检查点（Cloudflare实际HTTPS验收与离线修复）

- 已完成用户明确授权的Cloudflare静态部署，稳定地址https://jingye-reader.pages.dev/，修复版部署https://7a6c7c95.jingye-reader.pages.dev，版本仍0.0.1；没有项目Git提交/CI/自定义域名，不将它们写成通过。Goal继续active，M0/M1/M2的余项未结束，M4不在当前范围。
- 首次线上浏览器验收1pass/3fail：Chromium离线控制器未建立；实测Pages /index.html返回308 Location /，install拒绝redirected后撤销注册。真实托管问题已修复：只对清单index.html直接下载作用域根页，仍以index.html键缓存，其他重定向拒绝不变。新增子目录/原缓存键/断网/其他资源重定向失败与缓存回滚单测，Node产物探针模拟服务器根页索引。
- WebKit首次HTTPS报URL using bad/illegal format：独享临时浏览器探针确认继承代理变量与显式proxy仍失败，只清除该子进程代理变量后HTTPS与SW激活成功。线上config只在Windows WebKit使用该env，不修改用户Chrome、系统设置或默认本地测试配置。fixture把官方launchOptions传给自己的独立持久临时会话；不忽略TLS错误，不绕过CSP或读取用户资料。
- session19770：pnpm lint通过、69文件296项单测通过、strict TS与build通过，16静态文件/2239543字节清单、安全15URL/12用途及真实SW12预缓存/许可导航/字体SHA/不预缓存/分享本地IDB检查均通过。只新增开发脚本与测试，未安装新依赖；全部JS/CSS gzip179.41KB（main85.27、CSS5.07、parser85.63、SW3.44），仍以150KB作参考，字体另1.53MiB。
- 重新部署只上传变动SW，15公开资源按实际HTTPS逐个核对大小/SHA与CSP/nosniff/no-referrer/DENY/Cache-Control通过，报告artifacts/deployment-http.json与deployment-build.json。线上HTTP报告指向此次清单preparedAt2026-10-02T12:30:10.045Z，没有以旧线上构建替代新SW。
- 线上Chromium两项先通过；随后session81645双引擎四项全部通过：实际HTTPS安全上下文、解析Worker/原生IDB、进度重载与书签/原文SHA，SVG3图片解码与几何/目录/ZIP清空恢复。Chromium断网导航并重新开书、翻页通过；WebKit只接受在线重载/激活，不记iOS离线通过。四条正常流程外部请求、pageerror和自动CSP guard均无报错。报告artifacts/deployment-browser/Pixel-7.json与iPhone-14.json。
- 线上原创SVG封面与恢复后的4张截图已查看，光栅图/安全矢量图位于页内；恢复截图有正常短暂安静提示，不作为分页像素基线。原PNG保存在忽略的test-books/deployment-evidence，测试数据只在隔离浏览器与本机。DEPLOYMENT.md记录更新命令、Direct Upload与CI/域名待办，README和SECURITY已按实际证据更新。
- 同一session81645正在继续本地32条全套E2E与六份真实更新报告汇总，待终止结果再记；已有6张分页基线保持不变。最终文档整理后再跑项目必需lint/test/build。真实兼容仍3本/2制作来源，独立6pass/4缺失skip；没有为只改SW重复下载或声称20本完成。
- 下一具体动作：补M2-06实际Worker切换编码/取消与标注保护、M2-07系统主题切换、M2-08真实日期和下载回归，然后长章/分享/性能、DATA-01大库暂存内存和真实EPUB多样性。手机原生安装/分享/选区/飞行模式、55fps/30分钟内存、7天自用继续保留，不把自动浏览器等同于设备。

最终收尾：session81645已经exit0，最终本地32项中31pass/1既有WebKit环境skip，6张分页基线未改；随后check:update --collect成功汇总新UUID396e9d7a-2db4-411d-8654-24461db890b9的六份七表/Blob保真报告。线上四项已通过，当前无活跃浏览器/下载/部署进程。session81851已exit0：最终lint、69文件296项单测、strict TS/build均通过，16上传资产和15HTTPS报告哈希完全一致；随后文档格式与lint再次通过。Goal继续active，不标记完成。

### 2026-10-02 21:03 检查点（M2-06/07/08浏览器验收与菜单修复）

- Goal继续active，范围仍为M0/M1/M2和已授权Cloudflare部署；150KB是参考，主模型单代理，无新增依赖、委派或路由。Git仍unborn main/无作者/无远程，没有伪造提交。真机/7天自用等外部条件与浏览器证据分别记录，当前进展不受同一阻碍反复停滞。
- 新增e2e/preferences.spec.ts五场景×双引擎、playwright.preferences.config.ts和pnpm check:preferences。真实生产解析Worker与原生IDB，正常流程无外部请求/pageerror/CSP违规。公开标题不是可标注段落，选区辅助只遍历[data-p]；笔记保存后重新打开抽屉再下载，不把既定界面流程当产品故障。
- M2-06：UTF-8误选UTF-16LE再恢复，原文件SHA/书籍ID/正文段落/旧摘录与笔记保留，近似百分比偏差<2个百分点；正文改动后的标注保持“位置待确认”，不可误跳但能编辑与真实下载Markdown。双标签旧预览确认/书签写入被版本保护拒绝，未覆盖新正文与进度。取消用例延迟实际Worker模块请求，只观察并转发原生terminate，取消未改变正文/原文件/标注且可真实重试；不声称重CPU解析期间或手机取消通过。
- M2-07：浏览器真实媒体模拟深→浅、theme-color、全局green/本书eink历史和进度、关闭跟随后重载均通过。WebKit390×664展开排版曾实际遮挡返回按钮；菜单改flex纵向布局，顶栏不收缩，底栏在剩余空间滚动。几何与elementFromPoint验证不重叠且返回按钮可命中，继续阅读仍可操作；正文排版无改动。
- M2-08：固定浏览器Date模拟30/31/61天，严格超过30才提醒；关闭后重载/同周期不出现、下一周期恢复、直达备份区域焦点通过。仅生成不记备份，真实下载JSON已保存文件；第61天快照生成后第62天另一标签编辑笔记，下载仍记录61天，新笔记保留且92天再次提醒。模拟日期不是经过七天自用，不把浏览器下载等同于手机系统分享/OS保存窗口。
- session48535聚焦十项通过。最终完整session85475 exit0：69文件296项单测、strict TS/build、42条中41pass/1既有WebKit断网模拟skip，六张分页基线未更新。更新报告新目录.e2e-update/9a9f1f64-8b95-4126-9082-079f1dd5d652，六份七表/Blob保真已汇总。preferences新UUID a9853033-432f-4f6c-9efc-7f22c90d9ecc，汇总严格要求本轮十份，不读旧目录填数；原始机器报告保留，汇总用Prettier统一格式。
- 已部署修复版https://ce2a3ffa.jingye-reader.pages.dev/，稳定https://jingye-reader.pages.dev/不变。session58621 exit0，3资源变动上传/12复用，_headers另上传；16个静态文件2239724字节，未包含书籍或用户数据。session93736 exit0，15公开资源SHA/安全头/缓存与preparedAt2026-10-02T12:56:41.757Z一致，四条线上HTTPS/Worker/IDB/重载/SVG ZIP恢复通过，Chromium线上断网重开翻页通过；WebKit不计手机断网通过。
- 产物安全15惰性URL/12用途及SW12预缓存/许可导航/字体SHA与不预缓存/分享POST本地IDB检查通过。统一Node gzip main85.27KB/CSS5.09KB/parser85.63KB/SW3.44KB，总179.44KB，较上一检查点增加0.03KB；可选同源字体另1.53MiB。未为纯菜单CSS重新下载真实书籍；兼容集仍3本/2来源，最近6pass/4缺失skip，20本与整本视觉继续待办。
- README/ISSUES/DEPLOYMENT/e2e说明及状态表已更新。当前无活跃E2E、下载或部署进程；整理后再跑必需lint/test/build，并核对最终dist与上传清单/HTTPS报告，结果写在此检查点后。
- 下一具体动作：用原创12万字单段和千段长章做真实跨块前后页、选区/书签、百分比跳转、字号28px和窗口变化/重载定位，观察DOM上限与图片/注音边界；随后千章打开和百书书架实际耗时/滚动，再继续系统分享、合法真实EPUB来源扩充与DATA-01恢复暂存内存。物理iOS/Android、55fps/30分钟内存、7天自用、Git身份/CI/许可/域名仍按实际外部门槛保留，不将完整目标标记完成。

最终收尾：session60326已exit0，最终lint、69文件296项单测、strict TS/build通过；最终dist与16项上传清单和15项HTTPS报告SHA全部一致。42项本地全套中41通过/1既有环境skip、线上4项通过，不存在待结束测试/上传会话。检查点格式整理后再核lint；Goal继续active，下一项为上述M2-09真实长章回归。

### 2026-10-02 21:32 检查点（继续Goal，长章浏览器验收与性能诊断）

- 用户已看到自己的Cloudflare部署记录，最新要求继续。Goal为active，主模型单代理、无预算限制；M0/M1/M2未全部完成，M4不在范围。不继续修改账号或无关站点。Git仍无作者/提交/远程。
- 新增e2e/long-chapters.spec.ts、独立config/setup和pnpm check:long-chapters。120001 UTF-16单位单段与1000段/157000单位TXT经生产Worker与原生IDB：12000边界前后块完整连续，原段落编号/选区偏移、原文SHA、书签笔记与重排/重载Locator保留，实际行框无越界，观察DOM峰值4含临时测量。测试通过原生range输入事件/DOM Range操作，不声称手机拖动、长按或内存验收。
- 完整session23161 exit0：69文件296项单测、strict TS/build及46条中45pass/1既有WebKit离线模拟skip，六张分页基线未改。真实更新目录482ea107-f0c0-4bd5-8e61-0f3af7e3b067六份七表/Blob报告已汇总；preferences UUID a285f6b3-e65b-4d53-a186-5c12fa123629十份已汇总，长章当轮UUID424fe7ef-08e8-4831-bd59-fc30c976652e四份已汇总。
- 随后补强笔记跳转可见性：以真实CSS Highlight/fallback Range与视口相交作为完成条件，不只检查同一块内存在；session3353 exit0四项聚焦全通过，新长章UUID5c50e36d-ed1e-4050-8a50-65929c450684已汇总。两引擎note-jump截图已审查，划线在当前页。窗口变化前经应用退出全屏，模型高度不放松，仅computed CSS允许1/64像素布局取整且独立检查实际行框。
- 新增e2e/performance.spec.ts、paintTiming.ts、performanceSetup、独立config及pnpm check:performance-browser。实际导入1000章和100本，从真实click捕获阶段到排版/两次RAF计时；原始记录保留失败状态，汇总必须本轮四项passed。旧共享千章样本实际9951892字节，未达到10MiB，重复正文由4增至5以达到要求；该测试素材不进入生产包。首次session5640为1pass/3fail：千章样本大小失败2项，WebKit百书1584ms超500ms。没有降低阈值或记为通过。
- session52234正在诊断：补足样本、读取DOM就绪/帧等待分段以及原生只读cursor/getAll对比；Chromium千章及百书已通过，WebKit尚待结束。测试运行期间不编辑其源码或产品源码。性能、物理触摸/FPS/Android30分钟内存仍不能由已通过四条长章推断。
- 此轮至此未改变产品运行资源，线上仍为ce2a3ffa、稳定jingye-reader.pages.dev，179.44KB gzip。后续若诊断发现产品读库问题则修复、回归并重新核验/部署。下一动作收齐性能诊断，按证据处理WebKit慢路径，再继续分享、图片/注音、真实EPUB多样性与DATA-01。整理后需再次运行项目必需lint/test/build，未完成前不称最终收尾。

补充（21:46）：session52234已结束3pass/1fail，原生探针定位WebKit游标100条1393ms、getAll15ms，帧等待约35ms。src/db/repository.ts的listShelf改每批最多32条native批量读取/立即丢弃目录字段，同一只读事务关联进度；百本千章完整投影及空库/整批进度检查通过，新增2项单测。session38085四项性能聚焦通过，WebKit百书211–263ms，千章两引擎60–190ms。session62923完整50条已exit0，49pass/1既有环境skip，69文件298项单测、lint/strict TS/build及四类新报告汇总通过；六张分页基线不变，full更新目录a25f1cbf-dcba-4b64-86ca-ac9b8444f3ef、长章6784aea7-1d3b-4c71-bb31-ac703ddd1d9f、偏好4210099c-2386-48cb-b99f-1cf78a487345、性能22099c34-8213-4047-90d5-676af5b9d5c8。

随后发现性能用例沿用了base减弱动态，明确改为no-preference并以真实matchMedia记录；session55665为3pass/1fail，WebKit百书三次287/543/278ms，保留失败，不记默认动态通过。ReaderView已改为仅无缓存摘要的旧书调用目录回填，避免现代书重复读取及不必要rw事务；新产物main为index-Q8hKagDs.js，暂未部署。session19486默认动态聚焦正在运行：Chromium两项/WebKit千章已通过，百书待结束。此前16资源2239875字节清单对应前一版index-1MCdOuxJ，不能作为这次新产物上传清单；发布前重做清单、完整回归与实际HTTPS核验。Goal active，线上仍ce2a3ffa，未结束测试不视为通过。

### 2026-10-02 21:58 检查点（M2-09本机性能修复完成并部署）

- Goal继续active，范围M0/M1/M2和已授权Cloudflare；用户确认部署记录后已继续，无子代理、模型切换、新依赖或Git身份/提交。PRD/DEV_PLAN原文未改，150KB只作参考，物理手机/7天自用等外部条件未伪造。
- 新增长章四项已验证12000偏移跨块连续、原段落/UTF-16定位、字号28px/窗口重排/重载及笔记跳转可见、书签/笔记/原文件保留；DOM峰值4包含临时测量。截图已检查，行框与视口独立验证；没有用单测替代布局，也没有把窗口模拟当传感器旋转或原生选区。
- 原生诊断确认WebKit百书逐条游标约1393ms、getAll15ms；listShelf改主键递增、每批最多32条批量投影，同一只读事务关联进度，及时丢弃目录字段、不读正文。原空库、64本完整批次及百本千章测试验证无漏书/重复/进度串联，完整记录目录保留。ReaderView复用Book已有摘要，旧书仍按原函数回填目录；未增加数据库版本或改变位置规则。
- 默认动态第一次补测保留543ms失败，修复重复目录事务后session19486四项已exit0通过；UUID dbca81a9-1b92-4648-9cf0-1cf3f6439814、本机WebKit首屏243–318ms。随后最终session52630再跑完整50条并exit0：69文件298项单测、lint、strict TS/build，本地49pass/1既有WebKit断网环境skip，六张分页基线未改；性能使用真实matchMedia确认no-preference，未降低1500/500/300ms阈值。
- 最终千章文件12426892字节/1000章，经真实Worker/原生IDB导入并核对SHA；开书三次Chromium60.6–62.9ms、WebKit160–180ms；目录31.9/55ms。百书三次Chromium57–61.2ms、WebKit206–275ms，九处原生脚本滚动行覆盖、Home/End和重载通过，书架峰值12/11行。计时为真实click捕获到排版DOM及两次RAF，排除导入、应用壳加载和OS冷启动；不是物理触摸/FPS/30分钟内存证明。
- 本轮严格新报告：更新目录10b4af6f-8e58-430b-970e-84f4b8f04749六份七表/Blob保真；长章bc2f3e76-6fab-407c-9e06-3df92ff7b56b四份；偏好28c8b978-2697-4340-abda-71dbb4cec0d7十份；性能29c1d9ff-9827-41e2-93b8-606b0ad2d7f2四份passed/未减弱动态。各汇总已写artifacts，优化前失败在performance-shelf-before.json。只读原生探针不向应用库写测试记录，不用旧报告填本轮缺项。
- 已发布https://96804405.jingye-reader.pages.dev/，稳定https://jingye-reader.pages.dev/。16静态文件2239895字节，main index-Q8hKagDs.js；上传3变动文件/12复用及_headers，不含书籍/用户数据。清单preparedAt2026-10-02T13:52:54.225Z与15公开HTTPS资源大小/SHA、安全头/缓存完全匹配；线上四条真实Worker/IDB/进度书签重载/SVG ZIP恢复通过，Chromium断网启动/翻页通过，WebKit只计在线。产物15惰性URL/12用途、SW12预缓存/许可字节/字体SHA及不预缓存/分享本地IDB检查通过。
- 统一Node gzip main85.32KB/CSS5.09KB/parser85.63KB/SW3.44KB，总179.49KB，较上次部署增加0.05KB；字体另1.53MiB。真实兼容仍3本/2来源、最近另6pass/4缺失skip；没有为读取优化重新下载或声称20本/完整视觉通过。Git仍unborn main，Wrangler HEAD警告不作为提交证据。
- 当前全部E2E/部署/HTTP会话已结束。最后整理文档后再跑工程必需lint/test/build并核对dist与上传清单/HTTPS报告，结果补在此后。下一具体动作先验浏览器真实分享POST→SW本地暂存→IncomingPage→Worker及跨标签衔接，再推进src/backup/archive.ts、client.ts、restore.ts、snapshot.ts的大库暂存/聚合内存问题和长块图片/注音。M2-09状态仍部分浏览器通过；真机/20本/7天/CI身份等不据此记完成。

最终收尾（22:00）：session70718已exit0，整理后pnpm lint、69文件298项单测、strict TS/build通过；最终dist与本次16项上传清单及15项HTTPS报告大小/SHA全部一致，preparedAt相同。session52630本地49pass/1环境skip、线上4pass及全部采集已结束，无待结束测试/上传进程。Goal查询确认active，无token预算；下一项为上述浏览器分享衔接与DATA-01，未将完整目标标记完成。此记录写入后仅再核文档格式/lint，不重复未改动的浏览器套件。

### 2026-10-02 22:21 检查点（M2-01分享浏览器验收）

- 用户已确认看到账户部署记录并要求继续，Goal active、无token预算，范围不变。主模型单代理，无新增依赖、模型切换、Git身份/提交或账号操作。
- 新增e2e/sharing.spec.ts、sharingSetup、playwright.sharing.config.ts、pnpm check:sharing及严格当轮汇总scripts/check-sharing.mjs；默认套件也注册六条。实际按manifest提交multipart表单导航，要求POST导航/SW303/同源跳转，原生IDB和真实Worker，不mock解析、不向应用数据库写测试数据、不模拟launchQueue当作系统验收。
- 首次session77338为2pass/4fail：文字原文哈希预期误用了LF，而真实表单正文传CRLF；按传输原文核对暂存元数据和保存Blob，未修改产品原文。WebKit两个文件流程返回error-format；临时本地诊断定位文件字段类型，未部署，诊断随后完整移除。session6973为4pass/2fail，只剩该引擎文件问题。
- scripts/probe-sharing.mjs在不含应用代码/IDB/解析器的最小SW复现：Chromium英文/中文文件名均解析为File；Windows WebKit英文为File、中文UTF-8文件名却为字符串，直接Request.formData与TransformStream两路一致。记录artifacts/sharing-native-probe.json，不能推断真实iOS或Android。WebKit文件测试明确限定ASCII文件名，Chromium继续中文名；原文件字节和中文正文不改，不放宽应用格式/大小校验。
- session83118 exit0，六条聚焦全通过；当轮UUID373f05b6-ed3d-4fe8-8d48-4c91ece542f3，报告artifacts/sharing-regression.json仅接受本轮六份passed，记录文件名覆盖范围、零外部请求/页面错误、自动CSP守卫、同源Worker和SW303。原始失败与通过报告留在忽略的.e2e-sharing/各UUID目录，未用旧成功补失败。
- 文件分享自动阅读且另一标签原TXT进度/书签/原文件SHA保留；纯文字/URL预填、返回/重载后继续、保存后消费暂存，脚本样式文字不执行且链接不访问；混合TXT/坏EPUB/文字只保留并重试失败文件，保存文字不删除失败文件，明确放弃后才清除，另一标签未保存标题/正文不变。真实系统分享菜单、安装File Handling、后台冷启动/连续分享和大文件内存仍待验收，iOS按计划使用手动文件入口。
- session8385 exit0：最终pnpm lint、69文件298项单测、strict TS/build通过。最终dist与既有16项部署清单和15项已核验HTTPS报告大小/SHA全部一致，preparedAt仍2026-10-02T13:52:54.225Z；生产代码/包体未改变，无需重复部署，线上仍96804405、稳定jingye-reader.pages.dev、179.49KB gzip。未重跑未改动的50条原套件或线上四条，不称本轮完成56条全套；六张基线未更新。
- 当前无活动测试/上传进程。下一具体动作DATA-01：archive.prepareBooks仍聚合全部解析章节，client通过Comlink一次性回主线程，restore在七表rw事务中再聚合本地正文contents Map；先设计逐书验证/暂存与取消清理，保留同指纹版本冲突、位置/摘录校验、失败整体回滚和待导入分享保留，不能把逐书主库提交当原子恢复。随后长块图片/注音、真实EPUB扩充；真机/20本/7天/Git身份/CI等未完成，完整Goal保持active。此检查点后仅再核文档格式/lint。

### 2026-10-02 22:36 检查点（DATA-01逐书暂存，全套回归中）

- 主模型单代理继续active Goal。archive新增单书prepareBook，生产Worker仅暴露该函数；原prepareBooks仅测试夹具使用。client的restoreFromBackup逐书RPC→暂存→下一本，无完整PreparedBook数组跨线程。新增staging.ts使用现有blobs表随机restore-stage命名空间，不升数据库版本，不进入书架或书籍备份；独立字节和结构化章节逐书落库，事务内重建Blob。
- restoreBackup支持逐书source，移除整库contents Map；同一七表rw事务逐书读取本机或暂存、校验位置/摘录并写入。覆盖先清元数据、保留匹配本机原文供轻量备份复用，末尾清理无关章节/资源；待导入分享与其他恢复命名空间保留。晚一本失败仍整体回滚，新增缺章本轻量覆盖清残余正文。原版本冲突/指纹/合并新旧规则单测保留。
- withRestoreStage持有会话Web Lock，清理时只回收失锁孤儿，活跃会话互不删除；无Web Locks仍清理自身finally，崩溃残留可由清空数据移除。取消/超时/线程失败终止Worker且标记控制器，迟到RPC或Blob.arrayBuffer结果不得复活暂存；暂存dispose先标记关闭再删除。UI增加“取消恢复”，不在事务是否已完成尚不确定时宣称数据未修改。
- 首次真实浏览器session37903为8pass/2fail：WebKit十三本原文和SVG恢复在删除暂存后Blob读取NotFound；最初复用暂存读取出的Blob导致实际路径失败，改为暂存独立ArrayBuffer/事务内重建Blob后session4613六项聚焦全通过。scripts/probe-staged-blobs.mjs的最小原生两引擎对照均通过（artifacts/staged-blob-native-probe.json），尚未复现同一故障，因此只能说修复实际恢复路径，不能声称已证明WebKit一般性Blob缺陷或完整根因。
- 新增e2e/backup-staging.spec.ts四条：十三本真实ZIP恢复，观察转发原生put确认13次暂存先于主库写入，暂存清理/原文SHA/书签/笔记/重载通过；最后一本位置错误整库回滚、清理并重试通过。新增8项单测涵盖晚书失败、取消、迟到RPC/字节、暂存配额失败、实际Node Web Locks活跃/孤儿、轻量缺章清理；不等同手机杀进程或RAM实测。
- 最新session89906仍在运行：lint、70文件306项单测、strict TS/build已通过，开始完整60项E2E，已见Chromium前14项通过，尚未结束不得计完整通过。当前main index-CnS0JuBD.js、Worker parse.worker-BiQLsH6i.js；更新副本目录ef786ded-71b2-43a0-9095-1eddc56e2499。测试期间不编辑其src/config/测试源。此前session29442只因e2e脚本格式失败，已修正；所有更早测试均已终结。
- 当前未上传，线上仍96804405。下一动作等待session89906终态，若全过则采集五类新UUID报告、安全/PWA/体积/部署清单，部署用户既有Cloudflare项目并做15资源HTTP与线上4条回归。最后更新状态和必需检查。DATA-01预览原文件Blob、最终ZIP导出、单本/浏览器内部工作集及实际大库/手机内存仍未消除，之后继续原文预览/导出流式处理和长块图片/注音/真实EPUB目标；不将完整Goal标记完成。

### 2026-10-03 恢复检查点（上一阶段已完成发布，继续DATA-01）

- 已核实此前session89906终态exit0：70文件306项单测、lint/strict TS/build，60项中59pass/1既有WebKit断网模拟skip。六张分页基线未更新；从实际Playwright HTML ZIP抽取的artifacts/full-browser-regression.json保留源SHA，backup-staging-regression.json有本轮四条预期成功结果。未把套件清单当通过证据。
- session25671也已exit0：五类新UUID报告全部严格汇总，更新目录ef786ded-71b2-43a0-9095-1eddc56e2499；长章a0b94316-b2c0-46e1-86a9-1163d064847f、偏好e8f0ebf6-0a0b-48a6-9c38-0017ef931cb8、性能04a1ebef-a1de-4131-98fd-6805fdd07d91、分享c8bdc980-04e7-4e99-a96d-0976fc00fa1c。本轮默认动态千章打开57.3–221ms、目录29/90ms，WebKit百书253–326ms；只作本机移动视口证据。
- 最新实际部署https://2fdc1c2a.jingye-reader.pages.dev/，稳定https://jingye-reader.pages.dev/；4文件变动/11复用及_headers。16静态文件2242685字节，main index-CnS0JuBD.js、parser parse.worker-BiQLsH6i.js。preparedAt2026-10-02T14:42:17.266Z，与15公开资源HTTP报告一致，大小/SHA/安全缓存头全部匹配；线上四条实际Worker/IDB/重载/SVG ZIP清空恢复通过，Chromium断网启动翻页通过。未上传书籍/用户数据，无Git作者伪造。
- gzip统一Node口径main86.21KB、CSS5.09KB、parser85.57KB、SW3.44KB，总180.31KB，比此前179.49KB增加0.82KB，字体另1.53MiB；无新增依赖。最小Blob原生探针两引擎都通过，不能用它证明已定位底层故障；独立字节修复由真实恢复SHA回归证明。
- 所有上述测试/上传会话已结束，不重启旧进程。当前继续导出聚合内存：buildArchive会对所有原文件同时arrayBuffer，然后JSZip生成完整arraybuffer再转Blob；须保持开放ZIP/CRC/原文完整、进度和独立解压验收。官方JSZip文档确认generateAsync保留完整结果，streamFiles不等于总内存有界。预览原文件Blob、手机峰值RAM/物理验收仍是独立未完成项，Goal active。

补充（10月3日流式导出执行中）：已新增src/backup/streamArchive.ts及3项纯逻辑测试，保留JSZip公开generateInternalStream/streamFiles，通过文件头事件再解析该文件的deferred输入，切换文件时remove已完成输入；输出按约1MiB转Blob，不生成整包ArrayBuffer。经典ZIP计数/容量/Unicode字段及重复路径在原文读取前检查，超限不生成损坏备份。session50501已exit0，定向35项、strict TS/build和10条真实浏览器备份回归全过；两次用户中断未重启仍存活的会话。新产物尚未部署，线上仍2fdc1c2a。下一步补十三本真实浏览器ZIP下载/系统解压哈希，随后完整检查和发布。streamArchive仍单本arrayBuffer，输入Blob、最终输出Blob/浏览器内部存储及手机RAM尚未验收，不声称总内存恒定。

### 2026-10-03 检查点（DATA-01流式导出完成并部署）

- Goal继续active，用户确认Cloudflare部署归属后持续开发；主模型单代理，无模型切换、子代理、新依赖、Git作者或提交。原PRD/DEV_PLAN未改，M4不在范围，150KB仍是参考目标。
- archive.buildArchive复用JSZip公开generateInternalStream/streamFiles，文件头事件后才展开该原文，下一文件开始移除已完成输入；输出按约1MiB转Blob，最后组合Blob，不生成整包ArrayBuffer。原文读取前拒绝重复路径、文件名字段越界、经典ZIP32位容量溢出，并与恢复器共享20000条目上限、检查32MiB目录；读取失败或回调错误不交付半个ZIP。单书ArrayBuffer、所有输入Blob、最终Blob及浏览器内部存储仍占用内存，不声称恒定RAM。
- 新增3项纯逻辑回归：读取前计数/目录/容量及重复拒绝，依次展开且并发峰值1，中文/空条目和超过1MiB输出CRC/原文一致，读取/回调失败不展开后续。71文件309项Vitest通过，strict TS/build及lint通过；文档整理后的最终检查另记在此后。
- 原有十三本真实恢复用例扩为1200118字节原创长文、十二份TXT加一份文稿，全部暂存先于主库写入、SHA/标注/清理/重载仍检查，随后真实下载ZIP并以JSZip核CRC。session85862两条新下载失败是重载后恢复的onboarded=false触发正常引导；补真实跳过引导再进入设置后session87455四条通过，没有为测试改产品引导设置。
- scripts/check-backup-desktop.ps1只接受最近30分钟双引擎下载报告，核对ZIP哈希、路径和条目后使用Windows Expand-Archive独立解压，26份原文尺寸/SHA全部一致。首次工具日期比较因PowerShell ConvertFrom-Json自动产生UTC DateTime而丢失offset误报陈旧；改直接DateTimeOffset转换后通过，未放宽时效要求。样本/解压只存忽略的test-books，不进dist；此证据是本机原创样本，不是两台手机或峰值RAM验收。
- session30690已exit0：lint、309项单测、strict TS/build及完整60条中59pass/1既有WindowsWebKit断网模拟skip。六张分页基线未更新。scripts/collect-browser-report.mjs从真实HTML ZIP保留完整结果、仅允许既有skip、核对全部spec/双引擎及下载属于本次运行；源SHA b3687ca354a174a7bac0cbac6fd7db5f8b764ed95163fde71b640572712deb06。此后再次独立解压本轮两份下载通过，未用定向成功下载补全完整套件。
- 五类报告已严格汇总：更新目录e252cc59-0c62-4341-a02c-d417b8f9912b六份七表/Blob；长章30f8344c-34b7-4dfc-bb63-e08d379cf390四份；偏好46bd1bd9-3123-465b-87a3-2de035257893十份；性能49b10b1d-ddd5-48a6-9d44-f02078b2294f四份passed/默认动态；分享00401f9f-a699-48e8-968f-49c17766cc55六份。千章开书61–140ms、目录27.6/47ms，WebKit百书233–281ms，仍是本机未限速移动视口，不等同真机/FPS/30分钟内存。
- 已上传既有Cloudflare项目，部署https://f01857e6.jingye-reader.pages.dev/、稳定https://jingye-reader.pages.dev/，4个变动文件/11复用及_headers。16静态资源2244149字节，main index-BD6amuDw.js、parser parse.worker-CPH_39sC.js；preparedAt2026-10-03T02:49:06.236Z。第一次新JS响应为1411字节HTML导致session20521检查失败，未运行线上测试；稍后对照稳定/唯一部署两地址正确，再session70141完成15资源SHA/安全缓存头及4条实际HTTPS回归并exit0，HTTP checkedAt2026-10-03T02:50:18.413Z。不因失败重复上传或断言底层原因；Chromium线上断网启动/翻页通过，WebKit只计在线。
- 统一Node gzip main86.21KB、CSS5.09KB、parser86.16KB、SW3.44KB，总180.90KB，比2fdc1c2a增加0.59KB；字体另1.53MiB。安全15处惰性URL/12用途、SW12预缓存/许可字节/字体SHA/本地分享及不预缓存通过，无书籍/用户数据/源码映射上传。
- 所有上述套件/部署会话已结束。下一具体动作DATA-01预览：readBackup已切片解压，但仍将所有原文件Blob聚合回主线程；设计只保留备份File/元数据、逐书重新读取并验证后暂存，保留未使用条目CRC、50MiB原文/32MiB元数据/总预算、晚书失败原子回滚和取消清理。出口最终Blob及snapshot输入Blob工作集、长块图片/注音、20本合法真实EPUB与物理手机/7天自用/真实Git身份/CI/许可渠道等继续待办，不将完整Goal标记完成。

最终收尾：session73138已exit0，文档整理后pnpm lint、71文件309项单测、strict TS及生产build全部通过；重建dist与16项上传清单和15项已核验HTTPS报告大小/SHA完全一致，preparedAt相同。当前无活动测试/上传进程，Goal查询仍active且无token预算。接续任务为上文只保留File/元数据的逐书备份预览设计，此阶段没有把M2、完整M3或Goal标记完成。该补记后仅核文档格式，不重复未变化的浏览器套件。

### 2026-10-03 DATA-01预览检查点（完整回归中）

- 上一Goal阶段是实际进展：f01857e6流式导出已发布并验证；本轮继续同一目标，不创建子代理、切换模型、增加依赖或伪造Git身份。
- readBackup现返回BackupFile元数据；ZIP预览用BoundedZip discard逐块验证并丢弃引用原文与未用条目，主线程inspectBackup只保留所选File和元数据。新增BackupArchive：重新打开目录/预算、核对每份声明大小、Worker内一次持有目录，逐书读/CRC/指纹/解析；新Worker API openRestore/prepareRestoreBook/finishRestore按顺序使用，重新核对预览元数据，最后验证未用条目，再进入原有七表原子事务。取消/失败/迟到RPC清理与Web Locks暂存保护保持，UI原文计数改读files，无磁盘schema或定位版本变化。
- 新增7项单测，含十三本预览discard/无原文返回/不整包arrayBuffer，逐次读取/重复或未知书拒绝、缺File/元数据改变拒绝与重试、独立会话/预算，所选File引用保留、全部暂存后未用条目CRC失败清理/原库不变、最后校验RPC取消/晚到不能提交。旧v1/v2/v3和SVG恢复测试改用新逐书接口，保持原段落/标注断言。
- session80163已exit0，10项双引擎TXT/EPUB/SVG和十三本预览/恢复/下载全通过；原生Worker构造只转发加消息观察，预览确有13书/13文件/零Blob，13次准备响应各一本和一份原文；主库写入前13次暂存、清理、重载/原文SHA/标注继续核对。没有以mock响应作真实线程证据。
- session67841当前完整套件仍在运行：lint、72文件316项单测、strict TS/build已通过，60项E2E尚未终态，不计完整通过。当前main index-CCnVf5PK.js、parser parse.worker-CTZXdDeH.js；更新副本目录cdf637c0-26ee-493f-af80-4e8149bc2a33。测试期间不编辑其src/config/测试文件。新代码未上传，线上仍f01857e6。
- 下一动作等待同一session67841终态，不因观察超时重启；完整成功后收集实际HTML/双引擎下载及五类UUID报告，独立解压本轮下载、安全/PWA/包体/上传清单，再更新既有Cloudflare并核对15资源/4条线上流程。DATA-01仍保留导出snapshot输入Blob、最终输出Blob、元数据/单书/浏览器内部工作集及真机峰值；之后继续出口快照工作集和长块图片/注音及真实EPUB20本目标。Goal active，不把完整M2/M3或真机门槛记完成。

### 2026-10-03 检查点（DATA-01元数据预览完成并部署）

- session67841已exit0：72文件316项单测、lint、strict TS/build，完整60条中59pass/1既有Windows WebKit离线模拟skip；六张分页基线未更新。新增7项预览/重新打开/逐次展开/元数据绑定/独立会话/末尾CRC/取消回归通过。取消最后校验等待后的晚到结束不能写主库；CRC失败发生在全部暂存之后仍清理暂存、原库全部数据与原文不变。单元的RPC使用模拟Worker，真实通信证据由以下实际浏览器补足，不混淆两种范围。
- 十三本真实Worker回复已经观察：预览13书/13份原文元数据、零Blob；之后13次prepareRestoreBook响应各一本与一份原文，按备份files顺序出现。观察器只转发原生Worker构造并监听消息，IDB put观察仍转发原生函数；无解析/RPC替换、无直接写测试主库。暂存13次先于主库写入，原文SHA/标注/清理/重载、下载/CRC继续通过，原文长篇1200118字节。恢复API重新读取File，校验规范化元数据与预览一致、独立预算与逐书指纹，最后校验未用条目，再开始原子事务；轻量JSON仍走元数据恢复。
- scripts/collect-browser-report.mjs保存本轮实际HTML ZIP，完整/备份报告源SHA f4dae1cfda25a7fe95017bb101a9f3c59f23a6ba44e413bcd9206c74580629d0；要求所有spec、双引擎、零意外/重试、仅既有skip，以及两份下载来自本次且含新通信断言。Windows Expand-Archive再次独立解压本轮两份下载，26份原文大小/SHA一致；校验脚本增加新通信标志，不能用前一阶段报告填项。所有测试书/解压目录留在忽略test-books，不上传。
- 五类本轮报告已严格汇总：更新目录cdf637c0-26ee-493f-af80-4e8149bc2a33六份七表/Blob；长章a979f7b6-fdd2-4409-ab42-8b136fdee48a四份；偏好b0b74bdb-396f-41ef-8ebf-022d5a6f7632十份；性能52508e6b-ed2d-4df8-9296-814c98bbf33a四份passed/默认动态；分享44e776c7-c070-4813-b867-ef7599f3387d六份。千章开书53.5–156ms、目录28.7/45ms，WebKit百书236–254ms。仅为本机未限速移动视口，不是手机/FPS/30分钟内存证据。
- 新部署https://0ddefb78.jingye-reader.pages.dev/、稳定https://jingye-reader.pages.dev/，Wrangler exit0上传4变动/11复用及_headers，16静态资源2245475字节。main index-CCnVf5PK.js、parser parse.worker-CTZXdDeH.js；preparedAt2026-10-03T03:09:21.733Z。session34469已exit0，先唯一部署、再稳定地址各15公开资源大小/SHA/安全缓存头第一次全部通过，报告时间03:10:08.646Z/03:10:14.567Z，都对应同一preparedAt；两报告保留。四条实际HTTPS浏览器Worker/IDB/进度书签重载/SVG解码边界/完整ZIP清空恢复全部通过，Chromium断网重启继续翻页通过，WebKit只计在线。
- 统一Node gzip main86.26KB、CSS5.09KB、parser86.51KB、SW3.44KB，总181.31KB，比f01857e6增加0.41KB，字体另1.53MiB；无新增依赖。安全15惰性URL/12用途、SW12预缓存/许可字节/字体SHA/本地分享及不预缓存检查通过。未改磁盘schema、定位/备份版本、账号或Git身份；未上传原文/用户数据/源码映射。
- 全部上述测试/部署会话已结束，整理文档后须再完成lint/test/build与重建字节核对，结果记在此后。Goal仍active，没有将M2、完整M3或真机/7天使用验收标记完成。下一具体动作DATA-01导出快照：snapshot.books.toArray仍一次获取整库目录/章节摘要，metadata拷贝还带这些可重建字段，originals仍聚合全部输入Blob句柄；先去除无用派生字段、改分批投影，再设计逐书原文供给与快照一致性/失败无输出，不以减小fixture或降低限额替代大库目标。最终输出Blob、元数据/单书/浏览器内部工作集及真机峰值、长块图片/注音、20本真实合法EPUB和Git/CI/正式许可渠道等仍有未完成事项。

最终收尾：session58870已exit0，整理后pnpm lint、72文件316项单测、strict TS和生产build全部通过；重建dist与16项上传清单、唯一部署及稳定地址各15项HTTPS报告的大小/SHA完全一致，preparedAt相同。当前没有活动测试/上传进程，Goal查询确认active、无token预算，下一动作按上文推进导出快照投影与逐书原文供给。该补记后仅核文档格式，不重跑未变化的浏览器套件。

### 2026-10-03 检查点（DATA-01导出快照与惰性供给，验证中）

- createSnapshot改为同一只读事务内32本一批投影，去除可重建目录/章节摘要与本机Blob键；完整快照只查原文键、保存bookId/blobId/size，不读取或聚合原文Blob。Worker导出API改为buildSnapshotArchive，初始只发元数据；收到文件头后回调主线程逐书取原文，再核大小/SHA与书籍ID。导出途中删除/清空/替换原文整体失败，笔记/改名保持快照值，不在ZIP生成期间持有数据库事务。旧备份可选目录/摘要仍兼容；不改schema/定位版本、不增依赖。
- 新增10项单测，含100本各2000章真实fake-indexeddb存取/原生getAll观察（32条每批）、零原文GET、原库派生字段保留、自定义键/文稿/缺文件与暂存排除、导出时继续写库/旧元数据与全部字节保真、删除/大小改变/同大小替换整次失败/不读下一书、取消后迟到Blob拒绝、惰性输入容量/长度预检及客户端元数据回调。首次完整单测新增取消案例漏重开db导致DatabaseClosedError，已修正测试初始化；session91835的73文件326项单测、lint、strict TS/build已通过，不把之前失败计为通过。
- 定向实际浏览器session21416已exit0，10条双引擎全部通过；只转发原生Worker.postMessage、构造/回复与IDB get/put，确认预览零Blob、准备各一本、导出初始输入零Blob/此前零原文GET，之后13份原文按files顺序读取，下载metadata不带目录摘要/本机键，CRC/全部字节/书签笔记/清空恢复/重载通过。报告新增exportInputOnlyMetadata/sourceReadsAfterWorkerStart，collector与Windows解压脚本强制要求，不能复用旧报告。
- session91835当前完整60条浏览器仍在运行，勿编辑其src/测试/config或重复启动。当前main index-hpL91RTb.js、parser parse.worker-DGhdd5kn.js，未上传；线上仍0ddefb78。完整成功后收集实际HTML、两份当前下载/Windows独立解压、五类UUID报告、安全/PWA/体积/上传清单，再更新既有Cloudflare、核对唯一/稳定15资源和4线上流程，收尾lint/test/build及相同字节复核。
- Goal active，无token预算。最终输出Blob、元数据/单书/32本读取批次/浏览器工作集、物理手机峰值仍有占用，不宣称恒定内存；后续继续长块图片/注音/跨段选区真实布局与20本合法EPUB。Git身份/CI/许可渠道、手机/7天门槛不伪造。

### 2026-10-03 检查点（DATA-01惰性导出完成；真实Cloudflare客户端更新通过）

- session91835已exit0：lint、73文件326项单测、strict TS/build，完整60条浏览器中59pass/1既有Windows WebKit断网模拟skip；六张分页基线未更新。实际Playwright HTML已在生产套件覆盖前严格收集，源SHA31e4b13115e112ee9f56d009d0cbf174526c0dbc865eb927f898050ec371868f。两份本轮下载均带exportInputOnlyMetadata/sourceReadsAfterWorkerStart与预览/准备证据；Windows再次独立解压26份原文尺寸/SHA一致，未复用上一阶段报告。
- 五类本轮报告严格汇总：SW更新目录31580ae7-7181-4162-90d8-e129c90d99b7六份；偏好61ff1039-3a5d-4e5d-8574-b263a968d14a十份；长章7dcab8a4-b731-4e73-8dc6-5efb4d2a1e91四份；性能e315ac8f-9639-485a-b6be-3fed86e0bf48四份默认动态passed；分享96c8634f-30f9-48e7-a19e-be8ab557dd13六份。千章开书58.1–133ms、目录29.2/55ms，WebKit百书210–227ms，均本机Windows移动视口/未限速，不推断手机帧率/30分钟内存。
- session44511已exit0上传https://cdb34bfc.jingye-reader.pages.dev/，稳定https://jingye-reader.pages.dev/；仅dist，16静态资源2246947字节，4变动/11复用及_headers。main index-hpL91RTb.js、parser parse.worker-DGhdd5kn.js，CSS不变；preparedAt2026-10-03T03:33:19.314Z。session51284已exit0，唯一部署和稳定各15资源大小/SHA/安全缓存头均第一次完整通过，checkedAt03:35:51.815Z/03:35:57.385Z。统一Node gzip main86.50/CSS5.09/parser86.71/SW3.44KB，总181.74KB，比上一版增加0.43KB；字体另1.53MiB，无新增依赖。静态安全15惰性URL/12用途和SW12预缓存/字体SHA/许可/本地分享检查通过。
- 补齐M2-16真实线上新旧部署窗口：新增独立playwright.live-update.config.ts与deployment-update.live.ts，在上传前两个隔离原生引擎分别加载旧版index-CCnVf5PK.js，通过UI导入原创TXT、进度、书签与笔记；两份ready文件绑定旧路径/原文SHA/本次preparedAt。实际上传并核对稳定资源后才释放deployed.json门；窗口计时器快进61分钟，SW下载/网络/原生IDB均真实，不替换响应或数据库。session79249已exit0，2pass：旧阅读文档不刷新/无更新按钮，回书架显式更新，七表整体SHA和原文一致，新缓存main SHA与上传清单一致，重开进度/书签/笔记保留。run 0ac7ab51-338e-40f5-a5a0-ae0e375a6426。collect-live-update.mjs核对实际JSON两条pass/零skip/重试/错误及本次manifest/HTTPS后汇总到artifacts/deployment-update-regression.json；raw JSON不格式化，保留源SHA。临时目录已忽略，未访问用户浏览器或真实数据。
- session26071已exit0，新版本另外4条实际HTTPS流程全部通过，Worker/IDB/重载、SVG解码/边界/完整ZIP清空恢复、Chromium断网重开翻页正常；WebKit仅计在线。新旧更新2条独立计数，不能把它们并入本地60条或真机结果。
- 当前所有测试/上传会话已结束。整理文档后仍须执行lint/test/build并对重建dist与16上传/两组15HTTPS资源逐项SHA复核，再记收尾。Goal active；下一具体动作长EPUB跨块图片/注音/跨段选区实际浏览器：已有chunks单测与TXT长章不能覆盖它们，先用原创EPUB复现边界（尤其短ruby在12000字切点被拆分的可能性），保留段落/UTF-16与旧定位版本，若发现再修复并加强回归。20本真实合法书、真机/7天/身份/CI/正式许可反馈等仍待办。

最终收尾：session41491已exit0，整理后pnpm lint、73文件326项单测、strict TS/build全部通过。重建dist的16文件路径/大小/SHA与本次上传清单及唯一、稳定各15项HTTPS报告完全一致，preparedAt相同；线上更新collector增加20分钟新鲜度和每引擎报告属于本次实际测试时段的限制，再实际汇总通过。release-live-update.mjs提供后续部署的复用门检查：两个ready、本次构建与两组公开资源均匹配才释放；本次测试门由同样检查后的内联命令释放，未声称已经用新复用脚本驱动本次测试。临时目录/原始JSON已按用途忽略。当前无活动测试、上传或浏览器会话；Goal active、无token预算，下一动作按上述长EPUB边界推进。本补记与collector格式整理后仅再lint，不重跑未变化的应用浏览器套件。

### 2026-10-03 检查点（长EPUB注音边界修复，完整回归中）

- 主模型单代理继续active Goal，无新增依赖、schema/定位或备份版本变更。原创十二万字EPUB经真实Worker导入，首次两引擎均在12000切点将静页/jìngyè拆成页/jìngyè；实际失败报告保存在artifacts/long-epub-before.json。WebKit失败截图是白屏，不能据此声称视觉复现，错误由实际DOM断言证明。
- chapterChunks从安全树计算不超过12000单位的ruby区间，切点落入时退到整组起点；保留UTF-16、原段落和全部文本，不改原文件/存储定位。嵌套ruby取外层组，超长ruby继续有界分块，不宣称巨大注音组的完整排版。新增4项纯逻辑/真实DOM回归，含旧跨块跨段标注与新的完整ruby树匹配，单测共73文件330项。
- session14348已exit0，两引擎LONG-EPUB实际流程通过：两张图片分别出现且解码、12000边界往返、跨段且含emoji的UTF-16选区、书签笔记、字号28px、横竖窗口、重载和笔记可见跳转、完整ZIP下载清空恢复及原文SHA/派生图像一致。选区使用原生DOM Range，窗口模拟不作物理手机验收。
- session18008完整回归仍在运行，lint、330项单测和strict TS/build已通过，62条浏览器尚未终态；测试期间未编辑其src/测试/config或重启。main index-doZzw7Og.js，parser parse.worker-DGhdd5kn.js；本地更新目录a327b503-8c32-4831-a1c1-842f005c68f1。新代码未上传，线上仍cdb34bfc。终态成功后严格采集全部报告/独立解压/安全/PWA/体积，部署前两个真实旧客户端准备，再上传并核对唯一与稳定HTTPS后释放更新门。最后线上四项及工程必需收尾。
- 真实来源仍3本/2个制作来源。新下载探针中Standard Ebooks返回200但为下载提示XHTML而非ZIP，BCcampus返回403验证页，均未存为EPUB或计作验收；后续检查公开下载提示页的正常链接。真机、20本、7天、Git身份/CI及正式许可反馈条件仍未完成，不标完整Goal完成。

追加检查点（原生高亮绘制）：session18008已exit0，330项单测、完整62条中61pass/1环境skip；当轮实际HTML报告与六类长章/其他报告和Windows26份原文独立解压已采集。随后截图复核发现WebKit28px横屏读音前半被高亮背景遮盖，两引擎跨段跳转闪烁背景盖住图片；逐字符行框检查仍通过，说明DOM/几何不能证明实际绘制。无应用/IDB最小探针重现，原生整段/逐文本Range与mark四种对照报告在ruby-paint-native-probe.json，截图保存在忽略目录并绑定SHA，视觉另行核验。

修复：HighlightLayer对包含ruby或img的阅读根使用现有逐文字节点mark回退，其余根仍用原生CSS Highlight；同一窗口混合路径、闪烁与卸载都清理，只移除自身registry，图片不包mark。新增2项单测，现73文件332项。session80681已exit0，两引擎完整LONG-EPUB通过，已查看新大字号横屏与恢复截图，读音完整且图片可见。新增e2e逐字符行框及文字mark/无原生跨元素范围断言，最终session77528正在完整62条回归：lint、332项单测和strict TS/build已通过，浏览器尚未终态。main index-B9ruprJs.js，parser/CSS不变，更新目录3edefddd-9819-47ed-b268-e728db3fc84f；未上传，线上仍cdb34bfc。当前不改运行中src/测试/config，不重复启动；终态后重新采集本轮实际证据和部署清单。

### 2026-10-03 检查点（长EPUB注音分块与高亮绘制修复，完成部署）

- session77528已exit0：lint、73文件332项单测、strict TS/build；最终完整62条浏览器61pass/1既有Windows WebKit断网模拟skip，零失败/重试，六张分页基线未更新。新增6项单测涵盖短/嵌套/超长ruby、旧跨块跨段UTF-16标注、混合原生/mark和闪烁清理/原生恢复。完整实际HTML源SHA ef939fe8f52fae1fee8fc164035bdc56156dbbfcea32b9a9bc88e61c92554d6e；collector保存本轮完整/备份报告，未使用上一次通过填项。
- 长章run6c8ed6ea-e3d6-409c-93d4-0570e8a1a24c六份：两种TXT和十二万字原创EPUB，短注音整体落块、两张图片分别解码并可见、emoji跨段选区偏移、原文/书签/笔记、28px横竖窗口与重载可见跳转、完整ZIP下载清空恢复一致；DOM峰值4含测量块。逐个读音字符行框和文字mark/无跨元素原生高亮断言通过。已查看双引擎恢复大字号及WebKit横屏截图，注音完整、图片不被跳转背景遮住。纯DOM/几何曾通过却仍有绘制遮挡，故视觉与自动检查分开记录。
- 最小原生探针run4877f146-e377-417d-b86e-c0c049245336，四模式×两引擎截图绑定路径/大小/SHA，报告ruby-paint-native-probe.json；WebKit整范围/逐文本原生高亮遮住读音前半，跨段范围遮住图片，mark显示完整。实际应用修复的同根混合与原文位置由真实Worker/原生IDB流程验证；不是通用浏览器漏洞结论或物理iOS验收。巨大ruby仍按12000预算切块，不宣称完整巨大注音排版。
- 本轮更新目录3edefddd-9819-47ed-b268-e728db3fc84f六份七表/Blob；偏好eaf275c2-c13a-496a-ace7-84e501103cf8十份；性能b1adf8fd-6b95-42ad-9c63-8680232a00a4四份默认动态passed；分享459b70aa-7b59-40c2-838c-7818b8706f14六份。千章开书61.8–125ms，目录27.4/36ms；WebKit百书191–224ms。均本机Windows未限速移动视口，不推断真机/FPS/30分钟RAM。十三本当前下载预览/逐书恢复/惰性导出通信断言通过，Windows再次独立解压26份原文大小/SHA完全一致。
- session72067已exit0，上传https://d28cf96f.jingye-reader.pages.dev/，稳定https://jingye-reader.pages.dev/。16静态资源2247596字节，3变动/12复用及_headers；仅dist，无书籍/用户数据。main index-B9ruprJs.js，parser parse.worker-DGhdd5kn.js、CSS不变。preparedAt2026-10-03T04:08:46.497Z；session84235已exit0，唯一及稳定各15公开资源大小/SHA/安全缓存头第一次完整通过，checkedAt04:09:52.148Z/04:09:57.350Z。统一Node gzip main86.75/CSS5.09/parser86.71/SW3.44KB，总182.00KB，比上一版增加0.26KB，字体另1.53MiB。无新增依赖/schema/定位或备份版本。静态安全/PWA12预缓存/字体校验及不预缓存/许可/分享通过。
- session35189已exit0：真实Cloudflare旧index-hpL91RTb.js→新index-B9ruprJs.js，两引擎2pass。两个旧客户端上传前实际保存原创TXT/进度/书签/笔记；本次首次实际使用release-live-update.mjs在ready及两组15资源均匹配后释放门。run45849d73-093f-4510-a4a1-7133fb495e86，阅读文档保留/回书架显式更新、七表和原文SHA一致、新缓存main SHA匹配构建、重开进度标注通过；collector在20分钟新鲜度内汇总实际两条pass与测试时段。只快进窗口计时器，SW/网络/IDB未mock。
- session42290已exit0，新版另4条真实HTTPS流程通过：Worker/原生IDB、进度书签重载、SVG解码几何与完整ZIP清空恢复，Chromium断网重开翻页通过；WebKit只计在线。原本两条旧客户端更新不计入本地62或这4条。原始JSON不格式化，保留SHA，临时浏览器隔离目录已忽略。
- 所有上述测试/上传会话已结束，整理文档后须再lint/test/build及重建16文件与两组15HTTPS报告字节复核，结果补在后面。Goal仍active、无预算，单主模型、无子代理/身份或账号变更；M4未含。下一动作先扩充20本真实合法EPUB样本及对应布局；Standard Ebooks正常提示页给出source=download，但本次二进制请求超时，BCcampus403验证页，均未保存或新增计数，现仍3本/2制作来源。可继续其他官方公开来源及未覆盖的动效/单手/触摸浏览器回归；手机/7天/Git作者CI/正式许可反馈、DATA-01真机大库内存仍未完成，不标完整Goal/M2/M3完成。

最终收尾：session5993已exit0，整理后pnpm lint、73文件332项单测、strict TS与生产build全部通过。最终dist的16文件路径/大小/SHA与本次上传清单及唯一/稳定各15资源报告完全一致，preparedAt仍2026-10-03T04:08:46.497Z；未重生成清单或用旧字节替代。所有测试/上传会话已结束，Goal仍active、无token预算；下一动作按上述真实20本与剩余交互推进。此补记后仅再核文档格式/lint，不重跑未变化的浏览器套件。

## 最新检查点：21本真实来源 EPUB 扩集与正文验收（2026-10-03，进行中）

- Goal active，用户已确认 Cloudflare 账号记录并授权继续。当前线上 d28cf96f 不变；本轮尚未修改生产代码、部署或添加依赖。
- 原文件增至21本/3个制作来源（Project Gutenberg、Eloquent作者官网、IDPF标准样本库中的完整《草枕》）；25个候选有4个下载不可用，缺失不计入数量。《草枕》为13章全本、原包17940673字节，含4603个ruby及竖排样式；应用按既有策略统一横排。来源版权通知保留，文件不提交、不发布。
- 原始ZIP/目录/正文独立检查，选定静态正文短句作为浏览器可见性预期。不是用解析器输出反推测试预期；Gutenberg 205为Walden、6800为Schiller合集，已核对官方标题，合集Book IV取第二个同名目录。
- e2e/compatibilitySetup.ts 每次创建UUID目录、锁定来源JSON SHA；正文Range必须实际在视口内，Eloquent另检正则章节真实表格内容，草枕检注音和横排；同名Alice用source.id区分。旧元数据/标题页截图不作为新正文验收。
- 代表性双引擎12条：8通过/4失败，已保留 artifacts/real-epub-before.json 及 .e2e-compat/4651485d-967c-46ef-94b9-c1c77a20f826/raw-results.json。Beowulf跳到片段但页眉仍整部作品名；草枕翻到第2页后重开两引擎均回第1页（进度百分比相同）。不标M2-10通过；下一步查分页锚点原生几何/IDB，修复并全量回归、查看正文截图、更新COMPAT。
- 下载两轮均已终止（45905、24289 exit1）；代表性36542 exit1；诊断草枕66921正在执行。Git作者/远程、物理手机、7天自用等外部条件仍待完成。

### 21本完整原件的第一轮双引擎结果（2026-10-03）

- 60836：完整50项中42通过/8缺失原件skip；21本、3制作来源达到样本数量目标。严格collector初次失败是Playwright stats.startTime早于globalSetup的工具假设，已改为要求globalSetup处于套件时间区间、每个实际case晚于setup，重新汇总通过。run 200e48b9-122a-4733-98b5-1042474f314c，原始报告副本 D:\电子书阅读器\.e2e-compat\200e48b9-122a-4733-98b5-1042474f314c-results.json，原报告SHA 9421868ac3ef2547cca2dcd2f25e4894ab7f82db548c7989a53f34d014f93334。
- 修复src/reader/locator.ts：没有字框的源空白测量临近可见字形，保留UTF-16原始偏移与节点；《草枕》第2页重开两引擎均保持同页。新增currentSection.ts，页眉/书签章名按当前段落匹配前置目录小节，Beowulf片段标题两引擎通过；不改变段落、parserVersion=3或备份格式。新增5单测，75文件337项全通过；严格构建通过，新主包index-D6DruWuc.js；尚未上传，线上仍B9ruprJs/d28cf96f。
- 福尔摩斯首句原XML在she后有换行，测试预期错误替换为空格；缩为跨首字span、换行之前的原句，原文件/段落不修改。失败证据real-epub-oracle-before.json保留。
- 只查看了12张Chromium正文/表格及1张WebKit表格，不标整本/全截图视觉通过。partial视觉记录在artifacts/compatibility-visual-review.partial.json；表格页底部的目视疑点正在用textGeometry原生逐行框复核，4条Eloquent/草枕8502当前进行中。下一步完成该复核、全量42条加行框验收、补齐44张正文截图检查，然后全套62E2E、lint/test/build和已授权Cloudflare更新。Goal保持active。

### 2026-10-03 检查点（21本真实原件正文验收与修复，已部署）

- 兼容最终run e92b3bc3-8e73-4b9c-b617-807ff1ab593b，25候选×两引擎50项：21本实际原件/3制作来源、42pass/8缺原件skip。每书实际UI导入/原生Worker与IDB、原始XML短句真实Range可见、目录键盘跳转、行框/图片边界、翻页重开、原件大小/SHA及零外部请求/CSP错误。源JSON SHA 99eaf79976570650bf00043a099370de68f178c1699fa329b27a100657d93edb，生产首页SHA 1da881e750b109e807c929bf72cef5dff7745ca0f634f8834f927ce0198a24ba，原始结果SHA 301564856a0299b803f706a08dfca2e5d511ad87cdce22a99162dbe41b844552，原始副本D:\电子书阅读器\.e2e-compat\e92b3bc3-8e73-4b9c-b617-807ff1ab593b-results.json；UUID目录的42JSON和截图严格对应实际结果。
- 44张选定正文/真实表格截图已逐张查看；同一构建此前已查看的截图只在SHA完全相同时复用，并逐项记录出处。compatibility-visual-review.json与严格collector已绑定本次run及全部截图SHA，selectedPagesVisualReviewed=true，整本/真机标志仍false。COMPAT.md已更新21书逐本来源/大小/SHA/目录/处理范围；Eloquent额外为正则章节真实表格，草枕13章/4603ruby完整原件横排注音，唐诗仍为原段落连续文字，不重建原版诗行。
- 两处产品修复：locator测量没有字框的源空白时找邻近可见字形，保留节点与UTF-16偏移；页眉和书签按当前段落匹配同章前置TOC小节。草枕第2页重开、Beowulf片段标题在两引擎通过；5项新增单测，75文件337项。福尔摩斯源换行是测试预期错误，已独立保留失败诊断，不修改原文。无新依赖/schema/parserVersion=3/备份格式变化。
- session32171完整62条终态为61pass/1既有WindowsWebKit离线模拟skip；lint、337单测、strict TS/build先通过，六张分页基线未更新。HTML源SHA ac400b89a652f33d349661bb7367209f79aaf9d56f1d21f24f277102b78dd2fc已由collector保存本次完整/备份结果，实际下载来自此轮。该session随后因直接node check-update缺npm_execpath而exit1，并非浏览器失败；使用pnpm check:update --collect后六份更新汇总及其他报告全部成功，没有重跑完整套件或用旧报告填项。Windows两份本轮ZIP独立解压26原文大小/SHA一致。
- 本轮长章912bc5e7-f3fe-49bc-a69c-3e33abbfffeb六份、偏好3b07e099-2a4e-4a78-b701-09f8c4d96e73十份、分享8cbc883c-6add-4751-9986-8ca8ff8b1879六份、默认动态性能038e166e-5f48-4144-889c-c0012cf84ad4四份passed；本地更新050d8ea2-6670-4774-aaf1-8a56a8e16e7a六份。千章开书62.2–126ms、目录28.1/55ms、WebKit百书211–224ms，本机Windows/未限速移动视口，不证明真机帧率或30分钟内存。
- Wrangler上传exit0，新唯一https://eead9a60.jingye-reader.pages.dev/，稳定https://jingye-reader.pages.dev/；3变动/12复用加_headers，16文件2248215字节。preparedAt 2026-10-03T04:55:14.628Z，main index-D6DruWuc.js；parser/CSS不变。唯一与稳定各15资源SHA/安全缓存头第一次全部通过，checkedAt 2026-10-03T04:56:42.314Z/2026-10-03T04:56:48.887Z。统一Node gzip主包86.96/CSS5.09/parser86.71/SW3.44KB，总182.20KB，比d28cf96f增加0.20KB，字体另1.53MiB。安全15惰性URL/12用途及SW12预缓存、字体/许可/分享通过；只上传dist。
- session72445已exit0，上传前两个旧B9客户端实际保存原创TXT/进度/书签/笔记，唯一/稳定资源核验后release-live-update释放门。run 6c46577a-02f3-4ff8-a5e2-6e24044ca491真实B9→D6，两条pass；阅读文档不刷新、回书架显式更新、七表/原文SHA一致、新缓存SHA与重开标注通过，只快进窗口计时器。旧HTTP报告在忽略run目录保留。session29006 HTTPS核验及门释放exit0；session27719新版另四条真实HTTPS Worker/IDB/SVG/备份流程exit0，Chromium断网重开翻页通过，WebKit只计在线。
- 所有上述测试与上传会话已结束；文档整理后尚须最终lint/test/build及16上传文件/两组15HTTPS字节复核，结果补记于下。Goal active，不标完整M2/M3或Goal完成。下一具体任务补M2-04/05实际手势/动态媒体/浮层退出/单手区域浏览器回归；物理Android/iOS、7天真实自用、Git身份/远程/CI、自定义域名/正式许可与反馈、DATA-01真机峰值继续保留。

最终收尾：session87079已exit0，文档整理后pnpm lint、75文件337项单测、strict TS与生产build全部通过；重建16文件路径/大小/SHA完全匹配本次上传清单、唯一与稳定各15资源报告及21本兼容套件生产首页SHA，preparedAt未重生成。所有本轮测试/上传会话均已结束，无待终态进程。44张选定正文复核及原生逐行框检查通过，先前缩放表格截图的页底疑点未复现实际越界，未为此修改产品排版。Goal仍active、无token预算；下一具体动作M2-04/05独立浏览器动态/单手/浮层退出与选区冲突验收，仍不标完整Goal/M2/M3或物理手机与7天门槛完成。此补记仅需文档格式/lint，不重复未变化的浏览器套件。

## 持续执行检查点：M2-04/05原生交互回归中（2026-10-03）

- 新增双引擎八项原生交互验收；直接观察Web Animations、CSS退出、可信touchscreen事件与实时减弱动态，不替换动画或计时器。DOM Range用于设置文字选区，不能代替物理手机长按选词验收。
- 找到并修复单手左上返回按钮绕过选区保护：选区或标注编辑时禁用，处理函数同时检查阻挡标志和原生选区；退出后仍能返回。原件、段落、定位、备份和解析器均不变。
- 独立运行a81e97b0-20d7-4b61-b206-a8e9daffaec2八项全通过；六张选定交互截图已查看。当前生产主包index-BAqh-t_b.js，全部JS/CSS182.22KB gzip。线上仍为eead9a60/index-D6DruWuc.js，修复尚未上传。
- 最终顺序进程94337仍在运行：lint、75文件337单测和build已通过；70项完整E2E及严格报告、双版本更新/长章/偏好/性能/分享/备份桌面校验待进程终态。继续轮询同一进程，不能因观察超时重启。不得在此进程结束前修改测试、源码及排队的采集脚本。
- 上述完整回归结束后复核该运行截图，再准备部署、启动真实旧HTTPS客户端、上传jingye-reader/main、验证唯一与稳定URL的15资源、释放升级验收、补线上四项；最后更新文档并再次lint/test/build。21本真实EPUB证据保持上一D6构建的历史范围，不冒称新主包已重复42项语料验收。物理手机/7天自用仍待独立验收。

## 最新检查点：M2-04/05原生交互与选区保护（2026-10-03，已部署）

- 独立八项运行a81e97b0-20d7-4b61-b206-a8e9daffaec2 exit0；最终完整70项进程94337 exit0，69pass/1既有Windows WebKit离线模拟skip，零失败/重试，六张分页像素基线未改。lint、75文件337单测与strict TS/build通过。HTML源SHA e5330249ebf2d242b2cd81c346e48b9bdfb43e1bcd33993299c08d74a24a5377已在部署测试前严格保存，实际十三本备份两份下载属于本轮；Windows独立解压26原文大小/SHA一致。
- 新增e2e/interactions.spec.ts、interactionProbe.ts、interactionSetup.ts及独立配置/check:interactions。当前完整run c6caaad4-a880-4078-b79e-22f70b7d7963；首页SHA 9b78123ea550e8d7e8bf02472ee561b6869396bf0b45dd15ad98970c168d1946，六个源码SHA锁定，严格采集八份实际passed/无外部请求/CSP/原件SHA报告，原始结果SHA e4e2ffb40999c2c6f2f134605a536f3daee41976bd16e772ae2999a2fb63c1f1，副本D:\电子书阅读器\.e2e-interactions\c6caaad4-a880-4078-b79e-22f70b7d7963-results.json。不是用上次独立结果补项。
- 四个场景×两个引擎：可信touchscreen单手左右next/左上previous、菜单正文只关闭、正常点按方向、横竖窗口和重载；选区返回不翻页、笔记输入方向键不翻页并可保存；原生平移220ms/淡入160ms/无动效、真实中间绘制、reduce即时cancel且恢复后继续；菜单180ms/抽屉240ms退出时inert/aria-hidden/pointer-events:none，reduce无CSS动画。Element.animate仅转发/观察原生调用，不替换动画、时钟或解析；选区是DOM Range设置、媒体用浏览器接口模拟。
- 真正产品错误是左上返回直接调用engine.turn绕过选区保护；ReaderView.tsx现在有选区/标注编辑时disabled，处理函数同时检查blockedRef和原生选区。修复前两引擎可信触摸目标为返回按钮，页2→1；失败原始证据保留interactions-before.json。另三个验收问题分别是隐式select标签包含选项、菜单遮挡角落坐标实际点了返回书架、全屏与横屏页内锚点判断，已按真实目标/退出全屏/同列几何校正；没有虚构对应产品Bug或修改页内位置规则。
- 六张选定截图本轮与已逐张查看的a81运行SHA完全一致，interactions-visual-review.json逐项记录来源及字节；横竖正文、52px返回控件和原生选区/禁用角落可见。此记录不证明全书/物理手机长按/传感器旋转/滑动或拇指舒适度。
- 本轮更新六份、长章42d539eb-3d16-4628-ac36-6445e7f4f867六份、偏好3861e6b9-994b-4c26-a7f2-b20c4071ff24十份、分享0c945128-94ca-44af-af21-2281604fea5c六份、性能3c62e15c-df64-4755-ad88-27c422b5ab16四份均严格汇总通过。未限速Windows移动视口千章开书61.1–152ms、目录27/27.5ms，WebKit百书220–229ms；不证明真机55fps/30分钟RAM。
- Wrangler上传exit0：https://3a4c2d69.jingye-reader.pages.dev/，稳定https://jingye-reader.pages.dev/。16静态文件2248306字节，3变动/12复用加_headers，仅dist。main index-BAqh-t_b.js，parser parse.worker-DGhdd5kn.js与CSS不变，原件/段落/UTF-16/schema/parserVersion/备份无变化，零新依赖。preparedAt 2026-10-03T05:20:54.337Z；唯一/稳定各15资源SHA/安全缓存头第一次通过，checkedAt 2026-10-03T05:22:04.121Z/2026-10-03T05:22:10.331Z。Node gzip main86.98/CSS5.09/parser86.71/SW3.44KB，总182.22KB，比D6增加0.02KB，字体另1.53MiB；静态安全/PWA/许可/字体检查通过。
- 真实旧D6→新BA更新进程24011 exit0，两条pass，run 5a366971-21b7-4fc8-b1a0-66be1c9f8dbb。上传前两个客户端通过UI保存原文/进度/书签/笔记；HTTP唯一与稳定核验进程69351 exit0后释放门，阅读旧文档不刷新、回书架显式更新、七表/原件/新缓存SHA及重开标注一致，只快进窗口计时器。严格采集完成；旧HTTP在本轮忽略目录保留。新版HTTPS进程58474 exit0另四条通过，Worker/IDB/重载/SVG/ZIP恢复与Chromium断网通过，WebKit只计在线。
- 线上套件曾继承默认JSON路径，已把其实际4条原始结果另存deployment-browser-results.json，并从SHA锁定副本恢复70条完整JSON，随后配置独立报告路径避免再覆盖；未篡改原始结果。21本EPUB42项/44截图继续为D6历史证据，未冒称BA主包重复了该独立套件。
- 所有测试/上传进程已终态；整理文档后尚须最终lint/test/build及重建16文件与唯一/稳定15资源字节复核。Goal仍active；下一具体任务M2-02/03原生引导/环境窄屏与键盘流程，然后可信拖动/其余未覆盖交互。物理Android/iOS、7天自用、Git身份/远程/CI、自定义域名/正式许可反馈、DATA-01真机峰值继续待办。

## 本轮Goal最终收尾（2026-10-03）

- 用户最新要求：“这个Goal差不多了，完成最后的代码检查、构建即可。”据此结束本轮持续开发；不再自动推进首次引导/环境提示或其他新增任务。
- 最终进程33313 exit0：pnpm lint、75文件337项单测、pnpm build（strict TypeScript及生产构建）全部通过；正式产物静态安全、PWA/离线资源/字体/许可及统一gzip检查通过。此前文档收尾时Windows解压报告仅有Prettier格式告警，格式化后检查通过，非产品失败。
- 最终dist的16文件路径/大小/SHA与3a4c2d69上传清单完全一致；稳定和唯一URL各15公开资源报告均匹配重建字节，preparedAt未重生成。完整70项原始JSON仍为69pass/1既有环境skip，SHA锁定副本一致；六张选定交互截图SHA与已查看记录一致。没有重新上传或重复未变化的浏览器套件。详细结果保存artifacts/final-checks-2026-10-03.json。
- 本轮执行完成。仍未完成的物理手机、7天真实自用、大库峰值、部分界面/拖动验收、Git作者/远程/CI、自定义域名/正式许可与反馈保留在ISSUES.md；不标完整开发计划或全部M2/M3验收通过。

## 验收审查检查点（2026-10-03，Devin，未部署）

- 用户要求对已上线版本做验收、审查并修复 Bug。基线 lint、75 文件 337 单测、build 通过；本机 Pixel 7 视口 Chromium 手动探索覆盖导入、阅读、排版、标注、备份恢复、删除。
- 修复 REV-01 慢速拖动不翻页/中途冻结（src/reader/gestures.ts、src/pages/Reader/ReaderView.tsx），REV-02 全书末页进度不到 100%（src/reader/ReaderEngine.ts），REV-03 排版面板遮挡正文与关闭后状态残留（ReaderView.tsx）。单测更新 reader.test.ts、ReaderEngine.test.ts；无新依赖、无 schema/备份格式变化。
- 修复后 lint、75 文件 337 单测、build 通过（主包 index-Bp7wPVew.js，87.93 KB gzip）；Pixel-7 Chromium E2E：reading/preferences/image-layout/pagination/long-chapters 12 项与 interactions 4 项全部通过（--reporter=line，未生成严格 JSON 报告；setup 重新生成了 *-run.json 与部分 evidence 截图）。WebKit 浏览器未安装，未复验；物理手机未验收。
- 线上 jingye-reader.pages.dev 仍为 3a4c2d69 旧版本，需按部署流程重新上传后才能生效。详见 ISSUES.md「2026-10-03 验收审查」。

## 验收审查第二轮（2026-10-03，Devin，已部署）

- 用户要求修复剩余三项并重新部署。REV-04 返回键逐层关闭阅读浮层（新增 src/app/useBackClose.ts 及 2 项单测，接入 ReaderView），REV-05 已持久化时隐藏申请按钮（SettingsPage），REV-06 划线菜单窄屏单行（AnnotationMenu、reader.css）。无新依赖、无 schema/备份格式变化。
- lint、76 文件 339 单测、build 通过；本地 E2E Pixel-7 35/35、iPhone-14 34 通过/1 既有 skip、交互配置双引擎 8/8（--reporter=line，未生成严格 JSON 汇总）。
- Wrangler 上传 https://b079dae3.jingye-reader.pages.dev/ ，稳定 https://jingye-reader.pages.dev/ ；两地址 15 资源核验与线上 4 项浏览器验收通过。未跑 live-update 旧客户端升级用例；物理手机与 7 天自用仍待验收。

## UI 优化第一批（2026-10-03，Devin，未部署）

- 西文断词：src/reader/language.ts 按正文抽样给阅读根设置 lang（en/zh-CN），`:lang(en)` 启用 hyphens:auto；新增单测。中文排版不变。
- 视觉统一：界面字体改为无衬线，h1/h2/书名/封面保留衬线；按钮统一 4px 圆角与浅色描边（--line），返回/关闭等导航按钮无边框；装饰分隔线改用 --line，输入框保留原对比度。
- 书架：行高 176→140（e2e 与单测中的行数上限同步调整），细进度线、未读/已读完文案、⋮ 操作按钮、“导入书籍”为主操作。
- 环境提示改为左侧色条细提示，“知道了”按提示类型写入 settings.environmentNoticeDismissed，永久不再显示。
- 导入结果改为紧凑列表（状态符号+文件名+状态，成功行整行可点开阅读，无障碍名称仍为“阅读《书名》”）。
- 回归中发现并修复：触摸点按在 pointerup 打开/关闭菜单后，浏览器合成的 click 会落到刚出现在指下的按钮（如“目录”）；现只拦截同一位置 400ms 内的那次 click。阅读菜单底栏收紧间距，iPhone 14 视口高度 324→196px。
- 分页像素基线 6 张因页眉/页脚改为无衬线而重新生成（查看了 Pixel-7 第 1 页差异图：仅页眉、页脚与菜单按钮字形变化，正文未变）。
- lint、77 文件 340 单测、build 通过；完整 E2E 双引擎 69 通过/1 既有 skip。

## UI 优化第二批（2026-10-03，Devin，未部署）

- 排版控件（src/components/ReadingControls.tsx，阅读页与设置页共用）：字号改为 A−/A+ 步进（14–28）；字体、行距、段距、页边距、对齐、翻页动效、点按模式、常亮改为分段单选；主题改为纸色圆块（跟随系统时为“浅色主题”且不含墨黑）；三个开关改为整行。排版面板最高 45dvh。
- 阅读菜单（ReaderView.tsx）：顶栏为“‹ 书架”、书名、书签图标（aria-pressed）；底栏为“‹ 进度条 ›”与“目录/排版/全屏/更多/继续阅读”五个图标按钮；安静提示、切换编码、常亮状态移入“更多”。新增 src/components/Icon.tsx 线性图标。无障碍名称保持“返回书架/添加书签/移除书签/上一页/下一页/排版与主题/全屏阅读/退出全屏/目录/继续阅读”。
- 首次点按分区提示（src/components/TapHint.tsx）：首次进入阅读页显示上一页/菜单/下一页三栏（单手模式另有左上角说明），不拦截操作，按下或 3 秒后消失；settings.tapHintSeen 记录已显示，沿用 quiet-hint 类名。
- E2E：helpers 新增 option/choose/setFontSize/openMore，替换 7 处 selectOption、安静提示和切换编码入口；data.test 改为检查浅色主题色块。新增 ReadingControls/TapHint 单测 2 项。
- lint、78 文件 342 单测、build 通过；完整 E2E 双引擎 69 通过/1 既有 skip。

## UI 优化第三批（2026-10-03，Devin，未部署）

- 自动生成封面（BookCover.tsx + reader.css）：书名散列取 8 种纸色之一并与主题底色混合，右侧书脊细线，竖排书名居中并允许换列，封面 60×88。EPUB 实际封面不变。
- 目录快速定位（ContentsDrawer.tsx）：目录条目超过 40 时显示“回到当前 / 跳至 N 章 / 前往”工具行，跳至按章节号定位首个不小于目标的目录项并聚焦该行。
- 设置页分组：三组“阅读（默认排版、阅读习惯、可选字体）/ 数据（本地存储、备份与恢复、清空数据）/ 应用（离线与更新、使用引导、关于）”，组名为小号加宽字距标签，组内标题降为 h3；备份 region 的 aria-label 不变。
- 夜间主题（base.css）：`--line` 在 [data-theme='night'] 下降为 30% 混合，菜单/抽屉/控件描边更暗。
- 选区（reader.css）：`.reader ::selection` 用主题色 26% 混合淡底，替代系统亮蓝。
- 宽屏：≥900px 时阅读页眉页脚字号 11→13px。书架网格与双页并排仍未做。
- 动效（motion.css）：阅读菜单保留整体 180ms 淡入淡出，顶/底栏新增同速上下滑入滑出；抽屉 240ms 侧滑不变；减弱动态仍全局禁用。interactionProbe 只采样 `.reader-menu`/`.reader-drawer` 元素本身，断言不受影响。
- 已跑套件：lint、342 单测、build、interactions+storage-layout 双引擎（11 过 1 既有 skip）、preferences+font（14 过）、pagination+reading+about（8 过）。全量套件双引擎 69 通过 / 1 既有 skip（Windows WebKit 离线用例）。
- 视觉复查截图（.review/shots/b3-*.png）：浅色/夜间书架封面、目录工具行、夜间排版面板与抽屉、设置分组、桌面书架与阅读页，均已查看。
- 部署：已上线 https://jingye-reader.pages.dev/（构建 https://71d271ef.jingye-reader.pages.dev），双地址 15 资产 SHA/安全头一致，线上浏览器套件 4/4 通过，详见 DEPLOYMENT.md。

## Markdown 首版（2026-10-09，本地验收完成，未部署）

- 用户批准先完成 MD 首版，目标为普通文章与 AI 导出的 Markdown。DEV_PLAN.md 的 MD-01～MD-05 均已实现并通过自动检查及浏览器验收；物理手机体验仍待验证。
- 支持 `.md` / `.markdown` 文件导入及粘贴时显式选择 Markdown，粘贴默认仍为纯文本。支持六级标题与目录、段落与强调、引用、嵌套列表、只读任务标记、分隔线、代码块与行内代码；表格按行展示为带列名的卡片。代码保留缩进并按阅读宽度换行，已有主题、分页、进度、书签、划线和笔记已接入。
- 标题锚点可在本书内跳转，外链仅显示与复制地址，不导航或发起网络请求。HTML 原样显示为文字；图片保留说明并提示暂不加载，公式和 Mermaid 显示源码。首版不加载本地相对图片，不支持 Obsidian 双链、公式绘制或代码高亮。
- 解析在 Worker 内完成，Markdown 安全节点的 DOM 文本与定位原文一致。文件 ID 使用 `md:<原始字节 SHA-256>`，粘贴文稿使用 `paste-md:<UTF-8 源码 SHA-256>`，保留原始内容；Markdown 解析版本为 1，TXT/EPUB 的标识和解析规则不变。备份导出版本升至 v4，新版继续读取 v1～v3，v4 校验 Markdown 格式、标识和解析版本。修改标题保留标注，切换文稿格式沿用内容变更确认。
- 新增运行依赖 `marked@18.1.0`（MIT），只使用 GFM Lexer，避免自行维护完整语法。隔离生产压缩测得 Lexer 为 13.44 KB gzip；最终解析 Worker 为 101.86 KB gzip，较实施前增加 15.15 KB。全部 JS/CSS 为 202.90 KB gzip，较实施前 186.02 KB 增加 16.88 KB；许可清单已更新至 21 个运行组件。
- 最终源码检查：`pnpm lint`、`pnpm test`（81 文件 / 357 项）、`pnpm build`（strict TypeScript / Vite）全部通过。安全 URL/CSP 检查、PWA 静态缓存与 MD 文件处理声明检查通过，`pnpm audit` 无已知漏洞。最终主包为 `index-C5eznEPa.js`，Worker 为 `parse.worker-Dw-tZdgJ.js`。
- 完整浏览器回归原始结果为 78 项中的 76 通过、1 既有 Windows WebKit 离线模拟 skip、1 WebKit EPUB 长章节截图超时，保存在 `artifacts/full-browser-results.json`。该长章节在最终构建单独复验 1/1 通过（30.3 秒），原始超时证据保留；复验报告为 `artifacts/webkit-long-retry-results.json`。不将完整回归原始运行记为全部通过。
- 最终 MD 专用套件 8/8 通过（Chromium Pixel-7 / WebKit iPhone-14 视口，40.5 秒），无 skip、失败或重试。覆盖文件/粘贴、目录/外链键盘操作、长链接分页、表格/代码、HTML 安全、零外部请求、夜读、完整备份恢复与原始字节、进度/书签/划线恢复；原始报告为 `artifacts/markdown-browser-results.json`。八张选定截图保存于 `.review/shots/markdown/` 并已逐张查看，最终表格截图等待首次点按提示消失后采集。以上为浏览器模拟视口验收，不代表物理 Android/iOS 验收。
- 本地预览为 http://127.0.0.1:5173/ ，原创示例为 `test-books/markdown-demo.md`（忽略目录，不提交测试素材）。MD 尚未部署，线上仍为 https://71d271ef.jingye-reader.pages.dev/ 对应版本。没有创建新 Goal 或子代理；Git 仍无作者配置且原有文件未提交，未伪造身份或批量暂存历史文件。

## Markdown 第二版本地验收（2026-10-09，随后上线记录见下节）

- 用户选择全部增强，MD2-01～MD2-05 已完成实现及本地检查。新增行内/块公式、八类语言代码高亮、脚注与多段定义、同文档标题双链、本地图片图文包，以及常用 Mermaid 图表。仍然只在本机处理，不请求外部图片、字体或 CDN；原始 HTML 按文字显示，不支持的公式/图表保留源码。双链仅跳同一文档标题，不提供跨书或 Obsidian 库管理。
- 图片通过 `.md.zip` / `.markdown.zip` 导入，包内一个正文及图片文件夹；复用有界 ZIP、路径与 CRC 校验，检查位图签名并净化 SVG。原始 ZIP 字节完整保存，图片与原件随完整备份往返；轻量备份补导同一原件。输入、条目、解压与图片数量上限见 PRD 第 17 节。支持只有图片的文章与 URL 编码的相对图片路径。
- 新文档 Markdown 解析版本为 2，现有 v1 阅读、恢复、重复导入、缺文件补导及仅标题编辑沿用旧规则；不会自动重解析旧书。导入与编辑先识别原件及已保存版本，避免被 v2 禁止的重复脚注破坏旧书。原始指纹命名空间、UTF-16 定位与备份 v4 保持；公式/图表视觉文字不计入位置，源码单独保留，高亮须保证正文完全一致。旧首版应用不能恢复 v2 Markdown 元数据。
- 增加 KaTeX 0.19.0（MathML 公式、无额外数学字体）、highlight.js 11.12.0（核心与 JavaScript/TypeScript/Python/JSON/CSS/HTML/XML/Shell/SQL）、DOMPurify 3.4.16（渲染净化）、Mermaid 12.1.0（本地图表）。隔离生产压缩分别为 76.95、20.30、11.03、1465.72 KB gzip；Mermaid 数值包含动态图表/布局及共享依赖，隔离值不可相加作为应用体积。`pnpm-workspace.yaml` 同时覆盖间接 KaTeX/DOMPurify，已知漏洞审计为零；原始结果 `artifacts/markdown-v2-dependency-audit.json`。完整许可通知共 138 项，包含包内声明依赖；未保留评估过的 tiny 库。
- 最终源码 `pnpm test`（84 文件 / 369 项）、`pnpm build`（strict TypeScript / Vite）通过；收尾 `pnpm lint` 通过。生产主包 `index-DSPm7wbM.js` 为 91.85 KB gzip、CSS 为 7.15 KB、解析 Worker `parse.worker-CEvcQ8zu.js` 为 103.59 KB、公式/高亮净化模块为 108.68 KB。全部 JS/CSS 含按需图表及 Service Worker 为 1695.02 KB gzip，较首版 202.90 KB 增加约 1492.12 KB，主要来自完整 Mermaid。初始主包加 CSS 为 99.01 KB，但离线准备仍缓存全部图表模块；该增长明显超过原 150 KB 参考目标，不能计为小幅超出。原始体积报告 `artifacts/markdown-v2-size.json`。
- 完整浏览器回归 86 项中 85 通过、1 既有 Windows WebKit 离线模拟 skip，630.2 秒，无失败/重试；原始结果 `artifacts/full-browser-results.json`。此轮之后截图发现高流程图外框导致末尾空白页，随后只调整 MD 图表的高度预留与容器分页，未改解析器或原有像素基线。最终构建的 MD/图片/分页专项 20/20 通过，169.9 秒，无 skip/失败/重试；`artifacts/markdown-v2-browser-results.json`。完整 86 项没有在这项 CSS 修正后再全部重跑，最终 20 项覆盖受影响的图表和原有图片/分页。
- 专项使用 Chromium Pixel-7 与 WebKit iPhone-14 模拟视口，实际操作文件/粘贴、公式后的划线、标题与脚注跳转、流程图/时序图、图文原件与完整备份清空恢复、v1 恢复与重复导入、不可信输入回退、零外部请求及 CSP。图表要求实际当前页整图可见，只有标题和图表的章节不留尾部空白页。公式/代码、流程图、时序图、本地图片八张选定截图在 `.review/shots/markdown-v2/`，均已复查。选区通过 DOM Range 设置，不代表真机长按；物理 Android/iOS 仍待验收。
- Chromium 在真实断网状态重开 v2 公式/图表并确认 `navigator.onLine === false`；WebKit 只验证缓存就绪后的在线重开，既有环境故障未冒充离线通过。生产安全检查审查 103 个惰性 URL，PWA 静态检查 110 个资源全部字节一致，Worker/图表模块可缓存、可选字体未预缓存、外部请求不拦截、更新仍须显式触发。静态 Node 检查与浏览器离线证据分别计数。
- 原创体验包 `test-books/markdown-v2-demo.md.zip` 演示六项增强，目录被忽略。本地开发 http://127.0.0.1:5173/ 已在隔离的 Chromium 移动视口实际导入该包，逐项打开公式、高亮、图片、两种图表、双链与脚注，无页面异常。开发服务器依赖优化期间曾自动重载并取消首次导入，预热后通过；生产构建验收不涉及 HMR。MD 第二版尚未部署，线上仍为 https://71d271ef.jingye-reader.pages.dev/ 。没有新 Goal、模型切换或子代理；Git 仍未配置作者、历史文件未提交，未批量暂存或伪造身份。

## Markdown 第二版部署验收（2026-10-09，已完成）

- 用户明确要求部署上线。确认原 OAuth 账户内已有 jingye-reader，生产分支 main 与 reader.surveykit.cc 归属未变；CLI 生产记录确认最终部署 `f4b42eaa-eb40-4d5c-8073-7f4f0b4e1aad`，唯一地址 https://f4b42eaa.jingye-reader.pages.dev/ 。发布仍为本地构建 Direct Upload，没有新域名、Git 身份、子代理或新 Goal。
- 发布前与 SW 缓存修复后，lint、84 文件 369 单测、strict TypeScript / Vite 构建、安全 103 惰性 URL、PWA 110 静态缓存检查通过。清单检查拒绝未列入真实 SW 的指纹资源和非运行 JSON，临时探针已清理；最终只上传 dist 的 114 文件、7744280 字节，无书籍、用户数据、凭证或 source map。全 JS/CSS gzip 1695.02 KB、初始主包加 CSS 99.01 KB，未新增部署依赖。
- 首次 MD 部署 `2f07f9db`：唯一与稳定各 113 资源通过；线上常规 4/4（59.0 秒）、MD 8/8（96.7 秒）、实际旧 UI 版到 MD 版更新 2/2（342.8 秒）通过，均无 skip、失败或重试。更新 run 为 `4d666e86-4ce9-42cc-89fe-699cbe7dcf33`；旧 main `index-B-bale6t.js` 到 `index-DSPm7wbM.js`，七表、原文 SHA、书签/进度/笔记保持，阅读中不刷新，回书架显式更新才切换。仅窗口计时器快进，实际 HTTPS/SW/IDB 不模拟。
- 发现自定义域名 SW 返回 `max-age=14400`，只在 public/_headers 为 `/sw.js` 加入浏览器与 Cloudflare CDN 的 no-store 规则。再次部署 113 文件全部复用，仅上传 _headers；两份清单核对所有公开资源的大小与 SHA 完全一致，只有 _headers 增加 79 字节。实际自定义域名现在返回 `no-store, no-cache, max-age=0, must-revalidate`、`CF-Cache-Status: BYPASS`。没有更改全站缓存或凭证。
- 最终唯一、稳定与自定义地址各 113 公开资源全部匹配大小/SHA/CSP/nosniff/no-referrer/DENY 与缓存规则；均绑定 preparedAt `2026-10-09T13:52:28.057Z`，稳定 checkedAt `2026-10-09T14:02:17.020Z`。最终常规 4/4 再跑通过（55.6 秒），原始 `artifacts/deployment-browser-results.json`。正式地址前两次完整检查分别发生连接中断、超时，自定义域名首次传输另有超时；重跑完整成功记录与失败区别保留，HTTP/SHA/安全断言不放宽，传输重试单独记录。
- 原始首发构建、三份 HTTP、线上 4/8/升级 2 与严格升级汇总保存在 `artifacts/deployment-history/markdown-v2-first-2f07f9db/`；此前 UI 站报告另存 `pre-markdown-v2-20261009-*`。首发两项升级与八项 MD 没有重绑定到仅缓存头修复的最终上传。线上公式/代码、流程图、时序图及本地图片四张选定截图已查看，位于 `.review/markdown-v2-online/`，与本地八张截图独立。
- Chromium 真实断网启动及公式/图表重开通过；Windows WebKit 仅计在线缓存重开，仍不声称 iOS 真机离线。物理手机、原生长按/安装/分享、中端机性能、大库峰值与七天自用继续待验收。旧安装回书架点击“点击更新”，跨域本地书架仍独立，完整备份可用于迁移。本轮部署已完成，不自动启动其余阶段。

## MD 功能 UI 规范统一（2026-10-10，Devin，未部署）

- 审查结论：MD 功能大部分符合既有规范——链接弹窗复用 Modal/panel-actions、书架格式标签沿用 TXT/EPUB 短大写（MD）、代码块/表格/引用均使用 var(--line) 描边、hljs 配色含夜间覆盖、链接有 44px 行高热区与键盘可达。
- 修正三处不一致：
  - 粘贴页“正文格式”由带边框 fieldset + 18px 原生单选改为全局统一的 .segmented 分段控件（单选 input 保留，E2E 按名称选择不受影响）；删除 reader.css 中遗留的 .draft-format 系列样式。
  - a[data-md-link] 补 text-underline-offset: 3px（对齐 .resource-link），移除对 inline 元素无效的死代码 min-width/min-height。
  - MD 代码块边框补 border-radius: 4px（对齐全站控件圆角）。
- 保留未改：MD 标题 font-weight:600——font-synthesis:none 下无真实粗体字重的衬线字体（如 SimSun）会渲染为常规字重，h4–h6 仅靠字号区分；改为 normal 会失去层级，故保留。Mermaid 图 background:#fff 为图表可读性所需，保留。MD 引用块用 var(--line) 而非笔记弹层的 var(--accent)，属刻意区分书内容与界面引用。
- 验证：lint、372 单测、build 通过；markdown 套件 8/8、sharing 6/6、markdown-v2 套件 20/20（含分页像素基线）双引擎通过；截图已查看（粘贴页分段控件、MD 正文、夜间主题）。
- 部署：已上线 https://jingye-reader.pages.dev/（构建 https://82d9609d.jingye-reader.pages.dev），双地址 113 资产 SHA/安全头一致，线上套件 4/4。deployment.live.ts 的 SW 激活轮询放宽到 60s（约 6MB 预缓存安装实测 ~13.6s）。

## Android 打包 A0–A1 实施（2026-10-10，Devin，真机部分验收）

- A0 完成：Android Studio + JDK 21 + SDK 36 + adb 链路打通；最小壳 debug 包装上荣耀 PTP-AN10（Android 16）。逐项实测记录在 ANDROID_PLAN.md 第 9 节。
- A1 主体落地：`src/app/platform/` 平台层（isNativeApp/nativeApp 动态导入，网页构建零增量）；`vite --mode android` 不生成 SW；自定义 `JyNative` 桥插件提供 pickSaveTarget/writeUri（SAF 分块写）、shareChunk/shareCacheFile（系统分享）、keepAwake、setImmersive、statusBar、openUrl、consumeLaunchFile/readUriChunk/incomingFile（外部打开导入）；返回键接管覆盖 dialog/useBackClose/页面/退出四级。
- 修的真问题：旧 SW 会服务旧资源（加 cleanupServiceWorkers 启动清理）；Modal 浮层不吃返回键（dispatch cancel）；target=_blank 在 WebView 全死（原生 openUrl）；targetSdk 36 下 setStatusBarColor 失效（改 DecorView 上色）；downloadBlob 原生分支未返回 Promise（取消保存会静默吞错）。
- 自动检查：pnpm lint / 372 单测 / build 全通过；android 构建+cap sync+gradlew assembleDebug+install 全通过。
- 真机已验：导入三格式、SAF 保存落盘 /sdcard/Download、系统分享面板、返回键四级、外链开系统浏览器、沉浸模式、米白/墨黑状态栏（截图在 .review/）。
- 未完成：SAF 手动选位置体验、分享实际发出到目标 App、恢复备份链路、剪贴板读取、浅灰/护眼绿状态栏复核、A1-06 全量回归、A2/A3 全部。

## Android A2 原生增强（2026-10-10，Devin，真机验收）

- A2-01 打开方式/分享到：Manifest 注册 VIEW（MIME + 扩展名两组过滤）、SEND、SEND_MULTIPLE；JyNative describeIntent 输出 items[]+text，多文件与纯文本分享均支持，单文件失败记入 IncomingData.errors 不阻断其余；文件名缺扩展名时按 MIME 补后缀（importText 按扩展名分发）。实测：file:// VIEW intent → #/incoming/ 流程，读取失败如实入列。
- A2-02 音量键翻页：MainActivity.dispatchKeyEvent 拦截（repeatCount>0 消费不翻页）；JyNative setVolumeKeys/volumeKey 事件；阅读页 overlayOpen 或离开阅读页即恢复调音量；ReadingSettings.volumeKeys 默认关、随备份导出、控件仅 App 显示。实测音量减下一页、加上一页、菜单中不翻页。
- A2-03 图标与启动画面：自适应图标（纸色 @color/ic_launcher_background + 书形矢量前景 drawable-v24/ic_launcher_foreground.xml）+ API24/25 位图兜底（PIL 生成圆角方形/圆形）；启动画面改 Theme.SplashScreen 正确属性（纸色底 + drawable/ic_splash 矢量书形），实测冷启动纸色卡片+书形图标无白屏。
- 自动检查：lint / 372 单测 / build 全通过；APK 构建+安装通过。
- 待手动验证：真实文件管理器/微信/QQ 的 content:// 打开与分享、桌面图标显示、EXTRA_TEXT 纯文本分享落地粘贴页。

## Android A3 签名发布（2026-10-10，Devin，真机验收）

- 签名：keystore 在仓库外 `D:\Android\keystore\jingye-release.keystore`（CN=Jingye Reader，SHA-256 证书 `c666e187…e22949`）；`android/app/build.gradle` 从 `android/keystore.properties` 读签名（该文件与 `*.keystore`、`release/` 均已 gitignore）。密码仅存于本机属性文件，未入对话与仓库。
- 产物：`release/jingye-reader-1.0.0.apk`（6.5MB，APK SHA-256 `397721f5…c4b6b0`）；包名 `dev.jingye.reader`，versionCode 2 / versionName 1.0.0（versionCode 1 为内部构建，仅用于升级测试），minSdk 24 / targetSdk 36。
- 验证：`apksigner verify` 通过；`aapt dump permissions` 确认无 INTERNET。荣耀侧载弹安全确认（预期），勾选后正常安装启动。
- 升级与数据保留：code 1 → code 2 同签名 `install -r` 成功；升级前写入的「墨黑夜读」设置在升级后保留，直入书架无引导——IndexedDB 数据完整。最终发布包重载后手机上运行的即发布文件。
- 注意：release 构建的 WebView 不可远程调试（CDP 无响应），真机验证以 `input tap` + 截图进行；后续真机回归用 debug 包。
- 未完成：GitHub Releases 发布待 `gh auth` 与用户确认；签名密钥两份离线备份需用户执行；A1-06 全量回归继续观察。

## 听书计划 v2（2026-10-10，Devin，仅文档）

- `TTS_PLAN.md` 改写为 v2：安卓原生 `TextToSpeech` + 前台媒体服务为主线（锁屏/后台、通知与锁屏控制条、耳机键），网页 Web Speech 降为 T3 仅前台降级。架构为“原生负责读、网页负责排”：TS 分句定位并按批交给原生，原生按句暂存进度，前台/冷启动对账，以应对锁屏期间 WebView JS 可能冻结。
- 不新增第三方依赖（框架 MediaSession / Notification.MediaStyle）；仍不申请 INTERNET，新增权限限于前台服务、mediaPlayback、WAKE_LOCK 与 TTS 引擎 `<queries>`。隐私边界如实写明：TTS 引擎为独立 App，只选 `isNetworkConnectionRequired()==false` 的语音并显示引擎名称。
- 阶段：T0 真机探针 2 项、T1 安卓 MVP 8 项、T2 打磨与 1.1.0 发布 5 项、T3 网页降级 2 项、T4 神经语音可选 1 项。6 项待用户决策见第 9 节。未写产品代码；手机本轮未连接，引擎与语音清单留待 TTS-01。
