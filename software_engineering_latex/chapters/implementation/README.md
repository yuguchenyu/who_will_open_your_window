# 第4章：实现与测试

编写：王羽喆，U202414672，CS2405。

第4章按开发环境与版本管理、主要功能的实现、测试方法与用例、测试结果四节编排。各分题由 `chapters/04-implementation.tex` 按顺序载入，正文连续排版。

2026-11-09 回归：141项通过；情绪立绘、风格切换、后台生图三项浏览器脚本通过。原始证据位于 `assets/report/implementation-20261109/`；历史证据保持原日期。

在报告目录运行 `latexmk -xelatex -interaction=nonstopmode -halt-on-error report.tex` 编译团队报告。

在项目根目录运行以下命令复查测试。浏览器脚本需要 Chrome 和项目测试工具。

```text
npm test
node --test tests/matching.test.mjs
node tests/portraits-browser.mjs
node tests/reply-style-browser.mjs
node tests/portrait-generation-browser.mjs
```
