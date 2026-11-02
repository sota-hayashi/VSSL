// 実験の流れ（docs/specs/requirements.md）．
// 同意 → 開始 → 全画面・表示領域の確認・画面の書き換え間隔の測定 → 教示 → 練習（合格まで）→ 本番 6 ブロック → 気づきの質問 → データの送信．
(function (root) {
  'use strict';

  const C = root.VSSLConfig;
  const S = root.VSSLSequence;
  const D = root.VSSLStimuli;

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const screenEl = document.getElementById('screen');

  const params = new URLSearchParams(root.location.search);
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const rng = S.makeRng(seed);
  // サーバに保存するファイルの名前（<subjectId>.json）．保存先の外に書かれないよう，使う文字を絞る．
  const subjectId = (params.get('PROLIFIC_PID') || '').replace(/[^A-Za-z0-9_-]/g, '');

  const data = {
    meta: {
      version: C.version,
      debug: C.debug,
      prolificPid: params.get('PROLIFIC_PID'),
      subjectId,
      studyId: params.get('STUDY_ID'),
      sessionId: params.get('SESSION_ID'),
      seed,
      startTime: new Date().toISOString(),
      endTime: null,
      status: 'started',
      userAgent: navigator.userAgent,
      screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight },
      windowAtLoad: { width: root.innerWidth, height: root.innerHeight },
      windowAtStart: null,
      devicePixelRatio: root.devicePixelRatio,
      refresh: null,
      keys: C.keys,
      design: null,
      cycleIndex: null,
      cycle: null,
      startOrientation: null,
      hpPair: null,
      hpPairType: null,
      stateOrientations: null,
      blockStarts: null,
      practiceRounds: 0,
      consent: null,
    },
    events: [],
    trials: [],
    practiceSummary: [],
    blockSummary: [],
    awareness: [],
  };

  let current = { phase: 'setup', block: null, trial: null };
  let frameMs = 1000 / 60;
  let audioCtx = null;
  let running = false;

  // ---------- 記録 ----------

  function logEvent(type, detail) {
    data.events.push({
      t: performance.now(),
      type,
      phase: current.phase,
      block: current.block,
      trial: current.trial,
      detail: detail || null,
    });
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  document.addEventListener('fullscreenchange', () => logEvent(isFullscreen() ? 'fullscreen_enter' : 'fullscreen_exit'));
  document.addEventListener('webkitfullscreenchange', () => logEvent(isFullscreen() ? 'fullscreen_enter' : 'fullscreen_exit'));
  document.addEventListener('visibilitychange', () => logEvent('visibility_' + document.visibilityState));
  root.addEventListener('blur', () => logEvent('window_blur'));
  root.addEventListener('focus', () => logEvent('window_focus'));
  root.addEventListener('resize', () => {
    resizeCanvas();
    logEvent('resize', { width: root.innerWidth, height: root.innerHeight });
  });
  root.addEventListener('beforeunload', (e) => {
    if (running) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- 画面 ----------

  function resizeCanvas() {
    const dpr = root.devicePixelRatio || 1;
    canvas.width = Math.round(root.innerWidth * dpr);
    canvas.height = Math.round(root.innerHeight * dpr);
    canvas.style.width = root.innerWidth + 'px';
    canvas.style.height = root.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function center() {
    return { cx: root.innerWidth / 2, cy: root.innerHeight / 2 };
  }

  function clearCanvas() {
    D.clear(ctx, root.innerWidth, root.innerHeight);
  }

  function showHTML(html) {
    screenEl.innerHTML = html;
    screenEl.hidden = false;
    document.body.classList.remove('task');
  }

  function hideHTML() {
    screenEl.hidden = true;
    screenEl.innerHTML = '';
    document.body.classList.add('task');
  }

  function waitClick(el) {
    return new Promise((resolve) => el.addEventListener('click', resolve, { once: true }));
  }

  function waitKey(keys) {
    return new Promise((resolve) => {
      function onKey(e) {
        if (e.repeat) return;
        const k = e.key.toLowerCase();
        if (keys.includes(k)) {
          document.removeEventListener('keydown', onKey);
          resolve(k);
        }
      }
      document.addEventListener('keydown', onKey);
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  // 描いた次のフレームの時刻を，画面が書き換わった時刻の近似として返す．
  // targetOnset を渡すと，推定の書き換え時刻がそれを過ぎるフレームまで待ってから描く．
  function drawAt(drawFn, targetOnset) {
    return new Promise((resolve) => {
      function tick(ts) {
        if (targetOnset != null && ts + frameMs < targetOnset - frameMs / 2) {
          requestAnimationFrame(tick);
          return;
        }
        drawFn();
        requestAnimationFrame((ts2) => resolve({ drawTs: ts, onsetTs: ts2 }));
      }
      requestAnimationFrame(tick);
    });
  }

  async function measureRefresh(n) {
    const stamps = [];
    for (let i = 0; i <= n; i++) stamps.push(await nextFrame());
    const d = [];
    for (let i = 1; i < stamps.length; i++) d.push(stamps[i] - stamps[i - 1]);
    const sorted = d.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length);
    return { medianMs: median, meanMs: mean, sdMs: sd, n: d.length };
  }

  function beep() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = C.toneHz;
    gain.gain.value = 0.2;
    osc.connect(gain).connect(audioCtx.destination);
    const t0 = audioCtx.currentTime;
    osc.start(t0);
    osc.stop(t0 + C.feedbackMs / 1000);
  }

  async function requestFullscreen() {
    const el = document.documentElement;
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch (e) {
      logEvent('fullscreen_error', String(e));
    }
    // 全画面になった後の大きさが反映されるまで少し待つ
    for (let i = 0; i < 10; i++) await nextFrame();
    resizeCanvas();
  }

  function displayLargeEnough() {
    return root.innerWidth >= C.minDisplay && root.innerHeight >= C.minDisplay;
  }

  // 全画面から出ていたら，試行の前に戻ってもらう．
  async function ensureFullscreen() {
    while (!isFullscreen() || !displayLargeEnough()) {
      logEvent('paused_not_fullscreen');
      showHTML(`
        <div class="box">
          <p>The experiment must run in full screen.</p>
          <p>Please click the button to return to full screen.</p>
          <button id="fs">Return to full screen</button>
        </div>`);
      await waitClick(document.getElementById('fs'));
      await requestFullscreen();
    }
    hideHTML();
  }

  // ---------- 試行 ----------

  function itemsString(items) {
    return items.map((it) => it.kind + it.rotation).join(' ');
  }

  async function runTrial(trial, phase, extra) {
    await ensureFullscreen();
    const { cx, cy } = center();
    const nEventsBefore = data.events.length;

    const fix = await drawAt(() => { clearCanvas(); D.drawFixation(ctx, cx, cy); });
    const search = await drawAt(() => { clearCanvas(); D.drawSearch(ctx, trial.items, cx, cy); }, fix.onsetTs + C.fixationMs);

    if (C.debug) root.VSSLDebug = { awaiting: true, present: trial.present, phase, n: data.trials.length };
    const response = await new Promise((resolve) => {
      let timer = null;
      function onKey(e) {
        if (e.repeat) return;
        const k = e.key.toLowerCase();
        if (k !== C.keys.present && k !== C.keys.absent) return;
        document.removeEventListener('keydown', onKey);
        clearTimeout(timer);
        resolve({ key: k, code: e.code, keyTime: e.timeStamp, timeout: false });
      }
      document.addEventListener('keydown', onKey);
      const remaining = search.onsetTs + C.responseDeadlineMs - performance.now();
      timer = setTimeout(() => {
        document.removeEventListener('keydown', onKey);
        resolve({ key: null, code: null, keyTime: null, timeout: true });
      }, Math.max(0, remaining));
    });

    if (C.debug) root.VSSLDebug = { awaiting: false };
    const answer = response.key === C.keys.present ? 'present' : response.key === C.keys.absent ? 'absent' : null;
    const correct = answer !== null && (answer === 'present') === trial.present;
    const rt = response.timeout ? null : response.keyTime - search.onsetTs;

    if (!correct) {
      beep();
      await drawAt(() => { clearCanvas(); D.drawText(ctx, ['Your response was wrong!'], cx, cy, 24); });
      await sleep(C.feedbackMs);
    }

    const focusLost = data.events.slice(nEventsBefore).some((e) =>
      e.type === 'window_blur' || e.type === 'visibility_hidden' || e.type === 'fullscreen_exit');

    const rec = Object.assign({
      phase,
      trialInBlock: trial.trialInBlock,
      blockType: trial.blockType || null,
      present: trial.present,
      orientation: trial.orientation,
      prevOrientation: trial.prevOrientation,
      transition: trial.transition,
      afterAbsent: trial.afterAbsent,
      targetPos: trial.targetPos,
      prevTargetPos: trial.prevTargetPos,
      state: trial.state || null,
      prevState: trial.prevState || null,
      items: itemsString(trial.items),
      response: answer,
      key: response.key,
      keyCode: response.code,
      correct,
      timeout: response.timeout,
      rt,
      fixDrawTs: fix.drawTs,
      fixOnsetTs: fix.onsetTs,
      searchDrawTs: search.drawTs,
      searchOnsetTs: search.onsetTs,
      keyTime: response.keyTime,
      fullscreen: isFullscreen(),
      windowWidth: root.innerWidth,
      windowHeight: root.innerHeight,
      focusLost,
    }, extra);
    data.trials.push(rec);
    return rec;
  }

  function summarize(recs) {
    const nCorrect = recs.filter((r) => r.correct).length;
    const rts = recs.filter((r) => r.correct).map((r) => r.rt);
    const meanRt = rts.length ? rts.reduce((a, b) => a + b, 0) / rts.length : null;
    return { n: recs.length, accuracy: nCorrect / recs.length, meanRt };
  }

  function summaryLines(s) {
    return `
      <p>Accuracy: ${(s.accuracy * 100).toFixed(0)}%</p>
      <p>Mean response time: ${s.meanRt == null ? '–' : Math.round(s.meanRt) + ' ms'}</p>`;
  }

  // ---------- 各段階 ----------

  // 同意の確認の項目（1 つ）．チェックしたときだけ「同意する」を押せる．
  const CONSENT_ITEMS = [
    { id: 'consent', text: 'I have read and understood the information above, I am at least 18 years old, and I agree to take part in this study.' },
  ];

  function escapeHTML(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function consentInfoMissing() {
    return Object.values(C.consentInfo).some((v) => /\[.*\]/.test(String(v)));
  }

  // 同意のページ（実験の前．全画面にする前）．同意すれば true，同意しなければ false を返す．
  async function consent() {
    current.phase = 'consent';
    screenEl.classList.add('consent'); // 同意のページだけ，文章の箱の左右をグレーにする
    const info = {};
    Object.keys(C.consentInfo).forEach((k) => { info[k] = escapeHTML(C.consentInfo[k]); });
    const items = CONSENT_ITEMS.map((it) =>
      `<label class="check"><input type="checkbox" name="consent" value="${it.id}"> ${it.text}</label>`).join('');
    showHTML(`
      <div class="box wide">
        <h1>Information and consent</h1>
        <p>Please read the following information before deciding whether to take part.</p>
        <h3>Purpose of the study</h3>
        <p>This study investigates how people search for a target among other shapes.
           It is conducted by ${info.researcher} (${info.institution}).</p>
        <h3>What you will do</h3>
        <p>You will look at displays of eight shapes and decide, as quickly and accurately as possible,
           whether a T is present among L shapes, by pressing one of two keys.
           There is a short practice block, the main task (6 blocks with breaks), and a few questions at the end.
           The study takes ${info.duration} and runs in full screen.
           You need a computer with a physical keyboard, and sound should be turned on.</p>
        <h3>Voluntary participation and withdrawal</h3>
        <p>Taking part is voluntary. You can stop at any time without giving a reason by closing this page.
           Your data are sent to the researcher only when you reach the end of the study;
           if you stop earlier, no data are saved.
           If you want your data to be deleted after completing the study, please contact the researcher
           (${info.contact}) with your Prolific ID.</p>
        <h3>Risks and benefits</h3>
        <p>There are no known risks beyond those of ordinary computer use, such as mild eye strain or fatigue.
           There is no direct benefit to you other than the payment.</p>
        <h3>Data and privacy</h3>
        <p>We record your key presses and response times, your answers to the questions at the end,
           your Prolific ID, and technical information about your browser and screen
           (browser type, screen size, display refresh rate).
           We do not collect your name or any other information that directly identifies you.
           Your Prolific ID is used only to manage payment and to identify your data if you ask for it to be deleted;
           it will be removed before the data are analysed or shared.
           The data are stored on a secure university server and kept for ${info.retention}.
           Anonymised data may be published and shared with other researchers.
           This study has been approved by ${info.ethics}.</p>
        <h3>Payment</h3>
        <p>You will receive ${info.payment}. Payments are made via Prolific.
           Please do the task attentively until the end.
           If your responses are exceptionally fast and show clear signs of low effort throughout the task
           (for example, pressing keys without searching for the target),
           your submission may be rejected and not paid, or you may be asked to return it.</p>
        <h3>Contact</h3>
        <p>If you have any questions, please contact ${info.contact}.</p>
        <h3>Consent</h3>
        <div class="checks">${items}</div>
        <div class="consent-buttons">
          <button id="agree" disabled>I agree to take part</button>
          <button id="decline">I do not agree</button>
        </div>
      </div>`);
    const boxes = Array.from(document.querySelectorAll('input[name="consent"]'));
    const agree = document.getElementById('agree');
    boxes.forEach((b) => b.addEventListener('change', () => { agree.disabled = !boxes.every((x) => x.checked); }));
    const choice = await new Promise((resolve) => {
      agree.addEventListener('click', () => resolve(true), { once: true });
      document.getElementById('decline').addEventListener('click', () => resolve(false), { once: true });
    });
    data.meta.consent = {
      agreed: choice,
      time: new Date().toISOString(),
      items: choice ? CONSENT_ITEMS.map((it) => it.id) : boxes.filter((b) => b.checked).map((b) => b.value),
    };
    logEvent(choice ? 'consent_agreed' : 'consent_declined');
    screenEl.classList.remove('consent');
    return choice;
  }

  // 同意しなかったとき：データは送らず，完了の URL も出さない．Prolific の「No consent」の経路へ戻す．
  function declined() {
    running = false;
    data.meta.status = 'no_consent';
    const back = C.noConsentUrl
      ? `<p>You will now be returned to Prolific. If nothing happens, <a href="${C.noConsentUrl}">click here</a>.</p>`
      : '';
    showHTML(`
      <div class="box">
        <p>You have chosen not to take part in this study. Thank you for your time.</p>
        <p>Please return your submission on Prolific by clicking <b>"Stop without completing"</b>.</p>
        ${back}
      </div>`);
    if (C.noConsentUrl) setTimeout(() => { root.location.href = C.noConsentUrl; }, 3000);
  }

  async function welcome() {
    showHTML(`
      <div class="box wide">
        <h1>Visual search experiment</h1>
        <p>In this experiment, you will search for a target among other shapes and respond with the keyboard.
           The experiment takes place in full screen. Please use a computer with a physical keyboard,
           close other applications and browser tabs, and stay in a quiet place.</p>
        <p>Short sounds are played after errors, so please turn on your sound.</p>
        <p>When you are ready, click the button below. The browser will switch to full screen.</p>
        <button id="start">Start in full screen</button>
      </div>`);
    await waitClick(document.getElementById('start'));
    try {
      audioCtx = new (root.AudioContext || root.webkitAudioContext)();
    } catch (e) {
      logEvent('audio_error', String(e));
    }
    await requestFullscreen();
    data.meta.windowAtStart = { width: root.innerWidth, height: root.innerHeight, fullscreen: isFullscreen() };
    if (!displayLargeEnough()) {
      data.meta.status = 'display_too_small';
      logEvent('display_too_small', data.meta.windowAtStart);
      showHTML(`
        <div class="box">
          <p>Unfortunately, your screen is too small for this experiment
             (at least ${C.minDisplay} × ${C.minDisplay} pixels are needed in full screen).</p>
          <p>Please return your submission on Prolific by clicking <b>"Stop without completing"</b>.</p>
        </div>`);
      return false;
    }
    hideHTML();
    clearCanvas();
    data.meta.refresh = await measureRefresh(120);
    frameMs = data.meta.refresh.medianMs;
    return true;
  }

  function exampleImages() {
    const box = document.createElement('div');
    box.className = 'examples';
    const t = D.tCanvas(S.ORIENTATION_ANGLE.up);
    const l = document.createElement('canvas');
    // L の例
    const size = Math.ceil(C.itemSize * 1.5);
    const dpr = root.devicePixelRatio || 1;
    l.width = size * dpr; l.height = size * dpr;
    l.style.width = size + 'px'; l.style.height = size + 'px';
    const lc = l.getContext('2d');
    lc.scale(dpr, dpr);
    D.clear(lc, size, size);
    D.drawShape(lc, 'L', size / 2, size / 2, 0);
    box.append(labeled(t, 'Target: T'), labeled(l, 'Other shapes: L'));
    return box;
  }

  function labeled(el, text) {
    const fig = document.createElement('figure');
    const cap = document.createElement('figcaption');
    cap.textContent = text;
    fig.append(el, cap);
    return fig;
  }

  async function instructions() {
    showHTML(`
      <div class="box wide">
        <h2>Instructions</h2>
        <p>On each trial, a small dot appears in the center of the screen, followed by eight shapes arranged in a circle.
           Your task is to decide whether a <b>T</b> is present among the <b>L</b> shapes.
           The shapes can be rotated.</p>
        <div id="ex"></div>
        <p>Press <b>L</b> if a T is <b>present</b>.<br>Press <b>A</b> if a T is <b>absent</b>.</p>
        <p>Please keep your eyes on the central dot while doing the task,
           and respond as quickly and as accurately as possible.
           If you respond incorrectly or too slowly, a message and a tone will appear.</p>
        <p>You will start with a short practice block.</p>
        <button id="go">Start practice</button>
      </div>`);
    document.getElementById('ex').append(exampleImages());
    await waitClick(document.getElementById('go'));
  }

  async function practice() {
    current.phase = 'practice';
    for (let round = 1; ; round++) {
      current.block = round;
      data.meta.practiceRounds = round;
      const trials = S.generatePractice(rng);
      hideHTML();
      const recs = [];
      for (let i = 0; i < trials.length; i++) {
        current.trial = i + 1;
        recs.push(await runTrial(trials[i], 'practice', { block: round }));
      }
      current.trial = null;
      const s = summarize(recs);
      const passed = s.accuracy > C.practiceMinAccuracy && s.meanRt != null && s.meanRt < C.practiceMaxMeanRt;
      data.practiceSummary.push(Object.assign({ round, passed }, s));
      showHTML(`
        <div class="box">
          <p>Practice block finished.</p>
          ${summaryLines(s)}
          <p>${passed
            ? 'Well done. The main experiment starts next.'
            : `To continue, accuracy must be above ${C.practiceMinAccuracy * 100}% and mean response time below ${C.practiceMaxMeanRt} ms. Let's practice once more.`}</p>
          <p>Press the space bar to continue.</p>
        </div>`);
      await waitKey([' ']);
      if (passed) return;
    }
  }

  async function mainBlocks() {
    current.phase = 'main';
    data.meta.design = C.design;
    let seq;
    if (C.design === 'markov') {
      seq = S.generateMain(rng, { nBlocks: C.nMainBlocks, design: C.design });
      data.meta.hpPair = seq.hpPair;
      data.meta.hpPairType = seq.hpPairType;
      data.meta.stateOrientations = seq.stateOrientations;
      data.meta.blockStarts = seq.blockStarts;
    } else {
      const cycleIndex = Math.floor(rng() * S.CYCLES.length);
      seq = S.generateMain(rng, { nBlocks: C.nMainBlocks, cycleIndex, design: C.design });
      data.meta.cycleIndex = cycleIndex;
      data.meta.cycle = seq.cycle.map((o) => S.ORIENTATION_SYMBOL[o]).join('');
      data.meta.startOrientation = seq.start;
    }

    showHTML(`
      <div class="box">
        <p>The main experiment consists of ${seq.blocks.length} blocks.
           After each block, you can take a short break.</p>
        <p>Remember: <b>L</b> = T present, <b>A</b> = T absent.</p>
        <p>Press the space bar to start.</p>
      </div>`);
    await waitKey([' ']);

    let globalTrial = 0;
    for (const b of seq.blocks) {
      current.block = b.block;
      hideHTML();
      const recs = [];
      for (const trial of b.trials) {
        current.trial = trial.trialInBlock;
        globalTrial++;
        recs.push(await runTrial(trial, 'main', { block: b.block, trial: globalTrial }));
      }
      current.trial = null;
      const s = summarize(recs);
      data.blockSummary.push(Object.assign({ block: b.block, blockType: b.blockType }, s));
      const last = b.block === seq.blocks.length;
      await blockBreak(b.block, seq.blocks.length, s, last);
    }
  }

  async function blockBreak(block, nBlocks, s, last) {
    const breakStart = performance.now();
    const render = (remaining) => showHTML(`
      <div class="box">
        <p>Block ${block} of ${nBlocks} finished.</p>
        ${summaryLines(s)}
        <p>${last
          ? 'Press the space bar to continue.'
          : remaining > 0
            ? `Please take a break. You can continue in ${remaining} s.`
            : 'Press the space bar to start the next block.'}</p>
      </div>`);
    if (!last) {
      for (;;) {
        const remaining = Math.ceil((C.breakMinMs - (performance.now() - breakStart)) / 1000);
        render(remaining);
        if (remaining <= 0) break;
        await sleep(250);
      }
    } else {
      render(0);
    }
    await waitKey([' ']);
    logEvent('break_end', { block, durationMs: performance.now() - breakStart });
  }

  function confidenceHTML(name) {
    const opts = [1, 2, 3, 4, 5].map((v) =>
      `<label class="conf"><input type="radio" name="${name}" value="${v}"> ${v}</label>`).join('');
    return `
      <p>How confident are you in this answer?</p>
      <div class="scale">${opts}</div>
      <p class="hint">1 = not certain at all, 5 = very certain</p>`;
  }

  function radioValue(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : null;
  }

  async function awareness() {
    current.phase = 'awareness';
    current.block = null;
    document.body.classList.remove('task');

    // 質問 1：系列に気づいたか
    showHTML(`
      <div class="box wide">
        <h2>A few questions</h2>
        <p>During the experiment, did you notice any regularity in the order of the orientations of the T?
           For example, that a T with one specific orientation was often followed by a T with another specific orientation on the next trial.</p>
        <div class="scale">
          <label><input type="radio" name="noticed" value="yes"> Yes</label>
          <label><input type="radio" name="noticed" value="no"> No</label>
        </div>
        ${confidenceHTML('conf')}
        <button id="next" disabled>Next</button>
      </div>`);
    await answered(['noticed', 'conf']);
    data.awareness.push({ question: 'noticed', answer: radioValue('noticed'), confidence: Number(radioValue('conf')), t: performance.now() });

    // 質問 2：4 方向すべてについて，次に出ると思う向き
    const order = S.shuffle(rng, S.ORIENTATIONS);
    for (let q = 0; q < order.length; q++) {
      const shown = order[q];
      const options = S.shuffle(rng, S.ORIENTATIONS);
      showHTML(`
        <div class="box wide">
          <p>Question ${q + 2} of ${order.length + 1}</p>
          <p>Suppose that the T below appeared on one trial.</p>
          <div id="shown" class="examples"></div>
          <p>Which orientation do you think the T was most likely to have on the <b>next</b> trial? Click one.</p>
          <div id="opts" class="examples options"></div>
          ${confidenceHTML('conf')}
          <button id="next" disabled>Next</button>
        </div>`);
      document.getElementById('shown').append(D.tCanvas(S.ORIENTATION_ANGLE[shown]));
      const optsEl = document.getElementById('opts');
      let choice = null;
      options.forEach((o) => {
        const btn = document.createElement('button');
        btn.className = 'option';
        btn.dataset.orientation = o;
        btn.append(D.tCanvas(S.ORIENTATION_ANGLE[o], 0.75));
        btn.addEventListener('click', () => {
          choice = o;
          optsEl.querySelectorAll('.option').forEach((x) => x.classList.toggle('selected', x === btn));
          update();
        });
        optsEl.append(btn);
      });
      const nextBtn = document.getElementById('next');
      const update = () => { nextBtn.disabled = !(choice && radioValue('conf')); };
      document.querySelectorAll('input[name="conf"]').forEach((el) => el.addEventListener('change', update));
      await waitClick(nextBtn);
      data.awareness.push({
        question: 'next_orientation',
        shown,
        optionOrder: options,
        answer: choice,
        confidence: Number(radioValue('conf')),
        t: performance.now(),
      });
    }
  }

  function answered(names) {
    const nextBtn = document.getElementById('next');
    const update = () => { nextBtn.disabled = !names.every((n) => radioValue(n)); };
    names.forEach((n) => document.querySelectorAll(`input[name="${n}"]`).forEach((el) => el.addEventListener('change', update)));
    return waitClick(nextBtn);
  }

  // ---------- データの送信 ----------

  function fileName() {
    return `${subjectId}.json`;
  }

  async function send() {
    if (!C.saveUrl) return false;
    try {
      const res = await fetch(C.saveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject_id: subjectId, data: JSON.stringify(data) }),
      });
      logEvent('save_response', { status: res.status });
      return res.ok;
    } catch (e) {
      logEvent('save_error', String(e));
      return false;
    }
  }

  function downloadLink() {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    a.textContent = 'Download data file';
    return a;
  }

  async function finish() {
    running = false;
    data.meta.endTime = new Date().toISOString();
    if (data.meta.status === 'started') data.meta.status = 'completed';
    showHTML('<div class="box"><p>Saving data… Please do not close this page.</p></div>');
    const ok = await send();
    // 完了の URL は，最後まで終えた参加者にだけ出す（画面が小さくて始められなかった参加者などには出さない）
    const completed = data.meta.status === 'completed';
    const link = completed && C.completionUrl ? `<p><a href="${C.completionUrl}">Click here to return to Prolific</a></p>` : '';
    const thanks = completed
      ? 'Thank you for participating. The data were saved.'
      : `${data.meta.status === 'display_too_small' ? 'Unfortunately, your screen is too small for this experiment. ' : ''}`
        + 'Please return your submission on Prolific by clicking <b>"Stop without completing"</b>.';
    if (ok) {
      showHTML(`<div class="box"><p>${thanks}</p>${link}</div>`);
    } else {
      showHTML(`
        <div class="box">
          <p>The data could not be sent automatically.</p>
          <p>Please download the data file and send it to the researcher.</p>
          <p id="dl"></p>
          ${C.saveUrl ? '<button id="retry">Try sending again</button>' : ''}
          ${link}
        </div>`);
      document.getElementById('dl').append(downloadLink());
      const retry = document.getElementById('retry');
      if (retry) {
        retry.addEventListener('click', async () => {
          if (await send()) showHTML(`<div class="box"><p>${thanks}</p>${link}</div>`);
        });
      }
    }
    if (document.exitFullscreen && isFullscreen()) document.exitFullscreen().catch(() => {});
  }

  // ---------- 実行 ----------

  async function main() {
    resizeCanvas();
    clearCanvas();
    // ID がなければ始めない．予備実験では URL に ?PROLIFIC_PID=pilot01 などを付ける．
    if (!subjectId) {
      showHTML(`
        <div class="box">
          <p>This page must be opened from Prolific.</p>
          <p>The participant ID is missing from the address.</p>
        </div>`);
      return;
    }
    // 研究の情報が埋まっていなければ始めない（動作確認の debug を除く）
    if (consentInfoMissing() && !C.debug) {
      showHTML(`
        <div class="box">
          <p>This study is not ready yet.</p>
          <p>Please return your submission on Prolific by clicking <b>"Stop without completing"</b>.</p>
        </div>`);
      return;
    }
    if (!(await consent())) { declined(); return; }
    if (!(await welcome())) { await finish(); return; }
    running = true;
    await instructions();
    await practice();
    await mainBlocks();
    await awareness();
    await finish();
  }

  // 動作確認用に外から見えるようにしておく
  root.VSSLData = data;
  main();
})(window);
