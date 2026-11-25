import { downloadBlob } from './editor';
/** Export a local playback preview. WebM is never presented as device-compatible AVI. */
export async function recordPreview(canvas:HTMLCanvasElement,seconds:number,signal:AbortSignal,onProgress:(value:number)=>void) {
  if(!Number.isFinite(seconds)||seconds<=0||seconds>60)throw new Error('Choose a clip between 0 and 60 seconds.');
  if(signal.aborted)throw new Error('Recording cancelled');
  if(!('MediaRecorder' in window)||!canvas.captureStream)throw new Error('Video export is unavailable in this browser. Export individual PNG frames instead.');
  const type=['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
  if(!type)throw new Error('WebM recording is not supported in this browser.');
  const stream=canvas.captureStream(20), chunks:BlobPart[]=[];
  const recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:2_000_000});
  return new Promise<void>((resolve,reject)=>{
    let start=performance.now(),interval:ReturnType<typeof setInterval>,frameTimer:ReturnType<typeof setInterval>,settled=false;
    const cleanup=()=>{clearInterval(interval);clearInterval(frameTimer);signal.removeEventListener('abort',abort);stream.getTracks().forEach(t=>t.stop());};
    const abort=()=>{if(recorder.state!=='inactive')recorder.stop();};
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.onerror=()=>{settled=true;cleanup();reject(new Error('Recording failed. Try a shorter preview.'));};
    recorder.onstop=async()=>{cleanup();if(settled)return;settled=true;if(signal.aborted){reject(new Error('Recording cancelled'));return;}try{const blob=new Blob(chunks,{type}),header=new Uint8Array(await blob.slice(0,4).arrayBuffer());if(blob.size<32||header[0]!==0x1a||header[1]!==0x45||header[2]!==0xdf||header[3]!==0xa3)throw new Error('The browser produced no valid WebM frames. Keep the preview tab visible and try again in Chrome or Edge.');downloadBlob(blob,'vivamark-preview.webm');onProgress(100);resolve();}catch(error){reject(error);}};
    signal.addEventListener('abort',abort,{once:true});
    recorder.onstart=()=>{start=performance.now();const track=stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;track.requestFrame?.();frameTimer=setInterval(()=>track.requestFrame?.(),50);interval=setInterval(()=>{onProgress(Math.min(99,(performance.now()-start)/(seconds*10)));if(performance.now()-start>=seconds*1000&&recorder.state!=='inactive')recorder.stop();},50);};
    try{recorder.start(100);}catch(error){settled=true;cleanup();reject(error);}
  });
}
