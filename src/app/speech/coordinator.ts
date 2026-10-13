/**
 * 听书会话协调（公共层，安卓/iOS 计划 §6 的进度协调器）。
 *
 * - 会话权威在原生：这里只订阅快照、去重、向 UI/进度写入分发。
 * - 进度写入唯一：听书进行中由本模块按句首写进度，跟随翻页不覆盖。
 * - 引擎解耦：不 import 阅读器内部；ReaderView 订阅 speechNow 自行
 *   跟随翻页与高亮，手动翻页回调 speechManualTurn。
 */
import { signal } from '@preact/signals';
import { App as CapApp } from '@capacitor/app';
import { isNativeApp, platformKind } from '@/app/platform';
import { getChapter, getProgress, saveProgress } from '@/db/repository';
import { percentOf } from '@/reader/position';
import { createIosSpeechBackend } from '@/app/platform/NativeIosSpeech';
import { prepareSpeech } from '@/reader/speech/batch';
import {
  SPEECH_PROTOCOL_VERSION,
  type SpeechBackend,
  type SpeechSnapshot,
  type SpeechTimerMode,
} from '@/reader/speech/SpeechBackend';
import type { Book, Locator } from '@/types';

export interface SpeechNow {
  index: number;
  chapterIndex: number;
  chapterTitle: string;
  start: Locator;
  end: Locator;
  ranges: { paragraphIndex: number; start: number; end: number }[];
}

export type SpeechUiPhase =
  'off' | 'preparing' | 'speaking' | 'paused' | 'ended';

export interface SpeechUi {
  phase: SpeechUiPhase;
  /** 准备进度（已完成章节 / 总章节 / 已收句子）。 */
  progress?: { done: number; total: number; sentences: number };
  now?: SpeechNow;
  total?: number;
  timer?: { mode: SpeechTimerMode; remainingMs?: number };
  /** 手动翻页触发的暂停：SpeechBar 提供「继续听书 / 从本页听」。 */
  manualPaused?: boolean;
}

export const speechUi = signal<SpeechUi>({ phase: 'off' });
/** 最近一次错误/提示文本；由页面以原有错误条样式呈现，下一次操作清除。 */
export const speechNotice = signal('');
/** 原生是否在朗读/暂停中（供跟随与高亮）。 */
export const speechActive = signal(false);

export const speechSupported = () => platformKind === 'ios';

interface ActiveSession {
  backend: SpeechBackend;
  book: Book;
  sessionId: string;
  generation: number;
  lastSequence: number;
  total: number;
  /** 进度写入节流：记录最后已写的 locator 与计时器。 */
  savedKey: string;
  saveTimer?: ReturnType<typeof setTimeout>;
  pendingLocator?: Locator;
  chapters: Map<number, Promise<import('@/types').StoredChapter | undefined>>;
  abort: AbortController;
  unsubscribe: () => void;
}

let active: ActiveSession | null = null;
let counter = 0;
const commandId = () =>
  `cmd-${Date.now().toString(36)}-${(counter++).toString(36)}`;

const locatorKey = (locator: Locator) =>
  `${locator.chapterIndex}:${locator.paragraphIndex}:${locator.charOffset}`;

function chapterOf(session: ActiveSession, index: number) {
  let entry = session.chapters.get(index);
  if (!entry) {
    entry = getChapter(session.book.id, index);
    session.chapters.set(index, entry);
  }
  return entry;
}

function flushSave(session: ActiveSession) {
  if (session.saveTimer) {
    clearTimeout(session.saveTimer);
    session.saveTimer = undefined;
  }
  const target = session.pendingLocator;
  session.pendingLocator = undefined;
  if (!target || active !== session) return;
  const key = locatorKey(target);
  if (key === session.savedKey) return;
  session.savedKey = key;
  void chapterOf(session, target.chapterIndex).then((chapter) => {
    if (active !== session || !chapter) return;
    const percent = percentOf(chapter, target, session.book.charCount);
    void saveProgress(
      {
        bookId: session.book.id,
        locator: target,
        percent,
        updatedAt: Date.now(),
      },
      session.book.contentRevision ?? 0,
    ).catch(() => setNotice('进度未能保存，请检查本地存储。'));
  });
}

/** 按句首写阅读进度；节流 800ms 保留最新。 */
function persistLocator(session: ActiveSession, locator: Locator) {
  session.pendingLocator = locator;
  if (session.saveTimer) return;
  session.saveTimer = setTimeout(() => flushSave(session), 800);
}

export function setNotice(message: string) {
  speechNotice.value = message;
}

