import React,{useEffect,useRef,useState} from 'react';
import {DiagnosticsClient} from './lib/diagnostics';
import {validateImageResource} from './lib/resource-validation';
import {crc16} from '../../reference/crc16.mjs';
import type {UploadProgress} from './lib/image-upload';
import {Icon} from './icons';
const states:Record<string,string>={prerequisites:'Checking badge and free space',inserting:'Preparing image replacement',preparing:'Preparing file transfer',negotiating:'Negotiating packet checksums',starting:'Starting transfer',transferring:'Sending image',verifying:'Verifying uploaded image',complete:'Image uploaded',failed:'Upload stopped'};
export function ImageUploadPanel({client,bytes,name,onClose,onFinished}:{client:DiagnosticsClient;bytes:Uint8Array;name:string;onClose:()=>void;onFinished:(message:string)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),canvas=useRef<HTMLCanvasElement>(null),controller=useRef<AbortController|null>(null),alive=useRef(true);
 const [hash,setHash]=useState(''),[busy,setBusy]=useState(false),[stage,setStage]=useState(''),[progress,setProgress]=useState<UploadProgress|null>(null),[error,setError]=useState(''),[complete,setComplete]=useState(false),[verified,setVerified]=useState(false),[cancelled,setCancelled]=useState(false);
 const simulated=useRef(client.simulated).current;
 useEffect(()=>{dialog.current?.showModal();try{const image=validateImageResource(bytes);canvas.current?.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(image.rgba),image.width,image.height),0,0);}catch(e){setError(e instanceof Error?e.message:String(e));}void crypto.subtle.digest('SHA-256',bytes.slice().buffer).then(value=>{if(alive.current)setHash(Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,'0')).join(''));}).catch(()=>setError('Resource fingerprint could not be calculated.'));return()=>{alive.current=false;controller.current?.abort();};},[]);
 async function upload(){
  if(busy||error)return;setBusy(true);setError('');setCancelled(false);controller.current=new AbortController();
  try{const result=await client.uploadImageResource(bytes,{signal:controller.current.signal,onState:value=>{if(alive.current)setStage(value);},onProgress:value=>{if(alive.current)setProgress(value);}});if(alive.current){setVerified(result.verified);setComplete(true);onFinished(simulated?'Simulated upload completed. No physical badge was changed.':result.verified?'Image uploaded and verified by byte-for-byte readback.':'Image uploaded. Badge confirmed successful transfer.');}}
  catch(e){if(alive.current)setError(e instanceof Error?e.message:String(e));}
  finally{if(alive.current)setBusy(false);}
 }
 return <dialog ref={dialog} className="upload-dialog" aria-labelledby="upload-title" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <header className="upload-heading"><div><h2 id="upload-title">{complete?(simulated?'Simulation complete':verified?'Image upload verified':'Image uploaded'):'Upload this image'}</h2><p>{simulated?'Synthetic badge simulator':'VivaMark · system-1 filesystem only'}</p></div><button className="icon-button" aria-label="Close upload review" disabled={busy} onClick={onClose}><Icon name="close"/></button></header>
  <div className="upload-proof"><canvas ref={canvas} width={360} height={360} aria-label="Exact decoded image prepared for upload"/><div><strong>{name||'Untitled artwork'}</strong><span>TEST.RES · 360 × 360</span><span>{bytes.length.toLocaleString()} bytes · CRC {crc16(bytes).toString(16).padStart(4,'0').toUpperCase()}</span><code title={hash}>SHA-256 {hash?`${hash.slice(0,16)}…`:'calculating…'}</code></div></div>
  {!complete&&<p className="upload-explanation">Upload this image to your badge. Keep the badge powered and this tab open until the transfer finishes.</p>}
  {simulated&&<div className="alert neutral">Simulation only. No physical badge will be changed.</div>}
  {busy&&<section className="upload-progress" aria-live="polite"><strong>{cancelled?'Requesting cancellation…':states[stage]||'Preparing upload'}</strong><progress aria-label="Image transfer progress" value={progress?.percent??0} max={100}/><span>{progress?`${progress.bytesSent.toLocaleString()} / ${progress.totalBytes.toLocaleString()} image bytes sent`:'No new image data sent yet.'}</span><p className="hint">Waiting for the badge to confirm successful completion.</p></section>}
  {error&&<div role="alert" className="alert error"><Icon name="info"/><div>{error}<p className="hint">Reconnect to the badge before retrying.</p></div></div>}
  {complete&&<div role="status" className="upload-success"><Icon name="check"/><div><strong>{simulated?'Simulated upload completed':verified?'Uploaded file matches the prepared image':'Badge confirmed upload'}</strong><p>{verified?'Byte-for-byte readback passed.':'All image bytes were sent and the badge confirmed successful completion.'}{!simulated&&' Check the badge display to confirm its appearance.'}</p></div></div>}
  <footer className="upload-actions">{busy?<button className="button" disabled={cancelled} onClick={()=>{setCancelled(true);controller.current?.abort();}}>Cancel transfer</button>:<button className="button" onClick={onClose}>{complete?'Done':'Close'}</button>}{!busy&&!complete&&<button className="button primary" disabled={!!error||!client.connected} onClick={upload}>{simulated?'Simulate image upload':'Upload image'}</button>}</footer>
 </dialog>;
}
