const readline = require('node:readline');
const tag = process.argv[2] || 'fixture';
console.log(`READY:${tag}:TTY=${!!process.stdin.isTTY}`);
console.log(`ARGS:${tag}:${JSON.stringify(process.argv.slice(3))}`);
process.stdout.on('resize', () => console.log(`RESIZE:${tag}:${process.stdout.columns}x${process.stdout.rows}`));
const terminalInput=readline.createInterface({ input: process.stdin });
terminalInput.on('SIGINT',()=>console.log(`INTERRUPT:${tag}`));
terminalInput.on('line', line => {
  if (line === 'cwd') { console.log(`CWD:${tag}:${process.cwd()}`); return; }
  if (line === 'ui') { console.log('Accept'); return; }
  if (line === 'status-ui') { console.log('\x1b[33m▶▶ auto mode on\x1b[0m (shift+tab to cycle) · esc to interrupt'); console.log('✻ Spinning… (9s · ↓ 247 tokens)'); return; }
  if (line === 'codex-ui') { console.log('› Ask Codex to do anything'); console.log('? for shortcuts   100% context left'); return; }
  if(line==='fullscreen'){
    process.stdout._refreshSize();const rows=process.stdout.rows;
    process.stdout.write(`\x1b[?1049h\x1b[2J\x1b[HHEADER:${tag}\x1b[${Math.max(1,rows-2)};1HPROMPT:${tag}\x1b[${Math.max(1,rows-1)};1HSTATUS:${tag}\x1b[${rows};1HFOOTER:${tag}`);return;
  }
  if(line==='normal'){process.stdout.write('\x1b[?1049l');return;}
  if(line==='region-error'){console.log('FAILED_PRECONDITION (code 400): User location is not supported for the API use.');return;}
  if (line === 'size') { process.stdout._refreshSize(); console.log(`DIM:${tag}:${process.stdout.columns}x${process.stdout.rows}`); return; }
  if (line === 'quit') process.exit(0);
  if (line === 'fail') process.exit(7);
  if (line === 'burst') { for (let i=0; i<10000; i++) console.log(`BURST:${tag}:${i}`); console.log(`BURST_DONE:${tag}`); return; }
  if (line === 'child') {
    const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    console.log(`CHILD:${tag}:${child.pid}`); return;
  }
  console.log(`ECHO:${tag}:${line}`);
});
