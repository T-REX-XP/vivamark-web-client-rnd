import {join,resolve} from 'node:path';
import {normalizeBasePath} from './build';

const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.map':'application/json'};
export function createStaticHandler(directory:string,base='/') {
 const root=resolve(directory),basePath=normalizeBasePath(base);
 return async(request:Request)=>{
  const url=new URL(request.url);let path:string;
  try{path=decodeURIComponent(url.pathname);}catch{return new Response('Bad URL',{status:400});}
  if(path.includes('\\')||path.includes('\0')||path.split('/').includes('..'))return new Response('Bad URL',{status:400});
  if(basePath!=='/'&&path===basePath.slice(0,-1))return Response.redirect(new URL(basePath,url),308);
  if(!path.startsWith(basePath))return new Response('Not found',{status:404});
  const relative=path.slice(basePath.length)||'index.html';
  const file=Bun.file(join(root,relative));
  if(!await file.exists())return new Response(await Bun.file(join(root,'404.html')).text(),{status:404,headers:{'Content-Type':'text/html; charset=utf-8'}});
  const extension=relative.slice(relative.lastIndexOf('.'));
  return new Response(file,{headers:{'Content-Type':types[extension]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Permissions-Policy':'bluetooth=(self), camera=(self)',
   'Content-Security-Policy':"default-src 'self' blob: data:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"}});
 };
}
if(import.meta.main){
 const directory=join(import.meta.dir,'dist'),metadata=await Bun.file(join(directory,'version.json')).json();
 const server=Bun.serve({hostname:'127.0.0.1',port:Number(process.env.PORT??3001),fetch:createStaticHandler(directory,metadata.base_path)});
 console.log(`Pages preview: ${new URL(metadata.base_path,server.url)}`);
}
