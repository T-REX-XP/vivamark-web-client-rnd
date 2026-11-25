"""Offline guardrail checks; importing the probe does not scan/connect."""
import unittest
from probe_badge import QUERIES, encode_query


class ProbePolicyTest(unittest.TestCase):
    def test_exact_query_wire_vectors(self):
        expected = ['fedcbac003000600ffffffff00ef', 'fedcbac0d6000100ef', 'fedcbac01a0003000c00ef']
        for (opcode, data), wire in zip(QUERIES, expected):
            self.assertEqual(encode_query(opcode, 0, data).hex(), wire)

    def test_resource_and_changed_queries_are_denied(self):
        for opcode, data in [(26,b'\x02\x00'),(26,b'\x07\x01'),(27,b''),(3,b''),
                             (26,b'\x0c\x01'),(26,b'\x0c\x00\x00'),(255,b'')]:
            with self.assertRaises(ValueError):
                encode_query(opcode, 0, data)


if __name__ == '__main__':
    unittest.main()
