/**
 * 服务端可向调用方展示的业务错误。
 * HTTP 状态码用于协议响应，业务错误码供前端区分登录失效等具体原因。
 */

// 全服务端共用的错误类型。带 status 与 code，由 server.mjs 统一转成 JSON 响应。
export class ApiError extends Error {
  constructor(message, status = 400, code = 'INVALID_INPUT') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
