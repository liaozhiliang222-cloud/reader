import DOMPurify from 'dompurify';

let serial: Promise<unknown> = Promise.resolve();
let counter = 0;
// Reject resource/config/interaction syntax BEFORE Mermaid sees untrusted text.
// Rendering never accepts user CSS, HTML labels, images, icons, links or themes.
export function allowedDiagram(source: string) {
  return (
    source.length <= 10_000 &&
    source.split(/[\n;]/).length <= 200 &&
    /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|gitGraph|mindmap|timeline)\b/.test(
      source.trimStart(),
    ) &&
    !/https?:|data:|javascript:|file:|<\/?[a-z!]|@\{|%%\{|^---|\b(?:click|classDef|linkStyle|style)\s|url\s*\(/im.test(
      source,
    )
  );
}
export async function renderDiagram(
  source: string,
): Promise<string | undefined> {
  if (!allowedDiagram(source)) return;
  const job = serial.then(async () => {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      maxTextSize: 10_000,
      maxEdges: 100,
      layout: 'dagre',
      theme: 'neutral',
      fontFamily: 'system-ui',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      secure: [
        'secure',
        'securityLevel',
        'startOnLoad',
        'maxTextSize',
        'maxEdges',
        'theme',
        'themeCSS',
        'fontFamily',
        'htmlLabels',
        'layout',
      ],
    });
    const stage = document.createElement('div');
    stage.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;width:900px;left:-10000px';
    document.body.append(stage);
    try {
      const { svg } = await mermaid.render(
        'jingyeDiagram' + ++counter,
        source,
        stage,
      );
      const cleaned = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: [
          'foreignObject',
          'a',
          'image',
          'script',
          'animate',
          'set',
        ],
        FORBID_ATTR: ['href', 'xlink:href'],
      });
      if (
        !cleaned.includes('<svg') ||
        /url\(\s*["']?(?!#)|https?:\/\/(?!www\.w3\.org)/i.test(cleaned)
      )
        return;
      return cleaned;
    } catch {
      return;
    } finally {
      stage.remove();
    }
  });
  serial = job.catch(() => {});
  return job;
}
