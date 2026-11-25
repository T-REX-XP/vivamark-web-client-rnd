import type {Frame} from './diagnostics';
import type {UploadChannel} from './image-upload';
import {validateImageResource} from './resource-validation';
import {crc16} from '../../../reference/crc16.mjs';

export type ImageReadOptions={devHandler:number;cluster?:number;expectedSize?:number;expectedCrc?:number;signal?:AbortSignal;timeoutMs?:number};
const running=new WeakSet<UploadChannel>();
// READ24 accepts a file name, as used by GetFileByNameTask's CALL.TXT and
// WMEM.BIN callers. External-flash insertion separately uses /TEST.RES.
const NAME=new TextEncoder().encode('TEST.RES');

/** Resource read by a discovered file cluster, or the separate fixed-name API.
 * Cluster mode matches RcspWatch.openWatchFile / GetFileByClusterTask.
 * Neither mode performs raw-flash reads or accepts arbitrary paths.
 * Requires cumulative packet CRC16 and complete independent RES validation.
 * Source: GetFileTask + ReadFileFromDeviceCmd; see image-upload-audit.md.
 */
export async function readImageResource(channel:UploadChannel,options:ImageReadOptions):Promise<Uint8Array> {
  if(running.has(channel))throw new Error('An image resource read is already running');
  const {devHandler,cluster,expectedSize,expectedCrc,signal}=options;
  if(!Number.isInteger(devHandler)||devHandler<0||devHandler>0xffffffff)throw new Error('Invalid read storage handle');
  if(cluster!==undefined&&(!Number.isInteger(cluster)||cluster<1||cluster>0xffffffff))throw new Error('Invalid image file cluster');
  if(expectedSize!==undefined&&(!Number.isInteger(expectedSize)||expectedSize<1||expectedSize>300000))throw new Error('Invalid image resource read size');
  if(expectedCrc!==undefined&&(!Number.isInteger(expectedCrc)||expectedCrc<0||expectedCrc>65535))throw new Error('Invalid expected image CRC');
  const timeout=options.timeoutMs??15000;
  if(!Number.isFinite(timeout)||timeout<10||timeout>120000)throw new Error('Invalid resource read timeout');
  if(signal?.aborted)throw new Error('Image resource read cancelled');
  running.add(channel);
  // The audited READ start reply provides the authoritative file length. Never
  // allocate from an unvalidated response, even when metadata is unavailable.
  let output=new Uint8Array(),totalSize=0;
  let received=0,rollingCrc=0,commands=0,queued=0,closed=false,failed:Error|undefined;
  let removeCommand=()=>{},removeDisconnect=()=>{};
  let resolveStart!:()=>void,resolveStop!:()=>void,rejectFailure!:(error:Error)=>void;
  const started=new Promise<void>(resolve=>{resolveStart=resolve;});
  const stopped=new Promise<void>(resolve=>{resolveStop=resolve;});
  const failure=new Promise<never>((_,reject)=>{rejectFailure=reject;});void failure.catch(()=>{});
  const fail=(error:unknown)=>{if(closed||failed)return;failed=error instanceof Error?error:new Error(String(error));rejectFailure(failed);};
  const live=()=>{if(failed)throw failed;if(closed)throw new Error('Image resource read is closed');};
  const wait=<T>(promise:Promise<T>)=>Promise.race([promise,failure]);
  let inactivity:ReturnType<typeof setTimeout>|undefined;
  const touch=()=>{clearTimeout(inactivity);inactivity=setTimeout(()=>fail(new Error('Image resource read timeout')),timeout);};
  const total=setTimeout(()=>fail(new Error('Image resource read maximum duration exceeded')),120000);
  const abort=()=>fail(new Error('Image resource read cancelled'));
  let chain=Promise.resolve();
  const handle=async(frame:Frame,originalFrame:Frame)=>{
    await wait(started);live();
    if(frame.opcode===1){
      // Data packet headers are offset:u32be and cumulative CRC:u16be.
      if(frame.needsResponse||frame.data.length<7||frame.data.length>8186)throw new Error('Invalid image read data packet');
      const view=new DataView(frame.data.buffer,frame.data.byteOffset,frame.data.byteLength);
      const offset=view.getUint32(0),chunk=frame.data.subarray(6);
      if(offset!==received||offset+chunk.length>totalSize)throw new Error('Image read offset, duplicate, or size mismatch');
      const nextCrc=crc16(chunk,rollingCrc);
      if(view.getUint16(4)!==nextCrc)throw new Error('Image read cumulative packet CRC mismatch');
      output.set(chunk,received);received+=chunk.length;rollingCrc=nextCrc;touch();
      return;
    }
    if(frame.data.length!==2||![0x80,0x81].includes(frame.data[0])||frame.needsResponse!==true||
       !Number.isInteger(frame.sequence)||frame.sequence<0||frame.sequence>255)throw new Error('Invalid image read stop/cancel command');
    // This ACK confirms command receipt, not resource validity. Preserve the
    // incoming frame/sequence; do not await anything inside the RX callback.
    // The task-scoped transport grants response capability to the ORIGINAL
    // received object. A copied frame must never be used for this call.
    await wait(channel.respond(originalFrame,Uint8Array.of(frame.data[0]),0));live();
    if(frame.data[0]===0x81)throw new Error(`Device cancelled image resource read (${frame.data[1]})`);
    if(frame.data[1]!==0)throw new Error(`Device stopped image resource read with error (${frame.data[1]})`);
    if(received!==totalSize)throw new Error('Image resource read stopped before the exact expected size');
    if(crc16(output)!==rollingCrc||(expectedCrc!==undefined&&rollingCrc!==expectedCrc))throw new Error('Image resource read total CRC mismatch');
    resolveStop();
  };
  try{
    removeDisconnect=channel.onDisconnect(reason=>fail(reason??new Error('Badge disconnected during image resource read')));
    removeCommand=channel.onCommand(frame=>{
      if(closed||failed||!frame.command||!(frame.opcode===0x24||(frame.opcode===1&&frame.xmOpcode===0x24)))return;
      if(++commands>16384||++queued>64){fail(new Error('Image resource read command flood'));return;}
      // Copy retained data before leaving the callback. Promise chaining keeps
      // callbacks synchronous/nonblocking and preserves data-before-stop order.
      const copy={...frame,data:frame.data.slice()};
      chain=chain.then(()=>handle(copy,frame)).catch(fail).finally(()=>{queued--;});
    });
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();touch();live();
    const start=new Uint8Array(cluster===undefined?10+NAME.length:13),view=new DataView(start.buffer);
    start[0]=cluster===undefined?2:1;view.setUint32(1,devHandler);view.setUint32(5,0);
    if(cluster===undefined){start[9]=NAME.length;start.set(NAME,10);}else view.setUint32(9,cluster);
    const reply=await wait(channel.query(0x24,start));live();
    if(reply.command||reply.opcode!==0x24||reply.status!==0||reply.data.length!==5||reply.data[0]!==start[0])throw new Error('Invalid image resource read start response or size');
    totalSize=new DataView(reply.data.buffer,reply.data.byteOffset,reply.data.byteLength).getUint32(1);
    if(totalSize<1||totalSize>300000||(expectedSize!==undefined&&totalSize!==expectedSize))throw new Error('Invalid image resource read start response or size');
    output=new Uint8Array(totalSize);
    resolveStart();touch();await wait(stopped);live();
    const resource=validateImageResource(output);
    if(resource.width!==360||resource.height!==360)throw new Error('Read image resource must be exactly 360×360');
    // A command queued after the stop is not allowed to silently mutate output.
    closed=true;
    return output;
  }catch(error){fail(error);throw failed??error;}
  finally{
    closed=true;clearTimeout(inactivity);clearTimeout(total);signal?.removeEventListener('abort',abort);removeCommand();removeDisconnect();running.delete(channel);
  }
}
