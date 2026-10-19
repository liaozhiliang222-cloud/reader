import { t } from '@/i18n';
import { useEffect, useState } from 'preact/hooks';

export function QuietHint({ enabled }: { enabled: boolean }) {
  const [visible, setVisible] = useState(enabled);
  useEffect(() => {
    setVisible(enabled);
    if (!enabled) return;
    const timer = window.setTimeout(() => setVisible(false), 2000);
    return () => window.clearTimeout(timer);
  }, [enabled]);
  return enabled && visible ? (
    <p class="quiet-hint" role="status">
      {t('已进入安静阅读')}
    </p>
  ) : null;
}
