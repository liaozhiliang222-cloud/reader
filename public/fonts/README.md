# 可选网页字体

`wenkai-gb2312-v1.522.woff2` 来自官方霞鹜文楷Regular1.522。GB2312、拉丁字符与标点子集含7707个Unicode映射，未覆盖字符使用系统字体。原版权与完整OFL1.1见 `OFL.txt`。

- 来源：[霞鹜文楷1.522](https://github.com/lxgw/LxgwWenKai/releases/tag/v1.522)
- 原TTF SHA256：`39ad71264b588165b469e35e6afb162a378dacd1f95348160240ba9038ac3009`
- 本文件：1600452字节（1.53MiB）；SHA256 `ba09ef107a2c01bfe6b7e562bd17c90bf4152b660cab3aacb07f2ee76f16a35b`
- 内部主名称改为 `Jingye Wenkai Web Subset`，显示“静页文楷”；保留版权/许可元数据，来源说明用于致谢。未混合其他字体，未作为可安装桌面字体提供。

复现：下载官方 `LXGWWenKai-Regular.ttf` 到已忽略的 `test-books/font-sources/LXGWWenKai-Regular-v1.522.ttf`。运行 `python -m pip install --target .font-tools -r scripts/font-requirements.txt`，再运行 `python scripts/subset-font.py`。脚本验证原SHA，生成WOFF2和 `src/app/fontAsset.json`。FontTools4.63.0/Brotli1.2.0仅开发使用，运行包贡献0。

字体不在默认预缓存，无URL形式的CSS字体声明。用户点击才下载同源文件，大小/SHA核对后存入作用域Cache，随后从缓存字节创建FontFace。不联网补字，备份不包含字体。许可文本随应用离线缓存。
