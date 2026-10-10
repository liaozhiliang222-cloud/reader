# 本地浏览器验收

`pnpm check:experience` 运行 17 项独立用例：两个引擎各七项引导/环境检查，Chromium 另三项通过 CDP 发送可信触摸，覆盖慢拖、取消、竖向滑动和选区/菜单冲突。没有 CDP 能力的 WebKit 不执行触摸拖动。三屏键盘操作、Tab/Shift+Tab 循环、Escape/浏览器返回、触发按钮焦点恢复、历史记录撤回、320px 布局与重载均有原生检查。模拟 UA、受控安装事件及 IDB 写入故障各有明确标记，不能记为系统浏览器、真实安装或手机系统故障验收。生产 HTML SHA、页面错误与外部请求附在每项原始结果中；结果保存在忽略的 `artifacts/experience-browser-results.json`，测试截图另行查看。

GitHub CI 使用 Windows Server 2025 与默认系统字体运行完整套件，通过 `JINGYE_PIXEL_BASELINE=windows-2025` 选择该环境独立的六张基线。本机原六张基线保持不变；首次 CI 的布局/换行一致但字形绘制不同，已确认两端 SimSun 文件 SHA 完全一致。按 [Playwright 环境要求](https://playwright.dev/docs/test-snapshots)，在独立诊断分支采集运行器图像并逐张查看后纳入 `pagination.spec.ts-snapshots/windows-2025/`，来源、环境、几何和六张 SHA 见 `review.json`；采集运行不计完整 CI 通过。报告作为对应 Actions 附件保留，不提交本机报告。完整套件要求全部 spec 和两个引擎（触摸仅 Chromium）齐备；不得自动更新基线、使用重试掩盖失败或引用上次成功报告。未知基线环境会立即报错。

运行 `pnpm exec playwright install chromium webkit`，再运行 `pnpm e2e`。使用独立生产预览端口4180和隔离会话；默认套件使用原创生成样本，真实来源书籍由独立兼容配置验收。

- Pixel7：Chromium，412×839 CSS px；iPhone14：WebKit，390×664 CSS px（描述符屏幕390×844）。引擎/视口模拟不能证明手机系统、原生长按选区、安装、分享或性能通过。
- `reading.spec.ts`：两个格式、两个引擎的实际文件导入、Worker解析、IndexedDB、翻页、重载进度、DOM Range选区划线、书签、ZIP下载、清空与恢复。
- `pnpm check:markdown` / `markdown.spec.ts`：MD/MARKDOWN 文件与显式粘贴格式，原生 Worker/IDB、表格标签、代码折行、目录和标题链接、外链地址弹窗及键盘操作、零远程图片请求、夜间主题、长链接跨页/分块、进度重载、划线/书签和完整 ZIP 往返的原始字节。HTML/公式/Mermaid 只显示源码。移动视口截图需人工查看，不能替代物理手机验收。
- `backup-staging.spec.ts`：十三本原创TXT/文稿（含1200118字节长文）ZIP实际Worker预览/恢复。Worker构造代理只转发到原生构造器并监听原始回复，不替换解析/RPC；核对预览仅含13本元数据、零Blob，逐书回复各有一本和对应原文。观察并转发原生IDB put事件，确认全部逐书暂存先于主库写入，恢复后暂存清除、原文SHA/书签/笔记/重载保留；导出时观察并转发原生Worker.postMessage与IDB get，确认初始入参没有原文Blob、此前未取原文，之后13份原文按files顺序读取；重新生成并实际下载ZIP，核对全部原文和CRC，导出元数据不带目录/章节摘要或本机Blob键。另验证最后一本位置校验失败时整库回滚、清理暂存并可重新恢复。报告与下载路径在artifacts/backup-export-browser；随后运行`.\scripts\check-backup-desktop.ps1`，只读取最近30分钟两份报告，以Windows Expand-Archive独立解压并核对26份原文大小/SHA，输出backup-desktop-extraction.json。不会向主库写测试夹具，不以此推断大型书库峰值RAM。正常取消、晚到RPC/字节/最终校验和活跃锁保护由定向单测补充，手机杀进程仍需独立验证。
- `pagination.spec.ts`：固定原创 EPUB 与默认排版前三页，本机/Windows Server 各六张系统字体基线已查看；等待短暂阅读提示消失，`maxDiffPixels: 0`。查看截图并核对环境后才可更新基线；其他 OS/字体须独立核验，不能将新截图直接当作验收成功。
- `image-layout.spec.ts`：原创图文EPUB，图片套在链接/span内，前三页、28px字号和横屏的实际图片边界检查。Android模拟在改变窗口大小前通过应用入口退出全屏；这不是手机传感器旋转验收。
- `pnpm check:interactions`：四个场景×两个引擎，使用真实touchscreen点按和no-preference动态媒体。单手两侧下一页/左上返回、正文点按只关闭菜单、正常模式方向、横竖窗口/重载位置；DOM Range选区期间可信点按返回被阻挡，笔记输入框中的方向键不翻页，退出后继续。观察原生Web Animations的关键帧/时长/中间绘制/finish/cancel，检查平移220ms、淡入160ms、无动效及实时reduce取消和恢复；观察菜单180ms与抽屉240ms真实CSS退出时inert、aria-hidden和pointer-events，reduce时无CSS动画。Element.animate包装只转发和记录，不替换动画、时钟或媒体。六张选定截图另行查看，不能从DOM/几何断言推断视觉通过。
- `pnpm check:long-chapters`：原创120001个UTF-16单位的单段TXT和1000段/157000单位长章，双引擎六项真实Worker/IDB验收，包括十二万字原创EPUB的注音/行内与空段图片/跨段笔记及ZIP恢复。第12000单位处跨块前后翻页、块内文本和原段落编号与源文核对；保存书签/笔记，字号28px、横竖窗口变化、重载后核对定位、标注与原文件SHA。实际Range行框位于正文列内，MutationObserver记录当前/邻块和临时空闲测量的DOM峰值≤4。进度跳转通过实际range输入/提交事件，选区使用DOM Range；不写测试数据库、不替换分页，不等同于手机拖动/系统长按。
- `pnpm check:pagination`：临时把行高乘 1.15，两个引擎必须因截图差异失败，再恢复源码原字节、构建并验证通过。使用 `playwright.pagination.config.ts`，不重建完整套件的更新/性能等运行清单，不覆盖完整 JSON/HTML；三份独立报告在 `artifacts/pagination-*.json`，包括所选基线环境。单独运行，避免与源码编辑/E2E并发；CI 在完整报告核验后也执行本项。
- `storage-layout.spec.ts`：24本书/60章目录的真实几何、虚拟窗口、End键导航，以及Chromium离线重载/Worker导入。
- `pnpm check:performance-browser`：同一原创千章样本（≥10MiB）与100份独立TXT经真实文件选择、生产Worker和原生IDB导入。每引擎三次千章开书/三次百书书架首屏，用捕获阶段实际click的浏览器时钟开始，等待真实排版与两次RAF；记录正文就绪和帧等待分段，分别检查1500ms、500ms、千章目录300ms。检查原文件SHA、末章重载、九处原生脚本滚动后的可见行覆盖、DOM上限与Home/End导航。原始报告包含成功/失败状态，汇总只接受本轮UUID的四份passed报告；阈值失败不生成通过汇总。结果是未限速的Windows引擎/移动视口局部证据，不等同于Android/iOS性能、首次4G加载、触摸流畅度、55fps或30分钟内存。
- `font.spec.ts`：点击前零字体请求、同源下载/校验、缓存重载、删除、错误字节及重试。故障注入用例关闭SW以可靠拦截网络；正常字体/PWA用例保留SW。
- `about.spec.ts`：版本、隐私、反馈模板与本地完整许可，正常流程零外部请求。
- `security.spec.ts`：恶意EPUB净化、生产响应头和meta兜底的预期脚本/连接/iframe阻断；所有正常用例由自动夹具收集CSP事件与控制台违规，不能只靠页面没有报错判断。
- `pnpm check:preferences`：五个场景×两个引擎，真实Worker/原生IDB验证误选编码再恢复、原文SHA与待确认标注保留、Markdown下载、旧标签预览/书签写入拒绝、取消后重试、系统深浅媒体实时变化与全局/单本主题隔离、30天边界和周期关闭重载、实际备份下载及旧快照后的新笔记提醒。取消场景只延迟真实Worker模块请求，并观察转发给原生terminate的调用；不替换解析/RPC，不据此宣称重CPU解析期间或手机取消已验收。日期与媒体由浏览器测试接口模拟，不修改操作系统设置。
- 编码/主题用例也检查窄屏展开排版时顶栏与底栏不重叠，返回书架按钮在视口内且可命中；底部选项超出可用高度时滚动。DOM Range选区限定可标注正文，不把展示标题当正文。
- `pnpm check:update`：复制当前源码到忽略的 `.e2e-update/`，只改变副本版本，构建两份真实产物；隔离本地服务器从A切换到B。双引擎覆盖阅读中后台下载/回书架点击更新、关闭主动检查/手动检查/下载503后重试、另一标签更新不打断阅读。真实SW和HTTP不mock，仅快进窗口计时器。更新前后原生IDB七表逐项一致，原文件Blob核对SHA-256，报告在 `artifacts/update-regression.json`。本机部署证据不能替代HTTPS和手机验收。

完整 `pnpm e2e` 也运行更新用例；它成功结束后可运行 `pnpm check:update --collect` 汇总刚生成的六份报告，避免重复跑测试。每次全局setup生成新目录，缺失任一场景/引擎或表哈希不一致都会拒绝汇总；`--collect` 本身不执行新验收。

交互独立配置每次生成`.e2e-interactions/<UUID>`，记录生产首页和六个源码文件SHA；`node scripts/check-interactions.mjs`严格核对八项实际原始结果、附件、零失败/重试、可信pointer事件、原件SHA及原生动画观测。完整套件同样创建本轮UUID，结束后用`node scripts/check-interactions.mjs --full`读取`artifacts/full-browser-results.json`，不使用独立旧报告填项。原始JSON与运行清单在UUID父目录保留；`artifacts/interactions-regression.json`保存汇总，截图视觉检查另在`interactions-visual-review.json`绑定路径/字节SHA。只有截图SHA完全相同才复用此前实际查看记录。DOM Range设置选区不证明手机系统长按，横竖窗口不证明传感器旋转；原生OS选择菜单、可信拖动/滑动、拇指舒适度和55fps仍待验收。

部署测试会替换默认HTML报告，因此完整本地套件结束后先运行`node scripts/collect-browser-report.mjs`。该脚本读取实际嵌入ZIP、检查全部spec及两个引擎，无失败/重试且只允许已知WebKit离线skip；同时要求两份十三本下载来自该次运行，再保存完整/备份报告和HTML源SHA，不能用用例清单或旧下载替代本轮结果。

`pnpm check:sharing`运行三个场景×两个引擎：按真实manifest创建multipart表单并导航POST，验证SW返回303、原生IDB暂存、实际解析Worker及原文件SHA。覆盖EPUB自动阅读且另一标签进度/书签保留，纯文字/URL预填返回重载再保存，混合分享只重试失败文件、保存文字仍保留失败文件、明确放弃，以及独立编辑页未保存文稿不变。保留表单传输的CRLF原文，链接不被访问；不是Android系统分享菜单或File Handling安装验收。

本机Windows WebKit的原生formData会把UTF-8中文文件名的文件解析成字符串；`node scripts/probe-sharing.mjs`在无应用代码的最小SW中对比直接formData与TransformStream，英文均为File、中文均为字符串，证据为`artifacts/sharing-native-probe.json`。因此该引擎的两个文件用例限定英文文件名，Chromium仍用中文；六项通过不覆盖WebKit中文分享文件名。iOS继续使用产品已有手动选文件入口。原始验收记录在`.e2e-sharing/<UUID>/`，独立与完整套件均生成新UUID；`node scripts/check-sharing.mjs`只汇总本轮六份passed、有同源Worker、真实SW303、零外部请求/页面错误的报告到`artifacts/sharing-regression.json`，并保留文件名覆盖限制。

完整套件同样运行preferences用例；成功结束后可运行`node scripts/check-preferences.mjs`汇总。setup每轮生成UUID，报告目录由`artifacts/preferences-run.json`指定；汇总须有本轮十份不同场景/引擎报告、实际同源解析Worker记录和零外部请求/页面错误，不能用旧报告填补失败。汇总在`artifacts/preferences-regression.json`，截图留在忽略的`test-books/preferences-evidence/`。浏览器下载已实际保存为文件，不等于手机系统分享窗口或用户操作系统保存对话框。

长章原始报告保存在忽略的`.e2e-long/<UUID>/`，成功的完整套件可用`node scripts/check-long-chapters.mjs`汇总到`artifacts/long-chapters-regression.json`，要求本轮六份不同场景/引擎证据，EPUB另要求原文SHA/图片/完整注音/UTF-16跨段与文字mark绘制证据。重载点击笔记及恢复竖窗后，还验证实际划线Range与当前视口相交；单纯在同一块存在不算跳转完成。截图在`test-books/long-chapter-evidence/`，不自动更新分页像素基线。每次点击开书都可能再次进入全屏，窗口变化前走应用的退出入口；高度模型保持精确，computed CSS仅允许1/64像素布局取整，真实文字行框仍单独检查，依据[Chromium LayoutUnit定义](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/geometry/layout_unit.h)。该测试不是1000章打开耗时、百书滚动、55fps或Android30分钟内存验收；原创十二万字EPUB的12000切点注音、两张图片、含emoji的跨段选区及完整ZIP清空恢复也已接入；短ruby整体分块，不改变原段落/UTF-16定位。含注音或图片的阅读根使用文字mark高亮，避免原生高亮背景遮住读音/图片。逐个读音字符行框、28px横竖窗口和重载/跳转均有检查，截图另行复核；超长ruby仍按预算切块，不宣称完整巨大注音排版。原生绘制最小对照可运行`node scripts/probe-ruby-paint.mjs`，四种模式的截图及SHA在artifacts/ruby-paint-native-probe.json，不含应用/IDB，不把几何或DOM检查说成自动像素验收。

性能原始报告为`.e2e-performance/<UUID>/`，当前目录由`artifacts/performance-browser-run.json`指定，成功后`node scripts/check-performance-browser.mjs`汇总到`artifacts/performance-browser.json`；完整套件也生成四份新报告，不能用旧的成功替代本轮失败。性能用例明确使用no-preference，并以实际媒体查询记录未减弱动态；其余分页/交互用例可继续使用reduce以稳定像素基线。原生只读游标/getAll探针对比记录在报告中，用于区分读库与帧等待，不向主库写测试数据，也不替换应用读库或分页。

实际托管验收使用`JINGYE_DEPLOY_URL=https://jingye-reader.pages.dev`和`pnpm exec playwright test --config playwright.deployment.config.ts`，不启动本地服务器或生成更新副本；四条双引擎用例覆盖HTTPS/Worker/IDB/重载和SVG ZIP恢复，Chromium另外断网启动与翻页。Windows WebKit子进程仅移除代理环境变量以避开已复现的HTTPS URL解析故障；默认本地配置不变。该引擎未接受线上断网模拟，不能等同于iOS真机。报告见DEPLOYMENT.md及`artifacts/deployment-browser/`。

真实来源书籍单独验收：`pnpm fixtures:real-epub` 从已核验官方链接下载未改动EPUB，记录来源/开放依据/时间/SHA，保存在忽略的 `test-books/real-epubs/`；不可把下载失败的HTML保存为书。`pnpm check:compat` 先生产构建、运行独立配置，再严格汇总本次完整50项结果。21本、3个制作来源，共42项通过/8缺文件skip；20份原创合成另计。原生Worker/IDB、真实目录键盘跳转、来自原始XML的静态短句及Range可见、逐行/图片几何、翻页后重开和原件SHA均检查。Eloquent额外检查正则章节真实表格；《草枕》检查横排注音。每次globalSetup生成.e2e-compat/<UUID>并锁定源JSON/原件/生产首页SHA，截图及每书JSON在此目录；原始结果副本在其父目录。collector拒绝缺项、意外失败/重试、不同run或变化的文件；44张选定正文截图已逐张查看，视觉记录须匹配本次UUID与截图SHA，不能用书前metadata/title页或旧报告填项。4个候选的网络不可用原因见test-books/COMPAT.md，不计解析失败。此下载仅测试工具联网，应用不访问这些来源；不是整本所有页面、原生长按或手机验收。

Windows WebKit临时会话不能把Blob写入IDB，`fixtures.ts`为其使用每测试独享的持久临时目录，关闭后由Playwright清理。`scripts/probe-webkit-storage.mjs`在无应用代码的原生IDB复现：临时会话Blob失败/字节成功，持久会话均成功。

Windows WebKit的setOffline连最小本地SW生成响应也报internal error，见 `scripts/probe-webkit-offline.mjs`。额外离线用例明确跳过，字体用例仍验证其缓存在线重载不重新请求字体。iOS真机离线与系统能力继续在ISSUES.md保留。

`test-results/`、`playwright-report/`和`.e2e-update/`为忽略的生成产物，失败保留截图/trace；`pagination.spec.ts-snapshots/`基线随源码保存。Playwright为开发依赖，浏览器交付贡献0。

`svg.spec.ts`另验证两引擎真实Worker/IDB中的包装封面、静态矢量图、内嵌图、自然尺寸和分页边界；恶意SVG内脚本/字体地址/外图/foreignObject/动画不执行或联网。完整备份清空恢复保持v3段落、书签、进度以及每个Blob大小/SHA和派生图片MIME；原文件MIME按ZIP字节格式的规则核对。真实兼容集还检查《九命奇冤》初始包装封面、《Eloquent JavaScript》DOM章节图和21个净化SVG资产。远处目录项通过键盘导航挂载，等待焦点与章节正文实际完成渲染再读取。

可用`pnpm fixtures:real-epub gutenberg-52323`只下载指定已登记来源，其他已有文件仍校验/刷新元数据；未请求的失败来源保留记录。退出码只代表本轮请求是否失败，完整的可用/不可用数量见忽略的manifest。新增文件仍须实际浏览器检查和截图审查，下载成功不等于兼容通过。

`playwright.live-update.config.ts`独立验收真实Cloudflare旧→新部署；必须在上传前启动，保留旧的HTTP清单并准备新构建。两个原生引擎通过UI保存原创书/进度/书签/笔记，各写ready后等待发布门；唯一与稳定URL资源均匹配本次构建后，由`release-live-update.mjs`核对并释放。计时器快进61分钟，SW/HTTPS/原生IDB不模拟；旧阅读不刷新、回书架显式更新、七表与原文SHA相同、新缓存SHA及重开笔记通过。`collect-live-update.mjs`要求本轮两条真实JSON pass/零重试或skip，并绑定上传/HTTPS报告；独立于本地完整70条及通常4条线上流程，不是手机验收。详细步骤见DEPLOYMENT.md。

本轮单手选区修复后的完整套件为70项：69通过/1已知Windows WebKit离线模拟skip；75文件337单测、六张分页基线、Windows26原文校验通过。八项交互报告和六张截图绑定本轮c6caaad4-a880-4078-b79e-22f70b7d7963；部署新版另四项、旧D6→BA更新另两项通过。线上配置使用独立deployment-browser-results.json，避免覆盖完整本地原始JSON；HTML仍在部署前由collector保存SHA与结果。21本真实EPUB的独立42项保持D6构建历史范围，没有用旧书籍报告冒充BA的新验收。

`pnpm check:markdown-v2` 覆盖首版场景、第二版场景、图片分页和原有分页像素基线，两引擎共 20 项，原生 JSON 为 `artifacts/markdown-v2-browser-results.json`。公式/代码、双链/脚注、流程图/时序图、图文包、恶意语法、完整备份与首版恢复/重复导入均通过实际 UI 操作；公式之后的选区使用 DOM Range，不证明真机长按。图表检查会实际翻至图表所在页，要求整张图片在视口与正文边界内，并检查只有标题与图表的章节没有末尾空白页；不以 DOM 中存在图片充当可见证据。进度重载等待实际 IDB 保存完成，恢复等待清空事务完成，下载先保存为 `.zip` 文件再选择恢复，避免无扩展名临时下载路径被正确的格式验证拒绝。

离线重开仅 Chromium 使用 `setOffline(true)` 并检查 `navigator.onLine === false`，重载后再次渲染公式与图表。Windows WebKit 只计缓存就绪后的在线重开，不将其计为断网证据。第一版恢复场景包含被 v2 拒绝的重复脚注定义，验证先识别原件与已有版本，不误用 v2 解析；重复导入保持旧笔记。专用套件选定截图包括两个引擎的公式/代码、流程图、时序图和本地图片，需另行查看并在 DEVELOPMENT_STATUS.md 记录。

线上 MD 第二版使用 `JINGYE_DEPLOY_URL=https://jingye-reader.pages.dev` 和 `pnpm exec playwright test --config playwright.markdown-deployment.config.ts`，不启动本地服务器，继承部署配置的 Windows WebKit HTTPS 代理修正。两引擎共八项，网络检查使用实际部署 origin，仍禁止外部请求；原生结果为 `artifacts/markdown-v2-deployment-results.json`。2026-10-09 首次 MD 部署八项通过；随后只修复 SW HTTP 缓存头，113 个公开资源 SHA 均未变，未把首次八项记录重新绑定到缓存头构建。首次上传的 MD 八项、常规四项和旧客户端更新两项连同 HTTP/构建清单保存在 `artifacts/deployment-history/markdown-v2-first-2f07f9db/`，最终缓存头版本另复验常规四项。物理 Android/iOS 与 WebKit 真机离线仍待验收。
