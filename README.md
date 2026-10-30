# VSSL — Visual Search Statistical Learning

## 研究の目的

視覚探索の中に**時系列の規則性**を埋め込んだとき，それが**潜在的に（気づかれずに）学習されるか**を調べる．このリポジトリには，その実験の実装と解析のコードを置く．

- 基本の実験設定は Anderson (2026) の実験1に従う．L の中から T を探す課題で，画面上の項目数を変える．
- 先行研究との違いは次の 2 点．
  - 規則性の入れ方：先行研究はターゲットの色と位置に出やすさの偏りを作った．本研究では，ターゲットの向きに試行をまたぐ順序（例：→，↑，↓，←）を埋め込む．
  - 回答：先行研究は T の頭が左か右かを答えた．本研究では T があるかないかを 2 つのキーで答える．全試行の 20% は T を含まない．

Anderson, B. A. (2026). Statistical learning and the efficiency of visual search. *Attention, Perception, & Psychophysics, 88*, 47. https://doi.org/10.3758/s13414-025-03219-y

## フォルダ構成

```
VSSL/
├── README.md        このファイル
├── AGENTS.md        作業の決まり（CLAUDE.md から読み込む）
├── CLAUDE.md
├── experiment/      実験のプログラム（ブラウザで動く）
│   ├── index.html   入口
│   ├── client/      ブラウザ側のコード
│   ├── server/      データを受け取るサーバ側の処理
│   └── tests/       試行列の生成のテスト
├── src/             解析のコード
├── data/
│   ├── raw/         実験の生データ
│   └── derived/     前処理や集計の結果
├── docs/            手元の文書（コミットしない）
│   ├── papers/      論文 PDF
│   └── reports/     報告書
├── STATUS.md        目的と進捗のまとめ（コミットしない）
└── log.md           作業の詳しい記録（コミットしない）
```
