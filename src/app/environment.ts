export function detectEnvironment(userAgent: string, maxTouchPoints = 0) {
  const ios =
    /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  const version = ios
    ? (/(?:CPU(?: iPhone)? OS|iPhone OS) (\d+)[_.](\d+)/.exec(userAgent) ??
      /Version\/(\d+)\.(\d+)/.exec(userAgent))
    : null;
  const major = Number(version?.[1]),
    minor = Number(version?.[2]);
  return {
    ios,
    inApp: /MicroMessenger/i.test(userAgent)
      ? '微信'
      : /\bQQ\/[\d.]+/i.test(userAgent)
        ? 'QQ'
        : undefined,
    olderIos: !!version && (major < 16 || (major === 16 && minor < 4)),
  };
}
export function environment() {
  return detectEnvironment(navigator.userAgent, navigator.maxTouchPoints);
}
