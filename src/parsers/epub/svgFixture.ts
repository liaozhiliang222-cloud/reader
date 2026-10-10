import JSZip from 'jszip';
import { compatibilityEpub } from './compatFixtures';
/** Original test content; never a replacement for actual publisher editions. */
export async function svgEpub(
  cover: Uint8Array = Uint8Array.of(137, 80, 78, 71),
) {
  const ns = 'xmlns="http://www.w3.org/2000/svg"';
  const zip = await JSZip.loadAsync(
    await compatibilityEpub(
      `<svg ${ns} xmlns:xlink="http://www.w3.org/1999/xlink" id="cover"><image xlink:href="cover.png"/></svg><p id="target">正文位置</p><p><img src="diagram.svg" alt="图解"/></p><svg ${ns}><circle cx="5" cy="5" r="4"/></svg>`,
    ),
  );
  zip.file(
    'OPS/book.opf',
    (await zip.file('OPS/book.opf')!.async('string')).replace(
      '</manifest>',
      '<item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/><item id="diagram" href="diagram.svg" media-type="image/svg+xml"/></manifest>',
    ),
  );
  zip.file('OPS/cover.png', cover);
  zip.file(
    'OPS/diagram.svg',
    `<svg ${ns} width="120" height="80" onload="bad()"><style>@font-face{src:url(https://svg-probe.invalid/font)}.box{fill:#456;stroke:black}</style><rect class="box" width="120" height="80"/><text x="10" y="40" fill="white">本地图解</text><script>bad()</script><image href="https://svg-probe.invalid/image"/><foreignObject><iframe src="https://svg-probe.invalid/frame"/></foreignObject><animate attributeName="href" to="https://svg-probe.invalid/animate"/></svg>`,
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}
