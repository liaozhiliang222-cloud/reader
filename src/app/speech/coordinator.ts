import { t } from '@/i18n';
import { signal } from '@preact/signals';
import { db } from '@/db';
import { getBook, getChapter, getBlob } from '@/db/repository';
import { assertContentRevision } from '@/db/revision';
import {
  claimSpeech,
  releaseSpeech,
  releaseOrphanedSpeech,
  saveSpeechSnapshot,
} from '@/db/speech';
import { settings } from '@/app/settings';
import { saveSettings } from '@/db/settings';
import { hasNativeSpeech, isIosApp } from '@/app/platform';
import { prepareSpeech } from '@/reader/speech/batch';
import { openEpubSpeechSource } from '@/reader/speech/epubSource';
import {
  validSnapshot,
  type SpeechStatus,
  type SpeechTimer,
} from '@/reader/speech/protocol';
import type {
  SpeechBackend,
  SpeechVoiceList,
  NativeSpeechSnapshot,
} from '@/reader/speech/SpeechBackend';
import type { Book, Locator } from '@/types';

export interface SpeechView {
  bookId?: string;
  status: SpeechStatus;
  snapshot?: NativeSpeechSnapshot;
  detached: boolean;
  finished: number;
  total: number;
  error: string;
}
export const speechView = signal<SpeechView>({
  status: 'idle',
  detached: false,
  finished: 0,
  total: 0,
  error: '',
});
let backendPromise: Promise<SpeechBackend> | undefined;
const backend = () =>
  (backendPromise ??= isIosApp
    ? import('@/reader/speech/IosSpeech').then((module) => module.iosSpeech)
    : import('@/reader/speech/NativeSpeech').then(
        (module) => module.nativeSpeech,
      ));
let tail = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work);
  tail = result.then(
    () => {},
    () => {},
  );
  return result;
}
let preparation: AbortController | undefined;
let preparedIdentity:
  Parameters<typeof prepareSpeech>[0]['identity'] | undefined;
let installed = false;
let seen = '';
const showError = (error: unknown) => {
  const detail =
    error instanceof Error ? error.message : t('听书未能完成，请重试。');
  speechView.value = {
    ...speechView.value,
    error:
      detail === 'queue_too_large'
        ? t('本次听书内容超出设备缓存上限，可选择“读完本章”后重试。')
        : /^[a-z][a-z0-9_:-]*$/i.test(detail)
          ? t('听书暂不可用，请检查离线语音后重试。')
          : detail,
  };
};
function readSnapshot(value: unknown): NativeSpeechSnapshot | undefined {
  if (!value || typeof value !== 'object')
    throw new Error(t('无法读取听书状态。'));
  const snapshot: unknown = Reflect.get(value, 'snapshot');
  if (snapshot === null) return;
  if (!validSnapshot(snapshot))
    throw new Error(t('听书状态无效，请停止后重试。'));
  const leaseId: unknown = Reflect.get(snapshot, 'leaseId');
  if (typeof leaseId !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(leaseId))
    throw new Error(t('听书进度状态无效。'));
  return { ...snapshot, leaseId };
}
async function syncNow() {
  const api = await backend();
  const response = await api.request('state');
  const snapshot = readSnapshot(response);
  const inactive =
    !!response &&
    typeof response === 'object' &&
    Reflect.get(response, 'active') === false &&
    !preparation;
  if (!snapshot) {
    if (inactive) await releaseOrphanedSpeech();
    return;
  }
  const key = `${snapshot.sessionId}:${snapshot.leaseId}:${snapshot.sequence}`;
  if (key === seen) return;
  const result = await saveSpeechSnapshot(snapshot);
  if (result === 'saved') await api.request('ack', snapshot);
  const detached = result !== 'saved';
  if (
    (result === 'session' || result === 'conflict') &&
    snapshot.state === 'speaking'
  ) {
    await api.request('control', {
      ...snapshot,
      action: 'pause',
      commandId: crypto.randomUUID(),
    });
  }
  seen = key;
  speechView.value = {
    ...speechView.value,
    bookId: snapshot.bookId,
    snapshot,
    status: snapshot.state,
    detached,
    error:
      snapshot.state === 'error'
        ? t('听书已停止，请检查离线语音或重新准备。')
        : speechView.value.error,
  };
  if (['ended', 'stopped', 'error'].includes(snapshot.state))
    await releaseSpeech(snapshot.bookId, snapshot.leaseId);
  if (inactive) await releaseOrphanedSpeech();
}
export const refreshSpeech = () =>
  hasNativeSpeech ? serial(syncNow).catch(showError) : Promise.resolve();
