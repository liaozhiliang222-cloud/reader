import { useState } from 'preact/hooks';
import { environment } from '@/app/environment';
import { settings } from '@/app/settings';
import { saveSettings } from '@/db/settings';
import { isNativeApp } from '@/app/platform';

export function EnvironmentNotice() {
  const { inApp, ios, olderIos } = environment();
  // 按提示内容记忆关闭状态：换到另一种受限环境时仍会提示一次。
  const kind = inApp ? `inApp:${inApp}` : olderIos ? 'olderIos' : undefined;
  const [dismissed, setDismissed] = useState(false);
  if (isNativeApp) return null;
  if (!kind || dismissed || settings.value.environmentNoticeDismissed === kind)
    return null;
  return (
    <aside class="environment-notice" aria-label="浏览器使用提示">
      <p>
        {inApp
          ? `当前为${inApp}内置浏览器，请点右上角菜单用${ios ? ' Safari ' : '系统浏览器'}打开。切换浏览器不会带走书籍，已有数据请先备份。`
          : '当前 iOS 低于 16.4，部分安装和离线能力受限，建议升级系统。'}
      </p>
      <button
        class="text-button"
        onClick={() => {
          setDismissed(true);
          void saveSettings({ environmentNoticeDismissed: kind })
            .then((value) => {
              settings.value = value;
            })
            .catch(() => {});
        }}
        aria-label="关闭浏览器提示，不再显示"
      >
        知道了
      </button>
    </aside>
  );
}
