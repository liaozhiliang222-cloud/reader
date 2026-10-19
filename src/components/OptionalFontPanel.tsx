import {
  fontState,
  optionalFontSize,
  downloadOptionalFont,
  removeOptionalFont,
} from '@/app/optionalFont';

export function OptionalFontPanel() {
  const state = fontState.value;
  const busy = state.phase === 'checking' || state.phase === 'downloading';
  return (
    <section aria-labelledby="optional-font-title">
      <h3 id="optional-font-title">可选阅读字体</h3>
      <p>
        微光阅读文楷是由霞鹜文楷 1.522 生成的网页子集，包含 GB2312
        常用汉字、拉丁字符和标点，未覆盖的文字使用系统字体。
      </p>
      <p>
        主动下载 {(optionalFontSize / 1024 / 1024).toFixed(2)} MB
        后保存在本机，可离线使用。不点击下载时不会请求字体。字体文件不包含在备份内，换设备后需重新下载。
      </p>
      {state.phase === 'ready' ? (
        <>
          <p role="status">文楷字体已保存在本机，可在排版设置中选择。</p>
          <button disabled={busy} onClick={() => void removeOptionalFont()}>
            删除本机字体
          </button>
        </>
      ) : (
        <button
          disabled={busy || state.phase === 'unavailable'}
          onClick={() => void downloadOptionalFont()}
        >
          {state.phase === 'downloading'
            ? '正在下载字体…'
            : `下载文楷字体（${(optionalFontSize / 1024 / 1024).toFixed(2)} MB）`}
        </button>
      )}
      {state.phase === 'unavailable' && (
        <p>当前浏览器无法保存网页字体，请继续使用系统字体。</p>
      )}
      {state.error && <p role="alert">{state.error}</p>}
      <p>
        <a
          class="resource-link"
          href={`${import.meta.env.BASE_URL}fonts/OFL.txt`}
          target="_blank"
          rel="noopener"
        >
          查看字体许可（OFL 1.1）
        </a>
      </p>
    </section>
  );
}
