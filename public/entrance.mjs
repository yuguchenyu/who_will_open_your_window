/**
 * 首次进入页面时的开窗动画与键盘交互。
 * 通过会话存储记住进入状态，并尊重减少动态效果的系统偏好。
 */

// 进入标记只属于当前浏览器会话，不影响账号登录状态或服务端资料。
const KEY = 'heart-window-entered-v1';
const app = document.getElementById('app');
let entered = false;
try { entered = sessionStorage.getItem(KEY) === '1'; } catch {}
const remember = () => { try { sessionStorage.setItem(KEY, '1'); } catch {} };

// 已经看过、带退出原因返回或偏好减少动态效果时，直接进入主体页面。
if (!entered && !new URLSearchParams(location.search).has('reason') && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const overlay = document.createElement('section');
  overlay.className = 'window-entry';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'entry-title');
  overlay.innerHTML = `<div class="entry-copy"><span class="eyebrow">AT YOUR OWN PACE</span><h1 id="entry-title">谁能打开你的窗</h1><p>让风进来，让一句问候慢慢开始。</p></div><button class="entry-window" type="button" aria-label="打开这扇窗"><span class="entry-view" aria-hidden="true"></span><span class="entry-pane left" aria-hidden="true"></span><span class="entry-pane right" aria-hidden="true"></span><span class="entry-sill" aria-hidden="true"></span></button><div class="entry-actions"><button class="btn entry-open" type="button">打开这扇窗 <span aria-hidden="true">↗</span></button><button class="link-btn entry-skip" type="button">直接进入</button></div><span class="entry-note">不必急着靠近，先为自己留一扇窗。</span>`;

  // 覆盖层显示期间禁用底层页面交互，避免键盘焦点落到被遮挡的控件。
  app.inert = true;
  document.body.classList.add('entering');
  document.body.append(overlay);
  let opening = false, done = false, timer;

  // 动画结束、跳过和 Escape 共用幂等收尾，清理计时并把焦点还给主体页面。
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    remember();
    overlay.remove();
    app.inert = false;
    document.body.classList.remove('entering');
    app.querySelector('#username, .menu-btn, button, input')?.focus({preventScroll: true});
  };

  // 只启动一次开窗动画，同时设置计时兜底，避免缺少动画结束事件时停留在覆盖层。
  const open = () => {
    if (opening) return;
    opening = true;
    overlay.classList.add('opening');
    overlay.querySelectorAll('.entry-open, .entry-window').forEach(button => { button.disabled = true; });
    timer = setTimeout(finish, 1450);
  };
  overlay.querySelector('.entry-window').addEventListener('click', open);
  overlay.querySelector('.entry-open').addEventListener('click', open);
  overlay.querySelector('.entry-skip').addEventListener('click', finish);
  overlay.addEventListener('animationend', event => { if (event.target === overlay) finish(); });

  // 在模态覆盖层内循环 Tab 焦点，Shift+Tab 则反向循环；Escape 可直接跳过。
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); finish(); }
    if (event.key !== 'Tab') return;
    const buttons = [...overlay.querySelectorAll('button:not(:disabled)')];
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  overlay.querySelector('.entry-open').focus({preventScroll: true});
} else {
  remember();
}
