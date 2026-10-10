import { useEffect, useRef, useState } from 'preact/hooks';
import { createSnapshot } from '@/backup/snapshot';
import {
  generateFullBackup,
  inspectBackup,
  restoreFromBackup,
} from '@/backup/client';
import {
  backupFilename,
  type BackupPreview,
  type BackupProgress,
} from '@/backup/types';
import { downloadBlob, shareBlob } from '@/app/files';
import { settings } from '@/app/settings';
import { markBackupSaved } from '@/db/backupReminder';
import { Modal } from '@/components/Modal';

export function BackupPanel({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null),
    live = useRef(true),
    working = useRef(false);
  const notify = useRef(onBusy);
  const controller = useRef<AbortController | undefined>(undefined);
  notify.current = onBusy;
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [progress, setProgress] = useState<BackupProgress>();
  const [generated, setGenerated] = useState<{
    blob: Blob;
    name: string;
    missing: number;
    exportedAt: number;
  }>();
  const [preview, setPreview] = useState<BackupPreview>();
  const [mode, setMode] = useState<'merge' | 'overwrite'>('merge'),
    [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      controller.current?.abort();
    };
  }, []);
  const report = (value: BackupProgress) => {
    if (live.current) setProgress(value);
  };
  const run = async (action: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    controller.current = new AbortController();
    setBusy(true);
    notify.current(true);
    setMessage('');
    try {
      await action();
    } catch (cause) {
      if (live.current && cause instanceof Error && cause.name === 'AbortError')
        setMessage('操作已取消。');
      if (
        live.current &&
        !(cause instanceof Error && cause.name === 'AbortError')
      )
        setMessage(
          cause instanceof Error ? cause.message : '备份处理失败，请重试。',
        );
    } finally {
      working.current = false;
      if (live.current) {
        setBusy(false);
        setProgress(undefined);
        notify.current(false);
      }
    }
  };
  const generate = (kind: 'light' | 'full') =>
    void run(async () => {
      setGenerated(undefined);
      setPreview(undefined);
      report({ percent: 0, message: '正在读取本机数据…' });
      const payload = await createSnapshot(kind);
      if (!live.current) return;
      const blob =
        kind === 'full'
          ? await generateFullBackup(
              payload,
              report,
              controller.current?.signal,
            )
          : new Blob([JSON.stringify(payload.backup, null, 2)], {
              type: 'application/json',
            });
      if (live.current)
        setGenerated({
          blob,
          exportedAt: payload.backup.exportedAt,
          name: backupFilename(kind, new Date(payload.backup.exportedAt)),
          missing:
            kind === 'full'
              ? payload.backup.books.length - payload.backup.files.length
              : 0,
        });
    });
  const inspect = (file: File) =>
    void run(async () => {
      setGenerated(undefined);
      setPreview(undefined);
      report({ percent: 0, message: '正在读取备份…' });
      const payload = await inspectBackup(
        file,
        report,
        controller.current?.signal,
      );
      if (live.current) {
        setMode('merge');
        setConfirmed(false);
        setPreview(payload);
      }
    });
  const saveFile = (share: boolean) =>
    void run(async () => {
      if (!generated) return;
      if (share) await shareBlob(generated.blob, generated.name);
      else downloadBlob(generated.blob, generated.name);
      const value = await markBackupSaved(generated.exportedAt);
      if (live.current) {
        settings.value = value;
        setMessage('已交给浏览器保存，请确认备份文件已保存。');
      }
    });
  const restore = () =>
    void run(async () => {
      if (!preview || (mode === 'overwrite' && !confirmed)) return;
      report({ percent: 0, message: '正在验证原文与位置…' });
      const result = await restoreFromBackup(
        preview,
        mode,
        report,
        controller.current?.signal,
      );
      if (live.current) {
        settings.value = result.settings;
        setPreview(undefined);
        setMessage(
          `恢复完成。书架共 ${result.books} 本${result.missing ? `，${result.missing} 本待补充原文件` : ''}。`,
        );
      }
    });
  return (
    <>
      <h3>备份与恢复</h3>
      <p>
        轻量备份保存书架、进度、书签、笔记与设置；完整备份还包含书籍和文稿原文。请将备份保存在此浏览器之外。
      </p>
      <div class="data-actions">
        <button disabled={busy} onClick={() => generate('light')}>
          生成轻量备份
        </button>
        <button disabled={busy} onClick={() => generate('full')}>
          生成完整备份
        </button>
        <button disabled={busy} onClick={() => input.current?.click()}>
          从备份恢复
        </button>
      </div>
      <input
        ref={input}
        class="file-input"
        type="file"
        accept=".json,.zip,application/json,application/zip"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) inspect(file);
        }}
      />
      {progress && (
        <div class="backup-progress" role="status">
          <p>{progress.message}</p>
          <progress value={progress.percent} max={100} />
        </div>
      )}
      {generated && (
        <div class="backup-ready">
          <p>
            {generated.name} · {(generated.blob.size / 1024 / 1024).toFixed(2)}{' '}
            MB，已生成。
          </p>
          {!!generated.missing && (
            <p role="alert">
              {generated.missing}{' '}
              本书的原文件不可用。此次备份仍保留它们的进度与笔记，恢复后需要补充原文件。
            </p>
          )}
          <div class="data-actions">
            <button disabled={busy} onClick={() => saveFile(false)}>
              下载备份
            </button>
            {typeof navigator.share === 'function' && (
              <button disabled={busy} onClick={() => saveFile(true)}>
                分享备份
              </button>
            )}
          </div>
        </div>
      )}
      <p role="status">{message}</p>
      {preview && (
        <Modal
          title="预览备份并恢复"
          onDismiss={() => {
            if (!busy) setPreview(undefined);
          }}
        >
          <h2>恢复备份</h2>
          <p>
            备份时间：
            {new Date(preview.backup.exportedAt).toLocaleString('zh-CN')}
          </p>
          <p>
            {preview.backup.books.length} 本书 ·{' '}
            {preview.backup.bookmarks.length} 个书签 ·{' '}
            {preview.backup.highlights.length} 条划线笔记 ·{' '}
            {preview.backup.files.length} 份原文
          </p>
          <p>
            未包含原文的书可使用本机已有的同一文件；其余书恢复后显示“待补充文件”，重新导入原文件即可挂接进度与笔记。文稿可重新粘贴相同正文。
          </p>
          <fieldset disabled={busy} class="restore-choices">
            <legend>恢复方式</legend>
            <label>
              <input
                type="radio"
                name="restore-mode"
                checked={mode === 'merge'}
                onChange={() => {
                  setMode('merge');
                  setConfirmed(false);
                }}
              />
              合并（推荐）
            </label>
            <p>
              保留本机已有书名、排版与默认设置；进度与同ID笔记采用较新记录。新设备使用备份中的设置。
            </p>
            <label>
              <input
                type="radio"
                name="restore-mode"
                checked={mode === 'overwrite'}
                onChange={() => setMode('overwrite')}
              />
              覆盖
            </label>
            <p>
              将书架、书签、笔记和设置替换为此备份。备份未包含的本机书籍会删除。
            </p>
            {mode === 'overwrite' && (
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) =>
                    setConfirmed(event.currentTarget.checked)
                  }
                />
                我确认按此备份覆盖本机数据
              </label>
            )}
          </fieldset>
          {progress && <p role="status">{progress.message}</p>}
          {message && <p role="alert">{message}</p>}
          <div class="data-actions">
            <button
              onClick={() => {
                if (busy) {
                  controller.current?.abort();
                  setMessage('正在取消恢复…');
                } else setPreview(undefined);
              }}
            >
              {busy ? '取消恢复' : '取消'}
            </button>
            <button
              disabled={busy || (mode === 'overwrite' && !confirmed)}
              onClick={restore}
            >
              {busy ? '恢复中…' : mode === 'merge' ? '合并恢复' : '覆盖恢复'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
