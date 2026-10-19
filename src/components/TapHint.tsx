import { t } from '@/i18n';
import { useEffect, useState } from 'preact/hooks';
import type { ReadingSettings } from '@/types';

/**
 * 首次进入阅读页时短暂显示点按分区，不拦截操作：任意按下或数秒后消失。
 * 沿用 quiet-hint 类名，与安静提示同属进入阅读时的一次性短暂提示。
 */
export function TapHint({
  mode,
  onShown,
}: {
  mode: ReadingSettings['tapMode'];
  onShown: () => void;
}) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    onShown();
    const hide = () => setVisible(false);
    const timer = window.setTimeout(hide, 3000);
    document.addEventListener('pointerdown', hide, { once: true });
    document.addEventListener('keydown', hide, { once: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('keydown', hide);
    };
  }, []);
  if (!visible) return null;
  const sides =
    mode === 'oneHand'
      ? [t('下一页'), t('下一页')]
      : [t('上一页'), t('下一页')];
  return (
    <div class="quiet-hint tap-hint" role="status">
      <span>{sides[0]}</span>
      <span>
        {t('菜单')}
        <small>{t('点按中间')}</small>
      </span>
      <span>{sides[1]}</span>
      {mode === 'oneHand' && <em>{t('左上角：上一页')}</em>}
    </div>
  );
}
