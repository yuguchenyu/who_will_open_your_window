# 字体文件与替代说明

本目录包含 10 个未修改的开源 OpenType 字体文件：Fandol 的宋体、黑体、楷体、仿宋四种风格，以及 TeX Gyre Termes 的常规、粗体、斜体、粗斜体。

`../font-settings.tex` 会优先检测本机原文字体；没有安装时，才使用本目录中的替代字体。

| 原 Word 字体 | 没有安装原字体时的替代 |
|---|---|
| 宋体 / SimSun | FandolSong-Regular、FandolSong-Bold |
| 黑体 / SimHei | FandolHei-Regular、FandolHei-Bold |
| 楷体 / KaiTi / KaiTi_GB2312 | FandolKai-Regular |
| 仿宋 / FangSong | FandolFang-Regular |
| 华文中宋 / STZhongsong | FandolSong-Regular |
| Times New Roman | TeX Gyre Termes |
| Cambria、Calibri | 优先原字体；缺少时沿用本工程的西文主字体 |

**替代字体不是原字体的逐字形副本。** 字形细节、字宽和行高可能略有差别，因此不同编译机器上的自动换行或分页可能不同。如需进一步贴近原 Word 显示，请在本机安装自己合法拥有的原字体后重新编译。工程不会把商业字体复制到压缩包。

## 来源与许可

- Fandol 来源：<https://ctan.org/pkg/fandol>。原发行包为 <https://mirrors.ctan.org/fonts/fandol.zip>。未修改的许可与作者说明完整保存在 `Fandol-COPYING.txt` 和 `Fandol-README.txt` 中；其许可包含 GPL 与字体嵌入例外。
- TeX Gyre Termes 来源：<https://ctan.org/pkg/tex-gyre>。原发行包为 <https://mirrors.ctan.org/fonts/tex-gyre.zip>。原许可、作者说明和发行清单分别见 `GUST-FONT-LICENSE.txt`、`README-TeX-Gyre-Termes.txt`、`MANIFEST-TeX-Gyre-Termes.txt`。该许可引用的 LPPL 全文另见 `LPPL.txt`。

本目录保留字体文件的原始名称和字节内容，没有重命名字体家族或修改字形。
