"""Bounded read-only upload prerequisites: storage inventory and /TEST.RES info.

No resource/settings/flash writes. Full transcript remains in ignored hardware/.
"""
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path

import probe_badge

EXTRA_QUERIES = (
    (0x07, bytes.fromhex('ff00000004')),
    (0x1a, b'\x0b\x00/TEST.RES'),
)


async def main():
    probe_badge.QUERIES = probe_badge.QUERIES + EXTRA_QUERIES
    matched, count = await probe_badge.scan(12)
    candidates = [(device, adv) for device, adv in matched
                  if (adv.local_name or device.name) in probe_badge.BADGE_NAMES]
    report = {
        'time_utc': datetime.now(timezone.utc).isoformat(),
        'action': 'fixed-read-only-upload-prerequisites',
        'advertising_candidates': len(candidates),
        'device_writes': 'Only raw authentication and exact read-only RCSP queries; no resource/settings writes',
    }
    if len(candidates) != 1:
        report['error'] = 'Need exactly one free advertising VivaMark; no connection attempted'
    else:
        try:
            await asyncio.wait_for(probe_badge.probe(candidates[0][0], report), 60)
        except Exception as error:
            report['error'] = f'{type(error).__name__}: {error}'
    private = Path('artifacts/hardware/upload-preflight-full.json')
    private.parent.mkdir(parents=True, exist_ok=True)
    private.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    sanitized = {key: report[key] for key in ('time_utc', 'action', 'advertising_candidates', 'device_writes', 'authenticated', 'error') if key in report}
    sanitized['responses'] = [row for row in report.get('responses', []) if row['opcode'] in (0x07, 0xd6, 0x1a)]
    output = Path('artifacts/upload-preflight-readonly.json')
    output.write_text(json.dumps(sanitized, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(sanitized, indent=2))
    return 1 if 'error' in report else 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
