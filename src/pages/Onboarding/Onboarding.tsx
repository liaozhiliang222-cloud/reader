import { t } from '@/i18n';
import { useEffect, useRef, useState } from 'preact/hooks';
import { environment } from '@/app/environment';
import { installState, requestInstall } from '@/app/install';
import { isNativeApp } from '@/app/platform';
import { settings } from '@/app/settings';
import { saveSettings } from '@/db/settings';
import { EnvironmentNotice } from '@/components/EnvironmentNotice';
import { LanguageSelector } from '@/components/LanguageSelector';

const titles = isNativeApp
  ? ['你的书只在这台设备上', '从网页版迁移数据', '读书时，打开勿扰模式']
  : ['你的书只在这台设备上', '添加到主屏幕', '读书时，打开勿扰模式'];
export function Onboarding({
  first = false,
  onDone,
}: {
  first?: boolean;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const { ios, inApp } = environment();
  const install = installState.value;
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  const finish = async () => {
    if (busy) return;
    if (!first) {
      onDone();
      return;
    }
    setBusy(true);
    try {
      settings.value = await saveSettings({ onboarded: true });
      onDone();
    } catch {
      setError(t('引导记录未能保存。可以先阅读，下次打开可能再次显示。'));
      setBusy(false);
    }
  };
  return (
    <section class="onboarding" aria-labelledby="guide-heading">
      <div class="guide-top">
        <span>{t('微光阅读 · 使用引导')}</span>
        <button disabled={busy} onClick={() => void finish()}>
          {first ? t('跳过引导') : t('关闭引导')}
        </button>
      </div>
      <EnvironmentNotice />
      <LanguageSelector disabled={busy} />
      <p class="guide-step" aria-label={t('第 {0} 屏，共 3 屏', step + 1)}>
        {step + 1} / 3
      </p>
      <h1 id="guide-heading" ref={heading} tabIndex={-1}>
        {t(titles[step] ?? '')}
      </h1>
      {step === 0 && (
        <>
          <img
            class="guide-icon"
            src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
            alt=""
            width="72"
            height="72"
          />
          {isNativeApp ? (
            <>
              <p>{t('书籍、进度与笔记只保存在这台设备上，不需要注册。')}</p>
              <p>
                {t('卸载应用会删除它们。请在“设置 → 备份与恢复”中定期导出。')}
              </p>
            </>
          ) : (
            <>
              <p>{t('书籍、进度与笔记只保存在当前浏览器，不需要注册。')}</p>
              <p>
                {t(
                  '清除浏览器数据或系统回收空间可能删除它们。请在“设置 → 备份与恢复”中定期导出，并保存到浏览器之外。',
                )}
              </p>
            </>
          )}
        </>
      )}
      {step === 1 && isNativeApp && (
        <>
          <p>{t('App 与网页版的书籍互不相通，各存各的。')}</p>
          <p>
            {t(
              '如果你在用网页版微光阅读：在网页版“设置 → 备份与恢复”中导出完整备份， 再回到这里“设置 → 备份与恢复”选择该文件恢复。',
            )}
          </p>
        </>
      )}
      {step === 1 && !isNativeApp && (
        <>
          {install.installed ? (
            <p>{t('已安装，可从主屏幕打开。')}</p>
          ) : (
            <>
              <p>{t('从主屏幕直接打开，首次资源准备完成后可离线阅读。')}</p>
              {ios ? (
                <>
                  <ol
                    class="install-steps"
                    aria-label={t('Safari 添加到主屏幕步骤')}
                  >
                    <li>
                      <svg viewBox="0 0 32 32" aria-hidden="true">
                        <path d="M9 14H5v15h22V14h-4M16 22V3m-6 6 6-6 6 6" />
                      </svg>
                      <span>{t('Safari → 分享')}</span>
                    </li>
                    <li>
                      <svg viewBox="0 0 32 32" aria-hidden="true">
                        <rect x="4" y="4" width="24" height="24" rx="4" />
                        <path d="M16 10v12m-6-6h12" />
                      </svg>
                      <span>{t('添加到主屏幕')}</span>
                    </li>
                    <li>
                      <img
                        src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
                        alt=""
                      />
                      <span>{t('添加 → 打开微光阅读')}</span>
                    </li>
                  </ol>
                  <p>
                    {t(
                      '分享入口有时在 Safari 页面菜单中。如有“作为网页 App 打开”选项，请开启。',
                    )}
                  </p>
                </>
              ) : (
                <>
                  {install.available && !inApp && (
                    <button
                      disabled={install.pending}
                      onClick={() => void requestInstall()}
                    >
                      {t('安装微光阅读')}
                    </button>
                  )}
                  <p>
                    {t(
                      '也可打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。菜单名称因浏览器而异。',
                    )}
                  </p>
                </>
              )}
            </>
          )}
          {ios && (
            <p>
              {t(
                '导入 iPhone 里的书：回到书架，点“导入书籍”，从“文件”选择 EPUB 或 TXT。',
              )}
            </p>
          )}
          {install.pending && (
            <p role="status">{t('请完成浏览器安装窗口中的操作。')}</p>
          )}
          {install.message && <p role="status">{install.message}</p>}
        </>
      )}
      {step === 2 && (
        <>
          <p>{t('阅读前，在系统控制中心或快捷设置中开启“专注 / 勿扰”。')}</p>
          <p>
            {t(
              '微光阅读无法代你开启系统勿扰。阅读菜单中的“安静提示”可关闭进入阅读时的短暂提示。',
            )}
          </p>
        </>
      )}
      <div class="guide-actions">
        {step > 0 && (
          <button disabled={busy} onClick={() => setStep(step - 1)}>
            {t('上一步')}
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => (step < 2 ? setStep(step + 1) : void finish())}
        >
          {busy
            ? t('正在保存…')
            : step < 2
              ? t('下一步')
              : first
                ? t('开始使用')
                : t('完成')}
        </button>
      </div>
      {error && (
        <>
          <p role="alert">{error}</p>
          <button onClick={onDone}>{t('本次先阅读')}</button>
        </>
      )}
    </section>
  );
}
