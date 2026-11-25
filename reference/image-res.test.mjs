import assert from 'node:assert/strict';
import { encodeImageRes } from './image-res.mjs';
import { crc16 } from './crc16.mjs';

function inspect(bytes, width, height) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(new TextDecoder().decode(bytes.subarray(0,4)), 'RU30');
  assert.equal(v.getUint16(0x44,true), width);
  assert.equal(v.getUint16(0x46,true), height);
  assert.equal(v.getUint32(0x48,true), bytes.length-0x450);
  assert.equal(v.getUint32(0x4c,true), 0x450);
  assert.equal(v.getUint16(0x3c,true), crc16(bytes.subarray(0x3e,0x50)));
  assert.equal(v.getUint16(0x3e,true), crc16(bytes.subarray(0x450)));
  const decoded = [];
  for (let y=0;y<height;y++) {
    const d = v.getUint32(0x450+y*4,true);
    let p=0x450+(d&0x1fffff), end=p+(d>>>21), count=0;
    while(p<end) {
      const tag=bytes[p++], n=tag&127;
      assert(n>0);
      if(tag&128) {
        const color=(bytes[p]<<8)|bytes[p+1]; p+=2;
        for(let i=0;i<n;i++) decoded.push(color);
      } else {
        for(let i=0;i<n;i++) {decoded.push((bytes[p]<<8)|bytes[p+1]);p+=2;}
      }
      count+=n;
    }
    assert.equal(p,end); assert.equal(count,width);
  }
  return decoded;
}

const red=encodeImageRes(Uint8Array.of(255,0,0,255),1,1);
assert.deepEqual([...red.subarray(0x450)], [4,0,0x60,0,1,0xf8,0]);
assert.deepEqual(inspect(red,1,1),[0xf800]);
const solid=encodeImageRes(Uint8Array.from({length:128*4},(_,i)=>i%4===3?255:0),128,1);
assert.deepEqual([...solid.subarray(0x454)],[0xff,0,0,1,0,0]);
assert.equal(inspect(solid,128,1).length,128);
const rgba=Uint8Array.from({length:368*368*4},(_,i)=>(i*73+(i>>8))&255);
const encoded=encodeImageRes(rgba,368,368), decoded=inspect(encoded,368,368);
for(let i=0;i<decoded.length;i++) assert.equal(decoded[i],((rgba[i*4]&248)<<8)|((rgba[i*4+1]&252)<<3)|(rgba[i*4+2]>>3));
assert.throws(()=>encodeImageRes([],0,1),RangeError);
console.log('RES structural/CRC/color round-trip checks passed; run image-native.test.mjs for native differential checks.');
