# 第4章实现与测试：本轮交付核验

- 日期：2026-11-09。
- 编写与提交信息：王羽喆，U202414672，CS2405；既有其他成员信息保持不变，未知成员资料不代填。
- 源码与测试基线：6d15c91；本轮仅编辑第4章及其分节、report.tex、metadata.tex，另增加本目录证据。不改写第1、2、3、5、6章或既有附录。
- 入口：report.tex 仅启用第4章，章计数设置为3；保留封面、任务书与目录。其他正文及设计附录保持注释。
- 第4章结构：7个主体节、12个下级小节；源码保留chapters/implementation/01–20共20份编辑片段；章节入口为 chapters/04-implementation.tex。
- 编译：XeLaTeX / latexmk；验证命令 `latexmk -xelatex -jobname=report-implementation -interaction=nonstopmode -halt-on-error -file-line-error report.tex`。
- 产物：report-implementation.pdf，23页；正文物理页4–23共20页，前置3页另计。
- LaTeX正文页数检查：REPORT-BODY-PAGES=20；无未定义引用、缺字或Overfull警告。
- 文本边界：Poppler逐词边界检查23页，越出页面的词为0；目录含4.1–4.7，正文仍覆盖1–20页。
- 图像复核：23页均渲染预览并检查；未见裁切、表格越界、图形遮挡或空白正文页。沿用原稿字体、字号、行距与页边距。
- 回归：16个测试文件，141项通过，失败/取消/跳过/待办均为0；框架总耗时2606.1751ms。不是接口响应时间或模型推理速度。
- 浏览器：portraits-browser、reply-style-browser、portrait-generation-browser 三个脚本均退出0；未声称重跑其余浏览器脚本。
- 证据：regression.txt、三个浏览器日志、evidence.json、git-history.txt，均在本目录。未访问真实模型密钥和日常数据库。
- 文件占用：原 report.pdf 被外部程序占用，无法覆盖；已验证的新PDF另存 report-implementation.pdf。关闭旧PDF后可按标准命令重编译 report.tex，或以新PDF替换旧预览。

- 用户反馈修订：将原20个编号节合并为7个主体节；原细分标题改为少量下级标题和段首说明，不删减核心内容。重新编译后正文仍20页，总23页；逐页渲染复核，无越界或遮挡。
