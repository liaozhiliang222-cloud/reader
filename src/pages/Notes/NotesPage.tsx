import { t, uiLocale } from '@/i18n';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { db } from '@/db';
import type { Book, Highlight } from '@/types';
import { navigate } from '@/app/router';
import {
  reviewNotes,
  reviewMarkdown,
  type ReviewNote,
} from '@/reader/notesReview';
import { quoteCards } from '@/reader/quoteCards';
import { downloadBlob, shareBlob } from '@/app/files';
import { isNativeApp } from '@/app/platform';
import { canUsePro } from '@/app/pro';
import { ProPanel } from '@/components/ProPanel';
import { Modal } from '@/components/Modal';

export function NotesPage() {
  const [books, setBooks] = useState<Book[]>([]),
    [notes, setNotes] = useState<Highlight[]>([]);
  const [book, setBook] = useState(''),
    [tag, setTag] = useState(''),
    [query, setQuery] = useState('');
  const [pending, setPending] = useState(false),
    [order, setOrder] = useState<'recent' | 'oldest'>('recent');
  const [page, setPage] = useState(0),
    [pro, setPro] = useState(false),
    [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''),
    [editing, setEditing] = useState<ReviewNote>();
  const [note, setNote] = useState(''),
    [tags, setTags] = useState(''),
    [review, setReview] = useState(false);
  const load = async () => {
    const [b, h] = await Promise.all([
      db.books.toArray(),
      db.highlights.toArray(),
    ]);
    setBooks(b);
    setNotes(h);
  };
  useEffect(() => {
    void load().catch(() => setMessage(t('无法读取本机笔记。')));
  }, []);
  const rows = useMemo(
    () => reviewNotes(books, notes, { book, tag, query, pending, order }),
    [books, notes, book, tag, query, pending, order, uiLocale.value],
  );
  const allRows = reviewNotes(books, notes);
  const allTags = [...new Set(notes.flatMap((item) => item.tags ?? []))].sort();
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : t('操作未完成。'));
    } finally {
      setBusy(false);
    }
  };
  const exportRows = (items: ReviewNote[], template: 'quotes' | 'reading') =>
    action(() =>
      downloadBlob(
        new Blob([reviewMarkdown(items, template)], {
          type: 'text/markdown;charset=utf-8',
        }),
        template === 'reading'
          ? t('微光阅读_回顾笔记.md')
          : t('微光阅读_摘录.md'),
      ),
    );
  const premium = (work: () => void) => {
    if (canUsePro()) work();
    else setPro(true);
  };
  const edit = (row: ReviewNote) => {
    setEditing(row);
    setNote(row.item.note ?? '');
    setTags(
      row.item.tags?.join(uiLocale.value === 'en-US' ? ', ' : '、') ?? '',
    );
    setReview(row.item.reviewPending ?? false);
  };
  return (
    <main class="settings-page notes-page">
      <header>
        <button onClick={() => navigate('#/')}>{t('返回书架')}</button>
        <h1>{t('笔记回顾')}</h1>
      </header>
      <p>{t('书籍、摘录和想法只在本机。已有内容始终可查看与导出。')}</p>
      <details class="notes-filters-panel">
        <summary>{t('筛选与排序')}</summary>
        <div class="notes-filters">
          <label>
            {t('书籍')}
            <select
              value={book}
              onChange={(e) => {
                setBook(e.currentTarget.value);
                setPage(0);
              }}
            >
              <option value="">{t('全部书籍')}</option>
              {[
                ...new Map(
                  allRows.map((row) => [row.item.bookId, row.title]),
                ).entries(),
              ].map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('标签')}
            <select
              value={tag}
              onChange={(e) => {
                setTag(e.currentTarget.value);
                setPage(0);
              }}
            >
              <option value="">{t('全部标签')}</option>
              {allTags.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            {t('检索摘录与想法')}
            <input
              value={query}
              onInput={(e) => {
                setQuery(e.currentTarget.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            {t('时间')}
            <select
              value={order}
              onChange={(e) => {
                setOrder(e.currentTarget.value as 'recent' | 'oldest');
                setPage(0);
              }}
            >
              <option value="recent">{t('最新在前')}</option>
              <option value="oldest">{t('最早在前')}</option>
            </select>
          </label>
          <label class="check-row">
            <input
              type="checkbox"
              checked={pending}
              onChange={(e) => {
                setPending(e.currentTarget.checked);
                setPage(0);
              }}
            />
            {t('只看待回顾')}
          </label>
        </div>
      </details>
      <div class="panel-actions">
        <button
          disabled={busy || !rows.length}
          onClick={() => premium(() => void exportRows(rows, 'quotes'))}
        >
          {t('批量导出 Markdown')}
        </button>
        <button
          disabled={busy || !rows.length}
          onClick={() => premium(() => void exportRows(rows, 'reading'))}
        >
          {t('导出读后整理模板')}
        </button>
        <button
          disabled={!rows.length}
          onClick={() =>
            premium(() => edit(rows[Math.floor(Math.random() * rows.length)]!))
          }
        >
          {t('随机回顾一条')}
        </button>
      </div>
      <p role="status">
        {t('共 {0} 条笔记', rows.length)}
        {message ? ` · ${message}` : ''}
      </p>
      <ol class="notes-list">
        {rows.slice(page * 40, (page + 1) * 40).map((row) => (
          <li key={row.item.id}>
            <h2>{row.title}</h2>
            <small>
              {row.chapterTitle} ·{' '}
              {new Date(row.item.createdAt).toLocaleDateString(uiLocale.value)}
            </small>
            <blockquote>{row.item.text}</blockquote>
            {row.item.note && <p class="note-thought">{row.item.note}</p>}
            {!!row.item.tags?.length && <p>{row.item.tags.join(' · ')}</p>}
            {!row.available && (
              <p>{t('原书缺失或位置待确认；摘录副本仍可导出。')}</p>
            )}
            <div class="panel-actions">
              <button
                disabled={!row.available}
                onClick={() =>
                  navigate(
                    `#/read/${encodeURIComponent(row.item.bookId)}?note=${encodeURIComponent(row.item.id)}`,
                  )
                }
              >
                {t('回到原文')}
              </button>
              <button onClick={() => edit(row)}>{t('编辑想法')}</button>
              <button
                disabled={busy}
                onClick={() => void exportRows([row], 'quotes')}
              >
                {t('导出此条')}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  premium(
                    () =>
                      void action(async () => {
                        const images = await quoteCards(row);
                        for (const [index, image] of images.entries()) {
                          const name = t('微光阅读_摘录_{0}.png', index + 1);
                          const file = new File([image], name, {
                            type: image.type,
                          });
                          if (
                            !isNativeApp &&
                            (!navigator.share ||
                              !navigator.canShare?.({ files: [file] }))
                          )
                            await downloadBlob(image, name);
                          else await shareBlob(image, name);
                        }
                      }),
                  )
                }
              >
                {t('摘录图片')}
              </button>
            </div>
          </li>
        ))}
      </ol>
      {rows.length > 40 && (
        <div class="panel-actions">
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            {t('上一组')}
          </button>
          <span>
            {page + 1} / {Math.ceil(rows.length / 40)}
          </span>
          <button
            disabled={(page + 1) * 40 >= rows.length}
            onClick={() => setPage(page + 1)}
          >
            {t('下一组')}
          </button>
        </div>
      )}
      {editing && (
        <Modal
          title={t('编辑想法')}
          onDismiss={() => {
            if (!busy) setEditing(undefined);
          }}
        >
          <h2>{editing.title}</h2>
          <blockquote>{editing.item.text}</blockquote>
          <label class="rename-label">
            {t('想法')}
            <textarea
              value={note}
              onInput={(e) => setNote(e.currentTarget.value)}
            />
          </label>
          <label class="rename-label">
            {t('标签（顿号分隔）')}
            <input
              value={tags}
              maxLength={300}
              onInput={(e) => setTags(e.currentTarget.value)}
              disabled={!canUsePro()}
            />
          </label>
          <label class="check-row">
            <input
              type="checkbox"
              checked={review}
              disabled={!canUsePro()}
              onChange={(e) => setReview(e.currentTarget.checked)}
            />
            {t('待回顾')}
          </label>
          <div class="panel-actions">
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const item = await db.highlights.get(editing.item.id);
                  if (!item) throw new Error(t('此笔记已不存在。'));
                  const values = [
                    ...new Set(
                      tags
                        .split(/[、,，]/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    ),
                  ];
                  if (values.length > 12 || values.some((s) => s.length > 30))
                    throw new Error(t('最多 12 个标签，每个不超过 30 字。'));
                  await db.highlights.update(item.id, {
                    note: note.trim() || undefined,
                    ...(canUsePro()
                      ? { tags: values, reviewPending: review }
                      : {}),
                    updatedAt: Date.now(),
                  });
                  await load();
                  setEditing(undefined);
                })
              }
            >
              {t('保存想法')}
            </button>
            <button disabled={busy} onClick={() => setEditing(undefined)}>
              {t('关闭')}
            </button>
          </div>
        </Modal>
      )}
      {pro && <ProPanel onClose={() => setPro(false)} />}
    </main>
  );
}
