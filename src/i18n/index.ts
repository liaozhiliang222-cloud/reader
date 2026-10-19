import { computed, signal } from '@preact/signals';
import { en } from './en';

export type LanguagePreference = 'system' | 'zh-Hans' | 'en';
export type UiLanguage = Exclude<LanguagePreference, 'system'>;
const storageKey = 'weiguang.ui.language';
export function validLanguage(value: unknown): value is LanguagePreference {
  return value === 'system' || value === 'zh-Hans' || value === 'en';
}
export function resolveLanguage(languages: readonly string[]): UiLanguage {
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) return 'zh-Hans';
    if (/^en(?:-|$)/i.test(language)) return 'en';
  }
  return 'en';
}
function storedLanguage(): LanguagePreference {
  try {
    const value = localStorage.getItem(storageKey);
    return validLanguage(value) ? value : 'system';
  } catch {
    return 'system';
  }
}
// Workers receive the UI language before their first RPC. Node-only callers keep
// the original Chinese errors until a language is explicitly supplied.
const systemLanguage = signal<UiLanguage>(
  typeof document === 'undefined'
    ? 'zh-Hans'
    : resolveLanguage(navigator.languages ?? [navigator.language]),
);
export const languagePreference = signal<LanguagePreference>(storedLanguage());
export const uiLanguage = computed<UiLanguage>(() =>
  languagePreference.value === 'system'
    ? systemLanguage.value
    : languagePreference.value,
);
export const uiLocale = computed(() =>
  uiLanguage.value === 'zh-Hans' ? 'zh-CN' : 'en-US',
);
export function setLanguagePreference(value: LanguagePreference) {
  localStorage.setItem(storageKey, value);
  languagePreference.value = value;
}
export function resetLanguagePreference() {
  localStorage.removeItem(storageKey);
  languagePreference.value = 'system';
}
export function setWorkerLanguage(value: UiLanguage) {
  languagePreference.value = value;
}
export function translate(
  language: UiLanguage,
  message: string,
  ...values: readonly (string | number | undefined)[]
): string {
  const template = language === 'en' ? (en[message] ?? message) : message;
  // Single-pass interpolation keeps braces in user text intact.
  return template.replace(/\{(\d+)\}/g, (match, index: string) =>
    Number(index) < values.length ? String(values[Number(index)]) : match,
  );
}
export const t = (
  message: string,
  ...values: readonly (string | number | undefined)[]
) => translate(uiLanguage.value, message, ...values);

export function startLanguage() {
  window.addEventListener('languagechange', () => {
    systemLanguage.value = resolveLanguage(
      navigator.languages ?? [navigator.language],
    );
  });
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey || event.key === null)
      languagePreference.value = storedLanguage();
  });
}
