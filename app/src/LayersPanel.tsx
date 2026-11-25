import {Icon} from './icons';
import type {Artwork,Layer} from './editor';

const colors=['#e9a25a','#173c35','#f4d9da','#b8c9ef','#e7edcf','#ffffff','#171b20'];
type Props={artwork:Artwork;selected:string|null;onSelect:(id:string|null)=>void;onChange:(artwork:Artwork)=>void;onPatch:(changes:Partial<Layer>)=>void;onReplace:()=>void;onCamera:()=>void};
function NumberField({label,value,min,max,onChange}:{label:string;value:number;min:number;max:number;onChange:(value:number)=>void}){
 return <label className="field">{label}<input type="number" value={Math.round(value)} min={min} max={max} onChange={event=>onChange(Math.max(min,Math.min(max,Number(event.target.value)||0)))}/></label>;
}
export function LayersPanel({artwork,selected,onSelect,onChange,onPatch,onReplace,onCamera}:Props){
 const layer=artwork.layers.find(item=>item.id===selected),index=layer?artwork.layers.indexOf(layer):-1;
 function move(direction:number){const layers=[...artwork.layers],next=index+direction;if(index<0||next<0||next>=layers.length)return;[layers[index],layers[next]]=[layers[next],layers[index]];onChange({...artwork,layers});}
 function duplicate(){if(!layer||artwork.layers.length>=30)return;const copy={...layer,id:crypto.randomUUID(),x:Math.min(360,layer.x+12),y:Math.min(360,layer.y+12)};onChange({...artwork,layers:[...artwork.layers.slice(0,index+1),copy,...artwork.layers.slice(index+1)]});onSelect(copy.id);}
 return <>
  <div className="property-group layer-panel"><div className="section-heading"><h3>Layers</h3><span className="subtle">{artwork.layers.length} elements</span></div><p className="hint">Select an element here or on the canvas.</p>
   <div className="layer-stack" aria-label="Design layers">
    {[...artwork.layers].reverse().map(item=><div key={item.id} className={`layer-row ${selected===item.id?'is-selected':''}`}>
     <button className="layer-select" aria-label={`Select ${item.text.replace(/\n/g,' ')||item.kind} layer`} aria-pressed={selected===item.id} onClick={()=>onSelect(item.id)}>{item.image?<img src={item.image} alt=""/>:<Icon name="text" size={18}/>}<span>{item.text.replace(/\n/g,' ')||'Untitled element'}<small>{item.kind}</small></span></button>
     <label className="layer-visibility"><input type="checkbox" aria-label={`Show ${item.text.replace(/\n/g,' ')||item.kind} layer`} checked={item.visible!==false} onChange={event=>onChange({...artwork,layers:artwork.layers.map(entry=>entry.id===item.id?{...entry,visible:event.target.checked}:entry)})}/></label>
    </div>)}
    {artwork.image&&<button className={`layer-select base-layer ${selected==='base-image'?'is-selected':''}`} aria-pressed={selected==='base-image'} onClick={()=>onSelect('base-image')}><Icon name="image" size={18}/><span>Base image<small>Imported from an earlier project</small></span></button>}
    <button className={`layer-select base-layer ${selected===null?'is-selected':''}`} aria-pressed={selected===null} onClick={()=>onSelect(null)}><span className="background-chip" style={{background:artwork.background}}/><span>Background<small>Canvas color</small></span></button>
   </div>
  </div>
  {layer&&<section className="property-group layer-properties" aria-label="Selected element properties"><h3>{layer.image?'Image properties':'Text properties'}</h3>
   <label className="field">{layer.image?'Layer name':'Text'}{layer.image?<input value={layer.text} maxLength={120} onChange={event=>onPatch({text:event.target.value})}/>:<textarea value={layer.text} maxLength={300} rows={3} onChange={event=>onPatch({text:event.target.value})}/>}</label>
   <div className="inline-fields"><NumberField label="Size" value={layer.size} min={8} max={layer.image?720:160} onChange={size=>onPatch({size})}/>{!layer.image&&<label className="field">Color<input type="color" value={layer.color} onChange={event=>onPatch({color:event.target.value})}/></label>}</div>
   <div className="inline-fields"><NumberField label="Position X" value={layer.x} min={-360} max={720} onChange={x=>onPatch({x})}/><NumberField label="Position Y" value={layer.y} min={-360} max={720} onChange={y=>onPatch({y})}/></div>
   <NumberField label="Rotation" value={layer.rotation} min={-180} max={180} onChange={rotation=>onPatch({rotation})}/>
   <label className="range-field"><span>Opacity<output>{Math.round((layer.opacity??1)*100)}%</output></span><input aria-label="Opacity" type="range" min={0} max={100} value={Math.round((layer.opacity??1)*100)} onChange={event=>onPatch({opacity:Number(event.target.value)/100})}/></label>
   <div className="layer-actions"><button className="button quiet compact" disabled={index===artwork.layers.length-1} onClick={()=>move(1)}><Icon name="up" size={16}/> Move up</button><button className="button quiet compact" disabled={index===0} onClick={()=>move(-1)}><Icon name="down" size={16}/> Move down</button><button className="button quiet compact" disabled={artwork.layers.length>=30} onClick={duplicate}><Icon name="layers" size={16}/> Duplicate</button>{layer.image&&<button className="button quiet compact" onClick={onReplace}>Replace image</button>}<button className="button quiet compact danger" onClick={()=>{onChange({...artwork,layers:artwork.layers.filter(item=>item.id!==layer.id)});onSelect(null);}}><Icon name="trash" size={16}/> Delete layer</button></div>
  </section>}
  {selected==='base-image'&&artwork.image&&<section className="property-group" aria-label="Base image properties"><h3>Base image</h3><label className="range-field"><span>Zoom</span><input aria-label="Zoom" type="range" min={100} max={300} value={artwork.zoom*100} onChange={event=>onChange({...artwork,zoom:Number(event.target.value)/100})}/></label><NumberField label="Horizontal" value={artwork.offsetX} min={-360} max={360} onChange={offsetX=>onChange({...artwork,offsetX})}/><NumberField label="Vertical" value={artwork.offsetY} min={-360} max={360} onChange={offsetY=>onChange({...artwork,offsetY})}/><NumberField label="Rotation" value={artwork.rotation} min={-180} max={180} onChange={rotation=>onChange({...artwork,rotation})}/><button className="button quiet compact danger" onClick={()=>{onChange({...artwork,image:null});onSelect(null);}}>Remove base image</button></section>}
  {selected===null&&<section className="property-group" aria-label="Background properties"><h3>Background</h3><div className="swatches">{colors.map(color=><button key={color} aria-label={`Background ${color}`} aria-pressed={artwork.background===color} className={artwork.background===color?'chosen':''} style={{background:color}} onClick={()=>onChange({...artwork,background:color})}/>)}<label className="custom-color" title="Custom background color"><input aria-label="Custom background color" type="color" value={artwork.background} onChange={event=>onChange({...artwork,background:event.target.value})}/></label></div><button className="button quiet compact" onClick={onCamera}><Icon name="camera" size={16}/> Take a photo</button></section>}
 </>;
}
