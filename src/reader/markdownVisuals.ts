import katex from 'katex';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import type { SafeElement } from '@/parsers/epub/sanitize';
import { canonicalText } from './text';

for (const [name, language] of Object.entries({
  javascript,
  typescript,
  python,
  json,
  css,
  xml,
  bash,
  sql,
}))
  hljs.registerLanguage(name, language);
const aliases: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  html: 'xml',
  sh: 'bash',
  shell: 'bash',
  py: 'python',
};

export async function enhanceMarkdown(
  el: HTMLElement,
  node: SafeElement,
): Promise<string | undefined> {
  if (node.math !== undefined && node.math.length <= 4000) {
    if (/\\(?:includegraphics|href|url|html\w*)\b/.test(node.math)) return;
    try {
      const markup = katex.renderToString(node.math, {
        output: 'mathml',
        displayMode: !!node.displayMath,
        trust: false,
        throwOnError: true,
        maxExpand: 200,
        maxSize: 10,
        strict: 'error',
      });
      const template = document.createElement('template');
      template.innerHTML = DOMPurify.sanitize(markup, {
        USE_PROFILES: { mathMl: true },
        FORBID_TAGS: ['annotation', 'annotation-xml'],
        FORBID_ATTR: ['href', 'style'],
      });
      for (const annotation of template.content.querySelectorAll(
        'annotation, annotation-xml',
      ))
        annotation.remove();
      if (!template.content.querySelector('math')) return;
      const visual = document.createElement('span');
      visual.dataset.mdVisual = 'math';
      visual.append(template.content);
      replaceWithVisual(el, visual, node.displayMath ? 'block-math' : 'math');
    } catch {
      /* Unsupported or oversized formulas remain readable TeX. */
    }
  } else if (node.diagram !== undefined) {
    const { renderDiagram } = await import('./markdownDiagram');
    const svg = await renderDiagram(node.diagram);
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const visual = document.createElement('span');
    visual.dataset.mdVisual = 'diagram';
    const image = document.createElement('img');
    image.src = url;
    image.alt = 'Mermaid 图表';
    visual.append(image);
    replaceWithVisual(el, visual, 'diagram');
    return url;
  } else if (node.language && el.textContent!.length <= 50_000) {
    const language = aliases[node.language] ?? node.language;
    if (!hljs.getLanguage(language)) return;
    const text = el.textContent ?? '';
    const template = document.createElement('template');
    template.innerHTML = DOMPurify.sanitize(
      hljs.highlight(text, { language, ignoreIllegals: true }).value,
      { ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'] },
    );
    if (canonicalText(template.content) !== text) return;
    el.replaceChildren(template.content);
    el.dataset.mdLanguage = language;
  }
}
function replaceWithVisual(el: HTMLElement, visual: HTMLElement, kind: string) {
  const source = document.createElement('span');
  source.dataset.mdSource = '';
  source.append(...el.childNodes);
  el.dataset.mdAtom = kind;
  el.append(source, visual);
}
