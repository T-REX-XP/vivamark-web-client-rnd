"""One-page fixed root-directory listing on verified watch handle3.

Read-only: no file playback, traversal, download, creation, settings or flash writes.
Does not run on import. The CLI scans20s, authenticates and lists <=10 records.
"""
import asyncio
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import struct
import probe_badge

HANDLE=3
SEQUENCE=0x72
# PathData: folder0,count10,start1,handler3,path-byte-length4,root-cluster0.
ROOT_PAYLOAD=bytes.fromhex('000a000100000003000400000000')
ROOT_REQUEST=bytes.fromhex('fedcbac00c000f72')+ROOT_PAYLOAD+b'\xef'


def stop_ack(sequence,reason):
    if not 0<=sequence<=255 or reason not in (0,1):
        raise ValueError('Only successful browse-stop acknowledgments are allowed')
    return bytes([254,220,186,0,13,0,3,0,sequence,reason,239])


def parse_records(data):
    records=[];offset=0
    while offset<len(data):
        if len(records)>=10 or len(data)-offset<8:
            raise ValueError('Too many or truncated root-directory records')
        flags=data[offset]
        if flags&128:raise ValueError('Unknown directory flags')
        index=(flags&124)>>2
        if index!=3:raise ValueError('Directory record storage index mismatch')
        cluster=int.from_bytes(data[offset+1:offset+5],'big')
        number=int.from_bytes(data[offset+5:offset+7],'big')
        size=data[offset+7];end=offset+8+size
        if size==0 or end>len(data):raise ValueError('Truncated directory filename')
        unicode=not bool(flags&2)
        raw=data[offset+8:end]
        if unicode and size%2:raise ValueError('Invalid UTF16 directory filename')
        name=raw.decode('utf-16le' if unicode else 'gbk',errors='strict')
        records.append({'file':bool(flags&1),'unicode':unicode,'dev_index':index,
                        'cluster':cluster,'file_number':number,'name':name})
        offset=end
    if len({r['cluster'] for r in records})!=len(records):
        raise ValueError('Ambiguous duplicate directory clusters')
    return records


async def browse_fixed_root(receive,send_exact,report):
    storage=[r for r in report['responses'] if r['opcode']==7]
    if len(storage)!=1 or storage[0]['status']!=0 or storage[0]['data_hex']!='ff1602080000000000000000000000000000000300000000':
        raise ValueError('Storage differs from fixed verified index3/handle3')
    result=report['root_browse']={'handler':3,'path_clusters':[0],'requested_count':10,
                                'start_index':1,'verified':False}
    await send_exact(ROOT_REQUEST)
    buffered=[]
    for _ in range(32):
        frame=await receive.frame()
        if not frame['command'] and frame['opcode']==12 and frame['sequence']==SEQUENCE:
            result['start_status']=frame['status'];result['start_data_hex']=frame['data'].hex()
            if frame['status']!=0:raise ValueError(f'Root browse status {frame["status"]}')
            if len(frame['data']) not in (0,1,2,4):raise ValueError('Unknown root-browse response layout')
            result['reported_total_files']=int.from_bytes(frame['data'],'big')
            break
        if frame['command'] and frame['opcode'] in (1,13):buffered.append(frame)
    else:raise ValueError('No matching root-browse start response')
    data=bytearray()
    for _ in range(256):
        frame=buffered.pop(0) if buffered else await receive.frame()
        if frame['command'] and frame['opcode']==1:
            if frame['needs_response'] or not frame['data'] or frame['data'][0]!=12:
                raise ValueError('Unexpected directory data packet')
            data.extend(frame['data'][1:])
            if len(data)>4096:raise ValueError('Directory data exceeded one-page bound')
        elif frame['command'] and frame['opcode']==13:
            result['stop_data_hex']=frame['data'].hex()
            if not frame['needs_response'] or len(frame['data'])!=1 or frame['data'][0] not in (0,1):
                raise ValueError('Directory browse did not end successfully')
            await send_exact(stop_ack(frame['sequence'],frame['data'][0]))
            records=parse_records(data)
            result.update({'verified':True,'end_of_directory':frame['data'][0]==1,
                           'directory_bytes':len(data),'records':records,
                           'directory_data_sha256':hashlib.sha256(data).hexdigest()})
            return
        else:result['ignored_frames']=result.get('ignored_frames',0)+1
    raise ValueError('Root browse frame bound exceeded')


async def main():
    probe_badge.QUERIES+=((7,bytes.fromhex('ff00000004')),)
    matched,count=await probe_badge.scan(20)
    candidates=[(device,adv) for device,adv in matched if (adv.local_name or device.name) in probe_badge.BADGE_NAMES]
    report={'time_utc':datetime.now(timezone.utc).isoformat(),'action':'one-page-fixed-root-directory-browse',
            'resource_writes':False,'advertising_candidates':len(candidates),'seen_count':count}
    if len(candidates)!=1:report['error']='Need exactly one advertising VivaMark; no connection attempted'
    else:
        try:await asyncio.wait_for(probe_badge.probe(candidates[0][0],report,browse_root=True),60)
        except Exception as error:report['error']=f'{type(error).__name__}: {error}'
    Path('artifacts/hardware').mkdir(parents=True,exist_ok=True)
    private=Path('artifacts/hardware/root-browse-full.json')
    private.write_text(json.dumps(report,indent=2)+'\n')
    sanitized={key:report[key] for key in ['time_utc','action','resource_writes','advertising_candidates','seen_count','authenticated','root_browse','error'] if key in report}
    sanitized['private_transcript_sha256']=hashlib.sha256(private.read_bytes()).hexdigest()
    Path('artifacts/root-browse-proof.json').write_text(json.dumps(sanitized,indent=2)+'\n')
    print(json.dumps(sanitized,indent=2))
    return 0 if report.get('root_browse',{}).get('verified') else 1


if __name__=='__main__':raise SystemExit(asyncio.run(main()))
