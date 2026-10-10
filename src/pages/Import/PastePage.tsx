import { useEffect, useState } from 'preact/hooks';
import { getBook, getDraft, countAnnotations } from '@/db/repository';
import { importDraft } from '@/parsers/importDraft';
import { navigate } from '@/app/router';
import { Modal } from '@/components/Modal';
import { incomingStore, incomingChanged } from '@/app/incoming';
import type { DraftFormat } from '@/parsers/markdown';

export function PastePage({
  bookId,
  incomingId,
}: {
  bookId?: string;
  incomingId?: string;
}) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [original, setOriginal] = useState('');
  const [format, setFormat] = useState<DraftFormat>('plain');
  const [originalFormat, setOriginalFormat] = useState<DraftFormat>('plain');
  const [loading, setLoading] = useState(!!bookId || !!incomingId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [duplicate, setDuplicate] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const [counts, setCounts] = useState({ bookmarks: 0, highlights: 0 });
  useEffect(() => {
    let cancelled = false;
    if (incomingId) {
      void incomingStore()
        .get(incomingId)
        .then((data) => {
          if (!cancelled) {
            setText(data.text);
            setTitle(data.title);
            setHint('已收到分享文字，请检查正文。链接只作为文字保留。');
          }
        })
        .catch((cause) => {
          if (!cancelled)
            setError(
              cause instanceof Error ? cause.message : '无法读取分享文字。',
            );
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    if (bookId)
      void (async () => {
        const book = await getBook(bookId);
        if (!book || book.type !== 'paste')
          throw new Error('这本文稿已不存在。');
        const [source, annotations] = await Promise.all([
          getDraft(book),
          countAnnotations(bookId),
        ]);
        if (!cancelled) {
          setText(source);
          setOriginal(source);
          setFormat(book.draftFormat ?? 'plain');
          setOriginalFormat(book.draftFormat ?? 'plain');
          setTitle(book.title);
          setCounts(annotations);
        }
      })()
        .catch((cause) => {
          if (!cancelled)
            setError(cause instanceof Error ? cause.message : '无法读取文稿。');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    return () => {
      cancelled = true;
    };
  }, [bookId, incomingId]);
  const readClipboard = async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error('unsupported');
      const value = await navigator.clipboard.readText();
      if (value) {
        setText(value);
        setHint('已读取剪贴板，请检查正文。');
      } else setHint('剪贴板为空，请在正文框中长按粘贴。');
    } catch {
      setHint('无法读取剪贴板，请在正文框中长按粘贴，或按 Ctrl / ⌘ + V。');
    }
  };
  const save = async () => {
    if (busy || loading) return;
    setBusy(true);
    setError('');
    setDuplicate(undefined);
    try {
      const result = await importDraft(text, title, bookId, format);
      if (incomingId) {
        try {
          const store = incomingStore(),
            data = await store.get(incomingId);
          if (data.files.length || data.errors.length)
            await store.put(incomingId, { ...data, text: '', title: '' });
          else await store.remove(incomingId);
          incomingChanged();
        } catch {
          setHint('文稿已保存，分享暂存未能清理，可在书架继续处理。');
        }
      }
      if (result.duplicate) {
        setDuplicate(result.book.id);
        setHint('相同正文的文稿已在书架，原有阅读进度已保留。');
      } else navigate('#/read/' + encodeURIComponent(result.book.id));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '文稿保存失败，请重试。',
      );
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  const submit = () => {
    if (
      bookId &&
      (text !== original || format !== originalFormat) &&
      (counts.bookmarks || counts.highlights)
    )
      setConfirm(true);
    else void save();
  };
  return (
    <main class="paste-page">
      <header class="panel-heading">
        <button disabled={busy} onClick={() => navigate('#/')}>
          返回书架
        </button>
        <h1>{bookId ? '编辑文稿' : '粘贴长文'}</h1>
      </header>
      {loading ? (
        <p role="status">正在读取文稿…</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label>
            标题（选填）
            <input
              value={title}
              maxLength={200}
              onInput={(event) => setTitle(event.currentTarget.value)}
              disabled={busy}
              placeholder="留空时使用正文第一行"
            />
          </label>
          <fieldset class="draft-format" disabled={busy}>
            <legend>正文格式</legend>
            <div class="draft-format-options">
              <label>
                <input
                  type="radio"
                  name="draft-format"
                  value="plain"
                  checked={format === 'plain'}
                  onChange={() => setFormat('plain')}
                />
                纯文本
              </label>
              <label>
                <input
                  type="radio"
                  name="draft-format"
                  value="markdown"
                  checked={format === 'markdown'}
                  onChange={() => setFormat('markdown')}
                />
                Markdown
              </label>
            </div>
          </fieldset>
          <div class="panel-heading">
            <label for="draft-text">正文</label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void readClipboard()}
            >
              从剪贴板读取
            </button>
          </div>
          <textarea
            id="draft-text"
            value={text}
            onInput={(event) => {
              setText(event.currentTarget.value);
              setDuplicate(undefined);
              setHint('');
            }}
            disabled={busy}
            required
            placeholder="在这里粘贴正文。使用 # 标题可划分章节。"
            spellcheck={false}
          />
          <p class="muted">
            原文只保存在本机。
            {format === 'markdown'
              ? '支持标题、列表、表格和代码；图片显示说明，公式保留源码。'
              : ''}
            {bookId
              ? '修改正文后会从文稿开头重新阅读。'
              : '留空标题自动取首行，# 标题转为章节。'}
          </p>
          <button
            class="primary-action"
            disabled={busy || !text.trim()}
            type="submit"
          >
            {busy ? '正在保存…' : bookId ? '保存并阅读' : '开始阅读'}
          </button>
        </form>
      )}
      {hint && <p role="status">{hint}</p>}
      {duplicate && (
        <button
          onClick={() => navigate('#/read/' + encodeURIComponent(duplicate))}
        >
          继续阅读已有文稿
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {confirm && (
        <Modal
          title="确认修改文稿"
          onDismiss={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <h2>修改正文</h2>
          <p>
            正文位置会变化，保存后将重置阅读进度，并移除这本文稿的{' '}
            {counts.bookmarks} 个书签和 {counts.highlights}{' '}
            条划线笔记。取消可保留原文稿及标注。
          </p>
          <div class="panel-actions">
            <button disabled={busy} onClick={() => setConfirm(false)}>
              取消
            </button>
            <button disabled={busy} onClick={() => void save()}>
              确认保存
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
