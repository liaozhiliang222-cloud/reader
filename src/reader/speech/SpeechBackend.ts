import type { SpeechSnapshot } from './protocol';
export interface NativeSpeechSnapshot extends SpeechSnapshot {
  leaseId: string;
}
export interface SpeechVoiceList {
  engine: string;
  engines: { id: string; label: string }[];
  voices: { id: string; language: string }[];
  savedVoice?: string;
  engineInternetPermission?: boolean;
}
export interface SpeechBackend {
  request(action: string, args?: object): Promise<unknown>;
  watch(listener: () => void): Promise<() => void>;
  openSettings(): Promise<void>;
}
