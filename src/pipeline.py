"""生データから表と図をすべて作り直す．

実行：.venv/bin/python -m src.pipeline
"""
import argparse
from pathlib import Path

from . import check, load, pilot, settings, tables


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, default=settings.RAW_DIR, help="生データのフォルダ")
    parser.add_argument("--out", type=Path, default=settings.DERIVED_DIR, help="出力のフォルダ")
    args = parser.parse_args()
    target = settings.TARGET
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

    # 5. 解析
    if target == "pilot":
        _, summary = pilot.run(trials, participants, out / "pilot")
        print("[pilot]")
        print(summary.to_string(index=False, float_format=lambda x: f"{x:.3f}"))


if __name__ == "__main__":
    main()
