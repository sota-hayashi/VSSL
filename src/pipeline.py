"""生データから表と図をすべて作り直す．

実行：.venv/bin/python -m src.pipeline [--target pilot|main]
"""
import argparse
from pathlib import Path

from . import check, load, markov, pilot, settings, tables


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, default=settings.RAW_DIR, help="生データのフォルダ")
    parser.add_argument("--out", type=Path, default=settings.DERIVED_DIR, help="出力のフォルダ")
    parser.add_argument("--target", choices=list(settings.TARGETS), default=settings.TARGET, help="対象")
    args = parser.parse_args()
    target = settings.TARGET = args.target
    out = args.out / target
    out.mkdir(parents=True, exist_ok=True)

    # 1. 読み込み
    data, log = load.load(args.raw, target)
    log.to_csv(out / "load_log.csv", index=False)
    print(f"[load] {len(log)} files, {len(data)} included (target = {target})")
    if not data:
        print("対象のデータがありません．")
        return

    # 3・4. 試行の表と参加者の表（点検で参加者の表を使うので先に作る）
    trials = tables.trial_table(data)
    trials.to_csv(out / "trials.csv", index=False)
    participants = tables.participant_table(data, trials)
    participants.to_csv(out / "participants.csv", index=False)
    print(f"[tables] {len(trials)} trials, {int(participants['excluded'].sum())} of {len(participants)} excluded")

    # 2. 点検
    checks = check.run(data, trials, participants, out / "check")
    judges = [c for c in checks.columns if c.endswith("_judge")]
    for _, row in checks.iterrows():
        flagged = [f"{c[:-6]}={row[c]}" for c in judges if row[c] != check.OK]
        if flagged:
            print(f"[check] {row['subject']}: {', '.join(flagged)}")

    # 5. 解析（設計ごと）
    designs = set(participants["design"])
    fmt = lambda x: f"{x:.3f}"
    if designs == {"markov"}:
        results = markov.run(trials, participants, out / "markov")
        for measure in ("rt", "acc"):
            _, _, summary, anova = results[measure]
            print(f"[markov {measure}] a − b per participant")
            print(summary.drop(columns=["a", "b"]).to_string(index=False, float_format=fmt))
            if len(anova):
                print(anova[["comparison", "effect", "n", "df1", "df2", "F", "eps_gg", "p_gg", "eta_p2"]]
                      .to_string(index=False, float_format=fmt))
    elif designs == {"alternating"}:
        _, summary = pilot.run(trials, participants, out / "pilot")
        print("[pilot]")
        print(summary.to_string(index=False, float_format=fmt))
    else:
        print(f"設計が混ざっているか，解析が用意されていない設計です：{sorted(designs)}")


if __name__ == "__main__":
    main()
