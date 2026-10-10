# 参与开发

目前为 0.0.1 预览版本，项目许可证尚未确定；公开代码不代表已授予开源许可。第三方依赖与字体的许可保留在 `public/licenses.txt` 和 `public/fonts/OFL.txt`。

先阅读 [PRD](./PRD.md)、[开发计划](./DEV_PLAN.md)、[工程规范](./AGENTS.md) 与 [当前进度](./DEVELOPMENT_STATUS.md)。书籍、进度与笔记只在本机处理，不引入追踪、第三方 CDN 或运行时联网解析。

使用 Node 24.17.0、pnpm 11.21.0；运行 `pnpm install --frozen-lockfile`、`pnpm dev`。变更完成后运行 `pnpm lint`、`pnpm test`、`pnpm build`。解析、定位和备份合并等纯逻辑需有针对性测试，涉及阅读界面的变更需执行相应浏览器套件。

`pnpm exec playwright install chromium webkit` 安装测试引擎；`pnpm e2e` 使用生产预览与原创样本。分页像素基线采用 Windows 系统字体，不能在 CI 中自动重建或提高差异容忍度来掩盖失败。其他系统/字体须单独核验，细节见 [浏览器验收](./e2e/README.md)。

GitHub Actions 在 push、PR 与手动触发时运行 lint、单测、构建、安全/PWA 检查及完整浏览器套件。工作流采用 Windows 2025，固定 Node 与 Action 提交；保留原生报告、失败截图和 trace。它不等同于 Android/iOS 真机验收。

同一工作流预留 Cloudflare 部署 job，只有检查成功的 main push 且仓库变量 `CLOUDFLARE_DEPLOY_ENABLED=true` 才会执行。需要在仓库 Actions secrets 配置 `CLOUDFLARE_ACCOUNT_ID` 与 `CLOUDFLARE_API_TOKEN`，令牌仅授予现有账号的 Cloudflare Pages 编辑权限；步骤见 [Cloudflare 官方说明](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)。现有项目固定为 `jingye-reader`，不是新建托管项目；上传前核对清单，上传后检查全部资源 SHA/CSP/缓存头。当前尚未配置这些 secrets，自动发布未启用。

分支使用 `codex/` 前缀，提交注明任务编号和实际改动。不要提交真实书籍、用户备份、密钥、`node_modules`、`dist` 或本机测试报告；`artifacts` 仅保留空目录占位，验收报告在本机或对应 CI 运行中查阅。

反馈可在 [GitHub Issues](https://github.com/liaozhiliang222-cloud/reader/issues) 提交，或发至 [liaozhiliang222@gmail.com](mailto:liaozhiliang222@gmail.com)。请附版本、复现步骤、预期与实际结果；截图或样本由反馈者自行决定是否提供。
