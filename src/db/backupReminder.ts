import { db } from './index';
import { loadSettings, saveSettings } from './settings';
import type { AnnotationActivity } from '@/app/backupReminder';

/** 逐条统计时间，不把全部摘录和长笔记加载到书架状态中。 */
export async function annotationActivity(
  database = db,
): Promise<AnnotationActivity> {
  const activity: AnnotationActivity = {};
  await database.highlights.toCollection().each((item) => {
    activity.firstAt = Math.min(
      activity.firstAt ?? item.createdAt,
      item.createdAt,
    );
    activity.lastAt = Math.max(
      activity.lastAt ?? item.updatedAt,
      item.updatedAt,
    );
  });
  return activity;
}
export async function markBackupSaved(exportedAt: number) {
  return db.transaction('rw', db.settings, async () => {
    const current = await loadSettings();
    // 下载先前生成的文件不能把备份时间推进到后来未备份笔记之后。
    return saveSettings({
      lastBackupAt: Math.max(current.lastBackupAt ?? 0, exportedAt),
    });
  });
}
