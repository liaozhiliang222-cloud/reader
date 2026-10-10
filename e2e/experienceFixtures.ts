import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test as base, expect } from './fixtures';

export const test = base.extend<{ experienceEvidence: void }>({
  experienceEvidence: [
    async ({ page, baseURL }, use, info) => {
      if (!baseURL) throw new Error('Missing test origin');
      const origin = new URL(baseURL).origin;
      const errors: string[] = [],
        external: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => {
        if (
          /^https?:/.test(request.url()) &&
          new URL(request.url()).origin !== origin
        )
          external.push(request.url());
      });
      const productionIndexSha256 = createHash('sha256')
        .update(await readFile('dist/index.html'))
        .digest('hex');
      await use();
      await info.attach('experience-evidence', {
        body: Buffer.from(
          JSON.stringify({
            productionIndexSha256,
            engine: info.project.name,
            origin,
            checkedAt: new Date().toISOString(),
            physicalDeviceAcceptance: false,
            errors,
            external,
          }),
        ),
        contentType: 'application/json',
      });
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect } from './fixtures';
