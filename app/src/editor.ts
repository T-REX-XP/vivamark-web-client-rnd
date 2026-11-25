export type Layer = { id: string; kind:'text'|'sticker'|'image'; image?:string; text:string; color:string; x:number; y:number; size:number; rotation:number; visible?:boolean; opacity?:number };
export type Artwork = { id:string; name:string; background:string; image:string|null; zoom:number; offsetX:number; offsetY:number; rotation:number; mask:boolean; layers:Layer[] };
export type SavedArtwork = { artwork:Artwork; thumbnail:string; savedAt:string };
export const createArtwork = (): Artwork => ({id:crypto.randomUUID(), name:'Hello there', background:'#e9a25a',image:null,zoom:1,offsetX:0,offsetY:0,rotation:0,mask:true,
  layers:[{id:crypto.randomUUID(),kind:'text',text:'HELLO\nTHERE.',color:'#173c35',x:180,y:157,size:58,rotation:0},{id:crypto.randomUUID(),kind:'text',text:'nice to meet you',color:'#173c35',x:180,y:251,size:18,rotation:0}]});
const images = new Map<string,Promise<HTMLImageElement>>();
type ImageSize={width:number;height:number};
const imageSizes=new Map<string,ImageSize>();
export const assetUrl=(filename:string)=>`./assets/${filename}`;
/** Earlier local projects may contain root-relative bundled artwork paths. */
export const resolveArtworkSource=(src:string)=>src.startsWith('/assets/')?`.${src}`:src;
/** Hit-test from the top layer, converting pointer coordinates into its rotated space. */
export function layerAtPoint(artwork:Artwork,x:number,y:number,sizeForImage:(src:string)=>ImageSize|undefined=src=>imageSizes.get(src)):Layer|undefined {
  return [...artwork.layers].reverse().find(layer=>{
    if(layer.visible===false||layer.opacity===0)return false;
    const angle=-layer.rotation*Math.PI/180,dx=x-layer.x,dy=y-layer.y;
    const localX=dx*Math.cos(angle)-dy*Math.sin(angle),localY=dx*Math.sin(angle)+dy*Math.cos(angle);
    const image=layer.image?sizeForImage(layer.image):undefined;
    // An undecoded image is not displayed yet and must not intercept clicks.
    if(layer.image&&!image)return false;
    const scale=image?layer.size/Math.max(image.width,image.height):1;
    const lines=layer.text.split('\n'),width=image?image.width*scale:Math.max(...lines.map(line=>line.length),1)*layer.size*.65,height=image?image.height*scale:lines.length*layer.size*1.05;
    return Math.abs(localX)<=width/2&&Math.abs(localY)<=height/2;
  });
}
/** Trim only transparent padding in the existing PNG; preserve its alpha pixels. */
export function stickerDataUrl(image:HTMLImageElement):string {
  const source=document.createElement('canvas');source.width=image.width;source.height=image.height;
  const ctx=source.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Canvas is unavailable');ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,source.width,source.height).data;
  let left=source.width,top=source.height,right=-1,bottom=-1;
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)if(pixels[(y*source.width+x)*4+3]){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  if(right<left)throw new Error('Sticker is empty');
  const cropped=document.createElement('canvas');cropped.width=right-left+1;cropped.height=bottom-top+1;cropped.getContext('2d')!.drawImage(source,left,top,cropped.width,cropped.height,0,0,cropped.width,cropped.height);
  return cropped.toDataURL('image/png');
}
export function imageFor(src:string) { let value=images.get(src); if(!value){value=new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>{imageSizes.set(src,{width:image.naturalWidth,height:image.naturalHeight});resolve(image);};image.onerror=()=>reject(new Error('Could not decode this image. Try PNG or JPEG.'));image.src=resolveArtworkSource(src);});images.set(src,value);}return value; }
export async function drawArtwork(canvas:HTMLCanvasElement, artwork:Artwork, proof=false,selectedId?:string|null) {
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx) throw new Error('Canvas is unavailable');
  const image=artwork.image?await imageFor(artwork.image):null;
  const overlays=await Promise.all(artwork.layers.map(layer=>layer.image?imageFor(layer.image):null));
  ctx.clearRect(0,0,360,360);ctx.save();ctx.fillStyle=artwork.background;ctx.fillRect(0,0,360,360);
  if(artwork.mask){ctx.beginPath();ctx.arc(180,180,180,0,Math.PI*2);ctx.clip();}
  if(image){ctx.save();ctx.translate(180+artwork.offsetX,180+artwork.offsetY);ctx.rotate(artwork.rotation*Math.PI/180);const scale=Math.max(360/image.width,360/image.height)*artwork.zoom;ctx.drawImage(image,-image.width*scale/2,-image.height*scale/2,image.width*scale,image.height*scale);ctx.restore();}
  for(const [index,layer] of artwork.layers.entries()){if(layer.visible===false)continue;ctx.save();ctx.globalAlpha=layer.opacity??1;ctx.translate(layer.x,layer.y);ctx.rotate(layer.rotation*Math.PI/180);const overlay=overlays[index];if(overlay){const scale=layer.size/Math.max(overlay.width,overlay.height);ctx.drawImage(overlay,-overlay.width*scale/2,-overlay.height*scale/2,overlay.width*scale,overlay.height*scale);}else{ctx.fillStyle=layer.color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`${layer.kind==='text'?'750':'600'} ${layer.size}px Arial, sans-serif`;const lines=layer.text.split('\n');lines.forEach((text,i)=>ctx.fillText(text,0,(i-(lines.length-1)/2)*layer.size*1.05));}ctx.restore();}
  const selected=artwork.layers.find(layer=>layer.id===selectedId&&layer.visible!==false);
  if(selected){const overlay=overlays[artwork.layers.indexOf(selected)],lines=selected.text.split('\n');ctx.save();ctx.translate(selected.x,selected.y);ctx.rotate(selected.rotation*Math.PI/180);ctx.font=`750 ${selected.size}px Arial, sans-serif`;const scale=overlay?selected.size/Math.max(overlay.width,overlay.height):1,width=overlay?overlay.width*scale:Math.max(...lines.map(line=>ctx.measureText(line).width)),height=overlay?overlay.height*scale:lines.length*selected.size*1.05;ctx.strokeStyle='#ffffff';ctx.lineWidth=3;ctx.strokeRect(-width/2-4,-height/2-4,width+8,height+8);ctx.strokeStyle='#173c35';ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.strokeRect(-width/2-4,-height/2-4,width+8,height+8);ctx.restore();}
  ctx.restore();
  // The physical display is circular; the RES remains a 360x360 opaque image.
  if(proof && artwork.mask){ctx.globalCompositeOperation='destination-in';ctx.beginPath();ctx.arc(180,180,180,0,Math.PI*2);ctx.fill();ctx.globalCompositeOperation='source-over';}
}
export function fileDataUrl(file:File) { if(file.size>20*1024*1024) return Promise.reject(new Error('Choose an image smaller than 20 MB.'));return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('File could not be read'));reader.readAsDataURL(file);}); }
export function downloadBlob(data:Blob,filename:string){const url=URL.createObjectURL(data);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export function validateProject(input:unknown):Artwork {
  const a=input as Artwork;
  if(!a || typeof a.name!=='string'||a.name.length>120||!/^#[\da-f]{6}$/i.test(a.background)||typeof a.mask!=='boolean'||!Array.isArray(a.layers)||a.layers.length>30)throw new Error('Invalid artwork project');
  for(const key of ['zoom','offsetX','offsetY','rotation'] as const)if(typeof a[key]!=='number'||!Number.isFinite(a[key]))throw new Error('Invalid image position');
  if(a.zoom<0.1||a.zoom>5||Math.abs(a.offsetX)>720||Math.abs(a.offsetY)>720||Math.abs(a.rotation)>360)throw new Error('Artwork position out of bounds');
  if(a.image!==null&&(typeof a.image!=='string'||a.image.length>28*1024*1024||!/^data:image\/(png|jpeg|webp|gif);base64,/.test(a.image)))throw new Error('Project image must be an embedded PNG, JPEG, WebP or GIF');
  for(const layer of a.layers){if(!layer||!['text','sticker','image'].includes(layer.kind)||typeof layer.text!=='string'||layer.text.length>300||!/^#[\da-f]{6}$/i.test(layer.color))throw new Error('Invalid artwork layer');if(layer.kind==='image'&&!layer.image)throw new Error('Image layer is missing its image');if(layer.image!==undefined&&(layer.kind==='text'||typeof layer.image!=='string'||layer.image.length>28*1024*1024||!/^data:image\/(png|jpeg|webp|gif);base64,/.test(layer.image)))throw new Error('Layer must be an embedded image');if(layer.visible!==undefined&&typeof layer.visible!=='boolean')throw new Error('Invalid layer visibility');if(layer.opacity!==undefined&&(!Number.isFinite(layer.opacity)||layer.opacity<0||layer.opacity>1))throw new Error('Invalid layer opacity');for(const key of ['x','y','size','rotation'] as const)if(!Number.isFinite(layer[key]))throw new Error('Invalid layer position');if(layer.size<8||layer.size>(layer.image?720:160)||Math.abs(layer.x)>720||Math.abs(layer.y)>720||Math.abs(layer.rotation)>360)throw new Error('Layer position out of bounds');}
  return {...a,id:crypto.randomUUID(),layers:a.layers.map(l=>({...l,id:crypto.randomUUID()}))};
}
export async function openLibrary(){return new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('vivamark-studio',2);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('artworks'))db.createObjectStore('artworks',{keyPath:'artwork.id'});if(!db.objectStoreNames.contains('backups'))db.createObjectStore('backups',{keyPath:'id'});};request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};request.onerror=()=>reject(new Error('Local library unavailable'));request.onblocked=()=>reject(new Error('Close other VivaMark tabs to update local backup storage.'));});}
export async function libraryRead(){const db=await openLibrary();return new Promise<SavedArtwork[]>((resolve,reject)=>{const tx=db.transaction('artworks','readonly');const r=tx.objectStore('artworks').getAll();r.onsuccess=()=>resolve((r.result as SavedArtwork[]).sort((a,b)=>b.savedAt.localeCompare(a.savedAt)));r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}
export async function librarySave(value:SavedArtwork){const db=await openLibrary();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('artworks','readwrite');tx.objectStore('artworks').put(value);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(new Error('Could not save. Check available browser storage.'));});}
