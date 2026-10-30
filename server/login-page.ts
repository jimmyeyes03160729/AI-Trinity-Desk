// Self-contained pages; the app bundle is only served after signing in.
const style = `
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c1017;color:#dde6f5;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC",sans-serif;padding:16px}
main{width:100%;max-width:400px;background:#121924;border:1px solid #243246;border-radius:14px;padding:28px}
.logo{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(135deg,#9ce5c3,#8bbaff);color:#0c1017;font-size:22px;font-weight:700;margin-bottom:14px}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 18px;color:#93a3ba;font-size:13px}
label{display:block;font-size:13px;color:#b7c4d8;margin:12px 0 6px}
input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid #2c3c53;background:#0c1118;color:#dde6f5;font-size:15px}
input:focus{outline:2px solid #8bbaff;outline-offset:1px}
button{margin-top:20px;width:100%;padding:11px;border:0;border-radius:8px;background:#9ce5c3;color:#0c1017;font-weight:600;font-size:15px;cursor:pointer}
button:disabled{opacity:.6;cursor:default}
.error{margin-top:14px;color:#f9818e;font-size:13px;min-height:1em}
.hint{font-size:12px;color:#7e8da3;margin-top:6px}
a{color:#8bbaff}`;
type Field = { id: string; label: string; type?: string; autocomplete: string; hint?: string };
function page(nonce: string, title: string, intro: string, fields: Field[], submit: string, endpoint: string, script = '') {
  const inputs = fields.map(f => `<label for="${f.id}">${f.label}</label><input id="${f.id}" name="${f.id}" type="${f.type || 'password'}" autocomplete="${f.autocomplete}" required ${f.type === 'text' ? 'autocapitalize="off" spellcheck="false"' : ''}>${f.hint ? `<div class="hint">${f.hint}</div>` : ''}`).join('');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title} · AI Trinity Desk</title><style nonce="${nonce}">${style}</style></head><body><main><div class="logo">△</div><h1>${title}</h1><p>${intro}</p>
<form id="form" novalidate>${inputs}<button id="submit" type="submit">${submit}</button><div class="error" id="error" role="alert"></div></form></main>
<script nonce="${nonce}">
const form=document.getElementById('form'),error=document.getElementById('error'),button=document.getElementById('submit');
${script}
form.addEventListener('submit',async event=>{
  event.preventDefault();error.textContent='';
  const value=Object.fromEntries(new FormData(form));
  if(typeof check==='function'){const problem=check(value);if(problem){error.textContent=problem;return;}}
  button.disabled=true;
  try{const response=await fetch('${endpoint}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),credentials:'same-origin'});
    const result=await response.json().catch(()=>({}));
    if(response.ok){location.replace('/');return;}
    error.textContent=result.error||'發生錯誤，請稍後再試。';
  }catch{error.textContent='無法連線到伺服器。';}
  button.disabled=false;
});
</script></body></html>`;
}
const confirm = `function check(v){if(v.password!==v.confirm)return '兩次輸入的密碼不一致。';}`;
export const setupPage = (nonce: string) => page(nonce, '建立登入帳號', '第一次使用：建立唯一的登入帳號。建立後無法再新增帳號；忘記密碼只能在主機上重設。', [
  { id: 'code', label: '設定碼', type: 'text', autocomplete: 'off', hint: '伺服器第一次啟動時顯示在 Mac mini 的終端機，也保存在資料目錄的 setup-code.txt。' },
  { id: 'username', label: '帳號', type: 'text', autocomplete: 'username', hint: '3–32 個英數字、點、底線或連字號。' },
  { id: 'password', label: '密碼', autocomplete: 'new-password', hint: '至少 12 個字元，不可包含帳號。建議用密碼管理器產生。' },
  { id: 'confirm', label: '再次輸入密碼', autocomplete: 'new-password' }
], '建立帳號並登入', '/api/setup', confirm);
export const loginPage = (nonce: string) => page(nonce, '登入 AI Trinity Desk', '登入後可從這台瀏覽器操作主機上的 Claude Code、Codex 與 Antigravity。', [
  { id: 'username', label: '帳號', type: 'text', autocomplete: 'username' },
  { id: 'password', label: '密碼', autocomplete: 'current-password' }
], '登入', '/api/login');
export const accountPage = (nonce: string, username: string) => page(nonce, '變更密碼', `帳號：${username.replace(/[^A-Za-z0-9._-]/g, '')}。變更後其他裝置會全部登出。<a href="/">返回工作台</a>`, [
  { id: 'current', label: '目前密碼', autocomplete: 'current-password' },
  { id: 'password', label: '新密碼', autocomplete: 'new-password', hint: '至少 12 個字元，不可包含帳號。' },
  { id: 'confirm', label: '再次輸入新密碼', autocomplete: 'new-password' }
], '變更密碼', '/api/password', confirm);
