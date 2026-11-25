import type {Frame} from './diagnostics';
import type {UploadChannel} from './image-upload';

export type ImageDirectoryOptions={devHandler:number;devIndex:number;signal?:AbortSignal;timeoutMs?:number};
const running=new WeakSet<UploadChannel>();
const MAX_BYTES=4096,MAX_RECORDS=10;

/** Source: jl_filebrowse.bean.FileStruct.parse. Decode the entire bounded page,
 * including records split across data frames; never infer a missing name. */
function imageCluster(bytes:Uint8Array,devIndex:number):number {
  const records:{name:string;file:boolean;cluster:number}[]=[],clusters=new Set<number>();
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let at=0;at<bytes.length;){
    if(records.length>=MAX_RECORDS||bytes.length-at<8)throw new Error('Too many or truncated image directory records');
    const flags=bytes[at],index=(flags&0x7c)>>>2,cluster=view.getUint32(at+1),length=bytes[at+7],end=at+8+length;
    if(flags&0x80)throw new Error('Unknown image directory flags');
    if(index!==devIndex)throw new Error('Image directory storage index mismatch');
    if(!length||end>bytes.length)throw new Error('Truncated image directory filename');
    const unicode=!(flags&2);
    if(unicode&&length%2)throw new Error('Truncated UTF16 image directory filename');
    let name:string;
    const encoded=bytes.subarray(at+8,end);
    // ASCII is an exact GBK subset, including the fixed TEST.RES name. Decode
    // it directly so environments lacking optional legacy TextDecoder labels
    // do not reject valid ASCII records. Non-ASCII still requires strict GBK.
    try{name=!unicode&&encoded.every(byte=>byte<128)?String.fromCharCode(...encoded):new TextDecoder(unicode?'utf-16le':'gbk',{fatal:true,ignoreBOM:true}).decode(encoded);}
    catch{throw new Error('Invalid image directory filename encoding');}
    if(!name||/[\x00-\x1f\x7f]/.test(name))throw new Error('Invalid image directory filename');
    if(clusters.has(cluster))throw new Error('Ambiguous duplicate image directory cluster');
    clusters.add(cluster);records.push({name,file:!!(flags&1),cluster});at=end;
  }
  // TEST.RES is the upload name; the measured physical badge lists TEST1.RES.
  // Prefer the exact upload name when present. The alias is only a candidate:
  // the uploader must still read and compare the complete resource bytes.
  const filename=records.some(record=>record.name.toLowerCase()==='test.res')?'TEST.RES':'TEST1.RES';
  const matches=records.filter(record=>record.name.toLowerCase()===filename.toLowerCase());
  if(matches.length!==1)throw new Error(matches.length?`Ambiguous ${filename} directory entries`:'TEST.RES or TEST1.RES not found in the first root directory page');
  if(!matches[0].file)throw new Error(`${filename} directory entry is a directory, not an image file`);
  if(!matches[0].cluster)throw new Error(`${filename} has an invalid zero cluster`);
  return matches[0].cluster;
}

/** Read-only fixed root directory listing: one page, ten entries, no traversal,
 * playback, deletion, pagination, or arbitrary path. Resolves TEST.RES or the
 * measured TEST1.RES alias to a cluster for subsequent byte verification.
 * Source: PathData.toData + FileBrowseCmdHandler (0C/0D).
 */
export async function findImageCluster(channel:UploadChannel,options:ImageDirectoryOptions):Promise<number> {
  if(running.has(channel))throw new Error('An image directory lookup is already running');
  const {devHandler,devIndex,signal}=options,timeout=options.timeoutMs??15000;
  if(!Number.isInteger(devHandler)||devHandler<0||devHandler>0xffffffff||![3,6].includes(devIndex))throw new Error('Invalid watch directory storage');
  if(!Number.isFinite(timeout)||timeout<10||timeout>120000)throw new Error('Invalid image directory timeout');
  if(signal?.aborted)throw new Error('Image directory lookup cancelled');
  running.add(channel);
  const bytes=new Uint8Array(MAX_BYTES);let used=0,commands=0,queued=0,closed=false,failed:Error|undefined;
  let removeCommand=()=>{},removeDisconnect=()=>{},resolveStart!:()=>void,resolveResult!:(cluster:number)=>void,rejectFailure!:(error:Error)=>void;
  const started=new Promise<void>(resolve=>{resolveStart=resolve;});
  const result=new Promise<number>(resolve=>{resolveResult=resolve;});
  const failure=new Promise<never>((_,reject)=>{rejectFailure=reject;});void failure.catch(()=>{});
  const fail=(error:unknown)=>{if(closed||failed)return;failed=error instanceof Error?error:new Error(String(error));rejectFailure(failed);};
  const live=()=>{if(failed)throw failed;if(closed)throw new Error('Image directory lookup closed');};
  const wait=<T>(promise:Promise<T>)=>Promise.race([promise,failure]);
  let inactivity:ReturnType<typeof setTimeout>|undefined;
  const touch=()=>{clearTimeout(inactivity);inactivity=setTimeout(()=>fail(new Error('Image directory lookup timeout')),timeout);};
  const total=setTimeout(()=>fail(new Error('Image directory maximum duration exceeded')),120000);
  const abort=()=>fail(new Error('Image directory lookup cancelled'));
  let chain=Promise.resolve();
  const handle=async(frame:Frame,original:Frame)=>{
    await wait(started);live();
    if(frame.opcode===1){
      if(frame.needsResponse||!frame.data.length||used+frame.data.length>MAX_BYTES)throw new Error('Image directory data exceeded its bounded page or has invalid flags');
      bytes.set(frame.data,used);used+=frame.data.length;touch();return;
    }
    if(frame.needsResponse!==true||frame.data.length!==1||![0,1].includes(frame.data[0])||
       !Number.isInteger(frame.sequence)||frame.sequence<0||frame.sequence>255)throw new Error('Image directory browse did not stop successfully');
    // An ACK confirms receipt only; record validation still gates the result.
    // Preserve original identity for the transport's task-scoped capability.
    await wait(channel.respond(original,frame.data.slice(),0));live();
    resolveResult(imageCluster(bytes.subarray(0,used),devIndex));
  };
  try{
    removeDisconnect=channel.onDisconnect(reason=>fail(reason??new Error('Badge disconnected during image directory lookup')));
    removeCommand=channel.onCommand(frame=>{
      if(closed||failed||!frame.command||!(frame.opcode===0x0d||(frame.opcode===1&&frame.xmOpcode===0x0c)))return;
      if(++commands>256||++queued>64){fail(new Error('Image directory command flood'));return;}
      const snapshot={...frame,data:frame.data.slice()};
      // Callback returns immediately, so a response queued behind data frames
      // can be parsed and release the start gate without an RX deadlock.
      chain=chain.then(()=>handle(snapshot,frame)).catch(fail).finally(()=>{queued--;});
    });
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();touch();live();
    const request=Uint8Array.of(0,10,0,1,0,0,0,0,0,4,0,0,0,0);
    new DataView(request.buffer).setUint32(4,devHandler);
    const reply=await wait(channel.query(0x0c,request));live();
    if(reply.command||reply.opcode!==0x0c||reply.status!==0||![0,1,2,4].includes(reply.data.length))throw new Error('Invalid image directory start response');
    resolveStart();touch();const cluster=await wait(result);live();closed=true;return cluster;
  }catch(error){fail(error);throw failed??error;}
  finally{closed=true;clearTimeout(inactivity);clearTimeout(total);signal?.removeEventListener('abort',abort);removeCommand();removeDisconnect();running.delete(channel);}
}
