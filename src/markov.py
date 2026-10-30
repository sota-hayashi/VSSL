"""本実験（markov）の解析（analysis.md「markov の比較」「試行の除外」「気づき」）．"""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import integrate, stats

from . import settings
from .pilot import summarize
from .trimming import keep_mask

PRESENT_LABELS = ["regular", "lpToHp", "nToHp", "hpToLp", "lpToLp", "nToLp"]
ABSENT_LABELS = ["hpToN", "lpToN"]

# 比べる組．差は「a − b」で，どの比較も正の値が予想の方向（a が遅い・誤りが多い）
COMPARISONS = [
    {"name": "learning", "label": "Transition learning (HP)", "a": ["lpToHp", "nToHp"], "b": ["regular"]},
    {"name": "frequency", "label": "Frequency (HP vs LP)", "a": ["lpToLp", "nToLp"], "b": ["lpToHp", "nToHp"]},
    {"name": "lp_transition", "label": "Transition within LP", "a": ["hpToLp"], "b": ["lpToLp", "nToLp"]},
    {"name": "n_transition", "label": "Transition within N", "a": ["hpToN"], "b": ["lpToN"]},
    {"name": "n_vs_present", "label": "N vs T-present", "a": ABSENT_LABELS, "b": PRESENT_LABELS},
]


def rt_trials(trials):
    """反応時間の解析に使う試行：本番の正答（実験の最初の試行を除く）．参加者 × ブロック × 試行の種類
    （N の試行，T のある試行）ごとに外れ値を除き，そのあと 200 ms 未満を除く（analysis.md「markov の比較」）．"""
    main = trials[(trials["phase"] == "main") & (trials["transition"] != "first")].copy()
    main["kind"] = np.where(main["present"], "present", "absent")
    correct = main[main["correct"] & main["rt"].notna()].copy()
    correct["kept_trim"] = False
    for _, idx in correct.groupby(["subject", "block", "kind"]).groups.items():
        correct.loc[idx, "kept_trim"] = keep_mask(correct.loc[idx, "rt"])
    correct["kept"] = correct["kept_trim"] & (correct["rt"] >= settings.MIN_RT_MS)
    return main, correct


def cell_means(df, value, comp):
    """参加者 × ブロック × 条件（a，b）の平均．"""
    rows = []
    for cond in ("a", "b"):
        sub = df[df["transition"].isin(comp[cond])]
        m = sub.groupby(["subject", "block"])[value].agg(["mean", "size"]).reset_index()
        rows.append(m.assign(condition=cond))
    return pd.concat(rows, ignore_index=True).rename(columns={"mean": "value", "size": "n"})


def _orthonormal_contrasts(k):
    """k 水準の直交で長さ 1 の対比（k − 1 本）．"""
    c = np.zeros((k - 1, k))
    for i in range(1, k):
        c[i - 1, :i] = 1
        c[i - 1, i] = -i
        c[i - 1] /= np.linalg.norm(c[i - 1])
    return c


def _effect(Y):
    """対比をかけた値 Y（参加者 × 自由度）から，F，Greenhouse-Geisser の ε，偏 η² を出す．"""
    n, df1 = Y.shape
    mean = Y.mean(axis=0)
    ss_effect = n * np.sum(mean ** 2)
    ss_error = np.sum((Y - mean) ** 2)
    df2 = df1 * (n - 1)
    F = (ss_effect / df1) / (ss_error / df2)
    if df1 > 1:
        S = np.cov(Y, rowvar=False)
        eps = min(1.0, np.trace(S) ** 2 / (df1 * np.trace(S @ S)))
    else:
        eps = 1.0
    return {"df1": df1, "df2": df2, "F": F, "p": stats.f.sf(F, df1, df2), "eps_gg": eps,
            "p_gg": stats.f.sf(F, df1 * eps, df2 * eps), "eta_p2": ss_effect / (ss_effect + ss_error)}


def rm_anova(cells):
    """ブロック × 条件の 2 要因反復測定分散分析（Greenhouse-Geisser の補正）．
    どれかのセルが欠けた参加者は除き，使った人数を n に書く．"""
    wide = cells.pivot_table(index="subject", columns=["condition", "block"], values="value").dropna()
    n = len(wide)
    if n < 3:
        return pd.DataFrame()
    blocks = sorted(wide["a"].columns)
    A = wide["a"][blocks].to_numpy()
    B = wide["b"][blocks].to_numpy()
    cb = _orthonormal_contrasts(len(blocks))
    rows = [
        {"effect": "condition", **_effect((A.mean(axis=1) - B.mean(axis=1))[:, None] / np.sqrt(2))},
        {"effect": "block", **_effect(((A + B) / 2) @ cb.T)},
        {"effect": "block x condition", **_effect((A - B) @ cb.T)},
    ]
    return pd.DataFrame(rows).assign(n=n)


