"""解析の設定（docs/specs/analysis.md）．"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw" / "single"
DERIVED_DIR = ROOT / "data" / "derived"

# 今回の対象．"pilot"（予備実験）か "main"（本実験）．実行時に --target で変えられる
TARGET = "pilot"

TARGETS = {
    # 予備実験：ID が pilot で始まり，版が 0.3.0 のもの
    "pilot": {"id_prefix": "pilot", "versions": ["0.3.0"], "main_trials": 480},
    # 本実験：markov の設計（版 0.4.1．0.4.0 に同意のページを足したもの）．ID は Prolific の ID なので接頭辞では絞らない（pilot で始まる ID は外す）
    "main": {"id_prefix": None, "versions": ["0.4.1"], "main_trials": 480},
}

# テストの ID．どの対象でも外す
TEST_IDS = ["test01", "test02"]

# 人が判断して除く参加者．{"ID": "理由"}
MANUAL_EXCLUSIONS = {}

# 参加者の除外．None の基準は計算するが判定には使わない
MIN_OVERALL_ACCURACY = 0.75  # Li
MIN_ABSENT_ACCURACY = None  # 設定しない（2026-10-30）
MIN_DPRIME = None  # 設定しない（2026-10-30）

# 試行の除外
MIN_RT_MS = 200  # Li

# 点検の判定
FIXATION_MS = 900
REFRESH_OK_MS = (16.0, 17.0)  # 書き換え間隔の中央値がこの範囲なら合格（60 Hz）

# markov の設計（requirements.md L，markov_stimuli.md §5）．点検で生成のとおりかを確かめる
MARKOV_STATES = ["HP1", "HP2", "LP1", "LP2", "N"]
MARKOV_COUNTS = [25, 25, 10, 10, 10]  # 1 ブロックでの各状態の回数
MARKOV_C = [  # 実験全体の遷移の回数（行：今，列：次）．最後から最初へ戻る 1 本を含む
    [0, 105, 15, 15, 15],
    [105, 0, 15, 15, 15],
    [15, 15, 0, 15, 15],
    [15, 15, 15, 0, 15],
    [15, 15, 15, 15, 0],
]
