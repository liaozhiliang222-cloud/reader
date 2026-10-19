import { t } from '@/i18n';
import { useEffect, useRef, useState } from 'preact/hooks';
import { backupReminder, type AnnotationActivity } from '@/app/backupReminder';
import { annotationActivity } from '@/db/backupReminder';
import { saveSettings } from '@/db/settings';
import { settings } from '@/app/settings';
import { navigate } from '@/app/router';

export function BackupReminder({ revision }: { revision: number }) {
  const [activity, setActivity] = useState<AnnotationActivity>({});
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const working = useRef(false),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    let cancelled = false,
      request = 0;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      setNow(Date.now());
      const id = ++request;
      void annotationActivity()
        .then((value) => {
          if (!cancelled && request === id) setActivity(value);
        })
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true;
      live.current = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [revision]);
  const reminder = backupReminder(settings.value, activity, now);
  if (!reminder) return null;
  const dismiss = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await saveSettings({ backupReminderDismissed: reminder });
      if (live.current) settings.value = value;
    } catch {
      if (live.current) setError(t('提醒关闭状态未能保存，请重试。'));
    } finally {
      working.current = false;
      if (live.current) setBusy(false);
    }
  };
  return (
    <aside class="update-notice" aria-label={t('本地备份提醒')}>
      <p>
        {settings.value.lastBackupAt === undefined
          ? t('划线或笔记已保存超过 30 天，尚未保存过备份，建议现在保存一份。')
          : t('有新划线或笔记尚未备份，距离上次备份已超过 30 天。')}
      </p>
      <button onClick={() => navigate('#/settings/backup')}>
        {t('去备份')}
      </button>{' '}
      <button disabled={busy} onClick={() => void dismiss()}>
        {t('本周期不再提醒')}
      </button>
      {error && <p role="status">{error}</p>}
    </aside>
  );
}
