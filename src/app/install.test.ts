import { expect, it, vi } from 'vitest';
import { createInstallController, type InstallState } from './install';

function fixture(standalone = false) {
  const events = new EventTarget(),
    mediaEvents = new EventTarget();
  let matches = false;
  const display = {
    get matches() {
      return matches;
    },
    addEventListener: mediaEvents.addEventListener.bind(mediaEvents),
    removeEventListener: mediaEvents.removeEventListener.bind(mediaEvents),
  };
  const changes: InstallState[] = [];
  const controller = createInstallController(
    events,
    display,
    () => standalone,
    (value) => changes.push(value),
  );
  return {
    events,
    controller,
    changes,
    state: () => changes.at(-1)!,
    setDisplay: (value: boolean) => {
      matches = value;
      mediaEvents.dispatchEvent(new Event('change'));
    },
  };
}
function promptEvent(choice: Promise<{ outcome: 'accepted' | 'dismissed' }>) {
  return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: choice,
  });
}
it('捕获事件但不自动弹窗，用户点击同步调用一次；接受选择不冒称安装完成', async () => {
  const f = fixture();
  const event = promptEvent(Promise.resolve({ outcome: 'accepted' }));
  f.events.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(f.state().available).toBe(true);
  expect(event.prompt).not.toHaveBeenCalled();
  const requested = f.controller.request();
  expect(event.prompt).toHaveBeenCalledOnce();
  expect(f.state().pending).toBe(true);
  await requested;
  await f.controller.request();
  expect(event.prompt).toHaveBeenCalledOnce();
  expect(f.state()).toMatchObject({
    available: false,
    pending: false,
    installed: false,
  });
  expect(f.state().message).toContain('已提交安装');
  f.events.dispatchEvent(new Event('appinstalled'));
  expect(f.state().installed).toBe(true);
  f.controller.dispose();
});
it('取消或失败后消费旧事件；下一次可安装事件才重新提供入口', async () => {
  const f = fixture();
  const dismissed = promptEvent(Promise.resolve({ outcome: 'dismissed' }));
  f.events.dispatchEvent(dismissed);
  await f.controller.request();
  expect(f.state().message).toContain('已取消');
  expect(f.state().available).toBe(false);
  const failed = promptEvent(Promise.resolve({ outcome: 'accepted' }));
  failed.prompt.mockRejectedValue(new Error('NotAllowedError'));
  f.events.dispatchEvent(failed);
  expect(f.state().available).toBe(true);
  await f.controller.request();
  expect(f.state().message).toContain('浏览器菜单');
  expect(f.state().pending).toBe(false);
  f.controller.dispose();
});
it('重复点击、等待时安装完成或到达新事件不会重复弹窗或被迟到结果覆盖', async () => {
  const f = fixture();
  let resolve!: (choice: { outcome: 'accepted' | 'dismissed' }) => void;
  const event = promptEvent(
    new Promise((done) => {
      resolve = done;
    }),
  );
  f.events.dispatchEvent(event);
  const requested = f.controller.request();
  await f.controller.request();
  expect(event.prompt).toHaveBeenCalledOnce();
  f.events.dispatchEvent(new Event('appinstalled'));
  resolve({ outcome: 'dismissed' });
  await requested;
  expect(f.state().message).toContain('确认安装');
  expect(f.state().installed).toBe(true);
  f.controller.dispose();
});
it('主屏幕环境隐藏安装入口，显示模式变更及销毁后的迟到事件均处理', async () => {
  const ios = fixture(true);
  const event = promptEvent(Promise.resolve({ outcome: 'accepted' }));
  ios.events.dispatchEvent(event);
  await ios.controller.request();
  expect(ios.state().installed).toBe(true);
  expect(event.prompt).not.toHaveBeenCalled();
  ios.controller.dispose();
  const f = fixture();
  f.events.dispatchEvent(event);
  f.setDisplay(true);
  expect(f.state()).toMatchObject({ installed: true, available: false });
  f.controller.dispose();
  const count = f.changes.length;
  f.setDisplay(false);
  f.events.dispatchEvent(new Event('appinstalled'));
  f.events.dispatchEvent(event);
  expect(f.changes.length).toBe(count);
});
it('旧版媒体监听及缺少能力的环境都可继续使用，不在启动时抛错', () => {
  const legacy = {
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };
  const changed = vi.fn();
  const controller = createInstallController(
    new EventTarget(),
    legacy,
    () => false,
    changed,
  );
  expect(legacy.addListener).toHaveBeenCalledOnce();
  controller.dispose();
  expect(legacy.removeListener).toHaveBeenCalledOnce();
  const fallback = createInstallController(
    new EventTarget(),
    { matches: false },
    () => false,
    changed,
  );
  expect(changed).toHaveBeenLastCalledWith({
    available: false,
    installed: false,
    pending: false,
    message: '',
  });
  fallback.dispose();
});
