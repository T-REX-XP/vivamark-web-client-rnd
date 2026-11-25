import {test,expect} from 'bun:test';
import {AuthMachine,DiagnosticsClient,FrameParser,SimulatorTransport,assertReadOnlyQuery,encodeFrame,parseExternalFlash,parseFreeSpace} from './diagnostics';
import {readFileSync} from 'node:fs';
import {validateImageResource} from './resource-validation';
import {encodeImageRes} from '../../../reference/image-res.mjs';
import {deriveAuthResponse} from '../../../reference/jieli-auth.mjs';
import {crc16} from '../../../reference/crc16.mjs';

test('read-only policy denies writes, format/delete/settings and altered parameters',()=>{
  for(const opcode of [1,0x1b,0x1c,0x21,0x27,0xff])expect(()=>assertReadOnlyQuery(opcode,new Uint8Array())).toThrow('denied');
  for(const data of [Uint8Array.of(0,0),Uint8Array.of(6,0),Uint8Array.of(12,1),Uint8Array.of(12,0,0)])expect(()=>assertReadOnlyQuery(0x1a,data)).toThrow('denied');
  expect(()=>assertReadOnlyQuery(3,Uint8Array.of(255,255,255,255,0))).not.toThrow();
});
test('parser handles split and joined frames including EF inside payload',()=>{
  const frame=encodeFrame(3,42,Uint8Array.of(239,1),true), parser=new FrameParser();
  expect(parser.push(frame.slice(0,5))).toHaveLength(0);
  const rest=new Uint8Array(frame.length-5+frame.length);rest.set(frame.slice(5));rest.set(frame,frame.length-5);
  const output=parser.push(rest);expect(output).toHaveLength(2);expect(output[0].sequence).toBe(42);expect(output[0].data).toEqual(Uint8Array.of(239,1));
});
test('parser rejects malformed length, trailer, flags and flood',()=>{
  expect(()=>new FrameParser().push(Uint8Array.of(254,220,186,0,3,255,255))).toThrow('length');
  const frame=encodeFrame(3,0,new Uint8Array(),true);frame[frame.length-1]=0;expect(()=>new FrameParser().push(frame)).toThrow('trailer');
  frame[3]=1;expect(()=>new FrameParser().push(frame)).toThrow('flags');
  expect(()=>new FrameParser().push(new Uint8Array(16385))).toThrow('limit');
});
test('mutual auth requires challenge verification before pass and handles fragments',async()=>{
  const sent:Uint8Array[]=[];const auth=new AuthMachine(async b=>{sent.push(b.slice());});await auth.start();
  const response=deriveAuthResponse(sent[0]);await auth.receive(response.slice(0,4));expect(auth.state).toBe('response');
  await auth.receive(response.slice(4));expect(auth.state).toBe('pass');expect(sent[1]).toEqual(Uint8Array.of(2,112,97,115,115));
  const deviceChallenge=new Uint8Array(17);await auth.receive(deviceChallenge);expect(sent[2]).toEqual(deriveAuthResponse(deviceChallenge));
  await auth.receive(Uint8Array.of(2,112,97,115,115));expect(auth.state).toBe('done');
});
test('premature pass and corrupt auth fail hard',async()=>{
  const auth=new AuthMachine(async()=>{});await auth.start();await expect(auth.receive(Uint8Array.of(2,112,97,115,115))).rejects.toThrow('mismatch');
  const other=new AuthMachine(async()=>{});await other.start();await expect(other.receive(Uint8Array.of(4))).rejects.toThrow('prefix');
});
test('simulator labels every event synthetic and query correlation returns raw frames',async()=>{
  const logs:any[]=[];const client=new DiagnosticsClient({log:e=>logs.push(e)});await client.connectSimulator();
  expect(client.authenticated).toBe(true);expect(client.simulated).toBe(true);
  const frames=await Promise.all([client.queryDeviceInfo(),client.queryExternalFlash(),client.queryFreeSpace()]);
  expect(frames.map(f=>f.opcode)).toEqual([3,214,26]);expect(new Set(frames.map(f=>f.sequence)).size).toBe(3);
  expect(logs.every(e=>e.simulated)).toBe(true);await expect(client.query(0x1b)).rejects.toThrow('denied');client.disconnect();
});
test('disconnect rejects pending operations and prevents reusing authentication',async()=>{
  const client=new DiagnosticsClient();await client.connectSimulator();const pending=client.queryDeviceInfo();client.disconnect();await expect(pending).rejects.toThrow('Disconnected');
  await expect(client.queryDeviceInfo()).rejects.toThrow('Authenticate');
});
test('query timeout fails without interpreting missing response as success',async()=>{
  const logs:any[]=[];const client=new DiagnosticsClient({timeoutMs:20,log:e=>logs.push(e)});await client.connectSimulator();
  (client as any).transport.send=async()=>{};
  await expect(client.queryDeviceInfo()).rejects.toThrow('timeout');expect(client.connected).toBe(false);expect(logs.at(-1).message).toBe('Disconnected: Query timeout');client.disconnect();
});
test('simulator capability/free-space replies decode with BE fields and no echoed operation',async()=>{
  const client=new DiagnosticsClient();await client.connectSimulator();
  const flash=parseExternalFlash((await client.queryExternalFlash()).data);
  expect(flash.backend).toBe('device-filesystem');expect(flash.flashBytes).toBe(4194304);expect(flash.receiveMtu).toBe(512);expect([flash.width,flash.height]).toEqual([360,360]);
  expect(parseFreeSpace((await client.queryFreeSpace()).data)).toBe(2097152);client.disconnect();
});

