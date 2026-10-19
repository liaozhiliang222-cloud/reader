import { t } from '@/i18n';
import { useState } from 'preact/hooks';
import { chapterAtPercent } from '@/reader/position';
import type { ChapterSummary } from '@/types';

export function ProgressControl({
  chapters,
  total,
  percent,
  onCommit,
}: {
  chapters: ChapterSummary[];
  total: number;
  percent: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number>();
  const value = draft ?? percent;
  const title =
    chapterAtPercent(chapters, total, value)?.chapter.title ??
    t('正在读取章节');
  const commit = (value: number) => {
    setDraft(undefined);
    onCommit(value);
  };
  return (
    <div class="progress-control">
      <label for="reader-progress">
        {t('阅读进度 ·')} {value.toFixed(1)}% · {title}
      </label>
      <input
        id="reader-progress"
        type="range"
        min="0"
        max="100"
        step="0.1"
        value={value}
        disabled={!chapters.length}
        aria-valuetext={`${value.toFixed(1)}%，${title}`}
        onInput={(event) => setDraft(Number(event.currentTarget.value))}
        onChange={(event) => commit(Number(event.currentTarget.value))}
        onBlur={(event) => {
          if (draft !== undefined) commit(Number(event.currentTarget.value));
        }}
      />
    </div>
  );
}
