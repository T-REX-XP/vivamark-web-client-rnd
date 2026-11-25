"""Offline ELF symbol inventory / selected ARM64 disassembly. Never runs the target."""
import sys
from elftools.elf.elffile import ELFFile
from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM

with open(sys.argv[1], 'rb') as stream:
    elf = ELFFile(stream)
    for section in elf.iter_sections():
        if section.name not in ('.symtab', '.dynsym'):
            continue
        for symbol in section.iter_symbols():
            name, address, size = symbol.name, symbol['st_value'], symbol['st_size']
            if len(sys.argv) == 2:
                print(f'{address:08x} {size:6d} {name}')
            elif sys.argv[2].lower() in name.lower() and size and symbol['st_info']['type'] == 'STT_FUNC':
                print(f'\n{name} @ {address:#x} size {size}')
                for segment in elf.iter_segments():
                    if segment['p_type'] == 'PT_LOAD' and segment['p_vaddr'] <= address < segment['p_vaddr'] + segment['p_filesz']:
                        offset = address - segment['p_vaddr']
                        for insn in Cs(CS_ARCH_ARM64, CS_MODE_ARM).disasm(segment.data()[offset:offset + size], address):
                            print(f'{insn.address:08x} {insn.mnemonic:8s} {insn.op_str}')
                        break
