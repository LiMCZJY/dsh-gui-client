/**
 * dsh-custom.js — 桌面扩展（first-party，随 dist 一起托管，与 dsh 同源）
 *
 * 特性：划词即问气泡、Ctrl+K 命令面板、自定义 CSS 桥、WebSocket 通知桥。
 * 通过 window.electronAPI（Electron contextBridge 暴露）触发桌面动作；
 * 通过相对路径 /api/* 与 /api/events.mux 直连 dsh 后端（同源，无跨域）。
 */
(function () {
  'use strict';

  var api = (window.electronAPI || {});
  function send(channel, arg) {
    try { if (api.send) api.send(channel, arg); } catch (e) { /* 无桌面桥（纯浏览器） */ }
  }
  function invoke(channel) {
    if (!api.invoke) return Promise.resolve(undefined);
    var args = Array.prototype.slice.call(arguments, 1);
    return api.invoke.apply(api, [channel].concat(args)).catch(function () { return undefined; });
  }

  // ---------- DOM 小工具 ----------
  function make(tag, opts) {
    opts = opts || {};
    var n = document.createElement(tag);
    if (opts.cls) n.className = opts.cls;
    if (opts.text !== undefined) n.textContent = opts.text;
    if (opts.attrs) for (var k in opts.attrs) n.setAttribute(k, opts.attrs[k]);
    if (opts.css) for (var k2 in opts.css) n.style[k2] = opts.css[k2];
    return n;
  }

  // ---------- dsh API（同源） ----------
  var rpcCounter = 1;
  function dshCall(method, payload) {
    payload = payload || {};
    return fetch('/api/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-' + rpcCounter++, method: method, payload: payload }),
    }).then(function (res) {
      if (!res.ok) throw new Error(method + ' ' + res.status);
      return res.json();
    }).then(function (json) {
      return json && json.result ? json.result : json;
    });
  }

  // ---------- 1. 自定义 CSS 桥 ----------
  var cssNode = null;
  function applyCSS(css) {
    if (!cssNode) {
      cssNode = make('style', { attrs: { id: 'dsh-extras-css' } });
      document.head.appendChild(cssNode);
    }
    cssNode.textContent = css || '';
  }
  invoke('inject-get-css').then(function (css) { applyCSS(css || ''); });
  if (api.on) {
    api.on('inject-css-update', function (css) { applyCSS(css || ''); });
  }
  window.__applyDshExtrasCSS = applyCSS;

  // ---------- toast ----------
  var toastNode = null, toastTimer = null;
  function toast(text, kind) {
    if (!toastNode) {
      toastNode = make('div', { attrs: { id: 'dsh-extras-toast' } });
      document.body.appendChild(toastNode);
    }
    toastNode.textContent = text;
    toastNode.style.background = kind === 'err' ? '#dc2626' : (kind === 'ok' ? '#16a34a' : '#2563eb');
    toastNode.style.opacity = '1';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastNode.style.opacity = '0'; }, 2600);
  }

  // ---------- 2. 划词即问气泡 ----------
  var bubble = null, bubbleTimer = null;
  function hideBubble() { if (bubble) bubble.style.display = 'none'; }
  function ensureBubble() {
    if (bubble) return bubble;
    bubble = make('div', { attrs: { id: 'dsh-extras-ask' } });
    bubble.textContent = '问 DeepSeek ↗';
    bubble.addEventListener('mousedown', function (e) { e.preventDefault(); });
    bubble.addEventListener('click', function () {
      var sel = (window.getSelection() ? window.getSelection().toString() : '').trim();
      hideBubble();
      if (sel) askWithSelection(sel);
    });
    document.body.appendChild(bubble);
    return bubble;
  }
  function showBubbleAt(x, y) {
    ensureBubble();
    bubble.style.left = Math.min(x, window.innerWidth - 150) + 'px';
    bubble.style.top = Math.max(8, y - 46) + 'px';
    bubble.style.display = 'block';
  }
  function onSelectionCheck() {
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () {
      var sel = (window.getSelection() ? window.getSelection().toString() : '').trim();
      if (sel.length >= 2 && sel.length <= 2000) {
        var range = window.getSelection().getRangeAt(0);
        var rect = range.getBoundingClientRect();
        if (rect.width > 0) showBubbleAt(rect.right, rect.top);
        else hideBubble();
      } else hideBubble();
    }, 220);
  }
  function askWithSelection(text) {
    toast('正在新建会话并发送…', 'info');
    dshCall('session.create', {}).then(function (created) {
      var sid = (created && (created.id || (created.value && created.value.id)));
      if (!sid) { toast('无法创建会话', 'err'); return; }
      return dshCall('session.prompt', { sessionId: sid, text: text });
    }).then(function () {
      toast('已在新会话中提问，请在侧栏查看。', 'ok');
      setTimeout(tryClickLatestSession, 300);
    }).catch(function (e) {
      toast('提问失败：' + e.message, 'err');
    });
  }
  function tryClickLatestSession() {
    try {
      var sels = ['[data-session-id]:first-child', '.session-item', '[class*=session] li', 'a[href*=session]'];
      for (var i = 0; i < sels.length; i++) {
        var n = document.querySelector(sels[i]);
        if (n) { n.click(); return; }
      }
    } catch (e) { /* best-effort */ }
  }

  // ---------- 3. Ctrl+K 命令面板 ----------
  var palette = null, paletteInput = null, paletteList = null;
  var sessions = [];
  var PALETTE_ACTIONS = [
    { id: 'reload', label: '重新加载网页端', run: function () { location.reload(); } },
    { id: 'top', label: '切换始终置顶', run: function () { send('inject-toggle-top'); } },
    { id: 'settings', label: '打开设置', run: function () { send('inject-open-settings'); } },
    { id: 'datadir', label: '打开数据目录', run: function () { send('inject-open-datadir'); } },
    { id: 'hide', label: '隐藏到托盘', run: function () { send('inject-hide-window'); } },
    { id: 'newchat', label: '新建对话', run: function () { dshCall('session.create', {}).then(function () { location.reload(); }); } },
  ];
  function ensurePalette() {
    if (palette) return;
    palette = make('div', { attrs: { id: 'dsh-extras-palette' } });
    palette.appendChild(make('div', { cls: 'head', text: '命令面板' }));
    paletteInput = make('input', { attrs: { type: 'text', placeholder: '搜索会话 / 动作…' } });
    paletteList = make('div', { cls: 'list' });
    palette.appendChild(paletteInput);
    palette.appendChild(paletteList);
    document.body.appendChild(palette);

    var backdrop = make('div', { attrs: { id: 'dsh-extras-backdrop' } });
    backdrop.addEventListener('click', hidePalette);
    document.body.appendChild(backdrop);

    paletteInput.addEventListener('input', renderPalette);
    paletteInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hidePalette();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        var items = paletteList.querySelectorAll('[data-cmd]');
        if (!items.length) return;
        var cur = paletteList.querySelector('[data-cmd].active');
        var idx = cur ? Array.prototype.indexOf.call(items, cur) : -1;
        idx += (e.key === 'ArrowDown' ? 1 : -1);
        if (idx < 0) idx = items.length - 1;
        if (idx >= items.length) idx = 0;
        if (cur) cur.classList.remove('active');
        items[idx].classList.add('active');
        items[idx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        var c = paletteList.querySelector('[data-cmd].active') || paletteList.querySelector('[data-cmd]');
        if (c) c.click();
      }
    });
  }
  function openPalette() {
    ensurePalette();
    palette.style.display = 'block';
    document.getElementById('dsh-extras-backdrop').style.display = 'block';
    paletteInput.value = '';
    renderPalette();
    paletteInput.focus();
    dshCall('session.list', {}).then(function (res) {
      sessions = (res && (res.sessions || (res.value && res.value.sessions))) || [];
      renderPalette();
    }).catch(function () {});
  }
  function hidePalette() {
    if (palette) palette.style.display = 'none';
    var bd = document.getElementById('dsh-extras-backdrop');
    if (bd) bd.style.display = 'none';
  }
  function renderPalette() {
    if (!paletteList) return;
    var q = (paletteInput.value || '').toLowerCase().trim();
    paletteList.innerHTML = '';
    PALETTE_ACTIONS.forEach(function (a) {
      if (q && a.label.toLowerCase().indexOf(q) === -1) return;
      var row = make('div', { text: '⚙ ' + a.label, attrs: { 'data-cmd': a.id } });
      row.addEventListener('click', function () { hidePalette(); a.run(); });
      paletteList.appendChild(row);
    });
    var sess = sessions.filter(function (s) {
      var t = (s.title || s.name || s.id || '').toLowerCase();
      return !q || t.indexOf(q) !== -1;
    });
    if (sess.length) {
      if (paletteList.children.length) paletteList.appendChild(make('div', { cls: 'group', text: '会话' }));
      sess.forEach(function (s) {
        var row = make('div', { text: '💬 ' + (s.title || s.name || s.id), attrs: { 'data-cmd': 'sess-' + s.id } });
        row.addEventListener('click', function () { hidePalette(); jumpToSession(s.id); });
        paletteList.appendChild(row);
      });
    }
    var first = paletteList.querySelector('[data-cmd]');
    if (first) first.classList.add('active');
  }
  function jumpToSession(sid) {
    try {
      var n = document.querySelector('[data-session-id="' + sid + '"]') || document.querySelector('[data-id="' + sid + '"]');
      if (n) { n.click(); return; }
    } catch (e) { /* best-effort */ }
    toast('已定位会话，请从侧栏打开。', 'info');
  }

  // ---------- 4. WS 通知桥 ----------
  var ws = null, wsReconnect = null;
  function startNotifyBridge() {
    try {
      var proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(proto + '://' + location.host + '/api/events.mux');
    } catch (e) { scheduleWsReconnect(); return; }
    ws.onmessage = function (ev) {
      try {
        var msg = JSON.parse(ev.data);
        var frame = (msg && msg.payload) ? msg.payload : msg;
        var type = frame && (frame.type || (frame.event && frame.event.type));
        if (type === 'assistant/turn' || type === 'assistant/message') {
          var finish = frame.finish || (frame.data && frame.data.finish) || (frame.event && frame.event.finish);
          if (finish === 'end' || finish === 'complete' || type === 'assistant/message') {
            send('inject-notify-task-done', { title: 'DeepSeek 会话完成', body: '一个对话刚结束，点击查看' });
          }
        }
      } catch (e2) { /* 忽略非法帧 */ }
    };
    ws.onclose = function () { scheduleWsReconnect(); };
    ws.onerror = function () { try { ws.close(); } catch (e3) {} };
  }
  function scheduleWsReconnect() {
    if (wsReconnect) return;
    wsReconnect = setTimeout(function () { wsReconnect = null; startNotifyBridge(); }, 5000);
  }

  // ---------- 5. 桌面设置：往设置面板 nav 注入「桌面」入口 + 客户端设置浮层 ----------
  var desktopOverlay = null;

  function makeDesktopOverlay() {
    if (desktopOverlay) return desktopOverlay;
    var overlay = make('div', { attrs: { id: 'dsh-extras-desktop' }, css: {
      position: 'fixed', top: '12vh', left: '50%', transform: 'translateX(-50%)',
      width: '560px', maxWidth: '92vw', maxHeight: '78vh', overflowY: 'auto',
      background: '#1f2937', color: '#e5e7eb', borderRadius: '12px',
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)', zIndex: '2147483646',
      fontFamily: 'Segoe UI, system-ui, sans-serif', display: 'none', padding: '20px',
    } });
    overlay.innerHTML =
      '<div style="font-size:15px;font-weight:600;margin-bottom:4px;">桌面设置</div>' +
      '<div style="font-size:12px;color:#9ca3af;margin-bottom:18px;">客户端配置：dsh 路径、本地服务、窗口行为、自定义 CSS</div>' +
      '<div class="dshd-field"><label>DSH 安装路径</label>' +
        '<div style="display:flex;gap:8px;"><input id="dshd-path" type="text" placeholder="例如 C:\\...\\node_modules\\@deepseek-ai\\dsh" style="flex:1;" />' +
        '<button id="dshd-browse" type="button">浏览…</button><button id="dshd-detect" type="button">检测</button></div></div>' +
      '<div class="dshd-field"><label>本地服务 (dsh web)</label>' +
        '<div style="display:flex;gap:8px;align-items:center;"><span id="dshd-status">检测中…</span>' +
        '<button id="dshd-start" type="button" style="background:#2563eb;color:#fff;border-color:#2563eb;">启动</button>' +
        '<button id="dshd-stop" type="button">停止</button><button id="dshd-restart" type="button">重启</button></div></div>' +
      '<div class="dshd-field"><label>行为偏好</label>' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;"><input id="dshd-tray" type="checkbox" /> 关闭时最小化到托盘</label>' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;"><input id="dshd-top" type="checkbox" /> 窗口始终置顶</label></div>' +
      '<div class="dshd-field"><label>自定义 CSS 注入</label>' +
        '<textarea id="dshd-css" rows="4" placeholder="/* 例如让对话区字号变大 */\n.conversation-content { font-size: 15px; }" style="width:100%;font-family:Consolas,monospace;font-size:12px;background:#111827;color:#e5e7eb;"></textarea></div>' +
      '<div id="dshd-msg" style="font-size:12px;padding:8px 10px;border-radius:6px;display:none;"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">' +
        '<button id="dshd-close" type="button">关闭</button>' +
        '<button id="dshd-save" type="button" style="background:#2563eb;color:#fff;border-color:#2563eb;">保存设置</button></div>';

    document.body.appendChild(overlay);

    var style = make('style', { attrs: { id: 'dsh-extras-desktop-css' } });
    style.textContent =
      '#dsh-extras-desktop input, #dsh-extras-desktop textarea, #dsh-extras-desktop button {' +
      'box-sizing:border-box;padding:7px 10px;border:1px solid #4b5563;border-radius:6px;font-size:12.5px;font-family:inherit;background:#111827;color:#e5e7eb;}' +
      '#dsh-extras-desktop .dshd-field { margin-bottom:16px; }' +
      '#dsh-extras-desktop .dshd-field > label { display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:#d1d5db; }' +
      '#dsh-extras-desktop button { cursor:pointer; }' +
      '#dsh-extras-desktop button:hover { background:#374151; }';
    document.head.appendChild(style);

    function showMsg(t, kind) {
      var m = overlay.querySelector('#dshd-msg');
      m.style.display = 'block';
      m.textContent = t;
      m.style.background = kind === 'err' ? 'rgba(220,38,38,0.15)' : 'rgba(37,99,235,0.15)';
      m.style.color = kind === 'err' ? '#f87171' : '#93c5fd';
    }
    function refreshStatus() {
      var s = overlay.querySelector('#dshd-status');
      invoke('dsh-web-status').then(function (r) { s.textContent = r && r.running ? '运行中' : '未运行'; }).catch(function () { s.textContent = '未知'; });
    }
    function loadCfg() {
      invoke('gui-get-config').then(function (cfg) {
        cfg = cfg || {};
        if (cfg.dshPath) overlay.querySelector('#dshd-path').value = cfg.dshPath;
        if (typeof cfg.minimizeToTray === 'boolean') overlay.querySelector('#dshd-tray').checked = cfg.minimizeToTray;
        if (typeof cfg.alwaysOnTop === 'boolean') overlay.querySelector('#dshd-top').checked = cfg.alwaysOnTop;
        if (typeof cfg.customCss === 'string') overlay.querySelector('#dshd-css').value = cfg.customCss;
      }).catch(function () {});
    }

    overlay.querySelector('#dshd-close').addEventListener('click', function () { overlay.style.display = 'none'; });
    overlay.querySelector('#dshd-detect').addEventListener('click', function () {
      invoke('dsh-find-path').then(function (r) {
        if (r && r.path) { overlay.querySelector('#dshd-path').value = r.path; showMsg('已检测到 dsh 路径。'); }
        else showMsg('未找到 dsh，请手动指定。', 'err');
      }).catch(function (e) { showMsg('检测失败：' + e.message, 'err'); });
    });
    overlay.querySelector('#dshd-browse').addEventListener('click', function () {
      invoke('select-folder', { title: '选择 @deepseek-ai/dsh 安装目录' }).then(function (dir) {
        if (dir) { overlay.querySelector('#dshd-path').value = dir; showMsg('已选择，保存后生效。'); }
      }).catch(function (e) { showMsg('选择失败：' + e.message, 'err'); });
    });
    overlay.querySelector('#dshd-start').addEventListener('click', function () {
      showMsg('正在启动服务…');
      invoke('dsh-start-web').then(function (r) { showMsg(r && r.ok ? '服务已启动。' : ((r && r.message) || '启动失败。'), r && r.ok ? 'ok' : 'err'); refreshStatus(); })
        .catch(function (e) { showMsg('启动失败：' + e.message, 'err'); refreshStatus(); });
    });
    overlay.querySelector('#dshd-stop').addEventListener('click', function () {
      invoke('dsh-stop-web').then(function () { refreshStatus(); }).catch(function () {});
    });
    overlay.querySelector('#dshd-restart').addEventListener('click', function () {
      showMsg('正在重启服务…');
      invoke('dsh-restart-web').then(function (r) { showMsg(r && r.ok ? '服务已重启。' : ((r && r.message) || '重启失败。'), r && r.ok ? 'ok' : 'err'); refreshStatus(); })
        .catch(function (e) { showMsg('重启失败：' + e.message, 'err'); refreshStatus(); });
    });
    overlay.querySelector('#dshd-save').addEventListener('click', function () {
      var pathVal = overlay.querySelector('#dshd-path').value.trim();
      var partial = {
        minimizeToTray: overlay.querySelector('#dshd-tray').checked,
        alwaysOnTop: overlay.querySelector('#dshd-top').checked,
        customCss: overlay.querySelector('#dshd-css').value,
      };
      var jobs = [];
      if (pathVal) jobs.push(invoke('dsh-set-path', pathVal));
      jobs.push(invoke('gui-set-config', partial));
      jobs.push(invoke('inject-push-css', partial.customCss));
      Promise.all(jobs).then(function () { showMsg('设置已保存。', 'ok'); }).catch(function (e) { showMsg('保存失败：' + e.message, 'err'); });
    });

    desktopOverlay = overlay;
    return overlay;
  }

  function toggleDesktopSettings() {
    var o = makeDesktopOverlay();
    if (o.style.display === 'block') { o.style.display = 'none'; return; }
    o.style.display = 'block';
    o.querySelector('#dshd-msg').style.display = 'none';
    invoke('gui-get-config').then(function (cfg) {
      cfg = cfg || {};
      if (cfg.dshPath) o.querySelector('#dshd-path').value = cfg.dshPath;
      if (typeof cfg.minimizeToTray === 'boolean') o.querySelector('#dshd-tray').checked = cfg.minimizeToTray;
      if (typeof cfg.alwaysOnTop === 'boolean') o.querySelector('#dshd-top').checked = cfg.alwaysOnTop;
      if (typeof cfg.customCss === 'string') o.querySelector('#dshd-css').value = cfg.customCss;
    }).catch(function () {});
    invoke('dsh-web-status').then(function (r) { o.querySelector('#dshd-status').textContent = r && r.running ? '运行中' : '未运行'; }).catch(function () {});
  }

  // 往设置面板 nav 列表末尾注入「桌面」入口
  function injectDesktopEntry() {
    var dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
    for (var i = 0; i < dialogs.length; i++) {
      var dialog = dialogs[i];
      var nav = dialog.querySelector('nav');
      if (!nav || nav.querySelector('[data-dsh-desktop-entry]')) continue;
      var navList = null;
      nav.querySelectorAll('div').forEach(function (div) { if (div.querySelector('button')) navList = div; });
      if (!navList) continue;
      var btn = make('button', { attrs: { 'data-dsh-desktop-entry': '1', type: 'button' }, text: '桌面' });
      btn.style.cssText = 'box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:10px 14px;border:none;background:transparent;color:inherit;font-size:13px;cursor:pointer;text-align:left;';
      btn.addEventListener('mouseenter', function () { btn.style.background = 'rgba(255,255,255,0.06)'; });
      btn.addEventListener('mouseleave', function () { btn.style.background = 'transparent'; });
      btn.addEventListener('click', function () { toggleDesktopSettings(); });
      navList.appendChild(btn);
    }
  }

  var panelWatcher = new MutationObserver(function () { injectDesktopEntry(); });
  panelWatcher.observe(document.body, { childList: true, subtree: true });

  // ---------- 入口 ----------
  document.addEventListener('mouseup', onSelectionCheck);
  document.addEventListener('selectionchange', onSelectionCheck);
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      openPalette();
    }
  });
  startNotifyBridge();
})();
