import {test,expect} from 'bun:test';
import {recordPreview} from './video';
test('empty browser recording fails without reporting export success and stops tracks',async()=>{
 const savedWindow=(globalThis as any).window,savedRecorder=(globalThis as any).MediaRecorder;let stopped=false,reportedSuccess=false;
 class EmptyRecorder{
  static isTypeSupported(){return true;}
  state='inactive';onstart?:()=>void;onstop?:()=>void;ondataavailable?:(event:{data:Blob})=>void;
  constructor(..._args:unknown[]){}
  start(){this.state='recording';queueMicrotask(()=>this.onstart?.());}
  stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob([])});this.onstop?.();});}
 }
 (globalThis as any).window={MediaRecorder:EmptyRecorder};(globalThis as any).MediaRecorder=EmptyRecorder;
 const track={requestFrame(){},stop(){stopped=true;}};
 const canvas={captureStream:()=>({getTracks:()=>[track],getVideoTracks:()=>[track]})} as unknown as HTMLCanvasElement;
 try{await expect(recordPreview(canvas,.05,new AbortController().signal,v=>{if(v===100)reportedSuccess=true;})).rejects.toThrow('no valid WebM');expect(stopped).toBe(true);expect(reportedSuccess).toBe(false);}finally{(globalThis as any).window=savedWindow;(globalThis as any).MediaRecorder=savedRecorder;}
});
test('invalid clip length and pre-cancelled export fail before acquiring media',async()=>{
 const canvas={} as HTMLCanvasElement;await expect(recordPreview(canvas,61,new AbortController().signal,()=>{})).rejects.toThrow('60 seconds');
 const controller=new AbortController();controller.abort();await expect(recordPreview(canvas,1,controller.signal,()=>{})).rejects.toThrow('cancelled');
});
