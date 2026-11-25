import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export const root = join(import.meta.dir, '..');
export function normalizeBasePath(value='/') {
  if(!/^[a-zA-Z0-9._~/-]*$/.test(value)||value.split('/').some(part=>part==='.'||part==='..'))throw new Error('BASE_PATH must be a URL path without traversal or query parameters');
  const parts=value.split('/').filter(Boolean);return parts.length?`/${parts.join('/')}/`:'/';
}
export async function buildApp(options:{basePath?:string;outdir?:string}={}) {
  const basePath=normalizeBasePath(options.basePath??process.env.BASE_PATH??'/');
  const outdir = options.outdir??join(import.meta.dir, 'dist');
  await mkdir(outdir, { recursive: true });
  const result = await Bun.build({ entrypoints: [join(import.meta.dir, 'src/main.tsx')],
    outdir, target: 'browser', minify: true, sourcemap: 'external',publicPath:basePath,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') } });
  if (!result.success) throw new Error(result.logs.map(String).join('\n'));
  await cp(join(import.meta.dir,'public'),outdir,{recursive:true});
  const template=await readFile(join(import.meta.dir,'index.html'),'utf8');
  await writeFile(join(outdir,'index.html'),template.replace('href="/style.css"',`href="${basePath}style.css"`).replace('src="/main.js"',`src="${basePath}main.js"`));
  await writeFile(join(outdir,'.nojekyll'),'');
  await writeFile(join(outdir,'404.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${basePath}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VivaMark Studio</title></head><body><a href="${basePath}">Open VivaMark Studio</a></body></html>\n`);
  const day=new Date().toISOString().slice(0,10).replaceAll('-','.');
  await writeFile(join(outdir,'version.json'),JSON.stringify({version:process.env.APP_VERSION??`${day}.${process.env.BUILD_NUMBER??'1'}`,repository:process.env.GITHUB_REPOSITORY??'T-REX-XP/vivamark-web-client-rnd',revision:process.env.GITHUB_SHA??null,built_at:new Date().toISOString(),base_path:basePath,source:process.env.GITHUB_ACTIONS?'github-actions':'local-build'},null,2)+'\n');
  return result;
}
if (import.meta.main) { await buildApp(); console.log('Built app/dist'); }