function snapshotNow(snapshot: SpeechSnapshot): SpeechNow | undefined {
  const sentence = snapshot.currentSentence;
  if (!sentence) return undefined;
  return {
    index: sentence.index,
    chapterIndex: sentence.chapterIndex,
    chapterTitle: sentence.chapterTitle,
    start: sentence.start,
    end: sentence.end,
    ranges: sentence.sourceRanges ?? [],
  };
}

function applySnapshot(session: ActiveSession, snapshot: SpeechSnapshot) {
  if (active !== session || snapshot.sessionId !== session.sessionId) return;
  if (snapshot.sequence <= session.lastSequence) return;
  session.lastSequence = snapshot.sequence;
  session.generation = Math.max(session.generation, snapshot.generation);

  const now = snapshotNow(snapshot);
  const ui = speechUi.value;
  switch (snapshot.state) {
    case 'ready':
      // 准备完成但用户已退后台/取消则不自动出声；ready 态保留 now 为空。
      speechUi.value = {
        phase: 'paused',
        now: ui.now,
        total: snapshot.total ?? session.total,
        timer: snapshot.timer,
      };
      speechActive.value = true;
      break;
    case 'speaking':
      speechUi.value = {
        phase: 'speaking',
        now: now ?? ui.now,
        total: snapshot.total ?? session.total,
        timer: snapshot.timer,
      };
      speechActive.value = true;
      break;
    case 'paused':
      speechUi.value = {
        phase: 'paused',
        now: now ?? ui.now,
        total: snapshot.total ?? session.total,
        timer: snapshot.timer,
        manualPaused: ui.manualPaused,
      };
      speechActive.value = true;
      break;
    case 'ended':
      speechUi.value = { phase: 'ended', total: snapshot.total };
      speechActive.value = false;
      break;
    case 'stopped':
    case 'idle':
      teardown(session, false);
      break;
    case 'error':
      teardown(session, false);
      setNotice(`听书出错：${snapshot.error ?? '未知错误'}`);
      break;
    case 'preparing':
      break;
  }
  if (snapshot.resumeLocator && snapshot.state === 'speaking')
    persistLocator(session, snapshot.resumeLocator);
}

function teardown(session: ActiveSession, notifyNative: boolean) {
  if (active !== session) return;
  active = null;
  clearTimeout(session.saveTimer);
  session.saveTimer = undefined;
  session.abort.abort();
  session.unsubscribe();
  speechUi.value = { phase: 'off' };
  speechActive.value = false;
  if (notifyNative)
    void session.backend.command(commandId(), { kind: 'stop' }).catch(() => {});
}

/** 当前会话所属书籍（供删除/换书时判断）。 */
export function speechBook(): string | null {
  return active?.book.id ?? null;
}

/**
 * 开始听书。调用方（ReaderView）负责在调用前 flush 自己的进度保存。
 * from 省略时从书架进度处起读。
 */
