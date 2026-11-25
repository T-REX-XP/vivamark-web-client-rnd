"""Fixed read-only /TEST.RES bootstrap. No upload/settings/raw-flash operations.

Only reads using source-audited opcode24; start filesize is bounded <=300000.
"""
import asyncio
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import struct
import probe_badge

START = bytes.fromhex('fedcbac024001471020000000300000000092f544553542e524553ef')
START_BARE = bytes.fromhex('fedcbac02400137102000000030000000008544553542e524553ef')


def crc16(data, seed=0):
    value=seed
    for byte in data:
        value ^= byte << 8
        for _ in range(8):
            value=((value << 1) ^ (0x1021 if value & 0x8000 else 0)) & 0xffff
    return value


def validate_res(data):
    if len(data)<0x457 or data[:4]!=b'RU30':
        raise ValueError('Downloaded resource is not packed RU30 mode1')
    width,height=struct.unpack_from('<HH',data,0x44)
    size,offset=struct.unpack_from('<II',data,0x48)
    if (width,height)!=(360,360) or offset!=0x450 or size!=len(data)-offset:
        raise ValueError('Downloaded resource dimensions/size/offset invalid')
    header_crc,payload_crc=struct.unpack_from('<HH',data,0x3c)
    if crc16(data[0x3e:0x50])!=header_crc or crc16(data[0x450:])!=payload_crc:
        raise ValueError('Downloaded resource internal CRC mismatch')
    end_offset=height*4
    for row in range(height):
        descriptor=struct.unpack_from('<I',data,offset+row*4)[0]
        start=descriptor&0x1fffff;length=descriptor>>21
        if start!=end_offset or not length or start+length>size:
            raise ValueError('Downloaded resource row bounds invalid')
        p=offset+start;end=p+length;count=0
        while p<end:
            tag=data[p];p+=1;n=tag&127
            if n==0:raise ValueError('Invalid resource RLE count')
            p+=2 if tag&128 else n*2;count+=n
            if p>end or count>width:raise ValueError('Invalid resource RLE range')
        if p!=end or count!=width:raise ValueError('Invalid resource RLE row')
        end_offset=start+length
    if end_offset!=size:raise ValueError('Resource payload trailing data')
    return {'width':width,'height':height,'header_crc16':header_crc,'payload_crc16':payload_crc}


async def read_fixed_resource(receive, send_exact, report, bare_name=False):
    storage=[r for r in report['responses'] if r['opcode']==7]
    if len(storage)!=1 or storage[0]['status']!=0 or storage[0]['data_hex']!='ff1602080000000000000000000000000000000300000000':
        raise ValueError('Storage state differs from exact confirmed handle3 precondition')
    info=report['image_read']={'path':'TEST.RES' if bare_name else '/TEST.RES','dev_handler':3,'offset':0,
                              'started':False,'verified':False}
    await send_exact(START_BARE if bare_name else START)
    buffered=[]
    for _ in range(32):
        frame=await receive.frame()
        if not frame['command'] and frame['opcode']==0x24 and frame['sequence']==0x71:
            info['start_status']=frame['status'];info['start_data_hex']=frame['data'].hex()
            if frame['status']!=0:raise ValueError(f'Named read status {frame["status"]}')
            if len(frame['data'])!=5 or frame['data'][0]!=2:
                raise ValueError('Unexpected named read start layout')
            size=int.from_bytes(frame['data'][1:5],'big')
            if not 1<=size<=300000:raise ValueError('Named read size exceeds bound')
            info['declared_bytes']=size;info['started']=True
            break
        if frame['command'] and frame['opcode'] in (1,0x24):
            buffered.append(frame)
    else:raise ValueError('No named read start response')
    output=bytearray();rolling=0;packets=0
    for _ in range(16384):
        frame=buffered.pop(0) if buffered else await receive.frame()
        if frame['command'] and frame['opcode']==1:
            if frame['needs_response'] or len(frame['data'])<8 or frame['data'][0]!=0x24:
                raise ValueError('Unexpected named-read data header')
            payload=frame['data'][1:]
            offset=int.from_bytes(payload[:4],'big');expected=int.from_bytes(payload[4:6],'big')
            chunk=payload[6:]
            if offset!=len(output) or offset+len(chunk)>size:
                raise ValueError('Named-read packet offset/range mismatch')
            rolling=crc16(chunk,rolling)
            if rolling!=expected:raise ValueError('Named-read cumulative CRC mismatch')
            output.extend(chunk);packets+=1
        elif frame['command'] and frame['opcode']==0x24:
            info['stop_data_hex']=frame['data'].hex()
            if not frame['needs_response'] or frame['data']!=b'\x80\x00':
                raise ValueError('Named-read stop/cancel is not successful 8000')
            # Response body = status0, incoming sequence, echoed operation80.
            ack=bytes([254,220,186,0,0x24,0,3,0,frame['sequence'],0x80,239])
            await send_exact(ack)
            if len(output)!=size:raise ValueError('Named-read final byte count mismatch')
            if crc16(output)!=rolling:raise ValueError('Named-read final CRC mismatch')
            structure=validate_res(output)
            path=Path('artifacts/hardware/badge-TEST-basename.RES' if bare_name else 'artifacts/hardware/badge-TEST.RES')
            path.write_bytes(output)
            info.update({'verified':True,'received_bytes':len(output),'data_packets':packets,
                         'whole_file_crc16':rolling,'sha256':hashlib.sha256(output).hexdigest(),
                         'private_output':str(path),**structure})
            return
        else:
            info.setdefault('ignored_frames',0);info['ignored_frames']+=1
    raise ValueError('Named-read frame bound exceeded')


async def main(bare_name=False):
    probe_badge.QUERIES += ((7,bytes.fromhex('ff00000004')),)
    matched,count=await probe_badge.scan(20)
    candidates=[(device,adv) for device,adv in matched if (adv.local_name or device.name) in probe_badge.BADGE_NAMES]
    report={'time_utc':datetime.now(timezone.utc).isoformat(),'action':'fixed-read-only-existing-image',
            'advertising_candidates':len(candidates),'seen_count':count,
            'resource_writes':False,'fixed_path':'TEST.RES' if bare_name else '/TEST.RES'}
    if len(candidates)!=1:report['error']='Need exactly one advertising VivaMark; no connection attempted'
    else:
        try:await asyncio.wait_for(probe_badge.probe(candidates[0][0],report,read_image='basename' if bare_name else True),100)
        except Exception as error:report['error']=f'{type(error).__name__}: {error}'
    Path('artifacts/hardware').mkdir(parents=True,exist_ok=True)
    private=Path('artifacts/hardware/basename-read-full.json' if bare_name else 'artifacts/hardware/named-read-full.json')
    private.write_text(json.dumps(report,indent=2)+'\n')
    sanitized={key:report[key] for key in ['time_utc','action','advertising_candidates','seen_count','resource_writes','fixed_path','authenticated','image_read','error'] if key in report}
    sanitized['private_transcript_sha256']=hashlib.sha256(private.read_bytes()).hexdigest()
    Path('artifacts/basename-read-proof.json' if bare_name else 'artifacts/named-read-proof.json').write_text(json.dumps(sanitized,indent=2)+'\n')
    print(json.dumps(sanitized,indent=2))
    return 0 if report.get('image_read',{}).get('verified') else 1


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bare-name',action='store_true',help='Use the one fixed SDK basename TEST.RES instead of /TEST.RES')
    args=parser.parse_args()
    raise SystemExit(asyncio.run(main(args.bare_name)))
