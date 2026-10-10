/** Worker 启动/消息失败必须结束等待；Comlink 本身不会拒绝悬空 RPC。 */
export function runWorkerTask<T>(
  worker: Worker,
  task: () => Promise<T>,
  timeoutMs = 120_000,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener('error', failed);
      worker.removeEventListener('messageerror', failed);
      signal?.removeEventListener('abort', aborted);
      if (error) reject(error);
      else resolve(value as T);
    };
    const failed = () =>
      finish(new Error('解析线程未能运行，请重新导入文件。'));
    const aborted = () =>
      finish(new DOMException('已取消解析。', 'AbortError'));
    const timer = setTimeout(
      () => finish(new Error('解析超时，请拆分文件后重试。')),
      timeoutMs,
    );
    worker.addEventListener('error', failed);
    worker.addEventListener('messageerror', failed);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) {
      aborted();
      return;
    }
    Promise.resolve()
      .then(() => (settled ? undefined : task()))
      .then(
        (value) => finish(undefined, value),
        (cause) =>
          finish(cause instanceof Error ? cause : new Error(String(cause))),
      );
  });
}
