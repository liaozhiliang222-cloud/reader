# 静页工程规范

## 执行方式

- 始终使用用户在应用中选择的主模型与推理强度，单代理端到端执行。
- 不创建子代理，不进行自动模型路由、分工或第二模型审查。只有用户后续明确授权才可改变。
- 不自动提高推理强度；遇到模型不可用时报告阻碍，不静默切换。
- 保留用户修改，验证力度与风险相称，不进行无关重构。
- 会话压缩后先恢复最新未完成任务、约束、进度与下一步；以 DEVELOPMENT_STATUS.md 作为项目检查点。

## 产品与技术

- 开发前阅读 PRD.md、DEV_PLAN.md 和 DEVELOPMENT_STATUS.md。
- 无注册、无推荐、无 AI、无追踪；书籍和用户数据只在本地。
- 不引入第三方 CDN、统计 SDK、字体服务或运行时联网请求。加载应用资源与未来的 Service Worker 更新遵循 PRD；开发服务器的 HMR 仅限开发环境。
- iOS R2 的唯一新增联网例外为用户主动使用 Apple StoreKit 购买服务及系统交易更新，边界见 PRD。阅读、正文、笔记和备份仍只在本地；不因此授权 iCloud/WebDAV/OPDS。
- 技术栈：Vite、Preact、TypeScript strict、Preact Signals；后续按计划引入 Dexie、Worker、EPUB 解析和 PWA。
- 新依赖必须说明理由及 gzip 体积；开发依赖不计入浏览器交付包，实际体积以构建为准。
- UI 在 src/pages 与 src/components；应用状态在 src/app；分页与定位在 src/reader；解析器在 src/parsers；存储在 src/db；线程在 src/workers；备份在 src/backup；主题在 src/styles。
- 使用语义 HTML、系统字体、移动端布局与不少于 44px 的交互热区。
- TypeScript 严格类型，不用 any 绕过问题；Prettier 统一格式。
- 对解析、定位、备份合并等纯逻辑编写 Vitest 测试；不为简单样式堆砌测试。

## 命令与交付

- pnpm dev：本地开发；pnpm dev --host：局域网调试。
- pnpm lint：ESLint 与 Prettier；pnpm test：Vitest；pnpm build：类型检查及生产构建。
- pnpm preview：预览构建；pnpm format：格式化。
- 每次结束前运行 pnpm lint、pnpm test、pnpm build；如有阻碍准确记录，不声称通过。
- 按开发计划任务推进，代码实现、自动检查、真机验收分别记录。
- 分支 main 保持可运行，阶段分支用 m0、m1 等；验收后按任务编号提交，如 M0-01: 初始化工程。未配置作者时不伪造身份。
- 不提交 node_modules、dist、私钥、真实用户数据或有版权测试书籍；test-books/ 已忽略。
- 后续部署、发布与商业化按照计划的前置验收条件执行。
