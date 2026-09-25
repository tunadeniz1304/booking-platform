"""LTR eğitimi (P1-2): LightGBM lambdarank -> ONNX (models/ranker.onnx).

Girdi : scripts/ltr/out/clicks.csv  (npm run ltr:clicks)
Etiket: rezervasyon=2, tıklama=1, diğer=0 (örtük geri bildirim).
Ölçüm : ayrılmış sorgularda GERÇEK not (grade) ile nDCG@10 — ağırlıklı sıralama vs LTR.
Çıktı : models/ranker.onnx + models/ranker.meta.json

Kullanım (repo kökünden):  python scripts/ltr/train.py
Gereksinim: lightgbm, onnxmltools, onnx (yalnız geliştirme; uygulama Python'a bağımlı değil).
"""

import csv
import json
import math
import os
import random
from collections import defaultdict

import lightgbm as lgb
import numpy as np
from onnxmltools import convert_lightgbm
from onnxmltools.convert.common.data_types import FloatTensorType

FEATURES = ["relevance", "lexical", "vector", "trigram", "priceFit", "rating", "popularity", "personal"]
SEED = 20260925
K = 10
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def load(path):
    groups = defaultdict(list)
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            groups[int(row["qid"])].append(row)
    return groups


def ndcg_at_k(grades_in_order, k=K):
    def dcg(gs):
        return sum((2**g - 1) / math.log2(i + 2) for i, g in enumerate(gs[:k]))

    ideal = dcg(sorted(grades_in_order, reverse=True))
    return dcg(grades_in_order) / ideal if ideal > 0 else None


def matrix(groups, qids):
    x, y, sizes = [], [], []
    for q in qids:
        rows = groups[q]
        sizes.append(len(rows))
        for r in rows:
            x.append([float(r[f]) for f in FEATURES])
            y.append(2 if r["booked"] == "1" else 1 if r["click"] == "1" else 0)
    return np.asarray(x, dtype=np.float32), np.asarray(y), sizes


def mean_ndcg(groups, qids, score_fn):
    values = []
    for q in qids:
        rows = groups[q]
        scores = score_fn(rows)
        order = sorted(range(len(rows)), key=lambda i: -scores[i])
        v = ndcg_at_k([int(rows[i]["grade"]) for i in order])
        if v is not None:
            values.append(v)
    return sum(values) / len(values)


def main():
    groups = load(os.path.join(ROOT, "scripts", "ltr", "out", "clicks.csv"))
    qids = sorted(groups)
    random.Random(SEED).shuffle(qids)
    split = int(len(qids) * 0.8)
    train_q, test_q = qids[:split], qids[split:]

    x, y, sizes = matrix(groups, train_q)
    model = lgb.LGBMRanker(
        objective="lambdarank",
        n_estimators=120,
        learning_rate=0.08,
        num_leaves=15,
        min_child_samples=40,
        random_state=SEED,
        deterministic=True,
        force_row_wise=True,
        verbose=-1,
    )
    model.fit(x, y, group=sizes, eval_at=[K])

    weighted = mean_ndcg(groups, test_q, lambda rows: [float(r["weighted"]) for r in rows])
    ltr = mean_ndcg(
        groups,
        test_q,
        lambda rows: model.predict(np.asarray([[float(r[f]) for f in FEATURES] for r in rows], dtype=np.float32)),
    )

    onnx_model = convert_lightgbm(
        model.booster_, initial_types=[("features", FloatTensorType([None, len(FEATURES)]))], target_opset=15
    )
    out_dir = os.path.join(ROOT, "models")
    os.makedirs(out_dir, exist_ok=True)
    onnx_path = os.path.join(out_dir, "ranker.onnx")
    with open(onnx_path, "wb") as fh:
        fh.write(onnx_model.SerializeToString())

    meta = {
        "features": FEATURES,
        "objective": "lambdarank",
        "trainQueries": len(train_q),
        "testQueries": len(test_q),
        "ndcgAt10": {"weighted": round(weighted, 4), "ltr": round(ltr, 4)},
        "liftPct": round((ltr / weighted - 1) * 100, 2),
        "sizeBytes": os.path.getsize(onnx_path),
        "lightgbm": lgb.__version__,
    }
    with open(os.path.join(out_dir, "ranker.meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
        fh.write("\n")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
