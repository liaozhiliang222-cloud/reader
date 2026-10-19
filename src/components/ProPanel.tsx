import { useEffect, useState } from 'preact/hooks';
import { Modal } from './Modal';
import { proRequest, proState } from '@/app/pro';

export function ProPanel({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const state = proState.value;
  const run = async (action: 'state' | 'product' | 'purchase' | 'restore') => {
    setBusy(true);
    try {
      await proRequest(action);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void run('state');
  }, []);
  return (
    <Modal
      title="微光阅读 Pro"
      onDismiss={() => {
        if (!busy) onClose();
      }}
    >
      <h2>微光阅读 Pro</h2>
      <p>
        一次购买，解锁本版的本地听书、笔记整理与摘录图片。核心阅读、书签笔记、基础导出和备份继续免费。
      </p>
      <p>
        购买和恢复由 Apple
        处理，需要联网；本机已验证的权益可离线使用。不收集阅读内容，不创建微光阅读账号。
      </p>
      <p>
        本版本仍需完成 iPhone 与 StoreKit 验收。测试配置中的价格仅用于本地测试。
      </p>
      {state.isPro ? (
        <p role="status">Pro 已解锁</p>
      ) : (
        <p role="status">
          {state.status === 'pending' ? '等待购买批准' : '尚未解锁 Pro'}
        </p>
      )}
      <div class="panel-actions">
        {!state.isPro &&
          (state.price ? (
            <button disabled={busy} onClick={() => void run('purchase')}>
              一次购买 · {state.price}
            </button>
          ) : (
            <button disabled={busy} onClick={() => void run('product')}>
              查看购买价格
            </button>
          ))}
        <button disabled={busy} onClick={() => void run('restore')}>
          恢复购买
        </button>
        <button disabled={busy} onClick={onClose}>
          关闭
        </button>
      </div>
      {state.message && <p role="status">{state.message}</p>}
    </Modal>
  );
}
