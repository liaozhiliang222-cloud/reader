import { t, uiLanguage, resetLanguagePreference } from '@/i18n';
import { LanguageSelector } from '@/components/LanguageSelector';
import { ProPanel } from '@/components/ProPanel';
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
import { isNativeApp, hasNativeSpeech, isIosApp } from '@/app/platform';
import { openSpeechSettings, resetSpeechData } from '@/app/speech/coordinator';

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
  const [pro, setPro] = useState(false);
  const [storage, setStorage] = useState(t('正在读取存储信息…'));
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
          `${usage === undefined ? t('用量不可用') : t('已用 {0} MB', (usage / 1024 / 1024).toFixed(1))}${quota === undefined ? '' : t(' / 可用配额 {0} MB', (quota / 1024 / 1024).toFixed(1))} · ${isNativeApp ? t('应用私有存储') : persisted === undefined ? t('持久化状态不可用') : persisted ? t('已持久化') : t('未持久化')}`,
        );
      })
      .catch(() => setStorage(t('当前浏览器无法提供存储信息')));
  useEffect(() => {
    refreshStorage();
  }, [resetKey, uiLanguage.value]);
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
          {t('返回书架')}
        </button>
        <h1>{t('设置')}</h1>
      </header>
      <EnvironmentNotice />
      <section>
        <h2>{t('界面语言')}</h2>
        <LanguageSelector disabled={busy} />
        <p>{t('语言只影响界面和导出说明，不会翻译或修改书籍与笔记。')}</p>
      </section>
      {isIosApp && (
        <section>
          <h2>{t('微光阅读 Pro')}</h2>
          <button onClick={() => setPro(true)}>{t('购买与恢复购买')}</button>
        </section>
      )}
      {pro && <ProPanel onClose={() => setPro(false)} />}
      {hasNativeSpeech && (
        <section class="settings-group">
          <h2>{t('听书')}</h2>
          <p>
            {isIosApp
              ? t(
                  '请在系统设置中下载声音，关闭网络试读，确认所选声音可离线使用。',
                )
              : t(
                  '只使用系统中已安装的离线语音。系统语音引擎是独立应用，正文由它处理；它可能拥有联网权限。',
                )}
          </p>
          <label class="speech-field">
            {t('默认语速')}
            <input
              type="number"
              min="0.75"
              max="2"
              step="0.05"
              value={settings.value.speech?.rate ?? 1}
              onChange={(e) => {
                const rate = Number(e.currentTarget.value);
                if (
                  rate >= 0.75 &&
                  rate <= 2 &&
                  Math.abs(rate * 20 - Math.round(rate * 20)) < 0.000001
                )
                  void save({
                    speech: {
                      rate,
                      timer: settings.value.speech?.timer ?? 'off',
                    },
                  });
              }}
            />
          </label>
          <button
            onClick={() =>
              void openSpeechSettings().catch(() =>
                setMessage('请手动打开系统中的文字转语音设置。'),
              )
            }
          >
            {t('系统语音设置')}
          </button>
        </section>
      )}
      {guide && (
        <Modal
          title={t('微光阅读使用引导')}
          className="guide-modal"
          onDismiss={() => setGuide(false)}
        >
          <Onboarding onDone={() => setGuide(false)} />
        </Modal>
      )}
      <div class="settings-group">
        <h2>{t('阅读')}</h2>
        <section>
          <h3>{t('默认排版')}</h3>
          <p>{t('新书使用这些设置。已有单本排版的书籍保留自己的设置。')}</p>
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
              {t('跟随系统深色')}
            </label>
          </fieldset>
        </section>
        <section>
          <h3>{t('阅读习惯')}</h3>
          <label class="check-row">
            <input
              disabled={busy}
              type="checkbox"
              checked={settings.value.autoResume}
              onChange={(e) =>
                void save({ autoResume: e.currentTarget.checked })
              }
            />
            {t('启动时继续上次阅读')}
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
            {t('进入阅读时显示安静提示')}
          </label>
        </section>
        <OptionalFontPanel />
      </div>
      <div class="settings-group">
        <h2>{t('数据')}</h2>
        <section>
          <h3>{t('本地存储')}</h3>
          <p>{storage}</p>
          {persisted !== true && !isNativeApp && (
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
              {t('申请持久化存储')}
            </button>
          )}
          <p>
            {isNativeApp
              ? t(
                  '书籍和进度仅存于应用私有存储，卸载应用会删除它们。请定期导出备份。',
                )
              : t(
                  '书籍和进度仅存于本机，清除浏览器数据会删除它们。持久化也不能替代备份。',
                )}
          </p>
        </section>
        <section ref={backupSection} tabIndex={-1} aria-label={t('备份与恢复')}>
          <BackupPanel
            key={resetKey}
            onBusy={(working) => {
              setBusy(working);
              if (!working) refreshStorage();
            }}
          />
        </section>
        <section>
          <h3>{t('清空数据')}</h3>
          <p>
            {t(
              '删除{0}的书架、原文、进度、书签、划线笔记和设置。',
              isNativeApp ? t('应用内') : t('这台浏览器中'),
            )}
          </p>
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
            {t('清空所有数据')}
          </button>
        </section>
      </div>
      <div class="settings-group">
        <h2>{t('应用')}</h2>
        <section>
          <h3>{t('离线与更新')}</h3>
          {isNativeApp ? (
            <p>
              {t(
                '应用资源已内置在安装包中，可随时离线阅读。新版本通过应用更新提供。',
              )}
            </p>
          ) : (
            <>
              <p>
                {import.meta.env.DEV
                  ? t('开发预览不启用离线缓存。安装与离线功能请使用正式构建。')
                  : pwaState.value.offlineReady
                    ? t('应用资源已就绪，可离线打开。')
                    : t('正在准备离线资源，请保持联网。')}
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
                {t('自动检查应用更新')}
              </label>
              <p>
                {t(
                  '发现新版本后只在书架提示，点击更新才重新打开。关闭后微光阅读不主动定时检查，浏览器仍可能检查应用资源。',
                )}
              </p>
              <button
                disabled={
                  busy || pwaState.value.checking || import.meta.env.DEV
                }
                onClick={() => void checkPwaUpdate()}
              >
                {pwaState.value.checking ? t('正在检查…') : t('检查更新')}
              </button>
              {pwaState.value.error && (
                <p role="status">{pwaState.value.error}</p>
              )}
              {pwaState.value.available && (
                <p>{t('新版本已下载，返回书架即可更新。')}</p>
              )}
            </>
          )}
        </section>
        <section>
          <h3>{t('使用引导')}</h3>
          <button
            disabled={busy}
            onClick={(event) => {
              // WebKit pointer clicks do not always focus buttons; native dialog
              // close must still have the invoking control to return focus to.
              event.currentTarget.focus();
              setGuide(true);
            }}
          >
            {t('查看使用引导与安装方法')}
          </button>
        </section>
        <section>
          <h3>{t('关于')}</h3>
          <button onClick={() => navigate('#/about')}>
            {t('关于微光阅读与隐私')}
          </button>
        </section>
      </div>
      {clearDialog && (
        <Modal
          title={t('确认清空全部本地数据')}
          onDismiss={() => {
            if (!busy) setClearDialog(false);
          }}
        >
          <h2>{t('清空本地数据')}</h2>
          <p>
            {t(
              '将删除 {0} 本书、{1} 个书签、{2} 条划线笔记及全部设置。请先确认备份已保存在浏览器之外。',
              counts.books,
              counts.bookmarks,
              counts.highlights,
            )}
          </p>
          <label class="clear-confirm">
            {t('请输入“清空”确认')}
            <input
              value={confirmText}
              disabled={busy}
              autoComplete="off"
              onInput={(event) => setConfirmText(event.currentTarget.value)}
            />
          </label>
          <div class="data-actions">
            <button disabled={busy} onClick={() => setClearDialog(false)}>
              {t('取消')}
            </button>
            <button
              disabled={busy || confirmText !== t('清空')}
              onClick={() => {
                if (confirmText !== t('清空') || busy) return;
                setBusy(true);
                void resetSpeechData(true)
                  .then(() => clearAllData())
                  .then(() => {
                    resetLanguagePreference();
                    settings.value = initialSettings();
                    setClearDialog(false);
                    setResetKey((key) => key + 1);
                    setMessage('本地数据已清空。');
                  })
                  .catch(() => setMessage('清空失败，本地数据未被部分删除。'))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? t('清空中…') : t('确认清空')}
            </button>
          </div>
        </Modal>
      )}
      <p role="status">{t(message)}</p>
    </main>
  );
}
