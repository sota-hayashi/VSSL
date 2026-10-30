"""予備実験（alternating）の解析（analysis.md「試行の除外」「予備実験（alternating）の比較」）．"""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats

from . import settings
from .trimming import keep_mask


def rt_trials(trials):
    """反応時間の解析に使う試行：T のある試行の正答を，参加者 × ブロックごとに外れ値を除き，
    そのあと 200 ms 未満を除く．実験の最初の T は除く．"""
    main = trials[(trials["phase"] == "main") & trials["present"] & trials["transition"].isin(["regular", "violation"])]
    correct = main[main["correct"] & main["rt"].notna()].copy()
    correct["kept_trim"] = False
    for _, idx in correct.groupby(["subject", "block"]).groups.items():
        correct.loc[idx, "kept_trim"] = keep_mask(correct.loc[idx, "rt"])
    correct["kept"] = correct["kept_trim"] & (correct["rt"] >= settings.MIN_RT_MS)
    return main, correct


def random_diffs(df, value):
    """random のブロックごとの「規則外 − たまたま規則どおり」（参加者 × ブロック）．"""
    rnd = df[df["blockType"] == "random"]
    m = rnd.groupby(["subject", "block", "transition"])[value].mean().unstack("transition")
    return (m["violation"] - m["regular"]).rename("v_minus_r").reset_index()


def index_b(diffs):
    """B：（2 つ目以降の random ブロックの V − R の平均）−（最初の random ブロックの V − R）．"""
    rows = []
    for sid, g in diffs.groupby("subject"):
        g = g.sort_values("block")
        rows.append({"subject": sid, "value": g["v_minus_r"].iloc[1:].mean() - g["v_minus_r"].iloc[0]})
    return pd.DataFrame(rows)


def index_a(block_means):
    """A：regular のブロックを，前後の random のブロックの平均と比べる（前後がそろうブロックだけ）．"""
    rows = []
    for sid, g in block_means.groupby("subject"):
        s = g.set_index("block")
        vals = []
        for b, row in s.iterrows():
            if row["blockType"] != "regular":
                continue
            if (b - 1) in s.index and (b + 1) in s.index:
                vals.append((s.loc[b - 1, "value"] + s.loc[b + 1, "value"]) / 2 - row["value"])
        rows.append({"subject": sid, "value": np.mean(vals) if vals else np.nan})
    return pd.DataFrame(rows)


def summarize(values):
    """平均，95% 信頼区間（t 分布），Cohen's d_z（平均 ÷ 標準偏差）．"""
    v = np.asarray(values, dtype=float)
    v = v[np.isfinite(v)]
    n = len(v)
    out = {"n": n, "mean": v.mean() if n else np.nan, "sd": np.nan, "ci_low": np.nan, "ci_high": np.nan, "d_z": np.nan}
    if n >= 2:
        sd = v.std(ddof=1)
        half = stats.t.ppf(0.975, n - 1) * sd / np.sqrt(n)
        out.update(sd=sd, ci_low=v.mean() - half, ci_high=v.mean() + half, d_z=v.mean() / sd if sd > 0 else np.nan)
    return out


