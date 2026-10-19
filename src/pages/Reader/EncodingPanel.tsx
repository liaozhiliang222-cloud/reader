import { t, uiLocale } from '@/i18n';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Modal } from '@/components/Modal';
import { applyEncoding } from '@/db/recode';
import { resetSpeechData } from '@/app/speech/coordinator';
import { isNativeApp } from '@/app/platform';
import {
  previewEncoding,
  TEXT_ENCODINGS,
  isTextEncoding,
  type TextEncoding,
  type ReparsedText,
} from '@/parsers/recodeText';
import type { Book } from '@/types';

function excerpt(parsed: ReparsedText) {
  let text = '';
  for (const paragraph of parsed.chapters[0]?.paragraphs ?? []) {
    text += (text ? '\n' : '') + paragraph.slice(0, 1000 - text.length);
    if (text.length >= 1000) break;
  }
  return [...text].slice(0, 500).join('');
}

export function EncodingPanel({
  book,
  percent,
  onClose,
  onApplied,
}: {
  book: Book;
  percent: number;
  onClose: () => void;
  onApplied: (book: Book) => void;
}) {
  const [encoding, setEncoding] = useState<TextEncoding>(
    isTextEncoding(book.encoding ?? '')
      ? (book.encoding as TextEncoding)
      : 'utf-8',
  );
  const [parsed, setParsed] = useState<ReparsedText>();
  const [busy, setBusy] = useState<'preview' | 'apply'>();
  const [error, setError] = useState('');
  const controller = useRef<AbortController | undefined>(undefined);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
      controller.current?.abort();
    },
    [],
  );
  const close = () => {
    if (busyRef.current === 'apply') return;
    controller.current?.abort();
    onClose();
  };
  const preview = async () => {
    if (busyRef.current) return;
    const abort = new AbortController();
    controller.current = abort;
    busyRef.current = 'preview';
    setBusy('preview');
    setParsed(undefined);
    setError('');
    try {
      const result = await previewEncoding(book, encoding, abort.signal);
      if (live.current && !abort.signal.aborted) setParsed(result);
    } catch (cause) {
      if (live.current && !abort.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : t('预览失败，原书未修改。'),
        );
    } finally {
      busyRef.current = undefined;
      if (live.current) setBusy(undefined);
    }
  };
  const apply = async () => {
    if (!parsed || busyRef.current) return;
    busyRef.current = 'apply';
    setBusy('apply');
    setError('');
    try {
      if (isNativeApp) await resetSpeechData();
      const updated = await applyEncoding(book, parsed, percent);
      if (live.current) onApplied(updated);
    } catch (cause) {
      if (live.current)
        setError(
          cause instanceof Error ? cause.message : t('保存失败，原书未修改。'),
        );
    } finally {
      busyRef.current = undefined;
      if (live.current) setBusy(undefined);
    }
  };
  return (
    <Modal
      title={t('切换 TXT 编码')}
      onDismiss={close}
      className="encoding-panel"
    >
      <h2>{t('切换编码')}</h2>
      <p class="muted">
        {t('当前编码：')}
        {book.encoding ?? t('自动识别')}
        {t('。先检查预览，再确认替换正文。')}
      </p>
      <label>
        {t('原文件编码')}
        <select
          value={encoding}
          disabled={!!busy}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (isTextEncoding(value)) {
              setEncoding(value);
              setParsed(undefined);
              setError('');
            }
          }}
        >
          {TEXT_ENCODINGS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button disabled={!!busy} onClick={() => void preview()}>
        {busy === 'preview' ? t('正在重新解析…') : t('预览正文')}
      </button>
      {parsed && (
        <section aria-label={t('解码预览')} class="encoding-preview">
          <p>
            {parsed.chapters.length} {t('章 ·')}{' '}
            {parsed.charCount.toLocaleString(uiLocale.value)} {t('字')}
          </p>
          <h3>{parsed.chapters[0]?.title}</h3>
          <p>{excerpt(parsed)}</p>
        </section>
      )}
      <p class="muted">
        {t('将保留约')} {percent.toFixed(1)}
        {t(
          '% 的阅读进度与原文件。正文改变的章节中，书签、划线和笔记会保留为“位置待确认”，可查看、编辑和导出，不再跳转或标在正文上。',
        )}
      </p>
      {error && <p role="alert">{error}</p>}
      <div class="panel-actions">
        <button disabled={busy === 'apply'} onClick={close}>
          {t('取消')}
        </button>
        <button disabled={!parsed || !!busy} onClick={() => void apply()}>
          {busy === 'apply' ? t('正在保存…') : t('确认切换')}
        </button>
      </div>
    </Modal>
  );
}
