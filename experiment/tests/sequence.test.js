// 試行列が requirements.md のとおりに作られるかを確かめる．
// 実行：node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const S = require('../client/sequence.js');

const N_SEEDS = 200;
const N_BLOCKS = 6;
const TPB = S.MAIN.trialsPerBlock; // 80
const ABSENT = S.MAIN.absentPerBlock; // 16
const PER = (TPB - ABSENT) / 4; // 各向き 16
const REG = S.MAIN.regularPerOrientation; // mixed：規則どおり 12
const VIOL = S.MAIN.violationPerTarget; // mixed：規則外の各方向へ 2

function countBy(arr, f) {
  const m = {};
  for (const x of arr) { const k = f(x); m[k] = (m[k] || 0) + 1; }
  return m;
}

function runMain(seed, design = 'mixed') {
  const rng = S.makeRng(seed);
  const cycleIndex = Math.floor(rng() * 6);
  return S.generateMain(rng, { nBlocks: N_BLOCKS, cycleIndex, design });
}

const DESIGN_NAMES = Object.keys(S.DESIGNS);

test('mixed：1 ブロック 80 試行，T のない試行 16，T のある試行は各向き 16', () => {
  for (let s = 1; s <= N_SEEDS; s++) {
    const { blocks } = runMain(s);
    assert.strictEqual(blocks.length, N_BLOCKS);
    for (const b of blocks) {
      assert.strictEqual(b.trials.length, TPB);
      assert.strictEqual(b.trials.filter((t) => !t.present).length, ABSENT);
      const c = countBy(b.trials.filter((t) => t.present), (t) => t.orientation);
      for (const o of S.ORIENTATIONS) assert.strictEqual(c[o], PER, `seed ${s} block ${b.block} ${o}`);
    }
  }
});

test('T のない試行はブロック内で続かない', () => {
  for (let s = 1; s <= N_SEEDS; s++) {
    for (const b of runMain(s).blocks) {
      for (let i = 1; i < b.trials.length; i++) {
        assert.ok(b.trials[i].present || b.trials[i - 1].present, `seed ${s} block ${b.block} trial ${i + 1}`);
      }
    }
  }
});

test('mixed：各向きから出る遷移は，どのブロックでも規則どおり 12，規則外は残りの 2 方向へ 2 ずつ', () => {
  for (let s = 1; s <= N_SEEDS; s++) {
    const { cycle, blocks } = runMain(s);
    const succ = S.successorMap(cycle);
    for (const b of blocks) {
      assert.strictEqual(b.edges.length, TPB - ABSENT);
      for (const from of S.ORIENTATIONS) {
        const out = b.edges.filter((e) => e.from === from);
        assert.strictEqual(out.length, PER);
        assert.strictEqual(out.filter((e) => e.to === succ[from] && e.type === 'regular').length, REG);
        for (const to of S.ORIENTATIONS) {
          if (to === from || to === succ[from]) continue;
          assert.strictEqual(out.filter((e) => e.to === to && e.type === 'violation').length, VIOL);
        }
      }
    }
  }
});

test('提示される T の並びが遷移と一致し，ブロックの境目でつながる', () => {
  for (let s = 1; s <= N_SEEDS; s++) {
    const { cycle, blocks } = runMain(s);
    const succ = S.successorMap(cycle);
    const ts = blocks.flatMap((b) => b.trials.filter((t) => t.present));
    assert.strictEqual(ts.length, N_BLOCKS * (TPB - ABSENT));
    assert.strictEqual(ts[0].transition, 'first');
    assert.strictEqual(ts[0].prevOrientation, null);
    for (let i = 1; i < ts.length; i++) {
      assert.strictEqual(ts[i].prevOrientation, ts[i - 1].orientation);
      assert.notStrictEqual(ts[i].orientation, ts[i - 1].orientation, '同じ向きの連続');
      const expected = succ[ts[i - 1].orientation] === ts[i].orientation ? 'regular' : 'violation';
      assert.strictEqual(ts[i].transition, expected);
    }
  }
});

test('規則外の遷移はブロック内で続かない（間に T のない試行が入っても）', () => {
  for (let s = 1; s <= N_SEEDS; s++) {
    for (const b of runMain(s).blocks) {
      for (let i = 1; i < b.edges.length; i++) {
        assert.ok(!(b.edges[i].type === 'violation' && b.edges[i - 1].type === 'violation'), `seed ${s} block ${b.block}`);
      }
    }
  }
});

