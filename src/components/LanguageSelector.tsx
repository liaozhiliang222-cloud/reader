import { useState } from 'preact/hooks';
import {
  languagePreference,
  setLanguagePreference,
  validLanguage,
  t,
} from '@/i18n';

export function LanguageSelector({ disabled = false }: { disabled?: boolean }) {
  const [error, setError] = useState(false);
  return (
    <div class="language-selector">
      <label class="speech-field">
        {t('界面语言')}
        <select
          value={languagePreference.value}
          disabled={disabled}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (!validLanguage(value)) return;
            try {
              setLanguagePreference(value);
              setError(false);
            } catch {
              setError(true);
            }
          }}
        >
          <option value="system">{t('跟随系统')}</option>
          <option value="zh-Hans" lang="zh-Hans">
            简体中文
          </option>
          <option value="en" lang="en">
            English
          </option>
        </select>
      </label>
      {error && <p role="alert">{t('无法保存语言设置，请检查本地存储。')}</p>}
    </div>
  );
}
