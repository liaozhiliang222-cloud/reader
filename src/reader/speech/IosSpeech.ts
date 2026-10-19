import { t } from '@/i18n';
import { registerPlugin } from '@capacitor/core';
import type { SpeechBackend } from './SpeechBackend';

interface Bridge {
  speech(input: { action: string; args: object }): Promise<unknown>;
  addListener(
    event: 'speechChanged',
    callback: () => void,
  ): Promise<{ remove(): Promise<void> }>;
}
const plugin = registerPlugin<Bridge>('JySpeech');
export const iosSpeech: SpeechBackend = {
  request: (action, args = {}) => plugin.speech({ action, args }),
  watch: async (listener) => {
    const handle = await plugin.addListener('speechChanged', listener);
    return () => {
      void handle.remove();
    };
  },
  openSettings: () =>
    Promise.reject(
      new Error(
        t(
          '请打开“设置 → 辅助功能 → 朗读内容 → 声音”，下载所需语音后断网试读。',
        ),
      ),
    ),
};
