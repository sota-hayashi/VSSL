"""データの点検（analysis.md「点検」）．参加者ごとの判定の表と図，参加者の間の比較を出す．"""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from . import settings
from .tables import design_of, successor_map

OK, WARN, FAIL = "ok", "warn", "fail"


def sequence_counts(main, cycle):
    """T の向きの並びから遷移を数え直し，記録されたラベルと突き合わせる．"""
    succ = successor_map(cycle)
    prev = None
    prev_pos = None
    out = {"label_mismatch": 0, "same_orientation": 0, "same_position": 0, "adjacent_absent": 0}
    prev_present_in_block = {}
    for _, t in main.iterrows():
        block = t["block"]
        if not t["present"]:
            if prev_present_in_block.get(block) is False:
                out["adjacent_absent"] += 1
            prev_present_in_block[block] = False
            continue
        prev_present_in_block[block] = True
        o = t["orientation"]
        if prev is None:
            expected = "first"
        else:
            if o == prev:
                out["same_orientation"] += 1
            expected = "regular" if succ[prev] == o else "violation"
        if t["transition"] != expected or t["prevOrientation"] != prev:
            out["label_mismatch"] += 1
        if prev_pos is not None and t["targetPos"] == prev_pos:
            out["same_position"] += 1
        prev, prev_pos = o, t["targetPos"]
    return out


MARKOV_LABELS = {("hp", "hp"): "regular", ("lp", "hp"): "lpToHp", ("n", "hp"): "nToHp", ("hp", "lp"): "hpToLp",
                 ("hp", "n"): "hpToN", ("lp", "lp"): "lpToLp", ("lp", "n"): "lpToN", ("n", "lp"): "nToLp"}


def state_class(state):
    return state[:2].lower() if state != "N" else "n"


def markov_sequence_counts(main, meta):
    """markov：画面の中身（T の有無と向き）から状態を数え直し，記録されたラベルと生成の条件を確かめる
    （markov_stimuli.md §8）．"""
    orientation_state = {o: st for st, o in meta["stateOrientations"].items()}
    states = [orientation_state[t["orientation"]] if t["present"] else "N" for _, t in main.iterrows()]
    out = {"label_mismatch": 0, "same_state": 0, "same_position": 0, "block_count_mismatch": 0,
           "transition_mismatch": 0}
    idx = {st: i for i, st in enumerate(settings.MARKOV_STATES)}
    prev, prev_t, prev_pos = None, None, None
    for (_, t), st in zip(main.iterrows(), states):
        expected = "first" if prev is None else MARKOV_LABELS[(state_class(prev), state_class(st))]
        if (t["state"] != st or t["prevState"] != prev or t["transition"] != expected
                or t["afterAbsent"] != (prev == "N") or t["prevOrientation"] != (prev_t if t["present"] else None)):
            out["label_mismatch"] += 1
        if st == prev:
            out["same_state"] += 1
        if t["present"]:
            if prev_pos is not None and t["targetPos"] == prev_pos:
                out["same_position"] += 1
            prev_t, prev_pos = t["orientation"], t["targetPos"]
        prev = st
    # 各ブロックの状態の回数
    for b, g in main.assign(st=states).groupby("block"):
        counts = g["st"].value_counts()
        out["block_count_mismatch"] += sum(int(counts.get(st, 0) != n)
                                           for st, n in zip(settings.MARKOV_STATES, settings.MARKOV_COUNTS))
    # 遷移の回数：最後から最初へ戻る 1 本を足すと C と一致する（6 ブロックすべてあるときだけ）
    if len(states) == sum(settings.MARKOV_COUNTS) * 6:
        T = np.zeros((5, 5), int)
        for a, c in zip(states, states[1:] + states[:1]):
            T[idx[a], idx[c]] += 1
        out["transition_mismatch"] = int(np.abs(T - np.array(settings.MARKOV_C)).sum())
    return out


