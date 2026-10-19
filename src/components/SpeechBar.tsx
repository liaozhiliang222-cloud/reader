import { t } from '@/i18n';
import { useEffect, useRef } from 'preact/hooks';
import {
  speechView,
  speechControl,
  stopSpeech,
  cancelSpeechPreparation,
} from '@/app/speech/coordinator';
import type { SpeechTimer } from '@/reader/speech/protocol';
export function SpeechBar({ onFromPage }: { onFromPage: () => void }) {
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const reader = element.closest<HTMLElement>('.reader');
    const resize = () =>
      reader?.style.setProperty(
        '--speech-height',
        `${element.getBoundingClientRect().height}px`,
      );
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, []);
  const view = speechView.value;
  const state = view.snapshot;
  if (view.status === 'preparing')
    return (
      <aside ref={bar} class="speech-bar" aria-label={t('听书准备')}>
        <span role="status">
          {t('听书准备')} {view.finished}/{view.total} {t('章')}
        </span>
        <button onClick={cancelSpeechPreparation}>{t('取消')}</button>
      </aside>
    );
  return (
    <aside ref={bar} class="speech-bar" aria-label={t('听书控制')}>
      <span class="speech-status" role="status">
        {view.detached
          ? view.status === 'speaking'
            ? t('浏览中 · 正在听书')
            : t('浏览中 · 听书已暂停')
          : view.status === 'speaking'
            ? t('正在听书')
            : view.status === 'ready'
              ? t('正在加载语音')
              : t('听书已暂停')}
      </span>
      <div class="speech-buttons">
        <button
          aria-label={t('上一句')}
          disabled={!state || state.currentSentence === 0}
          onClick={() => void speechControl('previous')}
        >
          {t('‹句')}
        </button>
        <button
          disabled={!state}
          onClick={() =>
            void speechControl(view.status === 'speaking' ? 'pause' : 'resume')
          }
        >
          {view.status === 'speaking' ? t('暂停') : t('继续听书')}
        </button>
        <button
          aria-label={t('下一句')}
          disabled={!state}
          onClick={() => void speechControl('next')}
        >
          {t('句›')}
        </button>
        <label class="speech-rate">
          {t('语速')}
          <select
            aria-label={t('听书语速')}
            value={state?.rate ?? 1}
            disabled={!state}
            onChange={(e) =>
              void speechControl('rate', Number(e.currentTarget.value))
            }
          >
            {Array.from({ length: 26 }, (_, i) => 0.75 + i * 0.05).map(
              (rate) => (
                <option key={rate.toFixed(2)} value={rate.toFixed(2)}>
                  {rate.toFixed(2)}×
                </option>
              ),
            )}
          </select>
        </label>
        <select
          aria-label={t('听书定时')}
          value={state?.timer ?? 'off'}
          disabled={!state}
          onChange={(e) =>
            void speechControl('timer', e.currentTarget.value as SpeechTimer)
          }
        >
          <option value="off">{t('不限时')}</option>
          <option value="15m">{t('15 分钟')}</option>
          <option value="30m">{t('30 分钟')}</option>
          <option value="60m">{t('60 分钟')}</option>
          <option value="chapter">{t('读完本章')}</option>
        </select>
        {view.detached && <button onClick={onFromPage}>{t('从本页听')}</button>}
        <button aria-label={t('停止听书')} onClick={() => void stopSpeech()}>
          {t('关闭')}
        </button>
      </div>
    </aside>
  );
}
