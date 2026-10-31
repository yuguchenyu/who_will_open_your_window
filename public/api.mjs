/**
 * 浏览器端统一 JSON 请求封装。
 * 集中处理网络异常、响应格式和登录失效，页面模块据此展示操作结果。
 */

// 前端统一的接口封装。401 一律在这里处理掉，调用方只要管自己的错。
export class ApiFailure extends Error {
  constructor(message, code = 'INTERNAL', status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// 被顶掉或掉线时会整页跳走，跳走之前给调用方一次抢救未发送内容的机会。
let onLeave = () => {};

/**
 * 登记登录失效跳转前执行的页面回调。
 * 主页面利用这个时机暂存未发送草稿，以便重新登录后恢复。
 */
export function beforeLeaving(fn) {
  onLeave = fn;
}

/**
 * 根据会话失效原因选择登录页并执行离开回调。
 * 已经位于登录页时不再跳转，回调失败也不阻止退出当前页面。
 */
function leave(reason) {
  const target =
    reason === 'SESSION_REPLACED'
      ? '/login.html?reason=replaced'
      : '/login.html';
  if (location.pathname === '/login.html') return;
  try {
    onLeave();
  } catch {
    /* 抢救失败也不能拦住跳转 */
  }
  location.replace(target);
}

/**
 * 发送 JSON 请求并转换为统一的 ApiFailure 异常。
 * 登录失效先处理跳转，其余 HTTP 错误保留业务码和状态供调用方展示。
 */
async function request(method, path, body) {
  // 只有携带请求体时才声明 JSON，GET 请求保持空请求体。
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(45000)
    });
  } catch {
    throw new ApiFailure(
      '请求中断或超时。请检查连接后重试，已写下的内容仍然保留。',
      'NETWORK'
    );
  }
  let data;
  // 响应解析失败单独报告，避免把无效 JSON 当成业务错误展示。
  try {
    data = await res.json();
  } catch {
    throw new ApiFailure('服务响应格式异常。', 'FORMAT', res.status);
  }
  if (res.status === 401) {
    // 先跳转再抛错：调用方捕获后什么都不用做，草稿仍在输入框里。
    leave(data.code);
    throw new ApiFailure(
      data.error || '登录状态已失效。',
      data.code || 'UNAUTHENTICATED',
      401
    );
  }
  if (!res.ok)
    throw new ApiFailure(
      data.error || '请求失败，请重试。',
      data.code,
      res.status
    );
  return data;
}

export const post = (path, body) => request('POST', path, body ?? {});
export const get = (path) => request('GET', path, undefined);
