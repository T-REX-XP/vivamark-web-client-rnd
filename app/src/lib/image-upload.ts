import type {Frame} from './diagnostics';
import {parseExternalFlash,parseFreeSpace,RcspCommandError} from './diagnostics';
import {parseTargetUploadCapabilities,parseWatchStorage} from './upload-capabilities';
import {validateImageResource} from './resource-validation';
import {readImageResource} from './image-backup';
import {findImageCluster} from './image-directory';
import {crc16} from '../../../reference/crc16.mjs';

/** Private, task-scoped transport capability. Never expose this as a raw UI API. */
export interface UploadChannel {
  query(opcode:number,data:Uint8Array):Promise<Frame>;
  sendData(xmOpcode:number,data:Uint8Array):Promise<void>;
  respond(frame:Frame,data:Uint8Array,status?:number):Promise<void>;
  onCommand(listener:(frame:Frame)=>void):()=>void;
  onDisconnect(listener:(reason?:Error)=>void):()=>void;
}
export type UploadProgress={bytesSent:number;totalBytes:number;transmittedBytes:number;percent:number};
export type ImageBackup={bytes:Uint8Array;crc16:number;filename:'TEST.RES'};
export type UploadOptions={signal?:AbortSignal;timeoutMs?:number;maxDurationMs?:number;modifiedAt?:number;verifyReadback?:boolean;onProgress?:(progress:UploadProgress)=>void;onState?:(state:string)=>void};
const running=new WeakSet<UploadChannel>();
const EMPTY=new Uint8Array(),NAME=new TextEncoder().encode('TEST.RES\0\0');
const concat=(...parts:Uint8Array[])=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;};
const u32=(number:number)=>{const out=new Uint8Array(4);new DataView(out.buffer).setUint32(0,number);return out;};
const u16=(number:number)=>Uint8Array.of(number>>>8,number&255);
export function temporaryImagePath(modifiedAt:number) {
  if(!Number.isSafeInteger(modifiedAt)||modifiedAt<0)throw new Error('Invalid image modification timestamp');
  let hash=0;for(const char of `TEST.RES${modifiedAt}`)hash=(Math.imul(hash,31)+char.charCodeAt(0))|0;
  return new TextEncoder().encode(`${(hash>>>0).toString(16).padStart(8,'0')}.tmp\0`);
}

