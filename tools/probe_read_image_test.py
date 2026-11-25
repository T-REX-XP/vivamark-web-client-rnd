"""Offline checks for the fixed read probe; no adapter/device calls."""
import unittest
from pathlib import Path
from probe_read_image import START, START_BARE, crc16, validate_res


class FixedReadProbeTest(unittest.TestCase):
    def test_exact_named_read_frame(self):
        self.assertEqual(START[:7], bytes.fromhex('fedcbac0240014'))
        self.assertEqual(START[7], 0x71)
        self.assertEqual(START[8:-1], bytes.fromhex('02000000030000000009')+b'/TEST.RES')
        self.assertEqual(START[-1], 239)
        self.assertEqual(len(START), 28)
        self.assertEqual(START_BARE[8:-1],bytes.fromhex('02000000030000000008')+b'TEST.RES')
        self.assertEqual(START_BARE[5:7],bytes.fromhex('0013'))
        self.assertEqual(len(START_BARE),27)

    def test_native_resource_validation_and_crc_corruption(self):
        self.assertEqual(crc16(b'123456789'),0x31c3)
        resource=bytearray(Path('artifacts/image-fixtures/gradient-360x360.res').read_bytes())
        self.assertEqual(validate_res(resource)['width'],360)
        resource[-1]^=1
        with self.assertRaisesRegex(ValueError,'CRC'):
            validate_res(resource)


if __name__=='__main__':unittest.main()
