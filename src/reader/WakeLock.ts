import type { ReadingSettings } from '@/types';
export interface ScreenLock {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
}
type Status = 'off' | 'active' | 'idle' | 'released' | 'unavailable';
export class ReaderWakeLock {
  private mode: ReadingSettings['wakeLock'] = 'off';
  private visible = true;
  private disposed = false;
  private lastAction = Date.now();
  private lock?: ScreenLock;
  private listener?: EventListener;
  private pending = false;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private request: () => Promise<ScreenLock>,
    private onStatus: (status: Status) => void,
  ) {}
  setMode(mode: ReadingSettings['wakeLock']) {
    this.mode = mode;
    this.lastAction = Date.now();
    this.sync();
  }
  setVisible(visible: boolean) {
    this.visible = visible;
    this.sync();
  }
  activity() {
    this.lastAction = Date.now();
    this.sync();
  }
  private wanted() {
    return (
      !this.disposed &&
      this.visible &&
      this.mode !== 'off' &&
      (this.mode !== 'idle5m' || Date.now() - this.lastAction < 300000)
    );
  }
  private release() {
    const lock = this.lock;
    this.lock = undefined;
    if (lock) {
      if (this.listener) lock.removeEventListener('release', this.listener);
      void lock.release().catch(() => {});
    }
    this.listener = undefined;
  }
  private sync() {
    clearTimeout(this.timer);
    if (this.mode === 'idle5m' && this.wanted())
      this.timer = setTimeout(
        () => this.sync(),
        Math.max(1, 300000 - (Date.now() - this.lastAction)),
      );
    if (!this.wanted()) {
      this.generation++;
      this.release();
      if (!this.disposed)
        this.onStatus(
          this.mode === 'off' ? 'off' : this.visible ? 'idle' : 'released',
        );
      return;
    }
    if ((this.lock && !this.lock.released) || this.pending) return;
    this.pending = true;
    const generation = ++this.generation;
    void this.request()
      .then((lock) => {
        if (generation !== this.generation || !this.wanted()) {
          void lock.release().catch(() => {});
          return;
        }
        this.lock = lock;
        this.listener = () => {
          if (this.lock === lock) {
            this.lock = undefined;
            lock.removeEventListener('release', this.listener!);
            this.listener = undefined;
            if (!this.disposed) this.onStatus('released');
          }
        };
        lock.addEventListener('release', this.listener);
        this.onStatus('active');
      })
      .catch(() => {
        if (!this.disposed && generation === this.generation)
          this.onStatus('unavailable');
      })
      .finally(() => {
        this.pending = false;
        if (!this.disposed && generation !== this.generation && this.wanted())
          this.sync();
      });
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    clearTimeout(this.timer);
    this.release();
  }
}