def jzs_bf10(t, n, r=np.sqrt(2) / 2):
    """対応のある t 検定の JZS ベイズ因子 BF10（Rouder et al., 2009．事前分布の幅 r は JASP の既定値 0.707）．"""
    df = n - 1

    def integrand(g):
        return ((1 + n * g * r ** 2) ** -0.5 * (1 + t ** 2 / ((1 + n * g * r ** 2) * df)) ** (-(df + 1) / 2)
                * (2 * np.pi) ** -0.5 * g ** -1.5 * np.exp(-1 / (2 * g)))

    num = integrate.quad(integrand, 0, np.inf)[0]
    return num / (1 + t ** 2 / df) ** (-(df + 1) / 2)


def participant_index(cells):
    """参加者ごとの指標：ブロックの平均をとった a − b（どのブロックもそろう参加者だけ）．"""
    wide = cells.pivot_table(index="subject", columns=["condition", "block"], values="value").dropna()
    return (wide["a"].mean(axis=1) - wide["b"].mean(axis=1)).rename("value")


def index_summary(values):
    """指標のまとめ：平均・95% 信頼区間・d_z と，0 との t 検定，BF10．t² は分散分析の条件の主効果の F と同じ．"""
    out = summarize(values)
    v = np.asarray(values, dtype=float)
    v = v[np.isfinite(v)]
    out.update(t=np.nan, p=np.nan, bf10=np.nan)
    if len(v) >= 2 and v.std(ddof=1) > 0:
        res = stats.ttest_1samp(v, 0)
        out.update(t=res.statistic, p=res.pvalue, bf10=jzs_bf10(res.statistic, len(v)))
    return out


def source_split(df, value, labels):
    """直前が LP の遷移と N の遷移を分けた，参加者 × ブロック × ラベルの平均（合わせる前に図で確かめる）．"""
    sub = df[df["transition"].isin(labels)]
    return sub.groupby(["subject", "block", "transition"])[value].mean().rename("value").reset_index()


def jasp_wide(cells):
    """JASP のベイズ反復測定分散分析に読み込む形（1 行 1 参加者，列は条件 × ブロック）．"""
    wide = cells.pivot_table(index="subject", columns=["condition", "block"], values="value")
    wide.columns = [f"{c}_b{b}" for c, b in wide.columns]
    return wide.reset_index()


def awareness_table(participants):
    """気づき（Li と同じく記述にとどめる．analysis.md「気づき」）．"""
    p = participants

    def m_sd(x):
        x = pd.to_numeric(x, errors="coerce").dropna()
        return f"{x.mean():.2f} ± {x.std(ddof=1):.2f}" if len(x) >= 2 else (f"{x.mean():.2f}" if len(x) else "")

    noticed = p[p["noticed"] == "yes"]
    both = p[(p["q2_n"] > 0) & (p["q2_correct"] == p["q2_n"])]
    rows = [
        {"item": "participants", "n": len(p), "confidence": ""},
        {"item": "Q1 noticed = yes", "n": len(noticed), "confidence": m_sd(noticed["noticed_conf"])},
        {"item": "Q1 noticed = no", "n": int((p["noticed"] == "no").sum()),
         "confidence": m_sd(p.loc[p["noticed"] == "no", "noticed_conf"])},
        {"item": "Q2 HP shown: partner HP chosen on both", "n": len(both), "confidence": m_sd(both["q2_mean_conf"])},
        {"item": "Q2 HP shown: not both correct", "n": len(p) - len(both),
         "confidence": m_sd(p.loc[~p.index.isin(both.index), "q2_mean_conf"])},
        {"item": "Q2 LP shown (no correct answer)", "n": int((p["q2_lp_n"] > 0).sum()),
         "confidence": m_sd(p["q2_lp_mean_conf"])},
    ]
    return pd.DataFrame(rows)


