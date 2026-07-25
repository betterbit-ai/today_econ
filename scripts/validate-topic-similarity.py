#!/usr/bin/env python3
"""Validate DIEM's duplicate thresholds against labeled Korean article pairs."""

import json
import re
from pathlib import Path

from sentence_transformers import SentenceTransformer


ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "test" / "fixtures" / "similarity" / "korean-article-pairs.json"
MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
ALIASES = (
    ("한전", "한국전력"),
    ("주택용", "가정용"),
    ("전기료", "전기요금"),
    ("의과대학", "의대"),
    ("입학정원", "정원"),
    ("확대 인원", "증원 규모"),
    ("다음 해", "내년도"),
    ("최종 액수", "금액"),
    ("유지", "동결"),
    ("결정", "확정"),
)


def normalize_topic_aliases(value: str) -> str:
    normalized = value
    for source, target in ALIASES:
        normalized = normalized.replace(source, target)
    normalized = re.sub(r"최저임금위(?!원회)", "최저임금위원회", normalized)
    return normalized


def signature_parts(value: str) -> tuple[set[str], set[str]]:
    parts = [part.strip() for part in value.split("|")]
    target = set(parts[1].split()) if len(parts) > 1 else set()
    event = set(parts[2].split()) if len(parts) > 2 else set()
    return target, event


def main() -> None:
    pairs = json.loads(DATASET.read_text(encoding="utf-8"))
    model = SentenceTransformer(MODEL)
    texts = [
        normalize_topic_aliases(text)
        for pair in pairs
        for text in (pair["left"], pair["right"])
    ]
    embeddings = model.encode(texts, normalize_embeddings=True)
    errors = []
    rows = []
    for index, pair in enumerate(pairs):
        score = float(embeddings[index * 2] @ embeddings[index * 2 + 1])
        left_target, left_event = signature_parts(texts[index * 2])
        right_target, right_event = signature_parts(texts[index * 2 + 1])
        gray_overlap = bool(left_target & right_target) and bool(left_event & right_event)
        predicted = score >= 0.78 or (score >= 0.68 and gray_overlap)
        expected = bool(pair["expectedDuplicate"])
        rows.append({"index": index + 1, "score": round(score, 4), "expected": expected, "predicted": predicted})
        if predicted != expected:
            errors.append(rows[-1])

    print(json.dumps({"model": MODEL, "pairs": len(rows), "errors": errors, "rows": rows}, ensure_ascii=False, indent=2))
    if errors:
        raise SystemExit(
            f"{len(errors)} labeled pair(s) did not match the configured "
            "0.78 automatic / 0.68 gray-zone thresholds"
        )


if __name__ == "__main__":
    main()
