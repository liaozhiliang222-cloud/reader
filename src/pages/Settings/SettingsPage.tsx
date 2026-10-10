import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { settings } from '@/app/settings';
import { saveSettings } from '@/db/settings';
import { ReadingControls } from '@/components/ReadingControls';
import { navigate } from '@/app/router';
import type { AppSettings, ReadingSettings } from '@/types';
import { requestPersistence, storageInfo } from '@/app/storage';
import { dataCounts, clearAllData } from '@/db/data';
import { initialSettings } from '@/app/settings';
import { Modal } from '@/components/Modal';
import { BackupPanel } from './BackupPanel';
import { checkPwaUpdate, pwaState } from '@/app/pwa';
import { Onboarding } from '@/pages/Onboarding/Onboarding';
import { EnvironmentNotice } from '@/components/EnvironmentNotice';
import { OptionalFontPanel } from '@/components/OptionalFontPanel';
import { useBackClose } from '@/app/useBackClose';

export function SettingsPage({
  initialSection,
}: { initialSection?: 'backup'; children?: ComponentChildren } = {}) {
  const backupSection = useRef<HTMLElement>(null);
  useEffect(() => {
    if (initialSection === 'backup') {
      backupSection.current?.focus({ preventScroll: true });
      backupSection.current?.scrollIntoView({ block: 'start' });
    }
  }, [initialSection]);
  const [message, setMessage] = useState('');
  const [storage, setStorage] = useState('正在读取存储信息…');
  const [persisted, setPersisted] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState(false);
  useBackClose(guide, () => setGuide(false));
  const [clearDialog, setClearDialog] = useState(false),
    [confirmText, setConfirmText] = useState('');
  const [counts, setCounts] = useState({
    books: 0,
    bookmarks: 0,
    highlights: 0,
  });
  const [resetKey, setResetKey] = useState(0);
  const refreshStorage = () =>
    void storageInfo()
      .then(({ usage, quota, persisted }) => {
        setPersisted(persisted);
        setStorage(
          `${usage === undefined ? '用量不可用' : `已用 ${(usage / 1024 / 1024).toFixed(1)} MB`}${quota === undefined ? '' : ` / 可用配额 ${(quota / 1024 / 1024).toFixed(1)} MB`} · ${persisted === undefined ? '持久化状态不可用' : persisted ? '已持久化' : '未持久化'}`,
        );
      })
      .catch(() => setStorage('当前浏览器无法提供存储信息'));
  useEffect(() => {
    refreshStorage();
  }, [resetKey]);
  const save = async (
    patch: Partial<Omit<AppSettings, 'reading'>> & {
      reading?: Partial<ReadingSettings>;
    },
  ) => {
    try {
      settings.value = await saveSettings(patch);
      setMessage('设置已保存');
    } catch {
      setMessage('无法保存设置，请检查本地存储。');
    }
  };
  return (
    <main class="settings-page">
      <header>
        <button disabled={busy} onClick={() => navigate('#/')}>
          返回书架
        </button>
        <h1>设置</h1>
      </header>
      <EnvironmentNotice />
      {guide && (
        <Modal
          title="静页使用引导"
          className="guide-modal"
          onDismiss={() => setGuide(false)}
        >
          <Onboarding onDone={() => setGuide(false)} />
        </Modal>
      )}
      <div class="settings-group">
        <h2>阅读</h2>
        <section>
          <h3>默认排版</h3>
          <p>新书使用这些设置。已有单本排版的书籍保留自己的设置。</p>
          <fieldset disabled={busy} class="settings-fields">
            <ReadingControls
              value={settings.value.reading}
              onChange={(reading) => void save({ reading })}
              followSystemTheme={settings.value.followSystemTheme}
            />
            <label class="check-row">
              <input
                type="checkbox"
                checked={settings.value.followSystemTheme}
                onChange={(event) =>
                  void save({ followSystemTheme: event.currentTarget.checked })
                }
              />
              跟随系统深色
            </label>
          </fieldset>
        </section>
        <section>
          <h3>阅读习惯</h3>
          <label class="check-row">
            <input
              disabled={busy}
              type="checkbox"
              checked={settings.value.autoResume}
              onChange={(e) =>
                void save({ autoResume: e.currentTarget.checked })
              }
            />
            启动时继续上次阅读
          </label>
          <label class="check-row">
            <input
              disabled={busy}
              type="checkbox"
              checked={settings.value.reading.quietHint}
              onChange={(e) =>
                void save({ reading: { quietHint: e.currentTarget.checked } })
              }
            />
            进入阅读时显示安静提示
          </label>
        </section>
        <OptionalFontPanel />
      </div>
      <div class="settings-group">
        <h2>数据</h2>
        <section>
          <h3>本地存储</h3>
          <p>{storage}</p>
          {persisted !== true && (
            <button
              disabled={busy}
              onClick={() =>
                void requestPersistence().then((granted) => {
                  setMessage(
                    granted === undefined
                      ? '当前浏览器无法申请持久化存储。'
                      : granted
                        ? '持久化申请已批准。'
                        : '浏览器未批准持久化，请定期保存备份。',
                  );
                  refreshStorage();
                })
              }
            >
              申请持久化存储
            </button>
          )}
          <p>
            书籍和进度仅存于本机，清除浏览器数据会删除它们。持久化也不能替代备份。
          </p>
        </section>
        <section ref={backupSection} tabIndex={-1} aria-label="备份与恢复">
          <BackupPanel
            key={resetKey}
            onBusy={(working) => {
              setBusy(working);
              if (!working) refreshStorage();
            }}
          />
        </section>
        <section>
          <h3>清空数据</h3>
          <p>删除这台浏览器中的书架、原文、进度、书签、划线笔记和设置。</p>
          <button
            disabled={busy}
            onClick={() =>
              void dataCounts()
                .then((value) => {
                  setCounts(value);
                  setConfirmText('');
                  setClearDialog(true);
                })
                .catch(() => setMessage('无法读取本机数据。'))
            }
          >
            清空所有数据
          </button>
        </section>
      </div>
      <div class="settings-group">
        <h2>应用</h2>
        <section>
          <h3>离线与更新</h3>
          <p>
            {import.meta.env.DEV
              ? '开发预览不启用离线缓存。安装与离线功能请使用正式构建。'
              : pwaState.value.offlineReady
                ? '应用资源已就绪，可离线打开。'
                : '正在准备离线资源，请保持联网。'}
          </p>
          <label class="check-row">
            <input
              disabled={busy}
              type="checkbox"
              checked={settings.value.checkUpdates}
              onChange={(e) =>
                void save({ checkUpdates: e.currentTarget.checked })
              }
            />
            自动检查应用更新
          </label>
          <p>
            发现新版本后只在书架提示，点击更新才重新打开。关闭后静页不主动定时检查，浏览器仍可能检查应用资源。
          </p>
          <button
            disabled={busy || pwaState.value.checking || import.meta.env.DEV}
            onClick={() => void checkPwaUpdate()}
          >
            {pwaState.value.checking ? '正在检查…' : '检查更新'}
          </button>
          {pwaState.value.error && <p role="status">{pwaState.value.error}</p>}
          {pwaState.value.available && <p>新版本已下载，返回书架即可更新。</p>}
        </section>
        <section>
          <h3>使用引导</h3>
          <button
            disabled={busy}
            onClick={(event) => {
              // WebKit pointer clicks do not always focus buttons; native dialog
              // close must still have the invoking control to return focus to.
              event.currentTarget.focus();
              setGuide(true);
            }}
          >
            查看使用引导与安装方法
          </button>
        </section>
        <section>
          <h3>关于</h3>
          <button onClick={() => navigate('#/about')}>关于静页与隐私</button>
        </section>
      </div>
      {clearDialog && (
        <Modal
          title="确认清空全部本地数据"
          onDismiss={() => {
            if (!busy) setClearDialog(false);
          }}
        >
          <h2>清空本地数据</h2>
          <p>
            将删除 {counts.books} 本书、{counts.bookmarks} 个书签、
            {counts.highlights}{' '}
            条划线笔记及全部设置。请先确认备份已保存在浏览器之外。
          </p>
          <label class="clear-confirm">
            请输入“清空”确认
            <input
              value={confirmText}
              disabled={busy}
              autoComplete="off"
              onInput={(event) => setConfirmText(event.currentTarget.value)}
            />
          </label>
          <div class="data-actions">
            <button disabled={busy} onClick={() => setClearDialog(false)}>
              取消
            </button>
            <button
              disabled={busy || confirmText !== '清空'}
              onClick={() => {
                if (confirmText !== '清空' || busy) return;
                setBusy(true);
                void clearAllData()
                  .then(() => {
                    settings.value = initialSettings();
                    setClearDialog(false);
                    setResetKey((key) => key + 1);
                    setMessage('本地数据已清空。');
                  })
                  .catch(() => setMessage('清空失败，本地数据未被部分删除。'))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? '清空中…' : '确认清空'}
            </button>
          </div>
        </Modal>
      )}
      <p role="status">{message}</p>
    </main>
  );
}
