"""Rebuild the optional web font; source TTF stays in ignored test-books/."""
from pathlib import Path
import hashlib
import json
import sys

sys.path.insert(0, str(Path('.font-tools').resolve()))
from fontTools import subset
from fontTools.ttLib import TTFont

source = Path('test-books/font-sources/LXGWWenKai-Regular-v1.522.ttf')
expected = '39ad71264b588165b469e35e6afb162a378dacd1f95348160240ba9038ac3009'
if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
    raise ValueError('Upstream TTF hash mismatch')
chars = set(range(0x20, 0x100)) | set(range(0x2000, 0x2070)) | set(range(0x3000, 0x3040)) | set(range(0xFF01, 0xFF60))
for first in range(0xA1, 0xF8):
    for second in range(0xA1, 0xFF):
        try:
            chars.update(ord(c) for c in bytes([first, second]).decode('gb2312'))
        except UnicodeDecodeError:
            pass
font = TTFont(source)
options = subset.Options()
options.name_IDs = ['*']
options.name_legacy = True
options.name_languages = ['*']
options.recalc_timestamp = False
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=chars)
subsetter.subset(font)
# A new primary name respects the upstream reserved font names. Copyright and
# OFL metadata stay intact; attribution remains in the UI and accompanying OFL.
names = {1: 'Jingye Wenkai Web Subset', 2: 'Regular', 3: 'Jingye-Wenkai-Web-Subset-1.522', 4: 'Jingye Wenkai Web Subset Regular', 6: 'JingyeWenkaiWebSubset-Regular', 16: 'Jingye Wenkai Web Subset', 17: 'Regular'}
for record in font['name'].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
font.flavor = 'woff2'
target = Path('public/fonts/wenkai-gb2312-v1.522.woff2')
font.save(target)
data = target.read_bytes()
metadata = {
    'file': 'fonts/' + target.name,
    'size': len(data),
    'sha256': hashlib.sha256(data).hexdigest(),
    'upstream': 'https://github.com/lxgw/LxgwWenKai/releases/tag/v1.522',
    'upstreamVersion': '1.522',
    'upstreamSha256': expected,
    'glyphCoverage': len(font.getBestCmap()),
}
Path('src/app/fontAsset.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(json.dumps(metadata))
