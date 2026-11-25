import {test,expect} from 'bun:test';
import type {Frame} from './diagnostics';
import type {UploadChannel} from './image-upload';
import {readImageResource} from './image-backup';
import {encodeImageRes} from '../../../reference/image-res.mjs';
import {crc16} from '../../../reference/crc16.mjs';

const bytes=encodeImageRes(new Uint8Array(360*360*4).fill(255),360,360);
const frame=(opcode:number,data:Uint8Array,extra:Partial<Frame>={}):Frame=>({command:true,opcode,sequence:201,needsResponse:false,data,raw:new Uint8Array(),...extra});
const concat=(...arrays:Uint8Array[])=>{const result=new Uint8Array(arrays.reduce((n,b)=>n+b.length,0));let at=0;for(const b of arrays){result.set(b,at);at+=b.length;}return result;};
const u32=(n:number)=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n);return b;};
const u16=(n:number)=>Uint8Array.of(n>>>8,n&255);
class Channel implements UploadChannel {
  receivedFrames=new WeakSet<Frame>();
  listeners=new Set<(f:Frame)=>void>();disconnects=new Set<(error?:Error)=>void>();
  queries:{opcode:number;data:Uint8Array}[]=[];responses:{frame:Frame;data:Uint8Array;status?:number}[]=[];
  startData=concat(Uint8Array.of(2),u32(bytes.length));startStatus=0;
  onStart?:()=>void;respondError?:Error;pendingStart=false;
  query(opcode:number,data:Uint8Array){this.queries.push({opcode,data:data.slice()});this.onStart?.();return this.pendingStart?new Promise<Frame>(()=>{}):Promise.resolve(frame(opcode,this.startData,{command:false,status:this.startStatus}));}
  sendData(){throw new Error('Reader must never send file data');return Promise.resolve();}
  async respond(f:Frame,data:Uint8Array,status?:number){if(!this.receivedFrames.has(f))throw new Error('Response frame identity denied');this.responses.push({frame:f,data:data.slice(),status});if(this.respondError)throw this.respondError;}
  onCommand(listener:(f:Frame)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  onDisconnect(listener:(error?:Error)=>void){this.disconnects.add(listener);return()=>{this.disconnects.delete(listener);};}
  emit(f:Frame){this.receivedFrames.add(f);for(const listener of this.listeners)listener(f);}
  stop(reason=0){this.emit(frame(0x24,Uint8Array.of(0x80,reason),{needsResponse:true}));}
  data(chunk:Uint8Array,offset:number,crc:number){this.emit(frame(1,concat(u32(offset),u16(crc),chunk),{xmOpcode:0x24}));}
  pump(source=bytes){let crc=0;for(let offset=0;offset<source.length;offset+=333){const chunk=source.slice(offset,offset+333);crc=crc16(chunk,crc);this.data(chunk,offset,crc);}this.stop();}
}
const options=()=>({devHandler:0x12345678,expectedSize:bytes.length,expectedCrc:crc16(bytes),timeoutMs:1000});
const cleaned=(channel:Channel)=>{expect(channel.listeners.size).toBe(0);expect(channel.disconnects.size).toBe(0);};

test('reads exact fixed filename, accepts early queued data, validates and preserves same-sequence stop ACK',async()=>{
  const channel=new Channel();channel.onStart=()=>channel.pump();
  const result=await readImageResource(channel,options());expect(result).toEqual(bytes);
  expect(channel.queries).toHaveLength(1);expect(channel.queries[0]).toEqual({opcode:0x24,data:Uint8Array.of(2,0x12,0x34,0x56,0x78,0,0,0,0,8,84,69,83,84,46,82,69,83)});
  expect(channel.responses).toHaveLength(1);expect(channel.responses[0].frame.sequence).toBe(201);expect(channel.responses[0].data).toEqual(Uint8Array.of(0x80));expect(channel.responses[0].status).toBe(0);cleaned(channel);
});

test('bootstraps bounded file size from READ start without unsupported metadata query',async()=>{
  for(const metadata of [{},{expectedSize:bytes.length},{expectedCrc:crc16(bytes)}]){
    const channel=new Channel();channel.onStart=()=>channel.pump();
    const result=await readImageResource(channel,{devHandler:3,timeoutMs:1000,...metadata});expect(result).toEqual(bytes);expect(channel.queries).toHaveLength(1);expect(channel.queries[0].opcode).toBe(0x24);cleaned(channel);
  }
});

test('audited watch-file read serializes a discovered cluster with identical CRC and resource checks',async()=>{
  const channel=new Channel();channel.startData=concat(Uint8Array.of(1),u32(bytes.length));channel.onStart=()=>channel.pump();
  expect(await readImageResource(channel,{...options(),cluster:0x89abcdef})).toEqual(bytes);
  expect(channel.queries[0].data).toEqual(Uint8Array.of(1,0x12,0x34,0x56,0x78,0,0,0,0,0x89,0xab,0xcd,0xef));cleaned(channel);
  for(const cluster of [0,-1,1.5,0x100000000]){const invalid=new Channel();await expect(readImageResource(invalid,{...options(),cluster})).rejects.toThrow('cluster');expect(invalid.queries).toHaveLength(0);cleaned(invalid);}
  const mismatch=new Channel();mismatch.onStart=()=>mismatch.pump();await expect(readImageResource(mismatch,{...options(),cluster:66})).rejects.toThrow('start response');cleaned(mismatch);
});

test('untrusted READ start size zero or over300K fails before data acceptance',async()=>{
  for(const size of [0,300001,0xffffffff]){
    const channel=new Channel();channel.startData=concat(Uint8Array.of(2),u32(size));channel.onStart=()=>channel.pump();
    await expect(readImageResource(channel,{devHandler:3,timeoutMs:1000})).rejects.toThrow('start response or size');expect(channel.responses).toHaveLength(0);cleaned(channel);
  }
});

test('unknown metadata does not relax packet CRC, exact start size or internal RES checks',async()=>{
  const badCrc=new Channel(),bad=readImageResource(badCrc,{devHandler:3,timeoutMs:1000});badCrc.data(bytes.slice(0,20),0,crc16(bytes.slice(0,20))^1);await expect(bad).rejects.toThrow('cumulative');cleaned(badCrc);
  const early=new Channel(),short=readImageResource(early,{devHandler:3,timeoutMs:1000});early.stop();await expect(short).rejects.toThrow('exact expected size');cleaned(early);
  const damaged=bytes.slice();damaged[damaged.length-1]^=1;
  const invalid=new Channel(),broken=readImageResource(invalid,{devHandler:3,timeoutMs:1000});invalid.pump(damaged);await expect(broken).rejects.toThrow('payload CRC');cleaned(invalid);
});

test('rejects initial metadata and cancelled signal before any channel call',async()=>{
  for(const changed of [{expectedSize:0},{expectedSize:300001},{expectedSize:1.5},{expectedCrc:-1},{expectedCrc:65536},{devHandler:-1},{devHandler:0x100000000},{timeoutMs:0}]){
    const channel=new Channel();await expect(readImageResource(channel,{...options(),...changed})).rejects.toThrow();expect(channel.queries).toHaveLength(0);cleaned(channel);
  }
  const channel=new Channel(),controller=new AbortController();controller.abort();await expect(readImageResource(channel,{...options(),signal:controller.signal})).rejects.toThrow('cancelled');expect(channel.queries).toHaveLength(0);
});

test('rejects failed or mismatched start responses and detaches queued readers',async()=>{
  for(const data of [new Uint8Array(),concat(Uint8Array.of(0),u32(bytes.length)),concat(Uint8Array.of(2),u32(bytes.length+1)),concat(Uint8Array.of(2),u32(bytes.length),Uint8Array.of(0))]){
    const channel=new Channel();channel.startData=data;channel.onStart=()=>channel.pump();await expect(readImageResource(channel,options())).rejects.toThrow('start response');expect(channel.responses).toHaveLength(0);cleaned(channel);
  }
  const channel=new Channel();channel.startStatus=3;await expect(readImageResource(channel,options())).rejects.toThrow('start response');cleaned(channel);
});

test('rejects nonzero initial offset, gaps and duplicates before stop success',async()=>{
  for(const offset of [1,333]){
    const channel=new Channel();const pending=readImageResource(channel,options());channel.data(bytes.slice(0,20),offset,crc16(bytes.slice(0,20)));await expect(pending).rejects.toThrow('offset');cleaned(channel);
  }
  const channel=new Channel(),pending=readImageResource(channel,options()),chunk=bytes.slice(0,20);channel.data(chunk,0,crc16(chunk));channel.data(chunk,0,crc16(chunk));await expect(pending).rejects.toThrow('offset');cleaned(channel);
});

test('requires cumulative packet CRC rather than per-chunk checksum',async()=>{
  const channel=new Channel(),pending=readImageResource(channel,options()),a=bytes.slice(0,20),b=bytes.slice(20,40);
  channel.data(a,0,crc16(a));channel.data(b,20,crc16(b));await expect(pending).rejects.toThrow('cumulative');cleaned(channel);
});

test('rejects packets exceeding expected size and empty/incorrect extended data',async()=>{
  const channel=new Channel(),pending=readImageResource(channel,options());channel.data(new Uint8Array(bytes.length+1),0,0);await expect(pending).rejects.toThrow();cleaned(channel);
  const empty=new Channel(),read=readImageResource(empty,options());empty.data(new Uint8Array(),0,0);await expect(read).rejects.toThrow('data packet');cleaned(empty);
});

test('acknowledges stop receipt but rejects premature stop, total CRC mismatch and device errors',async()=>{
  const early=new Channel(),read=readImageResource(early,options());early.stop();await expect(read).rejects.toThrow('exact expected size');expect(early.responses[0].data).toEqual(Uint8Array.of(0x80));cleaned(early);
  const crc=new Channel(),pending=readImageResource(crc,{...options(),expectedCrc:crc16(bytes)^1});crc.pump();await expect(pending).rejects.toThrow('total CRC');cleaned(crc);
  const error=new Channel(),failed=readImageResource(error,options());error.stop(1);await expect(failed).rejects.toThrow('stopped');cleaned(error);
});

test('device cancellation is ACKed with operation81 and fails the read',async()=>{
  const channel=new Channel(),pending=readImageResource(channel,options());channel.emit(frame(0x24,Uint8Array.of(0x81,2),{needsResponse:true}));await expect(pending).rejects.toThrow('cancelled');expect(channel.responses[0].data).toEqual(Uint8Array.of(0x81));cleaned(channel);
});

test('resource internal CRC damage fails even if transport and expected total CRC match',async()=>{
  const damaged=bytes.slice();damaged[damaged.length-1]^=1;
  const channel=new Channel(),pending=readImageResource(channel,{...options(),expectedCrc:crc16(damaged)});channel.pump(damaged);await expect(pending).rejects.toThrow('payload CRC');cleaned(channel);
});

test('valid resources of other dimensions cannot become backup approval',async()=>{
  const small=encodeImageRes(new Uint8Array(4*4*4),4,4),channel=new Channel();channel.startData=concat(Uint8Array.of(2),u32(small.length));
  const pending=readImageResource(channel,{...options(),expectedSize:small.length,expectedCrc:crc16(small)});channel.pump(small);await expect(pending).rejects.toThrow('360');cleaned(channel);
});

test('abort and disconnect reject in-flight start and detach listeners',async()=>{
  const channel=new Channel(),controller=new AbortController();channel.pendingStart=true;const pending=readImageResource(channel,{...options(),signal:controller.signal});controller.abort();await expect(pending).rejects.toThrow('cancelled');cleaned(channel);
  const gone=new Channel();gone.pendingStart=true;const read=readImageResource(gone,options());for(const listener of gone.disconnects)listener(new Error('Disconnected'));await expect(read).rejects.toThrow('Disconnected');cleaned(gone);
});

test('timeouts, stop ACK failures, malformed stop and flood fail without returning backup',async()=>{
  const timeout=new Channel();await expect(readImageResource(timeout,{...options(),timeoutMs:10})).rejects.toThrow('timeout');cleaned(timeout);
  const ack=new Channel();ack.respondError=new Error('ACK send failed');const pending=readImageResource(ack,options());ack.pump();await expect(pending).rejects.toThrow('ACK send');cleaned(ack);
  const malformed=new Channel(),bad=readImageResource(malformed,options());malformed.emit(frame(0x24,Uint8Array.of(0x80),{needsResponse:true}));await expect(bad).rejects.toThrow('stop/cancel');cleaned(malformed);
  const flood=new Channel(),read=readImageResource(flood,options());for(let i=0;i<65;i++)flood.data(Uint8Array.of(1),0,0);await expect(read).rejects.toThrow('flood');cleaned(flood);
});

test('rejects concurrent reads on one channel and ignores unrelated data safely',async()=>{
  const channel=new Channel(),pending=readImageResource(channel,options());await expect(readImageResource(channel,options())).rejects.toThrow('already running');channel.emit(frame(1,Uint8Array.of(1),{xmOpcode:0x1d}));channel.pump();expect(await pending).toEqual(bytes);cleaned(channel);
});
