import { expect, it } from 'vitest';
import { compatibilityCases, compatibilityEpub } from './compatFixtures';
import { parseEpub } from './parse';
it.each(compatibilityCases)(
  '自编兼容样本：$name，正文、目标锚点及目录有效',
  async ({ name, body }) => {
    const result = await parseEpub(await compatibilityEpub(body, name), 'test');
    const chapter = result.chapters[0]!;
    expect(result.parserVersion).toBe(3);
    expect(chapter.paragraphs.join('')).not.toBe('');
    expect(chapter.anchors.target).toBeTypeOf('number');
    expect(result.toc[0]?.paragraphIndex).toBe(chapter.anchors.target);
    expect(chapter.paragraphs[chapter.anchors.target!]).toBeDefined();
    expect(JSON.stringify(chapter.nodes)).not.toMatch(/onclick|https:|bad\(\)/);
  },
);
