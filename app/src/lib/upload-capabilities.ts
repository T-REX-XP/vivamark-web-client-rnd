// Source: ParseHelper.parseTargetInfo, DevStorageInfo/DevStorageState,
// OnFileBrowseCallbackImpl and WatchOpImpl.WATCH_STORAGE_INDEX_LIST={3,6}.
function ltv(bytes:Uint8Array):Map<number,Uint8Array[]> {
  const result=new Map<number,Uint8Array[]>();
  for(let p=0;p<bytes.length;) {
    const n=bytes[p];
    if(n<1 || p+n+1>bytes.length)throw new Error('Malformed capability LTV');
    const type=bytes[p+1], values=result.get(type)??[];
    values.push(bytes.slice(p+2,p+n+1));result.set(type,values);p+=n+1;
  }
  return result;
}
function single(attrs:Map<number,Uint8Array[]>,type:number):Uint8Array {
  const values=attrs.get(type);
  if(!values || values.length!==1)throw new Error('Missing or ambiguous capability attribute');
  return values[0];
}
const u32=(bytes:Uint8Array,offset=0)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(offset);

export function parseTargetUploadCapabilities(data:Uint8Array):{supportsExternalFlash:boolean;supportsPacketCrc:boolean;supportsNamedRead:boolean} {
  const attrs=ltv(data), expand=single(attrs,19), flags=single(attrs,21);
  if(expand.length<1 || expand.length>2 || flags.length!==4)throw new Error('Unknown upload capability format');
  return {supportsExternalFlash:!!(expand[0]&32),supportsPacketCrc:!!(u32(flags)&1),supportsNamedRead:!!(u32(flags)&2)};
}

export function parseWatchStorage(data:Uint8Array):{devHandler:number;index:number} {
  if(data.length<2 || data[0]!==255)throw new Error('Expected public system storage response');
  const storage=single(ltv(data.slice(1)),2), states:{index:number;online:boolean;handle?:number}[]=[];
  if(!storage.length)throw new Error('Missing storage state');
  if(storage[0]===255) {
    if(storage.length<3 || storage[1]!==0)throw new Error('Unknown storage format version');
    const nested=ltv(storage.slice(2));
    const records=single(nested,1);
    for(let p=0;p<records.length;) {
      if(p+2>records.length || records[p]>1)throw new Error('Malformed storage state');
      const online=records[p]===1,index=records[p+1],n=online?6:2;
      if(p+n>records.length)throw new Error('Truncated storage handle');
      states.push({index,online,handle:online?u32(records,p+2):undefined});p+=n;
    }
  } else {
    if(storage.length!==21 && storage.length!==22)throw new Error('Truncated legacy storage state');
    const mask=storage[0];let offset=1;
    for(const index of [0,1,2,3,5]) {
      states.push({index,online:!!(mask&(1<<index)),handle:u32(storage,offset)});offset+=4;
    }
  }
  if(new Set(states.map(s=>s.index)).size!==states.length)throw new Error('Ambiguous duplicate storage index');
  const choices=states.filter(s=>s.online && [3,6].includes(s.index));
  if(choices.length!==1 || choices[0].handle===undefined)throw new Error('Missing or ambiguous online watch storage');
  return {devHandler:choices[0].handle,index:choices[0].index};
}
