# Cloudflare Pages部署

地址：[静页阅读器](https://jingye-reader.pages.dev/)；现有自定义域名 [reader.surveykit.cc](https://reader.surveykit.cc/) 同步。项目jingye-reader，生产分支main，版本0.0.1，使用本地生产构建Direct Upload；用户明确授权持续更新。此结果不代表完整M2/M3、开源发布或真机验收结束。

## 2026-10-10 CI 验收与全屏修复上线

- 当前生产部署 [dd14fa8b](https://dd14fa8b.jingye-reader.pages.dev/)，完整 ID `dd14fa8b-c7a0-4959-acda-76b6a38aca76`。仍为原账号 `7c33f9356512402ffd494750506a6e29`、原项目 `jingye-reader` 与 Production/main；Wrangler 原生列表确认 Source `6ce56cd`，稳定地址和自定义域名同步。
- 修复阅读器挂载到事件监听之间完成的全屏切换未同步到按钮。代码提交 `6ce56cd23baa62d3080f46d2f52d6fc4dd5fcf64` 的 [真实 CI](https://github.com/liaozhiliang222-cloud/reader/actions/runs/38019710585) 已完整成功：lint、85 文件/372 单测、strict 构建、安全/PWA、102 浏览器通过/1 已知 Windows WebKit 离线 skip（11.5 分钟）、严格完整报告检查及行高变异/恢复。本机完整套件另为 102/1（9.5 分钟），两种环境各用已审查的系统字体截图基线，没有扩大像素容忍度。
- 原生 CI 附件 11658261604 的 ZIP SHA 为 `a13e4a56790f3ddc16f521be445206b1ba9d7d217988ae1e7e0fd8ec41eeec8a`，下载后核对 JSON/完整 HTML 与独立变异报告；故意改坏时两引擎截图失败、恢复后两引擎通过。该结果与 38017213626 的独立故意失败红色 CI 分别保留。
- 发布前最后 lint、372 单测、strict 构建、安全 104 惰性 URL/PWA 110 资源与上传清单通过。114 静态文件、7745744 字节，全部 JS/CSS gzip 1695.43 KB；主包 `index-BULRReMR.js`，无新依赖。preparedAt `2026-10-10T03:18:03.238Z`；唯一、稳定、自定义地址各 113 资源大小/SHA、安全与缓存头全量通过。只上传 `dist`，未包含用户书籍、凭证、原始测试报告或源码映射。
- 本次实际 HTTPS 常规 4/4（45.1 秒），额外引导焦点/返回与 Chromium 可信拖动 3/3（14.7 秒）通过。后者复用生产用例和部署配置 `.review/m2-fullscreen-experience-online.config.ts`，无本地服务器。另一个 Chromium 原生全屏专项 1/1（3.4 秒）明确断言进入/退出的实际 `document.fullscreenElement` 与按钮一致；没有模拟全屏 API。模拟移动视口/可信 CDP 触摸不计物理手机验收。
- 当前原始报告为 `artifacts/deployment-build.json`、三份 HTTP、`deployment-browser-results.json`、`fullscreen-deployment-results.json` 与 `fullscreen-state-deployment-results.json`；汇总绑定在 `artifacts/m2-source-ci-release.json`。本机完整结果与远程 CI 附件独立保留。上次 82ac11ae 构建/HTTP/4+2 浏览器证据原字节归档在 `artifacts/deployment-history/m2-source-82ac11ae/`。本次未重跑真实旧客户端升级专项，不能将上次结果改写为本次通过。
- CI 自动部署 job 仍因未配置 Cloudflare secrets/启用变量而跳过；本次是在检查成功后，用已有本机 OAuth Direct Upload 更新原项目。项目许可证、正式 tag、物理安装/分享/离线/性能等仍待办。

## 2026-10-10 首次 M2 引导修复与源码上传（历史）

- 原账号、原项目 jingye-reader 与生产分支 main，记录 [82ac11ae](https://82ac11ae.jingye-reader.pages.dev/)，完整 ID `82ac11ae-9808-4233-a5a1-02a813860623`；Wrangler 原生列表显示 Source `576d65b`，对应用户仓库首次提交。稳定地址与现有自定义域名同步。
- 新版修复使用引导的焦点循环/恢复与浏览器返回，关于页加入源码、Issues 和 Gmail 入口。无新依赖，运行请求仍限同源应用资源；外部反馈入口只在点击时导航，不发送书籍。
- lint、369 单测、strict 构建、安全 104 惰性 URL、110 离线资源检查通过；本地专项 17/17，完整浏览器 102 通过/1 已知 Windows WebKit 离线 skip。
- 本轮 114 静态文件、7745740 字节，全部 JS/CSS gzip 1695.46 KB。唯一、稳定与自定义地址各 113 资源大小/SHA/CSP/安全/缓存头全部通过，绑定 preparedAt `2026-10-10T02:31:13.692Z`；线上常规 4/4（40.4 秒）、两个引擎引导焦点/返回 2/2（11.1 秒）通过。后者使用忽略的 `.review/m2-guide-online.config.ts` 复用实际生产用例与 HTTPS 配置，没有本地服务器或数据库替身。
- 该次原始构建、三份 HTTP、常规 4 项和引导 2 项报告已原字节归档在 `artifacts/deployment-history/m2-source-82ac11ae/`；更早 HTTP/浏览器及其他旧报告在 `artifacts/deployment-history/before-m2-source-upload-20261010/`，各保留原本的构建绑定。该次未重跑旧客户端升级专项，不能用上次两项结果当作该次证据。
- 仓库 CI 已预留检查成功后的 main 自动上传，需配置 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN` secrets 与 `CLOUDFLARE_DEPLOY_ENABLED=true` 仓库变量；当前尚未启用。本轮仍用本机 OAuth Direct Upload，配置说明见 CONTRIBUTING.md。真机安装/分享/离线/性能仍单列。

## 2026-10-09 Markdown 第二版上线

- 使用已登录的原 Cloudflare 账户和现有 jingye-reader 项目，未创建新项目或域名。Wrangler 的生产部署列表确认分支 main，最终记录为 [f4b42eaa](https://f4b42eaa.jingye-reader.pages.dev/)，完整 ID 为 `f4b42eaa-eb40-4d5c-8073-7f4f0b4e1aad`。公式、代码高亮、脚注、同文档双链、图文包和 Mermaid 已上线。
- 发布前及缓存头修复后 `pnpm lint`、`pnpm test`（84 文件 / 369 项）、strict TypeScript / Vite 构建通过。安全检查复核 103 个惰性 URL；PWA 静态检查 110 个资源，生产上传清单 114 文件、7744280 字节。没有上传书籍、用户数据、凭证或源码映射；上传脚本增加了对 Mermaid 指纹模块的白名单识别，仍要求全部 JS/CSS 出现在真实 SW 清单中，并实测拒绝未缓存资源及非运行文件。
- 最终主包 `index-DSPm7wbM.js`、CSS `index-DTe0fVz3.css`、Worker `parse.worker-CEvcQ8zu.js`。全部 JS/CSS 为 1695.02 KB gzip，初始主包加 CSS 为 99.01 KB；图表按需执行但随应用缓存。新增依赖理由和隔离体积见 README 与 `artifacts/markdown-v2-size.json`，不能以初始包体积替代全部离线资源。
- 首次 MD 上传 [2f07f9db](https://2f07f9db.jingye-reader.pages.dev/) 完成常规线上 4/4、MD 专项 8/8，以及真实旧 UI 版到 MD 第二版的更新 2/2，无失败、跳过或重试。升级前后七张原生 IndexedDB 表、原文 SHA、进度、书签和笔记一致；阅读页保持打开，回书架点击更新后才切换新版。仅窗口计时器快进，网络/SW/IDB 真实；原始报告和该次构建/HTTP 清单保存在 `artifacts/deployment-history/markdown-v2-first-2f07f9db/`。
- 首次上传发现自定义域名的 `/sw.js` 返回 `max-age=14400`，其余 113 个资源的内容和安全头均正确。最终版本仅将该路径改为 `Cache-Control: no-store, no-cache, max-age=0, must-revalidate`，并增加 `Cloudflare-CDN-Cache-Control: no-store`。实际自定义域名现在返回该浏览器缓存规则及 `CF-Cache-Status: BYPASS`；没有更改账户或全站缓存设置。依据为 [Cloudflare 缓存控制文档](https://developers.cloudflare.com/cache/concepts/cache-control/)。
- 两次上传的 113 个公开资源大小与 SHA 完全相同，只有 `_headers` 增加 79 字节。最终版本常规线上 4/4 再次通过；首次 MD 八项和升级两项保留原构建绑定，没有将其改写为最终上传的新运行。
- 最终唯一 URL、正式 Pages 地址与现有自定义域名各 113 个资源的 HTTPS/大小/SHA、安全及缓存头完整核验通过，报告为 `artifacts/deployment-unique-http.json`、`artifacts/deployment-http.json` 和 `artifacts/deployment-custom-http.json`。三个报告均绑定最终 `preparedAt: 2026-10-09T13:52:28.057Z`；正式地址最终检查时间为 `2026-10-09T14:02:17.020Z`。正式地址此前两次检查分别连接中断、超时，自定义域名首次检查另有一次传输超时；后续完整运行均通过，不将这些失败记为通过。
- Chromium 验证真实断网启动与 MD 公式/图表重开；Windows WebKit 只计缓存就绪后在线重开。两个引擎均为桌面上的移动视口，物理 Android/iOS 安装、原生长按、飞行模式和中端机性能继续待验收。旧安装回书架点击“点击更新”；不同域名各自保存本地数据，跨域迁移须导出/恢复完整备份。

## 已验证的范围

- 2026-10-03 验收审查修复部署：[b079dae3](https://b079dae3.jingye-reader.pages.dev/)，主包 index-Ba-T2F7X.js，parser/CSS 不变，16 静态文件 2249346 字节（4 变动/11 复用及 _headers）。prepare/security/pwa/bundle 检查通过，唯一与稳定地址各 15 资源 SHA/安全缓存头通过，线上 4 项（双引擎 Worker/IDB/重载/SVG/备份恢复）通过。未运行旧→新真实客户端升级用例（live-update），全部 JS/CSS 182.63 KB gzip。

- 本轮单手选区保护修复部署：[3a4c2d69](https://3a4c2d69.jingye-reader.pages.dev/)，正式地址不变。16个静态文件、2248306字节，3个变动/12复用及_headers，只上传dist，含可选字体与版权通知。没有测试书/用户数据/凭证/源码映射。
- 唯一与稳定各15公开资源大小/SHA完全匹配本次构建；CSP、nosniff、no-referrer、DENY及no-cache/immutable规则正确。preparedAt 2026-10-03T05:20:54.337Z，HTTP checkedAt 2026-10-03T05:22:04.121Z、2026-10-03T05:22:10.331Z，第一次均完整通过。清单/报告在artifacts/deployment-build.json、deployment-unique-http.json、deployment-http.json。main index-BAqh-t_b.js，parser parse.worker-DGhdd5kn.js和CSS不变。
- 独立Chromium/WebKit新版四条真实HTTPS Worker/原生IDB、进度书签重载、原文SHA、SVG解码/边界、完整ZIP清空恢复通过；正常流程无外部请求/CSP错误。Chromium断网导航、重开翻页通过，Windows WebKit只计在线，不能推断iOS真机。报告在artifacts/deployment-browser/。
- 真实旧D6→新BA客户端更新另两条通过，run 5a366971-21b7-4fc8-b1a0-66be1c9f8dbb。上传前两个隔离引擎通过UI保存旧书/进度/书签/笔记；两个ready和两组15资源核验后release-live-update释放门。阅读保持旧文档、回书架显式更新才刷新；七表/原文SHA一致、新缓存main SHA及重开标注通过。只快进窗口计时器，网络/SW/IDB真实；原始结果、严格汇总与旧HTTP报告保留，不是物理手机验收。

发布前75文件337项单测、lint/strict TS/build和完整70项本地浏览器69通过/1既有WebKit断网模拟skip；六张分页基线未改。新增八项原生动效/可信点按/单手选区保护，六张选定截图复核通过。原文件、段落/UTF-16、parserVersion=3和备份格式不变，无新依赖。全部JS/CSS182.22KB gzip（含两个Worker），字体另1.53MiB，比D6增加0.02KB。完整本地HTML源SHA e5330249ebf2d242b2cd81c346e48b9bdfb43e1bcd33993299c08d74a24a5377；原始JSON已独立保留，线上四项使用deployment-browser-results.json。十三本本轮ZIP下载经Windows独立解压、26份原文大小/SHA一致；最终导出Blob/单书/元数据/浏览器工作集仍占内存，真机大库峰值继续待验。

21本真实原件/3制作来源的42通过/8缺文件skip及44张选定正文截图，来自前一[eead9a60](https://eead9a60.jingye-reader.pages.dev/)的D6构建，至少20本数量目标已达到。本轮只修改单手返回选区保护，解析器/CSS相同；保留那份构建绑定证据，没有冒称BA重复该独立书籍套件。整本其他页面、物理长按/滑动/拇指误触与真机继续待验。

历史f01857e6阶段上传后的第一次资源检查失败：新JS路径短暂返回1411字节HTML而非253334字节JS；随后两地址均返回正确资源，再完整核验15项通过。该阶段成功preparedAt2026-10-03T02:49:06.236Z及HTTP checkedAt2026-10-03T02:50:18.413Z已记检查点，不把首次失败算作通过或据此断言托管内部原因。

Pages对`index.html`的规范路径重定向会使拒绝重定向的旧安装逻辑失败。SW现直接下载作用域根页面，保持原清单缓存键及其他资源重定向拒绝规则；没有放宽外部资源策略。

Windows WebKit继承本机代理变量时HTTPS请求报URL解析错误；独立探针证明仅移除测试子进程的这些变量即可访问并激活SW。线上配置对此平台应用该修正，用户浏览器/系统代理未修改。`scripts/probe-deployment.mjs`可复现，不读取用户浏览器资料。

## 后续更新

已有本机Wrangler4.110.0与OAuth登录，未向项目新增依赖，浏览器交付体积增加0。需要登录时由账户所有者在浏览器完成OAuth，不把凭证写入仓库或聊天。

```powershell
pnpm lint
pnpm test
pnpm build
node scripts/prepare-deployment.mjs
node scripts/security-check.mjs
node scripts/pwa-check.mjs
node scripts/bundle-size.mjs
$env:WRANGLER_SEND_METRICS='false'
wrangler pages deploy dist --project-name jingye-reader --branch main --commit-dirty=true
node scripts/check-deployment.mjs https://jingye-reader.pages.dev/
$env:JINGYE_DEPLOY_URL='https://jingye-reader.pages.dev'
pnpm exec playwright test --config playwright.deployment.config.ts
```

如本次应用资源发生变化，可在上传前运行`pnpm exec playwright test --config playwright.live-update.config.ts`（设置同样的JINGYE_DEPLOY_URL）。需先保留旧的deployment-http.json，并准备新的deployment-build.json；测试拒绝相同main路径。等待两个引擎ready后，再在另一个终端按上述流程上传；用 `node scripts/check-deployment.mjs <本次唯一URL> artifacts/deployment-unique-http.json` 检查唯一地址，再检查稳定URL。两份报告路径独立，可并行核验；网络传输最多重试两次并记录失败，HTTP、字节、SHA 与安全/缓存头断言不重试或放宽。运行`node scripts/release-live-update.mjs`核对ready与两组资源并释放测试门，等待测试exit0，再运行`node scripts/collect-live-update.mjs`严格汇总。原始JSON不格式化，以便源SHA可复核；这两个用例独立于通常四条线上套件。

MD 增强可在实际部署后使用同样的 JINGYE_DEPLOY_URL 运行 `pnpm exec playwright test --config playwright.markdown-deployment.config.ts`，八项写入独立的 `artifacts/markdown-v2-deployment-results.json`，不会替代通常四项。若后续仅修改 HTTP 头，先保存该次完整证据并逐文件确认应用资源未变，再复验头规则、离线与常规流程。

每项检查成功后再运行下一项。上传清单脚本拒绝非预期文件、符号链接、超出Pages单文件限制的资源，并保存SHA。运行`check-deployment`前必须保留该次上传的`dist`和清单，不以旧构建证明新部署。

仓库尚无首个commit，Wrangler读取HEAD时会输出警告；部署结果由CLI返回URL与实际HTTPS验收确认，没有伪造Git身份或commit。工程必需检查和本地全套E2E按AGENTS.md继续执行。

## 待办

本项目为静态Direct Upload，现有 reader.surveykit.cc 已核验，没有Git自动部署。Cloudflare官方说明Direct Upload项目不能原地改为Git集成；后续可新建Git集成项目或用CI继续上传预构建目录，需先配置真实仓库、身份和权限。[Direct Upload官方文档](https://developers.cloudflare.com/pages/get-started/direct-upload/)。

Android/iOS安装、系统分享、原生选区、飞行模式、中端机性能和7天自用继续待验收。GitHub CI、项目开源许可、正式反馈渠道和外部宣传未完成；不购买域名或发布到用户未授权的渠道。

## 2026-10-03 UI 三批优化部署

- 部署地址：https://71d271ef.jingye-reader.pages.dev ，正式地址 https://jingye-reader.pages.dev/ 已同步。
- 内容：第一批（英文断词、按钮统一、书架行紧凑、环境提示细条、导入结果列表、界面无衬线）、第二批（排版分段控件、阅读菜单图标化与更多面板、首次点按提示）、第三批（散列纸色封面、目录跳章工具行、设置页三组、夜间描边与选区、宽屏页眉页脚、菜单滑入动效）。
- 检查：lint、342 单测、build、prepare-deployment（16 资产 SHA）、security-check（15 处 inert URL 复核）、pwa-check、bundle-size（gzip 186.02 KB，仍超 150 KB 参考值，为提示非失败）、本地全量 E2E 69 过 1 skip 均已通过。
- 部署后：check-deployment 两个地址各 15 资产 HTTPS/SHA/安全头一致；线上浏览器套件 4/4 通过（双引擎真实 Worker/IDB、进度书签重载、Chromium 断网重启、SVG 导入恢复）。
- 未验证：真机、旧版本升级回归（本次未跑 update 流程配合的部署验证）。

## 2026-10-10 MD UI 规范统一部署

- 部署地址：https://82d9609d.jingye-reader.pages.dev ，正式地址 https://jingye-reader.pages.dev/ 已同步。
- 内容：粘贴页正文格式改用分段控件、链接下划线偏移统一、移除失效的 inline 尺寸声明、MD 代码块 4px 圆角。
- 检查：lint、372 单测、build、prepare-deployment（113 资产）、security-check、pwa-check、bundle-size（gzip 1695.53 KB，MD v2 离线预缓存所致，为提示非失败）均通过；本地 markdown 8/8、sharing 6/6、markdown-v2 20/20 双引擎通过。
- 部署后：check-deployment 两个地址各 113 资产 HTTPS/SHA/安全头一致；线上浏览器套件 4/4 通过。
- 修正测试：deployment.live.ts 等待 serviceWorker.controller 的轮询超时由默认约 10s 调为 60s——预缓存条目增至约 6MB 后，真实安装实测约 13.6s 才激活，属网络相关的等待预算问题，非产品故障。
