"""Record extraction identity; run from the repository root after extraction."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
paths = sorted(p for p in (root / 'artifacts').rglob('*')
               if p.is_file() and p.name != 'extraction-manifest.json'
               and 'hardware' not in p.relative_to(root / 'artifacts').parts)
records = []
for path in paths:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    records.append({'path': path.relative_to(root).as_posix(),
                    'bytes': path.stat().st_size, 'sha256': digest.hexdigest()})
destination = root / 'artifacts/extraction-manifest.json'
destination.write_text(json.dumps({'execution': 'static-only; APK and native libraries not executed',
    'source': 'artifacts/VivaMark_2026.03.12.20-25_apkcube.apks',
    'files': records}, indent=2) + '\n', encoding='utf-8')
print(f'Recorded {len(records)} files in {destination}')
