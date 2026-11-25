import {cp,mkdir,readdir,stat} from 'node:fs/promises';
import {resolve,join,dirname,relative} from 'node:path';

// A fresh snapshot avoids publishing the original R&D repository's binary history.
const source=resolve(import.meta.dir,'..');
const argument=process.argv[2];
if(!argument)throw new Error('Usage: bun tools/export-public.ts <new-empty-directory>');
const target=resolve(argument);
if(!relative(source,target).startsWith('..')||target===source)throw new Error('Destination must be outside the R&D checkout');
try{if((await readdir(target)).length)throw new Error('Destination must be empty');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const roots=['.github','.gitignore','README.md','DESIGN.md','PRODUCT.md','package.json','bun.lock','tsconfig.json','app','docs','reference','tools'];
const shared=['auth-disassembly.txt','auth-native-vectors.json','image-disassembly.txt','extraction-manifest.json','image-fixtures','ui-fixtures','live-badge-readonly.json','root-browse-proof.json','basename-read-proof.json','current-image-proof.json','named-read-proof.json','upload-preflight-readonly.json','discovery-alias-readonly.json'];
const excluded=new Set(['node_modules','dist','vendor','__pycache__','.git']);
let count=0;
async function copy(path:string){
 if(path.split(/[\\/]/).some(part=>excluded.has(part))||/\.(?:apk|apks|so|pyc|log)$/i.test(path))return;
 const input=join(source,path),info=await stat(input);
 if(info.isDirectory()){for(const name of await readdir(input))await copy(join(path,name));return;}
 const output=join(target,path);await mkdir(dirname(output),{recursive:true});await cp(input,output);count++;
}
for(const path of [...roots,...shared.map(name=>`artifacts/${name}`)])await copy(path);
console.log(`Exported ${count} files to ${target}. Initialize a new Git repository there; do not copy R&D Git history.`);