def plot_indices(indices, summary, path):
    cols = [c for c in indices.columns if c != "subject"]
    fig, axes = plt.subplots(1, len(cols), figsize=(3 * len(cols), 4))
    rng = np.random.default_rng(0)
    for ax, col in zip(np.atleast_1d(axes), cols):
        v = indices[col].to_numpy(dtype=float)
        ax.axhline(0, color="gray", linewidth=0.8)
        ax.scatter(rng.uniform(-0.1, 0.1, len(v)), v, s=16, color="tab:blue")
        s = summary.set_index("index").loc[col]
        ax.errorbar(0.3, s["mean"], yerr=[[s["mean"] - s["ci_low"]], [s["ci_high"] - s["mean"]]],
                    fmt="o", color="black", capsize=4)
        ax.set_xlim(-0.5, 0.6)
        ax.set_xticks([])
        ax.set_title(col, fontsize=9)
    fig.suptitle("Per-participant indices (black: mean and 95% CI)")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def plot_block_rt(block_means, path):
    fig, ax = plt.subplots(figsize=(6, 4))
    for sid, g in block_means.groupby("subject"):
        ax.plot(g["block"], g["value"], color="gray", linewidth=0.8, alpha=0.6)
    mean = block_means.groupby("block")["value"].mean()
    types = block_means.groupby("block")["blockType"].first()
    ax.plot(mean.index, mean.values, color="black", linewidth=2)
    for b, t in types.items():
        if t == "regular":
            ax.axvspan(b - 0.5, b + 0.5, color="tab:orange", alpha=0.15)
    ax.set_xlabel("Block (orange = regular)")
    ax.set_ylabel("Mean RT (ms)")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def plot_random_diffs(diffs, path, split=None):
    """random のブロックごとの V − R．split を渡すと，その列の値ごとに分けて描く．"""
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.axhline(0, color="gray", linewidth=0.8)
    groups = [(None, diffs)] if split is None else list(diffs.groupby(split))
    for k, (key, g) in enumerate(groups):
        offset = 0 if split is None else (k - 0.5) * 0.3
        for sid, gs in g.groupby("subject"):
            ax.plot(gs["block"] + offset, gs["v_minus_r"], color=f"C{k}", linewidth=0.6, alpha=0.4)
        mean = g.groupby("block")["v_minus_r"].mean()
        ax.plot(mean.index + offset, mean.values, "o-", color=f"C{k}", linewidth=2,
                label=None if split is None else f"{split} = {key}")
    ax.set_xlabel("Random block")
    ax.set_ylabel("Violation − regular (ms)")
    if split is not None:
        ax.legend()
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def plot_awareness(indices, participants, path):
    df = indices.merge(participants[["subject", "noticed", "q2_correct"]], on="subject")
    fig, ax = plt.subplots(figsize=(5, 4))
    for noticed, g in df.groupby("noticed"):
        ax.scatter(g["q2_correct"], g["B_rt"], label=f"noticed = {noticed}", s=24)
    ax.axhline(0, color="gray", linewidth=0.8)
    ax.axvline(1, color="gray", linestyle="--", linewidth=0.8)  # 当てずっぽうの期待値（4 問 × 1/4）
    ax.set_xlabel("Q2 correct (of 4; dashed = chance)")
    ax.set_ylabel("Index B, RT (ms)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def run(trials, participants, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    keep = participants.loc[~participants["excluded"], "subject"]
    trials = trials[trials["subject"].isin(keep)]
    main, correct = rt_trials(trials)
    kept = correct[correct["kept"]]

    # 外れ値の除外の記録
    trim = correct.groupby("subject").agg(n_correct=("rt", "size"), n_trimmed=("kept_trim", lambda x: int((~x).sum())),
                                          n_kept=("kept", "sum"))
    trim.to_csv(out_dir / "trimming.csv")

    # 反応時間
    diffs_rt = random_diffs(kept, "rt")
    block_rt = kept.groupby(["subject", "block"]).agg(value=("rt", "mean"), blockType=("blockType", "first")).reset_index()
    # 正答率（同じ式．T のある試行の全体で計算．正答率では負の値が学習の方向）
    acc_trials = main.assign(correct=main["correct"].astype(float))
    diffs_acc = random_diffs(acc_trials, "correct")
    block_acc = acc_trials.groupby(["subject", "block"]).agg(value=("correct", "mean"),
                                                             blockType=("blockType", "first")).reset_index()

    indices = index_b(diffs_rt).rename(columns={"value": "B_rt"})
    for name, df in [("A_rt", index_a(block_rt)), ("B_acc", index_b(diffs_acc)), ("A_acc", index_a(block_acc))]:
        indices = indices.merge(df.rename(columns={"value": name}), on="subject", how="outer")
    indices.to_csv(out_dir / "indices.csv", index=False)

    summary = pd.DataFrame([{"index": c, **summarize(indices[c])} for c in indices.columns if c != "subject"])
    summary.to_csv(out_dir / "summary.csv", index=False)

    diffs_rt.to_csv(out_dir / "random_v_minus_r.csv", index=False)
    block_rt.to_csv(out_dir / "block_rt.csv", index=False)

    # T のない試行の直後かどうかで分けた V − R
    after = (kept[kept["blockType"] == "random"].groupby(["subject", "block", "afterAbsent", "transition"])["rt"]
             .mean().unstack("transition"))
    after = (after["violation"] - after["regular"]).rename("v_minus_r").reset_index()
    after.to_csv(out_dir / "after_absent.csv", index=False)

    # 気づき：質問 2 の正答数を当てずっぽう（1 問 1/4）と比べる
    p = participants[participants["subject"].isin(keep)]
    total, n_q = int(p["q2_correct"].sum()), int(p["q2_n"].sum())
    aware = pd.DataFrame([{
        "n": len(p),
        "noticed_yes": int((p["noticed"] == "yes").sum()),
        "q2_correct_total": total,
        "q2_questions_total": n_q,
        "q2_chance_expected": n_q * 0.25,
        "q2_binom_p_greater": stats.binomtest(total, n_q, 0.25, alternative="greater").pvalue if n_q else np.nan,
    }])
    aware.to_csv(out_dir / "awareness.csv", index=False)

    plot_indices(indices, summary, out_dir / "indices.png")
    plot_block_rt(block_rt, out_dir / "block_rt.png")
    plot_random_diffs(diffs_rt, out_dir / "random_v_minus_r.png")
    plot_random_diffs(after, out_dir / "after_absent.png", split="afterAbsent")
    plot_awareness(indices, participants, out_dir / "awareness.png")
    return indices, summary
