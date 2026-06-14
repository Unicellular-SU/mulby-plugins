// 移动端网页（自包含单文件：HTML + 内联 CSS + 内联 JS）。
// 由 web-gateway 在 GET /m 直接以字符串返回——无需独立构建步骤，也不依赖运行时读取磁盘资源。
//
// 注意（维护约束）：本文件是一个 TS 模板字符串，内联 JS 内**不得**使用反引号或 ${}，
// 以免与外层模板字符串冲突，故内部一律使用字符串拼接。

export const MOBILE_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#4f7cff" />
<title>闪传 LanDrop · 手机互传</title>
<style>
  :root{
    --bg:#f4f6fb; --card:#ffffff; --fg:#1c2330; --sub:#6b7488; --line:#e7eaf2;
    --brand:#4f7cff; --brand2:#7b5cff; --ok:#1faa6b; --err:#e8553c; --shadow:0 6px 24px rgba(28,40,80,.08);
  }
  @media (prefers-color-scheme: dark){
    :root{ --bg:#11151c; --card:#1a2029; --fg:#e9edf5; --sub:#93a0b5; --line:#283040;
      --shadow:0 6px 24px rgba(0,0,0,.4); }
  }
  *{ box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body{ margin:0; padding:0; }
  body{ font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
    background:var(--bg); color:var(--fg); line-height:1.5;
    padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
  .wrap{ max-width:560px; margin:0 auto; padding:16px 16px 48px; }
  header.bar{ display:flex; align-items:center; gap:12px; padding:18px 4px 14px; }
  .logo{ width:40px; height:40px; border-radius:12px; flex:0 0 auto;
    background:linear-gradient(135deg,var(--brand),var(--brand2)); display:flex; align-items:center; justify-content:center;
    color:#fff; font-weight:700; font-size:18px; box-shadow:var(--shadow); }
  .htext{ flex:1; min-width:0; }
  .htext h1{ font-size:17px; margin:0; font-weight:650; }
  .htext .meta{ font-size:12.5px; color:var(--sub); display:flex; align-items:center; gap:6px; margin-top:2px; }
  .dot{ width:8px; height:8px; border-radius:50%; background:#c2c8d4; flex:0 0 auto; }
  .dot.on{ background:var(--ok); box-shadow:0 0 0 3px rgba(31,170,107,.18); }
  .dot.off{ background:#c2c8d4; }
  .card{ background:var(--card); border:1px solid var(--line); border-radius:18px; padding:16px; margin-top:14px; box-shadow:var(--shadow); }
  .card h2{ font-size:13px; color:var(--sub); margin:0 0 12px; font-weight:600; letter-spacing:.02em; text-transform:none; }
  .actions{ display:flex; gap:10px; }
  .pick{ flex:1; position:relative; overflow:hidden; border:1px dashed var(--line); border-radius:14px;
    background:linear-gradient(180deg,rgba(79,124,255,.06),rgba(79,124,255,0)); padding:18px 10px; text-align:center;
    cursor:pointer; transition:.15s; }
  .pick:active{ transform:scale(.98); border-color:var(--brand); }
  .pick .ic{ font-size:22px; }
  .pick .t{ font-size:13.5px; font-weight:600; margin-top:6px; }
  .pick .s{ font-size:11.5px; color:var(--sub); margin-top:2px; }
  .pick input{ position:absolute; inset:0; opacity:0; width:100%; height:100%; cursor:pointer; }
  .list{ margin-top:4px; }
  .up,.offer{ display:flex; flex-direction:column; gap:8px; padding:11px 12px; border:1px solid var(--line);
    border-radius:13px; margin-top:9px; background:var(--card); }
  .uptop{ display:flex; align-items:center; gap:10px; }
  .upname,.ofname{ flex:1; min-width:0; font-size:13.5px; font-weight:550; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .upstat,.ofsize{ font-size:12px; color:var(--sub); flex:0 0 auto; }
  .up.done .upstat{ color:var(--ok); }
  .up.fail .upstat{ color:var(--err); }
  .bar{ height:6px; border-radius:6px; background:var(--line); overflow:hidden; }
  .bar i{ display:block; height:100%; width:0; background:linear-gradient(90deg,var(--brand),var(--brand2)); transition:width .15s; }
  .up.done .bar i{ background:var(--ok); }
  .up.fail .bar i{ background:var(--err); }
  .offer{ flex-direction:row; align-items:center; gap:12px; }
  .ofinfo{ flex:1; min-width:0; }
  .dl{ flex:0 0 auto; text-decoration:none; background:var(--brand); color:#fff; font-size:13px; font-weight:600;
    padding:8px 16px; border-radius:10px; }
  .dl:active{ filter:brightness(.94); }
  .empty{ text-align:center; color:var(--sub); font-size:13px; padding:14px 8px; }
  .tip{ font-size:11.5px; color:var(--sub); text-align:center; margin-top:18px; line-height:1.7; }
  .row{ display:flex; align-items:center; gap:10px; }
  .nameinput{ flex:1; border:1px solid var(--line); background:transparent; color:var(--fg); border-radius:10px;
    padding:9px 12px; font-size:13.5px; outline:none; }
  .nameinput:focus{ border-color:var(--brand); }
  .ghost{ background:transparent; border:1px solid var(--line); color:var(--fg); border-radius:10px; padding:9px 14px;
    font-size:13px; font-weight:600; cursor:pointer; }
  .overlay{ position:fixed; inset:0; background:rgba(10,14,22,.55); backdrop-filter:blur(3px); display:none;
    align-items:center; justify-content:center; padding:24px; z-index:50; }
  .modal{ width:100%; max-width:340px; background:var(--card); border-radius:18px; padding:22px; box-shadow:var(--shadow); }
  .modal h3{ margin:0 0 6px; font-size:16px; }
  .modal p{ margin:0 0 16px; font-size:12.5px; color:var(--sub); }
  .pinbox{ width:100%; text-align:center; font-size:24px; letter-spacing:.4em; font-weight:700; border:1px solid var(--line);
    border-radius:12px; padding:12px; background:transparent; color:var(--fg); outline:none; }
  .pinbox:focus{ border-color:var(--brand); }
  .perr{ color:var(--err); font-size:12px; min-height:16px; margin:8px 0 12px; text-align:center; }
  .btn{ width:100%; background:var(--brand); color:#fff; border:none; border-radius:12px; padding:13px; font-size:15px;
    font-weight:650; cursor:pointer; }
  .btn:active{ filter:brightness(.95); }
</style>
</head>
<body>
<div class="wrap">
  <header class="bar">
    <div class="logo">闪</div>
    <div class="htext">
      <h1>闪传 LanDrop</h1>
      <div class="meta"><span id="dot" class="dot off"></span><span id="stat">连接中…</span><span id="deskwrap"> · <b id="desk">桌面</b></span></div>
    </div>
  </header>

  <div class="card">
    <h2>我的名称（对方看到的设备名）</h2>
    <div class="row">
      <input id="nm" class="nameinput" placeholder="例如：我的 iPhone" maxlength="24" />
      <button id="nmsave" class="ghost">保存</button>
    </div>
  </div>

  <div class="card">
    <h2>发送到桌面</h2>
    <div class="actions">
      <label class="pick">
        <div class="ic">📄</div><div class="t">选择文件</div><div class="s">可多选</div>
        <input id="f" type="file" multiple />
      </label>
      <label class="pick">
        <div class="ic">📁</div><div class="t">选择文件夹</div><div class="s">保留层级</div>
        <input id="d" type="file" webkitdirectory directory multiple />
      </label>
    </div>
    <div id="uplist" class="list"></div>
  </div>

  <div class="card">
    <h2>桌面发来的文件</h2>
    <div id="offers" class="list"></div>
    <div id="oempty" class="empty">暂无 · 桌面发送后会自动出现在这里</div>
  </div>

  <div class="tip">
    同一局域网（WiFi）内直连传输，文件不经过任何服务器。<br/>
    若长时间未连接，请回到桌面「手机互传」重新扫码。
  </div>
</div>

<div id="pin" class="overlay">
  <div class="modal">
    <h3>输入配对码</h3>
    <p>在桌面「手机互传」面板查看 6 位 PIN，或重新扫描二维码自动连接。</p>
    <input id="pinv" class="pinbox" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="------" />
    <div id="pinerr" class="perr"></div>
    <button id="pinbtn" class="btn">配对</button>
  </div>
</div>

<script>
(function(){
  var token = '';
  var hm = location.hash.match(/[#&]t=([^&]+)/);
  if (hm) { token = decodeURIComponent(hm[1]); try{ history.replaceState(null,'',location.pathname); }catch(e){} }

  function el(id){ return document.getElementById(id); }
  var dotEl=el('dot'), statEl=el('stat'), deskEl=el('desk');
  var fInput=el('f'), dInput=el('d'), upList=el('uplist');
  var offersEl=el('offers'), oEmpty=el('oempty');
  var pinOverlay=el('pin'), pinInput=el('pinv'), pinBtn=el('pinbtn'), pinErr=el('pinerr');
  var nmInput=el('nm'), nmSave=el('nmsave');

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
        setStatus(true,'已连接'); hidePin(); startEvents();
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
    var nm=document.createElement('div'); nm.className='upname'; nm.textContent=name;
    var st=document.createElement('div'); st.className='upstat'; st.textContent=fmt(size);
    top.appendChild(nm); top.appendChild(st);
    var bar=document.createElement('div'); bar.className='bar'; var fill=document.createElement('i'); bar.appendChild(fill);
    row.appendChild(top); row.appendChild(bar);
    upList.insertBefore(row, upList.firstChild);
    return { row:row, fill:fill, st:st };
  }
  function setProgress(it,loaded,total){ var p= total? Math.round(loaded/total*100):0; it.fill.style.width=p+'%'; it.st.textContent=p+'%'; }
  function setDone(it){ it.fill.style.width='100%'; it.row.className='up done'; it.st.textContent='已发送'; }
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
    if (!list || !list.length){ oEmpty.style.display='block'; return; }
    oEmpty.style.display='none';
    for (var i=0;i<list.length;i++){
      (function(o){
        var row=document.createElement('div'); row.className='offer';
        var info=document.createElement('div'); info.className='ofinfo';
        var nm=document.createElement('div'); nm.className='ofname'; nm.textContent=o.relPath||o.name;
        var sz=document.createElement('div'); sz.className='ofsize'; sz.textContent=fmt(o.size);
        info.appendChild(nm); info.appendChild(sz);
        var a=document.createElement('a'); a.className='dl'; a.textContent='下载';
        a.href='/w/download?id='+encodeURIComponent(o.id); a.setAttribute('download', o.name);
        row.appendChild(info); row.appendChild(a);
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

  connect();
})();
</script>
</body>
</html>`