/** Device-managed TEST.RES transfer, with explicitly requested readback diagnostics. */
export async function uploadImage(channel:UploadChannel,input:Uint8Array,options:UploadOptions={}) {
  if(running.has(channel))throw new Error('An image upload is already running');
  if(!(input instanceof Uint8Array)||input.length>300000)throw new Error('Invalid image resource size');
  const bytes=input.slice(),resource=validateImageResource(bytes);
  if(resource.width!==360||resource.height!==360)throw new Error('Image upload requires exactly 360×360');
  const temporaryPath=temporaryImagePath(options.modifiedAt??Date.now());
  if(options.signal?.aborted)throw new Error('Image upload cancelled');
  const timeout=options.timeoutMs??20000,maxDuration=options.maxDurationMs??600000;
  if(!Number.isFinite(timeout)||timeout<10||timeout>120000||!Number.isFinite(maxDuration)||maxDuration<timeout||maxDuration>1800000)throw new Error('Invalid upload timeout');
  running.add(channel);
  let failed:Error|undefined,finished=false,disconnected=false,mutationStarted=false,deviceStopped=false;
  let stage='prerequisites',mtu=0,packetCrc=false,covered=0,transmittedBytes=0,commands=0,queued=0;
  const coverage=new Uint8Array(bytes.length),fileCrc=crc16(bytes);
  const taskAbort=new AbortController();
  let rejectAbort!:(error:Error)=>void,resolveComplete!:()=>void,resolveStarted!:()=>void;
  const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject;});void aborted.catch(()=>{});
  const complete=new Promise<void>(resolve=>{resolveComplete=resolve;});
  const started=new Promise<void>(resolve=>{resolveStarted=resolve;});
  const fail=(error:unknown)=>{if(failed||finished)return;failed=error instanceof Error?error:new Error(String(error));taskAbort.abort();rejectAbort(failed);};
  const live=()=>{if(failed)throw failed;if(finished)throw new Error('Upload already finished');};
  const wait=<T>(operation:Promise<T>)=>Promise.race([operation,aborted]);
  let inactivity:ReturnType<typeof setTimeout>|undefined;
  const touch=()=>{clearTimeout(inactivity);inactivity=setTimeout(()=>fail(new Error('Image upload timeout')),timeout);};
  const totalTimer=setTimeout(()=>fail(new Error('Image upload maximum duration exceeded')),maxDuration);
  const state=(value:string)=>{stage=value;try{options.onState?.(value);}catch{}};
  const progress=()=>{try{options.onProgress?.({bytesSent:covered,totalBytes:bytes.length,transmittedBytes,percent:finished?100:Math.min(99,Math.floor(covered*100/bytes.length))});}catch{}};
  const query=async(opcode:number,data=EMPTY)=>{live();const result=await wait(channel.query(opcode,data));live();if(result.command||result.opcode!==opcode)throw new Error('Mismatched upload query response');if(result.status!==0)throw new RcspCommandError(result);touch();return result;};
  let chain=Promise.resolve();
  const handle=async(frame:Frame)=>{
    live();if(!frame.command||![0x1d,0x20,0x1c,0x1e].includes(frame.opcode))return;
    if(stage==='starting')await wait(started);
    live();if(stage!=='transferring')throw new Error('Transfer command received before transfer start');
    if(frame.opcode===0x1d){
      if(frame.data.length!==7)throw new Error('Invalid pull request length');
      const v=new DataView(frame.data.buffer,frame.data.byteOffset,frame.data.byteLength),count=v.getUint16(1),offset=v.getUint32(3);
      if(frame.data[0]!==0||!count||count>32767||offset>=bytes.length)throw new Error('Invalid requested file range');
      const end=Math.min(bytes.length,offset+count);let index=0;
      for(let at=offset;at<end;){
        live();const chunk=bytes.slice(at,Math.min(end,at+mtu)),data=concat(Uint8Array.of(index++&255),packetCrc?u16(crc16(chunk)):EMPTY,chunk);
        if(transmittedBytes+chunk.length>bytes.length*8)throw new Error('Excessive duplicate transfer data');
        await wait(channel.sendData(0x1d,data));live();transmittedBytes+=chunk.length;
        let newBytes=0;for(let i=at;i<at+chunk.length;i++)if(!coverage[i]){coverage[i]=1;covered++;newBytes++;}
        at+=chunk.length;if(newBytes)touch();progress();
      }
    }else if(frame.opcode===0x20){
      if(frame.data.length!==0)throw new Error('Unexpected filename request parameters');
      await wait(channel.respond(frame,NAME.slice(),0));live();
    }else if(frame.opcode===0x1c){
      if(frame.data.length!==1)throw new Error('Invalid device stop reason');
      deviceStopped=true;await wait(channel.respond(frame,EMPTY,0));live();
      if(frame.data[0]!==0)throw new Error(`Device stopped image upload with reason ${frame.data[0]}`);
      if(covered!==bytes.length)throw new Error('Device stopped before all image bytes were sent');
      stage='finishing';resolveComplete();
    }else{
      if(frame.data.length)throw new Error('Invalid device cancellation parameters');
      deviceStopped=true;await wait(channel.respond(frame,EMPTY,0));throw new Error('Device cancelled image upload');
    }
  };
  let removeCommand=()=>{},removeDisconnect=()=>{};
  const abort=()=>fail(new Error('Image upload cancelled'));
  try{
    removeDisconnect=channel.onDisconnect(reason=>{disconnected=true;fail(reason??new Error('Badge disconnected'));});
    removeCommand=channel.onCommand(frame=>{
      if(!frame.command||![0x1d,0x20,0x1c,0x1e].includes(frame.opcode)||finished||failed)return;
      if(++commands>2048||++queued>64){fail(new Error('Transfer command flood'));return;}
      chain=chain.then(()=>handle(frame)).catch(fail).finally(()=>{queued--;});
    });
    options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();touch();state('prerequisites');
    const target=parseTargetUploadCapabilities((await query(3,Uint8Array.of(255,255,255,255,0))).data);
    if(!target.supportsExternalFlash)throw new Error('Device does not declare external-flash transfer support');
    const flash=parseExternalFlash((await query(0xd6)).data);
    if(flash.system!==1)throw new Error('Only confirmed device-managed filesystem system 1 is supported');
    if(flash.width!==360||flash.height!==360)throw new Error('Device must declare a 360×360 display');
    if(flash.systemStatus!==0)throw new Error(`Filesystem is not ready (${flash.systemStatus})`);
    const storage=parseWatchStorage((await query(7,Uint8Array.of(255,0,0,0,4))).data);
    const free=parseFreeSpace((await query(0x1a,Uint8Array.of(12,0))).data);
    if(free<bytes.length)throw new Error('Not enough free space for image resource');
    state('inserting');mutationStarted=true;
    const insert=await query(0x1a,concat(Uint8Array.of(2,1),u32(bytes.length),new TextEncoder().encode('/TEST.RES')));
    if(insert.data.length&&insert.data[0]!==0)throw new Error(`Flash insert rejected (${insert.data[0]})`);
    state('preparing');await query(0x21,Uint8Array.of(0));
    if(target.supportsPacketCrc){
      state('negotiating');const negotiation=await query(0x27,concat(Uint8Array.of(0),u32(storage.devHandler),Uint8Array.of(1)));
      if(negotiation.data.length!==2||negotiation.data[0]!==0||negotiation.data[1]>1)throw new Error('Invalid packet CRC negotiation response');
      packetCrc=negotiation.data[1]===1;
    }
    state('starting');const start=await query(0x1b,concat(u32(bytes.length),u16(fileCrc),temporaryPath));
    if(start.data.length!==2)throw new Error('Invalid transfer MTU response');
    mtu=new DataView(start.data.buffer,start.data.byteOffset,start.data.byteLength).getUint16(0);
    if(!mtu||mtu>4096)throw new Error('Unsupported transfer MTU');
    state('transferring');resolveStarted();progress();
    await wait(complete);
    clearTimeout(inactivity);
    let verified=false;
    if(options.verifyReadback===true){
      state('verifying');
      // Resolve the replacement from a fresh post-upload directory listing.
      const replacementCluster=await wait(findImageCluster(channel,{devHandler:storage.devHandler,devIndex:storage.index,signal:taskAbort.signal,timeoutMs:timeout}));live();
      const readback=await wait(readImageResource(channel,{devHandler:storage.devHandler,cluster:replacementCluster,expectedSize:bytes.length,expectedCrc:fileCrc,signal:taskAbort.signal,timeoutMs:timeout}));live();touch();
      if(readback.length!==bytes.length||readback.some((byte,index)=>byte!==bytes[index]))throw new Error('Device resource readback differs from image bytes');
      verified=true;
    }
    finished=true;state('complete');progress();
    return {filename:'TEST.RES' as const,bytesSent:covered,fileBytes:bytes.length,transmittedBytes,crc16:fileCrc,verified};
  }catch(error){
    const failedStage=stage;
    fail(error);state('failed');
    // Cancellation is an exact task-scoped command, never format/delete or raw flash.
    // Do not send after a device stop/cancel or a lost connection.
    if(mutationStarted&&!deviceStopped&&!disconnected){
      let timer:ReturnType<typeof setTimeout>|undefined;
      // Captured physical responses take up to 1.44s. A 500ms cutoff closed
      // GATT before cancellation could be acknowledged. Allow one full normal
      // command timeout, still bounded; never retry resource writes here.
      try{await Promise.race([channel.query(0x1e,EMPTY),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Cancel timeout')),5000);})]);}catch{}finally{clearTimeout(timer);}
    }
    if(failedStage==='verifying')throw new Error(`Image was transferred, but readback verification failed. ${failed?.message??String(error)}`,{cause:failed??error});
    if(failedStage==='starting'&&failed instanceof RcspCommandError&&failed.opcode===0x1b)throw new Error(`Badge rejected the transfer start (0x1b, status ${failed.status}). Replacement preparation succeeded, but no image bytes were sent. Switch the badge off and on, then reconnect before retrying.`,{cause:failed});
    throw failed??error;
  }finally{
    clearTimeout(inactivity);clearTimeout(totalTimer);options.signal?.removeEventListener('abort',abort);removeCommand();removeDisconnect();running.delete(channel);
  }
}
