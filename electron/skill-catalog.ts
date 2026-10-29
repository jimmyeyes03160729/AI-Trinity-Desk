import type {MarketSkill} from './contracts';
type CatalogEntry={source:string;slug:string;title:string;summary:string;tags:string[]};
// Chinese summaries describe the linked skill's documented purpose. They are
// metadata, never instructions loaded into the running agents.
export const skillCatalog:CatalogEntry[]=[
  {source:'vercel-labs/agent-skills',slug:'vercel-react-best-practices',title:'React 效能最佳實務',summary:'整理 React／Next.js 的資料載入、重新渲染與套件大小優化規則，適合介面效能檢查。',tags:['react','next']},
  {source:'vercel-labs/agent-skills',slug:'vercel-composition-patterns',title:'React 元件組合模式',summary:'透過元件組合、Context 等模式設計可擴充的 React 元件介面，減少複雜條件與重複結構。',tags:['react']},
  {source:'vercel-labs/agent-skills',slug:'web-design-guidelines',title:'網頁介面與無障礙檢查',summary:'依網頁介面準則檢查互動、視覺與無障礙問題，適合已有介面的專案審查。',tags:['web','react','vue','svelte']},
  {source:'anthropics/skills',slug:'frontend-design',title:'前端介面設計',summary:'協助建立有一致視覺方向的前端介面，涵蓋字體、配色、布局與互動細節。',tags:['web','react','vue','svelte']},
  {source:'anthropics/skills',slug:'webapp-testing',title:'網頁應用測試',summary:'使用 Python 與 Playwright 檢查本機網頁應用，包含操作、畫面、元素與主控台紀錄。',tags:['web','react','vue','playwright']},
  {source:'obra/superpowers',slug:'systematic-debugging',title:'系統化除錯',summary:'先蒐集證據並找出根因，再驗證假設與修正，適合追查重現困難或跨元件的錯誤。',tags:['code','testing']},
  {source:'obra/superpowers',slug:'test-driven-development',title:'測試驅動開發',summary:'以失敗測試、最小實作及重構的循環開發功能，適合需要建立測試的程式專案。',tags:['code','testing']},
  {source:'obra/superpowers',slug:'verification-before-completion',title:'完成前驗證',summary:'在宣告工作完成前要求執行與檢查驗證證據，適合有建置或測試流程的專案。',tags:['code','testing']},
  {source:'wshobson/agents',slug:'python-testing-patterns',title:'Python 測試模式',summary:'整理 pytest、fixtures、模擬、參數化與非同步測試方法，適合 Python 程式與服務。',tags:['python','pytest']},
  {source:'wshobson/agents',slug:'sql-optimization-patterns',title:'SQL 查詢效能優化',summary:'從查詢計畫、索引與常見查詢模式追查資料庫效能問題，適合含 SQL 的應用。',tags:['sql','database','postgres']},
  {source:'supabase/agent-skills',slug:'supabase-postgres-best-practices',title:'PostgreSQL 最佳實務',summary:'針對 Supabase／PostgreSQL 的結構、查詢與效能提供實務指引，適合相關資料庫專案。',tags:['supabase','postgres']},
  {source:'anthropics/skills',slug:'docx',title:'Word 文件處理',summary:'協助建立、編輯及分析 Word 文件，適合專案內含文件範本或報告輸出的工作。',tags:['docx']},
  {source:'anthropics/skills',slug:'xlsx',title:'試算表處理',summary:'協助處理 Excel 與表格資料，適合試算表輸入、報表或資料整理工作。',tags:['xlsx','data']},
  {source:'anthropics/skills',slug:'pdf',title:'PDF 文件處理',summary:'協助讀取、產生與處理 PDF，適合文件擷取或報告輸出的專案。',tags:['pdf']},
  {source:'anthropics/skills',slug:'pptx',title:'簡報處理',summary:'協助建立與編輯 PowerPoint 簡報，適合專案內含簡報範本或簡報輸出需求。',tags:['pptx']},
  {source:'vercel-labs/skills',slug:'find-skills',title:'尋找適用的 Skills',summary:'協助在 Skills 生態系搜尋既有能力與來源，適合尚未確定要找哪類工具時參考。',tags:[]}
];
const dictionary:Record<string,string>={ai:'AI',agent:'代理',agents:'代理',browser:'瀏覽器',frontend:'前端',backend:'後端',design:'設計',testing:'測試',test:'測試',development:'開發',debugging:'除錯',security:'安全',review:'審查',code:'程式碼',codebase:'程式專案',architecture:'架構',data:'資料',database:'資料庫',performance:'效能',optimization:'優化',patterns:'模式',best:'最佳',practices:'實務',skills:'技能',skill:'技能',find:'搜尋',workflow:'工作流程',workflows:'工作流程',automation:'自動化',image:'圖像',video:'影片',generation:'生成',mobile:'行動應用',app:'應用',apps:'應用',api:'API',cli:'CLI',docs:'文件',documentation:'文件',python:'Python',react:'React',typescript:'TypeScript',javascript:'JavaScript',sql:'SQL',git:'Git',github:'GitHub',web:'網頁',writing:'撰寫',planning:'規劃',plan:'規劃',pdf:'PDF',xlsx:'Excel',docx:'Word',pptx:'PowerPoint'};
export function describeSkill(source:string,slug:string,name:string):Pick<MarketSkill,'titleZh'|'summaryZh'|'summaryKind'|'tags'>{
  const entry=skillCatalog.find(s=>s.source===source&&s.slug===slug);
  if(entry)return {titleZh:entry.title,summaryZh:entry.summary,summaryKind:'reviewed',tags:entry.tags};
  const title=name.split(/[-_:]+/).map(word=>dictionary[word.toLowerCase()]||word).join(' ');
  return {titleZh:title,summaryZh:`名稱用途提示：${title}。此項尚未整理來源內文，請開啟來源核對完整功能與使用條件。`,summaryKind:'name-only',tags:[]};
}
export function catalogSkills():MarketSkill[]{return skillCatalog.map(entry=>({id:`${entry.source}/${entry.slug}`,name:entry.slug,source:entry.source,slug:entry.slug,...describeSkill(entry.source,entry.slug,entry.slug),reasons:[],marketUrl:`https://www.skills.sh/${entry.source}/${entry.slug}`,sourceUrl:`https://github.com/${entry.source}`}));}
