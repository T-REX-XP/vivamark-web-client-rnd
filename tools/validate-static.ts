import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {buildApp,normalizeBasePath} from '../app/build';
import {createStaticHandler} from '../app/preview';

for(const value of ['../escape','/repo/../escape','https://example.com/','/repo/?query'])assert.throws(()=>normalizeBasePath(value));
const temporaryRoot=await mkdtemp(join(tmpdir(),'vivamark-static-'));
try{
 for(const basePath of ['/','/vivamark-web-client-rnd/']){
  const directory=join(temporaryRoot,basePath==='/'?'root':'pages');await buildApp({outdir:directory,basePath});
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:createStaticHandler(directory,basePath)});
  try{
   const address=new URL(basePath,server.url),response=await fetch(address);assert.equal(response.status,200);
   const html=await response.text();assert.ok(html.includes(`href="${basePath}style.css"`));assert.ok(html.includes(`src="${basePath}main.js"`));
   for(const asset of ['main.js','style.css','assets/COOL.png','assets/yes.jpg','.nojekyll','version.json']){
    const result=await fetch(new URL(asset,address));assert.equal(result.status,200,`${basePath}${asset}`);if(asset!=='.nojekyll')assert.ok((await result.arrayBuffer()).byteLength>0);
   }
   const metadata=await(await fetch(new URL('version.json',address))).json();assert.equal(metadata.base_path,basePath);
   assert.equal((await fetch(new URL('%5c..%5cpackage.json',address))).status,400);
   const missing=await fetch(new URL('missing',address));assert.equal(missing.status,404);assert.ok((await missing.text()).includes(`url=${basePath}`));
   if(basePath!=='/'){assert.equal((await fetch(new URL('/',server.url))).status,404);assert.equal((await fetch(new URL(basePath.slice(0,-1),server.url),{redirect:'manual'})).status,308);}
   console.log(`Static build verified: ${basePath}`);
  }finally{await server.stop(true);}
 }
}finally{
 const target=resolve(temporaryRoot),parent=resolve(tmpdir());
 if(!target.startsWith(parent+sep)||!target.slice(parent.length+1).startsWith('vivamark-static-'))throw new Error('Refusing to clean outside the static-test directory');
 await rm(target,{recursive:true,force:true});
}
