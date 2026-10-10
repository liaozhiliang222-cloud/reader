import { useState } from 'preact/hooks';
import { navigate } from '@/app/router';
import { copyText } from '@/app/files';
import { isNativeApp } from '@/app/platform';
const version = import.meta.env.VITE_APP_VERSION;

export function AboutPage() {
  const [message, setMessage] = useState('');
  const feedback = `静页 ${version}\n问题描述：\n\n复现步骤：\n1. \n2. \n\n期望结果：\n实际结果：\n`;
  const repository = 'https://github.com/liaozhiliang222-cloud/reader';
  return (
    <main class="settings-page">
      <header>
        <button onClick={() => navigate('#/settings')}>返回设置</button>
        <h1>关于静页</h1>
      </header>
      <section>
        <h2>留一点时间，给阅读。</h2>
        <p>版本 {version}</p>
        <p>
          静页是一款本地阅读器：无注册、无推荐、无
          AI、无追踪。导入自己的书籍，安静读完一页。
        </p>
      </section>
      <section aria-labelledby="privacy-title">
        <h2 id="privacy-title">隐私与本地数据</h2>
        <p>
          我们不收集任何阅读数据。书籍原文、阅读进度、书签、划线、笔记和设置只保存在
          {isNativeApp ? '应用私有存储' : '当前浏览器的本地存储'}
          中，不上传服务器。
        </p>
        <p>
          {isNativeApp
            ? '应用未申请联网权限，资源与可选字体均内置在安装包中；不参与系统云备份或自动换机传输。'
            : '应用没有统计 SDK、广告、第三方 CDN 或在线字体服务。网络请求用于加载和更新应用资源，以及你主动下载的同源阅读字体；不下载字体时不会请求字体文件。'}
        </p>
        <p>
          {isNativeApp
            ? '安装后即可离线阅读。'
            : '首次离线资源准备完成后可以断网阅读。'}
          备份由你主动导出到文件，恢复也只在本机处理；系统分享或复制后的保存位置由你选择。
        </p>
        <p>
          {isNativeApp
            ? '卸载应用会删除本机书籍与笔记。请把备份保存在应用之外；'
            : '清除浏览器数据或系统回收存储可能删除本机书籍与笔记。请把备份保存在浏览器之外；'}
          可在“设置 →
          备份与恢复”导出，或使用“清空所有数据”删除本机用户数据。可选字体缓存可在字体设置中单独删除。
        </p>
      </section>
      <section>
        <h2>许可与致谢</h2>
        <p>
          感谢 Preact、Preact Signals、Dexie、Comlink、JSZip、pako、xmldom
          及其依赖的作者。第三方组件保留各自的版权与许可。
        </p>
        <p>
          <a
            class="resource-link"
            href={`${import.meta.env.BASE_URL}licenses.txt`}
            target="_blank"
            rel="noopener"
          >
            查看完整第三方许可
          </a>
        </p>
        <p>
          可选的静页文楷网页子集源自霞鹜文楷 1.522 与 Klee One，使用 OFL 1.1
          许可。未覆盖的字符由系统字体显示。
        </p>
        <p>
          <a
            class="resource-link"
            href={`${import.meta.env.BASE_URL}fonts/OFL.txt`}
            target="_blank"
            rel="noopener"
          >
            查看字体版权与许可
          </a>
        </p>
        <p>
          <a
            class="resource-link"
            href={repository}
            target="_blank"
            rel="noopener noreferrer"
          >
            查看项目源码
          </a>
        </p>
        <p>项目许可证尚未确定；第三方组件与字体沿用各自许可。</p>
      </section>
      <section>
        <h2>反馈</h2>
        <p>
          可以复制下方的问题说明，补充复现步骤后发给开发者。说明只包含应用版本与空白问题模板，不包含书籍、笔记或设备信息。
        </p>
        <button
          onClick={() =>
            void copyText(feedback)
              .then(() => setMessage('反馈模板已复制，请补充后自行发送。'))
              .catch(() =>
                setMessage('当前浏览器不允许复制，可以手动选择下方模板。'),
              )
          }
        >
          复制反馈模板
        </button>
        <p>
          <a
            class="resource-link"
            href={`${repository}/issues/new?title=${encodeURIComponent(`静页 ${version} 问题反馈`)}&body=${encodeURIComponent(feedback)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            在 GitHub 反馈
          </a>
        </p>
        <p>
          <a
            class="resource-link"
            href={`mailto:liaozhiliang222@gmail.com?subject=${encodeURIComponent(`静页 ${version} 问题反馈`)}&body=${encodeURIComponent(feedback)}`}
          >
            邮件反馈：liaozhiliang222@gmail.com
          </a>
        </p>
        <pre class="feedback-template">{feedback}</pre>
        {message && <p role="status">{message}</p>}
      </section>
    </main>
  );
}
