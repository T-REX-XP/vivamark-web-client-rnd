// Bun 1.2.2 lacks node:test; keep upstream reference tests runnable with Node.
import { readdir } from 'node:fs/promises';
const app = Bun.spawn(['bun','test','app/src'],{stdout:'inherit',stderr:'inherit'});
if(await app.exited)process.exit(1);
for(const name of (await readdir('reference')).filter(n=>n.endsWith('.test.mjs'))){
  const test=Bun.spawn(['node',`reference/${name}`],{stdout:'inherit',stderr:'inherit'});
  if(await test.exited)process.exit(1);
}
