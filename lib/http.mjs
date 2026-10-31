/**
 * 与业务无关的 HTTP 请求体和 Cookie 辅助函数。
 * 请求体只接受有限大小的 JSON 对象，Cookie 属性在这里集中维护。
 */

import { ApiError } from './errors.mjs';

/**
 * 按流读取并解析有限大小的 JSON 请求体。
 * 空请求体视为空对象，数组、空值和其他非对象结果不作为合法请求。
 */
export async function readJson(req, maxBytes = 64000) {
  // 在读取流时累计字节数，超过限制立即停止，不等完整请求进入内存。
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new ApiError('请求内容过长。', 413, 'TOO_LARGE');
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new ApiError('请求不是有效 JSON。');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ApiError('请求格式错误。');
  return body;
}

/**
 * 从 Cookie 请求头逐项查找指定名称。
 * 仅去除名称和值两端空白，不执行解码，保持会话令牌原样传递。
 */
export function cookieOf(req, name) {
  // 只按第一个等号拆分，保留 Cookie 值里可能存在的后续等号。
  for (const part of String(req.headers.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name)
      return part.slice(at + 1).trim();
  }
  return '';
}

// 不加 Secure：服务跑在 http 上，加了浏览器根本不会回传 cookie，登录直接失效。

/**
 * 构造供当前 HTTP 服务使用的会话 Cookie。
 * HttpOnly 限制脚本读取，SameSite 与 Path 指定发送范围，时长由调用方提供。
 */
export function sessionCookie(name, token, maxAgeSeconds) {
  return `${name}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

/**
 * 以相同路径和属性将 Cookie 的有效时间设为零。
 * 浏览器清除凭据后，服务端仍通过删除会话记录完成真正的退出。
 */
export function clearCookie(name) {
  return `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}
