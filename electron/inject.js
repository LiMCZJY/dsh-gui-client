// electron/inject.js
// 在官方 dsh 网页端（127.0.0.1:3080）运行：注入 CSS / 划词气泡 / 命令面板 / WS 通知桥接
// 由 preload.js 在 isolated world 中 require 并调用，可操作 document、fetch dsh API、通过 ipcRenderer 调桌面能力。
// 所有注入 UI 用 body 级浮层 + MutationObserver 兜底，防 React re-render 抹除。

const DSH_API = 'http://127.0.0.1:3080/api';
let rpcCounter = 1;

async function dshCall(method, payload) {
  const res = await fetch(`${DSH_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-' + rpcCounter++, method, payload: payload || {} }),
  });
  if (!res.ok) throw new Error(`${method} ${res.status}`);
  const j = await res.json();
  return j && j.result ? j.result : j;
}

function el(tag, opts) {
  const n = document.createElement(tag);
  if (opts) {
    if (opts.cls) n.className = opts.cls;
    if (opts.text) n.textContent = opts.text;
    if (opts.html) n.innerHTML = opts.html;
    if (opts.attrs) for (const k in opts.attrs) n.setAttribute(k, opts.attrs[k]);
    if (opts.css) for (const k in opts.css) n.style[k] = opts.css[k];
  }
  return n;
}

// ---------- 1. 自定义 CSS 注入 ----------
let cssNode = null;
function applyCSS(css) {
  if (!cssNode) {
    cssNode = el('style', { attrs: { id: 'dsh-injected-css' } });
    document.head.appendChild(cssNode);
  }
  cssNode.textContent = css || '';
}

// ---------- 2. 划词即问气泡 ----------
let bubble = null;
let bubbleTimer = null;
function ensureBubble() {
  if (bubble) return bubble;
  bubble = el('div', {
    attrs: { id: 'dsh-ask-bubble' },
    css: {
      position: 'fixed', zIndex: '2147483647', padding: '6px 12px',
      background: '#2563eb', color: '#fff', borderRadius: '8px',
      fontSize: '13px', cursor: 'pointer', fontFamily: 'Segoe UI, sans-serif',
      boxShadow: '0 4px 14px rgba(0,0,0,0.25)', display: 'none', userSelect: 'none',
    },
  });
  bubble.textContent = '问 DeepSeek ↗';
  document.body.appendChild(bubble);
  bubble.addEventListener('mousedown', (e) => e.preventDefault());
  bubble.addEventListener('click', () => {
    const text = (window.getSelection ? window.getSelection().toString() : '').trim();
    hideBubble();
    if (text) askWithSelection(text);
  });
  return bubble;
}
function hideBubble() { if (bubble) bubble.style.display = 'none'; }
function showBubbleAt(x, y) {
  ensureBubble();
  bubble.style.left = Math.min(x, window.innerWidth - 140) + 'px';
  bubble.style.top = Math.max(8, y - 44) + 'px';
  bubble.style.display = 'block';
}
function onSelectionCheck() {
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    const sel = window.getSelection ? window.getSelection().toString().trim() : '';
    if (sel && sel.length >= 2 && sel.length <= 2000) {
      const range = window.getSelection().getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0) showBubbleAt(rect.right, rect.top);
      else hideBubble();
    } else hideBubble();
  }, 220);
}

async function askWithSelection(text) {
  try {
    toast('正在新建会话并发送…', 'info');
    const created = await dshCall('session.create', {});
    const sid = created && (created.id || (created.value && created.value.id));
    if (!sid) { toast('无法创建会话', 'err'); return; }
    await dshCall('session.prompt', { sessionId: sid, text });
    toast('已在新会话中提问，请在侧栏查看。', 'ok');
    // 尝试点击侧栏最新会话（best-effort）
    setTimeout(tryClickLatestSession, 300);
  } catch (e) {
    toast('提问失败：' + e.message, 'err');
  }
}
function tryClickLatestSession() {
  try {
    // 通用尝试：找侧栏里的会话条目，点第一个
    const sels = ['[data-session-id]:first-child', '.session-item', '[class*=session] li', 'a[href*=session]'];
    for (const s of sels) {
      const node = document.querySelector(s);
      if (node) { node.click(); return; }
    }
  } catch {}
}

// ---------- 3. 命令面板 Ctrl+K ----------
let palette = null;
let paletteInput = null;
let paletteList = null;
let paletteData = { sessions: [] };

const PALETTE_ACTIONS = [
  { id: 'reload', label: '重新加载网页端', run: () => location.reload() },
  { id: 'top', label: '切换始终置顶', run: () => ipc('toggle-top') },
  { id: 'settings', label: '打开设置', run: () => ipc('open-settings') },
  { id: 'datadir', label: '打开数据目录', run: () => ipc('open-datadir') },
  { id: 'hide', label: '隐藏到托盘', run: () => ipc('hide-window') },
  { id: 'newchat', label: '新建对话', run: () => dshCall('session.create', {}).then(() => location.reload()) },
];

function ensurePalette() {
  if (palette) return;
  palette = el('div', { attrs: { id: 'dsh-cmd-palette' }, css: {
    position: 'fixed', top: '12vh', left: '50%', transform: 'translateX(-50%)',
    width: '520px', maxWidth: '90vw', background: '#1f2937', color: '#e5e7eb',
    borderRadius: '12px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', zIndex: '2147483646',
    fontFamily: 'Segoe UI, sans-serif', overflow: 'hidden', display: 'none',
  } });
  const head = el('div', { text: '命令面板', css: { padding: '10px 14px', fontSize: '12px', color: '#9ca3af', borderBottom: '1px solid #374151' } });
  paletteInput = el('input', { attrs: { placeholder: '搜索会话 / 动作…', type: 'text' }, css: {
    width: '100%', boxSizing: 'border-box', padding: '12px 14px', border: 'none', outline: 'none',
    background: 'transparent', color: '#fff', fontSize: '15px', fontFamily: 'inherit',
  } });
  paletteList = el('div', { css: { maxHeight: '320px', overflowY: 'auto' } });
  palette.appendChild(head); palette.appendChild(paletteInput); palette.appendChild(paletteList);
  document.body.appendChild(palette);
  const backdrop = el('div', { attrs: { id: 'dsh-cmd-backdrop' }, css: {
    position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.4)', zIndex: '2147483645', display: 'none',
  } });
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', hidePalette);
  paletteInput.addEventListener('input', renderPalette);
  paletteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hidePalette();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = paletteList.querySelectorAll('[data-cmd]');
      if (!items.length) return;
      const cur = paletteList.querySelector('[data-cmd].active');
      let idx = cur ? Array.from(items).indexOf(cur) : -1;
      idx += (e.key === 'ArrowDown' ? 1 : -1);
      if (idx < 0) idx = items.length - 1; if (idx >= items.length) idx = 0;
      if (cur) cur.classList.remove('active');
      items[idx].classList.add('active');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      const cur = paletteList.querySelector('[data-cmd].active') || paletteList.querySelector('[data-cmd]');
      if (cur) cur.click();
    }
  });
}
async function openPalette() {
  ensurePalette();
  palette.style.display = 'block';
  document.getElementById('dsh-cmd-backdrop').style.display = 'block';
  paletteInput.value = ''; renderPalette(); paletteInput.focus();
  // 异步刷新会话列表
  try {
    const res = await dshCall('session.list', {});
    const sessions = (res && (res.sessions || (res.value && res.value.sessions))) || [];
    paletteData.sessions = sessions.slice(0, 50);
    renderPalette();
  } catch {}
}
function hidePalette() {
  if (palette) palette.style.display = 'none';
  const bd = document.getElementById('dsh-cmd-backdrop'); if (bd) bd.style.display = 'none';
}
function renderPalette() {
  if (!paletteList) return;
  const q = (paletteInput.value || '').toLowerCase().trim();
  paletteList.innerHTML = '';
  // 动作
  const acts = PALETTE_ACTIONS.filter(a => !q || a.label.toLowerCase().includes(q));
  for (const a of acts) {
    const row = el('div', { text: '⚙ ' + a.label, attrs: { 'data-cmd': a.id }, css: paletteRowCss() });
    row.addEventListener('click', () => { hidePalette(); a.run(); });
    paletteList.appendChild(row);
  }
  // 会话
  const sess = paletteData.sessions.filter(s => !q || (s.title || s.name || s.id || '').toLowerCase().includes(q));
  if (sess.length) {
    if (acts.length) paletteList.appendChild(el('div', { text: '会话', css: { padding: '6px 14px', fontSize: '11px', color: '#6b7280' } }));
    for (const s of sess) {
      const title = s.title || s.name || s.id;
      const row = el('div', { text: '💬 ' + title, attrs: { 'data-cmd': 'sess-' + s.id }, css: paletteRowCss() });
      row.addEventListener('click', () => { hidePalette(); jumpToSession(s.id); });
      paletteList.appendChild(row);
    }
  }
  const first = paletteList.querySelector('[data-cmd]'); if (first) first.classList.add('active');
}
function paletteRowCss() {
  return { padding: '10px 14px', fontSize: '13px', cursor: 'pointer', color: '#e5e7eb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
}
function jumpToSession(sid) {
  // best-effort：点击侧栏对应会话条目
  try {
    const node = document.querySelector(`[data-session-id="${sid}"]`) || document.querySelector(`[data-id="${sid}"]`);
    if (node) { node.click(); return; }
  } catch {}
  toast('已定位会话，请从侧栏打开。', 'info');
}

// ---------- 4. WS 通知桥接 ----------
let ws = null; let wsReconnect = null;
function startNotifyBridge() {
  try {
    ws = new WebSocket('ws://127.0.0.1:3080/api/events.mux');
  } catch (e) { scheduleWsReconnect(); return; }
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      const frame = msg && (msg.payload || msg);
      // 简化：检测 turn 结束 / message 完成帧
      const t = frame && (frame.type || (frame.event && frame.event.type));
      if (t && (t === 'assistant/turn' || t === 'assistant/message')) {
        const finish = frame && (frame.finish || (frame.data && frame.data.finish) || (frame.event && frame.event.finish));
        if (finish === 'end' || finish === 'complete' || (frame.type === 'assistant/message' && frame.data)) {
          ipc('notify-task-done', { title: 'DeepSeek 会话完成', body: '一个对话刚结束，点击查看' });
        }
      }
    } catch {}
  };
  ws.onclose = () => scheduleWsReconnect();
  ws.onerror = () => { try { ws.close(); } catch {} };
}
function scheduleWsReconnect() {
  if (wsReconnect) return;
  wsReconnect = setTimeout(() => { wsReconnect = null; startNotifyBridge(); }, 5000);
}

// ---------- 通用：toast / IPC ----------
let toastTimer = null; let toastNode = null;
function toast(text, type) {
  if (!toastNode) {
    toastNode = el('div', { attrs: { id: 'dsh-toast' }, css: {
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      padding: '10px 18px', borderRadius: '8px', fontSize: '13px', color: '#fff',
      fontFamily: 'Segoe UI, sans-serif', zIndex: '2147483647', boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
      transition: 'opacity 0.3s', opacity: '0',
    } });
    document.body.appendChild(toastNode);
  }
  toastNode.textContent = text;
  toastNode.style.background = type === 'err' ? '#dc2626' : (type === 'ok' ? '#16a34a' : '#2563eb');
  toastNode.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastNode.style.opacity = '0'; }, 2600);
}

// 注入样式（命令面板 active 行高亮）
const STYLE = `
#dsh-cmd-palette [data-cmd].active, #dsh-cmd-palette [data-cmd]:hover { background: rgba(37,99,235,0.25) !important; }
#dsh-cmd-palette [data-cmd] { border-left: 2px solid transparent; }
#dsh-cmd-palette [data-cmd].active { border-left-color: #2563eb; }
#dsh-ask-bubble:hover { background: #1d4ed8 !important; }
`;

// ipc 桥（preload 注入 ipcRenderer.send/invoke）
let ipcFn = null; let ipcInvoke = null;
function ipc(channel, arg) { if (ipcFn) ipcFn(channel, arg); }

// ---------- 入口 ----------
function setup({ ipcRenderer, fetch: _fetch }) {
  ipcFn = (channel, arg) => { try { ipcRenderer.send('inject-' + channel, arg); } catch {} };
  // 注入基础样式
  const base = el('style', { attrs: { id: 'dsh-inject-base' } });
  base.textContent = STYLE;
  document.head.appendChild(base);

  // 1. CSS：读配置注入，监听实时更新
  ipcRenderer.invoke('inject-get-css').then((css) => applyCSS(css || '')).catch(() => {});
  ipcRenderer.on('inject-css-update', (_e, css) => applyCSS(css || ''));

  // 2. 划词气泡
  document.addEventListener('mouseup', onSelectionCheck);
  document.addEventListener('selectionchange', onSelectionCheck);

  // 3. 命令面板 Ctrl+K
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === 'k'.toUpperCase())) {
      e.preventDefault(); openPalette();
    }
  });

  // 4. WS 通知桥接
  startNotifyBridge();
}

module.exports = { setup };
