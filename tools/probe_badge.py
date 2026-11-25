"""Bounded VivaMark discovery and read-only RCSP capability probe.

Default invocation scans advertisements only. It never disconnects another host.
"""
import argparse
import asyncio
import json
import secrets
import sys
from pathlib import Path
from datetime import datetime, timezone
from bleak import BleakScanner, BleakClient

SERVICE = '0000ae00-0000-1000-8000-00805f9b34fb'
BADGE_NAMES = frozenset({'VivaMark', 'D40(BLE)'})
WRITE = '0000ae01-0000-1000-8000-00805f9b34fb'
NOTIFY = '0000ae02-0000-1000-8000-00805f9b34fb'
PASS = bytes([2, 112, 97, 115, 115])
QUERIES = ((3, bytes.fromhex('ffffffff00')), (0xd6, b''), (0x1a, bytes.fromhex('0c00')))


def encode_query(opcode, sequence, data):
    if (opcode, data) not in QUERIES or not 0 <= sequence <= 255:
        raise ValueError('Query denied by fixed read-only allowlist')
    n = len(data) + 1
    return bytes([254, 220, 186, 192, opcode, n >> 8, n & 255, sequence]) + data + b'\xef'


class ReceiveBuffer:
    def __init__(self, queue):
        self.queue, self.data = queue, bytearray()

    async def need(self, count):
        while len(self.data) < count:
            self.data.extend(await asyncio.wait_for(self.queue.get(), 8))
            if len(self.data) > 16384:
                raise ValueError('Receive buffer exceeded')

    def take(self, count):
        out = bytes(self.data[:count])
        del self.data[:count]
        return out

    async def auth(self):
        await self.need(1)
        kind = self.data[0]
        if kind not in (0, 1, 2):
            raise ValueError('Unexpected authentication prefix')
        n = 5 if kind == 2 else 17
        await self.need(n)
        return self.take(n)

    async def frame(self):
        await self.need(7)
        if self.data[:3] != b'\xfe\xdc\xba' or self.data[3] & 63:
            raise ValueError('Malformed RCSP header')
        n = int.from_bytes(self.data[5:7], 'big')
        command = bool(self.data[3] & 128)
        if n < (1 if command else 2) or n > 8192:
            raise ValueError('Malformed RCSP length')
        await self.need(n + 8)
        raw = self.take(n + 8)
        if raw[-1] != 239:
            raise ValueError('Malformed RCSP trailer')
        return {'command': command, 'opcode': raw[4],
                'sequence': raw[7] if command else raw[8],
                'status': None if command else raw[7],
                'needs_response': bool(raw[3] & 64),
                'data': raw[8:-1] if command else raw[9:-1]}


