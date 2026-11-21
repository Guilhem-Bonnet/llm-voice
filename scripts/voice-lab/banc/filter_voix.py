#!/usr/bin/env python3
"""Filtre automatique des voix candidates. Règles (dans l'ordre) :
 1. p(en) < 0,01 sur chaque test ; 2. WER moyen <= 0,10 et aucun test > 0,20 ; 3. aucun mot de balise ;
 4. distincte : cosinus CENTRÉ d'empreinte (Gram doublement centré sur toutes les voix, puis renormalisé) <= SEUIL avec toute voix déjà en service et toute candidate mieux classée déjà gardée.
Classement des candidates admissibles : WER moyen puis p(en) max. Garde au plus MAX voix. N'écrit qu'un JSON ; le déplacement est fait à part.
Usage : filter_voix.py <out_root> <evidence_dir> [seuil=0.66] [max=8]"""
import json, sys
from pathlib import Path
root, ev = Path(sys.argv[1]), Path(sys.argv[2]); thr = float(sys.argv[3]) if len(sys.argv) > 3 else 0.66; mx = int(sys.argv[4]) if len(sys.argv) > 4 else 8
A = json.loads((ev / "analysis.json").read_text()); EMB = json.loads((root / "embeddings.json").read_text())["voices"]
created = json.loads((root / "voix-created.json").read_text()); tests = json.loads(Path(__file__).with_name("voix_candidates.json").read_text())["tests"]
import numpy as np
idx = {i: k for k, i in enumerate(EMB["ids"])}; K = np.array(EMB["cos"]); n = len(K); H = np.eye(n) - 1 / n; Kc = H @ K @ H
dg = np.sqrt(np.diag(Kc)); cos = (Kc / np.outer(dg, dg)).tolist()  # le cosinus brut est trop resserré (0,915 à 0,988 entre voix du catalogue)
new_ids = {r["id"] for r in created.values()}; existing = [i for i in EMB["ids"] if i not in new_ids]
cands = []
for name, r in created.items():
    rows = [A[f"voix-candidates/{r['id']}-{t}"] for t in tests]
    c = {"id": r["id"], "name": name, "description": r["description"], "wer_mean": round(sum(x["wer"] for x in rows) / len(rows), 3),
         "wer_max": max(x["wer"] for x in rows), "p_en_max": max(x["p_en"] for x in rows), "tags": sum(len(x["tag_words"]) for x in rows)}
    nearest = max(((cos[idx[r["id"]]][idx[o]], o) for o in existing), default=(0, None))
    c["cos_max_existing"], c["nearest_existing"] = round(nearest[0], 3), nearest[1]
    reasons = []
    if c["p_en_max"] >= 0.01: reasons.append(f"p(en) {c['p_en_max']} >= 0,01")
    if c["wer_mean"] > 0.10 or c["wer_max"] > 0.20: reasons.append(f"WER moyen {c['wer_mean']} / max {c['wer_max']}")
    if c["tags"]: reasons.append("mots de balise prononcés")
    if c["cos_max_existing"] > thr: reasons.append(f"trop proche de {nearest[1]} (cos {c['cos_max_existing']})")
    c["reasons"] = reasons; cands.append(c)
kept, rejected = [], []
for c in sorted(cands, key=lambda c: (c["wer_mean"], c["p_en_max"])):
    if not c["reasons"]:
        twin = max(((cos[idx[c["id"]]][idx[k["id"]]], k["name"]) for k in kept), default=(0, None))
        if twin[0] > thr: c["reasons"].append(f"trop proche de la candidate gardée {twin[1]} (cos {round(twin[0], 3)})")
        elif len(kept) >= mx: c["reasons"].append(f"au-delà des {mx} meilleures")
    (rejected if c["reasons"] else kept).append(c)
for c in kept: c["reason"] = f"gardée : WER moyen {c['wer_mean']}, p(en) max {c['p_en_max']}, cos max avec l'existant {c['cos_max_existing']}"
for c in rejected: c["reason"] = "rejetée : " + " ; ".join(c["reasons"])
ex_pairs = [(cos[idx[a]][idx[b]], a, b) for k, a in enumerate(existing) for b in existing[k + 1:]]
out = {"similarity": "cosinus centré", "threshold_cos": thr, "calibration": {"existing_pairs_min": round(min(ex_pairs)[0], 3), "existing_pairs_max": round(max(ex_pairs)[0], 3), "existing_pair_max_ids": max(ex_pairs)[1:]}, "max_kept": mx, "tests": tests, "kept": kept, "rejected": rejected}
(ev / "voix-filter.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
for c in kept + rejected: print(c["id"], c["name"], "|", c["reason"])
