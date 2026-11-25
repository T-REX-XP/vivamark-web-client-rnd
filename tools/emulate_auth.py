"""Differentially validate the JS auth port against original ARM64 instructions.

Executes only function_E1test from the extracted Android ELF in Unicorn.
malloc/free/TLS are modeled; JNI, networking and Bluetooth are not invoked.
Run from repository root with .venv-native/Scripts/python.exe tools/emulate_auth.py.
"""
import hashlib
import json
from pathlib import Path
import random
import struct
import subprocess
import sys

import unicorn
from unicorn import Uc, UC_ARCH_ARM64, UC_MODE_ARM, UC_HOOK_CODE
from unicorn.arm64_const import (
    UC_ARM64_REG_X0, UC_ARM64_REG_X1, UC_ARM64_REG_X2, UC_ARM64_REG_X3,
    UC_ARM64_REG_X30, UC_ARM64_REG_SP, UC_ARM64_REG_PC, UC_ARM64_REG_TPIDR_EL0,
)
from elftools.elf.elffile import ELFFile

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'artifacts/extracted/native/lib/arm64-v8a/libjl_bluetooth.so'
EXPECTED_SHA256 = 'ef9d3c61b0f970522490e6e9b46ca3f467206306ce55c42e8fd763c383318fdb'
BASE, STACK, HEAP, TLS, INPUT, RETURN = 0x100000, 0x800000, 0x900000, 0xa00000, 0xb00000, 0xc00000
DEFAULT_KEY = bytes.fromhex('06775f87918dd423005df1d8cf0c142b')
FIXED_SEED = bytes.fromhex('112233332211')


class AuthEmulator:
    def __init__(self):
        digest = hashlib.sha256(TARGET.read_bytes()).hexdigest()
        if digest != EXPECTED_SHA256:
            raise ValueError(f'Unexpected ELF digest: {digest}')
        self.uc = Uc(UC_ARCH_ARM64, UC_MODE_ARM)
        self.uc.mem_map(BASE, 0x20000)
        with TARGET.open('rb') as stream:
            elf = ELFFile(stream)
            for segment in elf.iter_segments():
                if segment['p_type'] == 'PT_LOAD':
                    self.uc.mem_write(BASE + segment['p_vaddr'], segment.data())
            # Original instructions do not require these JNI relocations, but
            # apply all loader-relative pointers to retain normal ELF layout.
            for section in elf.iter_sections():
                if section.name == '.rela.dyn':
                    for relocation in section.iter_relocations():
                        if relocation['r_info_type'] == 1027:  # R_AARCH64_RELATIVE
                            self.uc.mem_write(BASE + relocation['r_offset'], struct.pack('<Q', BASE + relocation['r_addend']))
        for address, size in [(STACK, 0x10000), (HEAP, 0x10000), (TLS, 0x1000), (INPUT, 0x1000), (RETURN, 0x1000)]:
            self.uc.mem_map(address, size)
        self.uc.reg_write(UC_ARM64_REG_TPIDR_EL0, TLS)
        self.uc.mem_write(TLS + 0x28, struct.pack('<Q', 0x9876543210abcdef))
        # Invoke Python only at external-call/return boundaries, not for every
        # cipher instruction. All arithmetic executes directly in Unicorn.
        self.uc.hook_add(UC_HOOK_CODE, self.hook, begin=BASE + 0x2400, end=BASE + 0x24df)
        self.uc.hook_add(UC_HOOK_CODE, self.hook, begin=RETURN, end=RETURN)
        self.heap_offset = 0
        self.allocations = 0
        self.reached_return = False

    def hook(self, uc, address, size, data):
        if address == RETURN:
            self.reached_return = True
            uc.emu_stop()
        elif address == BASE + 0x2450:  # malloc PLT
            size = uc.reg_read(UC_ARM64_REG_X0)
            if self.heap_offset + size > 0x10000:
                raise ValueError('Emulated allocation exceeds bounded heap')
            result = HEAP + self.heap_offset
            self.heap_offset += (size + 15) & ~15
            self.allocations += 1
            # Poison fresh allocation so success does not rely on zeroed malloc.
            uc.mem_write(result, b'\xa5' * size)
            uc.reg_write(UC_ARM64_REG_X0, result)
            uc.reg_write(UC_ARM64_REG_PC, uc.reg_read(UC_ARM64_REG_X30))
        elif address == BASE + 0x2460:  # free PLT
            uc.reg_write(UC_ARM64_REG_PC, uc.reg_read(UC_ARM64_REG_X30))
        elif address == BASE + 0x2470:
            raise ValueError('Original native stack canary check failed')
        elif BASE + 0x2400 <= address < BASE + 0x24e0:
            raise ValueError(f'Unexpected external PLT call {address - BASE:#x}')

    def derive(self, random16, key16):
        if len(random16) != 16 or len(key16) != 16:
            raise ValueError('Exactly 16 random and key bytes required')
        self.heap_offset = 0
        self.allocations = 0
        self.reached_return = False
        self.uc.mem_write(STACK, b'\x5a' * 0x10000)
        self.uc.mem_write(INPUT, FIXED_SEED + b'\x00' * 26 + random16 + key16 + b'\xcc' * 32)
        self.uc.reg_write(UC_ARM64_REG_X0, INPUT)
        self.uc.reg_write(UC_ARM64_REG_X1, INPUT + 32)
        self.uc.reg_write(UC_ARM64_REG_X2, INPUT + 48)
        self.uc.reg_write(UC_ARM64_REG_X3, INPUT + 64)
        self.uc.reg_write(UC_ARM64_REG_SP, STACK + 0xff00)
        self.uc.reg_write(UC_ARM64_REG_X30, RETURN)
        self.uc.emu_start(BASE + 0x12c0, RETURN + 4, timeout=2_000_000, count=1_000_000)
        if not self.reached_return or self.allocations != 1:
            raise ValueError(f'Incomplete native call: returned={self.reached_return}, allocations={self.allocations}')
        return b'\x01' + bytes(self.uc.mem_read(INPUT + 64, 16))


