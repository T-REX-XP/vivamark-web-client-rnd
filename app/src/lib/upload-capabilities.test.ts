import {test,expect} from 'bun:test';
import {parseTargetUploadCapabilities,parseWatchStorage} from './upload-capabilities';
import {readFileSync} from 'node:fs';
const attr=(type:number,data:number[])=>[data.length+1,type,...data];
const sys=(data:number[])=>Uint8Array.from([255,...attr(2,data)]);
test('physical target sanitized attributes establish external flash and packet CRC',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../../../artifacts/live-badge-readonly.json',import.meta.url),'utf8'));
  const data=Uint8Array.from(Object.entries(fixture.target_attributes_sanitized).flatMap(([type,hex])=>attr(Number(type),[...Buffer.from(hex as string,'hex')])));
  expect(parseTargetUploadCapabilities(data)).toEqual({supportsExternalFlash:true,supportsPacketCrc:true,supportsNamedRead:true});
  expect(parseTargetUploadCapabilities(Uint8Array.from([...attr(19,[0]),...attr(21,[0,0,0,0])]))).toEqual({supportsExternalFlash:false,supportsPacketCrc:false,supportsNamedRead:false});
});
test('target missing, duplicate, truncated and unknown capability layouts fail closed',()=>{
  for(const data of [[],[0],[2,19],[2,19,32], [...attr(19,[32]),...attr(19,[32]),...attr(21,[0,0,0,1])],
                    [...attr(19,[32]),...attr(21,[1])]])expect(()=>parseTargetUploadCapabilities(Uint8Array.from(data))).toThrow();
});
test('legacy storage uses real unsigned handle at flash index3, not storage index as handler',()=>{
  const bytes=new Uint8Array(21);bytes[0]=8;new DataView(bytes.buffer).setUint32(13,0xfedcba98);
  expect(parseWatchStorage(sys([...bytes]))).toEqual({devHandler:0xfedcba98,index:3});
  bytes[0]=32;expect(()=>parseWatchStorage(sys([...bytes]))).toThrow('watch storage');
  bytes[0]=0;expect(()=>parseWatchStorage(sys([...bytes]))).toThrow('watch storage');
});
test('actual physical storage response confirms online flash index3 and queried handle3',()=>{
  const measured=Uint8Array.from(Buffer.from('ff1602080000000000000000000000000000000300000000','hex'));
  expect(parseWatchStorage(measured)).toEqual({devHandler:3,index:3});
});
test('version0 storage decodes two-byte offline and six-byte online records, including flash3 index6',()=>{
  expect(parseWatchStorage(sys([255,0,...attr(1,[0,3,1,6,0x12,0x34,0x56,0x78])]))).toEqual({devHandler:0x12345678,index:6});
});
test('storage rejects truncation, unknown versions and ambiguous online flash targets',()=>{
  for(const data of [[],[255],[0,1,2], [...attr(1,[1,3])], [255,1,...attr(1,[1,3,0,0,0,1])],
    [255,0,...attr(1,[1,3,0,0,0,1,1,6,0,0,0,2])], [255,0,...attr(1,[1,3,0,0,0,1,0,3])]]) {
    expect(()=>parseWatchStorage(sys(data))).toThrow();
  }
  expect(()=>parseWatchStorage(Uint8Array.of(0,1,2))).toThrow('public');
});
