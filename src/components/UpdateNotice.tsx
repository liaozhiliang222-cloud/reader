import { applyPwaUpdate, pwaState } from '@/app/pwa';

export function UpdateNotice() {
  const value = pwaState.value;
  if (!value.available && !value.error) return null;
  return (
    <aside class="update-notice" aria-label="应用更新">
      {value.available && (
        <>
          <p role="status">有新版本，更新后继续安静阅读。</p>
          <button disabled={value.applying} onClick={applyPwaUpdate}>
            {value.applying ? '正在更新…' : '点击更新'}
          </button>
        </>
      )}
      {value.error && <p role="status">{value.error}</p>}
    </aside>
  );
}
