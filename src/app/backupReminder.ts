import type { AppSettings } from '@/types';

export const BACKUP_PERIOD = 30 * 24 * 60 * 60 * 1000;
export interface AnnotationActivity {
  firstAt?: number;
  lastAt?: number;
}
export function backupReminder(
  settings: Pick<AppSettings, 'lastBackupAt' | 'backupReminderDismissed'>,
  activity: AnnotationActivity,
  now: number,
) {
  const baseline = settings.lastBackupAt ?? activity.firstAt;
  if (
    baseline === undefined ||
    activity.lastAt === undefined ||
    !Number.isFinite(now) ||
    now - baseline <= BACKUP_PERIOD ||
    (settings.lastBackupAt !== undefined &&
      activity.lastAt <= settings.lastBackupAt)
  )
    return;
  const cycle = Math.floor((now - baseline) / BACKUP_PERIOD);
  const dismissed = settings.backupReminderDismissed;
  if (dismissed?.baseline === baseline && dismissed.cycle === cycle) return;
  return { baseline, cycle };
}
