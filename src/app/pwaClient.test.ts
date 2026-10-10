// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPwaClient, initialPwaState, type PwaState } from './pwaClient';

function setup(controlled = true) {
  const worker = Object.assign(new EventTarget(), {
    state: 'installing',
    postMessage: vi.fn(),
  });
  const registration = Object.assign(new EventTarget(), {
    waiting: null as ServiceWorker | null,
    active: controlled ? worker : null,
    installing: worker as unknown as ServiceWorker,
    update: vi.fn(
      async () => registration as unknown as ServiceWorkerRegistration,
    ),
  });
  const container = Object.assign(new EventTarget(), {
    controller: controlled ? worker : null,
    register: vi.fn<
      (
        url: string | URL,
        options?: RegistrationOptions,
      ) => Promise<ServiceWorkerRegistration>
    >(async () => registration as unknown as ServiceWorkerRegistration),
  });
  let state: PwaState = initialPwaState();
  let online = true,
    visible = true,
    shelf = true;
  const reload = vi.fn();
  const client = createPwaClient(
    container as unknown as ServiceWorkerContainer,
    (value) => {
      state = value;
    },
    {
      online: () => online,
      visible: () => visible,
      shelf: () => shelf,
      reload,
    },
  );
  const installed = () => {
    worker.state = 'installed';
    registration.waiting = worker as unknown as ServiceWorker;
    worker.dispatchEvent(new Event('statechange'));
  };
  return {
    client,
    container,
    registration,
    worker,
    reload,
    installed,
    state: () => state,
    offline: () => {
      online = false;
    },
    hide: () => {
      visible = false;
    },
    read: () => {
      shelf = false;
    },
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it('点击更新后若已进入阅读，不因迟到的激活事件刷新；释放监听后不再更新状态', async () => {
  const pwa = setup();
  await pwa.client.start(true);
  pwa.installed();
  pwa.client.apply();
  pwa.read();
  pwa.container.dispatchEvent(new Event('controllerchange'));
  expect(pwa.reload).not.toHaveBeenCalled();
  expect(pwa.state().applying).toBe(false);
  expect(pwa.state().error).toContain('下次打开');
  pwa.client.dispose();
  const previous = pwa.state();
  pwa.installed();
  expect(pwa.state()).toBe(previous);
  expect(vi.getTimerCount()).toBe(0);
});
it('注册失败显示真实离线状态，重试可成功而不抛出未捕获拒绝', async () => {
  const pwa = setup(false);
  pwa.container.register.mockRejectedValueOnce(new Error('not secure'));
  await pwa.client.start(true);
  expect(pwa.state().offlineReady).toBe(false);
  expect(pwa.state().error).toContain('尚未就绪');
  await pwa.client.start(true);
  expect(pwa.container.register).toHaveBeenCalledTimes(2);
  expect(pwa.state().error).toBe('');
  pwa.worker.state = 'redundant';
  pwa.worker.dispatchEvent(new Event('statechange'));
  expect(pwa.state().offlineReady).toBe(false);
  expect(pwa.state().error).toContain('下载未完成');
  pwa.client.dispose();
});
it('只注册一次；初次离线资源就绪不要求更新或刷新', async () => {
  const pwa = setup(false);
  await pwa.client.start(true);
  await pwa.client.start(true);
  pwa.installed();
  expect(pwa.state()).toMatchObject({ offlineReady: true, available: false });
  pwa.container.dispatchEvent(new Event('controllerchange'));
  expect(pwa.reload).not.toHaveBeenCalled();
  expect(pwa.container.register).toHaveBeenCalledTimes(1);
  expect(pwa.container.register.mock.calls[0]?.[1]).toEqual({
    updateViaCache: 'none',
  });
  pwa.client.dispose();
});
it('下载新版本后等书架主动点击，其他标签激活不刷新阅读页', async () => {
  const pwa = setup();
  await pwa.client.start(true);
  pwa.installed();
  pwa.read();
  pwa.client.apply();
  expect(pwa.state().available).toBe(true);
  expect(pwa.worker.postMessage).not.toHaveBeenCalled();
  pwa.container.dispatchEvent(new Event('controllerchange'));
  expect(pwa.reload).not.toHaveBeenCalled();
  pwa.client.dispose();
  const shelf = setup();
  await shelf.client.start(true);
  shelf.installed();
  shelf.client.apply();
  expect(shelf.worker.postMessage).toHaveBeenCalledWith({
    type: 'SKIP_WAITING',
  });
  expect(shelf.state().applying).toBe(true);
  shelf.container.dispatchEvent(new Event('controllerchange'));
  expect(shelf.reload).toHaveBeenCalledTimes(1);
  expect(shelf.state().applying).toBe(false);
  expect(vi.getTimerCount()).toBe(1);
  shelf.client.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
it('关闭自动检查不主动定时联网，但允许手动检查；后台和断网跳过', async () => {
  const pwa = setup();
  await pwa.client.start(false);
  await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
  await pwa.client.check();
  expect(pwa.registration.update).not.toHaveBeenCalled();
  await pwa.client.check(true);
  expect(pwa.registration.update).toHaveBeenCalledTimes(1);
  pwa.client.configure(true);
  pwa.hide();
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  expect(pwa.registration.update).toHaveBeenCalledTimes(1);
  pwa.offline();
  await pwa.client.check(true);
  expect(pwa.registration.update).toHaveBeenCalledTimes(1);
  pwa.client.dispose();
});
it('检查失败保留离线和等待更新状态；激活超时恢复按钮，迟到事件不反复刷新', async () => {
  const pwa = setup();
  await pwa.client.start(true);
  pwa.installed();
  pwa.registration.update.mockRejectedValue(new Error('network'));
  await pwa.client.check(true);
  expect(pwa.state()).toMatchObject({
    checking: false,
    available: true,
    offlineReady: true,
  });
  expect(pwa.state().error).toContain('无法检查');
  pwa.client.apply();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(pwa.state().applying).toBe(false);
  expect(pwa.state().error).toContain('暂未完成');
  pwa.container.dispatchEvent(new Event('controllerchange'));
  expect(pwa.reload).not.toHaveBeenCalled();
  pwa.client.dispose();
});
