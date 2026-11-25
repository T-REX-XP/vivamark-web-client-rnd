import { buildApp } from './build';
import { watch } from 'node:fs';
import { join, extname } from 'node:path';
await buildApp();
const types: Record<string,string> = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.json':'application/json', '.woff2':'font/woff2' };
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PORT || 3000), async fetch(request) {
  let path: string;
  try { path = decodeURIComponent(new URL(request.url).pathname); } catch { return new Response('Bad URL',{status:400}); }
  if (path.includes('..') || path.includes('\\') || path.includes('\0')) return new Response('Not found',{status:404});
  if (path === '/api/health') return Response.json({ app:'VivaMark Studio', deviceWrites:false });
  const base = path.startsWith('/assets/') || path === '/style.css' ? 'public' : 'dist';
  const file = Bun.file(join(import.meta.dir, base, path === '/' ? 'index.html' : path));
  if (!await file.exists()) return new Response('Not found',{status:404});
  return new Response(file, { headers: { 'Content-Type':types[extname(path === '/' ? '/index.html' : path)] || 'application/octet-stream', 'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff', 'Permissions-Policy':'bluetooth=(self), camera=(self)',
    'Content-Security-Policy':"default-src 'self' blob: data:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" } });
}});
let timer: ReturnType<typeof setTimeout>;
watch(join(import.meta.dir,'src'),{recursive:true},()=>{clearTimeout(timer);timer=setTimeout(()=>buildApp().then(()=>console.log('Rebuilt; refresh browser')).catch(console.error),200);});
console.log(`VivaMark Studio: ${server.url}`);
