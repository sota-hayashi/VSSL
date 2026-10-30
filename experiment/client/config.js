// 実験の設定（docs/specs/requirements.md）．
// URL に ?debug=1 を付けると，休憩の最低時間を短くし，?blocks=N で本番のブロック数を変えられる（動作確認用）．
(function (root) {
  'use strict';

  const params = new URLSearchParams(root.location ? root.location.search : '');
  const debug = params.get('debug') === '1';

  root.VSSLConfig = {
    version: '0.4.0',
    debug,

    // A．試行数とブロック
    nMainBlocks: debug && params.get('blocks') ? Number(params.get('blocks')) : 6,
    // 設計．'markov'（L．本実験），'alternating'（K．予備実験：奇数ブロック random，偶数ブロック regular），'mixed'（A・E）
    // markov は 6 ブロックで作る．?blocks=N（N < 6）のときは前の N ブロックだけを行う
    design: 'markov',

    // B．刺激と画面（CSS px）
    radius: 210,
    itemSize: 64,
    strokeWidth: 8, // 線の太さ（markov_stimuli.md §7）
    fixationRadius: 8,
    minDisplay: 484, // 表示領域の最小の幅と高さ
    colors: {
      background: 'rgb(30, 30, 30)',
      item: 'rgb(210, 210, 210)',
      fixation: 'rgb(255, 255, 255)',
      text: 'rgb(210, 210, 210)',
    },

    // C．時間（ms）
    fixationMs: 900,
    responseDeadlineMs: 3000,
    feedbackMs: 800,
    toneHz: 800,
    breakMinMs: debug ? 2000 : 30000,

    // D．反応
    keys: { present: 'l', absent: 'a' },

    // F．練習の合格の基準
    practiceMinAccuracy: 0.85, // これを超える
    practiceMaxMeanRt: 2000, // これ未満

    // J．データの送り先とProlific
    // 大学のサーバで受け取る URL（index.html からの相対パス）．空のときは送らず，ファイルを保存させる．
    saveUrl: 'server/upload.php',
    // Prolific の完了 URL（例：https://app.prolific.com/submissions/complete?cc=XXXX）．空のときはリンクを出さない．
    completionUrl: 'https://app.prolific.com/submissions/complete?cc=CI676Z0V',
  };
})(typeof window !== 'undefined' ? window : globalThis);
