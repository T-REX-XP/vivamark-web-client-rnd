"""Run the supplied ARM64 image converter offline in Unicorn; no BLE/device I/O.

Only malloc/free/memcpy/memset libc calls are replaced. RLE, RGB conversion,
header generation and both CRC calculations execute the shipped instructions.
"""
import argparse
import hashlib
import json
from pathlib import Path
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_ARM64, UC_MODE_ARM, UC_HOOK_CODE
from unicorn.arm64_const import (
    UC_ARM64_REG_X0, UC_ARM64_REG_X1, UC_ARM64_REG_X2, UC_ARM64_REG_X3,
    UC_ARM64_REG_X4, UC_ARM64_REG_LR, UC_ARM64_REG_SP, UC_ARM64_REG_PC,
    UC_ARM64_REG_TPIDR_EL0,
)

LIB = Path('artifacts/extracted/native/lib/arm64-v8a/libjl_bmp_convert.so')
BASE, INPUT, OUTPUT, HEAP, STACK, STOP, TLS = (
    0x10000000, 0x20000000, 0x22000000, 0x30000000,
    0x40000000, 0x50000000, 0x51000000,
)
PAGE = 4096


def native_encode(rgba: bytes, width: int, height: int) -> bytes:
    if len(rgba) != width * height * 4 or min(width, height) < 1:
        raise ValueError('Invalid RGBA input')
    uc = Uc(UC_ARCH_ARM64, UC_MODE_ARM)
    with LIB.open('rb') as stream:
        elf = ELFFile(stream)
        segments = [s for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']
        image_end = max(s['p_vaddr'] + s['p_memsz'] for s in segments)
        uc.mem_map(BASE, (image_end + PAGE - 1) & -PAGE)
        for seg in segments:
            uc.mem_write(BASE + seg['p_vaddr'], seg.data())
        symbols = elf.get_section_by_name('.dynsym')
        funcs = {s.name: s['st_value'] for s in symbols.iter_symbols()}
        rel = elf.get_section_by_name('.rela.plt')
        names = elf.get_section(rel['sh_link'])
        plt = elf.get_section_by_name('.plt')['sh_addr']
        imports = {plt + 32 + i * 16: names.get_symbol(r['r_info_sym']).name
                   for i, r in enumerate(rel.iter_relocations())}

    for address, size in [(INPUT, 0x2000000), (OUTPUT, 0x2000000),
                          (HEAP, 0x4000000), (STACK, 0x200000),
                          (STOP, PAGE), (TLS, PAGE)]:
        uc.mem_map(address, size)
    bgra = bytearray(rgba)
    bgra[0::4], bgra[2::4] = rgba[2::4], rgba[0::4]
    uc.mem_write(INPUT, bytes(bgra))
    cursor = HEAP

    def imported(machine, address, size, name):
        nonlocal cursor
        a = machine.reg_read(UC_ARM64_REG_X0)
        b = machine.reg_read(UC_ARM64_REG_X1)
        c = machine.reg_read(UC_ARM64_REG_X2)
        if name in ('Rle_Encode', 'Crc16'):
            machine.reg_write(UC_ARM64_REG_PC, BASE + funcs[name])
            return
        if name == 'malloc':
            value = cursor
            cursor += max(16, (a + 15) & -16)
            if cursor >= HEAP + 0x4000000:
                raise MemoryError('Emulated heap exhausted')
        elif name == 'free':
            value = 0
        elif name == 'memcpy':
            machine.mem_write(a, bytes(machine.mem_read(b, c)))
            value = a
        elif name == 'memset':
            machine.mem_write(a, bytes([b & 255]) * c)
            value = a
        else:
            raise RuntimeError(f'Unexpected import: {name} at {address:#x}')
        machine.reg_write(UC_ARM64_REG_X0, value)
        machine.reg_write(UC_ARM64_REG_PC, machine.reg_read(UC_ARM64_REG_LR))

    for va, name in imports.items():
        uc.hook_add(UC_HOOK_CODE, imported, user_data=name,
                    begin=BASE + va, end=BASE + va)
    for register, value in [(UC_ARM64_REG_X0, INPUT), (UC_ARM64_REG_X1, width),
                            (UC_ARM64_REG_X2, height), (UC_ARM64_REG_X3, 1),
                            (UC_ARM64_REG_X4, OUTPUT), (UC_ARM64_REG_SP, STACK + 0x1ff000),
                            (UC_ARM64_REG_LR, STOP), (UC_ARM64_REG_TPIDR_EL0, TLS)]:
        uc.reg_write(register, value)
    uc.emu_start(BASE + funcs['br28_bmp_to_res'], STOP,
                 timeout=60_000_000, count=100_000_000)
    if uc.reg_read(UC_ARM64_REG_PC) != STOP:
        raise RuntimeError('Emulation reached its time/instruction limit')
    size = uc.reg_read(UC_ARM64_REG_X0) & 0xffffffff
    if size >= 0x2000000:
        raise RuntimeError(f'Unexpected native output size {size}')
    return bytes(uc.mem_read(OUTPUT, size))


def fixtures():
    yield 'red-1x1', 1, 1, bytes([255, 0, 0, 255])
    for n in [2, 3, 8, 9, 16, 17, 126, 127, 128, 129, 254, 255, 256, 360]:
        yield f'solid-{n}x1', n, 1, bytes([19, 101, 219, 70]) * n
    for n in [7, 8, 9, 16, 17, 127, 128, 360]:
        yield f'colors-{n}x3', n, 3, bytes((i * 73 + (i >> 8)) & 255 for i in range(n * 3 * 4))
    # Literal/repeat boundary shifts, two-unit runs and row reset exercise.
    for shift in [0, 1, 2, 125, 126, 127]:
        pixels = [[i & 255, (i * 17) & 255, (i * 37) & 255, 255] for i in range(360)]
        for i in range(shift, min(shift + 3, 360)):
            pixels[i] = [255, 0, 0, 0]
        yield f'boundary-{shift}', 360, 1, bytes(v for p in pixels for v in p)
    yield 'solid-360x360', 360, 360, bytes([11, 83, 240, 255]) * (360 * 360)
    yield 'gradient-360x360', 360, 360, bytes(v for y in range(360) for x in range(360)
          for v in [x * 255 // 359, y * 255 // 359, (x + y) * 255 // 718, (x * y) & 255])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--fixtures', type=Path)
    parser.add_argument('--rgba', type=Path)
    parser.add_argument('--width', type=int)
    parser.add_argument('--height', type=int)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.fixtures:
        args.fixtures.mkdir(parents=True, exist_ok=True)
        manifest = {'library_sha256': hashlib.sha256(LIB.read_bytes()).hexdigest(), 'fixtures': []}
        for name, width, height, data in fixtures():
            result = native_encode(data, width, height)
            (args.fixtures / f'{name}.rgba').write_bytes(data)
            (args.fixtures / f'{name}.res').write_bytes(result)
            manifest['fixtures'].append({'name': name, 'width': width, 'height': height,
                 'rgba_sha256': hashlib.sha256(data).hexdigest(),
                 'res_sha256': hashlib.sha256(result).hexdigest(), 'res_bytes': len(result)})
            print(name, len(result), flush=True)
        (args.fixtures / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    else:
        result = native_encode(args.rgba.read_bytes(), args.width, args.height)
        args.output.write_bytes(result)
