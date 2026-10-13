/**
 * 听书播放条：上一句/播放暂停/下一句常驻，语音/语速/定时在「更多」。
 * 纸感主题沿用页面变量；底部为正文与安全区预留空间。
 */
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '@/components/Icon';
import { settings } from '@/app/settings';
import { saveSettings } from '@/db/settings';
import {
  cancelSpeechPrepare,
  pauseSpeech,
  resumeSpeech,
  speechSetRate,
  speechSetTimer,
  speechSetVoice,
  speechSkip,
  speechUi,
  speechVoices,
  stopSpeech,
  type SpeechUi,
} from '@/app/speech/coordinator';
import type {
  SpeechTimerMode,
  SpeechVoice,
} from '@/reader/speech/SpeechBackend';

const RATES = [0.75, 1, 1.25, 1.5, 2];
const TIMERS: { mode: SpeechTimerMode; label: string }[] = [
  { mode: 'off', label: '关闭' },
  { mode: '15m', label: '15 分钟' },
  { mode: '30m', label: '30 分钟' },
  { mode: '60m', label: '60 分钟' },
  { mode: 'chapter', label: '读完本章' },
];

function persistPrefs(patch: { rate?: number; timer?: SpeechTimerMode }) {
  const speech = {
    rate: settings.value.speech?.rate ?? 1,
    timer: settings.value.speech?.timer ?? 'off',
    ...patch,
  };
  void saveSettings({ speech })
    .then((value) => {
      settings.value = value;
    })
    .catch(() => {});
}

function voiceLang(voice: SpeechVoice) {
  return voice.language.toLowerCase().startsWith('zh') ? '中文' : '英文';
}

function SpeechMore({ ui, onClose }: { ui: SpeechUi; onClose: () => void }) {
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const prefs = settings.value.speech ?? { rate: 1, timer: 'off' as const };
  const timer = ui.timer?.mode ?? prefs.timer;
  useEffect(() => {
    let cancelled = false;
    void speechVoices().then((list) => {
      if (!cancelled) setVoices(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const chosenVoice = localStorage.getItem('jingye.speech.voice') ?? '';
  const languages = ['中文', '英文'].filter((lang) =>
    voices.some((voice) => voiceLang(voice) === lang),
  );
  return (
    <section class="speech-more" aria-label="听书选项">
      <div class="speech-option">
        <span>语速</span>
        <div class="speech-rate" role="group" aria-label="语速">
          {RATES.map((rate) => (
            <button
              key={rate}
              aria-pressed={prefs.rate === rate}
              onClick={() => {
                persistPrefs({ rate });
                void speechSetRate(rate);
              }}
            >
              {rate}×
            </button>
          ))}
        </div>
      </div>
      <div class="speech-option">
        <span>定时</span>
        <div class="speech-rate" role="group" aria-label="定时">
          {TIMERS.map(({ mode, label }) => (
            <button
              key={mode}
              aria-pressed={timer === mode}
              onClick={() => {
                persistPrefs({ timer: mode });
                void speechSetTimer(mode);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {languages.map((lang) => (
        <div class="speech-option" key={lang}>
          <span>{lang}语音</span>
          <div class="speech-voices">
            {voices
              .filter((voice) => voiceLang(voice) === lang)
              .map((voice) => (
                <button
                  key={voice.id}
                  aria-pressed={chosenVoice === voice.id}
                  onClick={() => {
                    localStorage.setItem('jingye.speech.voice', voice.id);
                    void speechSetVoice(voice.id);
                    onClose();
                  }}
                >
                  {voice.name}
                </button>
              ))}
          </div>
        </div>
      ))}
      {!languages.length && (
        <p class="speech-voice-empty">
          没有找到中文或英文语音，请在系统「设置 → 辅助功能 →
          朗读内容」中下载语音后重试。
        </p>
      )}
    </section>
  );
}

function fmtRemaining(ms?: number) {
  if (ms === undefined) return '';
  const minutes = Math.max(0, Math.ceil(ms / 60000));
  return `约 ${minutes} 分钟`;
}

export function SpeechBar({
  onListenHere,
}: {
  /** 「从本页听」：由阅读页用当前页首锚点新开一局。 */
  onListenHere: () => void;
}) {
  const ui = speechUi.value;
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (ui.phase === 'off') setMore(false);
  }, [ui.phase]);

  if (ui.phase === 'off') return null;

  if (ui.phase === 'preparing') {
    const progress = ui.progress;
    return (
      <aside class="speech-bar" aria-label="听书">
        <div class="speech-bar-main">
          <p class="speech-title" role="status">
            正在准备听书
            {progress && ` · 第 ${progress.done} / ${progress.total} 章`}
          </p>
          <button class="speech-stop" onClick={() => cancelSpeechPrepare()}>
            取消
          </button>
        </div>
      </aside>
    );
  }

  if (ui.phase === 'ended') {
    return (
      <aside class="speech-bar" aria-label="听书">
        <div class="speech-bar-main">
          <p class="speech-title" role="status">
            本章听书已结束
          </p>
          <button class="speech-stop" onClick={() => void stopSpeech()}>
            关闭
          </button>
        </div>
      </aside>
    );
  }

  const speaking = ui.phase === 'speaking';
  const pausedByTurn = ui.phase === 'paused' && ui.manualPaused;
  const remaining =
    ui.timer && ui.timer.mode !== 'off' && ui.timer.mode !== 'chapter'
      ? fmtRemaining(ui.timer.remainingMs)
      : '';
  return (
    <aside class="speech-bar" aria-label="听书">
      <div class="speech-bar-main">
        <div class="speech-info">
          <p class="speech-title">
            {ui.now?.chapterTitle ?? '听书'}
            {ui.total ? ` · ${(ui.now?.index ?? 0) + 1}/${ui.total}` : ''}
          </p>
          {remaining && <p class="speech-timer">{remaining}后停止</p>}
        </div>
        <div class="speech-controls">
          <button
            class="icon-button"
            aria-label="上一句"
            onClick={() => void speechSkip('previous')}
          >
            <Icon name="previous" />
          </button>
          <button
            class="icon-button speech-play"
            aria-label={speaking ? '暂停' : '继续'}
            aria-pressed={speaking}
            onClick={() =>
              speaking ? void pauseSpeech() : void resumeSpeech()
            }
          >
            <Icon name={speaking ? 'pause' : 'play'} />
          </button>
          <button
            class="icon-button"
            aria-label="下一句"
            onClick={() => void speechSkip('next')}
          >
            <Icon name="next" />
          </button>
          <button
            class="icon-button"
            aria-label="听书选项"
            aria-expanded={more}
            onClick={() => setMore((value) => !value)}
          >
            <Icon name="more" />
          </button>
          <button
            class="icon-button"
            aria-label="停止听书"
            onClick={() => void stopSpeech()}
          >
            <Icon name="stop" />
          </button>
        </div>
      </div>
      {pausedByTurn && (
        <div class="speech-resume-row">
          <button class="text-button" onClick={() => void resumeSpeech()}>
            继续听书
          </button>
          <button class="text-button" onClick={onListenHere}>
            从本页听
          </button>
        </div>
      )}
      {more && <SpeechMore ui={ui} onClose={() => setMore(false)} />}
    </aside>
  );
}