test('項目は 8 個．T の位置は 0–7．L の向きは同じ向きが 2 個まで', () => {
  for (let s = 1; s <= 50; s++) {
    for (const b of runMain(s).blocks) {
      for (const t of b.trials) {
        assert.strictEqual(t.items.length, 8);
        const Ts = t.items.filter((x) => x.kind === 'T');
        const Ls = t.items.filter((x) => x.kind === 'L');
        if (t.present) {
          assert.strictEqual(Ts.length, 1);
          assert.ok(t.targetPos >= 0 && t.targetPos < 8);
          assert.strictEqual(t.items[t.targetPos].kind, 'T');
          assert.strictEqual(Ts[0].rotation, S.ORIENTATION_ANGLE[t.orientation]);
        } else {
          assert.strictEqual(Ts.length, 0);
          assert.strictEqual(t.targetPos, null);
        }
        const c = countBy(Ls, (x) => x.rotation);
        for (const r of Object.keys(c)) assert.ok(c[r] <= 2);
        if (!t.present) for (const r of S.L_ROTATIONS) assert.strictEqual(c[r], 2);
      }
    }
  }
});

test('prevTargetPos は直前の T のある試行の位置', () => {
  for (let s = 1; s <= 50; s++) {
    let last = null;
    for (const b of runMain(s).blocks) {
      for (const t of b.trials) {
        assert.strictEqual(t.prevTargetPos, last);
        if (t.present) last = t.targetPos;
      }
    }
  }
});

test('afterAbsent は直前の試行が T のない試行かどうか（ブロックをまたいで数える）', () => {
  for (let s = 1; s <= 50; s++) {
    const all = runMain(s).blocks.flatMap((b) => b.trials);
    all.forEach((t, i) => {
      assert.strictEqual(t.afterAbsent, i > 0 && !all[i - 1].present);
    });
  }
});

test('練習：20 試行，T のない試行 4，T のある試行は各向き 4', () => {
  for (let s = 1; s <= N_SEEDS; s++) {
    const p = S.generatePractice(S.makeRng(s));
    assert.strictEqual(p.length, 20);
    assert.strictEqual(p.filter((t) => !t.present).length, 4);
    const c = countBy(p.filter((t) => t.present), (t) => t.orientation);
    for (const o of S.ORIENTATIONS) assert.strictEqual(c[o], 4);
  }
});

test('T の位置は直前の T と同じにならない（T のない試行やブロックの境目をまたいでも）', () => {
  for (const design of DESIGN_NAMES) {
    for (let s = 1; s <= N_SEEDS; s++) {
      const ts = runMain(s, design).blocks.flatMap((b) => b.trials.filter((t) => t.present));
      for (let i = 1; i < ts.length; i++) assert.notStrictEqual(ts[i].targetPos, ts[i - 1].targetPos, `${design} seed ${s}`);
    }
  }
  for (let s = 1; s <= N_SEEDS; s++) {
    const ts = S.generatePractice(S.makeRng(s)).filter((t) => t.present);
    for (let i = 1; i < ts.length; i++) assert.notStrictEqual(ts[i].targetPos, ts[i - 1].targetPos, `practice seed ${s}`);
  }
});

test('alternating：奇数ブロックは random，偶数ブロックは regular．各ブロックの数は mixed と同じ', () => {
  for (let s = 1; s <= N_SEEDS; s++) {
    const { blocks } = runMain(s, 'alternating');
    for (const b of blocks) {
      const type = b.block % 2 === 1 ? 'random' : 'regular';
      assert.strictEqual(b.blockType, type);
      assert.strictEqual(b.trials.length, TPB);
      assert.ok(b.trials.every((t) => t.blockType === type));
      assert.strictEqual(b.trials.filter((t) => !t.present).length, ABSENT);
      const c = countBy(b.trials.filter((t) => t.present), (t) => t.orientation);
      for (const o of S.ORIENTATIONS) assert.strictEqual(c[o], PER, `seed ${s} block ${b.block} ${o}`);
      for (let i = 1; i < b.trials.length; i++) assert.ok(b.trials[i].present || b.trials[i - 1].present);
    }
  }
});