export async function connectSpeech() {
  if (!hasNativeSpeech || installed) return;
  installed = true;
  try {
    const api = await backend();
    await api.watch(() => {
      if (document.visibilityState === 'visible') void refreshSpeech();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') preparation?.abort();
      else void refreshSpeech();
    });
    window.setInterval(() => {
      if (
        document.visibilityState === 'visible' &&
        speechView.value.snapshot &&
        !preparation
      )
        void refreshSpeech();
    }, 1500);
    await refreshSpeech();
  } catch (error) {
    installed = false;
    showError(error);
  }
}
export async function speechVoices(engine = ''): Promise<SpeechVoiceList> {
  const value = await (await backend()).request('voices', { engine });
  if (!value || typeof value !== 'object')
    throw new Error(t('无法读取系统语音。'));
  const field = (key: string): unknown => Reflect.get(value, key);
  const engines = field('engines'),
    voices = field('voices');
  if (
    typeof field('engine') !== 'string' ||
    !Array.isArray(engines) ||
    !Array.isArray(voices)
  )
    throw new Error(t('系统语音信息不完整。'));
  const read = (rows: unknown[], key: 'label' | 'language') =>
    rows.map((row) => {
      if (!row || typeof row !== 'object')
        throw new Error(t('系统语音信息无效。'));
      const id: unknown = Reflect.get(row, 'id'),
        label: unknown = Reflect.get(row, key);
      if (typeof id !== 'string' || typeof label !== 'string')
        throw new Error(t('系统语音信息无效。'));
      return { id, label };
    });
  return {
    engine: field('engine') as string,
    engines: read(engines, 'label'),
    voices: read(voices, 'language').map((voice) => ({
      id: voice.id,
      language: voice.label,
    })),
    savedVoice:
      typeof field('savedVoice') === 'string'
        ? (field('savedVoice') as string)
        : undefined,
    engineInternetPermission: field('engineInternetPermission') === true,
  };
}
export const openSpeechSettings = async () => (await backend()).openSettings();
export function cancelSpeechPreparation() {
  preparation?.abort();
}

