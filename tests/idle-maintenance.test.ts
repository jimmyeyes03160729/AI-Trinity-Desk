import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { IdleGate, startMaintenanceServer } from '../electron/idle-maintenance';

test('gate tracks pending work, unknown state, the full idle interval, and exclusive restart', async () => {
  let clock = 0; let busy: string[] = []; let unknown: string[] = [];
  const gate = new IdleGate(() => ({busy, unknown}), () => clock);
  gate.status(); clock = 900_000; assert.equal(gate.acquire(), true);
  await assert.rejects(gate.track(() => 1), /安全重啟/);
  gate.release(); assert.equal(gate.acquire(), false);
  let finish!: () => void;
  const work = gate.track(() => new Promise<void>(resolve => { finish = resolve; }));
  clock += 1_000_000; assert.equal(gate.status().state, 'busy'); assert.equal(gate.acquire(), false);
  finish(); await work; gate.status(); clock += 899_000; assert.equal(gate.acquire(), false);
  clock += 1000; assert.equal(gate.acquire(), true); gate.release();
  unknown = ['hung renderer']; assert.equal(gate.status().state, 'unknown'); assert.equal(gate.acquire(0), false);
  unknown = []; busy = ['CLI open']; assert.equal(gate.status().state, 'busy');
  busy = []; gate.status(); clock += 900_000; assert.equal(gate.acquire(), true);
});
// The bridge is a Unix socket used only by the macOS desktop app.
const unixOnly = { skip: process.platform === 'win32' && 'Unix socket bridge is macOS-only' };
function request(socket: string, value: unknown) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const client = createConnection(socket); let data = '';
    client.setTimeout(3000, () => { client.destroy(); reject(new Error('timeout')); });
    client.on('connect', () => client.write(JSON.stringify(value) + '\n'));
    client.on('error', reject); client.on('data', chunk => data += chunk);
    client.on('end', () => { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } });
  });
}
test('local bridge rejects stale identity and unknown operations, serializes restart, and restricts access', unixOnly, async () => {
  const userData = await mkdtemp('/tmp/trinity-maintenance-'); let calls = 0;
  const options = {userData, status: async () => ({state:'idle' as const, reason:'fixture', idleForSeconds:1000}), restart: async () => { calls++; return {accepted:true, reason:'fixture; no actual restart'}; }};
  const server = await startMaintenanceServer(options);
  try {
    assert.equal((await stat(server.socketPath)).mode & 0o777, 0o600);
    const status = await request(server.socketPath, {op:'status'});
    assert.equal(status.state, 'idle'); assert.equal(status.pid, process.pid); assert.equal(status.protocol, 1);
    assert.equal((await request(server.socketPath, {op:'restart', instance:'stale', pid:process.pid})).accepted, false); assert.equal(calls, 0);
    assert.equal((await request(server.socketPath, {op:'restart', instance:server.instance, pid:process.pid+1})).accepted, false); assert.equal(calls, 0);
    assert.equal((await request(server.socketPath, {op:'shell', command:'never execute'})).accepted, false);
    assert.equal((await request(server.socketPath, {op:'restart', instance:server.instance, pid:process.pid})).accepted, true);
    assert.equal((await request(server.socketPath, {op:'restart', instance:server.instance, pid:process.pid})).accepted, false); assert.equal(calls, 1);
    await assert.rejects(startMaintenanceServer(options), /已有/);
  } finally { await server.close(); await rm(userData, {recursive:true,force:true}); }
});
test('bridge never replaces an unrelated file', unixOnly, async () => {
  const userData = await mkdtemp('/tmp/trinity-maintenance-');
  try { await writeFile(userData+'/memory-guard.sock', 'do not overwrite'); await assert.rejects(startMaintenanceServer({userData, status:async()=>({state:'idle',reason:'',idleForSeconds:0}),restart:async()=>({accepted:true,reason:''})}), /占用/); }
  finally { await rm(userData, {recursive:true,force:true}); }
});
