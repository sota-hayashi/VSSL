"""試行の表と参加者の表（analysis.md「処理の流れ」3・4，「参加者の除外」）．"""
import numpy as np
import pandas as pd
from scipy.stats import norm

from . import settings

SYMBOL_TO_ORIENTATION = {"→": "right", "↑": "up", "←": "left", "↓": "down"}


def successor_map(cycle_symbols):
    """循環（例："→↑←↓"）から，各向きの規則どおりの次の向きを返す．"""
    cycle = [SYMBOL_TO_ORIENTATION[c] for c in cycle_symbols]
    return {o: cycle[(i + 1) % len(cycle)] for i, o in enumerate(cycle)}


def design_of(meta):
    # 設計の記録がない古いデータは mixed とみなす
    return meta.get("design") or "mixed"


def awareness_summary(d):
    """気づきの質問の答え．質問 2 は，見せた向きの次の向き（循環どおり）を選べば正答．"""
    succ = successor_map(d["meta"]["cycle"])
    out = {"noticed": None, "noticed_conf": np.nan, "q2_correct": 0, "q2_n": 0, "q2_mean_conf": np.nan}
    confs = []
    for a in d.get("awareness", []):
        if a["question"] == "noticed":
            out["noticed"] = a["answer"]
            out["noticed_conf"] = a["confidence"]
        elif a["question"] == "next_orientation":
            out["q2_n"] += 1
            out["q2_correct"] += int(a["answer"] == succ[a["shown"]])
            confs.append(a["confidence"])
    if confs:
        out["q2_mean_conf"] = float(np.mean(confs))
    return out


def trial_table(data):
    """全員分の試行の表（練習と本番）．参加者の情報と気づきの答えも列に入れる．"""
    frames = []
    for d in data:
        meta = d["meta"]
        df = pd.DataFrame(d["trials"])
        if "blockType" not in df:
            df["blockType"] = None
        df.loc[(df["phase"] == "main") & df["blockType"].isna(), "blockType"] = "mixed"
        df["block"] = df["block"].astype("Int64")  # 練習は空
        info = {"subject": meta["subjectId"], "version": meta["version"], "design": design_of(meta),
                "cycle": meta["cycle"]}
        info.update(awareness_summary(d))
        for k, v in reversed(list(info.items())):
            df.insert(0, k, v)
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


def dprime_loglinear(hits, n_signal, false_alarms, n_noise):
    """log-linear の補正（Hautus, 1995）：数に 0.5，試行数に 1 を足してから率を出す．"""
    h = (hits + 0.5) / (n_signal + 1)
    f = (false_alarms + 0.5) / (n_noise + 1)
    return norm.ppf(h) - norm.ppf(f)


def participant_metrics(trials):
    """参加者ごとの成績（本番の試行）．"""
    rows = []
    for sid, df in trials[trials["phase"] == "main"].groupby("subject", sort=True):
        present = df[df["present"]]
        absent = df[~df["present"]]
        said_present = df["response"] == "present"
        hits = int((said_present & df["present"]).sum())
        fas = int((said_present & ~df["present"]).sum())
        correct_present = present[present["correct"]]
        rows.append({
            "subject": sid,
            "n_main": len(df),
            "acc_overall": df["correct"].mean(),
            "acc_present": present["correct"].mean(),
            "acc_absent": absent["correct"].mean(),
            "hits": hits,
            "false_alarms": fas,
            "dprime": dprime_loglinear(hits, len(present), fas, len(absent)),
            "timeouts": int(df["timeout"].sum()),
            "mean_rt": correct_present["rt"].mean(),
        })
    return pd.DataFrame(rows)


def participant_table(data, trials):
    """参加者の表．成績，気づきの答え，除外の印と理由．"""
    metrics = participant_metrics(trials)
    info = pd.DataFrame([dict(subject=d["meta"]["subjectId"], design=design_of(d["meta"]),
                              cycle=d["meta"]["cycle"], practice_rounds=d["meta"].get("practiceRounds"),
                              **awareness_summary(d)) for d in data])
    p = info.merge(metrics, on="subject", how="left")

    rules = [
        ("overall accuracy", "acc_overall", settings.MIN_OVERALL_ACCURACY),
        ("absent accuracy", "acc_absent", settings.MIN_ABSENT_ACCURACY),
        ("d'", "dprime", settings.MIN_DPRIME),
    ]
    reasons = [[] for _ in range(len(p))]
    for label, col, threshold in rules:
        if threshold is None:
            continue  # 基準値が未決の基準は判定に使わない
        below = p[col] < threshold
        for i in np.flatnonzero(below.to_numpy()):
            reasons[i].append(f"{label} < {threshold}")
    for i, sid in enumerate(p["subject"]):
        if sid in settings.MANUAL_EXCLUSIONS:
            reasons[i].append(f"manual: {settings.MANUAL_EXCLUSIONS[sid]}")
    p["excluded"] = [bool(r) for r in reasons]
    p["exclusion_reason"] = ["; ".join(r) for r in reasons]
    return p
