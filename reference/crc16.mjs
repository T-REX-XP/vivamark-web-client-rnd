/**
 * Jieli libjl_crc.so CRC16, recovered statically from ARM64 VA 0x7f4.
 * poly=0x1021, MSB-first, refin/refout=false, xorout=0.
 * seed=0 gives CRC-16/XMODEM. Returns unsigned 16-bit value.
 */
export function crc16(bytes, seed = 0) {
  if (bytes == null) return 0; // Public Java CryptoUtil.CRC16 null behavior.
  let crc = seed & 0xffff;
  for (const byte of bytes) {
    crc ^= (byte & 0xff) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
    }
  }
  return crc;
}

export function crc16BigEndian(bytes, seed = 0) {
  const crc = crc16(bytes, seed);
  return Uint8Array.of(crc >>> 8, crc & 0xff);
}