def plot_cells(all_cells, value_label, path):
    """比較ごとに，ブロック × 条件の平均（参加者の平均と標準誤差）．"""
    fig, axes = plt.subplots(1, len(COMPARISONS), figsize=(3.6 * len(COMPARISONS), 3.6))
    for ax, comp in zip(axes, COMPARISONS):
        cells = all_cells[all_cells["comparison"] == comp["name"]]
        for cond, color in (("a", "tab:red"), ("b", "tab:blue")):
            g = cells[cells["condition"] == cond].groupby("block")["value"]
            m, se = g.mean(), g.sem()
            ax.errorbar(m.index, m.values, yerr=se.values, marker="o", color=color, capsize=3,
                        label=f"{cond}: " + " + ".join(comp[cond]) if len(comp[cond]) <= 2 else f"{cond}: {len(comp[cond])} labels")
        ax.set_title(comp["label"], fontsize=9)
        ax.set_xlabel("Block")
        ax.legend(fontsize=6)
    axes[0].set_ylabel(value_label)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def plot_source_split(split, path):
    """直前が LP の遷移と N の遷移を分けた図（ラベルごとのブロックの推移）．"""
    labels = ["regular", "lpToHp", "nToHp", "hpToLp", "lpToLp", "nToLp", "hpToN", "lpToN"]
    fig, ax = plt.subplots(figsize=(6.5, 4))
    for k, lab in enumerate(labels):
        g = split[split["transition"] == lab].groupby("block")["value"].mean()
        if len(g):
            ax.plot(g.index, g.values, marker="o", color=f"C{k}", label=lab,
                    linestyle="--" if lab.startswith("n") else "-")
    ax.set_xlabel("Block")
    ax.set_ylabel("Mean RT (ms)")
    ax.legend(fontsize=7, ncol=2)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def plot_indices(indices, summary, path):
    names = [c["name"] for c in COMPARISONS]
    fig, axes = plt.subplots(1, len(names), figsize=(2.8 * len(names), 3.8))
    rng = np.random.default_rng(0)
    for ax, name in zip(axes, names):
        v = indices[name].to_numpy(dtype=float) if name in indices else np.array([])
        ax.axhline(0, color="gray", linewidth=0.8)
        ax.scatter(rng.uniform(-0.1, 0.1, len(v)), v, s=16, color="tab:blue")
        s = summary.set_index("comparison").loc[name]
        if np.isfinite(s["ci_low"]):
            ax.errorbar(0.3, s["mean"], yerr=[[s["mean"] - s["ci_low"]], [s["ci_high"] - s["mean"]]],
                        fmt="o", color="black", capsize=4)
        ax.set_xlim(-0.5, 0.6)
        ax.set_xticks([])
        ax.set_title(name, fontsize=9)
    fig.suptitle("Per-participant a − b, RT (ms; black: mean and 95% CI)")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def run(trials, participants, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    keep = participants.loc[~participants["excluded"], "subject"]
    trials = trials[trials["subject"].isin(keep)]
    main, correct = rt_trials(trials)
    kept = correct[correct["kept"]]

    # 外れ値の除外の記録（試行の種類ごと）
    trim = correct.groupby(["subject", "kind"]).agg(n_correct=("rt", "size"),
                                                    n_trimmed=("kept_trim", lambda x: int((~x).sum())),
                                                    n_kept=("kept", "sum")).reset_index()
    trim.to_csv(out_dir / "trimming.csv", index=False)

    acc_trials = main.assign(correct=main["correct"].astype(float))
    results = {}
    for measure, df, value in (("rt", kept, "rt"), ("acc", acc_trials, "correct")):
        all_cells, anovas, idx_rows, summary_rows = [], [], {}, []
        for comp in COMPARISONS:
            cells = cell_means(df, value, comp)
            all_cells.append(cells.assign(comparison=comp["name"]))
            a = rm_anova(cells)
            if len(a):
                anovas.append(a.assign(comparison=comp["name"]))
            idx = participant_index(cells)
            idx_rows[comp["name"]] = idx
            summary_rows.append({"comparison": comp["name"], "a": "+".join(comp["a"]), "b": "+".join(comp["b"]),
                                 **index_summary(idx)})
            if measure == "rt":
                jasp_wide(cells).to_csv(out_dir / f"jasp_rt_{comp['name']}.csv", index=False)
        all_cells = pd.concat(all_cells, ignore_index=True)
        indices = pd.DataFrame(idx_rows).rename_axis("subject").reset_index()
        summary = pd.DataFrame(summary_rows)
        anova = pd.concat(anovas, ignore_index=True) if anovas else pd.DataFrame()
        all_cells.to_csv(out_dir / f"cells_{measure}.csv", index=False)
        indices.to_csv(out_dir / f"indices_{measure}.csv", index=False)
        summary.to_csv(out_dir / f"summary_{measure}.csv", index=False)
        anova.to_csv(out_dir / f"anova_{measure}.csv", index=False)
        results[measure] = (all_cells, indices, summary, anova)

    # 直前が LP の遷移と N の遷移を分けた図（合わせる前に確かめる）
    split = source_split(kept, "rt", PRESENT_LABELS + ABSENT_LABELS)
    split.to_csv(out_dir / "source_split_rt.csv", index=False)

    # HP ペアの種類（記述だけ）
    p = participants[participants["subject"].isin(keep)]
    pair = p[["subject", "hp_pair", "hp_pair_type"]].merge(results["rt"][1][["subject", "learning"]], on="subject",
                                                           how="left")
    pair.groupby("hp_pair_type").agg(n=("subject", "size"), learning_mean=("learning", "mean")).reset_index().to_csv(
        out_dir / "hp_pair_type.csv", index=False)

    awareness_table(p).to_csv(out_dir / "awareness.csv", index=False)

    plot_cells(results["rt"][0], "Mean RT (ms)", out_dir / "cells_rt.png")
    plot_cells(results["acc"][0], "Accuracy", out_dir / "cells_acc.png")
    plot_source_split(split, out_dir / "source_split_rt.png")
    plot_indices(results["rt"][1], results["rt"][2], out_dir / "indices_rt.png")
    return results
