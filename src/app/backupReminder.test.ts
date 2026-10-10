import { expect, it } from 'vitest';
import { BACKUP_PERIOD as period, backupReminder } from './backupReminder';

it('只有超过30天且有新划线/笔记才提醒，精确边界、空记录和未来日期不提醒', () => {
  const settings = { lastBackupAt: 1000 };
  expect(
    backupReminder(settings, { firstAt: 10, lastAt: 2000 }, 1000 + period),
  ).toBeUndefined();
  expect(
    backupReminder(settings, { firstAt: 10, lastAt: 2000 }, 1001 + period),
  ).toEqual({ baseline: 1000, cycle: 1 });
  expect(
    backupReminder(settings, { firstAt: 10, lastAt: 1000 }, 1001 + period),
  ).toBeUndefined();
  expect(backupReminder(settings, {}, 1001 + period)).toBeUndefined();
  expect(
    backupReminder(
      { lastBackupAt: period * 9 },
      { lastAt: period * 10 },
      period * 8,
    ),
  ).toBeUndefined();
});
it('首次未备份从第一条标注计时，安装之初不立即提醒，也不把关闭状态无限延长', () => {
  expect(
    backupReminder({}, { firstAt: 1000, lastAt: 2000 }, 1001 + period),
  ).toEqual({ baseline: 1000, cycle: 1 });
  expect(
    backupReminder({}, { firstAt: 1000, lastAt: 2000 }, 2000),
  ).toBeUndefined();
  const state = {
    lastBackupAt: 1000,
    backupReminderDismissed: { baseline: 1000, cycle: 1 },
  };
  expect(
    backupReminder(state, { lastAt: 2000 }, 1001 + period),
  ).toBeUndefined();
  expect(
    backupReminder(state, { lastAt: 3000 }, 1000 + 2 * period - 1),
  ).toBeUndefined();
  expect(backupReminder(state, { lastAt: 3000 }, 1000 + 2 * period)).toEqual({
    baseline: 1000,
    cycle: 2,
  });
  expect(
    backupReminder(
      { ...state, lastBackupAt: 5000 },
      { lastAt: 6000 },
      5001 + period,
    ),
  ).toEqual({ baseline: 5000, cycle: 1 });
});
