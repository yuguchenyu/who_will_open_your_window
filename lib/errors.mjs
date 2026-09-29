// 全服务端共用的错误类型。带 status 与 code，由 server.mjs 统一转成 JSON 响应。
export class ApiError extends Error {
  constructor(message, status = 400, code = 'INVALID_INPUT') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
