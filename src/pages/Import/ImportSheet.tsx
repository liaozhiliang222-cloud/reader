import { t } from '@/i18n';
import { ArchivePicker } from '@/components/ArchivePicker';
import { isIosApp, nativeApp } from '@/app/platform';
import { useRef, useState } from 'preact/hooks';
import { Modal } from '@/components/Modal';
import { importText } from '@/parsers/importText';
import { importBatch, type ImportItem } from '@/parsers/batch';
import { navigate } from '@/app/router';
import { BookLoading } from '@/components/BookLoading';

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
  const [archives, setArchives] = useState<File[]>([]);
  const [pickerError, setPickerError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [busy, setBusy] = useState(false);
  const select = async (files: File[]) => {
    if (!files.length || busy) return;
    setBusy(true);
    try {
      const remainingArchives = files.filter(
        (file) =>
          /\.zip$/i.test(file.name) &&
          !/\.(md|markdown)\.zip$/i.test(file.name),
      );
      const plain = files.filter(
        (file) =>
          !/\.zip$/i.test(file.name) ||
          /\.(md|markdown)\.zip$/i.test(file.name),
      );
      const result = await importBatch(plain, importText, setItems);
      setArchives(remainingArchives);
      if (!remainingArchives.length) onComplete(result);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  if (archives[0])
    return (
      <ArchivePicker
        file={archives[0]}
        onClose={() => {
          setArchives(archives.slice(1));
          if (archives.length === 1) onComplete(items);
        }}
        onComplete={(result) => {
          const combined = [...items, ...result];
          setItems(combined);
          if (archives.length === 1) onComplete(combined);
          setArchives(archives.slice(1));
        }}
      />
    );
  const pick = async () => {
    if (!isIosApp) {
      input.current?.click();
      return;
    }
    try {
      const data = await (await nativeApp()).pickIncoming();
      if (data) {
        setPickerError(data.errors.join('；'));
        await select(data.files);
      }
    } catch (cause) {
      setPickerError(
        cause instanceof Error ? cause.message : t('未能选择文件。'),
      );
    }
  };
  const finished = items.filter(
    (item) => !['waiting', 'parsing'].includes(item.status),
  ).length;
  return (
    <Modal
      title={t('导入书籍')}
      onDismiss={() => {
        if (!busy) onClose();
      }}
    >
      <header class="panel-heading">
        <h2>{t('导入书籍')}</h2>
        <button
          disabled={busy}
          onClick={onClose}
          aria-label={t('关闭导入面板')}
        >
          {t('关闭')}
        </button>
      </header>
      <p class="muted">
        {t('选择本机的 EPUB、TXT、Markdown、PDF 或 ZIP，也可粘贴长文。')}
      </p>
      {isIosApp && (
        <p class="muted">
          {t(
            'PDF 保留原页，支持翻页、缩放和进度续读；暂不支持原页划线、笔记、听书或文字识别。',
          )}
        </p>
      )}
      <p class="muted">
        {t(
          '带图片的文章：把一个 Markdown 文件和图片文件夹一起压缩，命名为 .md.zip 后导入。',
        )}
      </p>
      <input
        ref={input}
        class="file-input"
        type="file"
        multiple
        accept=".epub,.txt,.md,.markdown,.zip,.pdf,application/pdf,text/plain,text/markdown,text/x-markdown,application/epub+zip,application/zip"
        aria-label={t('选择书籍文件')}
        disabled={busy}
        onChange={(event) =>
          void select(Array.from(event.currentTarget.files ?? []))
        }
      />
      <div class="panel-actions">
        <button disabled={busy} onClick={() => void pick()}>
          {t('选择文件')}
        </button>
        <button
          disabled={busy}
          onClick={() => {
            onClose();
            navigate('#/paste');
          }}
        >
          {t('粘贴文本')}
        </button>
      </div>
      {pickerError && <p role="alert">{pickerError}</p>}
      {!!items.length && (
        <>
          {busy ? (
            <BookLoading
              title={t('正在导入书籍')}
              fileName={items.find((item) => item.status === 'parsing')?.name}
              detail={t(
                '正在解析 · 第 {0} / {1} 本',
                Math.min(finished + 1, items.length),
                items.length,
              )}
            />
          ) : (
            <p role="status" aria-live="polite">
              {t(
                '导入完成：{0} 本成功，{1} 本已在书架，{2} 本失败',
                items.filter((i) => i.status === 'success').length,
                items.filter((i) => i.status === 'duplicate').length,
                items.filter((i) => i.status === 'error').length,
              )}
            </p>
          )}
          <ul class="import-results import-list">
            {items.map((item, index) => {
              const body = (
                <>
                  <span class="import-mark" aria-hidden="true">
                    {marks[item.status]}
                  </span>
                  <span class="import-name">{item.name}</span>
                  <small>{t(labels[item.status])}</small>
                </>
              );
              return (
                <li key={index} data-status={item.status}>
                  {item.book && !busy ? (
                    <button
                      class="import-row"
                      aria-label={t('阅读《{0}》', item.book.title)}
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
