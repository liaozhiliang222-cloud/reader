import type { Page } from '@playwright/test';
import type {
  SpeechBatch,
  SpeechIdentity,
} from '../src/reader/speech/protocol';
import type { SpeechSentence } from '../src/reader/speech/segment';
import type { NativeSpeechSnapshot } from '../src/reader/speech/SpeechBackend';

/** Browser-only native backend double. No audio or production test entry point. */
export async function installSpeechBackend(page: Page, voices = true) {
  await page.addInitScript((available) => {
    let identity: SpeechIdentity | undefined;
    let sentences: SpeechSentence[] = [];
    let snapshot: NativeSpeechSnapshot | null = null;
    const commands: string[] = [];
    const listeners = new Map<string, (event: object) => void>();
    const notify = () => {
      for (const [event, callback] of listeners)
        if (event.startsWith('speechChanged:')) callback({});
    };
    const change = (action: string, args: Record<string, unknown> = {}) => {
      if (!snapshot) return;
      commands.push(action);
      snapshot = {
        ...snapshot,
        generation: snapshot.generation + 1,
        sequence: snapshot.sequence + 1,
      };
      if (action === 'pause') snapshot.state = 'paused';
      if (action === 'resume') {
        snapshot.state = 'speaking';
        if (typeof args.leaseId === 'string') snapshot.leaseId = args.leaseId;
      }
      if (action === 'stop') snapshot.state = 'stopped';
      if (action === 'rate') snapshot.rate = args.rate as number;
      if (action === 'timer')
        snapshot.timer = args.timer as NativeSpeechSnapshot['timer'];
      if (action === 'next' || action === 'previous') {
        snapshot.currentSentence = Math.max(
          0,
          Math.min(
            sentences.length - 1,
            snapshot.currentSentence + (action === 'next' ? 1 : -1),
          ),
        );
        const sentence = sentences[snapshot.currentSentence]!;
        snapshot.resumeLocator = sentence.start;
        snapshot.sourceRanges = sentence.sourceRanges;
      }
      notify();
    };
    const speech = (action: string, args: Record<string, unknown>) => {
      if (action === 'voices')
        return {
          engine: 'browser-test-double',
          engines: [{ id: 'browser-test-double', label: '测试替身（无声音）' }],
          voices: available ? [{ id: 'offline-zh', language: 'zh-CN' }] : [],
        };
      if (action === 'state')
        return {
          active: !!snapshot && !['stopped', 'ended'].includes(snapshot.state),
          snapshot,
        };
      if (action === 'prepare') {
        identity = args as unknown as SpeechIdentity;
        sentences = [];
      }
      if (action === 'append')
        sentences.push(...(args as unknown as SpeechBatch).sentences);
      if (action === 'start') {
        if (!identity || !sentences[0])
          throw new Error('No prepared sentences');
        snapshot = {
          ...identity,
          leaseId: args.leaseId as string,
          sequence: 1,
          state: 'speaking',
          currentSentence: 0,
          resumeLocator: sentences[0].start,
          sourceRanges: sentences[0].sourceRanges,
          stopReason: null,
          rate: args.rate as number,
          timer: args.timer as NativeSpeechSnapshot['timer'],
        };
        commands.push('start');
        notify();
      }
      if (action === 'control') change(args.action as string, args);
      if (action === 'reset') {
        snapshot = null;
        sentences = [];
      }
      return {};
    };
    Reflect.set(window, '__speechBackendDouble', {
      pause: () => change('pause'),
      inspect: () => ({ snapshot, commands, sentenceCount: sentences.length }),
    });
    Reflect.set(window, 'androidBridge', {});
    Reflect.set(window, 'Capacitor', {
      PluginHeaders: ['JyNative', 'App'].map((name) => ({
        name,
        methods: [
          ...[
            'speech',
            'speechSettings',
            'speechLaunch',
            'consumeLaunchFile',
            'setVolumeKeys',
            'setImmersive',
            'keepAwake',
            'statusBar',
            'exitApp',
            'removeListener',
          ].map((name) => ({ name, rtype: 'promise' })),
          { name: 'addListener', rtype: 'callback' },
        ],
      })),
      nativePromise: async (
        _plugin: string,
        method: string,
        options: Record<string, unknown> = {},
      ) => {
        if (method === 'speech')
          return speech(
            options.action as string,
            options.args as Record<string, unknown>,
          );
        if (method === 'speechLaunch') return { bookId: null };
        return {};
      },
      nativeCallback: (
        _plugin: string,
        _method: string,
        options: { eventName: string },
        callback: (event: object) => void,
      ) => {
        const id = `${options.eventName}:${listeners.size}`;
        listeners.set(id, callback);
        return id;
      },
    });
  }, voices);
}
