/** Visual math/diagrams never contribute to persisted UTF-16 text positions. */
export function canonicalWalker(root: Node) {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('[data-md-visual]')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
}
export function canonicalText(root: Node): string {
  const walker = canonicalWalker(root);
  let text = '';
  while (walker.nextNode()) text += walker.currentNode.textContent ?? '';
  return text;
}
export const rangeText = (range: Range) => canonicalText(range.cloneContents());
