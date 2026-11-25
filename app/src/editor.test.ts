import {test,expect} from 'bun:test';
import {validateProject,layerAtPoint,type Artwork} from './editor';
const project=()=>({id:'saved',name:'Badge',background:'#e9a25a',image:null,zoom:1,offsetX:0,offsetY:0,rotation:0,mask:true,layers:[{id:'l',kind:'text',text:'Hello',color:'#173c35',x:180,y:180,size:32,rotation:0}]});
test('imported projects have bounded content and new independent IDs',()=>{const input=project();const output=validateProject(input);expect(output.id).not.toBe(input.id);expect(output.layers[0].id).not.toBe(input.layers[0].id);expect(input.layers[0].id).toBe('l');});
test('project import rejects external image requests, invalid text and numerical payloads',()=>{expect(()=>validateProject({...project(),image:'https://evil.example/image.png'})).toThrow();expect(()=>validateProject({...project(),zoom:Infinity})).toThrow();expect(()=>validateProject({...project(),layers:Array(31).fill(project().layers[0])})).toThrow();expect(()=>validateProject({...project(),layers:[{...project().layers[0],text:'x'.repeat(301)}]})).toThrow();expect(()=>validateProject({...project(),background:'url(javascript:x)'})).toThrow();});

test('multilayer projects retain embedded images, transparency settings and independent positions',()=>{
 const image='data:image/png;base64,iVBORw0KGgo=',base=project(),input={...base,layers:[...base.layers,{...base.layers[0],id:'photo',kind:'image',image,text:'Photo',size:480,x:90,y:120,opacity:.5},{...base.layers[0],id:'sticker',kind:'sticker',image,text:'COOL',size:120,x:240,y:230,rotation:45,visible:false}]};
 const output=validateProject(JSON.parse(JSON.stringify(input)));expect(output.layers).toHaveLength(3);expect(output.layers[1]).toMatchObject({kind:'image',image,size:480,x:90,y:120,opacity:.5});expect(output.layers[2]).toMatchObject({kind:'sticker',image,rotation:45,visible:false});expect(output.layers.map(layer=>layer.id)).not.toEqual(input.layers.map(layer=>layer.id));expect(input.layers[1].id).toBe('photo');
});

test('new image layers cannot load remote resources or import invalid visibility, opacity or sizes',()=>{
 const layer={...project().layers[0],kind:'image',image:'data:image/png;base64,iVBORw0KGgo='};
 for(const changes of [{image:'https://example.com/photo.png'},{image:'/assets/COOL.png'},{image:undefined},{opacity:1.1},{opacity:-1},{opacity:NaN},{visible:'yes'},{size:721}])expect(()=>validateProject({...project(),layers:[{...layer,...changes}]})).toThrow();
});

test('canvas selection resolves topmost visible elements and respects transformed coordinates',()=>{
 const art=validateProject({...project(),layers:[{...project().layers[0],id:'text',text:'Hello',x:180,y:180},{...project().layers[0],id:'overlay',kind:'sticker',image:'data:image/png;base64,iVBORw0KGgo=',text:'COOL',x:180,y:180,size:100}]});
 const square=()=>({width:100,height:100});expect(layerAtPoint(art,180,180,square)?.id).toBe(art.layers[1].id);art.layers[1].visible=false;expect(layerAtPoint(art,180,180,square)?.id).toBe(art.layers[0].id);art.layers[1].visible=true;art.layers[1].opacity=0;expect(layerAtPoint(art,180,180,square)?.id).toBe(art.layers[0].id);expect(layerAtPoint(art,10,10,square)).toBeUndefined();
 const rotated={...art,layers:[{...art.layers[0],text:'LONG TEXT',size:20,rotation:90}]};expect(layerAtPoint(rotated,180,225)?.id).toBe(art.layers[0].id);expect(layerAtPoint(rotated,225,180)).toBeUndefined();
});

test('portrait, landscape and rotated raster bounds match rendering and leave underlying elements selectable',()=>{
 const art=validateProject({...project(),layers:[{...project().layers[0],text:'Underlying',x:280,y:180},{...project().layers[0],kind:'image',image:'data:image/png;base64,iVBORw0KGgo=',text:'Portrait',x:180,y:180,size:360}]});
 const portrait=()=>({width:100,height:360}),landscape=()=>({width:360,height:100});
 expect(layerAtPoint(art,280,180,portrait)?.id).toBe(art.layers[0].id);expect(layerAtPoint(art,180,280,portrait)?.id).toBe(art.layers[1].id);
 expect(layerAtPoint(art,180,280,landscape)).toBeUndefined();expect(layerAtPoint(art,280,180,landscape)?.id).toBe(art.layers[1].id);
 art.layers[1].rotation=90;expect(layerAtPoint(art,280,180,portrait)?.id).toBe(art.layers[1].id);expect(layerAtPoint(art,180,280,portrait)).toBeUndefined();
 expect(layerAtPoint(art,280,180,()=>undefined)?.id).toBe(art.layers[0].id);
});