async def probe(device, report, read_image=False, browse_root=False):
    bridge = await asyncio.create_subprocess_exec(
        'node', str(Path(__file__).with_name('probe_auth_bridge.mjs')),
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
    events = report['events'] = []
    queue = asyncio.Queue()
    receive = ReceiveBuffer(queue)

    def log(direction, data):
        events.append({'time_utc': datetime.now(timezone.utc).isoformat(),
                       'direction': direction, 'hex': data.hex()})

    async def derive(challenge):
        bridge.stdin.write((json.dumps({'challenge': challenge.hex()}) + '\n').encode())
        await bridge.stdin.drain()
        item = json.loads(await asyncio.wait_for(bridge.stdout.readline(), 5))
        if 'error' in item:
            raise ValueError(item['error'])
        result = bytes.fromhex(item['response'])
        if len(result) != 17 or result[0] != 1:
            raise ValueError('Invalid authentication calculation result')
        return result

    def notified(sender, data):
        log('rx', data)
        queue.put_nowait(bytes(data))

    try:
        async with BleakClient(device, timeout=20, pair=False, winrt={'use_cached_services': False}) as client:
            report['services'] = [{'uuid': service.uuid,
                'characteristics': [{'uuid': char.uuid, 'properties': list(char.properties)}
                                    for char in service.characteristics]}
                                   for service in client.services]
            service = client.services.get_service(SERVICE)
            if service is None:
                raise ValueError('Expected AE00 service missing')
            write = service.get_characteristic(WRITE)
            notify = service.get_characteristic(NOTIFY)
            if write is None or notify is None:
                raise ValueError('Expected AE01/AE02 characteristics missing')
            if 'write' not in write.properties and 'write-without-response' not in write.properties:
                raise ValueError('AE01 is not writable')

            async def send_exact(data):
                log('tx', data)
                for offset in range(0, len(data), 20):
                    await asyncio.wait_for(client.write_gatt_char(
                        write, data[offset:offset + 20], response='write' in write.properties), 8)

            await client.start_notify(notify, notified)
            challenge = b'\x00' + secrets.token_bytes(16)
            expected = await derive(challenge)
            await send_exact(challenge)
            if await receive.auth() != expected:
                raise ValueError('Device authentication response mismatch')
            await send_exact(PASS)
            for _ in range(4):
                record = await receive.auth()
                if record == PASS:
                    break
                if record[0] != 0:
                    raise ValueError('Unexpected mutual authentication record')
                await send_exact(await derive(record))
            else:
                raise ValueError('Authentication did not complete')
            report['authenticated'] = True
            report['responses'] = []
            for sequence, (opcode, data) in enumerate(QUERIES):
                await send_exact(encode_query(opcode, sequence, data))
                for _ in range(16):
                    frame = await receive.frame()
                    if frame['command']:
                        # No unsolicited command replies are sent by this probe.
                        continue
                    if frame['opcode'] == opcode and frame['sequence'] == sequence:
                        report['responses'].append({'opcode': opcode, 'sequence': sequence,
                                                    'status': frame['status'], 'data_hex': frame['data'].hex()})
                        if frame['status'] != 0:
                            raise ValueError(f'Read-only query {opcode:#x} returned status {frame["status"]}')
                        break
                else:
                    raise ValueError('Too many unmatched frames')
            if read_image:
                from probe_read_image import read_fixed_resource
                await read_fixed_resource(receive, send_exact, report, bare_name=read_image=='basename')
            if browse_root:
                from probe_browse_images import browse_fixed_root
                await browse_fixed_root(receive, send_exact, report)
    finally:
        if bridge.returncode is None:
            bridge.terminate()
        await bridge.wait()


async def scan(timeout):
    devices = await BleakScanner.discover(timeout=timeout, return_adv=True)
    matched = []
    for device, adv in devices.values():
        name = adv.local_name or device.name or ''
        if name not in BADGE_NAMES and 'vivamark' not in name.lower() and SERVICE not in adv.service_uuids:
            continue
        matched.append((device, adv))
    return matched, len(devices)


async def main(args):
    matched, count = await scan(args.timeout)
    report = {'time_utc': datetime.now(timezone.utc).isoformat(),
              'action': 'advertisement-scan-only', 'seen_count': count,
              'matches': [{'name': adv.local_name or device.name,
                           'address_suffix': device.address[-5:], 'rssi': adv.rssi,
                           'service_uuids': adv.service_uuids,
                           'manufacturer_data': {str(k): v.hex() for k, v in adv.manufacturer_data.items()},
                           'service_data': {k: v.hex() for k, v in adv.service_data.items()}}
                          for device, adv in matched]}
    if args.read_only:
        candidates = [(device, adv) for device, adv in matched
                      if (adv.local_name or device.name) in BADGE_NAMES]
        if len(candidates) != 1:
            report['error'] = 'Read-only probe requires exactly one advertising VivaMark or D40(BLE)'
        else:
            report['action'] = 'authenticated-fixed-read-only-queries'
            try:
                await asyncio.wait_for(probe(candidates[0][0], report), 50)
            except Exception as error:
                report['error'] = f'{type(error).__name__}: {error}'
    text = json.dumps(report, indent=2)
    print(text)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--timeout', type=float, default=15)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--read-only', action='store_true',
                        help='Authenticate, then send only fixed03/D6/free-space queries; no resource/settings writes')
    args = parser.parse_args()
    if not 1 <= args.timeout <= 60:
        parser.error('Timeout must be 1..60 seconds')
    asyncio.run(main(args))