export async function startSpeech(options: {
  book: Book;
  from: Locator;
  untilChapter?: number;
  rate?: number;
  voiceId?: string;
  timer?: SpeechTimerMode;
}) {
  const { book, from } = options;
  speechNotice.value = '';
  if (!speechSupported()) {
    setNotice('当前环境不支持离线听书。');
    return;
  }
  // 同书同修订的既有会话：直接续播，不重排。
  if (
    active &&
    active.book.id === book.id &&
    active.book.contentRevision === (book.contentRevision ?? 0)
  ) {
    await resumeSpeech();
    return;
  }
  if (active) teardown(active, true);

  const backend = createIosSpeechBackend();
  const sessionId = crypto.randomUUID();
  const session: ActiveSession = {
    backend,
    book,
    sessionId,
    generation: 0,
    lastSequence: 0,
    total: 0,
    savedKey: '',
    chapters: new Map(),
    abort: new AbortController(),
    unsubscribe: () => {},
  };
  const offState = backend.on((event) =>
    applySnapshot(session, event.snapshot),
  );
  // 切入后台立即落盘最新语点；800ms 节流在 iOS 挂起后不再可靠。
  const onHide = () => {
    if (document.visibilityState === 'hidden') flushSave(session);
  };
  document.addEventListener('visibilitychange', onHide);
  session.unsubscribe = () => {
    offState();
    document.removeEventListener('visibilitychange', onHide);
  };
  active = session;
  speechUi.value = {
    phase: 'preparing',
    progress: { done: 0, total: 1, sentences: 0 },
  };
  speechActive.value = true;

  try {
    await backend.begin({
      protocolVersion: SPEECH_PROTOCOL_VERSION,
      sessionId,
      bookId: book.id,
      contentRevision: book.contentRevision ?? 0,
      title: book.title,
    });
    if (options.rate !== undefined) void backend.setRate(options.rate);
    if (options.voiceId) void backend.setVoice(options.voiceId);
    if (options.timer && options.timer !== 'off')
      void backend.setTimer(options.timer);
    // 「读完本章」同时收窄预排范围：原生按边界停，队列也不越界。
    const untilChapter =
      options.timer === 'chapter' ? from.chapterIndex : options.untilChapter;
    const total = await prepareSpeech(book, backend, from, {
      signal: session.abort.signal,
      untilChapter,
      onProgress: (progress) => {
        if (active === session)
          speechUi.value = { phase: 'preparing', progress };
      },
    });
    session.total = total;
    if (active !== session) return;
    if (!total) {
      teardown(session, true);
      setNotice('这里还没有可朗读的内容。');
      return;
    }
    await backend.command(commandId(), { kind: 'play', at: 0 });
  } catch (error) {
    if (active !== session) return;
    teardown(session, false);
    setNotice(
      `听书启动失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** 「读完本章后停止」：预排限定本章 + 原生按章边界停止。 */
export async function listenChapter(book: Book, from: Locator) {
  await startSpeech({ book, from, untilChapter: from.chapterIndex });
}

/** 继续听书（从原听书点）。 */
export async function resumeSpeech() {
  const session = active;
  if (!session) return;
  speechNotice.value = '';
  try {
    await session.backend.command(commandId(), { kind: 'resume' });
    speechUi.value = { ...speechUi.value, manualPaused: false };
  } catch {
    setNotice('恢复听书失败，请重试。');
  }
}

export async function pauseSpeech() {
  const session = active;
  if (!session) return;
  try {
    await session.backend.command(commandId(), { kind: 'pause' });
  } catch {
    setNotice('暂停失败，请重试。');
  }
}

export async function stopSpeech() {
  const session = active;
  if (!session) return;
  teardown(session, true);
}

export async function speechSkip(kind: 'previous' | 'next') {
  const session = active;
  if (!session) return;
  try {
    await session.backend.command(commandId(), { kind });
  } catch {
    setNotice(kind === 'previous' ? '已是第一句。' : '已是最后一句。');
  }
}

export async function speechSetRate(rate: number) {
  const session = active;
  if (!session) return;
  try {
    await session.backend.setRate(rate);
  } catch {
    setNotice('语速调整失败。');
  }
}

export async function speechSetVoice(voiceId: string) {
  const session = active;
  if (!session) return;
  try {
    await session.backend.setVoice(voiceId);
  } catch {
    setNotice('语音切换失败，请重新选择。');
  }
}

export async function speechSetTimer(mode: SpeechTimerMode) {
  const session = active;
  if (!session) return;
  try {
    await session.backend.setTimer(mode);
  } catch {
    setNotice('定时设置失败。');
  }
}

export async function speechVoices() {
  return active?.backend.voices() ?? [];
}

/** 手动翻页：播放中先暂停，保留原听书点；SpeechBar 提供继续/从本页听。 */
export function speechManualTurn() {
  if (!active || speechUi.value.phase !== 'speaking') return;
  speechUi.value = { ...speechUi.value, phase: 'paused', manualPaused: true };
  void pauseSpeech();
}

/** 书籍删除/重解析/改稿前调用：结束相关会话并作废旧回调。 */
export function speechBookRemoved(bookId: string) {
  if (active?.book.id === bookId) teardown(active, true);
}

/** 离开阅读页/回书架：停止、保存、清理（跨页继续听属后续增强）。 */
export function speechPageLeft() {
  const session = active;
  if (session) teardown(session, true);
}

/** 取消准备（用户点取消）：中止抽取并销毁会话。 */
export function cancelSpeechPrepare() {
  const session = active;
  if (!session) return;
  session.abort.abort();
  void session.backend.cancelPrepare().catch(() => {});
  teardown(session, true);
}

/** 应用回前台时重取快照对齐（桥断开不重放事件）。 */
export function speechResync() {
  const session = active;
  if (!session) return;
  void session.backend
    .snapshot()
    .then((snapshot) => {
      if (active === session) applySnapshot(session, snapshot);
    })
    .catch(() => {});
}

export { getProgress };

// 回前台重取快照：桥断开不重放堆积的逐句事件。
if (isNativeApp) {
  void CapApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) speechResync();
  });
}
