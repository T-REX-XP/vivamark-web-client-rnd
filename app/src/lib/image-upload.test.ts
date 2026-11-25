import {test,expect} from 'bun:test';
import {uploadImage,temporaryImagePath,type UploadChannel} from './image-upload';
import type {Frame} from './diagnostics';
import {encodeImageRes} from '../../../reference/image-res.mjs';
import {crc16} from '../../../reference/crc16.mjs';
const data=new Uint8Array(360*360*4);for(let i=0;i<data.length;i+=4){data[i]=255;data[i+3]=255;}
const resource=encodeImageRes(data,360,360),EMPTY=new Uint8Array();
const frame=(opcode:number,data=EMPTY,command=false,status=0,sequence=7):Frame=>({opcode,data,command,status,sequence,raw:EMPTY});
const delay=()=>new Promise(resolve=>setTimeout(resolve,0));
class Device implements UploadChannel {
  commands=new Set<(f:Frame)=>void>();disconnects=new Set<(e?:Error)=>void>();queries:{opcode:number;data:Uint8Array}[]=[];sent:{xmOpcode:number;data:Uint8Array}[]=[];responses:{frame:Frame;data:Uint8Array;status:number}[]=[];
  system=1;width=360;height=360;free=1000000;supportsFlash=true;supportsNamedRead=true;packetCrc=true;negotiatedCrc=true;badVerify=false;mtu=128;statusOpcode=-1;insertResult=0;
  script:(d:Device)=>Promise<void>=async d=>{await d.pull(0,resource.length);d.emit(0x20);await delay();d.emit(0x1c,Uint8Array.of(0));};
  started=false;
  directoryCalls=0;directoryFailAt=0;directoryName='TEST.RES';
  onCommand(listener:(f:Frame)=>void){this.commands.add(listener);return()=>{this.commands.delete(listener);};}
  onDisconnect(listener:(e?:Error)=>void){this.disconnects.add(listener);return()=>{this.disconnects.delete(listener);};}
  emit(opcode:number,data=EMPTY){for(const cb of this.commands)cb(frame(opcode,data,true));}
  disconnect(){for(const cb of this.disconnects)cb(new Error('Badge disconnected'));}
  async query(opcode:number,bytes:Uint8Array){
    this.queries.push({opcode,data:bytes.slice()});let reply=EMPTY;
    if(opcode===3)reply=Uint8Array.of(2,19,this.supportsFlash?32:0,5,21,0,0,0,(this.packetCrc?1:0)|(this.supportsNamedRead?2:0));
    else if(opcode===0xd6){reply=new Uint8Array(24);const v=new DataView(reply.buffer);reply[8]=this.system;v.setUint32(0,4*1024*1024);v.setUint16(20,this.width);v.setUint16(22,this.height);}
    else if(opcode===7){reply=new Uint8Array(24);reply.set([255,22,2,8]);new DataView(reply.buffer).setUint32(16,0x12345678);}
    else if(opcode===0x1a){
      if(bytes[0]===12){reply=new Uint8Array(5);new DataView(reply.buffer).setUint32(1,this.free);}
      else if(bytes[0]===2)reply=Uint8Array.of(this.insertResult);
      else throw new Error('Unsupported flash operation');
    }else if(opcode===0x0c){
      this.directoryCalls++;reply=Uint8Array.of(1);
      if(this.directoryCalls===this.directoryFailAt)return frame(opcode,EMPTY,false,1);
      const name=new TextEncoder().encode(this.directoryName),record=new Uint8Array(8+name.length),v=new DataView(record.buffer);record[0]=15;v.setUint32(1,67);v.setUint16(5,1);record[7]=name.length;record.set(name,8);
      queueMicrotask(()=>{for(const cb of this.commands)cb({...frame(1,record,true),xmOpcode:12,needsResponse:false});for(const cb of this.commands)cb({...frame(13,Uint8Array.of(1),true),needsResponse:true});});
    }else if(opcode===0x27)reply=Uint8Array.of(0,this.negotiatedCrc?1:0);
    else if(opcode===0x1b){this.started=true;reply=Uint8Array.of(this.mtu>>>8,this.mtu&255);if(this.statusOpcode!==opcode)queueMicrotask(()=>{void this.script(this).catch(()=>{});});}
    else if(opcode===0x24&&bytes[0]===1){
      expect(bytes.length).toBe(13);expect(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(9)).toBe(67);
      reply=new Uint8Array(5);reply[0]=1;new DataView(reply.buffer).setUint32(1,resource.length);queueMicrotask(()=>{
      for(let at=0;at<resource.length;at+=2048){const end=Math.min(resource.length,at+2048),payload=new Uint8Array(6+end-at),v=new DataView(payload.buffer);v.setUint32(0,at);v.setUint16(4,crc16(resource.subarray(0,end)));payload.set(resource.subarray(at,end),6);if(this.badVerify&&this.started&&at===0)payload[6]^=1;for(const cb of this.commands)cb({...frame(1,payload,true),xmOpcode:0x24,needsResponse:false});}
      for(const cb of this.commands)cb({...frame(0x24,Uint8Array.of(128,0),true),needsResponse:true});
    });}
    else if(![0x21,0x1e].includes(opcode))throw new Error('Unexpected query');
    return frame(opcode,reply,false,this.statusOpcode===opcode?3:0);
  }
  async sendData(xmOpcode:number,data:Uint8Array){this.sent.push({xmOpcode,data:data.slice()});}
  async respond(request:Frame,data:Uint8Array,status=0){this.responses.push({frame:request,data:data.slice(),status});}
  async pull(offset:number,count:number){
    const p=new Uint8Array(7),v=new DataView(p.buffer);v.setUint16(1,count);v.setUint32(3,offset);const start=this.sent.length;this.emit(0x1d,p);
    const expected=Math.min(count,resource.length-offset),header=this.packetCrc&&this.negotiatedCrc?3:1;
    for(let i=0;i<100;i++){if(this.sent.slice(start).reduce((n,p)=>n+p.data.length-header,0)>=expected)return;await delay();}
    throw new Error('Mock pull did not complete');
  }
}
const opts={timeoutMs:300,maxDurationMs:2000,modifiedAt:0};
test('explicit readback follows exact wire order, dynamic handler, chunk CRC and verified completion',async()=>{
  const d=new Device(),progress:number[]=[];const result=await uploadImage(d,resource,{...opts,verifyReadback:true,onProgress:p=>progress.push(p.percent)});
  expect(result.bytesSent).toBe(resource.length);expect(result.verified).toBe(true);expect(progress.at(-1)).toBe(100);expect(progress.slice(0,-1).every(n=>n<100)).toBe(true);
  expect(d.queries.map(q=>q.opcode)).toEqual([3,214,7,26,26,33,39,27,12,36]);
  expect(d.queries[2].data).toEqual(Uint8Array.of(255,0,0,0,4));
  expect(d.queries[5].data).toEqual(Uint8Array.of(0));expect(d.queries[6].data).toEqual(Uint8Array.of(0,0x12,0x34,0x56,0x78,1));
  const insert=d.queries[4].data,v=new DataView(insert.buffer);expect(insert.slice(0,2)).toEqual(Uint8Array.of(2,1));expect(v.getUint32(2)).toBe(resource.length);expect(new TextDecoder().decode(insert.slice(6))).toBe('/TEST.RES');
  const start=d.queries[7].data,s=new DataView(start.buffer);expect(s.getUint32(0)).toBe(resource.length);expect(s.getUint16(4)).toBe(crc16(resource));expect(new TextDecoder().decode(start.slice(6))).toBe('5ed05b8c.tmp\0');expect(start.slice(6)).toEqual(temporaryImagePath(0));
  const reads=d.queries.filter(q=>q.opcode===36);expect(reads.map(q=>new DataView(q.data.buffer).getUint32(9))).toEqual([67]);
  expect(d.queries[8].data).toEqual(Uint8Array.of(0,10,0,1,0x12,0x34,0x56,0x78,0,4,0,0,0,0));
  let at=0;for(const [i,packet] of d.sent.entries()){expect(packet.xmOpcode).toBe(29);expect(packet.data[0]).toBe(i&255);const chunk=packet.data.slice(3);expect(packet.data[1]*256+packet.data[2]).toBe(crc16(chunk));expect(chunk).toEqual(resource.slice(at,at+chunk.length));at+=chunk.length;}expect(at).toBe(resource.length);
  expect(d.responses.map(r=>r.frame.opcode)).toEqual([32,28,13,36]);expect(new TextDecoder().decode(d.responses[0].data)).toBe('TEST.RES\0\0');expect(d.responses[1].data.length).toBe(0);expect(d.commands.size+d.disconnects.size).toBe(0);
});
test('out-of-order and duplicate pulls cover the file without inflating progress or chunk indexing',async()=>{
  const d=new Device(),split=Math.floor(resource.length/2);d.script=async d=>{await d.pull(split,resource.length-split);await d.pull(split,resource.length-split);await d.pull(0,split);d.emit(28,Uint8Array.of(0));};
  const result=await uploadImage(d,resource,opts);expect(result.bytesSent).toBe(resource.length);expect(result.transmittedBytes).toBe(resource.length*2-split);
  const starts=d.sent.filter(p=>p.data[0]===0);expect(starts.length).toBe(3);expect(d.responses.every(r=>r.frame.opcode!==29)).toBe(true);
});
test('CRC capability false skips negotiation and emits no per-chunk CRC',async()=>{
  const d=new Device();d.packetCrc=false;await uploadImage(d,resource,opts);expect(d.queries.some(q=>q.opcode===39)).toBe(false);expect(d.sent[0].data.slice(1)).toEqual(resource.slice(0,128));
  const negotiated=new Device();negotiated.negotiatedCrc=false;await uploadImage(negotiated,resource,opts);expect(negotiated.queries.some(q=>q.opcode===39)).toBe(true);expect(negotiated.sent[0].data.slice(1)).toEqual(resource.slice(0,128));
});
test('prerequisite failures send no mutating commands',async()=>{
  for(const alter of [(d:Device)=>{d.system=0;},(d:Device)=>{d.system=2;},(d:Device)=>{d.width=368;},(d:Device)=>{d.free=1;},(d:Device)=>{d.supportsFlash=false;}]){
    const d=new Device();alter(d);await expect(uploadImage(d,resource,opts)).rejects.toThrow();expect(d.queries.every(q=>[3,214,7].includes(q.opcode)||(q.opcode===26&&q.data[0]===12))).toBe(true);expect(d.commands.size+d.disconnects.size).toBe(0);
  }
});
test('transfer-start rejection sends no image data or retries and waits for a slow cancellation acknowledgement',async()=>{
  const d=new Device(),original=d.query.bind(d);let cancelled=false;
  d.query=async(opcode,bytes)=>{
    if(opcode===0x1e){await new Promise(resolve=>setTimeout(resolve,650));cancelled=true;}
    const result=await original(opcode,bytes);
    return opcode===0x1b?{...result,status:1}:result;
  };
  // Prevent the fake device from requesting bytes for the rejected start.
  d.statusOpcode=0x1b;
  await expect(uploadImage(d,resource,{timeoutMs:2000,maxDurationMs:5000})).rejects.toThrow('no image bytes were sent');
  expect(cancelled).toBe(true);expect(d.sent).toHaveLength(0);
  expect(d.queries.filter(q=>q.opcode===0x1b)).toHaveLength(1);
  expect(d.queries.filter(q=>q.opcode===0x1a&&q.data[0]===2)).toHaveLength(1);
  expect(d.queries.at(-1)?.opcode).toBe(0x1e);expect(d.commands.size+d.disconnects.size).toBe(0);
});
test('invalid/zero/out-of-bounds pull and early successful stop never succeed',async()=>{
  for(const bytes of [Uint8Array.of(0),Uint8Array.of(0,0,0,0,0,0,0),Uint8Array.of(0,0,1,255,255,255,255)]){
    const d=new Device();d.script=async d=>{d.emit(29,bytes);};await expect(uploadImage(d,resource,opts)).rejects.toThrow();expect(d.sent).toHaveLength(0);expect(d.queries.at(-1)?.opcode).toBe(30);expect(d.commands.size+d.disconnects.size).toBe(0);
  }
  const d=new Device();d.script=async d=>{d.emit(28,Uint8Array.of(0));};await expect(uploadImage(d,resource,opts)).rejects.toThrow('before all');expect(d.responses.at(-1)?.status).toBe(0);expect(d.queries.at(-1)?.opcode).not.toBe(30);
});
test('busy, flash insert rejection, CRC failure, out of space and readback mismatch fail',async()=>{
  const busy=new Device();busy.statusOpcode=33;await expect(uploadImage(busy,resource,opts)).rejects.toThrow('status 3');expect(busy.queries.at(-1)?.opcode).toBe(30);
  const insert=new Device();insert.insertResult=1;await expect(uploadImage(insert,resource,opts)).rejects.toThrow('insert rejected');
  for(const reason of [1,2,3,4]){const d=new Device();d.script=async d=>{d.emit(28,Uint8Array.of(reason));};await expect(uploadImage(d,resource,opts)).rejects.toThrow(`reason ${reason}`);expect(d.responses.at(-1)?.frame.opcode).toBe(28);}
  const d=new Device();d.badVerify=true;await expect(uploadImage(d,resource,{...opts,verifyReadback:true})).rejects.toThrow('CRC mismatch');expect(d.commands.size+d.disconnects.size).toBe(0);
});
test('disconnect, timeout, abort and concurrent upload isolation fail closed and clean listeners',async()=>{
  const d=new Device();d.script=async d=>{d.disconnect();};await expect(uploadImage(d,resource,opts)).rejects.toThrow('disconnected');expect(d.queries.at(-1)?.opcode).not.toBe(30);expect(d.commands.size+d.disconnects.size).toBe(0);
  const silent=new Device();silent.script=async()=>{};await expect(uploadImage(silent,resource,{...opts,timeoutMs:20})).rejects.toThrow('timeout');expect(silent.queries.at(-1)?.opcode).toBe(30);expect(silent.commands.size+silent.disconnects.size).toBe(0);
  const controller=new AbortController(),cancelled=new Device();cancelled.script=async()=>{controller.abort();};await expect(uploadImage(cancelled,resource,{...opts,signal:controller.signal})).rejects.toThrow('cancelled');expect(cancelled.queries.at(-1)?.opcode).toBe(30);
  const active=new Device();active.script=async()=>{};const first=uploadImage(active,resource,{...opts,timeoutMs:20});await expect(uploadImage(active,resource,opts)).rejects.toThrow('already running');await expect(first).rejects.toThrow('timeout');
});
test('resource validation and abort before start never open channel listeners',async()=>{
  const d=new Device(),controller=new AbortController();controller.abort();await expect(uploadImage(d,resource,{...opts,signal:controller.signal})).rejects.toThrow('cancelled');await expect(uploadImage(d,resource.slice(1),opts)).rejects.toThrow('Invalid RES');expect(d.queries).toHaveLength(0);expect(d.commands.size+d.disconnects.size).toBe(0);
});
test('default upload completes on device acknowledgment and never attempts directory or resource reads',async()=>{
  const d=new Device(),states:string[]=[],progress:number[]=[];d.directoryFailAt=1;d.badVerify=true;
  const result=await uploadImage(d,resource,{onState:state=>states.push(state),onProgress:p=>progress.push(p.percent)});
  const insertion=d.queries.findIndex(q=>q.opcode===26&&q.data[0]===2),start=d.queries.findIndex(q=>q.opcode===27);
  expect(insertion).toBeGreaterThan(0);expect(start).toBeGreaterThan(insertion);
  expect(d.queries.every(q=>q.opcode!==12&&q.opcode!==36)).toBe(true);expect(d.queries.map(q=>q.opcode)).toEqual([3,214,7,26,26,33,39,27]);
  expect(result.verified).toBe(false);expect(result.bytesSent).toBe(resource.length);expect(d.responses.at(-1)?.frame.opcode).toBe(28);expect(progress.at(-1)).toBe(100);
  expect(states).not.toContain('backing-up');expect(states).not.toContain('verifying');expect(states.at(-1)).toBe('complete');expect(d.commands.size+d.disconnects.size).toBe(0);
});
test('invalid MTU and malformed CRC negotiation fail before serving data',async()=>{
  for(const mtu of [0,4097,65535]){const d=new Device();d.mtu=mtu;d.script=async()=>{};await expect(uploadImage(d,resource,opts)).rejects.toThrow('MTU');expect(d.sent).toHaveLength(0);expect(d.queries.at(-1)?.opcode).toBe(30);}
  const d=new Device(),original=d.query.bind(d);d.query=async(opcode,bytes)=>{const reply=await original(opcode,bytes);return opcode===39?{...reply,data:Uint8Array.of(0,2)}:reply;};await expect(uploadImage(d,resource,opts)).rejects.toThrow('negotiation');expect(d.sent).toHaveLength(0);
});
test('watch cluster read does not depend on the unrelated named-read capability',async()=>{
  const d=new Device();d.supportsNamedRead=false;const result=await uploadImage(d,resource,{...opts,verifyReadback:true});expect(result.verified).toBe(true);expect(d.queries.filter(q=>q.opcode===36)).toHaveLength(1);expect(d.queries.filter(q=>q.opcode===36).every(q=>q.data[0]===1)).toBe(true);
});
test('post-upload directory failures prevent verified success without adding a pre-upload read',async()=>{
  for(const setup of [(d:Device)=>{d.directoryFailAt=1;},(d:Device)=>{d.directoryName='OTHER.RES';}]){
    const d=new Device(),progress:number[]=[];setup(d);await expect(uploadImage(d,resource,{...opts,verifyReadback:true,onProgress:p=>progress.push(p.percent)})).rejects.toThrow('readback verification failed');
    expect(d.queries.some(q=>q.opcode===26&&q.data[0]===2)).toBe(true);expect(d.started).toBe(true);expect(d.sent.length).toBeGreaterThan(0);
    expect(progress.includes(100)).toBe(false);expect(d.queries.filter(q=>q.opcode===36)).toHaveLength(0);expect(d.commands.size+d.disconnects.size).toBe(0);
  }
});
