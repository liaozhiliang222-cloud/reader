import { ArchivePicker } from '@/components/ArchivePicker';
import { useEffect, useState } from 'preact/hooks';
import { incomingStore, incomingChanged } from '@/app/incoming';
import { validIncomingId } from '@/app/incomingData';
import type { IncomingData } from '@/app/incomingData';
import type { ImportItem } from '@/parsers/batch';
import { processIncoming } from '@/app/incomingJobs';
import { navigate } from '@/app/router';
import { BookLoading } from '@/components/BookLoading';

export function IncomingPage({ id }: { id?: string }) {
  const [archive, setArchive] = useState<File>();
  const [data, setData] = useState<IncomingData>();
  const [items, setItems] = useState<ImportItem[]>([]);
  const [busy, setBusy] = useState(!!id && validIncomingId(id));
  const [error, setError] = useState(
    id === 'error-size'
      ? '这次分享超过大小限制，请分批分享；单本书最多 50 MB。'
      : id === 'error-storage'
        ? '无法暂存分享，请先打开静页并检查本地存储，再重新分享。'
        : id?.startsWith('error')
          ? '没有收到可用文件或文字，请重新分享，或从书架选择文件导入。'
          : '',
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!id || !validIncomingId(id)) return;
    let live = true;
    setBusy(true);
    setError('');
    const task = processIncoming(id, setItems);
    void task.promise
      .then(({ items: result, data: pending }) => {
        if (!live) return;
        setItems(result);
        setData(pending);
        if (!result.length && pending.text && !pending.errors.length)
          navigate('#/paste-share/' + id, true);
        else if (
          result.length === 1 &&
          result[0]?.book &&
          !pending.files.length &&
          !pending.text &&
          !pending.errors.length
        )
          navigate('#/read/' + encodeURIComponent(result[0].book.id), true);
      })
      .catch((cause) => {
        if (live)
          setError(
            cause instanceof Error
              ? cause.message
              : '无法读取分享，请重新导入。',
          );
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
      task.release();
    };
  }, [id, attempt]);
  const discard = async () => {
    if (busy) return;
    try {
      if (id && validIncomingId(id)) {
        await incomingStore().remove(id);
        incomingChanged();
      }
      navigate('#/');
    } catch {
      setError('无法清理分享暂存，请稍后重试。');
    }
  };
  if (archive)
    return (
      <ArchivePicker
        file={archive}
        onClose={() => setArchive(undefined)}
        onComplete={(result) => {
          setItems([...items, ...result]);
          setArchive(undefined);
        }}
      />
    );
  return (
    <main class="paste-page">
      <header class="panel-heading">
        <h1>接收分享</h1>
        <button disabled={busy} onClick={() => navigate('#/')}>
          返回书架
        </button>
      </header>
      {busy ? (
        <BookLoading
          title="正在导入书籍"
          fileName={items.find((item) => item.status === 'parsing')?.name}
          detail={
            items.length
              ? `正在解析 · 第 ${Math.min(items.filter((item) => item.status !== 'waiting' && item.status !== 'parsing').length + 1, items.length)} / ${items.length} 本`
              : '正在准备分享文件…'
          }
        />
      ) : (
        <p role="status">
          {!id
            ? '等待系统发送文件，也可以从书架选择文件导入。'
            : '分享内容只在本机处理。'}
        </p>
      )}
      {data?.files
        .filter(
          (file) =>
            /\.zip$/i.test(file.name) &&
            !/\.(md|markdown)\.zip$/i.test(file.name),
        )
        .map((file) => (
          <button key={file.name} onClick={() => setArchive(file)}>
            选择 {file.name} 中的书籍
          </button>
        ))}
      {!!items.length && (
        <ol class="import-results">
          {items.map((item, index) => (
            <li key={index}>
              <strong>{item.name}</strong>
              <span>
                {item.status === 'success'
                  ? '导入成功'
                  : item.status === 'duplicate'
                    ? '已在书架，原进度已保留'
                    : item.status === 'error'
                      ? '导入失败'
                      : '正在导入'}
              </span>
              {item.error && <p role="alert">{item.error}</p>}
              {item.book && !busy && (
                <button
                  onClick={() =>
                    navigate('#/read/' + encodeURIComponent(item.book!.id))
                  }
                >
                  阅读《{item.book.title}》
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {data?.errors.map((message) => (
        <p role="alert">{message}</p>
      ))}
      {data?.text && !busy && (
        <button onClick={() => navigate('#/paste-share/' + id)}>
          检查分享文字
        </button>
      )}
      {!!data?.files.length && !busy && (
        <p>未导入文件已留在本机，返回书架后可重新处理。</p>
      )}
      {!!data?.files.length && !busy && (
        <button onClick={() => setAttempt((value) => value + 1)}>
          重试未导入文件
        </button>
      )}
      {id &&
        validIncomingId(id) &&
        !busy &&
        (!!(data?.files.length || data?.text || data?.errors.length) ||
          error) && (
          <button onClick={() => void discard()}>放弃这份待导入分享</button>
        )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
