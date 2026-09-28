# 验证记录

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
