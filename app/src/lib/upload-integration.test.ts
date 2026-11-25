import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {DiagnosticsClient,assertUploadRequest,encodeFrame,FrameParser,type LogEntry} from './diagnostics';
import {encodeImageRes} from '../../../reference/image-res.mjs';
const image=()=>encodeImageRes(new Uint8Array(360*360*4).fill(255),360,360);
const insert=(entry:LogEntry)=>entry.direction==='tx'&&!!entry.hex&&entry.hex.split(' ')[4]==='1a'&&entry.hex.split(' ').slice(8,10).join(' ')==='02 01';
test('real client uploads without backup or pre-upload reads and verifies exact readback',async()=>{
 const logs:LogEntry[]=[],states:string[]=[],progress:number[]=[];
 const client=new DiagnosticsClient({log:entry=>logs.push(entry)});
 await client.connectSimulator();logs.length=0;
 const bytes=new Uint8Array(readFileSync(new URL('../../../artifacts/image-fixtures/gradient-360x360.res',import.meta.url)));
 try{const result=await client.uploadImageResource(bytes,{verifyReadback:true,onState:state=>states.push(state),onProgress:p=>progress.push(p.percent)});
 expect(result.fileBytes).toBe(bytes.length);expect(result.bytesSent).toBe(bytes.length);expect(result.transmittedBytes).toBe(bytes.length);expect(progress.at(-1)).toBe(100);expect(progress.slice(0,-1).every(p=>p<100)).toBe(true);expect(states).toEqual(['prerequisites','inserting','preparing','negotiating','starting','transferring','verifying','complete']);
 const beforeInsertion=logs.slice(0,logs.findIndex(insert));expect(beforeInsertion.some(e=>e.direction==='tx'&&['0c','24'].includes(e.hex?.split(' ')[4]??''))).toBe(false);
 expect(logs.filter(insert)).toHaveLength(1);expect((client as any).commandListeners.size).toBe(0);expect((client as any).disconnectListeners.size).toBe(0);await expect(client.query(0x1b)).rejects.toThrow('denied');await client.queryDeviceInfo();}finally{client.disconnect();}
});

test('readback failure reports that transfer occurred instead of claiming zero replacement',async()=>{
 let reads=0;const client=new DiagnosticsClient();await client.connectSimulator();const transport=(client as any).transport,send=transport.send.bind(transport);
 transport.send=async(bytes:Uint8Array)=>{const [frame]=new FrameParser().push(bytes);if(frame?.command&&frame.opcode===0x24&&frame.data[0]===1&&++reads===1){(client as any).receive(encodeFrame(0x24,frame.sequence,Uint8Array.of(1),true,1));return;}await send(bytes);};
 const error=await client.uploadImageResource(image(),{verifyReadback:true}).catch(error=>error as Error);
 expect(error).toBeInstanceOf(Error);expect((error as Error).message).toContain('Image was transferred, but readback verification failed.');expect((error as Error).message).not.toContain('No image replacement was started');expect(client.connected).toBe(false);
});

test('physical TEST1.RES alias verifies only when downloaded bytes match the uploaded resource',async()=>{
 for(const corrupt of [false,true]){
  const client=new DiagnosticsClient();await client.connectSimulator();const transport=(client as any).transport,emit=transport.emit.bind(transport);
  transport.emit=(bytes:Uint8Array)=>{
   const [frame]=new FrameParser().push(bytes);
   if(frame?.command&&frame.opcode===1&&frame.xmOpcode===0x0c){
    const directory=new Uint8Array(17);directory.set(frame.data.subarray(0,8));directory[7]=9;directory.set(new TextEncoder().encode('TEST1.RES'),8);
    emit(encodeFrame(1,frame.sequence,directory,false,0,false,0x0c));return;
   }
   if(corrupt&&frame?.command&&frame.opcode===1&&frame.xmOpcode===0x24){const damaged=frame.data.slice();damaged[6]^=1;emit(encodeFrame(1,frame.sequence,damaged,false,0,false,0x24));return;}
   emit(bytes);
  };
  try{if(corrupt){await expect(client.uploadImageResource(image(),{verifyReadback:true})).rejects.toThrow('cumulative packet CRC mismatch');expect(client.connected).toBe(false);}else{const result=await client.uploadImageResource(image(),{verifyReadback:true});expect(result.fileBytes).toBe(image().length);expect(result.verified).toBe(true);expect(client.connected).toBe(true);}}finally{client.disconnect();}
 }
});

