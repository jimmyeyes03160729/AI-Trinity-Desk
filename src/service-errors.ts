import type { PaneId } from '../electron/contracts';
export function serviceError(id:PaneId,output:string):string|undefined {
  const text=output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'').replace(/\s+/g,' ');
  if(id==='antigravity' && /FAILED_PRECONDITION/i.test(text) && /User location is not supported/i.test(text))return 'Google 拒絕此 API 請求：目前使用地區不在支援範圍（400 FAILED_PRECONDITION）。重裝 CLI 或更換模型無法解除此服務限制，請核對 Google 帳號與地區資格。';
  if(id==='claude' && /Unable to connect to Anthropic services/i.test(text) && /Status\s*403/i.test(text))return 'Anthropic 服務拒絕連線（HTTP 403）。CLI 已安裝；請檢查網路、既有代理設定及服務支援區域。';
}
