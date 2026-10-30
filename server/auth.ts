import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

// One owner account, created once from the browser. There is no sign-up
// after that; a lost password is reset on the host with --reset-account.
const params = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => scrypt(password.normalize('NFKC'), salt, 64, params, (error, key) => error ? reject(error) : resolve(key)));
const sessionDays = 30;
const fileSchema = z.object({
  version: z.literal(2),
  username: z.string(), salt: z.string(), hash: z.string(),
  createdAt: z.string(), passwordChangedAt: z.string(),
  // Only hashes of session tokens are stored; a copied file cannot log in.
  sessions: z.record(z.string(), z.number()).default({})
});
type AuthFile = z.infer<typeof fileSchema>;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const usernameSchema = z.string().trim().regex(/^[A-Za-z0-9._-]{3,32}$/, '帳號需為 3–32 個英數字、點、底線或連字號。');
export function passwordProblem(password: string, username: string) {
  if (password.length < 12) return '密碼至少需要 12 個字元。';
  if (password.length > 256) return '密碼最多 256 個字元。';
  if (new Set(password).size < 5) return '密碼重複字元過多，請使用更不容易猜到的密碼。';
  if (username && password.toLowerCase().includes(username.toLowerCase())) return '密碼不可包含帳號名稱。';
  return undefined;
}
function equal(a: Buffer, b: Buffer) { return a.length === b.length && timingSafeEqual(a, b); }

export class Auth {
  private data?: AuthFile;
  private setupCode?: string;
  private settingUp = false;
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(private file: string) {}
  get configured() { return !!this.data; }
  get codeFile() { return path.join(path.dirname(this.file), 'setup-code.txt'); }
  async load() {
    try { this.data = fileSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('無法讀取 ' + this.file + '，請檢查檔案或執行 --reset-account：' + String(error)); }
    if (this.data) { await rm(this.codeFile, { force: true }); return undefined; }
    // Whoever reaches the page first must also be able to read the host's
    // console or data folder; this keeps strangers from claiming the account.
    this.setupCode = Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join('').replace(/(.{4})(?!$)/g, '$1-');
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await writeFile(this.codeFile, this.setupCode + '\n', { mode: 0o600 });
    return this.setupCode;
  }
  async reset() { await rm(this.file, { force: true }); this.data = undefined; }
  private async save() {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await writeFile(this.file + '.tmp', JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await rename(this.file + '.tmp', this.file);
  }
  private limit(address: string) {
    const entry = this.attempts.get(address);
    if (entry && entry.count >= 10 && entry.until > Date.now()) throw new Error('嘗試次數過多，請 15 分鐘後再試。');
  }
  private async failed(address: string) {
    const entry = this.attempts.get(address), now = Date.now();
    this.attempts.set(address, { count: entry && entry.until > now ? entry.count + 1 : 1, until: now + 15 * 60 * 1000 });
    if (this.attempts.size > 10000) this.attempts.clear();
    await sleep(600 + randomInt(400));
  }
  private issue() {
    const token = randomBytes(32).toString('base64url'), now = Date.now();
    for (const [key, expires] of Object.entries(this.data!.sessions)) if (expires < now) delete this.data!.sessions[key];
    this.data!.sessions[digest(token)] = now + sessionDays * 86400000;
    return { token, maxAge: sessionDays * 86400 };
  }
  async setup(input: { code: string; username: string; password: string }, address: string) {
    this.limit(address);
    if (this.data || !this.setupCode) throw new Error('帳號已建立，請直接登入。');
    const code = input.code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!equal(Buffer.from(code), Buffer.from(this.setupCode.replace(/-/g, '')))) { await this.failed(address); throw new Error('設定碼錯誤。請查看 Mac mini 上伺服器啟動時顯示的設定碼。'); }
    const username = usernameSchema.parse(input.username);
    const problem = passwordProblem(input.password, username);
    if (problem) throw new Error(problem);
    if (this.settingUp) throw new Error('帳號建立中，請稍候。');
    this.settingUp = true;
    try {
      const salt = randomBytes(16), now = new Date().toISOString();
      const hash = await derive(input.password, salt);
      if (this.data) throw new Error('帳號已建立，請直接登入。');
      this.data = { version: 2, username, salt: salt.toString('hex'), hash: hash.toString('hex'), createdAt: now, passwordChangedAt: now, sessions: {} };
      const session = this.issue();
      await this.save();
      this.setupCode = undefined;
      await rm(this.codeFile, { force: true });
      return session;
    } finally { this.settingUp = false; }
  }
  // Username and password are checked together and fail with the same
  // message, so a guess never reveals which part was wrong.
  private async verify(username: string, password: string) {
    if (!this.data) return false;
    const key = await derive(password, Buffer.from(this.data.salt, 'hex'));
    const name = createHash('sha256').update(username.trim().toLowerCase()).digest(), expected = createHash('sha256').update(this.data.username.toLowerCase()).digest();
    return equal(key, Buffer.from(this.data.hash, 'hex')) && equal(name, expected);
  }
  async login(username: string, password: string, address: string) {
    this.limit(address);
    if (!(await this.verify(username, password))) { await this.failed(address); return undefined; }
    this.attempts.delete(address);
    const session = this.issue();
    await this.save();
    return session;
  }
  async changePassword(token: string | undefined, current: string, next: string, address: string) {
    this.limit(address);
    if (!this.valid(token)) throw new Error('請重新登入。');
    if (!(await this.verify(this.data!.username, current))) { await this.failed(address); throw new Error('目前密碼錯誤。'); }
    const problem = passwordProblem(next, this.data!.username);
    if (problem) throw new Error(problem);
    const salt = randomBytes(16);
    this.data!.salt = salt.toString('hex');
    this.data!.hash = (await derive(next, salt)).toString('hex');
    this.data!.passwordChangedAt = new Date().toISOString();
    // Every other device signs out; this one receives a fresh session.
    this.data!.sessions = {};
    const session = this.issue();
    await this.save();
    return session;
  }
  get username() { return this.data?.username; }
  valid(token: string | undefined) {
    if (!token || !this.data) return false;
    const expires = this.data.sessions[digest(token)];
    return !!expires && expires > Date.now();
  }
  async logout(token: string | undefined) {
    if (!token || !this.data) return;
    delete this.data.sessions[digest(token)];
    await this.save();
  }
}
export function readCookie(header: string | undefined, name: string) {
  for (const part of (header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) { try { return decodeURIComponent(rest.join('=')); } catch { return undefined; } }
  }
  return undefined;
}
