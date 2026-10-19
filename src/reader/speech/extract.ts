import type { SafeElement, SafeNode } from '@/parsers/epub/sanitize';
import type { StoredChapter } from '@/types';

export interface TextRun {
  textStart: number;
  textEnd: number;
  sourceStart: number;
  sourceEnd: number;
}
export interface SpeechParagraph {
  paragraphIndex: number;
  text: string;
  runs: TextRun[];
}
export interface Extraction {
  paragraphs: SpeechParagraph[];
  skippedParagraphs: number;
  unmappedParagraphs: number;
}

const excluded = (node: SafeElement) =>
  !!node.speechSkip ||
  !!node.preformatted ||
  node.math !== undefined ||
  node.diagram !== undefined ||
  !!node.imageId ||
  ['pre', 'code', 'rt', 'rp', 'img', 'table', 'math', 'svg'].includes(
    node.tag,
  ) ||
  ['table', 'table-row', 'table-cell', 'image-placeholder'].includes(
    node.kind ?? '',
  );

/** Read canonical SafeNodes, never DOM/HTML. Offsets include all skipped source.
 * Unknown or inconsistent mappings are omitted instead of guessing an anchor. */
export function extractSpeech(chapter: StoredChapter): Extraction {
  if (!chapter.nodes) {
    return {
      paragraphs: chapter.paragraphs.map((text, paragraphIndex) => ({
        paragraphIndex,
        text,
        runs: [
          {
            textStart: 0,
            textEnd: text.length,
            sourceStart: 0,
            sourceEnd: text.length,
          },
        ],
      })),
      skippedParagraphs: 0,
      unmappedParagraphs: 0,
    };
  }
  const indexed = new Map<number, { node: SafeElement; blocked: boolean }>();
  const duplicate = new Set<number>();
  const walk = (nodes: SafeNode[], blocked = false) => {
    for (const node of nodes) {
      if (typeof node === 'string') continue;
      const skip = blocked || excluded(node);
      if (node.paragraphIndex !== undefined) {
        if (indexed.has(node.paragraphIndex))
          duplicate.add(node.paragraphIndex);
        indexed.set(node.paragraphIndex, { node, blocked: skip });
      } else walk(node.children, skip);
    }
  };
  walk(chapter.nodes);
  const result: Extraction = {
    paragraphs: [],
    skippedParagraphs: 0,
    unmappedParagraphs: 0,
  };
  for (const [paragraphIndex, original] of chapter.paragraphs.entries()) {
    const entry = indexed.get(paragraphIndex);
    if (!entry || duplicate.has(paragraphIndex)) {
      result.unmappedParagraphs++;
      continue;
    }
    if (entry.blocked) {
      result.skippedParagraphs++;
      continue;
    }
    let sourceOffset = 0;
    let originalText = '';
    let text = '';
    let gap = false;
    let nested = false;
    const runs: TextRun[] = [];
    const visit = (node: SafeNode, blocked: boolean) => {
      if (typeof node !== 'string') {
        if (node !== entry.node && node.paragraphIndex !== undefined)
          nested = true;
        for (const child of node.children)
          visit(child, blocked || excluded(node));
        return;
      }
      originalText += node;
      if (blocked) gap ||= node.length > 0;
      else if (node.length) {
        // Separating removed code/math prevents accidental joining of words.
        // This separator has no source mapping and never changes original offsets.
        if (gap && text && !/\s$/.test(text) && !/^\s/.test(node)) text += ' ';
        const previous = runs.at(-1);
        if (
          previous &&
          previous.textEnd === text.length &&
          previous.sourceEnd === sourceOffset
        ) {
          previous.textEnd += node.length;
          previous.sourceEnd += node.length;
        } else {
          runs.push({
            textStart: text.length,
            textEnd: text.length + node.length,
            sourceStart: sourceOffset,
            sourceEnd: sourceOffset + node.length,
          });
        }
        text += node;
        gap = false;
      }
      sourceOffset += node.length;
    };
    visit(entry.node, false);
    if (originalText !== original || nested) result.unmappedParagraphs++;
    else if (!text.trim()) result.skippedParagraphs++;
    else result.paragraphs.push({ paragraphIndex, text, runs });
  }
  return result;
}
