import {openLibrary} from '../editor';
import {validateImageResource} from './resource-validation';
import {crc16} from '../../../reference/crc16.mjs';
import type {ImageBackup} from './image-upload';
export type StoredImageBackup={id:string;deviceId:string;simulated:boolean;createdAt:string;filename:'TEST.RES';crc16:number;sha256:string;bytes:Uint8Array};
export async function saveImageBackup(backup:ImageBackup,deviceId:string,simulated:boolean):Promise<StoredImageBackup>{
 const bytes=backup.bytes.slice(),image=validateImageResource(bytes);
 if(image.width!==360||image.height!==360||backup.filename!=='TEST.RES'||crc16(bytes)!==backup.crc16)throw new Error('Refusing an invalid image backup');
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 const entry:StoredImageBackup={id:crypto.randomUUID(),deviceId,simulated,createdAt:new Date().toISOString(),filename:'TEST.RES',crc16:backup.crc16,sha256:Array.from(hash,b=>b.toString(16).padStart(2,'0')).join(''),bytes};
 const db=await openLibrary();
 return new Promise((resolve,reject)=>{
  let tx:IDBTransaction;
  try{tx=db.transaction('backups','readwrite',{durability:'strict'});tx.objectStore('backups').put(entry);}catch(error){db.close();reject(error);return;}
  tx.oncomplete=()=>{db.close();resolve(entry);};
  tx.onabort=tx.onerror=()=>{db.close();reject(new Error('Backup could not be saved. The badge image has not been replaced.'));};
 });
}
export async function latestImageBackup():Promise<StoredImageBackup|null>{
 const db=await openLibrary();return new Promise((resolve,reject)=>{const tx=db.transaction('backups','readonly'),request=tx.objectStore('backups').getAll();let result:StoredImageBackup|null=null;
 request.onsuccess=()=>{result=(request.result as StoredImageBackup[]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]??null;};
 tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(new Error('Saved backups are unavailable'));};
 });
}
