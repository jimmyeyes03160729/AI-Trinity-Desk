import { EventEmitter } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import type { Readable } from 'node:stream';

// The web server bundles electron/network.ts and electron/download-bridge.ts
// with `electron` aliased to this file. It implements the subset of
// Electron's net.request they use: manual redirects, header access, data
// streaming and abort. Responses are decompressed like Chromium does.
type Options = { url: string; method?: string; redirect?: 'manual' | 'follow'; useSessionCookies?: boolean };
class NodeResponse extends EventEmitter {
  constructor(public statusCode: number, public headers: Record<string, string | string[]>) { super(); }
}
class NodeRequest extends EventEmitter {
  private headers: Record<string, string> = {};
  private current?: http.ClientRequest;
  private pending?: string;
  private aborted = false;
  constructor(private options: Options) { super(); }
  setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; }
  end() { this.send(this.options.url); }
  followRedirect() { const next = this.pending; this.pending = undefined; if (next) this.send(next); }
  abort() { this.aborted = true; this.current?.destroy(); }
  private send(target: string) {
    if (this.aborted) return;
    const url = new URL(target);
    const client = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : undefined;
    if (!client) { this.emit('error', new Error('Unsupported protocol')); return; }
    const request = client.request(url, { method: this.options.method || 'GET', headers: { 'accept-encoding': 'gzip, deflate, br', ...this.headers } }, response => {
      const status = response.statusCode || 0, location = response.headers.location;
      if (status >= 300 && status < 400 && location && this.options.redirect !== 'follow') {
        response.resume();
        this.pending = new URL(location, url).href;
        this.emit('redirect', status, this.options.method || 'GET', this.pending);
        return;
      }
      const headers = { ...response.headers } as Record<string, string | string[]>;
      const encoding = String(response.headers['content-encoding'] || '').toLowerCase();
      let body: Readable = response;
      if (['gzip', 'x-gzip', 'deflate', 'br'].includes(encoding)) {
        body = response.pipe(encoding === 'br' ? zlib.createBrotliDecompress() : encoding === 'deflate' ? zlib.createInflate() : zlib.createGunzip());
        delete headers['content-encoding']; delete headers['content-length'];
      }
      const wrapped = new NodeResponse(status, headers);
      body.on('data', chunk => wrapped.emit('data', chunk));
      body.on('end', () => wrapped.emit('end'));
      body.on('error', error => wrapped.emit('error', error));
      response.on('error', error => wrapped.emit('error', error));
      this.emit('response', wrapped);
    });
    this.current = request;
    request.setTimeout(120000, () => request.destroy(new Error('Request timed out')));
    request.on('error', error => { if (!this.aborted) this.emit('error', error); });
    request.end();
  }
}
export const net = { request: (options: Options) => new NodeRequest(options) };
