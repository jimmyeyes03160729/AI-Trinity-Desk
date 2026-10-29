import { z } from 'zod';

import { paneIds } from './ids';
export { paneIds } from './ids';
export const paneIdSchema = z.enum(paneIds);
export type PaneId = z.infer<typeof paneIdSchema>;
const text = z.string().max(8192).refine(v => !v.includes('\0'), '不可包含 NUL 字元');
const model=z.string().trim().max(200).refine(v=>v===''||/^[A-Za-z0-9][A-Za-z0-9._:/@+\-\[\]]*$/.test(v),'模型請填模型 ID 或別名，不可包含空白或控制字元');
export const commandSchema = z.object({ executable: text.min(1).max(2048), args: z.array(text).max(100) }).strict();
export const settingsSchema = z.object({
  version: z.literal(1),
  projectPath: z.string().max(4096),
  commands: z.object({ claude: commandSchema, antigravity: commandSchema, codex: commandSchema }).strict(),
  layout: z.enum(['columns', 'rows']),
  sizes: z.tuple([z.number().min(15).max(70), z.number().min(15).max(70), z.number().min(15).max(70)]).refine(v => Math.abs(v.reduce((a,b) => a+b, 0)-100) < 0.1, '欄位比例總和必須為 100'),
  fontSize: z.number().int().min(10).max(24),
  autoInstallMissing: z.boolean().default(true),
  visiblePanes:z.array(paneIdSchema).min(1).max(3).refine(v=>new Set(v).size===v.length,'顯示欄位不可重複').default([...paneIds]),
  models:z.object({claude:model,antigravity:model,codex:model}).strict().default({claude:'',antigravity:'',codex:''})
}).strict();
export type Settings = z.infer<typeof settingsSchema>;
export type Command = z.infer<typeof commandSchema>;
export const defaultSettings = (): Settings => ({ version: 1, projectPath: '', commands: {
  claude: { executable: 'claude', args: [] }, antigravity: { executable: 'agy', args: [] }, codex: { executable: 'codex', args: [] }
}, layout: 'columns', sizes: [34,33,33], fontSize: 14, autoInstallMissing: true,visiblePanes:[...paneIds],models:{claude:'',antigravity:'',codex:''} });
export const dimensionsSchema = z.object({ cols: z.number().int().min(2).max(1000), rows: z.number().int().min(1).max(500) }).strict();
export const startSchema = dimensionsSchema.extend({ id: paneIdSchema });
export const inputSchema = z.object({ id: paneIdSchema, session: z.string().uuid(), data: z.string().max(65536) }).strict();
export const resizeSchema = dimensionsSchema.extend({ id: paneIdSchema, session: z.string().uuid() });
export const ackSchema = z.object({ id: paneIdSchema, session: z.string().uuid(), bytes: z.number().int().min(1).max(65536) }).strict();
export type SessionInfo = { session: string; pid: number };
export type TerminalEvent = { id: PaneId; session: string; taskId?:string } & (
  { type: 'data'; data: string } | { type: 'exit'; exitCode: number; signal?: number } | { type: 'error'; message: string }
);
export type Detection = { id: PaneId; available: boolean; path?: string; message: string };
export type Environment = { platform: string; arch: string; node: string; electron: string; shell: string; results: Detection[] };
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export const cliTaskSchema=z.object({id:z.string().uuid(),provider:paneIdSchema,title:z.string().trim().min(1).max(120),projectPath:z.string().min(1).max(4096),model,createdAt:z.string().max(64),updatedAt:z.string().max(64),pinned:z.boolean(),archived:z.boolean(),nativeSessionId:z.string().uuid().optional(),launched:z.boolean().default(false)}).strict();
export type CliTask=z.infer<typeof cliTaskSchema>;
export type CliTaskInfo=CliTask&{running:boolean;resumeReady:boolean;warning?:string};
export type CliTaskList={tasks:CliTaskInfo[];selected?:string;warning?:string};
export const cliTaskCreateSchema=z.object({provider:paneIdSchema,title:z.string().trim().min(1).max(120),nativeSessionId:z.string().uuid().optional()}).strict();
export const cliTaskPatchSchema=z.object({id:z.string().uuid(),title:z.string().trim().min(1).max(120).optional(),pinned:z.boolean().optional(),archived:z.boolean().optional()}).strict();
export const cliTaskStartSchema=dimensionsSchema.extend({taskId:z.string().uuid()}).strict();
export const cliTaskInputSchema=z.object({taskId:z.string().uuid(),session:z.string().uuid(),data:z.string().max(65536)}).strict();
export const cliTaskResizeSchema=dimensionsSchema.extend({taskId:z.string().uuid(),session:z.string().uuid()}).strict();
export const cliTaskAckSchema=z.object({taskId:z.string().uuid(),session:z.string().uuid(),bytes:z.number().int().min(1).max(65536)}).strict();
export type InstallStatus = 'idle' | 'queued' | 'checking' | 'downloading' | 'installing' | 'ready' | 'error' | 'cancelled' | 'custom';
export type InstallState = { id: PaneId; status: InstallStatus; message: string; log: string; path?: string; source?: string };
export type ModelChoice={id:string;name:string};
export type UsageWindow={label:string;usedPercent:number;remainingPercent:number;resetsAt?:number};
export type ProviderInfo={id:PaneId;models:ModelChoice[];windows:UsageWindow[];usageText?:string;message:string;source:string;updatedAt:string};
export const discussionSchema=z.object({
  topic:z.string().trim().min(1).max(6000),
  participants:z.array(paneIdSchema).min(2).max(3).refine(ids=>new Set(ids).size===ids.length,'參與的 AI 不可重複'),
  rounds:z.number().int().min(1).max(5),
  timeoutSeconds:z.number().int().min(30).max(600).default(180),
  autoStopAgreement:z.boolean().optional()
}).strict();
export type DiscussionConfig=z.infer<typeof discussionSchema>;
export const continueDiscussionSchema=z.object({runId:z.string().uuid(),instruction:z.string().trim().max(3000),rounds:z.number().int().min(1).max(5),timeoutSeconds:z.number().int().min(30).max(600).default(180),participants:z.array(paneIdSchema).min(2).max(3).refine(ids=>new Set(ids).size===ids.length,'回答順序不可重複').optional()}).strict();
export type ContinueDiscussion=z.infer<typeof continueDiscussionSchema>;
export const extendDiscussionSchema=z.object({runId:z.string().uuid(),seconds:z.number().int().min(30).max(600)}).strict();
export const retryDiscussionSchema=z.object({runId:z.string().uuid(),timeoutSeconds:z.number().int().min(30).max(600)}).strict();
export type DiscussionBatch={startRound:number;rounds:number;messageStart:number;instruction:string;participants?:PaneId[];createdAt:string};
export type DiscussionMessage={id:string;provider:PaneId;round:number;text:string;model:string;agreement?:boolean;createdAt:string};
export type DiscussionState={runId?:string;status:'idle'|'running'|'stopping'|'completed'|'stopped'|'error';config?:DiscussionConfig;messages:DiscussionMessage[];batches?:DiscussionBatch[];models?:Partial<Record<PaneId,string>>;current?:PaneId;error?:string;errorKind?:'timeout'|'interrupted';endReason?:'agreement'|'round-limit';pendingTurn?:{round:number;endRound:number;providerIndex:number};turnDeadlineAt?:number;storageError?:string;updatedAt:string};
export const marketQuerySchema=z.object({view:z.enum(['popular','trending','recommended','search']),query:z.string().trim().max(80).default(''),refresh:z.boolean().default(false)}).strict();
export type MarketQuery=z.infer<typeof marketQuerySchema>;
export type ProjectSignal={tag:string;label:string;evidence:string[]};
export type ProjectProfile={name:string;signals:ProjectSignal[];scannedFiles:number;limited:boolean;warnings:string[];updatedAt:string};
export type MarketSkill={id:string;name:string;source:string;slug:string;titleZh:string;summaryZh:string;summaryKind:'reviewed'|'name-only'|'original'|'translated';summaryOriginal?:string;summaryFetchedAt?:string;translatedAt?:string;translationProvider?:PaneId;translationError?:string;tags:string[];installs?:number;rank?:number;reasons:string[];relevance?:number;marketUrl:string;sourceUrl:string};
export const skillEnrichSchema=z.object({ids:z.array(z.string().min(1).max(300)).min(1).max(4),provider:paneIdSchema}).strict();
export const skillInstallSchema=z.object({id:z.string().min(1).max(300),targets:z.array(paneIdSchema).min(1).max(3).refine(ids=>new Set(ids).size===ids.length)}).strict();
export type SkillInstallState={id:string;ai:PaneId;status:'queued'|'downloading'|'installing'|'installed'|'existing'|'error'|'cancelled';folder?:string;commit?:string;message:string};
export type MarketResult={skills:MarketSkill[];profile?:ProjectProfile;view:MarketQuery['view'];updatedAt:string;source:string;stale:boolean;warning?:string;total:number};
export const marketLinkSchema=z.object({id:z.string().max(300),target:z.enum(['market','source'])}).strict();
export interface DeskApi {
  cliTasks():Promise<Result<CliTaskList>>;
  createCliTask(value:z.infer<typeof cliTaskCreateSchema>):Promise<Result<CliTaskList>>;
  patchCliTask(value:z.infer<typeof cliTaskPatchSchema>):Promise<Result<CliTaskList>>;
  selectCliTask(id:string):Promise<Result<CliTaskList>>;
  bindCliTask(id:string,nativeSessionId:string):Promise<Result<CliTaskList>>;
  startCliTask(taskId:string,cols:number,rows:number):Promise<Result<SessionInfo>>;
  stopCliTask(taskId:string):Promise<Result<null>>;
  cliTaskInput(taskId:string,session:string,data:string):Promise<Result<null>>;
  cliTaskResize(taskId:string,session:string,cols:number,rows:number):Promise<Result<null>>;
  cliTaskAck(taskId:string,session:string,bytes:number):void;
  onCliTasks(listener:(state:CliTaskList)=>void):()=>void;
  loadSettings(): Promise<Result<{ settings: Settings; warning?: string }>>;
  saveSettings(settings: Settings): Promise<Result<Settings>>;
  chooseProject(): Promise<Result<string | null>>;
  detect(): Promise<Result<Environment>>;
  providerInfo(id:PaneId):Promise<Result<ProviderInfo>>;
  discussionState():Promise<Result<DiscussionState>>;
  startDiscussion(config:DiscussionConfig):Promise<Result<DiscussionState>>;
  continueDiscussion(config:ContinueDiscussion):Promise<Result<DiscussionState>>;
  extendDiscussion(config:z.infer<typeof extendDiscussionSchema>):Promise<Result<DiscussionState>>;
  retryDiscussion(config:z.infer<typeof retryDiscussionSchema>):Promise<Result<DiscussionState>>;
  stopDiscussion():Promise<Result<DiscussionState>>;
  onDiscussion(listener:(state:DiscussionState)=>void):()=>void;
  skillMarket(query:MarketQuery):Promise<Result<MarketResult>>;
  openSkillLink(value:z.infer<typeof marketLinkSchema>):Promise<Result<null>>;
  enrichSkills(value:z.infer<typeof skillEnrichSchema>):Promise<Result<MarketSkill[]>>;
  cancelSkillTranslation():Promise<Result<null>>;
  installSkill(value:z.infer<typeof skillInstallSchema>):Promise<Result<SkillInstallState[]>>;
  skillInstallations():Promise<Result<SkillInstallState[]>>;
  cancelSkillInstall(id:string):Promise<Result<null>>;
  onSkillInstall(listener:(states:SkillInstallState[])=>void):()=>void;
  installers(): Promise<Result<InstallState[]>>;
  ensureCli(): Promise<Result<InstallState[]>>;
  installCli(id: PaneId): Promise<Result<InstallState[]>>;
  cancelInstall(id: PaneId): Promise<Result<null>>;
  onInstall(listener: (states: InstallState[]) => void): () => void;
  start(id: PaneId, cols: number, rows: number): Promise<Result<SessionInfo>>;
  stop(id: PaneId): Promise<Result<null>>;
  input(id: PaneId, session: string, data: string): Promise<Result<null>>;
  resize(id: PaneId, session: string, cols: number, rows: number): Promise<Result<null>>;
  ack(id: PaneId, session: string, bytes: number): void;
  readClipboard(): Promise<Result<string>>;
  writeClipboard(text: string): Promise<Result<null>>;
  onTerminal(listener: (event: TerminalEvent) => void): () => void;
}
