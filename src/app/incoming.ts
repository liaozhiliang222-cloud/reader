import { signal } from '@preact/signals';
import { createIncomingClient } from '@/db/incomingClient';

export const incomingRevision = signal(0);
export const incomingStore = () =>
  createIncomingClient(new URL(import.meta.env.BASE_URL, location.origin).href);
export const incomingChanged = () => {
  incomingRevision.value++;
};
