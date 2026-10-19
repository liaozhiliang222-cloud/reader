import { registerPlugin } from '@capacitor/core';
import type { SpeechBackend } from './SpeechBackend';
interface Bridge {
  speech(input: { action: string; args: object }): Promise<unknown>;
  speechSettings(): Promise<void>;
  addListener(
    event: 'speechChanged',
    callback: () => void,
  ): Promise<{ remove: () => Promise<void> }>;
}
const native = registerPlugin<Bridge>('JyNative');
export const nativeSpeech: SpeechBackend = {
  request: (action, args = {}) => native.speech({ action, args }),
  watch: async (listener) => {
    const handle = await native.addListener('speechChanged', listener);
    return () => {
      void handle.remove();
    };
  },
  openSettings: () => native.speechSettings(),
};