def check_participant(d, trials, p_row):
    """1 人分の判定（項目ごとの値と判定）．"""
    meta = d["meta"]
    sid = meta["subjectId"]
    main = trials[(trials["subject"] == sid) & (trials["phase"] == "main")].sort_values("trial")
    frame = (meta.get("refresh") or {}).get("medianMs", np.nan)

    fix = main["searchOnsetTs"] - main["fixOnsetTs"]
    lag = main["searchOnsetTs"] - main["searchDrawTs"]
    fix_off = int((np.abs(fix - settings.FIXATION_MS) > frame).sum()) if np.isfinite(frame) else len(main)
    trial_events = [e for e in d["events"] if e.get("trial") is not None]
    break_events = [e for e in d["events"] if e.get("trial") is None and e.get("phase") in ("practice", "main")]
    away_types = ("fullscreen_exit", "visibility_hidden", "window_blur")
    away_trials = int((main["focusLost"] | ~main["fullscreen"]).sum())
    seq = markov_sequence_counts(main, meta) if design_of(meta) == "markov" else sequence_counts(main, meta["cycle"])
    seq_bad = sum(seq.values())
    expected_n = settings.TARGETS[settings.TARGET]["main_trials"]

    row = {
        "subject": sid,
        "version": meta.get("version"),
        "design": design_of(meta),
        "status": meta.get("status"),
        "debug": meta.get("debug"),
        "n_main": len(main),
        "n_main_judge": OK if expected_n is None or len(main) == expected_n else FAIL,
        "fixation_min_ms": fix.min(),
        "fixation_max_ms": fix.max(),
        "fixation_off_trials": fix_off,
        "fixation_judge": OK if fix_off == 0 else WARN,
        "draw_to_onset_median_ms": lag.median(),
        "draw_to_onset_max_ms": lag.max(),
        "refresh_median_ms": frame,
        "refresh_judge": OK if settings.REFRESH_OK_MS[0] <= frame <= settings.REFRESH_OK_MS[1] else WARN,
        "away_trials": away_trials,
        "away_events_in_trials": sum(e["type"] in away_types for e in trial_events),
        "away_events_in_breaks": sum(e["type"] in away_types for e in break_events),
        "away_judge": OK if away_trials == 0 else WARN,
        **seq,
        "sequence_judge": OK if seq_bad == 0 else FAIL,
        "screen": f"{meta['screen']['width']}x{meta['screen']['height']}",
        "window_at_start": f"{meta['windowAtStart']['width']}x{meta['windowAtStart']['height']}",
        "dpr": meta.get("devicePixelRatio"),
        "acc_overall": p_row["acc_overall"],
        # 除外の基準（正答率・d′）に当たれば不合格．人が判断して除く分は含めない
        "accuracy_judge": FAIL if any(r and not r.startswith("manual")
                                      for r in p_row["exclusion_reason"].split("; ")) else OK,
        "user_agent": meta.get("userAgent"),
    }
    return row


def plot_participant(sid, main, path):
    """参加者ごとの図：ブロック別の正答率と平均反応時間（T のある試行の正答）．"""
    by_block = main.groupby("block")
    acc = by_block["correct"].mean()
    rt = main[main["present"] & main["correct"]].groupby("block")["rt"].mean()
    types = by_block["blockType"].first()
    fig, axes = plt.subplots(1, 2, figsize=(9, 3.5))
    color = {b: "tab:orange" if t == "regular" else "tab:gray" for b, t in types.items()}
    axes[0].bar(acc.index, acc.values, color=[color[b] for b in acc.index])
    axes[0].set_ylim(0, 1)
    axes[0].set_xlabel("Block")
    axes[0].set_ylabel("Accuracy")
    axes[1].plot(rt.index, rt.values, color="black", zorder=1)
    axes[1].scatter(rt.index, rt.values, c=[color[b] for b in rt.index], zorder=2)
    axes[1].set_xlabel("Block")
    axes[1].set_ylabel("Mean RT (ms), correct T-present")
    fig.suptitle(f"{sid}  (orange = regular, gray = random/mixed)")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def plot_distributions(trials, data, path):
    """全員分の注視点の時間と画面の書き換え間隔の分布．"""
    main = trials[trials["phase"] == "main"]
    fix = main["searchOnsetTs"] - main["fixOnsetTs"]
    refresh = [(d["meta"].get("refresh") or {}).get("medianMs", np.nan) for d in data]
    fig, axes = plt.subplots(1, 2, figsize=(9, 3.5))
    axes[0].hist(fix, bins=40, color="tab:blue")
    axes[0].axvline(settings.FIXATION_MS, color="black", linestyle="--")
    axes[0].set_xlabel("Fixation duration (ms), all trials")
    axes[0].set_ylabel("Trials")
    axes[1].hist(refresh, bins=20, color="tab:green")
    axes[1].set_xlabel("Refresh interval median (ms)")
    axes[1].set_ylabel("Participants")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


