import { t } from '@/i18n';
export function BookLoading({
  title,
  detail = t('文字只在本机处理。'),
  fileName,
}: {
  title: string;
  detail?: string;
  fileName?: string;
}) {
  return (
    <div class="book-loading" role="status" aria-live="polite">
      <svg class="book-loading-symbol" viewBox="0 0 80 64" aria-hidden="true">
        <path d="M40 16C30 9 18 9 8 13v36c10-4 22-4 32 3 10-7 22-7 32-3V13c-10-4-22-4-32 3Zm0 0v36" />
        <path
          class="book-loading-lines"
          d="M15 23c6-2 12-1 18 2m-18 8c6-2 12-1 18 2m14-10c6-3 12-4 18-2m-18 12c6-3 12-4 18-2"
        />
        <path
          class="book-loading-leaf"
          d="M40 16c10-7 22-7 32-3v36c-10-4-22-4-32 3Z"
        />
      </svg>
      <p class="book-loading-title">{title}</p>
      {fileName && (
        <p class="book-loading-file" title={fileName}>
          {fileName}
        </p>
      )}
      <p class="book-loading-detail">{detail}</p>
      <span class="book-loading-ink" aria-hidden="true" />
    </div>
  );
}
