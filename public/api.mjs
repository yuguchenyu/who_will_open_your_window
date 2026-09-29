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
export function beforeLeaving(fn) { onLeave = fn; }

function leave(reason) {
  const target = reason === 'SESSION_REPLACED' ? '/login.html?reason=replaced' : '/login.html';
  if (location.pathname === '/login.html') return;
  try { onLeave(); } catch { /* 抢救失败也不能拦住跳转 */ }
  location.replace(target);
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : {'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new ApiFailure('请求中断或超时。请检查连接后重试，已写下的内容仍然保留。', 'NETWORK');
  }
  let data;
  try { data = await res.json(); } catch { throw new ApiFailure('服务响应格式异常。', 'FORMAT', res.status); }
  if (res.status === 401) {
    // 先跳转再抛错：调用方捕获后什么都不用做，草稿仍在输入框里。
    leave(data.code);
    throw new ApiFailure(data.error || '登录状态已失效。', data.code || 'UNAUTHENTICATED', 401);
  }
  if (!res.ok) throw new ApiFailure(data.error || '请求失败，请重试。', data.code, res.status);
  return data;
}

export const post = (path, body) => request('POST', path, body ?? {});
export const get = (path) => request('GET', path, undefined);
