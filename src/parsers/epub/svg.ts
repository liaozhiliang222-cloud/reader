import { t } from '@/i18n';
import { localName, parseXml, resolvePath, type XmlElement } from './xml';
import type { SafeElement } from './sanitize';

const namespace = 'http://www.w3.org/2000/svg';
const tags = new Map(
  'svg g defs path rect circle ellipse line polyline polygon text tspan title desc linearGradient radialGradient stop clipPath marker'
    .split(' ')
    .map((tag) => [tag.toLowerCase(), tag]),
);
const visible = new Set(
  'path rect circle ellipse line polyline polygon text'.split(' '),
);
const lengths = new Set(
  'x y x1 y1 x2 y2 dx dy width height rx ry cx cy r refX refY markerWidth markerHeight stroke-width font-size textLength'
    .toLowerCase()
    .split(' '),
);
const numbers = new Set(
  'opacity fill-opacity stroke-opacity stop-opacity stroke-miterlimit offset'.split(
    ' ',
  ),
);
const paints = new Set('fill stroke stop-color'.split(' '));
const references = new Set(
  'clip-path marker-start marker-mid marker-end'.split(' '),
);
const choices = new Map<string, readonly string[]>(
  Object.entries({
    'fill-rule': ['nonzero', 'evenodd'],
    'clip-rule': ['nonzero', 'evenodd'],
    'stroke-linecap': ['butt', 'round', 'square'],
    'stroke-linejoin': ['miter', 'round', 'bevel'],
    'text-anchor': ['start', 'middle', 'end'],
    'font-style': ['normal', 'italic', 'oblique'],
    'font-weight': [
      'normal',
      'bold',
      '100',
      '200',
      '300',
      '400',
      '500',
      '600',
      '700',
      '800',
      '900',
    ],
    'dominant-baseline': ['auto', 'middle', 'central', 'hanging', 'alphabetic'],
    gradientunits: ['userSpaceOnUse', 'objectBoundingBox'],
    clippathunits: ['userSpaceOnUse', 'objectBoundingBox'],
    markerunits: ['strokeWidth', 'userSpaceOnUse'],
    spreadmethod: ['pad', 'reflect', 'repeat'],
  }),
);
const canonical = new Map(
  'viewBox preserveAspectRatio gradientUnits gradientTransform clipPathUnits markerUnits markerWidth markerHeight refX refY spreadMethod textLength'
    .split(' ')
    .map((name) => [name.toLowerCase(), name]),
);
const escaped = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[char]!,
  );
