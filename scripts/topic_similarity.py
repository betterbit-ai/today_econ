#!/usr/bin/env python3
"""Compute local multilingual sentence similarity for the DIEM pipeline."""

import json
import sys

from sentence_transformers import SentenceTransformer


def main() -> None:
    payload = json.load(sys.stdin)
    queries = payload.get("queries")
    if not isinstance(queries, list):
        queries = [payload.get("query", "")]
    queries = [str(item).strip() for item in queries]
    corpus = [str(item).strip() for item in payload.get("corpus", [])]
    model_name = payload.get(
        "model",
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    )
    if not queries or any(not query for query in queries) or not corpus:
        json.dump({"matrix": []}, sys.stdout)
        return

    model = SentenceTransformer(model_name)
    query_embeddings = model.encode(queries, normalize_embeddings=True)
    corpus_embeddings = model.encode(corpus, normalize_embeddings=True)
    matrix = query_embeddings @ corpus_embeddings.T
    json.dump(
        {
            "model": model_name,
            "matrix": [
                [round(float(score), 6) for score in row]
                for row in matrix
            ],
        },
        sys.stdout,
        ensure_ascii=False,
    )


if __name__ == "__main__":
    main()
