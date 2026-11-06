# 字体文件与替代说明

本目录包含 10 个未修改的开源 OpenType 字体文件：Fandol 的宋体、黑体、楷体、仿宋四种风格，以及 TeX Gyre Termes 的常规、粗体、斜体、粗斜体。

正式报告的字体选择由 `../reportstyle.sty` 统一维护，使用 XeLaTeX 编译。样式优先检测本机所需字体；没有安装时，才按下表使用本目录中的替代字体。

| 正式报告用途 / 本机字体 | 没有安装时的替代 |
|---|---|
| 中文正文、宋体族及中文等宽字体 / SimSun | FandolSong-Regular、FandolSong-Bold；正文及宋体族的斜体使用 FandolKai-Regular |
| 中文标题、黑体族及中文无衬线字体 / SimHei | FandolHei-Regular、FandolHei-Bold |
| 封面仿宋标题 / FangSong | FandolFang-Regular，按样式使用模拟粗体 |
| 西文正文 / Times New Roman | TeX Gyre Termes 的常规、粗体、斜体和粗斜体 |

本机 SimSun 分支使用模拟粗体和斜体，SimHei 分支使用模拟粗体。回退字体从 `fonts/` 相对路径加载，分发时须保留字体文件和许可，不复制或冒充商业字体。

**替代字体不是本机字体的逐字形副本。** 字形细节、字宽和行高可能不同，自动换行和分页也可能随编译环境变化。前三章正文合计最多20页的要求必须在实际交付环境重新编译核验，不能把预算当作实测页数，也不能沿用旧预览页数。

## 来源与许可

- Fandol 来源：<https://ctan.org/pkg/fandol>。原发行包为 <https://mirrors.ctan.org/fonts/fandol.zip>。未修改的许可与作者说明完整保存在 `Fandol-COPYING.txt` 和 `Fandol-README.txt` 中；其许可包含 GPL 与字体嵌入例外。
- TeX Gyre Termes 来源：<https://ctan.org/pkg/tex-gyre>。原发行包为 <https://mirrors.ctan.org/fonts/tex-gyre.zip>。原许可、作者说明和发行清单分别见 `GUST-FONT-LICENSE.txt`、`README-TeX-Gyre-Termes.txt`、`MANIFEST-TeX-Gyre-Termes.txt`。该许可引用的 LPPL 全文另见 `LPPL.txt`。

本目录保留字体文件的原始名称和字节内容，没有重命名字体家族或修改字形。
