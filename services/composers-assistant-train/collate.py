"""
Data collator for CA2 infill examples (Wave Q — Model Discovery, PR-63).

The padding rule is CA2's own `nn_training_functions.batch_padder`: inputs
padded on the right with the tokenizer's pad id, labels with -100 so the loss
ignores them, an attention mask of 1 over real input tokens. Torch-free so the
rule is unit-testable without the model stack; `to_tensors` is the one line
that needs torch.
"""
from __future__ import annotations

from typing import Any, Sequence

LABEL_PAD = -100


def pad_batch(
    batch: Sequence[dict[str, Any]],
    pad_id: int,
    max_padding: int | None = None,
    max_len: int | None = None,
) -> dict[str, list[list[int]]]:
    """
    Each item carries `inputIds` and `labelIds` (labels already end with EOS).
    `max_padding` pads every row to that width; otherwise to the longest in the
    batch. `max_len` refuses a row longer than the ceiling — the collator must
    never silently truncate a target, because a truncated target teaches the
    model to stop early.
    """
    if not batch:
        raise ValueError("empty batch")
    for i, item in enumerate(batch):
        if not item.get("inputIds") or not item.get("labelIds"):
            raise ValueError(f"batch item {i} has empty inputIds or labelIds")
        if max_len is not None and (len(item["inputIds"]) > max_len or len(item["labelIds"]) > max_len):
            raise ValueError(f"batch item {i} exceeds max_len {max_len}: {len(item['inputIds'])}/{len(item['labelIds'])}")
    in_width = max_padding if max_padding is not None else max(len(b["inputIds"]) for b in batch)
    lab_width = max_padding if max_padding is not None else max(len(b["labelIds"]) for b in batch)
    if any(len(b["inputIds"]) > in_width or len(b["labelIds"]) > lab_width for b in batch):
        raise ValueError(f"max_padding {max_padding} is shorter than an item in the batch")
    input_ids, attention, labels = [], [], []
    for b in batch:
        ids, lab = list(b["inputIds"]), list(b["labelIds"])
        input_ids.append(ids + [pad_id] * (in_width - len(ids)))
        attention.append([1] * len(ids) + [0] * (in_width - len(ids)))
        labels.append(lab + [LABEL_PAD] * (lab_width - len(lab)))
    return {"input_ids": input_ids, "attention_mask": attention, "labels": labels}


def to_tensors(padded: dict[str, list[list[int]]], device=None):
    import torch

    out = {k: torch.tensor(v, dtype=torch.long) for k, v in padded.items()}
    if device is not None:
        out = {k: v.to(device) for k, v in out.items()}
    return out


def length_buckets(items: Sequence[dict[str, Any]], batch_size: int) -> list[list[int]]:
    """Group indices by input length so padding is small; CA2 does the same with `group_by_length`."""
    order = sorted(range(len(items)), key=lambda i: (len(items[i]["inputIds"]), i))
    return [order[i:i + batch_size] for i in range(0, len(order), batch_size)]