test('alternating：T の並びはつながり，ラベルは循環に照らして付く．regular ブロックは最初の T から規則どおりだけ', () => {
  for (let s = 1; s <= N_SEEDS; s++) {
    const { cycle, blocks } = runMain(s, 'alternating');
    const succ = S.successorMap(cycle);
    const ts = blocks.flatMap((b) => b.trials.filter((t) => t.present));
    assert.strictEqual(ts[0].transition, 'first');
    for (let i = 1; i < ts.length; i++) {
      assert.strictEqual(ts[i].prevOrientation, ts[i - 1].orientation);
      assert.notStrictEqual(ts[i].orientation, ts[i - 1].orientation, '同じ向きの連続');
      const expected = succ[ts[i - 1].orientation] === ts[i].orientation ? 'regular' : 'violation';
      assert.strictEqual(ts[i].transition, expected);
      if (ts[i].blockType === 'regular') assert.strictEqual(ts[i].transition, 'regular');
    }
  }
});

test('alternating：random ブロックで規則どおりになる割合は約 1/3', () => {
  let reg = 0;
  let n = 0;
  for (let s = 1; s <= N_SEEDS; s++) {
    for (const t of runMain(s, 'alternating').blocks.flatMap((b) => b.trials)) {
      if (t.blockType !== 'random' || !t.present || t.transition === 'first') continue;
      n++;
      if (t.transition === 'regular') reg++;
    }
  }
  assert.ok(Math.abs(reg / n - 1 / 3) < 0.03, `${reg}/${n}`);
});

test('同じ seed なら同じ試行列', () => {
  const a = JSON.stringify(runMain(42));
  const b = JSON.stringify(runMain(42));
  assert.strictEqual(a, b);
});

// ---------- markov（requirements.md L，markov_stimuli.md） ----------

const M = S.MARKOV;
const STATE_INDEX = Object.fromEntries(M.STATES.map((s, i) => [s, i]));

function runMarkov(seed, nBlocks = N_BLOCKS) {
  return S.generateMain(S.makeRng(seed), { nBlocks, design: 'markov' });
}

test('markov：6 ブロック × 80 試行．各ブロックの状態の回数は 25 / 25 / 10 / 10 / 10', () => {
  for (let s = 1; s <= N_SEEDS; s++) {
    const { blocks } = runMarkov(s);
    assert.strictEqual(blocks.length, M.nBlocks);
    for (const b of blocks) {
      assert.strictEqual(b.trials.length, M.trialsPerBlock);
      assert.ok(b.trials.every((t) => t.blockType === 'markov'));
      const c = countBy(b.trials, (t) => t.state);
      M.STATES.forEach((st, i) => assert.strictEqual(c[st], M.counts[i], `seed ${s} block ${b.block} ${st}`));
    }
  }
});

test('markov：状態と画面の中身が一致する（N は T なし，それ以外は割り当てた向きの T）', () => {
  for (let s = 1; s <= N_SEEDS; s++) {
    const g = runMarkov(s);
    const so = g.stateOrientations;
    assert.deepStrictEqual([so.HP1, so.HP2].slice().sort(), g.hpPair.slice().sort());
    assert.strictEqual(new Set(Object.values(so)).size, 4);
    for (const t of g.blocks.flatMap((b) => b.trials)) {
      if (t.state === 'N') {
        assert.strictEqual(t.present, false);
        assert.strictEqual(t.orientation, null);
      } else {
        assert.strictEqual(t.present, true);
        assert.strictEqual(t.orientation, so[t.state]);
      }
    }
  }
});

test('markov：検証（markov_stimuli.md §8 の 1〜5）を通る．同じ状態は続かない', () => {
  for (let s = 1; s <= N_SEEDS; s++) {
    const states = runMarkov(s).blocks.flatMap((b) => b.trials).map((t) => STATE_INDEX[t.state]);
    assert.deepStrictEqual(S.verifyMarkovStates(states), [], `seed ${s}`);
  }
});

test('markov：実際の遷移の回数は C から 1 本（最後から最初へ戻る分）だけ少ない', () => {
  for (let s = 1; s <= 50; s++) {
    const states = runMarkov(s).blocks.flatMap((b) => b.trials).map((t) => STATE_INDEX[t.state]);
    const T = M.C.map((row) => row.map(() => 0));
    for (let i = 1; i < states.length; i++) T[states[i - 1]][states[i]]++;
    let diff = 0;
    M.C.forEach((row, i) => row.forEach((c, j) => {
      assert.ok(c - T[i][j] >= 0);
      diff += c - T[i][j];
    }));
    assert.strictEqual(diff, 1);
    T[states[states.length - 1]][states[0]]++;
    assert.deepStrictEqual(T, M.C);
  }
});

