const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),readline=require('node:readline');
const args=process.argv.slice(2),resume=args.indexOf('resume'),nativeId=resume>=0?args[resume+1]:crypto.randomUUID();
fs.writeFileSync(process.env.TRINITY_TASK_CAPTURE,JSON.stringify({id:nativeId}));
const file=path.join(process.cwd(),'context-'+nativeId+'.json');let messages=[];try{messages=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
console.log(`TASK_READY:${nativeId}:PID=${process.pid}:MODEL=${args[args.indexOf('--model')+1]||''}`);
console.log(`RESTORED:${messages.join('|')}`);
const input=readline.createInterface({input:process.stdin});input.on('line',line=>{
 if(line==='quit')process.exit(0);
 if(line==='fullscreen'){const rows=process.stdout.rows;process.stdout.write(`\x1b[?1049h\x1b[2J\x1b[HHEADER\x1b[${rows};1HFOOTER:task`);return;}
 messages.push(line);fs.writeFileSync(file,JSON.stringify(messages));console.log('TASK_ECHO:'+line);
});
