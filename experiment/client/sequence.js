// 試行列の生成（docs/specs/requirements.md の A・B・E・F・K）．
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
  const DESIGNS = {
    mixed: () => 'mixed',
    alternating: (b) => (b % 2 === 1 ? 'random' : 'regular'),
  };

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

  // 本番の試行列．
  function generateMain(rng, opts) {
    const nBlocks = opts.nBlocks;
    const cycleIndex = opts.cycleIndex;
    const design = opts.design || 'mixed';
    if (!DESIGNS[design]) throw new Error('unknown design: ' + design);
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
    PRACTICE,
    makeRng,
    shuffle,
    successorMap,
    blockEdges,
    absentSlots,
    lRotations,
    generateMain,
    generatePractice,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VSSLSequence = api;
})(typeof window !== 'undefined' ? window : globalThis);
