"""生成自编文本的编码样本。仅开发时运行，不是应用依赖。"""

from pathlib import Path

target = Path(__file__).resolve().parent
story = "第一章 静夜\r\n" + "窗外的风轻轻吹过，桌上的书翻开了新的一页。读书的人停下脚步，把这一刻留给自己。\r\n" * 8
samples = {
    "utf8": (story, "utf-8"),
    "utf8-bom": (story, "utf-8-sig"),
    "gbk": (story, "gbk"),
    "gb18030": (story + "补充字符：𠀀\n", "gb18030"),
    "utf16-le": (story, "utf-16-le"),
    "utf16-be": (story, "utf-16-be"),
    "utf16-le-no-bom": ("Chapter 1\n静夜 ABC 123\n", "utf-16-le"),
    "utf16-be-no-bom": ("Chapter 1\n静夜 ABC 123\n", "utf-16-be"),
    "big5-ambiguous": ("中文閱讀", "big5"),
}
for name, (text, encoding) in samples.items():
    content = text.encode(encoding)
    if name == "utf16-le":
        content = b"\xff\xfe" + content
    elif name == "utf16-be":
        content = b"\xfe\xff" + content
    (target / (name + ".bin")).write_bytes(content)
    (target / (name + ".expected.txt")).write_bytes(text.encode("utf-8"))

# 计划 P-03 的本地素材；只生成本任务需要的编码文件。
local = target.parents[3] / "test-books"
local.mkdir(exist_ok=True)
for name in samples:
    (local / (name + ".txt")).write_bytes((target / (name + ".bin")).read_bytes())
