import {test,expect} from 'bun:test';
import type {Frame} from './diagnostics';
import type {UploadChannel} from './image-upload';
import {findImageCluster} from './image-directory';
import {readFileSync} from 'node:fs';

const EMPTY=new Uint8Array();
const concat=(...parts:Uint8Array[])=>{const result=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));let at=0;for(const b of parts){result.set(b,at);at+=b.length;}return result;};
const frame=(opcode:number,data:Uint8Array=EMPTY,extra:Partial<Frame>={}):Frame=>({command:true,opcode,sequence:172,needsResponse:false,data,raw:EMPTY,...extra});
function record(name='TEST.RES',cluster=0x10203040,{index=3,file=true,unicode=false}={}){
  const nameBytes=unicode?Uint8Array.from(Buffer.from(name,'utf16le')):new TextEncoder().encode(name);
  const data=new Uint8Array(8+nameBytes.length),view=new DataView(data.buffer);
  data[0]=(index<<2)|(file?1:0)|(unicode?0:2);view.setUint32(1,cluster);view.setUint16(5,1);data[7]=nameBytes.length;data.set(nameBytes,8);return data;
}
class Channel implements UploadChannel {
  commands=new Set<(f:Frame)=>void>();disconnects=new Set<(reason?:Error)=>void>();received=new WeakSet<Frame>();
  queries:{opcode:number;data:Uint8Array}[]=[];responses:{frame:Frame;data:Uint8Array;status?:number}[]=[];
  startData=EMPTY;status=0;pending=false;onStart?:()=>void;respondError?:Error;
  query(opcode:number,data:Uint8Array){this.queries.push({opcode,data:data.slice()});this.onStart?.();return this.pending?new Promise<Frame>(()=>{}):Promise.resolve(frame(opcode,this.startData,{command:false,status:this.status}));}
  sendData(){throw new Error('Directory lookup must not send file data');return Promise.resolve();}
  async respond(request:Frame,data:Uint8Array,status?:number){if(!this.received.has(request))throw new Error('Original frame identity required');this.responses.push({frame:request,data:data.slice(),status});if(this.respondError)throw this.respondError;}
  onCommand(listener:(f:Frame)=>void){this.commands.add(listener);return()=>{this.commands.delete(listener);};}
  onDisconnect(listener:(reason?:Error)=>void){this.disconnects.add(listener);return()=>{this.disconnects.delete(listener);};}
  emit(f:Frame){this.received.add(f);for(const listener of this.commands)listener(f);}
  data(bytes:Uint8Array){this.emit(frame(1,bytes,{xmOpcode:0x0c}));}
  stop(reason=1){this.emit(frame(0x0d,Uint8Array.of(reason),{needsResponse:true}));}
  page(data=record(),reason=1){this.data(data);this.stop(reason);}
}
const options=()=>({devHandler:0x12345678,devIndex:3,timeoutMs:1000});
const clean=(channel:Channel)=>{expect(channel.commands.size).toBe(0);expect(channel.disconnects.size).toBe(0);};

test('one exact root page finds TEST.RES and acknowledges same original stop frame',async()=>{
  const channel=new Channel();channel.onStart=()=>channel.page();expect(await findImageCluster(channel,options())).toBe(0x10203040);
  expect(channel.queries).toEqual([{opcode:12,data:Uint8Array.of(0,10,0,1,0x12,0x34,0x56,0x78,0,4,0,0,0,0)}]);expect(channel.responses).toHaveLength(1);expect(channel.responses[0].frame.sequence).toBe(172);expect(channel.responses[0].data).toEqual(Uint8Array.of(1));expect(channel.responses[0].status).toBe(0);clean(channel);
});

test('case-insensitive GBK/UTF16LE names and split records work for either valid stop reason',async()=>{
  for(const unicode of [true,false])for(const reason of [0,1]){
    const channel=new Channel(),pending=findImageCluster(channel,options()),data=concat(record('OTHER.RES',3),record('teSt.ReS',9,{unicode}));
    channel.data(data.subarray(0,3));channel.data(data.subarray(3,17));channel.data(data.subarray(17));channel.stop(reason);expect(await pending).toBe(9);expect(channel.responses[0].data).toEqual(Uint8Array.of(reason));clean(channel);
  }
});

