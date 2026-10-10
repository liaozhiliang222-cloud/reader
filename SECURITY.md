# 本地数据与资源边界

应用的书籍、笔记和备份在本机处理。此文档记录已实现的边界与验证方法，不能替代完整安全审计或真机验收。

## 生产资源

`public/_headers` 是响应头的唯一策略来源，构建时写入 `dist/_headers`；Vite 生产预览使用同一 CSP，HTML 在资源标签之前加入 meta 兜底。开发服务器保留 HMR，不应用生产 CSP。

- 脚本、连接、Worker、样式文件和 manifest 仅允许同源；脚本不允许内联或 eval。
- 图片允许同源、Blob 和 data；可选字体只在用户点击后同源下载，校验大小与 SHA-256，再从本机字节加载。
- 动态分页和浮层定位需要内联样式；`unsafe-inline` 只出现在样式策略中。
- 禁用 object、iframe 与 base，表单只能同源提交。`frame-ancestors` 只在响应头中配置，不加入 meta。
- `sw.js`、HTML 和可变元数据使用 `no-cache`；带哈希的 assets 与带版本的字体使用 immutable。全局规则不重复设置 Cache-Control，避免与资源规则合并成冲突值。

`_headers` 需要托管平台支持才会生效。已在Cloudflare Pages实际HTTPS验收15个资源的字节/SHA与CSP、nosniff、no-referrer、DENY和缓存头，报告见`artifacts/deployment-http.json`；双引擎正常线上流程无CSP违规和外部请求。其他服务器需要配置等价响应头；meta不能提供响应头专属的限制。来源：[CSP规范](https://www.w3.org/TR/CSP3/)、[Cloudflare Pages响应头规则](https://developers.cloudflare.com/pages/configuration/headers/)。

Pages将`/index.html`重定向到`/`；离线安装直接请求应用作用域根页，再按原清单的index.html键缓存，其他资源重定向仍拒绝。实际线上Chromium断网导航/重开书籍/翻页已通过，Windows WebKit仅接受在线重载和SW激活，不推断iOS飞行模式或手机安装。

构建产物中保留 XML 命名空间、字体混淆算法标识、依赖版权与错误帮助 URL。它们不是运行时下载端点，不为字面“零 URL”修改依赖或删除版权。`scripts/security-urls.json` 记录逐项用途；检查所有生产 JS/CSS/HTML/manifest，出现未审查的 URL 就失败。动态网络行为另由正常流程 CSP 与请求记录验证。

## EPUB 图片与位置版本

EPUB v3解析把常见SVG包装中的已知书内图片转为普通`img`。独立或内嵌矢量SVG仅保留基础图形、文字、渐变、裁剪和标记；重建XML后保存为`image/svg+xml` Blob，通过`img`显示，原始SVG不插入应用DOM。简单标签/类/ID的安全绘图样式转为属性，字体服务、外部URL、事件、脚本、动画、foreignObject及未知命名空间均丢弃。`use`只展开同图ID引用，循环停止，展开节点也计入限额。保留的绘图引用只能是`url(#本图ID)`；不是允许原始CSS。基础行为参考[SVG处理模式规范](https://www.w3.org/TR/SVG/conform.html)，浏览器图片模式之外另加白名单净化。

SVG源字符串和重建结果各限1MiB，原始/展开节点最多20,000，递归深度64，简单样式规则最多1,024；超限明确报错。复杂混合位图/矢量图层、滤镜、嵌入字体、动画与交互不属于支持范围。净化是受限静态兼容，不能声称完整SVG还原或完整安全审计。

新增图片段会改变位置，因此只有新导入使用parserVersion=3。旧书补导及完整恢复保持v1/v2规则；同指纹不同版本拒绝合并。备份schemaVersion=3向后读取1/2，拒绝把v3解析书标成旧备份版本，避免旧应用错误解释书签/笔记。完整ZIP保存原文件字节，恢复原文件Blob不保留浏览器File提供的MIME；依靠已保存书籍类型重新解析。派生图片MIME及原文/图片SHA必须正确。

## ZIP 与备份

ZIP 先读取原始目录和本地头，再解压，避免解析库规范化名称或覆盖重复条目后丢失证据。支持 STORE、DEFLATE、标准流描述符、限额内 ZIP64 和有效 Unicode 路径扩展；拒绝分卷、ZIP 加密、符号链接、路径穿越、重复名称、目录/本地头矛盾、数据区重叠和不安全的 64 位数值。资源名支持 UTF-8；其他编码需要有效 Unicode 路径扩展，否则明确提示重新打包。目录元数据上限 32 MiB、条目数上限 20,000。

直接使用 pako 3.0.2 的流 API：压缩输入每块最多 64 KiB，解压输出每块最多 16 KiB，累计实际输出与声明大小均检查；完整终止状态及已消费输入必须吻合，逐条计算原始 CRC，包括空条目和未使用资源。解压失败释放当前块集合并终止该包的后续读取。新版独立依赖用于识别旧流 API 不能可靠拒绝的截断末块，JSZip 仍用于导出；运行体积以统一构建报告为准。

- EPUB：输入单本 50 MiB、单资源 50 MiB、累计解压工作量 150 MiB；仍保留解析版本与旧位置兼容。
- JSON：读取前检查 32 MiB 元数据上限，并用严格 UTF-8 解码。
- 完整备份：File 切片读取目录与压缩数据，避免整体 arrayBuffer；`backup.json` 单独限制 32 MiB，原文件限制 50 MiB。预览先核对引用条目的声明大小与元数据，逐块校验大小/CRC/流边界并丢弃原文，未使用条目也校验。读取元数据后，包总解压预算收紧到引用原文件大小之和加 32 MiB；预览Worker只返回验证后的元数据，主线程保留用户选择的File，不接收全部解压原文Blob。
- 完整恢复继续在主库提交前核对原文 SHA-256、解析结果与位置规则，事务失败回滚。

完整恢复现逐书在Worker验证并解析，主线程逐书写入隔离命名空间的本地暂存，随后在同一个七表事务内逐书校验位置、写入并清理旧数据。后一本失败仍回滚前面所有主库修改，不将逐书写入解释为逐书提交。暂存存独立字节，提交时重建Blob；取消/失败/成功后清理自己的暂存，读取字节或RPC晚到不得重建已清理记录。支持Web Locks时，仅清理失去所属锁的孤儿暂存，其他活跃恢复会话和待导入分享保留；不支持该API时仍有正常finally清理，崩溃残留只能通过清空数据移除。

恢复使用新的独立Worker会话重新打开预览保存的File，重新校验目录、预算及元数据与预览一致，再依次展开/CRC/指纹验证/解析一本书后返回，主线程等待该书暂存完成再请求下一本。不会复用预览已耗用的解压预算或跨会话目录。最后再次校验未引用条目，成功后才开始主库事务；最后校验失败或期间取消仍清理全部暂存，不提交主库。界面失败后可保留预览并重新恢复。

导出快照在同一只读事务内捕获书籍/进度/书签/笔记/设置，书籍最多32条一批，丢弃可重建的目录/章节摘要和本机Blob键。完整快照仅通过原文键查询可用性，不读取Blob值；Worker初始输入只有元数据，通过回调逐书取原文并复核大小、SHA-256与书籍指纹。没有跨ZIP生成保留数据库事务；原文删除、改变或迟到取消均不交付文件，笔记/改名等仍保持快照时值。旧备份的可选目录/摘要继续兼容，完整恢复重建它们。

完整导出使用JSZip公开generateInternalStream/streamFiles：收到文件头再读取该原文ArrayBuffer，下一文件开始时移除已完成输入；输出按约1MiB转Blob，不建立整包ArrayBuffer。原文读取前检查重复路径、Unicode字段、经典ZIP32位容量，以及恢复器相同的20000条目和32MiB目录上限；读取或进度回调失败不交付半个ZIP。双引擎实际下载十三本原创样本（含1200118字节长文），观察原生Worker入参零Blob、原文在调用后按files顺序读取；JSZip CRC读取及Windows Expand-Archive独立解压的全部原文大小/SHA一致。报告见artifacts/backup-export-browser及backup-desktop-extraction.json。

这些边界不证明总恢复或导出内存恒定：整库解析章节数组、本地正文Map、预览的全部原文Blob、聚合的导出输入Blob、并发原文ArrayBuffer和整包输出ArrayBuffer已移除，但选中的备份File、元数据/原文键、最终输出Blob、单书工作集、32本书的数据库读取批次和浏览器事务内部内存仍有占用。暂存也需要额外磁盘配额；不足时不能修改主库。超大书库与真机峰值内存验收留在DATA-01。尚未完成真实20本不同来源的EPUB验收。

## 检查入口

- `pnpm lint`、`pnpm test`、`pnpm build`：项目必需检查。
- `pnpm check:security`：构建、CSP/缓存规则、静态 URL 清单和 registry 已知漏洞审计；报告在 `artifacts/security-resources.json`。
- `pnpm e2e`：独立 Chromium/WebKit，所有正常用例自动收集 CSP 事件及相关控制台错误。安全用例验证恶意 EPUB 净化，并分别检验响应头+meta、只有 meta 时的预期阻断；预期错误仅豁免这两个负向用例。
- `node scripts/pwa-check.mjs`：生产 SW 的 Node 检查，与真实浏览器和设备证据分别记录。

依赖审计无报告项只说明本次registry已知漏洞结果；两台真实手机、长期使用与完整安全审计仍须另行取得证据。公开托管的具体字节/响应头/浏览器证据独立记录在DEPLOYMENT.md，不等同于全部产品验收通过。

## Markdown 第二版

Markdown 源 HTML 仍按文字处理。公式以 KaTeX 的 `trust: false`、`maxExpand: 200`、`maxSize: 10` 转为 MathML，再净化；源码最长 4,000 字符，资源/链接/HTML 命令回退原文。不下载数学字体。选区、定位、划线使用独立规范源码，视觉 MathML 与图表文字不参与字符计数。代码高亮仅接受本地已注册语言，净化后的文字必须与原代码一致。配置参考 [KaTeX 选项](https://katex.org/docs/options.html)。

Mermaid 最长 10,000 字符、200 行/分句、100 条边，渲染前拒绝用户配置、CSS、HTML、图片、外链与交互指令。仅列入安全清单的图表类型进入严格模式；不绑定交互，输出再次净化为本地 Blob SVG 图片，移除外链、foreignObject、图片与动画。排版临时容器在结束或失败时移除，Blob URL 随章节释放。全部渲染代码来自构建资源，外部 URL 清单中的新增地址均为库的诊断文字或 XML/模型标识；正常和恶意输入由实际浏览器零外部请求与 CSP 用例另外验证。严格模式参考 [Mermaid 配置](https://mermaid.js.org/config/schema-docs/config.html)。

图文包沿用有界 ZIP 和 CRC 校验，输入 50 MiB、512 条目、单条目 10 MiB、累计 60 MiB、256 张图片；恰好一个 Markdown 正文。图片签名与扩展名吻合，静态 SVG 净化，不加载远程、data 或协议相对图片。完整恢复核对原始 ZIP 的 SHA-256，并重建净化后的本地附件。首版原文按其版本解析，先查指纹与元数据，避免新规则错误拒绝既有书籍。

直接和间接渲染依赖统一固定 KaTeX 0.19.0、DOMPurify 3.4.16，已知漏洞审计记录为 `artifacts/markdown-v2-dependency-audit.json`。pnpm 11 的覆盖设置位于 `pnpm-workspace.yaml`；不使用已失效的 `package.json#pnpm` 设置。新组件完整许可保留在本地许可页。