export async function startSpeech(
  book: Book,
  start: Locator,
  engine: string,
  voice: string,
) {
  await connectSpeech();
  await stopSpeech();
  const controller = new AbortController();
  preparation = controller;
  const identity = {
    protocolVersion: 1 as const,
    sessionId: crypto.randomUUID(),
    bookId: book.id,
    contentRevision: book.contentRevision ?? 0,
    generation: 0,
  };
  preparedIdentity = identity;
  const timer = settings.value.speech?.timer ?? 'off';
  speechView.value = {
    bookId: book.id,
    status: 'preparing',
    detached: false,
    finished: 0,
    total: timer === 'chapter' ? 1 : book.chapterCount - start.chapterIndex,
    error: '',
  };
  let leaseId: string | undefined;
  try {
    const api = await backend();
    await api.request('prepare', identity);
    const assertRevision = async () => {
      controller.signal.throwIfAborted();
      const current = await getBook(book.id);
      if (!current || current.missingFile)
        throw new Error(t('书籍已不存在或原文缺失。'));
      assertContentRevision(current, identity.contentRevision);
    };
    const last = await getChapter(
      book.id,
      timer === 'chapter' ? start.chapterIndex : book.chapterCount - 1,
    );
    if (!last) throw new Error(t('书籍章节缺失。'));
    const endLocator = {
      chapterIndex: last.index,
      paragraphIndex: Math.max(0, last.paragraphs.length - 1),
      charOffset: last.paragraphs.at(-1)?.length ?? 0,
    };
    const lease = await claimSpeech(identity, endLocator, timer !== 'chapter');
    leaseId = lease.leaseId;
    let epubSource:
      Awaited<ReturnType<typeof openEpubSpeechSource>> | undefined;
    if (book.type === 'epub') {
      const original = await getBlob(book.fileBlobId ?? book.id);
      if (!original) throw new Error(t('本机缺少书籍原件，无法准备听书。'));
      epubSource = await openEpubSpeechSource(
        original.data,
        book.parserVersion ?? 1,
        controller.signal,
      );
    }
    let count = 0;
    for await (const batch of prepareSpeech({
      identity,
      start,
      chapterCount: book.chapterCount,
      chapterOnly: timer === 'chapter',
      signal: controller.signal,
      assertRevision,
      getChapter: async (index) => {
        const chapter = await getChapter(book.id, index);
        if (!chapter) throw new Error(t('书籍章节缺失。'));
        return epubSource ? epubSource(chapter) : chapter;
      },
      onProgress: (finished, total) => {
        if (preparation === controller)
          speechView.value = { ...speechView.value, finished, total };
      },
    })) {
      await api.request('append', batch);
      count += batch.sentences.length;
    }
    controller.signal.throwIfAborted();
    await assertRevision();
    await api.request('commit', { ...identity, count });
    controller.signal.throwIfAborted();
    await api.request('start', {
      ...identity,
      leaseId,
      title: book.title,
      engine,
      voice,
      rate: settings.value.speech?.rate ?? 1,
      timer,
    });
    speechView.value = { ...speechView.value, status: 'ready' };
    // The service starts asynchronously; only this explicit user action can play.
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      await refreshSpeech();
      if (speechView.value.snapshot?.sessionId === identity.sessionId) break;
    }
    if (speechView.value.snapshot?.sessionId !== identity.sessionId)
      throw new Error(t('听书服务未能启动，请重新准备。'));
  } catch (error) {
    await (await backend()).request('cancel', identity).catch(() => {});
    if (leaseId) await releaseSpeech(book.id, leaseId);
    if (preparation === controller) {
      speechView.value = { ...speechView.value, status: 'idle' };
      if (!controller.signal.aborted) showError(error);
    }
  } finally {
    if (preparation === controller) preparation = undefined;
    if (preparedIdentity?.sessionId === identity.sessionId)
      preparedIdentity = undefined;
  }
}
export async function speechControl(
  action: string,
  value?: number | SpeechTimer,
  throwOnError = false,
) {
  return serial(async () => {
    const api = await backend();
    const snapshot = readSnapshot(await api.request('state'));
    if (!snapshot) return;
    if (
      action === 'timer' &&
      value !== 'chapter' &&
      (await db.speech.get(snapshot.bookId))?.wholeBook === false
    )
      throw new Error(
        t('此会话只准备了本章，请关闭后从本页重新开始不限时听书。'),
      );
    let leaseId = snapshot.leaseId;
    if (action === 'resume' && speechView.value.detached) {
      const old = await db.speech.get(snapshot.bookId);
      if (!old) throw new Error(t('请从本页重新开始听书。'));
      leaseId = (await claimSpeech(snapshot, old.endLocator, old.wholeBook))
        .leaseId;
    }
    await api.request('control', {
      ...snapshot,
      leaseId,
      action,
      commandId: crypto.randomUUID(),
      ...(action === 'rate' ? { rate: value } : {}),
      ...(action === 'timer' ? { timer: value } : {}),
    });
    if (action === 'rate' || action === 'timer') {
      const current = settings.value.speech ?? {
        rate: 1,
        timer: 'off' as const,
      };
      settings.value = await saveSettings({
        speech: {
          ...current,
          ...(action === 'rate'
            ? { rate: value as number }
            : { timer: value as SpeechTimer }),
        },
      });
    }
    seen = '';
    await syncNow();
  }).catch((error: unknown) => {
    showError(error);
    if (throwOnError) throw error;
  });
}
export async function manualSpeechNavigation(bookId: string) {
  if (
    !hasNativeSpeech ||
    speechView.value.bookId !== bookId ||
    !['preparing', 'ready', 'speaking', 'paused'].includes(
      speechView.value.status,
    ) ||
    speechView.value.detached
  )
    return;
  if (preparation) {
    cancelSpeechPreparation();
    return;
  }
  await speechControl('pause', undefined, true);
  const snapshot = speechView.value.snapshot;
  if (snapshot) await releaseSpeech(bookId, snapshot.leaseId);
  speechView.value = { ...speechView.value, detached: true };
}
export async function stopSpeech() {
  if (!hasNativeSpeech) return;
  preparation?.abort();
  if (preparedIdentity)
    await (await backend()).request('cancel', preparedIdentity).catch(() => {});
  return serial(async () => {
    const api = await backend();
    const snapshot = readSnapshot(await api.request('state'));
    if (snapshot && ['ready', 'speaking', 'paused'].includes(snapshot.state)) {
      await api.request('control', {
        ...snapshot,
        action: 'stop',
        commandId: crypto.randomUUID(),
      });
      await syncNow();
    }
    if (snapshot) await releaseSpeech(snapshot.bookId, snapshot.leaseId);
    speechView.value = {
      status: 'idle',
      detached: false,
      finished: 0,
      total: 0,
      error: '',
    };
  });
}
export async function resetSpeechData(clearPreferences = false) {
  if (!hasNativeSpeech) return;
  await stopSpeech();
  await (await backend()).request('reset', { clearPreferences });
  seen = '';
}
