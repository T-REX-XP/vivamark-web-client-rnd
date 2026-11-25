// Auth response transform matched 552 original ARM64 emulation vectors.
// Physical mutual authentication succeeded; see docs/live-badge-validation.md.
import { createAuthChallenge, deriveAuthResponse } from '../../../reference/jieli-auth.mjs';
import {validateImageResource} from './resource-validation';
import {crc16} from '../../../reference/crc16.mjs';
import {encodeImageRes} from '../../../reference/image-res.mjs';
import type {UploadChannel,UploadOptions} from './image-upload';
export const UUIDS = { service: '0000ae00-0000-1000-8000-00805f9b34fb', write: '0000ae01-0000-1000-8000-00805f9b34fb', notify: '0000ae02-0000-1000-8000-00805f9b34fb' };
export type Frame = { command: boolean; opcode: number; sequence: number; status?: number; needsResponse?:boolean; xmOpcode?:number; data: Uint8Array; raw: Uint8Array };
export class RcspCommandError extends Error {
  readonly opcode:number;readonly status:number;readonly response:Uint8Array;
  constructor(frame:Frame){
    const operation=frame.opcode===0x24?' (read image file)':'';
    const detail=frame.data.length?`; response ${Array.from(frame.data,b=>b.toString(16).padStart(2,'0')).join('')}`:'';
    super(`RCSP command 0x${frame.opcode.toString(16).padStart(2,'0')}${operation} failed: status ${frame.status}${detail}`);
    this.name='RcspCommandError';this.opcode=frame.opcode;this.status=frame.status??-1;this.response=frame.data.slice();
  }
}
export type LogEntry = { direction: 'tx' | 'rx' | 'state'; message: string; hex?: string; simulated: boolean; timestamp: string };
const PASS = Uint8Array.of(2,112,97,115,115);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v,i) => v === b[i]);
const join = (a: Uint8Array,b: Uint8Array) => { const c = new Uint8Array(a.length+b.length); c.set(a); c.set(b,a.length); return c; };
export function assertReadOnlyQuery(opcode: number, data: Uint8Array) {
  if (!(data instanceof Uint8Array) || !Number.isInteger(opcode)) throw new Error('Read-only policy denied invalid query types');
  if (!(opcode === 3 && same(data,Uint8Array.of(255,255,255,255,0))) &&
      !(opcode === 0xd6 && data.length === 0) && !(opcode === 0x1a && same(data,Uint8Array.of(12,0)))) {
    throw new Error('Read-only policy denied this command or parameters');
  }
}
/** Narrow transaction-only policy. No raw flash/settings/delete/format command exists here. */
export function assertUploadRequest(opcode:number,data:Uint8Array,resource:Uint8Array) {
  try{assertReadOnlyQuery(opcode,data);return;}catch{}
  if(opcode===7&&same(data,Uint8Array.of(255,0,0,0,4)))return;
  if(opcode===0x0c&&data.length===14&&same(data.subarray(0,4),Uint8Array.of(0,10,0,1))&&same(data.subarray(8),Uint8Array.of(0,4,0,0,0,0)))return;
  const path=new TextEncoder().encode('/TEST.RES');
  if(opcode===0x1a&&data.length===path.length+2&&same(data.subarray(0,2),Uint8Array.of(11,0))&&same(data.subarray(2),path))return;
  if(opcode===0x1a&&data.length===path.length+6&&data[0]===2&&data[1]===1&&new DataView(data.buffer,data.byteOffset,data.byteLength).getUint32(2)===resource.length&&same(data.subarray(6),path))return;
  if(opcode===0x21&&same(data,Uint8Array.of(0)))return;
  if(opcode===0x27&&data.length===6&&data[0]===0&&data[5]===1)return;
  if(opcode===0x1b&&data.length===19){const v=new DataView(data.buffer,data.byteOffset,data.byteLength);if(v.getUint32(0)===resource.length&&v.getUint16(4)===crc16(resource)&&/^[0-9a-f]{8}\.tmp\x00$/.test(new TextDecoder().decode(data.subarray(6))))return;}
  if(opcode===0x1e&&data.length===0)return;
  if(opcode===0x24&&same(data,Uint8Array.of(129,0)))return;
  if(opcode===0x24&&data.length===13&&data[0]===1&&same(data.subarray(5,9),new Uint8Array(4))&&new DataView(data.buffer,data.byteOffset,data.byteLength).getUint32(9)>0)return;
  throw new Error('Image upload policy denied this command or parameters');
}
/** Strictly bounded interpretation of the statically recovered D6 layout. */
export function parseExternalFlash(data: Uint8Array) {
  if(data.length<18)throw new Error('Truncated filesystem capability response');
  const v=new DataView(data.buffer,data.byteOffset,data.byteLength),n=v.getUint16(16),end=18+n;
  if(n>1024 || end>data.length)throw new Error('Invalid capability version-list length');
  const extra=data.length-end;
  if(extra===1 || extra===3 || extra===5)throw new Error('Truncated optional capability field');
  return {flashBytes:v.getUint32(0),fatBytes:v.getUint32(4),system:data[8],systemStatus:data[9],
    backend:data[8]===0?'host-fat' as const:'device-filesystem' as const,watchVersion:v.getUint16(10),blockSize:v.getUint16(12),cluster:v.getUint16(14),
    versionBytes:data.slice(18,end),receiveMtu:extra>=2?v.getUint16(end):undefined,
    width:extra>=4?v.getUint16(end+2):undefined,height:extra>=6?v.getUint16(end+4):undefined};
}
export function parseFreeSpace(data: Uint8Array) {
  if(data.length!==5)throw new Error('Invalid free-space response length');
  if(data[0]!==0)throw new Error(`Free-space operation failed (${data[0]})`);
  // RcspWatch.getWatchSysLeftSize multiplies the response's KiB count by1024.
  return new DataView(data.buffer,data.byteOffset,data.byteLength).getUint32(1)*1024;
}
export function encodeFrame(opcode:number,sequence:number,data:Uint8Array,response=false,status=0,needsResponse=true,xmOpcode?:number) {
  for(const value of [opcode,sequence,status])if(!Number.isInteger(value)||value<0||value>255)throw new Error('Invalid RCSP byte');
  if(opcode===1&&(!Number.isInteger(xmOpcode)||xmOpcode!<0||xmOpcode!>255))throw new Error('Missing data extended opcode');
  const n=data.length+(response?2:1)+(opcode===1?1:0);if(n>8192)throw new Error('RCSP outgoing body limit');
  const out=new Uint8Array(n+8);out.set([254,220,186,response?0:(needsResponse?192:128),opcode,n>>>8,n&255]);
  let p=7;if(response)out[p++]=status;out[p++]=sequence;if(opcode===1)out[p++]=xmOpcode!;out.set(data,p);out[out.length-1]=239;return out;
}
/** Strict bounded parser: malformed framing fails the session rather than hiding corruption. */
export class FrameParser {
  private buffer = new Uint8Array();
  push(bytes: Uint8Array): Frame[] {
    if (this.buffer.length + bytes.length > 16_384) throw new Error('RCSP receive buffer limit');
    this.buffer = join(this.buffer,bytes); const frames: Frame[] = [];
    while (this.buffer.length >= 3) {
      const b = this.buffer;
      if (b[0] !== 254 || b[1] !== 220 || b[2] !== 186) throw new Error('RCSP prefix');
      if (b.length < 7) break;
      if (b[3] & 63) throw new Error('RCSP reserved flags');
      const command = !!(b[3]&128), n = b[5]*256+b[6], min = (command ? 1 : 2)+(b[4]===1?1:0);
      if (n < min || n > 8192) throw new Error('RCSP body length');
      if (b.length < n+8) break;
      if (b[n+7] !== 239) throw new Error('RCSP trailer');
      const raw = b.slice(0,n+8), sequence = b[command ? 7 : 8], status = command ? undefined : b[7];
      let p=command?8:9;const xmOpcode=b[4]===1?b[p++]:undefined;
      frames.push({command,opcode:b[4],sequence,status,needsResponse:!!(b[3]&64),xmOpcode,data:b.slice(p,n+7),raw});
      this.buffer = b.slice(n+8);
    }
    return frames;
  }
}
export class AuthMachine {
  state: 'idle'|'response'|'pass'|'done'|'failed' = 'idle';
  private challenge = new Uint8Array(); private buffer = new Uint8Array();
  constructor(private send: (bytes: Uint8Array)=>Promise<void>, private random = globalThis.crypto) {}
  async start() { if (this.state !== 'idle') throw new Error('Auth already started'); this.challenge = createAuthChallenge(this.random); this.state='response'; await this.send(this.challenge); }
  async receive(bytes: Uint8Array) {
    if (this.state === 'failed' || this.state === 'idle') throw new Error('Auth state');
    if (this.state === 'done') return bytes;
    if (this.buffer.length + bytes.length > 4096) throw new Error('Auth buffer limit');
    this.buffer = join(this.buffer,bytes);
    while (this.buffer.length && this.state !== 'done') {
      const kind=this.buffer[0], n=kind === 2 ? 5 : 17;
      if (kind>2) throw new Error('Auth record prefix');
      if (this.buffer.length<n) break;
      const record=this.buffer.slice(0,n); this.buffer=this.buffer.slice(n);
      if (this.state==='response') {
        if (kind!==1 || !same(record,deriveAuthResponse(this.challenge))) { this.state='failed'; throw new Error('Auth challenge mismatch'); }
        this.state='pass'; await this.send(PASS);
      } else if (kind===0) await this.send(deriveAuthResponse(record));
      else if (kind===2 && same(record,PASS)) this.state='done';
      else { this.state='failed'; throw new Error('Unexpected auth record'); }
    }
    const rest=this.state==='done' ? this.buffer : new Uint8Array(); if (this.state==='done') this.buffer=new Uint8Array(); return rest;
  }
}
type Transport = { send(bytes: Uint8Array):Promise<void>; close():void };
type Pending = { resolve:(frame:Frame)=>void; reject:(error:Error)=>void; timer:ReturnType<typeof setTimeout> };
export class DiagnosticsClient {
  connected=false; authenticated=false; simulated=false;deviceId="";
  private transport?:Transport; private parser=new FrameParser(); private auth?:AuthMachine;
  private pending=new Map<string,Pending>(); private seq=0; private tx=Promise.resolve(); private rx=Promise.resolve(); private generation=0;
  private uploadScope?:object;
  private commandListeners=new Set<(frame:Frame)=>void>();
  private disconnectListeners=new Set<(error:Error)=>void>();
  private authResolve?:()=>void; private authReject?:(error:Error)=>void; private authTimer?:ReturnType<typeof setTimeout>;
  constructor(private options:{log?:(entry:LogEntry)=>void;timeoutMs?:number}={}) {}
  private log(direction:LogEntry['direction'],message:string,bytes?:Uint8Array) { this.options.log?.({direction,message,hex:bytes?Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(' '):undefined,simulated:this.simulated,timestamp:new Date().toISOString()}); }
  private send(bytes:Uint8Array) {
    const generation=this.generation;
    const task=this.tx.then(async()=>{ if (!this.connected || generation!==this.generation || !this.transport) throw new Error('Disconnected'); this.log('tx','BLE transport bytes',bytes); await this.transport.send(bytes); });
    this.tx=task.catch(()=>{});void task.catch(error=>{if(generation===this.generation)this.disconnect(error instanceof Error?error:new Error(String(error)));});return task;
  }
  private receive=(bytes:Uint8Array)=> {
    const generation=this.generation;
    this.rx=this.rx.then(async()=>{
      if (generation!==this.generation || !this.connected) return;
      this.log('rx','BLE transport bytes',bytes);
      let rest=bytes;
      if (!this.authenticated) { rest=await this.auth!.receive(bytes); if(generation!==this.generation || !this.connected)return; if (this.auth!.state==='done') { this.authenticated=true; clearTimeout(this.authTimer); this.authResolve?.(); this.log('state','Authentication complete'); } }
      for (const frame of this.parser.push(rest)) {
        if(frame.command){if(this.uploadScope&&this.commandListeners.size){for(const listener of this.commandListeners)listener(frame);}else this.log('state',`Ignored unsolicited command 0x${frame.opcode.toString(16)} outside an upload`);continue;}
        const key=`${frame.opcode}:${frame.sequence}`, item=this.pending.get(key);
        if (!item) { this.log('state','Ignored unmatched response'); continue; }
        this.pending.delete(key); clearTimeout(item.timer);
        if (frame.status) {
          item.reject(new RcspCommandError(frame));
        } else item.resolve(frame);
      }
    }).catch(error=>{if(generation===this.generation)this.disconnect(error instanceof Error?error:new Error(String(error)));});
  };
  private async begin(transport:Transport, simulated:boolean) {
    this.transport=transport; this.simulated=simulated; this.connected=true; this.authenticated=false; this.parser=new FrameParser();
    this.auth=new AuthMachine(bytes=>this.send(bytes));
    const ready=new Promise<void>((resolve,reject)=>{this.authResolve=resolve;this.authReject=reject;this.authTimer=setTimeout(()=>this.disconnect(new Error('Authentication timeout')),this.options.timeoutMs??6000);});
    const generation=this.generation;
    void this.auth.start().catch(error=>{if(generation===this.generation)this.disconnect(error);}); await ready;
  }
  async connectBrowser() {
    if(this.uploadScope)throw new Error('An image upload is already active');
    this.disconnect(); this.simulated=false;
    const generation=this.generation;
    const bluetooth=(navigator as unknown as {bluetooth?:any}).bluetooth;
    if (!bluetooth) throw new Error('Web Bluetooth unavailable. Use a supported browser over HTTPS or localhost.');
    // The retained badge BLE identity also advertises its factory name D40(BLE)
    // without an AE00 service in advertising data. GATT is still AE00-scoped
    // and mutual authentication remains mandatory after selection.
    const device=await bluetooth.requestDevice({filters:[{name:'VivaMark'},{name:'D40(BLE)'},{services:[UUIDS.service]}],optionalServices:[UUIDS.service]});
    let close=()=>device.gatt.disconnect();
    const checkCurrent=()=>{if(generation!==this.generation)throw new Error('Connection cancelled');};
    try {
      checkCurrent();const server=await device.gatt.connect();checkCurrent();const service=await server.getPrimaryService(UUIDS.service);checkCurrent();
      const write=await service.getCharacteristic(UUIDS.write);checkCurrent();const notify=await service.getCharacteristic(UUIDS.notify);checkCurrent();
      if (!write.properties.write && !write.properties.writeWithoutResponse) throw new Error('No supported GATT write property');
      const disconnected=()=>{if(generation===this.generation)this.disconnect(new Error('Badge disconnected'));};
      const changed=(event:any)=> {if(generation!==this.generation)return;const v:DataView=event.target.value;this.receive(new Uint8Array(v.buffer,v.byteOffset,v.byteLength).slice());};
      device.addEventListener('gattserverdisconnected',disconnected); notify.addEventListener('characteristicvaluechanged',changed);
      close=()=>{device.removeEventListener('gattserverdisconnected',disconnected);notify.removeEventListener('characteristicvaluechanged',changed);device.gatt.disconnect();};
      // Subscribe before the very first challenge.
      await notify.startNotifications();checkCurrent();
      await this.begin({close,send:async bytes=>{for(let p=0;p<bytes.length;p+=20){checkCurrent();if(!server.connected)throw new Error('Badge disconnected');const chunk=bytes.slice(p,p+20);if(write.properties.write)await write.writeValueWithResponse(chunk);else await write.writeValueWithoutResponse(chunk);}}},false);this.deviceId=String(device.id??'VivaMark');
    } catch(error) {close();if(generation===this.generation)this.disconnect(error instanceof Error?error:new Error(String(error)));throw error;}
  }
  async connectSimulator() { if(this.uploadScope)throw new Error('An image upload is already active');this.disconnect(); this.simulated=true; const transport=new SimulatorTransport(this.receive); await this.begin(transport,true);this.deviceId='simulator'; this.log('state','Synthetic simulator: no physical badge connected'); }
  query(opcode:number,data:Uint8Array=new Uint8Array()):Promise<Frame> {
    try {assertReadOnlyQuery(opcode,data);} catch(error) {return Promise.reject(error);}
    if(this.uploadScope)return Promise.reject(new Error('An image upload is already active'));
    return this.request(opcode,data);
  }
  private request(opcode:number,data:Uint8Array):Promise<Frame>{
    if (!this.connected || !this.authenticated) return Promise.reject(new Error('Authenticate first'));
    if (this.pending.size>=32) return Promise.reject(new Error('Too many pending queries'));
    let sequence=this.seq++&255;
    while(this.pending.has(`${opcode}:${sequence}`)) sequence=this.seq++&255;
    const key=`${opcode}:${sequence}`;
    const generation=this.generation;
    return new Promise((resolve,reject)=>{
      // End the session on timeout: a delayed old sequence must not match a future query.
      const timer=setTimeout(()=>{if(generation===this.generation)this.disconnect(new Error('Query timeout'));},this.options.timeoutMs??5000);
      this.pending.set(key,{resolve,reject,timer});
      void this.send(encodeFrame(opcode,sequence,data)).catch(error=>{if(generation===this.generation)this.disconnect(error);});
    });
  }
  async uploadImageResource(bytes:Uint8Array,options:UploadOptions={}) {
    if(this.uploadScope||this.pending.size)throw new Error('Wait for the current device operation to finish');
    if(!this.connected||!this.authenticated)throw new Error('Connect and authenticate the badge first');
    const snapshot=bytes.slice(),decoded=validateImageResource(snapshot);
    if(decoded.width!==360||decoded.height!==360)throw new Error('Uploads require an exact 360×360 resource');
    const generation=this.generation,scope={};this.uploadScope=scope;
    const received=new WeakSet<Frame>(),ownedListeners=new Set<(frame:Frame)=>void>(),ownedDisconnects=new Set<(error:Error)=>void>();
    const current=()=>{if(this.uploadScope!==scope||generation!==this.generation||!this.connected||!this.authenticated)throw new Error('Upload connection is no longer active');};
    const channel:UploadChannel={
      query:(opcode,data=new Uint8Array())=>{current();assertUploadRequest(opcode,data,snapshot);return this.request(opcode,data);},
      sendData:async(xmOpcode,data)=>{current();if(xmOpcode!==0x1d||data.length<2||data.length>4099)throw new Error('Upload data policy denied this packet');await this.send(encodeFrame(1,this.seq++&255,data,false,0,false,xmOpcode));},
      respond:async(frame,data,status=0)=>{current();if(!received.has(frame)||!frame.command||![0x0d,0x20,0x1c,0x1e,0x24].includes(frame.opcode)||status!==0)throw new Error('Upload response policy denied this packet');const filename=Uint8Array.of(84,69,83,84,46,82,69,83,0,0);if(frame.opcode===0x20?!same(data,filename):frame.opcode===0x0d?(frame.data.length!==1||![0,1].includes(frame.data[0])||data.length!==1||data[0]!==frame.data[0]):frame.opcode===0x24?(frame.data.length!==2||![128,129].includes(frame.data[0])||data.length!==1||data[0]!==frame.data[0]):data.length!==0)throw new Error('Upload response payload denied');received.delete(frame);await this.send(encodeFrame(frame.opcode,frame.sequence,data,true,status));},
      onCommand:listener=>{current();const wrapped=(frame:Frame)=>{received.add(frame);listener(frame);};ownedListeners.add(wrapped);this.commandListeners.add(wrapped);return()=>{ownedListeners.delete(wrapped);this.commandListeners.delete(wrapped);};},
      onDisconnect:listener=>{ownedDisconnects.add(listener);this.disconnectListeners.add(listener);return()=>{ownedDisconnects.delete(listener);this.disconnectListeners.delete(listener);};}
    };
    try{const {uploadImage}=await import('./image-upload');current();return await uploadImage(channel,snapshot,options);}
    catch(error){if(generation===this.generation)this.disconnect(error instanceof Error?error:new Error(String(error)));throw error;}
    finally{for(const listener of ownedListeners)this.commandListeners.delete(listener);for(const listener of ownedDisconnects)this.disconnectListeners.delete(listener);if(this.uploadScope===scope)this.uploadScope=undefined;}
  }
  queryDeviceInfo() {return this.query(3,Uint8Array.of(255,255,255,255,0));}
  queryExternalFlash() {return this.query(0xd6);}
  queryFreeSpace() {return this.query(0x1a,Uint8Array.of(12,0));}
  disconnect(reason=new Error('Disconnected')) {
    const hadSession=this.connected || !!this.transport || !!this.authReject;
    this.generation++;this.uploadScope=undefined;this.deviceId=''; this.connected=false;this.authenticated=false;clearTimeout(this.authTimer);this.authReject?.(reason);this.authReject=undefined;this.authResolve=undefined;
    for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(reason);}this.pending.clear();
    for(const listener of [...this.disconnectListeners]){try{listener(reason);}catch{}}this.disconnectListeners.clear();this.commandListeners.clear();
    const transport=this.transport;this.transport=undefined;try{transport?.close();}finally{this.tx=Promise.resolve();this.rx=Promise.resolve();if(hadSession)this.log('state',`Disconnected: ${reason.message}`);}
  }
}
/** Synthetic badge with complete upload/backup/readback behavior; never physical evidence. */
export class SimulatorTransport implements Transport {
  private phase=0;private parser=new FrameParser();private closed=false;private deviceSequence=64;private readRun=0;
  private file:Uint8Array;private fileCluster=66;
  private upload?:{size:number;crc:number;bytes:Uint8Array;offset:number;pullEnd:number;index:number;packetCrc:boolean};
  private insertedSize=0;private packetCrc=false;
  constructor(private receive:(bytes:Uint8Array)=>void){const rgba=new Uint8Array(360*360*4);for(let i=0;i<rgba.length;i+=4){rgba[i]=23;rgba[i+1]=60;rgba[i+2]=53;rgba[i+3]=255;}this.file=encodeImageRes(rgba,360,360);}
  close(){this.closed=true;this.readRun++;}
  private emit(bytes:Uint8Array){queueMicrotask(()=>{if(!this.closed)this.receive(bytes);});}
  private device(opcode:number,data:Uint8Array,needsResponse=true,xmOpcode?:number){this.emit(encodeFrame(opcode,this.deviceSequence++&255,data,false,0,needsResponse,xmOpcode));}
  private response(frame:Frame,data=new Uint8Array(),status=0){this.emit(encodeFrame(frame.opcode,frame.sequence,data,true,status));}
  private pull(){const upload=this.upload;if(!upload)return;upload.pullEnd=Math.min(upload.size,upload.offset+4096);upload.index=0;const data=new Uint8Array(7),v=new DataView(data.buffer);v.setUint16(1,upload.pullEnd-upload.offset);v.setUint32(3,upload.offset);this.device(0x1d,data,false);}
  private async readFile(){
    const run=++this.readRun,file=this.file.slice();let checksum=0;
    for(let offset=0;offset<file.length;offset+=240){
      await new Promise(resolve=>setTimeout(resolve,0));if(this.closed||run!==this.readRun)return;
      const chunk=file.slice(offset,offset+240);checksum=crc16(chunk,checksum);const data=new Uint8Array(chunk.length+6),v=new DataView(data.buffer);v.setUint32(0,offset);v.setUint16(4,checksum);data.set(chunk,6);this.device(1,data,false,0x24);
    }
    if(!this.closed&&run===this.readRun)this.device(0x24,Uint8Array.of(0x80,0));
  }
  async send(bytes:Uint8Array){
    if(this.closed)throw new Error('Simulator closed');
    if(this.phase===0){this.phase=1;this.emit(deriveAuthResponse(bytes));return;}
    if(this.phase===1){if(!same(bytes,PASS))throw new Error('Simulator auth pass mismatch');const challenge=Uint8Array.from({length:17},(_,i)=>i);challenge[0]=0;this.phase=2;this.emit(challenge);return;}
    if(this.phase===2){const challenge=Uint8Array.from({length:17},(_,i)=>i);challenge[0]=0;if(!same(bytes,deriveAuthResponse(challenge)))throw new Error('Simulator mutual auth mismatch');this.phase=3;this.emit(PASS);return;}
    for(const frame of this.parser.push(bytes)){
      if(!frame.command){if(frame.opcode===0x20&&this.upload)this.pull();continue;}
      if(frame.opcode===1){
        const upload=this.upload;if(!upload||frame.xmOpcode!==0x1d)throw new Error('Simulator unexpected data');
        const extra=upload.packetCrc?3:1,data=frame.data,chunk=data.slice(extra);
        if(data[0]!==upload.index++||!chunk.length||upload.offset+chunk.length>upload.pullEnd)throw new Error('Simulator data range/index mismatch');
        if(upload.packetCrc&&new DataView(data.buffer,data.byteOffset,data.byteLength).getUint16(1)!==crc16(chunk))throw new Error('Simulator chunk CRC mismatch');
        upload.bytes.set(chunk,upload.offset);upload.offset+=chunk.length;
        if(upload.offset===upload.size){if(crc16(upload.bytes)!==upload.crc){this.device(0x1c,Uint8Array.of(3));}else{this.file=upload.bytes.slice();this.fileCluster++;this.device(0x1c,Uint8Array.of(0));}this.upload=undefined;}
        else if(upload.offset===upload.pullEnd)this.pull();continue;
      }
      if(frame.opcode===3){this.response(frame,Uint8Array.of(2,19,0x34,5,21,0,0,0,7));continue;}
      if(frame.opcode===0xd6){const data=new Uint8Array(24),v=new DataView(data.buffer);v.setUint32(0,4194304);v.setUint32(4,3145728);data[8]=1;v.setUint16(10,100);v.setUint16(12,4096);v.setUint16(14,1);v.setUint16(18,512);v.setUint16(20,360);v.setUint16(22,360);this.response(frame,data);continue;}
      if(frame.opcode===7&&same(frame.data,Uint8Array.of(255,0,0,0,4))){const data=new Uint8Array(24);data.set([255,22,2,8]);new DataView(data.buffer).setUint32(16,0x01020304);this.response(frame,data);continue;}
      if(frame.opcode===0x0c){
        assertUploadRequest(frame.opcode,frame.data,this.file);
        if(new DataView(frame.data.buffer,frame.data.byteOffset,frame.data.byteLength).getUint32(4)!==0x01020304)throw new Error('Simulator browse handler mismatch');
        const record=new Uint8Array(16),v=new DataView(record.buffer);record[0]=15;v.setUint32(1,this.fileCluster);v.setUint16(5,1);record[7]=8;record.set(new TextEncoder().encode('TEST.RES'),8);
        this.response(frame,Uint8Array.of(0,1));this.device(1,record,false,0x0c);this.device(0x0d,Uint8Array.of(1));continue;
      }
      if(frame.opcode===0x1a){const op=frame.data[0];if(op===12&&same(frame.data,Uint8Array.of(12,0))){this.response(frame,Uint8Array.of(0,0,0,8,0));continue;}
        if(op===11){const data=new Uint8Array(7),v=new DataView(data.buffer);v.setUint32(1,this.file.length);v.setUint16(5,crc16(this.file));this.response(frame,data);continue;}
        if(op===2&&frame.data[1]===1){this.insertedSize=new DataView(frame.data.buffer,frame.data.byteOffset,frame.data.byteLength).getUint32(2);this.response(frame,Uint8Array.of(0));continue;}
      }
      if(frame.opcode===0x24){if(frame.data[0]===0x81){this.readRun++;this.response(frame,Uint8Array.of(0x81));continue;}
        const view=new DataView(frame.data.buffer,frame.data.byteOffset,frame.data.byteLength);
        if(frame.data.length!==13||frame.data[0]!==1||view.getUint32(1)!==0x01020304||view.getUint32(5)!==0||view.getUint32(9)!==this.fileCluster)throw new Error('Simulator read request mismatch');
        const data=new Uint8Array(5);data[0]=1;new DataView(data.buffer).setUint32(1,this.file.length);this.response(frame,data);void this.readFile();continue;
      }
      if(frame.opcode===0x21&&same(frame.data,Uint8Array.of(0))){this.response(frame);continue;}
      if(frame.opcode===0x27&&frame.data.length===6){this.packetCrc=true;this.response(frame,Uint8Array.of(0,1));continue;}
      if(frame.opcode===0x1b){const v=new DataView(frame.data.buffer,frame.data.byteOffset,frame.data.byteLength),size=v.getUint32(0);if(size!==this.insertedSize||size>300000)throw new Error('Simulator upload size mismatch');this.upload={size,crc:v.getUint16(4),bytes:new Uint8Array(size),offset:0,pullEnd:0,index:0,packetCrc:this.packetCrc};this.response(frame,Uint8Array.of(0,240));this.device(0x20,new Uint8Array());continue;}
      if(frame.opcode===0x1e&&frame.data.length===0){this.upload=undefined;this.response(frame);continue;}
      throw new Error('Simulator policy denied command');
    }
  }
}
