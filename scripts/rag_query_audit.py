"""Probe retrieval and graph nodes for RAG GT queries (iteration 3 labels)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.build_rag_ground_truth import AGENT_QUERIES, SEARCH_QUERIES  # noqa: E402
from vector_retreival import classify_query_intent, retreive, serialize_startpoint  # noqa: E402


def run_probe(query: str, mode: str, k: int = 20) -> list[dict]:
    import vector_retreival as vr

    orig_r = vr.RETRIEVAL_SEMANTIC_SCORE_CUTOFF
    orig_b = vr.BROWSER_INTERNAL_SCORE_CUTOFF
    vr.RETRIEVAL_SEMANTIC_SCORE_CUTOFF = 0.0
    vr.BROWSER_INTERNAL_SCORE_CUTOFF = 0.0
    try:
        results = retreive(query, k=k, mode=mode)
    finally:
        vr.RETRIEVAL_SEMANTIC_SCORE_CUTOFF = orig_r
        vr.BROWSER_INTERNAL_SCORE_CUTOFF = orig_b
    return [serialize_startpoint(item) for item in results[:k]]


def main() -> None:
    report = {'search_queries': [], 'agent_queries': []}
    for query in SEARCH_QUERIES:
        rows = run_probe(query, 'browser', k=20)
        report['search_queries'].append({
            'query': query,
            'intent': classify_query_intent(query),
            'top20': [
                {
                    'rank': i + 1,
                    'type': r.get('type'),
                    'name': r.get('name'),
                    'courseid': r.get('courseid'),
                    'id': r.get('id'),
                    'similarity': round(float(r.get('similarity') or 0), 4),
                }
                for i, r in enumerate(rows)
            ],
        })
    for query in AGENT_QUERIES:
        rows = run_probe(query, 'agent', k=20)
        report['agent_queries'].append({
            'query': query,
            'intent': classify_query_intent(query),
            'top20': [
                {
                    'rank': i + 1,
                    'type': r.get('type'),
                    'name': r.get('name'),
                    'courseid': r.get('courseid'),
                    'id': r.get('id'),
                    'similarity': round(float(r.get('similarity') or 0), 4),
                }
                for i, r in enumerate(rows)
            ],
        })

    out = ROOT / '.cache' / 'rag_query_audit.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Wrote {out}')


if __name__ == '__main__':
    main()
