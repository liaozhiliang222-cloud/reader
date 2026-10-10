import { chromium, webkit } from '@playwright/test';

const url = 'https://jingye-reader.pages.dev/';
const envProxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
const proxyUrl = envProxy ? new URL(envProxy) : null;
const proxy = proxyUrl
  ? {
      server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`,
      ...(proxyUrl.username
        ? {
            username: decodeURIComponent(proxyUrl.username),
            password: decodeURIComponent(proxyUrl.password),
          }
        : {}),
    }
  : undefined;
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^(?:http|https|all|no)_proxy$/i.test(key),
  ),
);
for (const { name, engine, options } of [
  { name: 'chromium', engine: chromium, options: { proxy } },
  {
    name: 'webkit-explicit-proxy',
    engine: webkit,
    options: { proxy, env: cleanEnv },
  },
  { name: 'webkit-no-env-proxy', engine: webkit, options: { env: cleanEnv } },
]) {
  const context = await engine.launchPersistentContext('', {
    headless: true,
    ...options,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  context.on('requestfailed', (request) =>
    errors.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  try {
    await page.goto(url, { timeout: 15_000 });
    await page.getByRole('button', { name: '跳过引导' }).click();
    await page
      .waitForFunction(() => !!navigator.serviceWorker.controller, undefined, {
        timeout: 30_000,
      })
      .catch((error) => errors.push(error.message));
    console.log(
      JSON.stringify(
        {
          engine: name,
          explicitProxy: !!options.proxy,
          errors,
          state: await page.evaluate(async () => ({
            secure: window.isSecureContext,
            controller: navigator.serviceWorker.controller?.scriptURL,
            registrations: (
              await navigator.serviceWorker.getRegistrations()
            ).map((r) => ({
              scope: r.scope,
              installing: r.installing?.state,
              waiting: r.waiting?.state,
              active: r.active?.state,
            })),
            caches: await caches.keys(),
          })),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          engine: name,
          explicitProxy: !!options.proxy,
          errors,
          error: String(error),
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
}
