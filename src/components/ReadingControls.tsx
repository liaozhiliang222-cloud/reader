import { t } from '@/i18n';
import { useId } from 'preact/hooks';
import type { ReadingSettings } from '@/types';
import { lightTheme } from '@/app/themePreference';
import { fontState } from '@/app/optionalFont';
import { isAndroidApp } from '@/app/platform';

type Option<T> = { value: T; label: string; disabled?: boolean };

/** 单选分段控件：一排可直接点选的选项，替代下拉框。 */
function Segmented<T extends string | number>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset class="segmented">
      <legend>{legend}</legend>
      <div class="segmented-options">
        {options.map((option) => (
          <label key={String(option.value)} data-disabled={option.disabled}>
            <input
              type="radio"
              name={name}
              value={String(option.value)}
              checked={option.value === value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const sizes = { min: 14, max: 28 };
const themes = [
  { value: 'paper', label: '米白纸' },
  { value: 'eink', label: '浅灰纸' },
  { value: 'green', label: '护眼绿' },
  { value: 'night', label: '墨黑夜读' },
] as const;

export function ReadingControls({
  value,
  onChange,
  followSystemTheme = false,
}: {
  value: ReadingSettings;
  onChange: (patch: Partial<ReadingSettings>) => void;
  followSystemTheme?: boolean;
}) {
  const themeName = useId();
  const themeValue = followSystemTheme ? lightTheme(value) : value.theme;
  const setSize = (size: number) =>
    onChange({ fontSize: Math.max(sizes.min, Math.min(sizes.max, size)) });
  return (
    <div class="reading-controls">
      <div class="font-size-row" role="group" aria-label={t('字号')}>
        <span class="control-label">{t('字号')}</span>
        <button
          class="stepper"
          aria-label={t('减小字号')}
          disabled={value.fontSize <= sizes.min}
          onClick={() => setSize(value.fontSize - 1)}
        >
          A−
        </button>
        <output aria-live="polite" aria-label={t('当前字号')}>
          {value.fontSize}
        </output>
        <button
          class="stepper stepper-large"
          aria-label={t('增大字号')}
          disabled={value.fontSize >= sizes.max}
          onClick={() => setSize(value.fontSize + 1)}
        >
          A+
        </button>
      </div>
      <fieldset class="theme-swatches">
        <legend>{followSystemTheme ? t('浅色主题') : t('主题')}</legend>
        <div class="segmented-options">
          {themes
            .filter((theme) => !followSystemTheme || theme.value !== 'night')
            .map((theme) => (
              <label key={theme.value} data-swatch={theme.value}>
                <input
                  type="radio"
                  name={themeName}
                  value={theme.value}
                  checked={themeValue === theme.value}
                  onChange={() => onChange({ theme: theme.value })}
                />
                <span class="swatch" aria-hidden="true" />
                <span>{t(theme.label)}</span>
              </label>
            ))}
        </div>
      </fieldset>
      {followSystemTheme && (
        <p class="tap-mode-help">
          {t('已跟随系统深色；系统浅色时使用所选纸张。')}
        </p>
      )}
      <Segmented
        legend={t('字体')}
        value={value.fontFamily}
        onChange={(fontFamily) => onChange({ fontFamily })}
        options={[
          { value: 'serif', label: t('衬线') },
          { value: 'sans', label: t('无衬线') },
          {
            value: 'wenkai',
            label:
              fontState.value.phase === 'ready'
                ? t('文楷')
                : t('文楷（需下载）'),
            disabled: fontState.value.phase !== 'ready',
          },
        ]}
      />
      <Segmented
        legend={t('行距')}
        value={value.lineHeight}
        onChange={(lineHeight) => onChange({ lineHeight })}
        options={[1.4, 1.6, 1.8, 2, 2.2].map((n) => ({
          value: n,
          label: String(n),
        }))}
      />
      <Segmented
        legend={t('段距')}
        value={value.paragraphSpacing}
        onChange={(paragraphSpacing) => onChange({ paragraphSpacing })}
        options={[
          { value: 0, label: t('无') },
          { value: 0.5, label: t('小') },
          { value: 1, label: t('大') },
        ]}
      />
      <Segmented
        legend={t('页边距')}
        value={value.margin}
        onChange={(margin) => onChange({ margin })}
        options={[
          { value: 'narrow', label: t('窄') },
          { value: 'medium', label: t('中') },
          { value: 'wide', label: t('宽') },
        ]}
      />
      <Segmented
        legend={t('对齐')}
        value={value.align}
        onChange={(align) => onChange({ align })}
        options={[
          { value: 'justify', label: t('两端对齐') },
          { value: 'left', label: t('左对齐') },
        ]}
      />
      <Segmented
        legend={t('翻页动效')}
        value={value.pageAnimation}
        onChange={(pageAnimation) => onChange({ pageAnimation })}
        options={[
          { value: 'none', label: t('无') },
          { value: 'fade', label: t('淡入') },
          { value: 'slide', label: t('平移') },
        ]}
      />
      <Segmented
        legend={t('点按模式')}
        value={value.tapMode}
        onChange={(tapMode) => onChange({ tapMode })}
        options={[
          { value: 'normal', label: t('左右翻页') },
          { value: 'oneHand', label: t('单手模式') },
        ]}
      />
      {value.tapMode === 'oneHand' && (
        <p class="tap-mode-help">
          {t(
            '两侧点按下一页，左上角返回上一页，中间打开菜单；滑动方向保持不变。',
          )}
        </p>
      )}
      {isAndroidApp && (
        <Segmented
          legend={t('音量键翻页')}
          value={value.volumeKeys ? 'on' : 'off'}
          onChange={(v) => onChange({ volumeKeys: v === 'on' })}
          options={[
            { value: 'off', label: t('关') },
            { value: 'on', label: t('开') },
          ]}
        />
      )}
      {isAndroidApp && value.volumeKeys && (
        <p class="tap-mode-help">
          {t(
            '阅读页中音量下键下一页、上键上一页；菜单和浮层打开时音量键照常调节音量。',
          )}
        </p>
      )}
      <Segmented
        legend={t('阅读时常亮')}
        value={value.wakeLock}
        onChange={(wakeLock) => onChange({ wakeLock })}
        options={[
          { value: 'off', label: t('关') },
          { value: 'idle5m', label: t('5 分钟无操作') },
          { value: 'always', label: t('始终') },
        ]}
      />
      <div class="toggle-rows">
        <label>
          {t('首行缩进')}
          <input
            type="checkbox"
            checked={value.indent}
            onChange={(e) => onChange({ indent: e.currentTarget.checked })}
          />
        </label>
        <label>
          {t('页眉与页码')}
          <input
            type="checkbox"
            checked={value.showHeaderFooter}
            onChange={(e) =>
              onChange({ showHeaderFooter: e.currentTarget.checked })
            }
          />
        </label>
        <label>
          {t('纸张纹理')}
          <input
            type="checkbox"
            checked={value.texture}
            onChange={(e) => onChange({ texture: e.currentTarget.checked })}
          />
        </label>
      </div>
    </div>
  );
}
