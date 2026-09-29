import {post} from './api.mjs';

const app = document.getElementById('app');
const e = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const reason = new URLSearchParams(location.search).get('reason');
let mode = 'login';
let busy = false;
const notices = {replaced: '你的账号已在另一台设备登录，这里已退出。重新登录即可继续。'};

function render(error = '') {
  app.innerHTML = `
   <main class="auth">
    <div class="auth-card">
     <div class="auth-brand"><span class="window-mark" aria-hidden="true"></span><span><b>谁能打开<br>你的窗</b><small>AT YOUR OWN PACE</small></span></div>
     <h1>${mode === 'login' ? '欢迎回来' : '留一扇窗'}</h1>
     <p class="smallprint">${mode === 'login' ? '同一个账号同时只能在一台设备上登录，换设备登录会让原来的设备退出。' : '用户名 3–20 位字母、数字或下划线，密码至少 8 位。'}</p>
     ${reason && mode === 'login' && !error ? `<div class="notice"><span>${e(notices[reason] || '')}</span></div>` : ''}
     ${error ? `<div class="error-box" role="alert">${e(error)}</div>` : ''}
     <form id="auth-form">
      <label class="field"><span>用户名</span><input id="username" name="username" autocomplete="username" maxlength="20" required></label>
      <label class="field"><span>密码</span><input id="password" name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" maxlength="128" required></label>
      <button type="submit" class="btn full"${busy ? ' disabled' : ''}>${busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并进入'}</button>
     </form>
     <button type="button" class="link-btn" id="switch">${mode === 'login' ? '还没有账号？注册一个' : '已经有账号了？去登录'}</button>
    </div>
   </main>`;
  document.getElementById('auth-form').addEventListener('submit', submit);
  document.getElementById('switch').addEventListener('click', () => { mode = mode === 'login' ? 'register' : 'login'; render(); });
}

async function submit(event) {
  event.preventDefault();
  if (busy) return;
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  busy = true;
  render();
  try {
    await post(mode === 'login' ? '/api/login' : '/api/register', {username, password});
    location.replace('/');
  } catch (error) {
    busy = false;
    // 把输入过的用户名留着，只清密码。
    render(error.message);
    document.getElementById('username').value = username;
    document.getElementById('password').focus();
  }
}

render();
