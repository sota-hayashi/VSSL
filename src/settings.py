"""解析の設定（docs/specs/analysis.md）．"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw" / "single"
DERIVED_DIR = ROOT / "data" / "derived"

# 今回の対象．"pilot"（予備実験）か "main"（本実験）
TARGET = "pilot"

TARGETS = {
    # 予備実験：ID が pilot で始まり，版が 0.3.0 のもの
    "pilot": {"id_prefix": "pilot", "versions": ["0.3.0"], "main_trials": 480},
    # 本実験：版と試行数は未決（analysis.md の未決事項）
    "main": {"id_prefix": None, "versions": None, "main_trials": None},
}

# テストの ID．どの対象でも外す
TEST_IDS = ["test01", "test02"]

# 人が判断して除く参加者．{"ID": "理由"}
MANUAL_EXCLUSIONS = {}

# 参加者の除外（「または」でつなぐ）．None の基準は計算するが判定には使わない
MIN_OVERALL_ACCURACY = 0.75  # Li
MIN_ABSENT_ACCURACY = None  # 未決
MIN_DPRIME = None  # 未決

# 試行の除外
MIN_RT_MS = 200  # Li

# 点検の判定
FIXATION_MS = 900
REFRESH_OK_MS = (16.0, 17.0)  # 書き換え間隔の中央値がこの範囲なら合格（60 Hz）
