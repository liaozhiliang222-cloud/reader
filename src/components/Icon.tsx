const paths = {
  back: 'M15 5l-7 7 7 7',
  previous: 'M14 6l-6 6 6 6',
  next: 'M10 6l6 6-6 6',
  bookmark: 'M7 4h10v16l-5-4-5 4z',
  contents: 'M5 7h14M5 12h14M5 17h9',
  type: 'M4 18l5-12 5 12M6 14h6M15 18v-6a3 3 0 0 1 6 0v6M15 15h6',
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  exitFullscreen: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  done: 'M5 12l5 5 9-10',
} as const;
export type IconName = keyof typeof paths;

/** 线性图标：1.5px 描边、无填充，颜色继承文字。 */
export function Icon({ name, filled }: { name: IconName; filled?: boolean }) {
  return (
    <svg
      class="icon"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={paths[name]}
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        stroke-width={name === 'more' ? 3 : 1.5}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
