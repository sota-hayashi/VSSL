"""ブロックごとに状態の回数を固定し、遷移の回数を実験全体で厳密に C と一致させる系列が作れるかを確認する。"""
import random
import sys
import numpy as np
from scipy.optimize import milp, LinearConstraint, Bounds

S = ["HP1", "HP2", "LP1", "LP2", "N"]
C = np.array([[0, 105, 15, 15, 15],
              [105, 0, 15, 15, 15],
              [15, 15, 0, 15, 15],
              [15, 15, 15, 0, 15],
              [15, 15, 15, 15, 0]])
n_blk = np.array([25, 25, 10, 10, 10])
B, K = 6, 5
pairs = [(i, j) for i in range(K) for j in range(K) if i != j]


def solve_blocks(starts, rng):
    nv = B * len(pairs)
    idx = {(b, i, j): b * len(pairs) + p for b in range(B) for p, (i, j) in enumerate(pairs)}
    A, lo, hi = [], [], []
    for b in range(B):
        s_now, s_next = starts[b], starts[(b + 1) % B]
        for i in range(K):  # 行和 = ブロック内の回数
            row = np.zeros(nv)
            for j in range(K):
                if i != j:
                    row[idx[b, i, j]] = 1
            A.append(row); lo.append(n_blk[i]); hi.append(n_blk[i])
        for j in range(K):  # 列和 = 回数 - [先頭] + [次ブロックの先頭]
            col = np.zeros(nv)
            for i in range(K):
                if i != j:
                    col[idx[b, i, j]] = 1
            t = n_blk[j] - (j == s_now) + (j == s_next)
            A.append(col); lo.append(t); hi.append(t)
    for (i, j) in pairs:  # 全体で C と一致
        r = np.zeros(nv)
        for b in range(B):
            r[idx[b, i, j]] = 1
        A.append(r); lo.append(C[i, j]); hi.append(C[i, j])
    exp = {(i, j): C[i, j] / B for (i, j) in pairs}
    lb = np.array([max(0, np.floor(exp[i, j]) - 1) for b in range(B) for (i, j) in pairs])
    ub = np.array([np.ceil(exp[i, j]) + 1 for b in range(B) for (i, j) in pairs])
    c = np.array([rng.random() for _ in range(nv)])
    res = milp(c, constraints=LinearConstraint(np.array(A), lo, hi),
               integrality=np.ones(nv), bounds=Bounds(lb, ub))
    if not res.success:
        return None
    M = np.zeros((B, K, K), int)
    for (b, i, j), v in idx.items():
        M[b, i, j] = round(res.x[v])
    return M


def euler_path(M, start, rng):
    adj = {i: [] for i in range(K)}
    for i in range(K):
        for j in range(K):
            adj[i] += [j] * M[i, j]
        rng.shuffle(adj[i])
    stack, path = [start], []
    while stack:
        v = stack[-1]
        if adj[v]:
            stack.append(adj[v].pop())
        else:
            path.append(stack.pop())
    return path[::-1]


def generate(seed):
    rng = random.Random(seed)
    while True:
        starts = [rng.randrange(K) for _ in range(B)]
        M = solve_blocks(starts, rng)
        if M is not None:
            break
    seq = []
    for b in range(B):
        p = euler_path(M[b], starts[b], rng)
        assert len(p) == 81 and p[-1] == starts[(b + 1) % B]
        seq += p[:-1]
    return seq


bad = 0
for seed in range(int(sys.argv[1]) if len(sys.argv) > 1 else 50):
    seq = generate(seed)
    ok = len(seq) == 480
    for b in range(B):
        blk = seq[b * 80:(b + 1) * 80]
        ok &= all(blk.count(k) == n_blk[k] for k in range(K))
    T = np.zeros((K, K), int)
    for a, c in zip(seq, seq[1:]):
        T[a, c] += 1
    diff = C - T
    ok &= diff.sum() == 1 and diff.min() == 0  # 閉路を閉じる 1 本だけ欠ける
    ok &= all(seq[t] != seq[t + 1] for t in range(479))
    bad += not ok
    if seed == 0:
        print("seed0 P(HP2|HP1) =", round(T[0, 1] / T[0].sum(), 3))
        print("seed0 先頭20:", " ".join(S[s] for s in seq[:20]))
print("失敗:", bad)
