/**
 * 听书后端协议：与平台无关的类型定义（安卓/iOS 计划共用）。
 * 规则：准备传输与声音播放分开；事件只提示「状态变了」，恢复时取快照；
 * 所有命令都可报告失败；快照不带正文。
 */
import type { Locator } from '@/types';

export const SPEECH_PROTOCOL_VERSION = 1;
/** 每条准备消息的上限：128 KiB UTF-8 JSON / 256 句，一次一个待确认批次。 */
export const BATCH_BYTES = 128 * 1024;
export const BATCH_SENTENCES = 256;
/** 会话临时文件总量上限。 */
export const SESSION_BYTES = 64 * 1024 * 1024;

export type SpeechTimerMode = 'off' | '15m' | '30m' | '60m' | 'chapter';

export type SpeechPhase =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'speaking'
  | 'paused'
  | 'ended'
  | 'stopped'
  | 'error';

export interface SpeechVoice {
  /** 平台语音标识（iOS 为 AVSpeechSynthesisVoice identifier）。 */
  id: string;
  name: string;
  language: string;
  /** 平台报告的音质等级；不用于离线证明。 */
  quality?: string;
}

/** 交给原生的句子：纯文本 + 定位，不含 HTML。 */
export interface SpeechSentence {
  /** 全书内递增序号。 */
  index: number;
  /** 稳定 id：内容版本 + 原文区间，重复句不冲突。 */
  id: string;
  text: string;
  chapterIndex: number;
  chapterTitle: string;
  start: Locator;
  end: Locator;
  /** 行内过滤后的原文区间映射。 */
  sourceRanges: { paragraphIndex: number; start: number; end: number }[];
}

export interface SpeechBatch {
  batchIndex: number;
  firstSentenceIndex: number;
  sentences: SpeechSentence[];
  final: boolean;
}

export interface SpeechSessionInfo {
  protocolVersion: number;
  sessionId: string;
  bookId: string;
  contentRevision: number;
  title: string;
}

export interface SpeechCapabilities {
  /** 锁屏/切后台继续播放。 */
  background: boolean;
  /** 控制中心/锁屏/耳机媒体键。 */
  mediaControls: boolean;
  /** 语音是否确认为离线。 */
  offlineVoices: boolean;
}

export type SpeechStopReason =
  | 'user'
  | 'timer'
  | 'chapterEnd'
  | 'finished'
  | 'interruption'
  | 'routeChange'
  | 'queueError'
  | 'replaced'
  | 'error';

export interface SpeechSnapshot {
  sessionId?: string;
  bookId?: string;
  contentRevision?: number;
  /** 播放代次：取消/跳句/改语速递增，迟到的回调不得推进新队列。 */
  generation: number;
  /** 状态序号：单调递增，用于丢弃重复与乱序事件。 */
  sequence: number;
  state: SpeechPhase;
  currentIndex?: number;
  currentSentence?: {
    index: number;
    chapterIndex: number;
    chapterTitle: string;
    start: Locator;
    end: Locator;
    /** 行内过滤后的原文区间（前端高亮用）。 */
    sourceRanges?: { paragraphIndex: number; start: number; end: number }[];
  };
  /** 续读点（最近确认的句首）。 */
  resumeLocator?: Locator;
  stopReason?: SpeechStopReason;
  error?: string;
  timer?: { mode: SpeechTimerMode; remainingMs?: number };
  rate: number;
  voiceId?: string;
  capabilities: SpeechCapabilities;
  /** 已进入准备但未提交的句子数（供恢复时提示重新准备）。 */
  prepared?: number;
  total?: number;
}

export type SpeechEvent = { type: 'state'; snapshot: SpeechSnapshot };

export type SpeechCommand =
  | { kind: 'play'; at?: number }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'stop' }
  | { kind: 'previous' }
  | { kind: 'next' };

export interface SpeechBackend {
  /** 可用语音列表；不支持的平台返回空。 */
  voices(): Promise<SpeechVoice[]>;
  /** 开始新会话；旧会话由原生作废旧回调。 */
  begin(session: SpeechSessionInfo): Promise<void>;
  /** 追加一个批次；重复批次仅接受相同内容，乱序/异内容拒绝。 */
  append(batch: SpeechBatch): Promise<void>;
  /** 提交：校验序列连续完整后才允许播放。 */
  commit(total: number): Promise<void>;
  cancelPrepare(): Promise<void>;
  /** 控制命令；commandId 使同一命令重试幂等。 */
  command(commandId: string, command: SpeechCommand): Promise<void>;
  setRate(rate: number): Promise<void>;
  setVoice(voiceId: string): Promise<void>;
  setTimer(mode: SpeechTimerMode): Promise<void>;
  snapshot(): Promise<SpeechSnapshot>;
  /** 订阅状态变更；先订阅再取快照以避免竞态。 */
  on(listener: (event: SpeechEvent) => void): () => void;
}