BETWEEN_METRICS = [
    ("acc_overall", "Overall accuracy"),
    ("acc_absent", "T-absent accuracy"),
    ("acc_present", "T-present accuracy"),
    ("dprime", "d'"),
    ("mean_rt", "Mean RT (ms)"),
    ("timeouts", "Timeouts"),
]


def between_table(p):
    """参加者の間の比較の表：Q1，Q3，IQR，1.5 × IQR の範囲と，その外の参加者．"""
    rows = []
    for col, label in BETWEEN_METRICS:
        v = p[col].astype(float)
        q1, q3 = np.nanpercentile(v, [25, 75])
        iqr = q3 - q1
        lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        outside = p.loc[(v < lo) | (v > hi), "subject"].tolist()
        rows.append({"metric": col, "label": label, "q1": q1, "median": np.nanmedian(v), "q3": q3,
                     "iqr": iqr, "lower": lo, "upper": hi, "outside": " ".join(outside)})
    return pd.DataFrame(rows)


def plot_between(p, table, path):
    """参加者の間の箱ひげ図．各参加者を点で重ね，1.5 × IQR の外の点に ID を添える．"""
    fig, axes = plt.subplots(1, len(BETWEEN_METRICS), figsize=(3 * len(BETWEEN_METRICS), 4))
    rng = np.random.default_rng(0)  # 点の横のずらしを毎回同じにする
    for ax, (col, label), (_, t) in zip(axes, BETWEEN_METRICS, table.iterrows()):
        v = p[col].astype(float).to_numpy()
        ax.boxplot(v[np.isfinite(v)], widths=0.5, whis=1.5, showfliers=False)
        x = 1 + rng.uniform(-0.12, 0.12, len(v))
        out = (v < t["lower"]) | (v > t["upper"])
        ax.scatter(x[~out], v[~out], s=14, color="tab:blue", zorder=3)
        ax.scatter(x[out], v[out], s=20, color="tab:red", zorder=3)
        for xi, vi, sid in zip(x[out], v[out], p["subject"][out]):
            ax.annotate(sid, (xi, vi), xytext=(4, 0), textcoords="offset points", fontsize=7, color="tab:red")
        ax.set_title(label, fontsize=9)
        ax.set_xticks([])
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def run(data, trials, participants, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "participants").mkdir(exist_ok=True)
    p_by_id = participants.set_index("subject")
    rows = []
    for d in data:
        sid = d["meta"]["subjectId"]
        rows.append(check_participant(d, trials, p_by_id.loc[sid]))
        main = trials[(trials["subject"] == sid) & (trials["phase"] == "main")]
        plot_participant(sid, main, out_dir / "participants" / f"{sid}.png")
    checks = pd.DataFrame(rows)
    checks.to_csv(out_dir / "checks.csv", index=False)
    plot_distributions(trials, data, out_dir / "distributions.png")
    between = between_table(participants)
    between.to_csv(out_dir / "between_iqr.csv", index=False)
    plot_between(participants, between, out_dir / "between_boxplots.png")
    return checks
