export interface PwaState {
  available: boolean;
  offlineReady: boolean;
  checking: boolean;
  applying: boolean;
  error: string;
}
export const initialPwaState = (): PwaState => ({
  available: false,
  offlineReady: false,
  checking: false,
  applying: false,
  error: '',
});
interface Environment {
  online: () => boolean;
  visible: () => boolean;
  shelf: () => boolean;
  reload: () => void;
}
const interval = 60 * 60 * 1000;

export function createPwaClient(
  container: ServiceWorkerContainer,
  onState: (state: PwaState) => void,
  environment: Environment,
) {
  let state = initialPwaState();
  let registration: ServiceWorkerRegistration | undefined;
  let starting: Promise<void> | undefined;
  let enabled = true;
  let timer: ReturnType<typeof setInterval> | undefined;
  let activationTimer: ReturnType<typeof setTimeout> | undefined;
  let lastCheck = 0;
  let watched: ServiceWorker | undefined;
  const publish = (patch: Partial<PwaState>) => {
    state = { ...state, ...patch };
    onState(state);
  };
  const installed = () => {
    const worker = watched;
    if (!worker) return;
    if (worker.state === 'installed') {
      publish(
        container.controller
          ? { available: true, error: '' }
          : { offlineReady: true, error: '' },
      );
    } else if (worker.state === 'redundant') {
      publish({
        error: container.controller
          ? '新版本资源尚未下载完整，稍后会再检查。'
          : '离线资源下载未完成，请联网重新打开静页。',
      });
    }
  };
  const watch = () => {
    const worker = registration?.installing;
    if (!worker || watched === worker) return;
    watched?.removeEventListener('statechange', installed);
    watched = worker;
    worker.addEventListener('statechange', installed);
    installed();
  };
  const changed = () => {
    if (state.applying) {
      clearTimeout(activationTimer);
      publish({ applying: false, available: false });
      if (environment.shelf()) environment.reload();
      else publish({ error: '新版本已启用，下次打开应用即可使用。' });
    } else {
      // A different tab can activate a version without interrupting this tab.
      publish({ offlineReady: true, available: false });
    }
  };
  container.addEventListener('controllerchange', changed);

  const check = async (manual = false) => {
    if (!registration || state.checking || !environment.online()) return;
    if (
      !manual &&
      (!enabled || !environment.visible() || Date.now() - lastCheck < interval)
    )
      return;
    lastCheck = Date.now();
    publish({ checking: true, error: '' });
    try {
      await registration.update();
      if (registration.waiting) publish({ available: true });
    } catch {
      publish({ error: '暂时无法检查更新，已下载的应用仍可离线使用。' });
    } finally {
      publish({ checking: false });
    }
  };
  const configure = (value: boolean) => {
    enabled = value;
    clearInterval(timer);
    timer = enabled ? setInterval(() => void check(), interval) : undefined;
  };
  return {
    configure,
    async start(value: boolean) {
      configure(value);
      starting ??= container
        .register(new URL('sw.js', document.baseURI).href, {
          updateViaCache: 'none',
        })
        .then((registered) => {
          registration = registered;
          publish({ error: '' });
          lastCheck = Date.now();
          registration.addEventListener('updatefound', watch);
          if (registration.waiting) publish({ available: true });
          if (registration.active) publish({ offlineReady: true });
          watch();
        })
        .catch(() => {
          starting = undefined;
          publish({ error: '离线资源尚未就绪，请联网重新打开静页。' });
        });
      await starting;
    },
    check,
    apply() {
      if (!registration?.waiting || state.applying || !environment.shelf())
        return;
      publish({ applying: true, error: '' });
      activationTimer = setTimeout(() => {
        publish({ applying: false, error: '更新暂未完成，请稍后再试。' });
      }, 15_000);
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    },
    dispose() {
      clearInterval(timer);
      clearTimeout(activationTimer);
      registration?.removeEventListener('updatefound', watch);
      container.removeEventListener('controllerchange', changed);
      watched?.removeEventListener('statechange', installed);
    },
  };
}