test('markov：ラベル（transition，prevState，prevOrientation，afterAbsent）を並びから数え直すと一致する', () => {
  const cls = (st) => (st.startsWith('HP') ? 'hp' : st.startsWith('LP') ? 'lp' : 'n');
  const names = { 'hp>hp': 'regular', 'lp>hp': 'lpToHp', 'n>hp': 'nToHp', 'hp>lp': 'hpToLp', 'hp>n': 'hpToN',
    'lp>lp': 'lpToLp', 'lp>n': 'lpToN', 'n>lp': 'nToLp' };
  for (let s = 1; s <= N_SEEDS; s++) {
    const all = runMarkov(s).blocks.flatMap((b) => b.trials);
    let lastT = null;
    all.forEach((t, i) => {
      const prev = i === 0 ? null : all[i - 1];
      assert.strictEqual(t.prevState, prev ? prev.state : null);
      assert.strictEqual(t.transition, prev ? names[cls(prev.state) + '>' + cls(t.state)] : 'first');
      assert.strictEqual(t.afterAbsent, !!prev && prev.state === 'N');
      assert.strictEqual(t.prevOrientation, t.present ? lastT : null);
      if (t.present) lastT = t.orientation;
    });
  }
});

test('markov：HP から相手の HP へ移る割合は .70，LP と N から HP へは .50（2 つ合わせて）', () => {
  let hp = 0; let hpToHp = 0; let other = 0; let otherToHp = 0;
  for (let s = 1; s <= 50; s++) {
    const all = runMarkov(s).blocks.flatMap((b) => b.trials);
    for (let i = 1; i < all.length; i++) {
      const from = all[i - 1].state; const to = all[i].state;
      if (from.startsWith('HP')) { hp++; if (to.startsWith('HP')) hpToHp++; } else { other++; if (to.startsWith('HP')) otherToHp++; }
    }
  }
  assert.ok(Math.abs(hpToHp / hp - 0.7) < 0.005, `${hpToHp}/${hp}`);
  assert.ok(Math.abs(otherToHp / other - 0.5) < 0.01, `${otherToHp}/${other}`);
});

test('markov：HP ペアの種類は隣り合う 4 通り，向かい合う 2 通りから選ばれ，比はおよそ 2 : 1', () => {
  const c = { adjacent: 0, opposite: 0 };
  for (let s = 1; s <= 600; s++) {
    const g = runMarkov(s, 1);
    const [a, b] = g.hpPair.map((o) => S.ORIENTATION_ANGLE[o]);
    assert.strictEqual(g.hpPairType, Math.abs(a - b) === 180 ? 'opposite' : 'adjacent');
    c[g.hpPairType]++;
  }
  assert.ok(Math.abs(c.adjacent / 600 - 2 / 3) < 0.06, JSON.stringify(c));
});

test('markov：項目は 8 個，L の向きは 2・2・2・1（T なしは各 2），T の位置は 8 か所でほぼ均等', () => {
  const pos = new Array(8).fill(0);
  for (let s = 1; s <= 50; s++) {
    for (const t of runMarkov(s).blocks.flatMap((b) => b.trials)) {
      assert.strictEqual(t.items.length, 8);
      const Ls = t.items.filter((x) => x.kind === 'L');
      const c = countBy(Ls, (x) => x.rotation);
      const counts = S.L_ROTATIONS.map((r) => c[r] || 0).sort();
      assert.deepStrictEqual(counts, t.present ? [1, 2, 2, 2] : [2, 2, 2, 2]);
      if (t.present) {
        assert.strictEqual(t.items[t.targetPos].kind, 'T');
        assert.strictEqual(t.items[t.targetPos].rotation, S.ORIENTATION_ANGLE[t.orientation]);
        pos[t.targetPos]++;
      }
    }
  }
  const n = pos.reduce((a, b) => a + b, 0);
  const chi2 = pos.reduce((a, o) => a + (o - n / 8) ** 2 / (n / 8), 0);
  assert.ok(chi2 < 24.32, `chi2 = ${chi2.toFixed(2)}`); // 自由度 7，p = .001 の値
});

test('markov：ブロック数を減らしたとき（動作確認用）は前のブロックだけを使う．同じ seed なら同じ試行列', () => {
  assert.strictEqual(runMarkov(7, 2).blocks.length, 2);
  assert.strictEqual(runMarkov(7, 8).blocks.length, M.nBlocks);
  assert.strictEqual(JSON.stringify(runMarkov(42)), JSON.stringify(runMarkov(42)));
});
