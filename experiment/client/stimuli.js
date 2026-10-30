// 刺激の描画（docs/specs/requirements.md の B）．
(function (root) {
  'use strict';

  const C = root.VSSLConfig;

  // 64 × 64 px の枠の中に，回転 0° の形を描く．
  // T：上端に横棒，横棒の中央から下端まで縦棒．
  // L：左端に縦棒，下端に横棒．接合部はずらさない．
  function drawShape(ctx, kind, cx, cy, rotationDeg) {
    const s = C.itemSize;
    const w = C.strokeWidth;
    const h = s / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.fillStyle = C.colors.item;
    if (kind === 'T') {
      ctx.fillRect(-h, -h, s, w);
      ctx.fillRect(-w / 2, -h, w, s);
    } else {
      ctx.fillRect(-h, -h, w, s);
      ctx.fillRect(-h, h - w, s, w);
    }
    ctx.restore();
  }

  // 位置 p（0–7）の中心．0 を右端とし，45° ずつ時計回り．
  function positionXY(p, cx, cy) {
    const a = (p * Math.PI) / 4;
    return { x: cx + C.radius * Math.cos(a), y: cy + C.radius * Math.sin(a) };
  }

  function clear(ctx, width, height) {
    ctx.fillStyle = C.colors.background;
    ctx.fillRect(0, 0, width, height);
  }

  function drawFixation(ctx, cx, cy) {
    ctx.fillStyle = C.colors.fixation;
    ctx.beginPath();
    ctx.arc(cx, cy, C.fixationRadius, 0, 2 * Math.PI);
    ctx.fill();
  }

  function drawSearch(ctx, items, cx, cy) {
    items.forEach((it, p) => {
      const { x, y } = positionXY(p, cx, cy);
      drawShape(ctx, it.kind, x, y, it.rotation);
    });
    drawFixation(ctx, cx, cy);
  }

  function drawText(ctx, lines, cx, cy, fontPx) {
    ctx.fillStyle = C.colors.text;
    ctx.font = `${fontPx}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lh = fontPx * 1.4;
    const top = cy - ((lines.length - 1) * lh) / 2;
    lines.forEach((line, i) => ctx.fillText(line, cx, top + i * lh));
  }

  // 気づきの質問で使う，T を 1 つだけ描いた canvas．
  function tCanvas(rotationDeg, scale) {
    const k = scale || 1;
    const size = Math.ceil(C.itemSize * 1.5 * k);
    const dpr = root.devicePixelRatio || 1;
    const cv = document.createElement('canvas');
    cv.width = size * dpr;
    cv.height = size * dpr;
    cv.style.width = size + 'px';
    cv.style.height = size + 'px';
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    clear(ctx, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.scale(k, k);
    drawShape(ctx, 'T', 0, 0, rotationDeg);
    ctx.restore();
    return cv;
  }

  root.VSSLStimuli = { drawShape, positionXY, clear, drawFixation, drawSearch, drawText, tCanvas };
})(window);