const numeric = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
const length = new RegExp(`^${numeric}(?:px|pt|pc|mm|cm|in|em|ex|%)?$`, 'i');
const number = new RegExp(`^${numeric}%?$`, 'i');
const list = new RegExp(`^${numeric}(?:[ ,]+${numeric})*$`, 'i');
const fragment = /^url\(#[A-Za-z_][\w.-]*\)$/;
function safeValue(name: string, value: string): string | undefined {
  const v = value.trim();
  if (!v || v.length > 1024 * 1024) return;
  if (lengths.has(name)) {
    if (length.test(v) && Math.abs(parseFloat(v)) <= 1_000_000) return v;
  } else if (numbers.has(name)) {
    if (number.test(v) && Math.abs(parseFloat(v)) <= 1_000_000) return v;
  } else if (paints.has(name)) {
    if (
      /^(?:[a-z]+|#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/i.test(v) ||
      fragment.test(v)
    )
      return v;
  } else if (references.has(name)) {
    if (v === 'none' || fragment.test(v)) return v;
  } else if (choices.get(name)?.includes(v)) return v;
  else if (name === 'id') {
    if (/^[A-Za-z_][\w.-]*$/.test(v)) return v;
  } else if (name === 'viewbox') {
    if (
      list.test(v) &&
      v.split(/[ ,]+/).length === 4 &&
      v.split(/[ ,]+/).every((n) => Math.abs(Number(n)) <= 1_000_000)
    )
      return v;
  } else if (name === 'points' || name === 'stroke-dasharray') {
    if (list.test(v) || (name === 'stroke-dasharray' && v === 'none')) return v;
  } else if (name === 'd') {
    if (/^[MmZzLlHhVvCcSsQqTtAaEe\d+.,\s-]+$/.test(v)) return v;
  } else if (name === 'transform' || name === 'gradienttransform') {
    if (
      /^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\([\dEe+.,\s-]+\)\s*)+$/.test(
        v,
      )
    )
      return v;
  } else if (name === 'preserveaspectratio') {
    if (
      /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(
        v,
      )
    )
      return v;
  } else if (name === 'orient') {
    if (v === 'auto' || number.test(v)) return v;
  }
}
function declarations(source: string) {
  const result = new Map<string, string>();
  for (const declaration of source.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    // CSS can set presentation only, never identifiers or geometry/reference URLs.
    if (!(
      paints.has(name) ||
      numbers.has(name) ||
      choices.has(name) ||
      references.has(name) ||
      ['stroke-width', 'font-size', 'stroke-dasharray'].includes(name)
    ))
      continue;
    const value = safeValue(name, declaration.slice(colon + 1));
    if (value !== undefined) result.set(name, value);
  }
  return result;
}

/** A deliberately small, static SVG subset, always rendered through an img Blob.
 * Rebuilds XML; no original scripts, CSS, URLs, namespaces or foreign nodes survive.
 * Simple class/ID/tag presentation rules become attributes; font services are dropped.
 */
export function sanitizeSvg(source: string | XmlElement): string | undefined {
  if (typeof source === 'string' && source.length > 1024 * 1024)
    throw new Error(t('SVG 图片超过安全处理范围。'));
  const root =
    typeof source === 'string' ? parseXml(source).documentElement : source;
  if (
    !root ||
    localName(root) !== 'svg' ||
    (root.namespaceURI && root.namespaceURI !== namespace)
  )
    return;
  const nodes = [root, ...Array.from(root.getElementsByTagName('*'))];
  if (nodes.length > 20000)
    throw new Error(t('SVG 图片节点超过安全处理范围。'));
  const ids = new Map(
    nodes
      .filter((node) => node.getAttribute('id'))
      .map((node) => [node.getAttribute('id')!, node]),
  );
  const rules: {
    selector: string;
    values: Map<string, string>;
    specificity: number;
    order: number;
  }[] = [];
  let order = 0;
  for (const style of nodes.filter(
    (node) =>
      localName(node) === 'style' &&
      (!node.namespaceURI || node.namespaceURI === namespace),
  )) {
    for (const match of (style.textContent ?? '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const values = declarations(match[2]!);
      for (const selector of match[1]!.split(',').map((s) => s.trim())) {
        if (!/^[.#]?[A-Za-z_][\w-]*$/.test(selector)) continue;
        if (rules.length >= 1024)
          throw new Error(t('SVG 图片样式超过安全处理范围。'));
        rules.push({
          selector,
          values,
          specificity: selector[0] === '#' ? 2 : selector[0] === '.' ? 1 : 0,
          order: order++,
        });
      }
    }
  }
  rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
  let count = 0,
    drawn = false;
  const clean = (
    el: XmlElement,
    depth: number,
    visiting: ReadonlySet<XmlElement>,
  ): string => {
    if (++count > 20000 || depth > 64)
      throw new Error(t('SVG 图片结构超过安全处理范围。'));
    if ((el.namespaceURI && el.namespaceURI !== namespace) || visiting.has(el))
      return '';
    const name = localName(el),
      tag = tags.get(name);
    if (name === 'use') {
      const href =
        el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
      const target = /^#[A-Za-z_][\w.-]*$/.test(href)
        ? ids.get(href.slice(1))
        : undefined;
      if (!target) return '';
      const next = new Set(visiting);
      next.add(el);
      const x = el.getAttribute('x') ?? '0',
        y = el.getAttribute('y') ?? '0';
      const translated =
        number.test(x) && number.test(y)
          ? `translate(${parseFloat(x)} ${parseFloat(y)})`
          : '';
      const transform =
        safeValue('transform', el.getAttribute('transform') ?? '') ?? '';
      return `<g transform="${escaped(`${translated} ${transform}`.trim())}">${clean(target, depth + 1, next)}</g>`;
    }
    if (!tag) return '';
    const next = new Set(visiting);
    next.add(el);
    const attributes = new Map<string, string>();
    for (const attribute of Array.from(el.attributes)) {
      const key = attribute.name.toLowerCase();
      const value = safeValue(key, attribute.value);
      if (value !== undefined) attributes.set(key, value);
    }
    for (const rule of rules) {
      const selector = rule.selector;
      const matches =
        selector[0] === '.'
          ? (el.getAttribute('class') ?? '')
              .split(/\s+/)
              .includes(selector.slice(1))
          : selector[0] === '#'
            ? el.getAttribute('id') === selector.slice(1)
            : name === selector.toLowerCase();
      if (matches)
        for (const [key, value] of rule.values) attributes.set(key, value);
    }
    for (const [key, value] of declarations(el.getAttribute('style') ?? ''))
      attributes.set(key, value);
    let content = '';
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 1)
        content += clean(child as XmlElement, depth + 1, next);
      else if (
        (child.nodeType === 3 || child.nodeType === 4) &&
        ['text', 'tspan', 'title', 'desc'].includes(name)
      )
        content += escaped(child.nodeValue ?? '');
    }
    if (visible.has(name)) drawn = true;
    const attrs = [...attributes]
      .map(
        ([key, value]) => ` ${canonical.get(key) ?? key}="${escaped(value)}"`,
      )
      .join('');
    return `<${tag}${el === root ? ` xmlns="${namespace}"` : ''}${attrs}>${content}</${tag}>`;
  };
  const output = clean(root, 0, new Set());
  if (output.length > 1024 * 1024)
    throw new Error(t('SVG 图片超过安全处理范围。'));
  return drawn ? output : undefined;
}

/** Common raster-only SVG covers degrade to ordinary local images. */
export function svgLocalImages(
  root: XmlElement,
  path: string,
  images: ReadonlyMap<string, string>,
): SafeElement[] {
  const result: SafeElement[] = [];
  let count = 0;
  const visit = (el: XmlElement, depth: number) => {
    if (++count > 20000 || depth > 64)
      throw new Error(t('SVG 图片结构超过安全处理范围。'));
    if (el.namespaceURI && el.namespaceURI !== namespace) return;
    const tag = localName(el);
    if (tag === 'image') {
      try {
        const href =
          el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
        const imageId = images.get(resolvePath(path, href).path);
        if (imageId)
          result.push({ tag: 'img', children: [], imageId, alt: '' });
      } catch {
        /* External/invalid paths are discarded. */
      }
    } else if (['svg', 'g', 'a'].includes(tag)) {
      for (const node of Array.from(el.childNodes))
        if (node.nodeType === 1) visit(node as XmlElement, depth + 1);
    }
  };
  visit(root, 0);
  return result;
}
