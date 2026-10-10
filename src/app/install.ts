import { signal } from '@preact/signals';
import { listenMedia, mediaState, type MediaState } from './media';
import { isNativeApp } from './platform';

interface InstallPrompt extends Event {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
export interface InstallState {
  available: boolean;
  installed: boolean;
  pending: boolean;
  message: string;
}
export const installState = signal<InstallState>({
  available: false,
  installed: false,
  pending: false,
  message: '',
});
export function createInstallController(
  events: EventTarget,
  display: MediaState,
  standalone: () => boolean,
  changed: (value: InstallState) => void,
) {
  let deferred: InstallPrompt | undefined,
    pending = false,
    confirmed = false,
    message = '',
    live = true;
  const installed = () => confirmed || display.matches || standalone();
  const publish = () => {
    if (live)
      changed({
        available: !!deferred && !installed(),
        installed: installed(),
        pending,
        message,
      });
  };
  const before = (event: Event) => {
    const candidate = event as Partial<InstallPrompt>;
    if (
      installed() ||
      typeof candidate.prompt !== 'function' ||
      !candidate.userChoice
    )
      return;
    event.preventDefault();
    deferred = event as InstallPrompt;
    message = '';
    publish();
  };
  const complete = () => {
    confirmed = true;
    deferred = undefined;
    message = '浏览器已确认安装，可从主屏幕打开。';
    publish();
  };
  const displayChanged = () => {
    if (installed()) deferred = undefined;
    publish();
  };
  events.addEventListener('beforeinstallprompt', before);
  events.addEventListener('appinstalled', complete);
  const unlisten = listenMedia(display, displayChanged);
  publish();
  return {
    async request() {
      const event = deferred;
      if (!live || !event || pending || installed()) return;
      deferred = undefined;
      pending = true;
      message = '';
      publish();
      try {
        // 用户点击时同步调用，保留浏览器要求的用户手势。
        await event.prompt();
        const choice = await event.userChoice;
        if (!installed())
          message =
            choice.outcome === 'accepted'
              ? '已提交安装，请按浏览器提示完成。'
              : '已取消安装，仍可在浏览器中阅读。';
      } catch {
        if (!installed())
          message = '当前无法弹出安装窗口，请使用浏览器菜单添加到主屏幕。';
      } finally {
        pending = false;
        publish();
      }
    },
    dispose() {
      live = false;
      deferred = undefined;
      events.removeEventListener('beforeinstallprompt', before);
      events.removeEventListener('appinstalled', complete);
      unlisten();
    },
  };
}
let controller: ReturnType<typeof createInstallController> | undefined;
export function startInstall() {
  if (isNativeApp) {
    installState.value = {
      available: false,
      installed: true,
      pending: false,
      message: '',
    };
    return;
  }
  controller ??= createInstallController(
    window,
    mediaState('(display-mode: standalone)'),
    () =>
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    (value) => {
      installState.value = value;
    },
  );
}
export function requestInstall() {
  return controller?.request();
}
if (import.meta.hot) import.meta.hot.dispose(() => controller?.dispose());
