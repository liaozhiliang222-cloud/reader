import { t, uiLanguage } from '@/i18n';
import { canUsePro } from '@/app/pro';
import { ProPanel } from './ProPanel';
import { isIosApp } from '@/app/platform';
import { useEffect, useState } from 'preact/hooks';
import { Modal } from './Modal';
import { BookLoading } from './BookLoading';
import { openSpeechSettings, speechVoices } from '@/app/speech/coordinator';
import type { SpeechVoiceList } from '@/reader/speech/SpeechBackend';

export function SpeechSetup({
  onStart,
  onClose,
}: {
  onStart: (engine: string, voice: string) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<SpeechVoiceList>();
  const [voice, setVoice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const load = async (engine = '') => {
    setBusy(true);
    setError('');
    try {
      const value = await speechVoices(engine);
      setList(value);
      setVoice(
        value.voices.find((v) => v.id === value.savedVoice)?.id ??
          value.voices.find((v) =>
            v.language
              .toLowerCase()
              .startsWith(uiLanguage.peek() === 'en' ? 'en' : 'zh'),
          )?.id ??
          value.voices[0]?.id ??
          '',
      );
    } catch {
      setError(t('无法读取系统语音，请检查离线语音数据后重试。'));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  if (isIosApp && !canUsePro()) return <ProPanel onClose={onClose} />;
  return (
    <Modal title={t('本地听书')} onDismiss={onClose}>
      <h2>{t('本地听书')}</h2>
      <p>
        {isIosApp
          ? t(
              '请先在系统设置中下载声音，并关闭网络试读，确认所选声音可离线使用。',
            )
          : t(
              '正文交给系统语音引擎处理。只使用已安装、标记为无需联网的语音；引擎是独立应用，可能拥有联网权限。',
            )}
      </p>
      {busy ? (
        <BookLoading title={t('正在检查离线语音')} />
      ) : (
        <>
          {list && (
            <>
              <label class="speech-field">
                {t('语音引擎')}
                <select
                  value={list.engine}
                  onChange={(e) => void load(e.currentTarget.value)}
                >
                  {list.engines.map((engine) => (
                    <option key={engine.id} value={engine.id}>
                      {engine.label}
                    </option>
                  ))}
                </select>
              </label>
              <label class="speech-field">
                {t('离线语音')}
                <select
                  value={voice}
                  disabled={!list.voices.length}
                  onChange={(e) => setVoice(e.currentTarget.value)}
                >
                  {list.voices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.language} · {voice.id}
                    </option>
                  ))}
                </select>
              </label>
              {!list.voices.length && (
                <p role="status">
                  {t(
                    '此引擎没有已安装的离线语音。可切换引擎，或在系统设置中安装语音数据。',
                  )}
                </p>
              )}
            </>
          )}
          {error && <p role="alert">{error}</p>}
          <div class="panel-actions">
            <button
              onClick={() =>
                void openSpeechSettings().catch(() =>
                  setError(t('请手动打开系统设置中的文字转语音。')),
                )
              }
            >
              {t('系统语音设置')}
            </button>
            <button onClick={() => void load(list?.engine)}>
              {t('重新检查')}
            </button>
            <button
              disabled={!list || !voice}
              onClick={() => {
                if (list) onStart(list.engine, voice);
              }}
            >
              {t('从本页听')}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
