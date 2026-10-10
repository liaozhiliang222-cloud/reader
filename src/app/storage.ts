export async function requestPersistence(): Promise<boolean | undefined> {
  try {
    return await navigator.storage?.persist?.();
  } catch {
    return undefined;
  }
}
export async function storageInfo() {
  const [estimate, persisted] = await Promise.all([
    navigator.storage?.estimate?.(),
    navigator.storage?.persisted?.(),
  ]);
  return { usage: estimate?.usage, quota: estimate?.quota, persisted };
}