test('physical badge capability fixture selects device filesystem and360px display',()=>{
  const live=JSON.parse(readFileSync(new URL('../../../artifacts/live-badge-readonly.json',import.meta.url),'utf8'));
  const hex=(value:string)=>Uint8Array.from(Buffer.from(value,'hex'));
  const flash=parseExternalFlash(hex(live.external_flash_response_hex));
  expect(flash.flashBytes).toBe(8388608);expect(flash.fatBytes).toBe(8388608);
  expect(flash.system).toBe(1);expect(flash.backend).toBe('device-filesystem');expect(flash.systemStatus).toBe(0);
  expect(flash.blockSize).toBe(256);expect(flash.cluster).toBe(16);expect(flash.receiveMtu).toBe(256);
  expect(new TextDecoder().decode(flash.versionBytes)).toBe('W002');
  expect([flash.width,flash.height]).toEqual([360,360]);
  // The SDK multiplies the wire's KiB count by1024, not an unscaled byte count.
  expect(parseFreeSpace(hex(live.free_space_response_hex))).toBe(3608*1024);
});

test('free-space units retain full unsigned32-bit KiB range without bitwise overflow',()=>{
  expect(parseFreeSpace(Uint8Array.of(0,255,255,255,255))).toBe(0xffffffff*1024);
});
test('capability parsers reject truncated text/optional fields and failed free-space operation',()=>{
  for(const length of [0,17,19,21,23])expect(()=>parseExternalFlash(new Uint8Array(length))).toThrow();
  const bytes=new Uint8Array(24);new DataView(bytes.buffer).setUint16(16,7);expect(()=>parseExternalFlash(bytes)).toThrow('length');
  expect(()=>parseFreeSpace(Uint8Array.of(12,0,0,32,0,0))).toThrow('length');
  expect(()=>parseFreeSpace(Uint8Array.of(1,0,0,0,0))).toThrow('failed');
});
test('mock browser subscribes before authentication and cleans failed setup listeners',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  try{
    for(const failSubscribe of [false,true]){
      const events:string[]=[];const notify:any=new EventTarget(),device:any=new EventTarget();
      const simulator=new SimulatorTransport(bytes=>{notify.value=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);notify.dispatchEvent(new Event('characteristicvaluechanged'));});
      notify.startNotifications=async()=>{events.push('subscribe');if(failSubscribe)throw new Error('Subscription failed');};
      const write={properties:{write:true},writeValueWithResponse:async(bytes:Uint8Array)=>{events.push('write');await simulator.send(bytes);}};
      const gatt={connected:false,connect:async()=>{gatt.connected=true;return gatt;},disconnect:()=>{events.push('disconnect');gatt.connected=false;},getPrimaryService:async()=>({getCharacteristic:async(uuid:string)=>uuid.includes('ae01')?write:notify})};device.gatt=gatt;
      const originalRemove=notify.removeEventListener.bind(notify);notify.removeEventListener=(...args:any[])=>{events.push('remove-notify');originalRemove(...args);};
      let discovery:any;
      Object.defineProperty(globalThis,'navigator',{configurable:true,value:{bluetooth:{requestDevice:async(options:any)=>{discovery=options;return device;}}}});
      const client=new DiagnosticsClient();
      if(failSubscribe){await expect(client.connectBrowser()).rejects.toThrow('Subscription failed');expect(events).toContain('remove-notify');expect(events).not.toContain('write');}
      else{await client.connectBrowser();expect(client.authenticated).toBe(true);expect(events.indexOf('subscribe')).toBeLessThan(events.indexOf('write'));await client.queryDeviceInfo();client.disconnect();expect(events).toContain('remove-notify');}
      expect(discovery).toEqual({filters:[{name:'VivaMark'},{name:'D40(BLE)'},{services:['0000ae00-0000-1000-8000-00805f9b34fb']}],optionalServices:['0000ae00-0000-1000-8000-00805f9b34fb']});
      expect(gatt.connected).toBe(false);simulator.close();
    }
  }finally{if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete (globalThis as any).navigator;}
});
test('outgoing operations are serialized and disconnect cancels queued work',async()=>{
  const client=new DiagnosticsClient();await client.connectSimulator();let count=0;let release!:()=>void;
  (client as any).transport.send=()=>{count++;return new Promise<void>(resolve=>{release=resolve;});};
  const first=client.queryDeviceInfo(), second=client.queryExternalFlash();
  await new Promise(resolve=>setTimeout(resolve,0));expect(count).toBe(1);
  client.disconnect();release();await expect(first).rejects.toThrow('Disconnected');await expect(second).rejects.toThrow('Disconnected');
  await new Promise(resolve=>setTimeout(resolve,0));expect(count).toBe(1);
});
function image(width=1,height=1){const rgba=new Uint8Array(width*height*4);for(let i=0;i<rgba.length;i+=4){rgba[i]=255;rgba[i+3]=255;}return encodeImageRes(rgba,width,height);}
function fixCrc(bytes:Uint8Array){const v=new DataView(bytes.buffer);v.setUint16(0x3e,crc16(bytes.subarray(0x450)),true);v.setUint16(0x3c,crc16(bytes.subarray(0x3e,0x50)),true);}
test('independent resource decoder produces expected pixels and dimensions',()=>{
  const result=validateImageResource(image(360,360));expect(result.width).toBe(360);expect(result.height).toBe(360);expect(result.rgba.slice(0,4)).toEqual(Uint8ClampedArray.of(255,0,0,255));expect(result.rgba.length).toBe(360*360*4);
});
test('resource validator rejects dimensions/file limits/header constants/CRCs',()=>{
  expect(()=>validateImageResource(image(361,1))).toThrow('dimensions');
  expect(()=>validateImageResource(new Uint8Array(300001))).toThrow('file size');
  const bytes=image();bytes[0]=0;expect(()=>validateImageResource(bytes)).toThrow('constant');
  const payload=image();payload[payload.length-1]^=1;expect(()=>validateImageResource(payload)).toThrow('CRC');
  const header=image();header[0x44]=2;expect(()=>validateImageResource(header)).toThrow('CRC');
});
test('valid CRC cannot conceal row overlaps, truncated RLE, invalid counts or excess output',()=>{
  const overlap=image(1,2);const v=new DataView(overlap.buffer);v.setUint32(0x454,v.getUint32(0x450,true),true);fixCrc(overlap);expect(()=>validateImageResource(overlap)).toThrow('overlap');
  for(const tag of [0,0x80,2,0x82]){const bytes=image();bytes[0x454]=tag;fixCrc(bytes);expect(()=>validateImageResource(bytes)).toThrow('RLE');}
  const truncated=image(2,1);truncated[0x454]=0x81;fixCrc(truncated);expect(()=>validateImageResource(truncated)).toThrow();
});
test('independent resource decoder accepts native ARM64 fixtures and verifies RGB565 pixel output',()=>{
  const root=new URL('../../../artifacts/image-fixtures/',import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));let count=0;
  for(const fixture of manifest.fixtures){
    if(fixture.width>360 || fixture.height>360)continue;
    const native=readFileSync(new URL(fixture.name+'.res',root)),rgba=readFileSync(new URL(fixture.name+'.rgba',root));
    const decoded=validateImageResource(native);expect(decoded.width).toBe(fixture.width);expect(decoded.height).toBe(fixture.height);
    let mismatch=-1;
    for(let p=0;p<rgba.length;p+=4){const r=rgba[p]>>>3,g=rgba[p+1]>>>2,b=rgba[p+2]>>>3;if(decoded.rgba[p]!==((r<<3)|(r>>>2))||decoded.rgba[p+1]!==((g<<2)|(g>>>4))||decoded.rgba[p+2]!==((b<<3)|(b>>>2))||decoded.rgba[p+3]!==255){mismatch=p;break;}}
    expect(mismatch).toBe(-1);count++;
  }
  expect(count).toBeGreaterThan(20);
});
