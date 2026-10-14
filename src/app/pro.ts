import { signal } from '@preact/signals';
import { registerPlugin } from '@capacitor/core';
import { isIosApp } from './platform';

export const PRO_PRODUCT_ID = 'dev.jingye.reader.pro';
export type ProStatus =
  'unknown' | 'free' | 'owned' | 'purchasing' | 'pending' | 'unverified';
export interface ProState {
  status: ProStatus;
  isPro: boolean;
  price?: string;
  message: string;
}
export function readProState(value: unknown): ProState {
  if (
    !value ||
    typeof value !== 'object' ||
    Reflect.get(value, 'protocolVersion') !== 1 ||
    Reflect.get(value, 'productId') !== PRO_PRODUCT_ID
  )
    throw new Error('购买状态无效，请重试。');
  const status: unknown = Reflect.get(value, 'status');
  const isPro: unknown = Reflect.get(value, 'isPro');
  const price: unknown = Reflect.get(value, 'price');
  const message: unknown = Reflect.get(value, 'message');
  if (
    ![
      'unknown',
      'free',
      'owned',
      'purchasing',
      'pending',
      'unverified',
    ].includes(String(status)) ||
    typeof isPro !== 'boolean' ||
    (isPro && status !== 'owned') ||
    (price !== undefined && typeof price !== 'string') ||
    typeof message !== 'string'
  )
    throw new Error('购买状态无效，请重试。');
  return { status: status as ProStatus, isPro, price, message };
}
interface Bridge {
  request(input: {
    action: 'state' | 'product' | 'purchase' | 'restore';
  }): Promise<unknown>;
  addListener(
    event: 'proChanged',
    listener: () => void,
  ): Promise<{ remove(): Promise<void> }>;
}
const plugin = registerPlugin<Bridge>('JyPro');
export const proState = signal<ProState>({
  status: 'unknown',
  isPro: false,
  message: '',
});
let watching = false;
export async function proRequest(
  action: 'state' | 'product' | 'purchase' | 'restore' = 'state',
) {
  if (!isIosApp) return;
  try {
    proState.value = readProState(await plugin.request({ action }));
  } catch (error) {
    proState.value = {
      ...proState.value,
      message: error instanceof Error ? error.message : '购买服务暂不可用。',
    };
  }
}
export async function connectPro() {
  if (!isIosApp) return;
  if (!watching) {
    watching = true;
    await plugin
      .addListener('proChanged', () => {
        void proRequest();
      })
      .catch(() => {
        watching = false;
      });
  }
  await proRequest();
}
export const canUsePro = () => !isIosApp || proState.value.isPro;
