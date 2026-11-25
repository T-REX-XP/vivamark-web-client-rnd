import {parseGIF,decompressFrames} from 'gifuct-js';
export type GifPreview={frames:{image:ImageData;until:number}[];duration:number};
/** Bounded local GIF composition, including transparent patches/disposal 2 and 3. */
export async function decodeGifPreview(file:File):Promise<GifPreview>{
 if(file.size>10*1024*1024)throw new Error('Choose a GIF smaller than 10 MB.');
 const parsed=parseGIF(await file.arrayBuffer()),width=parsed.lsd.width,height=parsed.lsd.height;
 const imageFrames=parsed.frames.filter(frame=>'image' in frame);
 if(!width||!height||width>2048||height>2048||imageFrames.length>500||Math.max(width*height,360*360)*imageFrames.length>16_000_000)throw new Error('This GIF exceeds the local preview limit. Use a smaller or shorter GIF.');
 const frames=decompressFrames(parsed,true);if(!frames.length)throw new Error('GIF has no image frames.');
 const composed=document.createElement('canvas');composed.width=width;composed.height=height;
 const ctx=composed.getContext('2d',{willReadFrequently:true})!,patch=document.createElement('canvas'),patchCtx=patch.getContext('2d')!;
 const square=document.createElement('canvas');square.width=square.height=360;const squareCtx=square.getContext('2d',{willReadFrequently:true})!;
 let snapshot:ImageData|null=null,duration=0;const output:GifPreview['frames']=[];
 for(let i=0;i<frames.length;i++){
  const previous=frames[i-1],frame=frames[i];
  if(previous?.disposalType===2){const d=previous.dims;ctx.clearRect(d.left,d.top,d.width,d.height);if(previous.transparentIndex===undefined&&parsed.gct?.[parsed.lsd.backgroundColorIndex]){const color=parsed.gct[parsed.lsd.backgroundColorIndex];ctx.fillStyle=`rgb(${color[0]},${color[1]},${color[2]})`;ctx.fillRect(d.left,d.top,d.width,d.height);}}
  else if(previous?.disposalType===3&&snapshot)ctx.putImageData(snapshot,0,0);
  snapshot=frame.disposalType===3?ctx.getImageData(0,0,width,height):null;
  const d=frame.dims;if(d.left+d.width>width||d.top+d.height>height)throw new Error('GIF frame exceeds its canvas.');
  patch.width=d.width;patch.height=d.height;patchCtx.putImageData(new ImageData(new Uint8ClampedArray(frame.patch),d.width,d.height),0,0);ctx.drawImage(patch,d.left,d.top);
  const scale=Math.max(360/width,360/height);squareCtx.fillStyle='#171b20';squareCtx.fillRect(0,0,360,360);squareCtx.drawImage(composed,(360-width*scale)/2,(360-height*scale)/2,width*scale,height*scale);
  duration+=Math.max(20,frame.delay||100);output.push({image:squareCtx.getImageData(0,0,360,360),until:duration});
 }
 return {frames:output,duration:duration/1000};
}
