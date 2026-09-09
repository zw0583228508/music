import unittest

import collate


def ex(n_in, n_lab, base=10):
    return {"inputIds": [base + i for i in range(n_in)], "labelIds": [base + 100 + i for i in range(n_lab - 1)] + [2]}


class PadBatchTests(unittest.TestCase):
    def test_pads_inputs_with_pad_id_and_labels_with_minus_100(self):
        out = collate.pad_batch([ex(3, 2), ex(5, 4)], pad_id=3)
        self.assertEqual(out["input_ids"][0], [10, 11, 12, 3, 3])
        self.assertEqual(out["attention_mask"][0], [1, 1, 1, 0, 0])
        self.assertEqual(out["attention_mask"][1], [1, 1, 1, 1, 1])
        self.assertEqual(out["labels"][0], [110, 2, -100, -100])
        self.assertEqual(out["labels"][1], [110, 111, 112, 2])

    def test_max_padding_pads_every_row_to_the_width(self):
        out = collate.pad_batch([ex(2, 2)], pad_id=3, max_padding=6)
        self.assertEqual(len(out["input_ids"][0]), 6)
        self.assertEqual(len(out["labels"][0]), 6)

    def test_never_truncates(self):
        with self.assertRaises(ValueError):
            collate.pad_batch([ex(8, 2)], pad_id=3, max_padding=4)
        with self.assertRaises(ValueError):
            collate.pad_batch([ex(8, 2)], pad_id=3, max_len=7)

    def test_refuses_empty_rows_and_empty_batches(self):
        with self.assertRaises(ValueError):
            collate.pad_batch([], pad_id=3)
        with self.assertRaises(ValueError):
            collate.pad_batch([{"inputIds": [], "labelIds": [2]}], pad_id=3)

    def test_length_buckets_group_similar_lengths(self):
        items = [ex(9, 2), ex(2, 2), ex(5, 2), ex(3, 2)]
        buckets = collate.length_buckets(items, batch_size=2)
        self.assertEqual(buckets, [[1, 3], [2, 0]])


if __name__ == "__main__":
    unittest.main()
