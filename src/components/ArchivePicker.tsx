import { useEffect, useState } from 'preact/hooks';
import { wrap, releaseProxy } from 'comlink';
import { Modal } from './Modal';
import { importText } from '@/parsers/importText';
import type { ImportItem } from '@/parsers/batch';
import type { archiveList, archiveRead } from '@/parsers/bookArchive';
import { runWorkerTask } from '@/workers/runTask';

export function ArchivePicker({
  file,
  onClose,
  onComplete,
}: {
  file: File;
  onClose(): void;
  onComplete(items: ImportItem[]): void;
}) {
  const [entries, setEntries] = useState<{ path: string; size: number }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const worker = new Worker(
      new URL('../workers/parse.worker.ts', import.meta.url),
      { type: 'module' },
    );
    const api = wrap<{ archiveList: typeof archiveList }>(worker);
    void runWorkerTask(worker, () => api.archiveList(file))
      .then((value) => {
        if (live) {
          setEntries(value);
          setSelected(value.map((entry) => entry.path));
        }
      })
      .catch((cause: unknown) => {
        if (live)
          setError(cause instanceof Error ? cause.message : '无法读取 ZIP。');
      })
      .finally(() => {
        api[releaseProxy]();
        worker.terminate();
        if (live) setBusy(false);
      });
    return () => {
      live = false;
      worker.terminate();
    };
  }, [file]);
  const run = async () => {
    setBusy(true);
    setError('');
    const worker = new Worker(
      new URL('../workers/parse.worker.ts', import.meta.url),
      { type: 'module' },
    );
    const api = wrap<{ archiveRead: typeof archiveRead }>(worker);
    const results: ImportItem[] = [];
    try {
      for (const path of selected) {
        try {
          const blob = await runWorkerTask(worker, () =>
            api.archiveRead(file, path),
          );
          const result = await importText(
            new File([blob], path.split('/').at(-1)!),
          );
          results.push({
            name: path,
            status: result.duplicate ? 'duplicate' : 'success',
            book: result.book,
          });
        } catch (cause) {
          results.push({
            name: path,
            status: 'error',
            error: cause instanceof Error ? cause.message : '此条目导入失败。',
          });
        }
      }
      onComplete(results);
    } finally {
      api[releaseProxy]();
      worker.terminate();
      setBusy(false);
    }
  };
  return (
    <Modal
      title="选择 ZIP 中的书籍"
      onDismiss={() => {
        if (!busy) onClose();
      }}
    >
      <h2>选择 ZIP 中的书籍</h2>
      <p>{file.name} · 支持 TXT、EPUB、Markdown；不递归解包。</p>
      {entries.map((entry) => (
        <label class="check-row" key={entry.path}>
          <input
            type="checkbox"
            checked={selected.includes(entry.path)}
            disabled={busy}
            onChange={(event) =>
              setSelected(
                event.currentTarget.checked
                  ? [...selected, entry.path]
                  : selected.filter((path) => path !== entry.path),
              )
            }
          />
          {entry.path} · {(entry.size / 1024).toFixed(1)} KB
        </label>
      ))}
      {!busy && !entries.length && !error && <p>压缩包中没有支持的书籍。</p>}
      {error && <p role="alert">{error}</p>}
      <div class="panel-actions">
        <button disabled={busy || !selected.length} onClick={() => void run()}>
          {busy ? '正在处理…' : `导入所选 ${selected.length} 本`}
        </button>
        <button disabled={busy} onClick={onClose}>
          关闭
        </button>
      </div>
    </Modal>
  );
}