test('default upload completes on badge confirmation without unsupported file reads',async()=>{
 const logs:LogEntry[]=[];const client=new DiagnosticsClient({log:entry=>logs.push(entry)});await client.connectSimulator();logs.length=0;
 try{const result=await client.uploadImageResource(image());expect(result.verified).toBe(false);expect(result.bytesSent).toBe(image().length);expect(client.connected).toBe(true);expect(logs.some(entry=>entry.direction==='tx'&&['0c','24'].includes(entry.hex?.split(' ')[4]??''))).toBe(false);}finally{client.disconnect();}
});
test('exclusive transaction blocks diagnostics and a second upload; disconnect cannot resume writes',async()=>{
 const client=new DiagnosticsClient();await client.connectSimulator();let entered!:()=>void;
 const reached=new Promise<void>(resolve=>{entered=resolve;});const transport=(client as any).transport,send=transport.send.bind(transport);
 transport.send=async(bytes:Uint8Array)=>{const [frame]=new FrameParser().push(bytes);if(frame?.opcode===0x1b){entered();return;}await send(bytes);};
 const first=client.uploadImageResource(image());const failed=first.catch(error=>error as Error);
 await reached;await expect(client.queryDeviceInfo()).rejects.toThrow('active');await expect(client.uploadImageResource(image())).rejects.toThrow('current');client.disconnect();expect(((await failed) as Error).message).toContain('Disconnected');expect((client as any).commandListeners.size).toBe(0);
});
test('user cancellation after start sends only task cancel and closes the session',async()=>{
 const logs:LogEntry[]=[],controller=new AbortController();const client=new DiagnosticsClient({log:e=>logs.push(e)});await client.connectSimulator();
 await expect(client.uploadImageResource(image(),{signal:controller.signal,onState:state=>{if(state==='transferring')controller.abort();}})).rejects.toThrow('cancelled');
 expect(logs.some(e=>e.direction==='tx'&&e.hex?.split(' ')[4]==='1e')).toBe(true);expect(client.connected).toBe(false);
});
test('upload policy rejects raw flash, arbitrary paths, altered lengths and data CRC',()=>{
 const bytes=image();for(const [opcode,data] of [[0x1a,Uint8Array.of(0,0)],[0x1a,Uint8Array.of(2,0)],[0xff,new Uint8Array()],[0x1b,new Uint8Array(19)],[0x24,new Uint8Array(19)]] as const)expect(()=>assertUploadRequest(opcode,data,bytes)).toThrow('denied');
 expect(()=>assertUploadRequest(7,Uint8Array.of(255,0,0,0,4),bytes)).not.toThrow();expect(()=>encodeFrame(1,0,Uint8Array.of(1))).toThrow('extended');
 const browse=Uint8Array.of(0,10,0,1,0,0,0,3,0,4,0,0,0,0);expect(()=>assertUploadRequest(0x0c,browse,bytes)).not.toThrow();
 for(const offset of [0,1,3,9,13]){const altered=browse.slice();altered[offset]^=1;expect(()=>assertUploadRequest(0x0c,altered,bytes)).toThrow('denied');}
 const cluster=Uint8Array.of(1,0,0,0,3,0,0,0,0,0,0,0,66);expect(()=>assertUploadRequest(0x24,cluster,bytes)).not.toThrow();cluster[12]=0;expect(()=>assertUploadRequest(0x24,cluster,bytes)).toThrow('denied');cluster[12]=66;cluster[8]=1;expect(()=>assertUploadRequest(0x24,cluster,bytes)).toThrow('denied');
 const raw=encodeFrame(1,3,Uint8Array.of(0,0xef,2),false,0,false,0x1d),[frame]=new FrameParser().push(raw);expect(raw[3]).toBe(0x80);expect(frame.xmOpcode).toBe(0x1d);expect(frame.needsResponse).toBe(false);expect(frame.data).toEqual(Uint8Array.of(0,0xef,2));
});
