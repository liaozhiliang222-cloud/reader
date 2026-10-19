import { t } from '@/i18n';
import { signal } from '@preact/signals';
import { appendBounded, formatDebugValue } from './debug';

const entries = signal<string[]>([]);
let installed = false;

export function installDebugConsole() {
  if (installed) return;
  installed = true;
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      const line = `[${level}] ${args.map(formatDebugValue).join(' ')}`;
      entries.value = appendBounded(entries.value, line.slice(0, 2000), 100);
    };
  }
  window.addEventListener('error', (event) => console.error(event.message));
  window.addEventListener('unhandledrejection', (event) =>
    console.error(event.reason),
  );
}

export function DebugPanel() {
  return (
    <details class="debug-panel">
      <summary>
        {t('开发日志 ·')} {entries.value.length}
      </summary>
      <button
        onClick={() => {
          entries.value = [];
        }}
      >
        {t('清空日志')}
      </button>
      <pre>{entries.value.join('\n')}</pre>
    </details>
  );
}
