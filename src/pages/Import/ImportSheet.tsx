import { useRef, useState } from 'preact/hooks';
import { Modal } from '@/components/Modal';
import { importText } from '@/parsers/importText';
import { importBatch, type ImportItem } from '@/parsers/batch';
import { navigate } from '@/app/router';

const labels = {
  waiting: '等待中',
  parsing: '正在解析',
  success: '导入成功',
  duplicate: '已在书架',
  error: '导入失败',
};
const marks = {
  waiting: '·',
  parsing: '…',
  success: '✓',
  duplicate: '=',
  error: '✕',
};
export function ImportSheet({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: (items: ImportItem[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [busy, setBusy] = useState(false);
  const select = async (files: File[]) => {
    if (!files.length || busy) return;
    setBusy(true);
    try {
      const result = await importBatch(files, importText, setItems);
      onComplete(result);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const finished = items.filter(
    (item) => !['waiting', 'parsing'].includes(item.status),
  ).length;
  return (
    <Modal
      title="导入书籍"
      onDismiss={() => {
        if (!busy) onClose();
      }}
    >
      <header class="panel-heading">
        <h2>导入书籍</h2>
        <button disabled={busy} onClick={onClose} aria-label="关闭导入面板">
          关闭
        </button>
      </header>
      <p class="muted">选择本机的 EPUB、TXT、Markdown，或把长文粘贴成文稿。</p>
      <p class="muted">
        带图片的文章：把一个 Markdown 文件和图片文件夹一起压缩，命名为 .md.zip
        后导入。
      </p>
      <input
        ref={input}
        class="file-input"
        type="file"
        multiple
        accept=".epub,.txt,.md,.markdown,.zip,text/plain,text/markdown,text/x-markdown,application/epub+zip,application/zip"
        aria-label="选择书籍文件"
        disabled={busy}
        onChange={(event) =>
          void select(Array.from(event.currentTarget.files ?? []))
        }
      />
      <div class="panel-actions">
        <button disabled={busy} onClick={() => input.current?.click()}>
          选择文件
        </button>
        <button
          disabled={busy}
          onClick={() => {
            onClose();
            navigate('#/paste');
          }}
        >
          粘贴文本
        </button>
      </div>
      {!!items.length && (
        <>
          <p role="status" aria-live="polite">
            {busy
              ? `正在导入 ${Math.min(finished + 1, items.length)} / ${items.length}`
              : `导入完成：${items.filter((i) => i.status === 'success').length} 本成功，${items.filter((i) => i.status === 'duplicate').length} 本已在书架，${items.filter((i) => i.status === 'error').length} 本失败`}
          </p>
          <ul class="import-results import-list">
            {items.map((item, index) => {
              const body = (
                <>
                  <span class="import-mark" aria-hidden="true">
                    {marks[item.status]}
                  </span>
                  <span class="import-name">{item.name}</span>
                  <small>{labels[item.status]}</small>
                </>
              );
              return (
                <li key={index} data-status={item.status}>
                  {item.book && !busy ? (
                    <button
                      class="import-row"
                      aria-label={`阅读《${item.book.title}》`}
                      onClick={() =>
                        navigate('#/read/' + encodeURIComponent(item.book!.id))
                      }
                    >
                      {body}
                    </button>
                  ) : (
                    <div class="import-row">{body}</div>
                  )}
                  {item.error && <p role="alert">{item.error}</p>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Modal>
  );
}
