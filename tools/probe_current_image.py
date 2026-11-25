"""Read-only current-watch path query, exactly 1A0300 from WatchBase.

No named-file variants, resource mutations, raw-flash reads or settings.
"""
import asyncio
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import probe_badge


async def main():
    probe_badge.QUERIES += ((0x07, bytes.fromhex('ff00000004')), (0x1a, bytes.fromhex('0300')))
    matched, count = await probe_badge.scan(15)
    candidates = [(device, adv) for device, adv in matched if (adv.local_name or device.name) in probe_badge.BADGE_NAMES]
    report = {'time_utc': datetime.now(timezone.utc).isoformat(), 'action': 'read-only-current-watch-path',
              'advertising_candidates': len(candidates), 'seen_count': count, 'resource_writes': False}
    if len(candidates) != 1:
        report['error'] = 'Need exactly one advertising VivaMark; no connection attempted'
    else:
        try:
            await asyncio.wait_for(probe_badge.probe(candidates[0][0], report), 60)
        except Exception as error:
            report['error'] = f'{type(error).__name__}: {error}'
    private = Path('artifacts/hardware/current-image-full.json')
    private.parent.mkdir(parents=True, exist_ok=True)
    private.write_text(json.dumps(report, indent=2) + '\n')
    public = {key: report[key] for key in ('time_utc','action','advertising_candidates','seen_count','resource_writes','authenticated','error') if key in report}
    public['responses'] = [r for r in report.get('responses', []) if r['opcode'] in (7, 0x1a)]
    public['private_transcript_sha256'] = hashlib.sha256(private.read_bytes()).hexdigest()
    Path('artifacts/current-image-proof.json').write_text(json.dumps(public, indent=2) + '\n')
    print(json.dumps(public, indent=2))
    return int('error' in report)


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
