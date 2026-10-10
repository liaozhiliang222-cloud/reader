import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

// Deployment headers and the HTML fallback share this source of truth.
export const securityHeaders = readFileSync(
  new URL('../public/_headers', import.meta.url),
  'utf8',
);
export const contentSecurityPolicy = securityHeaders.match(
  /^ {2}Content-Security-Policy: (.+)$/m,
)![1]!;
export const metaPolicy = contentSecurityPolicy
  .split('; ')
  .filter((directive) => !directive.startsWith('frame-ancestors '))
  .join('; ');

export function productionSecurity(): Plugin {
  return {
    name: 'jingye-production-security',
    apply: (_config, environment) =>
      environment.command === 'build' || !!environment.isPreview,
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: metaPolicy,
          },
          injectTo: 'head-prepend',
        },
      ],
    },
    configurePreviewServer(server) {
      server.middlewares.use((_request, response, next) => {
        response.setHeader('Content-Security-Policy', contentSecurityPolicy);
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('X-Frame-Options', 'DENY');
        next();
      });
    },
  };
}
