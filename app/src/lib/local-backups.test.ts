import {test,expect} from 'bun:test';
import {IDBFactory,IDBDatabase} from 'fake-indexeddb';
import {saveImageBackup,latestImageBackup} from './local-backups';
import {libraryRead,librarySave} from '../editor';
import {encodeImageRes} from '../../../reference/image-res.mjs';
import {crc16} from '../../../reference/crc16.mjs';
const resource=()=>encodeImageRes(new Uint8Array(360*360*4).fill(255),360,360);
test('backup store migration preserves existing artwork and commits a checked independent copy',async()=>{
 const previous=globalThis.indexedDB;(globalThis as any).indexedDB=new IDBFactory();
 try{
  const db=await new Promise<globalThis.IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('vivamark-studio',1);request.onupgradeneeded=()=>request.result.createObjectStore('artworks',{keyPath:'artwork.id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction('artworks','readwrite');tx.objectStore('artworks').put({artwork:{id:'existing',name:'Keep me'},thumbnail:'data:',savedAt:'2026-11-23'});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
  const bytes=resource(),stored=await saveImageBackup({bytes,filename:'TEST.RES',crc16:crc16(bytes)},'synthetic-test',true);bytes.fill(0);
  const entry=await latestImageBackup();expect(entry?.sha256).toBe(stored.sha256);expect(entry?.sha256).toHaveLength(64);expect(entry?.bytes[0]).toBe(82);expect(entry?.simulated).toBe(true);expect((await libraryRead())[0].artwork.name).toBe('Keep me');
  await librarySave({artwork:{id:'after'} as any,thumbnail:'data:',savedAt:'2026-11-24'});expect(await libraryRead()).toHaveLength(2);
 }finally{(globalThis as any).indexedDB=previous;}
});
test('failed backup transaction rejects instead of authorizing a write; invalid CRC is not stored',async()=>{
 const previous=globalThis.indexedDB;(globalThis as any).indexedDB=new IDBFactory();const put=IDBDatabase.prototype.transaction;
 try{
  const bytes=resource();await expect(saveImageBackup({bytes,filename:'TEST.RES',crc16:0},'test',true)).rejects.toThrow('invalid');
  await latestImageBackup();
  IDBDatabase.prototype.transaction=function(...args:any[]){if(args[0]==='backups'&&args[1]==='readwrite')throw new DOMException('Quota exhausted','QuotaExceededError');return put.apply(this,args as any);};
  await expect(saveImageBackup({bytes,filename:'TEST.RES',crc16:crc16(bytes)},'test',true)).rejects.toThrow('Quota');
  IDBDatabase.prototype.transaction=put;expect(await latestImageBackup()).toBeNull();
 }finally{IDBDatabase.prototype.transaction=put;(globalThis as any).indexedDB=previous;}
});