def cases():
    rng = random.Random(0x564956414d41524b)
    # Fixed edge cases and isolated changes to each input/key byte.
    for value in [0, 1, 0x7f, 0x80, 0xfe, 0xff]:
        yield bytes([value]) * 16, DEFAULT_KEY, f'fixed-{value:02x}'
    yield bytes(range(16)), DEFAULT_KEY, 'ascending'
    yield bytes(reversed(range(16))), DEFAULT_KEY, 'descending'
    for index in range(16):
        block = bytearray(16)
        block[index] = 0x80
        yield bytes(block), DEFAULT_KEY, f'isolated-challenge-byte-{index}'
        key = bytearray(DEFAULT_KEY)
        key[index] ^= 0xff
        yield bytes(16), bytes(key), f'isolated-key-byte-{index}'
    for index in range(256):
        yield rng.randbytes(16), DEFAULT_KEY, f'random-default-{index}'
        yield rng.randbytes(16), rng.randbytes(16), f'random-custom-{index}'


def main():
    emulator = AuthEmulator()
    vectors = []
    for block, key, label in cases():
        vectors.append({'label': label, 'challenge': '00' + block.hex(), 'linkKey': key.hex(), 'response': emulator.derive(block, key).hex()})
    js = '''
import fs from 'node:fs';
import { deriveAuthResponse } from './reference/jieli-auth.mjs';
const rows = JSON.parse(fs.readFileSync(0, 'utf8'));
const fromHex = value => Uint8Array.from(Buffer.from(value, 'hex'));
process.stdout.write(JSON.stringify(rows.map(row => Buffer.from(deriveAuthResponse(fromHex(row.challenge), fromHex(row.linkKey))).toString('hex'))));
'''
    completed = subprocess.run(['node', '--input-type=module', '-e', js], cwd=ROOT, input=json.dumps(vectors), text=True, capture_output=True, check=True)
    predictions = json.loads(completed.stdout)
    mismatches = [dict(vector, javascriptResponse=actual) for vector, actual in zip(vectors, predictions) if vector['response'] != actual]
    if len(predictions) != len(vectors):
        raise ValueError('JavaScript result count mismatch')
    report = {
        'sourceSha256': EXPECTED_SHA256,
        'nativeEntryVirtualAddress': '0x12c0',
        'engine': f'Unicorn {unicorn.__version__} ARM64',
        'modeledExternals': ['malloc', 'free', 'TPIDR_EL0 and stack canary'],
        'vectorCount': len(vectors), 'matchedCount': len(vectors) - len(mismatches),
        'hardwareValidated': False, 'jniLifecycleExecuted': False,
        'mismatches': mismatches, 'vectors': vectors,
    }
    output = ROOT / 'artifacts/auth-native-vectors.json'
    output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key not in ('vectors', 'mismatches')}, indent=2))
    if mismatches:
        print(json.dumps(mismatches[:3], indent=2))
        return 1
    print(f'All native responses match JavaScript. Saved {output}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
