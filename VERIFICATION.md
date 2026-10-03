# 验证记录

## 2026-10-03 · 水彩视觉与开窗入场

- `npm test`：80 项通过。Windows Chrome 下 `node tests/browser.mjs`、`node tests/real-browser.mjs`、`node tests/visual-browser.mjs` 均通过；业务测试使用模拟 AI、内存数据库，不调用真实模型或修改现有账号。
- 已检查 320px、390px 手机与 1440px 电脑的截图，覆盖登录、遇见、纸条、我的和对话。浅色对话框、人物与回复选项布局无横向溢出；长内容可滚动，列表头像显示完整面部。
- 首次点击开窗、键盘进入和焦点恢复、直接进入、刷新与登录后不重播、已有登录账号新标签页、减少动态效果、存储不可用及动画超时兜底均通过。无页面异常或 CSP 执行错误。
- 5 张场景与 3 张立绘均正常加载，立绘含真实透明像素。场景切换、图片加载失败时的备用显示、自定义背景刷新保留、回复建议、手动发送、重试无重复及草稿恢复通过。
- 截图：`runtime/screenshots/watercolor/`；对话截图：`runtime/screenshots/desktop-chat.png`、`mobile-chat.png`、`narrow-chat.png`。素材与完整生成提示词见 `docs/watercolor-assets.md`，制作方式为 imagegen 内置工具。
- 已识别并停止属于本项目的旧 WSL 实例，再使用现有 Windows 后台启动器启动新版；未改动 `.env` 或删除数据库。启动器退出后，监控与新版静态资源检查正常。

复现新增界面测试：`node tests/visual-browser.mjs`，使用项目已安装的 playwright-core 与 Windows Chrome；其他环境可通过 `CHROME_PATH` 指定浏览器可执行文件。

## 先前版本记录

验证日期：2026-09-26。运行环境：Windows、Node.js 24.13.0、独立无头 Chrome。

## 已通过

- `npm test`：13 项自动化测试通过，涵盖纸条额度、重复投递、收件暂存与归档、重试幂等、私人数值与意愿分离、当前周期授权、双向结果、屏蔽、持久化和损坏数据识别。
- 本地 HTTP 接口测试：静态文件白名单、跨站请求阻止、密钥不返回前端、模型鉴权和限流错误、网络错误、超时与建议格式验证。
- 独立浏览器端到端测试：配置门禁 → 编辑纸条 → 拾言建议 → 递出 → AI 模拟回应 → 聊天 → 失败重试 → 心笺 → 回望授权 → 双向成功 → 跨周期未确认结果。
- 收件暂存与归档、刷新恢复、日期推进、二次确认重置均已验证。测试检查发给上游的内容不包含私人心笺备注。
- 390px 手机、320px 窄屏和 1440px 电脑没有横向溢出。已查看手机首页、聊天、双向结果及桌面截图，修正次要按钮悬停时的对比度。
- 浏览器没有未捕获 JavaScript 异常或 CSP 执行错误。
- 后台启动、重复启动不创建第二份服务、停止、重启和只读监控通过。启动器及单次监控退出后，健康接口仍正常。
- 服务通过隐藏后台 supervisor 记录进程退出码；测试中主动停止后的退出码为 -1，符合 Windows 强制终止行为。

## 尚未验证

- 尚未提供有效模型 API 配置，因此没有调用真实第三方模型。测试使用显式伪造的上游返回，仅证明接口与交互链路可运行，不证明任何指定服务商的实际兼容性。
- 没有真实多人通信、身份验证、生产级数据库、线上审核或公网部署；这些不是此 Demo 的实现范围。

## 复现

```powershell
Set-Location 'E:\谁能打开你的窗'
npm test
# 浏览器测试工具已安装在忽略目录 runtime/test-tools 下
node tests/browser.mjs
```

如果清理了 runtime/test-tools，可单独重新安装测试工具，不影响应用启动：

```powershell
npm install --prefix runtime/test-tools --no-package-lock --no-audit --no-fund playwright-core
```

浏览器测试使用两个独立临时端口，不读取 .env，不使用真实密钥，不写入用户常用浏览器。

截图位于 `runtime/screenshots/`：`mobile-meet.png`、`mobile-chat.png`、`mobile-mutual.png`、`desktop-meet.png`、`configuration.png`。
