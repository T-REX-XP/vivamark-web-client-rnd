"""Offline root browse serialization, record parser and ACK checks."""
import unittest
from probe_browse_images import ROOT_PAYLOAD,ROOT_REQUEST,parse_records,stop_ack


class RootBrowseTest(unittest.TestCase):
    def test_root_path_bytes_are_source_exact(self):
        self.assertEqual(ROOT_PAYLOAD,bytes([0,10,0,1,0,0,0,3,0,4,0,0,0,0]))
        self.assertEqual(len(ROOT_REQUEST),23)
        self.assertEqual(ROOT_REQUEST.hex(),'fedcbac00c000f72000a000100000003000400000000ef')

    def test_gbk_file_and_unicode_folder_records(self):
        file=bytes.fromhex('0f00000042000108')+b'TEST.RES'
        folder=bytes.fromhex('0c00000043000204')+'AB'.encode('utf-16le')
        rows=parse_records(file+folder)
        self.assertEqual(rows[0],{'file':True,'unicode':False,'dev_index':3,'cluster':66,'file_number':1,'name':'TEST.RES'})
        self.assertFalse(rows[1]['file']);self.assertEqual(rows[1]['name'],'AB')
        self.assertEqual(rows[1]['cluster'],67)

    def test_stop_ack_echoes_reason(self):
        self.assertEqual(stop_ack(9,1).hex(),'fedcba000d0003000901ef')
        with self.assertRaises(ValueError):stop_ack(9,2)

    def test_parser_rejects_invalid_ranges_storage_and_flood(self):
        record=bytes.fromhex('0f00000042000108')+b'TEST.RES'
        for data in [record[:-1],bytes([0x0b])+record[1:],record+record,record*11,b'\0']:
            with self.assertRaises(ValueError):parse_records(data)


if __name__=='__main__':unittest.main()
