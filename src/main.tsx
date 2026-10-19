import { render } from 'preact';
import { App } from '@/app/App';
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/reader.css';
import '@/styles/settings.css';
import '@/styles/import.css';
import '@/styles/onboarding.css';
import '@/styles/motion.css';
import { startInstall } from '@/app/install';
import { effect } from '@preact/signals';
import { startLanguage, uiLanguage, t } from '@/i18n';
import { isIosApp, nativeApp } from '@/app/platform';

async function bootstrap() {
  startLanguage();
  if (isIosApp)
    await nativeApp()
      .then((native) => native.setLanguage(uiLanguage.peek()))
      .catch(() => {});
  effect(() => {
    const language = uiLanguage.value;
    document.documentElement.lang = language;
    document.title = t('微光阅读');
    if (isIosApp)
      void nativeApp()
        .then((native) => native.setLanguage(language))
        .catch(() => {});
  });
  startInstall();
  // M0 验收入口，仅开发环境生效，不提前引入正式设置或持久化。
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(location.search);
    const theme = params.get('theme');
    if (theme && ['paper', 'eink', 'green', 'night'].includes(theme)) {
      document.documentElement.dataset.theme = theme;
    }
    const font = params.get('font');
    if (font === 'sans' || font === 'serif') {
      document.documentElement.dataset.font = font;
    }
  }
  if (
    import.meta.env.DEV &&
    new URLSearchParams(location.search).get('debug') === '1'
  ) {
    const { installDebugConsole, DebugPanel } =
      await import('@/components/DebugPanel');
    installDebugConsole();
    render(
      <>
        <App />
        <DebugPanel />
      </>,
      document.getElementById('app')!,
    );
    console.info(t('微光阅读开发环境已就绪'));
    return;
  }
  render(<App />, document.getElementById('app')!);
}

void bootstrap();
