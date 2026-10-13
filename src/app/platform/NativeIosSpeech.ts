/**
 * iOS 原生听书后端：SpeechBackend 的 Capacitor 实现。
 * 所有会话/批次/快照字段与插件层结构一致，校验错误统一转成 Error。
 */
import { registerPlugin } from '@capacitor/core';
import type {
  SpeechBackend,
  SpeechBatch,
  SpeechCommand,
  SpeechEvent,
  SpeechSessionInfo,
  SpeechSnapshot,
  SpeechTimerMode,
  SpeechVoice,
} from '@/reader/speech/SpeechBackend';

interface JySpeechPlugin {
  voices(): Promise<{ voices: SpeechVoice[] }>;
  begin(session: SpeechSessionInfo): Promise<void>;
  append(batch: SpeechBatch): Promise<void>;
  commit(options: { total: number }): Promise<void>;
  cancelPrepare(): Promise<void>;
  command(options: { commandId: string } & SpeechCommand): Promise<void>;
  setRate(options: { rate: number }): Promise<void>;
  setVoice(options: { voiceId: string }): Promise<void>;
  setTimer(options: { mode: SpeechTimerMode }): Promise<void>;
  snapshot(): Promise<SpeechSnapshot>;
  addListener(
    eventName: 'speechState',
    listenerFunc: (event: SpeechEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

// 不提供 web 实现：不支持的浏览器显示提示，不模拟系统能力。
const plugin = registerPlugin<JySpeechPlugin>('JySpeech');

class IosSpeechBackend implements SpeechBackend {
  voices(): Promise<SpeechVoice[]> {
    return plugin.voices().then((result) => result.voices);
  }
  begin(session: SpeechSessionInfo): Promise<void> {
    return plugin.begin(session);
  }
  append(batch: SpeechBatch): Promise<void> {
    return plugin.append(batch);
  }
  commit(total: number): Promise<void> {
    return plugin.commit({ total });
  }
  cancelPrepare(): Promise<void> {
    return plugin.cancelPrepare();
  }
  command(commandId: string, command: SpeechCommand): Promise<void> {
    return plugin.command({ commandId, ...command });
  }
  setRate(rate: number): Promise<void> {
    return plugin.setRate({ rate });
  }
  setVoice(voiceId: string): Promise<void> {
    return plugin.setVoice({ voiceId });
  }
  setTimer(mode: SpeechTimerMode): Promise<void> {
    return plugin.setTimer({ mode });
  }
  snapshot(): Promise<SpeechSnapshot> {
    return plugin.snapshot();
  }
  on(listener: (event: SpeechEvent) => void): () => void {
    const handle = plugin.addListener('speechState', listener);
    return () => {
      void handle.then((h) => h.remove());
    };
  }
}

export function createIosSpeechBackend(): SpeechBackend {
  return new IosSpeechBackend();
}
