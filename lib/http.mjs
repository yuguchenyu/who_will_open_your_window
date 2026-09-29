import {ApiError} from './errors.mjs';

export async function readJson(req, maxBytes = 64000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new ApiError('请求内容过长。', 413, 'TOO_LARGE');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new ApiError('请求不是有效 JSON。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('请求格式错误。');
  return body;
}

export function cookieOf(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return '';
}

// 不加 Secure：服务跑在 http 上，加了浏览器根本不会回传 cookie，登录直接失效。
export function sessionCookie(name, token, maxAgeSeconds) {
  return `${name}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearCookie(name) {
  return `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}
