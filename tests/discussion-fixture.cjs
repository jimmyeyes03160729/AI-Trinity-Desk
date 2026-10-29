const fs=require('node:fs');
const {spawn}=require('node:child_process');
const [mode,arg]=process.argv.slice(2);
process.stdin.setEncoding('utf8');let input='';process.stdin.on('data',data=>input+=data);
process.stdin.on('end',()=>{
  if(mode==='echo')process.stdout.write(input);
  else if(mode==='fail'){process.stderr.write('FIXTURE_FAILURE');process.exitCode=7;}
  else if(mode==='flood'){process.stdout.write('x'.repeat(1024*1024+100));setInterval(()=>{},1000);}
  else if(mode==='hang'){
    if(arg){const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});fs.writeFileSync(arg,String(child.pid));}
    setInterval(()=>{},1000);
  }else if(mode==='reply'){
    const data=JSON.parse(input);setTimeout(()=>process.stdout.write(JSON.stringify({result:`FIXTURE ${data.provider}: received ${data.historyLength} prior replies.`,is_error:false})),data.delayMs||0);
  }
});
