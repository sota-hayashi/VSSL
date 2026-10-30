// 試行列の生成（docs/specs/requirements.md の A・B・E・F・K・L，docs/specs/markov_stimuli.md）．
// ブラウザでは window.VSSLSequence，Node では module.exports から使う．
(function (root) {
  'use strict';

  // 向きの名前と T の回転角（時計回り，度）．上向きの T（横棒が上）を 0° とする．
  const ORIENTATIONS = ['right', 'up', 'left', 'down'];
  const ORIENTATION_ANGLE = { up: 0, right: 90, down: 180, left: 270 };
  const ORIENTATION_SYMBOL = { right: '→', up: '↑', left: '←', down: '↓' };

  // 6 種類の循環（requirements.md E）．→ から始めて書く．
  const CYCLES = [
    ['right', 'down', 'left', 'up'],
    ['right', 'up', 'left', 'down'],
    ['right', 'left', 'down', 'up'],
    ['right', 'left', 'up', 'down'],
    ['right', 'down', 'up', 'left'],
    ['right', 'up', 'down', 'left'],
  ];

  const L_ROTATIONS = [0, 90, 180, 270];
  const N_POSITIONS = 8;

  const MAIN = {
    trialsPerBlock: 80,
    absentPerBlock: 16, // T のある試行は 64（各向き 16），80%
    regularPerOrientation: 12, // mixed だけで使う．各向きから出る 16 のうち規則どおり 12（75%）
    violationPerTarget: 2, // mixed だけで使う．規則外の 2 方向それぞれへ 2 回
  };

  // 設計（requirements.md K）．
  // mixed：どのブロックも規則どおりと規則外の遷移を混ぜる（A・E）．
  // alternating：奇数ブロックは random（規則なし），偶数ブロックは regular（規則どおりだけ）．予備実験で使う．
  // markov：T の向きと T のない試行を状態とするマルコフ過程（requirements.md L，markov_stimuli.md）．
  const DESIGNS = {
    mixed: () => 'mixed',
    alternating: (b) => (b % 2 === 1 ? 'random' : 'regular'),
    markov: () => 'markov',
  };

  // markov の設計（markov_stimuli.md §3・§5）．状態の番号は STATES の順．
  const MARKOV = {
    nBlocks: 6, // C は 6 ブロック分で決めてある
    trialsPerBlock: 80,
    STATES: ['HP1', 'HP2', 'LP1', 'LP2', 'N'],
    counts: [25, 25, 10, 10, 10], // 1 ブロックでの各状態の回数
    // 実験全体の遷移の回数（行：今，列：次）．最後から最初へ戻る 1 本を含めて 480 本
    C: [
      [0, 105, 15, 15, 15],
      [105, 0, 15, 15, 15],
      [15, 15, 0, 15, 15],
      [15, 15, 15, 0, 15],
      [15, 15, 15, 15, 0],
    ],
  };
  const N_STATE = 4;

  const PRACTICE = {
    trials: 20,
    absent: 4, // 本番と同じ 20%
  };

  // 再現できる乱数（mulberry32）．seed は記録する．
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randInt(rng, n) {
    return Math.floor(rng() * n);
  }

  function shuffle(rng, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(rng, i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function successorMap(cycle) {
    const map = {};
    cycle.forEach((o, i) => { map[o] = cycle[(i + 1) % cycle.length]; });
    return map;
  }

  // 1 ブロック分の遷移（出る側で数える）を作る．
  // 各向きから：規則どおり MAIN.regularPerOrientation，残りの 2 方向へ 1 ずつ．
  function blockEdges(successor) {
    const edges = [];
    for (const from of ORIENTATIONS) {
      for (let k = 0; k < MAIN.regularPerOrientation; k++) {
        edges.push({ from, to: successor[from], type: 'regular' });
      }
      for (const to of ORIENTATIONS) {
        if (to === from || to === successor[from]) continue;
        for (let k = 0; k < MAIN.violationPerTarget; k++) {
          edges.push({ from, to, type: 'violation' });
        }
      }
    }
    return edges;
  }

  // start から始めて，ブロックの遷移をすべて 1 回ずつ使う並びを作る．
  // 制約：規則外の遷移を続けない（ブロック内）．同じ向きの連続は遷移の定義上起こらない．
  // 各向きの出る数と来る数が等しいので，並びは start に戻って終わる．
  function orderEdges(rng, edges, start) {
    const n = edges.length;
    const used = new Array(n).fill(false);
    const path = [];
    let steps = 0;
    const STEP_LIMIT = 200000;

    function dfs(node, prevViolation) {
      if (path.length === n) return true;
      if (++steps > STEP_LIMIT) return false;
      // 同じ (to, type) の遷移は区別しないので，候補を種類ごとにまとめてから順をランダムにする
      const seen = new Set();
      const candidates = [];
      for (let i = 0; i < n; i++) {
        if (used[i] || edges[i].from !== node) continue;
        if (prevViolation && edges[i].type === 'violation') continue;
        const key = edges[i].to + '|' + edges[i].type;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(i);
      }
      // 残りの遷移の数に比例した重みで順を決める（多い種類を先に試しやすくする）
      const weighted = candidates.map((i) => {
        const e = edges[i];
        let count = 0;
        for (let k = 0; k < n; k++) {
          if (!used[k] && edges[k].from === e.from && edges[k].to === e.to && edges[k].type === e.type) count++;
        }
        return { i, w: -Math.log(1 - rng()) / count };
      });
      weighted.sort((a, b) => a.w - b.w);
      for (const { i } of weighted) {
        used[i] = true;
        path.push(edges[i]);
        if (dfs(edges[i].to, edges[i].type === 'violation')) return true;
        path.pop();
        used[i] = false;
      }
      return false;
    }

    if (!dfs(start, false)) return null;
    return path;
  }

  // T のない試行の位置：nTrials の中から nAbsent 個，隣り合わないように選ぶ．
  function absentSlots(rng, nTrials, nAbsent) {
    // nTrials - nAbsent + 1 個の候補から nAbsent 個を選び，順に 0,1,2,... だけずらす
    const pool = [];
    for (let i = 0; i < nTrials - nAbsent + 1; i++) pool.push(i);
    const chosen = shuffle(rng, pool).slice(0, nAbsent).sort((a, b) => a - b);
    return chosen.map((v, k) => v + k);
  }

  // L の向き：同じ向きは 1 画面に 2 個まで．
  function lRotations(rng, nL) {
    let counts;
    if (nL === 8) {
      counts = [2, 2, 2, 2];
    } else if (nL === 7) {
      counts = [2, 2, 2, 2];
      counts[randInt(rng, 4)] = 1;
    } else {
      throw new Error('nL must be 7 or 8');
    }
    const list = [];
    counts.forEach((c, k) => { for (let i = 0; i < c; i++) list.push(L_ROTATIONS[k]); });
    return shuffle(rng, list);
  }

  // random ブロックの T の向き：各向き同数，同じ向きを続けない（前のブロックの最後の T とも）．
  function randomOrientations(rng, perOrientation, prev) {
    const remaining = {};
    ORIENTATIONS.forEach((o) => { remaining[o] = perOrientation; });
    const n = perOrientation * ORIENTATIONS.length;
    const out = [];
    function dfs(last) {
      if (out.length === n) return true;
      const left = n - out.length;
      for (const o of shuffle(rng, ORIENTATIONS)) {
        if (o === last || remaining[o] === 0) continue;
        // 残りで同じ向きを続けずに並べられるか（最も多い向きが残りの半分を超えない）
        remaining[o]--;
        const max = Math.max(...ORIENTATIONS.map((x) => remaining[x]));
        if (max <= Math.ceil((left - 1) / 2)) {
          out.push(o);
          if (dfs(o)) return true;
          out.pop();
        }
        remaining[o]++;
      }
      return false;
    }
    if (!dfs(prev)) throw new Error('failed to order random orientations');
    return out;
  }

  // regular ブロックの T の向き：前の T から循環どおりに進める．
  function regularOrientations(rng, successor, n, prev) {
    let o = prev ? successor[prev] : ORIENTATIONS[randInt(rng, 4)];
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(o);
      o = successor[o];
    }
    return out;
  }

  // 画面の中身：T の位置（0–7）と，各位置の項目．
  // T の位置は，直前の T（間に T のない試行があっても，ブロックをまたいでも）と同じ位置を除いた 7 か所から選ぶ．
  function makeDisplay(rng, present, orientation, prevTargetPos) {
    let targetPos = null;
    if (present) {
      const pool = [];
      for (let p = 0; p < N_POSITIONS; p++) if (p !== prevTargetPos) pool.push(p);
      targetPos = pool[randInt(rng, pool.length)];
    }
    const rots = lRotations(rng, present ? 7 : 8);
    const items = [];
    let r = 0;
    for (let p = 0; p < N_POSITIONS; p++) {
      if (p === targetPos) items.push({ kind: 'T', rotation: ORIENTATION_ANGLE[orientation] });
      else items.push({ kind: 'L', rotation: rots[r++] });
    }
    return { targetPos, items };
  }

  // ---------- markov ----------

  function stateClass(s) {
    return s < 2 ? 'hp' : s < N_STATE ? 'lp' : 'n';
  }

  // 遷移のラベル（requirements.md L の 8 通り）．直前の試行の状態で決める．
  const MARKOV_LABELS = {
    'hp>hp': 'regular',
    'lp>hp': 'lpToHp',
    'n>hp': 'nToHp',
    'hp>lp': 'hpToLp',
    'hp>n': 'hpToN',
    'lp>lp': 'lpToLp',
    'lp>n': 'lpToN',
    'n>lp': 'nToLp',
  };

  function markovLabel(prev, cur) {
    if (prev === null) return 'first';
    const label = MARKOV_LABELS[stateClass(prev) + '>' + stateClass(cur)];
    if (!label) throw new Error('impossible transition');
    return label;
  }

  // HP ペア（markov_stimuli.md §4）：4 方向から 2 つを選ぶ 6 通りから 1 つ．HP1・HP2 と LP1・LP2 の対応もランダム．
  function assignStates(rng) {
    const pairs = [];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) pairs.push([ORIENTATIONS[i], ORIENTATIONS[j]]);
    const hp = shuffle(rng, pairs[randInt(rng, pairs.length)]);
    const lp = shuffle(rng, ORIENTATIONS.filter((o) => !hp.includes(o)));
    const diff = Math.abs(ORIENTATION_ANGLE[hp[0]] - ORIENTATION_ANGLE[hp[1]]);
    return {
      orientations: [hp[0], hp[1], lp[0], lp[1], null],
      hpPair: hp,
      hpPairType: diff === 180 ? 'opposite' : 'adjacent',
    };
  }

  // 各セルの 1 ブロックでの値の範囲：C/6 との差が ±1 以内（markov_stimuli.md §5.2，§6 手順 3）．
  function cellBounds(c) {
    if (c === 0) return [0, 0];
    return [Math.max(0, Math.floor(c / MARKOV.nBlocks) - 1), Math.ceil(c / MARKOV.nBlocks) + 1];
  }

  // 1 ブロックの遷移回数の行列を探す．行和・列和が決まっていて，各セルは [low, high] の範囲．
  // 値の候補を乱数の順に試す深さ優先の探索．見つからなければ null．
  function solveBlockMatrix(rng, rowNeed, colNeed, low, high) {
    const K = MARKOV.STATES.length;
    const cells = [];
    for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) if (i !== j) cells.push([i, j]);
    const M = [];
    for (let i = 0; i < K; i++) M.push(new Array(K).fill(0));
    const rowLeft = rowNeed.slice();
    const colLeft = colNeed.slice();
    // まだ決めていないセルの範囲の合計（行ごと・列ごと）
    const rowMin = new Array(K).fill(0);
    const rowMax = new Array(K).fill(0);
    const colMin = new Array(K).fill(0);
    const colMax = new Array(K).fill(0);
    for (const [i, j] of cells) {
      rowMin[i] += low[i][j]; rowMax[i] += high[i][j];
      colMin[j] += low[i][j]; colMax[j] += high[i][j];
    }
    let steps = 0;

    function dfs(k) {
      if (k === cells.length) return true;
      if (++steps > 20000) return false;
      const [i, j] = cells[k];
      rowMin[i] -= low[i][j]; rowMax[i] -= high[i][j];
      colMin[j] -= low[i][j]; colMax[j] -= high[i][j];
      const values = [];
      for (let v = low[i][j]; v <= high[i][j]; v++) values.push(v);
      for (const v of shuffle(rng, values)) {
        const r = rowLeft[i] - v;
        const c = colLeft[j] - v;
        if (r < rowMin[i] || r > rowMax[i] || c < colMin[j] || c > colMax[j]) continue;
        M[i][j] = v;
        rowLeft[i] = r;
        colLeft[j] = c;
        if (dfs(k + 1)) return true;
        rowLeft[i] += v;
        colLeft[j] += v;
      }
      M[i][j] = 0;
      rowMin[i] += low[i][j]; rowMax[i] += high[i][j];
      colMin[j] += low[i][j]; colMax[j] += high[i][j];
      return false;
    }

    return dfs(0) ? M : null;
  }

  // 6 ブロック分の遷移回数の行列（markov_stimuli.md §6 手順 3）．
  // ブロックを順に解き，残りのブロックで C に届くようにセルの範囲を絞る．最後のブロックは残り全部．
  function solveMarkovBlocks(rng, starts) {
    const K = MARKOV.STATES.length;
    const B = MARKOV.nBlocks;
    const remaining = MARKOV.C.map((row) => row.slice());
    const out = [];
    for (let b = 0; b < B; b++) {
      const after = B - 1 - b; // このブロックの後に残るブロックの数
      const low = [];
      const high = [];
      for (let i = 0; i < K; i++) {
        low.push([]); high.push([]);
        for (let j = 0; j < K; j++) {
          const [lo, hi] = cellBounds(MARKOV.C[i][j]);
          low[i].push(Math.max(lo, remaining[i][j] - after * hi));
          high[i].push(Math.min(hi, remaining[i][j] - after * lo));
          if (low[i][j] > high[i][j]) return null;
        }
      }
      const colNeed = MARKOV.counts.map((n, j) => n - (j === starts[b] ? 1 : 0) + (j === starts[(b + 1) % B] ? 1 : 0));
      const M = solveBlockMatrix(rng, MARKOV.counts, colNeed, low, high);
      if (!M) return null;
      for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) remaining[i][j] -= M[i][j];
      out.push(M);
    }
    return out;
  }

  // M の遷移をちょうど一度ずつ通り，start から始まって end で終わる道（Hierholzer 法．出る辺の順はランダム）．
  function eulerPath(rng, M, start) {
    const K = M.length;
    const adj = [];
    for (let i = 0; i < K; i++) {
      const list = [];
      for (let j = 0; j < K; j++) for (let k = 0; k < M[i][j]; k++) list.push(j);
      adj.push(shuffle(rng, list));
    }
    const stack = [start];
    const path = [];
    while (stack.length) {
      const v = stack[stack.length - 1];
      if (adj[v].length) stack.push(adj[v].pop());
      else path.push(stack.pop());
    }
    return path.reverse();
  }

  // 状態の列（480）を作る（markov_stimuli.md §6 手順 2〜5）．
  function markovStates(rng) {
    const B = MARKOV.nBlocks;
    const K = MARKOV.STATES.length;
    for (let attempt = 0; attempt < 1000; attempt++) {
      const starts = [];
      for (let b = 0; b < B; b++) starts.push(randInt(rng, K));
      const Ms = solveMarkovBlocks(rng, starts);
      if (!Ms) continue;
      const states = [];
      for (let b = 0; b < B; b++) {
        const p = eulerPath(rng, Ms[b], starts[b]);
        if (p.length !== MARKOV.trialsPerBlock + 1 || p[p.length - 1] !== starts[(b + 1) % B]) {
          throw new Error('euler path failed');
        }
        states.push(...p.slice(0, MARKOV.trialsPerBlock));
      }
      return { states, starts, matrices: Ms };
    }
    throw new Error('failed to generate markov states');
  }

  // 状態の列の検証（markov_stimuli.md §8 の 1〜5）．問題がなければ空の配列を返す．
  function verifyMarkovStates(states) {
    const K = MARKOV.STATES.length;
    const B = MARKOV.nBlocks;
    const T = MARKOV.trialsPerBlock;
    const errors = [];
    if (states.length !== B * T) errors.push('length');
    for (let b = 0; b < B; b++) {
      const blk = states.slice(b * T, (b + 1) * T);
      for (let s = 0; s < K; s++) {
        if (blk.filter((x) => x === s).length !== MARKOV.counts[s]) errors.push(`count b${b + 1} ${MARKOV.STATES[s]}`);
      }
      // 各ブロックの遷移（ブロックの最後から次のブロックの最初への 1 本を含む．最後のブロックは最初へ戻る）
      for (let i = 0; i < K; i++) {
        for (let j = 0; j < K; j++) {
          let n = 0;
          for (let t = b * T; t < (b + 1) * T; t++) {
            if (states[t] === i && states[(t + 1) % states.length] === j) n++;
          }
          const [lo, hi] = cellBounds(MARKOV.C[i][j]);
          if (n < lo || n > hi) errors.push(`block bounds b${b + 1} ${i}>${j}`);
        }
      }
    }
    const total = MARKOV.C.map((row) => row.map(() => 0));
    for (let t = 0; t + 1 < states.length; t++) {
      if (states[t] === states[t + 1]) errors.push(`repeat at ${t + 1}`);
      total[states[t]][states[t + 1]]++;
    }
    // 実際の遷移は 479 本．C との差は，最後から最初へ戻る 1 本だけ
    let diff = 0;
    for (let i = 0; i < K; i++) {
      for (let j = 0; j < K; j++) {
        const d = MARKOV.C[i][j] - total[i][j];
        if (d < 0) errors.push(`total ${i}>${j}`);
        diff += d;
      }
    }
    if (diff !== 1) errors.push('total diff');
    return errors;
  }

  // markov の本番の試行列．nBlocks が 6 より少ないとき（動作確認用）は，6 ブロック分を作って前から使う．
  function generateMarkov(rng, nBlocks) {
    const assignment = assignStates(rng);
    let gen;
    for (let attempt = 0; ; attempt++) {
      gen = markovStates(rng);
      if (verifyMarkovStates(gen.states).length === 0) break;
      if (attempt >= 10) throw new Error('markov states failed verification');
    }
    const T = MARKOV.trialsPerBlock;
    const blocks = [];
    let prevState = null;
    let prevT = null;
    let prevTargetPos = null;
    for (let b = 0; b < Math.min(nBlocks, MARKOV.nBlocks); b++) {
      const trials = [];
      for (let t = 0; t < T; t++) {
        const s = gen.states[b * T + t];
        const present = s !== N_STATE;
        const orientation = assignment.orientations[s];
        const display = makeDisplay(rng, present, orientation, prevTargetPos);
        trials.push({
          present,
          orientation,
          prevOrientation: present ? prevT : null,
          transition: markovLabel(prevState, s),
          afterAbsent: prevState === N_STATE,
          targetPos: display.targetPos,
          prevTargetPos,
          items: display.items,
          state: MARKOV.STATES[s],
          prevState: prevState === null ? null : MARKOV.STATES[prevState],
          block: b + 1,
          blockType: 'markov',
          trialInBlock: t + 1,
        });
        if (present) {
          prevT = orientation;
          prevTargetPos = display.targetPos;
        }
        prevState = s;
      }
      blocks.push({ block: b + 1, blockType: 'markov', trials, edges: null, matrix: gen.matrices[b] });
    }
    return {
      design: 'markov',
      cycle: null,
      start: null,
      hpPair: assignment.hpPair,
      hpPairType: assignment.hpPairType,
      stateOrientations: {
        HP1: assignment.orientations[0],
        HP2: assignment.orientations[1],
        LP1: assignment.orientations[2],
        LP2: assignment.orientations[3],
      },
      blockStarts: gen.starts.map((s) => MARKOV.STATES[s]),
      blocks,
    };
  }

  // ---------- 本番の試行列 ----------

  function generateMain(rng, opts) {
    const nBlocks = opts.nBlocks;
    const cycleIndex = opts.cycleIndex;
    const design = opts.design || 'mixed';
    if (!DESIGNS[design]) throw new Error('unknown design: ' + design);
    if (design === 'markov') return generateMarkov(rng, nBlocks);
    const cycle = CYCLES[cycleIndex];
    const successor = successorMap(cycle);
    const nPresent = MAIN.trialsPerBlock - MAIN.absentPerBlock;

    // mixed では，実験の最初の T の向きはランダム．遷移の並びは start に戻るので，各ブロックの最初の T は同じ向きになる．
    let start = ORIENTATIONS[randInt(rng, 4)];
    const blocks = [];
    let prevEdge = null; // mixed：前のブロックの最後の遷移（次のブロックの最初の T に入る遷移）
    let prevT = null; // 直前の T の向き（ブロックをまたいで引き継ぐ）
    let prevTargetPos = null;
    let prevWasAbsent = false; // ブロックをまたいで引き継ぐ（系列をつなぐため）
    let node = start;

    for (let b = 0; b < nBlocks; b++) {
      const blockType = DESIGNS[design](b + 1);
      let path = null;
      let orientations;
      let incoming; // 各 T に入る遷移 { from, type }．実験の最初の T は null
      if (blockType === 'mixed') {
        for (let attempt = 0; attempt < 50 && !path; attempt++) {
          path = orderEdges(rng, blockEdges(successor), node);
        }
        if (!path) throw new Error('failed to order transitions in block ' + (b + 1));
        if (path.length !== nPresent) throw new Error('unexpected number of transitions');
        // ブロック内の T の向き：遷移の並びの出発点を順に並べたもの
        orientations = path.map((e) => e.from);
        // 各 T に入る遷移：最初の T は前のブロックの最後の遷移，残りはブロック内の遷移
        incoming = [prevEdge].concat(path.slice(0, nPresent - 1));
        prevEdge = path[nPresent - 1];
        node = prevEdge.to;
      } else {
        orientations = blockType === 'random'
          ? randomOrientations(rng, nPresent / ORIENTATIONS.length, prevT)
          : regularOrientations(rng, successor, nPresent, prevT);
        // ラベルは循環に照らして付ける（random ブロックでは，たまたま規則どおりなら regular）
        incoming = orientations.map((o, i) => {
          const from = i === 0 ? prevT : orientations[i - 1];
          return from ? { from, type: successor[from] === o ? 'regular' : 'violation' } : null;
        });
      }
      if (b === 0) start = orientations[0];

      const absent = new Set(absentSlots(rng, MAIN.trialsPerBlock, MAIN.absentPerBlock));
      const trials = [];
      let k = 0;
      for (let t = 0; t < MAIN.trialsPerBlock; t++) {
        let trial;
        if (absent.has(t)) {
          const display = makeDisplay(rng, false, null, null);
          trial = {
            present: false,
            orientation: null,
            prevOrientation: null,
            transition: null,
            afterAbsent: prevWasAbsent,
            targetPos: null,
            prevTargetPos,
            items: display.items,
          };
          prevWasAbsent = true;
        } else {
          const o = orientations[k];
          const inc = incoming[k];
          const display = makeDisplay(rng, true, o, prevTargetPos);
          trial = {
            present: true,
            orientation: o,
            prevOrientation: inc ? inc.from : null,
            transition: inc ? inc.type : 'first',
            afterAbsent: prevWasAbsent,
            targetPos: display.targetPos,
            prevTargetPos,
            items: display.items,
          };
          prevTargetPos = display.targetPos;
          prevWasAbsent = false;
          k++;
        }
        trial.block = b + 1;
        trial.blockType = blockType;
        trial.trialInBlock = t + 1;
        trials.push(trial);
      }
      prevT = orientations[nPresent - 1];
      blocks.push({ block: b + 1, blockType, trials, edges: path });
    }
    return { design, cycle, start, blocks };
  }

  // 練習の試行列：規則性なし．T のない試行は 20%．T のある試行（16）は各向き 4．
  function generatePractice(rng) {
    const nPresent = PRACTICE.trials - PRACTICE.absent;
    const list = [];
    for (let i = 0; i < nPresent; i++) list.push(ORIENTATIONS[i % 4]);
    for (let i = 0; i < PRACTICE.absent; i++) list.push(null);
    let prevTargetPos = null;
    return shuffle(rng, list).map((o, t) => {
      const display = makeDisplay(rng, o !== null, o, prevTargetPos);
      if (o !== null) prevTargetPos = display.targetPos;
      return {
        present: o !== null,
        orientation: o,
        prevOrientation: null,
        transition: null,
        afterAbsent: null,
        targetPos: display.targetPos,
        prevTargetPos: null,
        items: display.items,
        trialInBlock: t + 1,
      };
    });
  }

  const api = {
    ORIENTATIONS,
    ORIENTATION_ANGLE,
    ORIENTATION_SYMBOL,
    CYCLES,
    L_ROTATIONS,
    N_POSITIONS,
    MAIN,
    DESIGNS,
    MARKOV,
    PRACTICE,
    makeRng,
    shuffle,
    successorMap,
    blockEdges,
    absentSlots,
    lRotations,
    markovLabel,
    verifyMarkovStates,
    generateMain,
    generatePractice,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VSSLSequence = api;
})(typeof window !== 'undefined' ? window : globalThis);
