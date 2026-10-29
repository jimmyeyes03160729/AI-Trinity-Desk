import type { Command } from './contracts';
export function commandWithModel(command:Command,model:string):Command {
  if(!model)return command;
  const args:string[]=[];
  for(let i=0;i<command.args.length;i++){
    const value=command.args[i];
    if(value==='--model'||value==='-m'){i++;continue;}
    if(value.startsWith('--model=')||value.startsWith('-m='))continue;
    args.push(value);
  }
  return {...command,args:[...args,'--model',model]};
}