test('physical directory fixture resolves its TEST1.RES entry instead of assuming TEST.RES',async()=>{
  const evidence=JSON.parse(readFileSync(new URL('../../../artifacts/root-browse-proof.json',import.meta.url),'utf8'));
  const entries=evidence.root_browse.records as {name:string;cluster:number;dev_index:number;file:boolean;unicode:boolean}[];
  const channel=new Channel();channel.onStart=()=>channel.page(concat(...entries.map(entry=>record(entry.name,entry.cluster,{index:entry.dev_index,file:entry.file,unicode:entry.unicode}))));
  expect(await findImageCluster(channel,options())).toBe(661);clean(channel);
});

test('alias lookup is case insensitive, prefers the upload name and rejects malformed aliases',async()=>{
  const alias=new Channel();alias.onStart=()=>alias.page(record('tEsT1.rEs',77,{unicode:true}));expect(await findImageCluster(alias,options())).toBe(77);clean(alias);
  const both=new Channel();both.onStart=()=>both.page(concat(record('TEST1.RES',77),record('TEST.RES',88)));expect(await findImageCluster(both,options())).toBe(88);clean(both);
  for(const [data,error] of [
    [concat(record('TEST1.RES',77),record('test1.res',78)),'Ambiguous'],
    [record('TEST1.RES',77,{file:false}),'directory'],[record('TEST1.RES',0),'zero cluster'],
    [record('TEST2.RES',77),'not found'],
  ] as const){const channel=new Channel();channel.onStart=()=>channel.page(data);await expect(findImageCluster(channel,options())).rejects.toThrow(error);clean(channel);}
});

test('watch storage index6 is accepted only when every record matches it',async()=>{
  const channel=new Channel(),pending=findImageCluster(channel,{...options(),devIndex:6});channel.page(record('TEST.RES',9,{index:6}));expect(await pending).toBe(9);clean(channel);
});

test('invalid storage, timeout and pre-aborted signal never open the channel',async()=>{
  for(const bad of [{devHandler:-1},{devHandler:0x100000000},{devIndex:0},{devIndex:5},{devIndex:3.5},{timeoutMs:0}]){
    const channel=new Channel();await expect(findImageCluster(channel,{...options(),...bad})).rejects.toThrow();expect(channel.queries).toHaveLength(0);clean(channel);
  }
  const channel=new Channel(),controller=new AbortController();controller.abort();await expect(findImageCluster(channel,{...options(),signal:controller.signal})).rejects.toThrow('cancelled');expect(channel.queries).toHaveLength(0);
});

test('missing, case-duplicate, directory, duplicate cluster and zero cluster fail closed',async()=>{
  for(const [data,error] of [
    [record('OTHER.RES'),'not found'],
    [concat(record('TEST.RES',3),record('test.res',4)),'Ambiguous'],
    [record('TEST.RES',3,{file:false}),'directory'],
    [concat(record('OTHER.RES',3),record('TEST.RES',3)),'duplicate'],
    [record('TEST.RES',0),'zero cluster'],
  ] as const){const channel=new Channel(),pending=findImageCluster(channel,options());channel.page(data);await expect(pending).rejects.toThrow(error);expect(channel.responses).toHaveLength(1);clean(channel);}
  const empty=new Channel(),read=findImageCluster(empty,options());empty.stop();await expect(read).rejects.toThrow('not found');clean(empty);
});

test('wrong device index, unknown flags and truncated records never yield clusters',async()=>{
  const flags=record();flags[0]|=128;
  for(const data of [record('TEST.RES',3,{index:5}),flags,record().subarray(0,7),record().subarray(0,15)]){
    const channel=new Channel(),pending=findImageCluster(channel,options());channel.page(data);await expect(pending).rejects.toThrow();clean(channel);
  }
});

test('invalid GBK, odd UTF16, invalid surrogate, zero and control filename bytes are rejected',async()=>{
  const badGbk=concat(record().subarray(0,8),Uint8Array.of(0x81));badGbk[7]=1;
  const odd=record('TEST.RES',3,{unicode:true}).subarray(0,23);odd[7]=15;
  const surrogate=record('TEST.RES',3,{unicode:true});surrogate[8]=0;surrogate[9]=0xd8;
  const zero=record();zero[7]=0;
  const nul=record();nul[10]=0;
  for(const data of [badGbk,odd,surrogate,zero,nul]){const channel=new Channel(),pending=findImageCluster(channel,options());channel.page(data);await expect(pending).rejects.toThrow('filename');clean(channel);}
});

