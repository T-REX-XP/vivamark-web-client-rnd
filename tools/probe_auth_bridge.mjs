// Offline calculation only. stdin records are 17-byte challenges as JSON hex.
import { createInterface } from 'node:readline';
import { deriveAuthResponse } from '../reference/jieli-auth.mjs';
const input = createInterface({ input: process.stdin });
for await (const line of input) {
  try {
    const item = JSON.parse(line);
    if (typeof item.challenge !== 'string' || !/^00[0-9a-f]{32}$/i.test(item.challenge)) throw Error('Expected 17-byte challenge beginning 00');
    const response = deriveAuthResponse(Uint8Array.from(Buffer.from(item.challenge, 'hex')));
    process.stdout.write(JSON.stringify({response:Buffer.from(response).toString('hex')})+'\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({error:String(error.message)})+'\n');
  }
}
