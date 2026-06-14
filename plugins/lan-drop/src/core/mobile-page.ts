// 移动端网页（自包含单文件：HTML + 内联 CSS + 内联 JS）。
// 由 web-gateway 在 GET /m 直接以字符串返回——无需独立构建步骤，也不依赖运行时读取磁盘资源。
//
// 注意（维护约束）：本文件是一个 TS 模板字符串，内联 JS 内**不得**使用反引号或 ${}，
// 以免与外层模板字符串冲突，故内部一律使用字符串拼接。
// 图标统一用内联 SVG（line-icon 风格），不使用 emoji。

export const MOBILE_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0b0e16" />
<title>闪传 LanDrop · 手机互传</title>
<style>
  :root{
    --bg0:#0a0d15; --bg1:#121a2e;
    --fg:#eaf0ff; --sub:#94a2c6; --faint:#5d6a8c;
    --glass:rgba(255,255,255,.055); --glass2:rgba(255,255,255,.09); --brd:rgba(255,255,255,.12);
    --brand:#6d8bff; --brand2:#b06dff; --accent:#34e3c8;
    --ok:#2bd47d; --err:#ff5d73;
    --blob1:rgba(109,139,255,.45); --blob2:rgba(176,109,255,.40); --blob3:rgba(52,227,200,.30);
    --shadow:0 18px 50px rgba(0,0,0,.45); --glow:0 0 0 1px rgba(255,255,255,.04), 0 10px 30px rgba(74,86,160,.25);
  }
  @media (prefers-color-scheme: light){
    :root{
      --bg0:#eaeefb; --bg1:#f4f1ff;
      --fg:#161d33; --sub:#5b6486; --faint:#8a93b0;
      --glass:rgba(255,255,255,.55); --glass2:rgba(255,255,255,.75); --brd:rgba(255,255,255,.7);
      --blob1:rgba(109,139,255,.30); --blob2:rgba(176,109,255,.26); --blob3:rgba(52,227,200,.22);
      --shadow:0 16px 40px rgba(70,84,150,.18); --glow:0 0 0 1px rgba(20,30,70,.04), 0 10px 28px rgba(110,124,200,.18);
    }
  }
  *{ box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body{ margin:0; padding:0; min-height:100%; }
  body{
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
    color:var(--fg); line-height:1.5; position:relative; overflow-x:hidden;
    background:
      radial-gradient(120% 80% at 50% -10%, var(--bg1), transparent 60%),
      linear-gradient(180deg, var(--bg0), var(--bg0));
    padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
  /* 渐变光晕 blobs */
  body::before, body::after{
    content:""; position:fixed; z-index:-1; border-radius:50%; filter:blur(70px); opacity:.9; pointer-events:none;
  }
  body::before{ width:360px; height:360px; left:-90px; top:-60px;
    background:radial-gradient(circle at 30% 30%, var(--blob1), transparent 70%); animation:float1 18s ease-in-out infinite; }
  body::after{ width:420px; height:420px; right:-120px; top:120px;
    background:radial-gradient(circle at 70% 40%, var(--blob2), transparent 70%); animation:float2 22s ease-in-out infinite; }
  .blob3{ position:fixed; z-index:-1; width:300px; height:300px; left:30%; bottom:-120px; border-radius:50%;
    filter:blur(70px); opacity:.8; pointer-events:none;
    background:radial-gradient(circle at 50% 50%, var(--blob3), transparent 70%); animation:float1 26s ease-in-out infinite reverse; }
  @keyframes float1{ 0%,100%{ transform:translate(0,0) scale(1);} 50%{ transform:translate(30px,40px) scale(1.08);} }
  @keyframes float2{ 0%,100%{ transform:translate(0,0) scale(1);} 50%{ transform:translate(-40px,30px) scale(1.1);} }
  @media (prefers-reduced-motion: reduce){ body::before, body::after, .blob3{ animation:none; } }

  .wrap{ max-width:560px; margin:0 auto; padding:14px 16px 56px; }

  /* 顶栏 */
  header.bar{ display:flex; align-items:center; gap:12px; padding:16px 2px 12px; }
  .logo{ width:46px; height:46px; border-radius:14px; flex:0 0 auto; position:relative;
    background:linear-gradient(135deg,var(--brand),var(--brand2)); display:flex; align-items:center; justify-content:center;
    color:#fff; box-shadow:0 8px 22px rgba(109,139,255,.45); }
  .logo svg{ width:24px; height:24px; }
  .htext{ flex:1; min-width:0; }
  .htext h1{ font-size:18px; margin:0; font-weight:680; letter-spacing:.01em;
    background:linear-gradient(90deg,var(--fg),var(--sub)); -webkit-background-clip:text; background-clip:text; }
  .htext .meta{ font-size:12.5px; color:var(--sub); display:flex; align-items:center; gap:8px; margin-top:4px; }
  .pill{ display:inline-flex; align-items:center; gap:7px; padding:4px 10px; border-radius:999px;
    background:var(--glass); border:1px solid var(--brd); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); }
  .dot{ width:8px; height:8px; border-radius:50%; background:var(--faint); flex:0 0 auto; transition:.3s; }
  .dot.on{ background:var(--ok); box-shadow:0 0 0 4px rgba(43,212,125,.18), 0 0 10px rgba(43,212,125,.6); }
  .dot.off{ background:var(--faint); }
  .desk{ display:inline-flex; align-items:center; gap:5px; color:var(--sub); }
  .desk svg{ width:14px; height:14px; opacity:.8; }

  /* 玻璃卡片 */
  .card{ position:relative; background:var(--glass); border:1px solid var(--brd); border-radius:20px; padding:16px;
    margin-top:14px; box-shadow:var(--shadow); backdrop-filter:blur(22px) saturate(160%);
    -webkit-backdrop-filter:blur(22px) saturate(160%); }
  .card h2{ font-size:12.5px; color:var(--sub); margin:0 0 12px; font-weight:600; letter-spacing:.04em;
    display:flex; align-items:center; gap:7px; }
  .card h2 svg{ width:15px; height:15px; opacity:.85; }

  /* 选择文件 / 文件夹 */
  .actions{ display:flex; gap:10px; }
  .pick{ flex:1; position:relative; overflow:hidden; border:1px solid var(--brd); border-radius:16px;
    background:linear-gradient(180deg,var(--glass2),transparent); padding:18px 10px 16px; text-align:center;
    cursor:pointer; transition:transform .15s, border-color .15s, box-shadow .15s; }
  .pick:active{ transform:scale(.97); border-color:var(--brand); box-shadow:0 0 0 3px rgba(109,139,255,.18); }
  .pick .ring{ width:46px; height:46px; margin:0 auto 8px; border-radius:14px; display:flex; align-items:center; justify-content:center;
    background:linear-gradient(135deg,rgba(109,139,255,.22),rgba(176,109,255,.22)); color:var(--brand); }
  .pick .ring svg{ width:24px; height:24px; }
  .pick .t{ font-size:14px; font-weight:640; }
  .pick .s{ font-size:11.5px; color:var(--sub); margin-top:2px; }
  .pick input{ position:absolute; inset:0; opacity:0; width:100%; height:100%; cursor:pointer; }

  /* 列表 */
  .list{ margin-top:2px; }
  .up,.offer{ display:flex; flex-direction:column; gap:9px; padding:12px; border:1px solid var(--brd);
    border-radius:14px; margin-top:10px; background:var(--glass2); }
  .uptop{ display:flex; align-items:center; gap:10px; }
  .fic{ width:30px; height:30px; flex:0 0 auto; border-radius:9px; display:flex; align-items:center; justify-content:center;
    background:rgba(109,139,255,.16); color:var(--brand); }
  .fic svg{ width:16px; height:16px; }
  .upname,.ofname{ flex:1; min-width:0; font-size:13.5px; font-weight:560; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .upstat,.ofsize{ font-size:12px; color:var(--sub); flex:0 0 auto; display:inline-flex; align-items:center; gap:4px; }
  .upstat svg{ width:14px; height:14px; }
  .up.done .upstat{ color:var(--ok); }
  .up.fail .upstat{ color:var(--err); }
  .pbar{ height:6px; border-radius:6px; background:rgba(255,255,255,.10); overflow:hidden; }
  .pbar i{ display:block; height:100%; width:0; border-radius:6px;
    background:linear-gradient(90deg,var(--brand),var(--brand2),var(--accent)); background-size:200% 100%;
    box-shadow:0 0 12px rgba(109,139,255,.5); transition:width .2s; animation:flow 2.4s linear infinite; }
  @keyframes flow{ to{ background-position:200% 0; } }
  .up.done .pbar i{ background:var(--ok); animation:none; box-shadow:0 0 12px rgba(43,212,125,.5); }
  .up.fail .pbar i{ background:var(--err); animation:none; box-shadow:none; }
  .offer{ flex-direction:row; align-items:center; gap:12px; }
  .ofinfo{ flex:1; min-width:0; }
  .dl{ flex:0 0 auto; display:inline-flex; align-items:center; gap:6px; text-decoration:none; color:#fff;
    font-size:13px; font-weight:640; padding:9px 15px; border-radius:11px;
    background:linear-gradient(135deg,var(--brand),var(--brand2)); box-shadow:0 6px 16px rgba(109,139,255,.4); }
  .dl svg{ width:15px; height:15px; }
  .dl:active{ filter:brightness(.93); transform:translateY(1px); }
  .empty{ text-align:center; color:var(--sub); font-size:13px; padding:16px 8px; }
  .hint{ display:none; align-items:flex-start; gap:8px; font-size:12px; color:var(--sub); margin:2px 2px 10px;
    padding:9px 11px; border-radius:11px; background:rgba(255,93,115,.10); border:1px solid rgba(255,93,115,.22); }
  .hint svg{ width:15px; height:15px; flex:0 0 auto; color:var(--err); margin-top:1px; }

  /* 名称行 */
  .row{ display:flex; align-items:center; gap:10px; }
  .nameinput{ flex:1; border:1px solid var(--brd); background:var(--glass2); color:var(--fg); border-radius:12px;
    padding:11px 13px; font-size:14px; outline:none; transition:border-color .15s, box-shadow .15s; }
  .nameinput:focus{ border-color:var(--brand); box-shadow:0 0 0 3px rgba(109,139,255,.18); }
  .ghost{ background:var(--glass2); border:1px solid var(--brd); color:var(--fg); border-radius:12px; padding:11px 16px;
    font-size:13px; font-weight:640; cursor:pointer; white-space:nowrap; }
  .ghost:active{ transform:scale(.97); }

  .tip{ font-size:11.5px; color:var(--faint); text-align:center; margin-top:20px; line-height:1.8;
    display:flex; align-items:center; justify-content:center; gap:7px; flex-wrap:wrap; }
  .tip svg{ width:14px; height:14px; opacity:.8; }

  /* 弹层（PIN + 微信引导） */
  .overlay{ position:fixed; inset:0; background:rgba(6,9,16,.62); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
    display:none; align-items:center; justify-content:center; padding:24px; z-index:50; }
  .modal{ width:100%; max-width:340px; background:var(--glass); border:1px solid var(--brd); border-radius:22px; padding:24px;
    box-shadow:var(--shadow); backdrop-filter:blur(26px) saturate(160%); -webkit-backdrop-filter:blur(26px) saturate(160%);
    text-align:center; }
  .modal .mic{ width:54px; height:54px; margin:0 auto 12px; border-radius:16px; display:flex; align-items:center; justify-content:center;
    background:linear-gradient(135deg,var(--brand),var(--brand2)); color:#fff; box-shadow:0 10px 24px rgba(109,139,255,.45); }
  .modal .mic svg{ width:28px; height:28px; }
  .modal h3{ margin:0 0 6px; font-size:17px; font-weight:680; }
  .modal p{ margin:0 0 16px; font-size:13px; color:var(--sub); line-height:1.7; }
  .pinbox{ width:100%; text-align:center; font-size:26px; letter-spacing:.45em; font-weight:720; border:1px solid var(--brd);
    border-radius:13px; padding:13px; background:var(--glass2); color:var(--fg); outline:none; }
  .pinbox:focus{ border-color:var(--brand); box-shadow:0 0 0 3px rgba(109,139,255,.18); }
  .perr{ color:var(--err); font-size:12px; min-height:16px; margin:8px 0 12px; }
  .btn{ width:100%; color:#fff; border:none; border-radius:14px; padding:14px; font-size:15px; font-weight:680; cursor:pointer;
    background:linear-gradient(135deg,var(--brand),var(--brand2)); box-shadow:0 10px 24px rgba(109,139,255,.4); }
  .btn:active{ filter:brightness(.95); transform:translateY(1px); }
  .linkbtn{ display:inline-block; margin-top:14px; background:none; border:none; color:var(--sub); font-size:12.5px;
    text-decoration:underline; cursor:pointer; }

  /* 微信引导 */
  .guide .garrow{ position:fixed; top:14px; right:16px; color:var(--accent); animation:bob 1.2s ease-in-out infinite; }
  .guide .garrow svg{ width:46px; height:46px; filter:drop-shadow(0 4px 12px rgba(52,227,200,.6)); }
  @keyframes bob{ 0%,100%{ transform:translate(0,0);} 50%{ transform:translate(6px,-6px);} }
  .gsteps{ text-align:left; margin:4px 0 18px; padding:0; list-style:none; }
  .gsteps li{ display:flex; align-items:center; gap:10px; font-size:13px; color:var(--fg); padding:7px 0; }
  .gsteps .n{ width:22px; height:22px; flex:0 0 auto; border-radius:50%; display:flex; align-items:center; justify-content:center;
    font-size:12px; font-weight:700; color:#fff; background:linear-gradient(135deg,var(--brand),var(--brand2)); }
</style>
</head>
<body>
<div class="blob3"></div>
<div class="wrap">
  <header class="bar">
    <div class="logo">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.2c-.4.5 0 1.3.6 1.3H10l-1.3 7.1c-.1.7.8 1.1 1.3.5L19.5 11c.4-.5 0-1.3-.6-1.3H14l1.3-6.9c.1-.7-.8-1.1-1.3-.5z"/></svg>
    </div>
    <div class="htext">
      <h1>闪传 LanDrop</h1>
      <div class="meta">
        <span class="pill"><span id="dot" class="dot off"></span><span id="stat">连接中…</span></span>
        <span id="deskwrap" class="desk"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg><b id="desk">桌面</b></span>
      </div>
    </div>
  </header>

  <div class="card">
    <h2><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>我的名称（对方看到的设备名）</h2>
    <div class="row">
      <input id="nm" class="nameinput" placeholder="例如：我的 iPhone" maxlength="24" />
      <button id="nmsave" class="ghost">保存</button>
    </div>
  </div>

  <div class="card">
    <h2><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M12 5l-6 6M12 5l6 6"/></svg>发送到桌面</h2>
    <div class="actions">
      <label class="pick">
        <div class="ring"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg></div>
        <div class="t">选择文件</div><div class="s">可多选</div>
        <input id="f" type="file" multiple />
      </label>
      <label class="pick">
        <div class="ring"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.4.6L11 7h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>
        <div class="t">选择文件夹</div><div class="s">保留层级</div>
        <input id="d" type="file" webkitdirectory directory multiple />
      </label>
    </div>
    <div id="uplist" class="list"></div>
  </div>

  <div class="card">
    <h2><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M12 19l-6-6M12 19l6-6"/></svg>桌面发来的文件</h2>
    <div id="dlhint" class="hint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg><span>当前在微信内置浏览器，<b>无法下载文件</b>。请点右上角「⋯」选「在浏览器打开」。</span></div>
    <div id="offers" class="list"></div>
    <div id="oempty" class="empty">暂无 · 桌面发送后会自动出现在这里</div>
  </div>

  <div class="tip">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z"/></svg>
    同一局域网（WiFi）内直连传输，文件不经过任何服务器。若长时间未连接，请回到桌面「手机互传」重新扫码。
  </div>
</div>

<div id="pin" class="overlay">
  <div class="modal">
    <div class="mic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
    <h3>输入配对码</h3>
    <p>在桌面「手机互传」面板查看 6 位 PIN，或重新扫描二维码自动连接。</p>
    <input id="pinv" class="pinbox" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="------" />
    <div id="pinerr" class="perr"></div>
    <button id="pinbtn" class="btn">配对</button>
  </div>
</div>

<div id="guide" class="overlay guide">
  <div class="garrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg></div>
  <div class="modal">
    <div class="mic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M16.5 7.5 13 13l-5.5 3.5L11 11z"/></svg></div>
    <h3>请在系统浏览器中打开</h3>
    <p id="gmsg">当前是<b>微信内置浏览器</b>，无法下载文件。请点击右上角「⋯」，选择「在浏览器打开」——打开后会自动连接，即可双向收发。</p>
    <ol class="gsteps">
      <li><span class="n">1</span>点击屏幕右上角「⋯」</li>
      <li><span class="n">2</span>选择「在浏览器打开」</li>
      <li><span class="n">3</span>自动连接，开始互传</li>
    </ol>
    <button id="gcont" class="linkbtn">仅需上传？仍在此继续 →</button>
  </div>
</div>

<script>
(function(){
  function el(id){ return document.getElementById(id); }

  // 内置浏览器识别：这些 webview 无法触发文件下载（尤其微信），引导用户改用系统浏览器。
  function detectInApp(ua){
    var s=(ua||'').toLowerCase();
    if (/micromessenger/.test(s)) return '微信内置浏览器';
    if (/weibo/.test(s)) return '微博内置浏览器';
    if (/dingtalk/.test(s)) return '钉钉内置浏览器';
    if (/feishu|lark/.test(s)) return '飞书内置浏览器';
    if (/qq\\/[0-9]/.test(s) && !/mqqbrowser/.test(s)) return 'QQ 内置浏览器';
    return '';
  }
  var inApp = detectInApp(navigator.userAgent);

  // 令牌仅从 URL fragment 读取（不进服务器日志）。在内置浏览器内**不**清除，
  // 以便用户「在浏览器打开」时系统浏览器仍带着令牌，自动配对（与微信会话归并为同一台）。
  var token='';
  var hm = location.hash.match(/[#&]t=([^&]+)/);
  if (hm){ token=decodeURIComponent(hm[1]); }

  var dotEl=el('dot'), statEl=el('stat'), deskEl=el('desk');
  var fInput=el('f'), dInput=el('d'), upList=el('uplist');
  var offersEl=el('offers'), oEmpty=el('oempty'), dlHint=el('dlhint');
  var pinOverlay=el('pin'), pinInput=el('pinv'), pinBtn=el('pinbtn'), pinErr=el('pinerr');
  var guideOverlay=el('guide'), guideMsg=el('gmsg'), guideCont=el('gcont');
  var nmInput=el('nm'), nmSave=el('nmsave');

  // 图标（line-icon，单引号字符串拼接，避免与外层模板冲突）
  var ICON = {
    file:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
    folder:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.4.6L11 7h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    down:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M12 15l-4-4M12 15l4-4M5 21h14"/></svg>',
    check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
  };

  function fmt(b){ if(!b) return '0 B'; var u=['B','KB','MB','GB','TB']; var i=Math.floor(Math.log(b)/Math.log(1024)); return (b/Math.pow(1024,i)).toFixed(i===0?0:1)+' '+u[i]; }
  function rid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,10); }
  function setStatus(ok, text){ dotEl.className='dot '+(ok?'on':'off'); statEl.textContent=text; }
  function myName(){ try{ return localStorage.getItem('ld_name')||''; }catch(e){ return ''; } }

  // 设备名
  nmInput.value = myName();
  nmSave.addEventListener('click', function(){
    var v=(nmInput.value||'').trim();
    try{ localStorage.setItem('ld_name', v); }catch(e){}
    nmSave.textContent='已保存'; setTimeout(function(){ nmSave.textContent='保存'; }, 1200);
    connect();
  });

  // 连接（用令牌换会话 Cookie；已有 Cookie 时直接复用）
  function connect(){
    setStatus(false,'连接中…');
    var xhr=new XMLHttpRequest();
    xhr.open('GET','/w/info');
    if (token) xhr.setRequestHeader('Authorization','Bearer '+token);
    var nm=myName(); if(nm) xhr.setRequestHeader('x-ld-name', encodeURIComponent(nm));
    xhr.onload=function(){
      if (xhr.status===200){
        var r={}; try{ r=JSON.parse(xhr.responseText); }catch(e){}
        deskEl.textContent = r.desktopName || '桌面';
        setStatus(true,'已连接'); hidePin();
        // 普通浏览器：连接成功后清除 URL 中的令牌（不留在地址栏/历史）。
        if (!inApp){ try{ history.replaceState(null,'',location.pathname); }catch(e){} }
        startEvents();
      } else if (xhr.status===401){
        setStatus(false,'需要配对'); showPin();
      } else if (xhr.status===403){
        setStatus(false,'桌面已关闭手机互传');
      } else {
        setStatus(false,'连接失败');
      }
    };
    xhr.onerror=function(){ setStatus(false,'网络错误'); };
    xhr.send();
  }

  // 上传队列（串行，逐个显示进度）
  var queue=[], busy=false;
  function enqueue(files){
    var batch = files.length>1 ? rid() : '';
    for (var i=0;i<files.length;i++){
      (function(file){
        var rel = (file.webkitRelativePath && file.webkitRelativePath.length) ? file.webkitRelativePath : file.name;
        var it = makeUpItem(rel||file.name, file.size);
        queue.push({ file:file, rel:rel||file.name, batch:batch, it:it });
      })(files[i]);
    }
    pump();
  }
  function pump(){
    if (busy) return;
    var job=queue.shift();
    if (!job) return;
    busy=true;
    uploadOne(job, function(){ busy=false; pump(); });
  }
  function uploadOne(job, done){
    var xhr=new XMLHttpRequest();
    xhr.open('POST','/w/upload');
    xhr.setRequestHeader('x-ld-file-name', encodeURIComponent(job.file.name));
    xhr.setRequestHeader('x-ld-rel-path', encodeURIComponent(job.rel));
    xhr.setRequestHeader('x-ld-file-size', String(job.file.size));
    xhr.setRequestHeader('x-ld-transfer-id', rid());
    if (job.batch) xhr.setRequestHeader('x-ld-batch-id', job.batch);
    xhr.upload.onprogress=function(e){ if(e.lengthComputable) setProgress(job.it, e.loaded, e.total); };
    xhr.onload=function(){
      if (xhr.status===200){ setDone(job.it); }
      else {
        var msg='失败'; try{ msg=JSON.parse(xhr.responseText).reason||msg; }catch(e){}
        setFail(job.it, msg);
        if (xhr.status===401){ showPin(); }
      }
      done();
    };
    xhr.onerror=function(){ setFail(job.it,'网络中断'); done(); };
    xhr.send(job.file);
  }
  function makeUpItem(name,size){
    var row=document.createElement('div'); row.className='up';
    var top=document.createElement('div'); top.className='uptop';
    var ic=document.createElement('div'); ic.className='fic'; ic.innerHTML=ICON.file;
    var nm=document.createElement('div'); nm.className='upname'; nm.textContent=name;
    var st=document.createElement('div'); st.className='upstat'; st.textContent=fmt(size);
    top.appendChild(ic); top.appendChild(nm); top.appendChild(st);
    var bar=document.createElement('div'); bar.className='pbar'; var fill=document.createElement('i'); bar.appendChild(fill);
    row.appendChild(top); row.appendChild(bar);
    upList.insertBefore(row, upList.firstChild);
    return { row:row, fill:fill, st:st };
  }
  function setProgress(it,loaded,total){ var p= total? Math.round(loaded/total*100):0; it.fill.style.width=p+'%'; it.st.textContent=p+'%'; }
  function setDone(it){ it.fill.style.width='100%'; it.row.className='up done'; it.st.innerHTML=ICON.check+'<span>已发送</span>'; }
  function setFail(it,msg){ it.row.className='up fail'; it.st.textContent=msg||'失败'; }

  fInput.addEventListener('change', function(){ if(fInput.files&&fInput.files.length){ enqueue(fInput.files); fInput.value=''; } });
  dInput.addEventListener('change', function(){ if(dInput.files&&dInput.files.length){ enqueue(dInput.files); dInput.value=''; } });

  // 下行：SSE 接收桌面推送的待下载文件
  var es=null;
  function startEvents(){
    if (es){ try{ es.close(); }catch(e){} }
    if (typeof EventSource==='undefined'){ pollOffers(); return; }
    try{ es=new EventSource('/w/events'); }catch(e){ pollOffers(); return; }
    es.addEventListener('offers', function(ev){ var l=[]; try{ l=JSON.parse(ev.data); }catch(e){} renderOffers(l); });
    es.addEventListener('hello', function(){ setStatus(true,'已连接'); });
    es.onerror=function(){ /* 浏览器自动重连 */ };
  }
  function pollOffers(){
    var xhr=new XMLHttpRequest(); xhr.open('GET','/w/outbox');
    xhr.onload=function(){ if(xhr.status===200){ var r={};try{r=JSON.parse(xhr.responseText);}catch(e){} renderOffers(r.offers||[]); } };
    xhr.send();
    setTimeout(pollOffers, 4000);
  }
  function renderOffers(list){
    offersEl.innerHTML='';
    if (!list || !list.length){ oEmpty.style.display='block'; dlHint.style.display='none'; return; }
    oEmpty.style.display='none';
    // 内置浏览器无法下载 → 收到待下载文件时提示改用系统浏览器。
    dlHint.style.display = inApp ? 'flex' : 'none';
    for (var i=0;i<list.length;i++){
      (function(o){
        var isZip = o.kind==='zip';
        var row=document.createElement('div'); row.className='offer';
        var ic=document.createElement('div'); ic.className='fic'; ic.innerHTML=isZip?ICON.folder:ICON.file;
        var info=document.createElement('div'); info.className='ofinfo';
        var nm=document.createElement('div'); nm.className='ofname'; nm.textContent=o.relPath||o.name;
        var sz=document.createElement('div'); sz.className='ofsize';
        sz.textContent=isZip ? (fmt(o.size)+' · '+(o.count||0)+' 个文件 · ZIP') : fmt(o.size);
        info.appendChild(nm); info.appendChild(sz);
        var a=document.createElement('a'); a.className='dl'; a.innerHTML=ICON.down+'<span>下载</span>';
        a.href='/w/download?id='+encodeURIComponent(o.id); a.setAttribute('download', o.name);
        row.appendChild(ic); row.appendChild(info); row.appendChild(a);
        offersEl.appendChild(row);
      })(list[i]);
    }
  }

  // PIN 配对
  function showPin(){ pinOverlay.style.display='flex'; }
  function hidePin(){ pinOverlay.style.display='none'; }
  pinBtn.addEventListener('click', function(){
    var v=(pinInput.value||'').replace(/\\D/g,'');
    if (v.length!==6){ pinErr.textContent='请输入 6 位数字 PIN'; return; }
    pinErr.textContent='';
    var xhr=new XMLHttpRequest(); xhr.open('POST','/w/pair');
    xhr.setRequestHeader('content-type','application/json');
    var nm=myName(); if(nm) xhr.setRequestHeader('x-ld-name', encodeURIComponent(nm));
    xhr.onload=function(){
      if (xhr.status===200){
        var r={}; try{ r=JSON.parse(xhr.responseText); }catch(e){}
        deskEl.textContent=r.desktopName||'桌面'; setStatus(true,'已连接'); hidePin(); startEvents();
      } else { pinErr.textContent='PIN 不正确或已失效'; }
    };
    xhr.onerror=function(){ pinErr.textContent='网络错误'; };
    xhr.send(JSON.stringify({ pin:v }));
  });

  // 微信/内置浏览器引导
  function showGuide(label){
    if (label) guideMsg.innerHTML='当前是<b>'+label+'</b>，无法下载文件。请点击右上角「⋯」，选择「在浏览器打开」——打开后会自动连接，即可双向收发。';
    guideOverlay.style.display='flex';
  }
  guideCont.addEventListener('click', function(){
    guideOverlay.style.display='none';
    connect(); // 用户坚持留在内置浏览器：建立会话（仅上传可用）。
  });

  if (inApp){
    setStatus(false,'请在浏览器打开');
    showGuide(inApp);
  } else {
    connect();
  }
})();
</script>
</body>
</html>`