test('more than10 records and over4096 directory bytes fail without pagination',async()=>{
  const many=concat(...Array.from({length:11},(_,i)=>record(i===0?'TEST.RES':`OTHER${i}`,i+1)));
  const channel=new Channel(),pending=findImageCluster(channel,options());channel.page(many);await expect(pending).rejects.toThrow('Too many');expect(channel.queries).toHaveLength(1);clean(channel);
  const large=new Channel(),read=findImageCluster(large,options());large.data(new Uint8Array(4097));await expect(read).rejects.toThrow('bounded page');expect(large.queries).toHaveLength(1);clean(large);
});

test('wrong extended opcode is ignored but empty/response-requested data is rejected',async()=>{
  const channel=new Channel(),pending=findImageCluster(channel,options());channel.emit(frame(1,Uint8Array.of(255),{xmOpcode:0x24}));channel.page();expect(await pending).toBe(0x10203040);clean(channel);
  for(const f of [frame(1,EMPTY,{xmOpcode:12}),frame(1,record(),{xmOpcode:12,needsResponse:true})]){const bad=new Channel(),read=findImageCluster(bad,options());bad.emit(f);await expect(read).rejects.toThrow('data');clean(bad);}
});

test('failed/unknown start responses reject early queued data and detach listeners',async()=>{
  for(const data of [new Uint8Array(3),new Uint8Array(5)]){const channel=new Channel();channel.startData=data;channel.onStart=()=>channel.page();await expect(findImageCluster(channel,options())).rejects.toThrow('start response');expect(channel.responses).toHaveLength(0);clean(channel);}
  const channel=new Channel();channel.status=1;await expect(findImageCluster(channel,options())).rejects.toThrow('start response');clean(channel);
  for(const size of [0,1,2,4]){const good=new Channel();good.startData=new Uint8Array(size);good.onStart=()=>good.page();expect(await findImageCluster(good,options())).toBe(0x10203040);clean(good);}
});

test('bad stop reason/shape/flags and failed acknowledgment never return a cluster',async()=>{
  for(const data of [EMPTY,Uint8Array.of(2),Uint8Array.of(1,0)]){const channel=new Channel(),pending=findImageCluster(channel,options());channel.data(record());channel.emit(frame(13,data,{needsResponse:true}));await expect(pending).rejects.toThrow('stop successfully');expect(channel.responses).toHaveLength(0);clean(channel);}
  const flag=new Channel(),read=findImageCluster(flag,options());flag.data(record());flag.emit(frame(13,Uint8Array.of(1)));await expect(read).rejects.toThrow('stop successfully');clean(flag);
  const ack=new Channel();ack.respondError=new Error('ACK failed');const pending=findImageCluster(ack,options());ack.page();await expect(pending).rejects.toThrow('ACK failed');clean(ack);
});

test('timeout, cancellation and disconnect clean listeners while a start query is pending',async()=>{
  const silent=new Channel();silent.pending=true;await expect(findImageCluster(silent,{...options(),timeoutMs:10})).rejects.toThrow('timeout');clean(silent);
  const cancelled=new Channel(),controller=new AbortController();cancelled.pending=true;const pending=findImageCluster(cancelled,{...options(),signal:controller.signal});controller.abort();await expect(pending).rejects.toThrow('cancelled');clean(cancelled);
  const disconnected=new Channel();disconnected.pending=true;const read=findImageCluster(disconnected,options());for(const listener of disconnected.disconnects)listener(new Error('Badge disconnected'));await expect(read).rejects.toThrow('disconnected');clean(disconnected);
});

test('concurrent lookup and queued command flood fail without extra directory requests',async()=>{
  const channel=new Channel(),pending=findImageCluster(channel,options());await expect(findImageCluster(channel,options())).rejects.toThrow('already running');channel.page();expect(await pending).toBe(0x10203040);clean(channel);
  const flood=new Channel(),read=findImageCluster(flood,options());for(let i=0;i<65;i++)flood.data(Uint8Array.of(1));await expect(read).rejects.toThrow('flood');expect(flood.queries).toHaveLength(1);clean(flood);
});
