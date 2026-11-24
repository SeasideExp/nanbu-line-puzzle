/**
 * なぜ南武線は混んでるのか？ - メインアプリケーションコントローラー
 * 状態管理、上下線・各停/快速ゲーム進行フロー、第13回実OD運行スケジュール実行、ドラッグ/タップ操作、UIイベント連携を担当する。
 */
(function (global) {
  'use strict';

  const { APP_VERSION, BOARD_CONFIG, STATIONS, DIRECTIONS, DIFFICULTIES, COURSES, RAPID_CONNECTIONS, G1_CONFIG, JIZO_CELLS, STROLLER_CONFIG, ELDERLY_CONFIG } = global.NanbuData;
  const { ROWS, COLS, MAX_DELAY_SEC } = BOARD_CONFIG;
  const { SoundEngine } = global.NanbuSound;
  const { SceneryRenderer, getSceneryModeAtPos, getStationSceneryMode, calcTrackPosition } = global.NanbuScenery;
  const Puzzle = global.NanbuPuzzle;
  const UI = global.NanbuUI;

  const sound = new SoundEngine();
  let el = null;
  let scenery = null;

  const state = {
    phase: 'TITLE', // TITLE | RUNNING | ALIGHTING | BOARDING | PAUSED | CLEAR | GAMEOVER
    prevPhaseBeforePause: 'RUNNING',
    direction: 'down',   // 'down' (川崎→立川) | 'up' (立川→川崎)
    step: 1,             // +1 (down) | -1 (up)
    courseKey: 'full',   // 'full' | 'trial' | 'rapid'
    odMode: 'balanced',  // バランス補正 (γ=0.75) に統一
    diffKey: 'normal',   // 'turtle' | 'easy' | 'normal' | 'recovery'
    doorJizo: false,     // 追加難易度：ドア前地蔵
    g1Event: false,      // 追加難易度：G1開催（府中本町乗降増）
    stroller: false,     // 追加難易度：ベビーカー（縦2マス固定・優先スペース配置）
    elderly: false,      // 追加難易度：御老人（座席未着席で減点・最大6人）

    routeStops: [],      // 停車駅インデックス配列
    currentStopPos: 0,   // routeStops 上の現在位置インデックス
    startStationIdx: 0,
    endStationIdx: 25,
    currentStationIdx: 0,
    runSchedule: new Map(), // stationIdx -> Passenger[]
    passengerLog: [],       // 実乗車乗客ログ { fromIdx, toIdx, isOriginTransfer, isJizo }

    grid: [],             // 5x8 の乗客オブジェクト or null
    nextPassengerUid: 1,
    nextStrollerGroupId: 1,

    timeRemaining: 11,
    timeTotal: 11,
    lastTickSec: 4,

    delaySec: 0,
    score: 0,
    totalAlighted: 0,
    smoothAlighted: 0,
    maxChain: 0,
    perfectStreak: 0,
    maxPerfectStreak: 0,
    g1Active: false,
    scoreBreakdown: null,

    // 操作状態
    selectedCell: null, // { r, c }
    dragging: false,
    dragCell: null,     // 現在の乗客位置 { r, c }
    dragDidSwap: false,
    activePointerId: null,
    capturingScreenshot: false,

    // 到達判定結果
    reachability: new Map(), // passengerUid -> boolean
    targetTotal: 0,
    targetOk: 0,
    targetBlocked: 0,
  };

  let pauseWaiters = [];

  function flushPauseWaiters() {
    if (pauseWaiters.length === 0) return;
    const waiters = pauseWaiters;
    pauseWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitIfPaused(myRunId) {
    while ((state.phase === 'PAUSED' || state.capturingScreenshot) && state.runId === myRunId) {
      await new Promise((resolve) => pauseWaiters.push(resolve));
    }
    return state.runId === myRunId;
  }

  async function pausableSleep(ms, myRunId) {
    let remaining = Math.max(0, ms);
    while (remaining > 0) {
      if (state.runId !== myRunId) return false;
      if (state.phase === 'PAUSED' || state.capturingScreenshot) {
        const ok = await waitIfPaused(myRunId);
        if (!ok) return false;
        continue;
      }
      const chunk = Math.min(remaining, 50);
      const t0 = performance.now();
      await sleep(chunk);
      if (state.runId !== myRunId) return false;
      if (state.phase === 'PAUSED' || state.capturingScreenshot) {
        const ok = await waitIfPaused(myRunId);
        if (!ok) return false;
      } else {
        remaining -= Math.min(remaining, performance.now() - t0);
      }
    }
    if (state.runId !== myRunId) return false;
    return waitIfPaused(myRunId);
  }

  function allocateUid() {
    return state.nextPassengerUid++;
  }

  function allocateStrollerGroupId() {
    return state.nextStrollerGroupId++;
  }

  function refreshReachability() {
    const nextIdx = UI.getNextStopIdx(state);
    const result = Puzzle.evaluateReachability(state.grid, nextIdx);
    state.reachability = result.reachability;
    state.targetTotal = result.total;
    state.targetOk = result.ok;
    state.targetBlocked = result.blocked;
    UI.updateReachabilityCounters(el, result.total, result.ok, result.blocked);
  }

  /* -------------------------------------------------------------------------
   * 乗客スワップ操作（ドラッグ連続スワップ＆タップ移動・ベビーカー縦2マス連動対応）
   * ------------------------------------------------------------------------- */
  function swapCells(r1, c1, r2, c2) {
    const tmp = state.grid[r1][c1];
    state.grid[r1][c1] = state.grid[r2][c2];
    state.grid[r2][c2] = tmp;

    sound.playSwap();
    refreshReachability();
    UI.renderGrid(el, state);
    UI.updateHUD(el, state);
  }

  /**
   * セル (fromR, fromC) の乗客（または縦2マスベビーカー）を (dr, dc) へ1歩移動する
   */
  function attemptStepMove(fromR, fromC, dr, dc) {
    const p = state.grid[fromR][fromC];
    if (!p || p.isJizo) return { moved: false };

    if (p.strollerGroupId) {
      const top = Puzzle.findStrollerTop(state.grid, fromR, fromC);
      if (!top) return { moved: false };
      const res = Puzzle.tryMoveStroller(state.grid, top.r, top.c, dr, dc);
      if (!res.moved) return { moved: false };
      sound.playSwap();
      refreshReachability();
      UI.renderGrid(el, state);
      UI.updateHUD(el, state);
      return { moved: true, newR: fromR + dr, newC: fromC + dc };
    }

    const nr = fromR + dr;
    const nc = fromC + dc;
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return { moved: false };
    const target = state.grid[nr][nc];
    if (target && target.isJizo) return { moved: false };

    // 通常客がベビーカーと縦方向にぶつかった場合は、ベビーカーを1マス逆方向へスライドさせてすり抜ける
    if (target && target.strollerGroupId) {
      if (dc !== 0) return { moved: false };
      const top = Puzzle.findStrollerTop(state.grid, nr, nc);
      if (!top) return { moved: false };
      const res = Puzzle.tryMoveStroller(state.grid, top.r, top.c, -dr, 0);
      if (!res.moved) return { moved: false };
      sound.playSwap();
      refreshReachability();
      UI.renderGrid(el, state);
      UI.updateHUD(el, state);
      return { moved: true, newR: fromR + dr * 2, newC: fromC };
    }

    swapCells(fromR, fromC, nr, nc);
    return { moved: true, newR: nr, newC: nc };
  }

  function setPhaseBadge(text, bgClass = 'bg-yellow-400') {
    if (!el || !el.lcdPhase) return;
    el.lcdPhase.textContent = text;
    el.lcdPhase.className = `font-sans text-[9.5px] sm:text-[10.5px] font-bold px-1.5 py-0.5 rounded ${bgClass} text-slate-950 leading-none shrink-0`;
  }

  function getGridCoordsFromPoint(clientX, clientY, clamp = false) {
    const rect = el.grid.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    if (!clamp && (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom)) {
      return null;
    }
    const c = Math.min(COLS - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * COLS)));
    const r = Math.min(ROWS - 1, Math.max(0, Math.floor(((clientY - rect.top) / rect.height) * ROWS)));
    return { r, c };
  }

  function releaseActivePointerCapture() {
    if (state.activePointerId !== null && el && el.grid) {
      try {
        if (el.grid.hasPointerCapture && el.grid.hasPointerCapture(state.activePointerId)) {
          el.grid.releasePointerCapture(state.activePointerId);
        }
      } catch (_) {
        // すでに解放済みの pointerId は無視
      }
    }
    state.activePointerId = null;
  }

  function bindGridPointerEvents() {
    el.grid.addEventListener('pointerdown', (e) => {
      if (state.capturingScreenshot) return;
      if (state.phase !== 'RUNNING') return;
      if (state.dragging || state.activePointerId !== null) return;
      sound.init();

      const pos = getGridCoordsFromPoint(e.clientX, e.clientY);
      if (!pos) return;

      const p = state.grid[pos.r][pos.c];

      // すでに選択中のセルがあり、隣接セルをクリック/タップした場合は即スワップ（地蔵は不可・ベビーカー対応）
      if (state.selectedCell) {
        const selR = state.selectedCell.r;
        const selC = state.selectedCell.c;
        const selP = state.grid[selR][selC];

        if (selP && selP.strollerGroupId) {
          // 同一ベビーカー上のセルを押した場合は即解除せず、そのままドラッグ開始フローへ進む
          if (!(p && p.strollerGroupId === selP.strollerGroupId)) {
            const top = Puzzle.findStrollerTop(state.grid, selR, selC);
            if (top) {
              const distTop = Math.abs(top.r - pos.r) + Math.abs(top.c - pos.c);
              const distBot = Math.abs(top.r + 1 - pos.r) + Math.abs(top.c - pos.c);
              if (distTop === 1 || distBot === 1) {
                const anchorR = distTop === 1 ? top.r : top.r + 1;
                const dr = pos.r - anchorR;
                const dc = pos.c - top.c;
                state.selectedCell = null;
                const moved = attemptStepMove(top.r, top.c, dr, dc);
                if (!moved.moved) {
                  UI.renderGrid(el, state);
                }
                return;
              }
            }
          }
        } else {
          const dist = Math.abs(selR - pos.r) + Math.abs(selC - pos.c);
          if (dist === 1) {
            const dr = pos.r - selR;
            const dc = pos.c - selC;
            // attemptStepMove 内で renderGrid されるため、先に選択解除して二重描画を防止
            state.selectedCell = null;
            const moved = attemptStepMove(selR, selC, dr, dc);
            if (!moved.moved) {
              UI.renderGrid(el, state);
            }
            return;
          }
        }
      }

      if (p && !p.isJizo) {
        state.activePointerId = e.pointerId;
        try {
          el.grid.setPointerCapture(e.pointerId);
        } catch (_) {
          // PointerCapture 非対応環境でも pointerId 照合は維持
        }
        state.dragging = true;
        state.dragCell = { r: pos.r, c: pos.c };
        state.dragDidSwap = false;
        UI.renderGrid(el, state);
      } else {
        state.selectedCell = null;
        UI.renderGrid(el, state);
      }
    });

    el.grid.addEventListener('pointermove', (e) => {
      if (state.capturingScreenshot) return;
      if (!state.dragging || !state.dragCell || state.phase !== 'RUNNING') return;
      if (state.activePointerId !== null && e.pointerId !== state.activePointerId) return;

      const pos = getGridCoordsFromPoint(e.clientX, e.clientY, true);
      if (!pos) return;

      // 素早いドラッグでも1歩ずつ隣接スワップして追従させる（ベビーカーは2セル領域基準で差分算出）
      let guard = 0;
      while (guard < 6) {
        guard++;
        const prevR = state.dragCell.r;
        const dragP = state.grid[state.dragCell.r][state.dragCell.c];
        if (!dragP) break;

        let dr = 0;
        let dc = 0;
        if (dragP.strollerGroupId) {
          const top = Puzzle.findStrollerTop(state.grid, state.dragCell.r, state.dragCell.c);
          if (!top) break;
          dr = pos.r < top.r ? pos.r - top.r : (pos.r > top.r + 1 ? pos.r - (top.r + 1) : 0);
          dc = pos.c - top.c;
        } else {
          dr = pos.r - state.dragCell.r;
          dc = pos.c - state.dragCell.c;
        }

        if (dr === 0 && dc === 0) break;

        let stepR = 0;
        let stepC = 0;
        let fbR = 0;
        let fbC = 0;

        if (Math.abs(dr) >= Math.abs(dc)) {
          stepR = Math.sign(dr);
          if (dc !== 0) fbC = Math.sign(dc);
        } else {
          stepC = Math.sign(dc);
          if (dr !== 0) fbR = Math.sign(dr);
        }

        let moved = attemptStepMove(state.dragCell.r, state.dragCell.c, stepR, stepC);
        if (!moved.moved && (fbR !== 0 || fbC !== 0)) {
          moved = attemptStepMove(state.dragCell.r, state.dragCell.c, fbR, fbC);
        }
        if (!moved.moved) {
          break;
        }

        state.dragCell = { r: moved.newR, c: moved.newC };
        state.dragDidSwap = true;
        state.selectedCell = null;

        // 通常客のベビーカー縦すり抜け（2マス移動）でポインタ位置を飛び越えた場合は、往復振動しないようここで終了
        if (!dragP.strollerGroupId && Math.abs(moved.newR - prevR) >= 2) {
          break;
        }
      }
    });

    const endDrag = (e) => {
      if (state.activePointerId !== null && e && e.pointerId !== state.activePointerId) return;
      releaseActivePointerCapture();
      if (!state.dragging) return;
      const currentCell = state.dragCell;
      const didSwap = state.dragDidSwap;

      state.dragging = false;
      state.dragCell = null;

      if (!didSwap && currentCell) {
        // ドラッグせずに離した → タップ選択のトグル（同一セルまたは同一ベビーカーなら選択解除）
        const sel = state.selectedCell;
        const selP = sel ? state.grid[sel.r][sel.c] : null;
        const curP = state.grid[currentCell.r][currentCell.c];
        const isSameCell = sel && sel.r === currentCell.r && sel.c === currentCell.c;
        const isSameStroller =
          selP && curP && selP.strollerGroupId && selP.strollerGroupId === curP.strollerGroupId;
        if (isSameCell || isSameStroller) {
          state.selectedCell = null;
        } else {
          state.selectedCell = { r: currentCell.r, c: currentCell.c };
        }
      }
      UI.renderGrid(el, state);
    };

    el.grid.addEventListener('pointerup', endDrag);
    el.grid.addEventListener('pointercancel', endDrag);
  }

  /* -------------------------------------------------------------------------
   * ゲーム進行フロー（開始 → 走行 → 到着・降車 → 乗車 → 次区間）
   * ------------------------------------------------------------------------- */
  async function showTransferBanner(title, text, sub, durationMs, myRunId) {
    if (!el.modalTransferBanner) return true;
    if (el.transferBannerTitle) el.transferBannerTitle.textContent = title;
    if (el.transferBannerText) el.transferBannerText.textContent = text;
    if (el.transferBannerSub) {
      el.transferBannerSub.textContent = sub || '';
      el.transferBannerSub.classList.toggle('hidden', !sub);
    }
    el.modalTransferBanner.classList.remove('hidden');
    if (!(await pausableSleep(durationMs, myRunId))) return false;
    el.modalTransferBanner.classList.add('hidden');
    return true;
  }

  function recordBoardedPassengers(passengers, boardedUids) {
    if (!passengers || !boardedUids || boardedUids.size === 0) return;
    for (const p of passengers) {
      if (boardedUids.has(p.uid)) {
        state.passengerLog.push({
          fromIdx: p.boardedAt,
          toIdx: p.destIdx,
          isOriginTransfer: !!p.isOriginTransfer,
          isJizo: !!p.isJizo,
        });
      }
    }
  }

  async function startGame() {
    if (state.phase === 'STARTING') return;
    sound.init();
    const myRunId = (state.runId || 0) + 1;
    state.runId = myRunId;
    state.phase = 'STARTING';
    flushPauseWaiters();
    if (el.fxLayer) el.fxLayer.innerHTML = '';
    if (el.modalDeparture) el.modalDeparture.classList.add('hidden');
    if (el.doorsContainer) el.doorsContainer.classList.remove('doors-open');

    const dir = DIRECTIONS[state.direction] || DIRECTIONS.down;
    state.step = dir.step;

    state.grid = Puzzle.createEmptyGrid();
    state.nextPassengerUid = 1;
    state.nextStrollerGroupId = 1;
    state.delaySec = 0;
    state.score = 0;
    state.totalAlighted = 0;
    state.smoothAlighted = 0;
    state.maxChain = 0;
    state.perfectStreak = 0;
    state.maxPerfectStreak = 0;
    state.selectedCell = null;
    state.dragging = false;
    state.dragCell = null;
    state.passengerLog = [];
    state.scoreBreakdown = {
      smoothBase: 0,
      streakExtra: 0,
      chainBonus: 0,
      fastForward: 0,
      seatBonus: 0,
      onTimeBonus: 0,
      strollerPenalty: 0,
      elderlyPenalty: 0,
      baseScore: 0,
      finalScore: 0,
      multInfo: null,
    };

    // 1運行ぶんの全停車駅乗客スケジュールを第13回実ODから事前生成（快速・緩急接続・G1開催・ドア前地蔵対応）
    const generated = Puzzle.generateRunSchedule(
      state.courseKey,
      state.direction,
      state.odMode,
      state.diffKey,
      allocateUid,
      { doorJizo: state.doorJizo, g1Event: state.g1Event }
    );
    state.routeStops = generated.routeStops;
    state.runSchedule = generated.schedule;
    state.g1Active = !!generated.g1Active;
    const originTransferPassengers = generated.originTransferPassengers || [];
    state.currentStopPos = 0;
    state.startStationIdx = state.routeStops[0];
    state.endStationIdx = state.routeStops[state.routeStops.length - 1];
    state.currentStationIdx = state.startStationIdx;

    const boardedUids = new Set();

    // ドア前地蔵ON時：左右の乗降口に1人ずつ、終点まで移動不可の乗客を配置
    if (state.doorJizo) {
      const jizoList = [];
      for (const spot of JIZO_CELLS) {
        const jizo = {
          uid: allocateUid(),
          destIdx: state.endStationIdx,
          boardedAt: state.startStationIdx,
          isJizo: true,
        };
        state.grid[spot.r][spot.c] = jizo;
        boardedUids.add(jizo.uid);
        jizoList.push(jizo);
      }
      recordBoardedPassengers(jizoList, boardedUids);
    }

    // 始発駅の通常乗客（＋ベビーカー・御老人）を配置
    const initialPassengers = state.runSchedule.get(state.startStationIdx) || [];
    const res = Puzzle.placePassengersIntoCar(state.grid, initialPassengers, {
      strollerEnabled: state.stroller,
      elderlyEnabled: state.elderly,
      allocateStrollerGroupId,
    });
    res.boardedUids.forEach((uid) => boardedUids.add(uid));
    recordBoardedPassengers(initialPassengers, res.boardedUids);

    // 背景にぼかし表示するゲーム画面を先に描画しておく
    const firstNextIdx = UI.getNextStopIdx(state);
    const firstLeg = Puzzle.getLegInfo(state.currentStationIdx, firstNextIdx);
    const firstDiff = DIFFICULTIES[state.diffKey];
    state.timeTotal = Math.max(3.5, +(firstLeg.time * firstDiff.timeMult).toFixed(1));
    state.timeRemaining = state.timeTotal;

    el.modalTitle.classList.add('hidden');
    el.modalPause.classList.add('hidden');
    el.modalResult.classList.add('hidden');
    if (el.modalResultDetail) el.modalResultDetail.classList.add('hidden');
    if (el.modalTransferBanner) el.modalTransferBanner.classList.add('hidden');
    el.doorsContainer.classList.remove('doors-open');
    releaseActivePointerCapture();

    const isNightCourse = Boolean(COURSES[state.courseKey] && COURSES[state.courseKey].isNight);
    scenery.setNight(isNightCourse);
    scenery.setMode(false, getStationSceneryMode(state.startStationIdx, state.step));
    UI.syncCarLayout(el);
    scenery.resize();

    // 1.5秒ワンクッション演出（「発駅　行き先」＋「出発進行」）
    const playDepartureCushion = async () => {
      state.phase = 'STARTING';
      setPhaseBadge('発車準備', 'bg-yellow-400');
      el.announceText.textContent = UI.formatRunningAnnounce(STATIONS[firstNextIdx], state);
      refreshReachability();
      UI.renderGrid(el, state, new Set());
      UI.updateHUD(el, state);
      UI.updateTimerUI(el, state);

      if (!el.modalDeparture) return true;
      const startName = STATIONS[state.startStationIdx].name;
      const endName = STATIONS[state.endStationIdx].name;
      if (el.departureRoute) {
        el.departureRoute.textContent = `${startName}発　${endName}行`;
      }
      if (el.departureType) {
        const isRapid = Puzzle.isRapidCourse(state.courseKey);
        let badgeText = isRapid ? '快速' : '各駅停車';
        if (state.courseKey === 'rapid_inagi') badgeText = '快速（立川行連絡）';
        else if (state.courseKey === 'rapid_noborito') badgeText = '快速（立川発各停連絡）';
        else if (state.courseKey === 'tachikawa_nakahara') badgeText = '各駅停車（終電間際）';
        else if (state.courseKey === 'nishikunitachi') badgeText = '各駅停車（朝ラッシュ）';
        el.departureType.textContent = badgeText;
        el.departureType.className = isRapid
          ? 'px-3 py-1 rounded-md text-xs sm:text-sm font-black tracking-widest bg-rose-600 text-white shadow'
          : 'px-3 py-1 rounded-md text-xs sm:text-sm font-black tracking-widest bg-yellow-400 text-slate-950 shadow';
      }
      el.modalDeparture.classList.remove('hidden');
      const popEl = el.modalDeparture.querySelector('.departure-pop');
      if (popEl) {
        popEl.classList.remove('departure-pop');
        void popEl.offsetWidth;
        popEl.classList.add('departure-pop');
      }
      sound.playDeparture();
      if (!(await pausableSleep(1500, myRunId))) return false;
      if (state.phase !== 'STARTING') return false;
      el.modalDeparture.classList.add('hidden');
      return true;
    };

    // 登戸発 快速 川崎行の特殊演出：
    // ① 始発・登戸停車中（ドア開・LCD「登戸」・登戸固有客のみ1回ポップイン）
    // ②「立川からの各駅停車が到着！　乗継客が乗車……」バナー（3秒）
    // ③ 乗継客が車内へ湧き込む → ④ ドア閉め → ⑤「出発進行」1.5秒演出 → ⑥ 走行開始
    if (state.courseKey === 'rapid_noborito' && originTransferPassengers.length > 0) {
      state.phase = 'BOARDING';
      el.doorsContainer.classList.add('doors-open');
      setPhaseBadge('接続待ち', 'bg-sky-400');
      el.announceText.textContent = '登戸 停車中 — 立川からの各駅停車の到着を待っています...';
      refreshReachability();
      UI.renderGrid(el, state, boardedUids);
      UI.updateHUD(el, state);
      UI.updateTimerUI(el, state);

      if (!(await pausableSleep(550, myRunId))) return;

      // 「立川からの各駅停車が到着！　乗継客が乗車……」を3秒表示
      setPhaseBadge('各停到着', 'bg-amber-400');
      el.announceText.textContent = '🚃 立川からの各駅停車が到着！　乗継客が乗車……';
      sound.playDoorChime();

      const bannerDone = await showTransferBanner(
        '🚃 登戸駅 緩急接続',
        '立川からの各駅停車が到着！　乗継客が乗車……',
        '',
        3000,
        myRunId
      );
      if (!bannerDone) return;

      // その後で連絡客が乗り継いで車内へ湧く（実乗車数を確定してからアナウンス・表示を同期）
      const transferRes = Puzzle.placePassengersIntoCar(state.grid, originTransferPassengers, {
        strollerEnabled: state.stroller,
        elderlyEnabled: state.elderly,
        allocateStrollerGroupId,
      });
      recordBoardedPassengers(originTransferPassengers, transferRes.boardedUids);

      setPhaseBadge('連絡乗継', 'bg-amber-400');
      el.announceText.textContent = `🚃 立川方面からの乗継客 +${transferRes.boardedCount}人が乗り継ぎました！`;

      refreshReachability();
      UI.renderGrid(el, state, transferRes.boardedUids);
      UI.updateHUD(el, state);
      UI.spawnFloatText(
        el,
        `各停から連絡乗継 +${transferRes.boardedCount}人！`,
        2,
        3.5,
        'text-amber-300',
        'text-sm sm:text-base'
      );

      if (!(await pausableSleep(1000, myRunId))) return;

      el.doorsContainer.classList.remove('doors-open');
      if (!(await pausableSleep(380, myRunId))) return;

      const okToDepart = await playDepartureCushion();
      if (!okToDepart) return;

      beginRunningLeg(0, new Set());
      return;
    }

    const okToDepart = await playDepartureCushion();
    if (!okToDepart) return;

    beginRunningLeg(0, boardedUids);
  }

  function syncRunningScenery() {
    if (!scenery) return;
    const nextIdx = UI.getNextStopIdx(state);
    // 到着フレームで progress=1 が次区間（南多摩停車中の多摩川鉄橋など）へ踏み越えないよう 0.999 上限にクランプ
    const progress = state.timeTotal > 0
      ? Math.max(0, Math.min(0.999, 1 - state.timeRemaining / state.timeTotal))
      : 0;
    const pos = calcTrackPosition(STATIONS, state.currentStationIdx, nextIdx, progress);
    const dir = nextIdx >= state.currentStationIdx ? 1 : -1;
    scenery.setMode(true, getSceneryModeAtPos(pos, dir));
  }

  function beginRunningLeg(stopPos, newlyBoardedUids = new Set()) {
    state.currentStopPos = stopPos;
    state.currentStationIdx = state.routeStops[stopPos];
    state.phase = 'RUNNING';
    state.selectedCell = null;
    state.dragging = false;

    const nextIdx = UI.getNextStopIdx(state);
    const leg = Puzzle.getLegInfo(state.currentStationIdx, nextIdx);
    const nextSt = STATIONS[nextIdx];
    const diff = DIFFICULTIES[state.diffKey];

    state.timeTotal = Math.max(3.5, +(leg.time * diff.timeMult).toFixed(1));
    state.timeRemaining = state.timeTotal;
    state.lastTickSec = 4;

    setPhaseBadge('走行中', 'bg-yellow-400');
    el.announceText.textContent = UI.formatRunningAnnounce(nextSt, state);

    syncRunningScenery();

    refreshReachability();
    UI.renderGrid(el, state, newlyBoardedUids);
    UI.updateHUD(el, state);
    UI.updateTimerUI(el, state);
  }

  async function triggerArrival(fastForwarded = false) {
    if (state.phase !== 'RUNNING') return;
    const myRunId = state.runId;
    state.phase = 'ALIGHTING';
    state.dragging = false;
    state.dragCell = null;
    state.selectedCell = null;
    releaseActivePointerCapture();
    el.btnFF.disabled = true;

    // 早送り定時ボーナス＆遅延回復
    if (fastForwarded) {
      sound.playFastForward();
      const recov = Puzzle.calcFastForwardRecovery(state.delaySec, state.timeRemaining);
      const timeBonus = Math.round(state.timeRemaining * 35);
      if (timeBonus > 0) {
        state.score += timeBonus;
        state.scoreBreakdown.fastForward += timeBonus;
        UI.spawnFloatText(el, `早送り +${timeBonus}pt`, 2, 3.5, 'text-sky-300', 'text-sm sm:text-base');
      }
      if (recov > 0) {
        state.delaySec = Math.max(0, state.delaySec - recov);
        UI.spawnFloatText(el, `定時回復 -${recov}秒`, 1, 3.5, 'text-emerald-300', 'text-sm sm:text-base');
      }
    }

    // 早送り到着時も含め、停車時点でタイマー表示を 0.0s へ確定させる
    state.timeRemaining = 0;
    UI.updateTimerUI(el, state);

    const arrivalStopPos = Math.min(state.currentStopPos + 1, state.routeStops.length - 1);
    const arrivalIdx = state.routeStops[arrivalStopPos];
    const arrivalSt = STATIONS[arrivalIdx];

    // 停車＆ドア開アニメーション（駅ホームに合わせた車窓へ同期し、鉄橋上での停車を防止）
    scenery.setMode(false, getStationSceneryMode(arrivalIdx, state.step));
    setPhaseBadge('停車中', 'bg-emerald-400');
    el.announceText.textContent = UI.formatArrivalAnnounce(arrivalSt, state);

    sound.playDoorChime();
    el.doorsContainer.classList.add('doors-open');
    refreshReachability();
    UI.renderGrid(el, state);
    UI.updateHUD(el, state);

    if (!(await pausableSleep(450, myRunId))) return;

    // 川崎発快速立川行（稲城長沼）・立川発快速川崎行（登戸）の各駅停車連絡バナー（シンプル表示）
    if (state.courseKey === 'rapid') {
      const conn = state.direction === 'down' ? RAPID_CONNECTIONS.down : RAPID_CONNECTIONS.up;
      if (conn && arrivalIdx === conn.transferStationIdx) {
        const bannerDone = await showTransferBanner(
          `🚃 ${arrivalSt.name}駅`,
          '各駅停車に連絡',
          '',
          1600,
          myRunId
        );
        if (!bannerDone) return;
      }
    }

    // 降車客を「OK（ドア近い順）」と「!詰」に仕分け（ベビーカーは上下2マスを1ユニットに統合済み）
    const { okTargets, blockedTargets } = Puzzle.partitionAlightingTargets(
      state.grid,
      arrivalIdx,
      state.reachability
    );

    // 連続ノー詰まり駅コンボ判定（!詰ありでリセット、降車客あり＆!詰ゼロで加算、降車客0人駅は現状維持）
    if (blockedTargets.length > 0) {
      state.perfectStreak = 0;
    } else if (okTargets.length > 0) {
      state.perfectStreak++;
      if (state.perfectStreak > state.maxPerfectStreak) {
        state.maxPerfectStreak = state.perfectStreak;
      }
    }
    const streakMult = state.perfectStreak > 0
      ? Math.min(2.0, +(1.0 + (state.perfectStreak - 1) * 0.1).toFixed(1))
      : 1.0;

    // ① スムーズ降車フラッシュ連鎖（ベビーカーは上下2マス同時消去・乗客カウントおよび基礎スコアは2人分として統一）
    if (okTargets.length > 0) {
      const okHeadcount = okTargets.reduce((sum, u) => sum + (u.cells ? u.cells.length : 1), 0);
      if (okHeadcount > state.maxChain) state.maxChain = okHeadcount;
      for (let i = 0; i < okTargets.length; i++) {
        const unit = okTargets[i];
        const unitCells = unit.cells || [{ r: unit.r, c: unit.c, p: unit.p }];
        const unitCount = unitCells.length;
        for (const cell of unitCells) {
          const cellEl = UI.getCellEl(el, cell.r, cell.c);
          const tok = cellEl.querySelector('.passenger');
          if (tok) tok.classList.add('anim-alight-ok');
        }

        sound.playAlightChain(i);
        const basePts = (120 + i * 40) * unitCount;
        const pts = Math.round(basePts * streakMult);
        state.score += pts;
        state.scoreBreakdown.smoothBase += basePts;
        state.scoreBreakdown.streakExtra += pts - basePts;
        state.totalAlighted += unitCount;
        state.smoothAlighted += unitCount;

        UI.spawnFloatText(el, `+${pts}`, unit.r, unit.c, 'text-emerald-300', 'text-xs sm:text-sm');
        UI.updateHUD(el, state);
        if (!(await pausableSleep(110, myRunId))) return;
        for (const cell of unitCells) {
          state.grid[cell.r][cell.c] = null;
        }
      }
      if (okHeadcount >= 3) {
        const baseChain = okHeadcount * 100;
        const chainBonus = Math.round(baseChain * streakMult);
        state.score += chainBonus;
        state.scoreBreakdown.chainBonus += baseChain;
        state.scoreBreakdown.streakExtra += chainBonus - baseChain;
        UI.spawnFloatText(el, `✨ ${okHeadcount}人一気降車! +${chainBonus}`, 2, 3.5, 'text-yellow-300', 'text-base sm:text-lg');
      }
      if (state.perfectStreak >= 2 && streakMult > 1.0) {
        UI.spawnFloatText(el, `🔥 ${state.perfectStreak}駅連続! (×${streakMult.toFixed(1)})`, 1, 3.5, 'text-amber-300', 'text-xs sm:text-sm');
      }
      if (!(await pausableSleep(220, myRunId))) return;
      UI.renderGrid(el, state);
    }

    // ② かき分け降車（塞がれていた降車客 → 遅延ペナルティ・ベビーカーは1台+5秒のまま・乗客カウントは2人分として統一）
    if (blockedTargets.length > 0) {
      for (const unit of blockedTargets) {
        const unitCells = unit.cells || [{ r: unit.r, c: unit.c, p: unit.p }];
        const unitCount = unitCells.length;
        for (const cell of unitCells) {
          const cellEl = UI.getCellEl(el, cell.r, cell.c);
          const tok = cellEl.querySelector('.passenger');
          if (tok) tok.classList.add('anim-alight-blocked');
        }

        const pen = 5;
        state.delaySec += pen;
        state.totalAlighted += unitCount;

        sound.playDelayAlert();
        UI.triggerShake(el);
        UI.spawnFloatText(el, `詰まり +${pen}秒`, unit.r, unit.c, 'text-rose-400', 'text-xs sm:text-sm');
        UI.updateHUD(el, state);
        if (!(await pausableSleep(260, myRunId))) return;
        for (const cell of unitCells) {
          state.grid[cell.r][cell.c] = null;
        }
      }
      if (!(await pausableSleep(280, myRunId))) return;
      UI.renderGrid(el, state);
    }

    // 座席ボーナス（座席に座って乗り越した乗客1人につき +20pt）
    const isFinalStation = arrivalStopPos >= state.routeStops.length - 1;
    const seatedCount = Puzzle.countSeatedPassengers(state.grid);
    if (seatedCount > 0 && !isFinalStation) {
      const seatPts = seatedCount * 20;
      state.score += seatPts;
      state.scoreBreakdown.seatBonus += seatPts;
    }

    // ベビーカー優先スペース判定 ＆ 御老人座席判定（降車・座席ボーナス加算後に残存対象者を判定）
    const activeStrollers = Puzzle.getActiveStrollers(state.grid);
    const misplacedStrollers = activeStrollers.filter((s) => !s.inPriority);
    const activeElderly = Puzzle.getActiveElderly(state.grid);
    const standingElderly = activeElderly.filter((e) => !e.inSeat);

    if (misplacedStrollers.length > 0 || standingElderly.length > 0) {
      if (misplacedStrollers.length > 0) {
        const pen = STROLLER_CONFIG.penaltyPerStation;
        for (const s of misplacedStrollers) {
          const actualPen = Math.min(state.score, pen);
          state.score -= actualPen;
          state.scoreBreakdown.strollerPenalty += actualPen;
          const msg = actualPen > 0 ? `👶優先外 -${actualPen}pt` : '👶優先外!';
          UI.spawnFloatText(el, msg, s.topR, s.topC, 'text-pink-300', 'text-xs sm:text-sm');
        }
      }
      if (standingElderly.length > 0) {
        const pen = ELDERLY_CONFIG.penaltyPerStation;
        for (const e of standingElderly) {
          const actualPen = Math.min(state.score, pen);
          state.score -= actualPen;
          state.scoreBreakdown.elderlyPenalty += actualPen;
          const msg = actualPen > 0 ? `👴席外 -${actualPen}pt` : '👴席外!';
          UI.spawnFloatText(el, msg, e.r, e.c, 'text-sky-300', 'text-xs sm:text-sm');
        }
      }
      sound.playDelayAlert();
      UI.updateHUD(el, state);
      if (!(await pausableSleep(220, myRunId))) return;
    }

    UI.updateHUD(el, state);

    // 遅延上限オーバー判定
    if (state.delaySec > MAX_DELAY_SEC) {
      showResult(false);
      return;
    }

    // 終点到達クリア判定
    if (isFinalStation) {
      if (!(await pausableSleep(350, myRunId))) return;
      showResult(true);
      return;
    }

    // ③ 乗車フェーズ（事前生成スケジュールから取得・ベビーカー・御老人対応）
    state.phase = 'BOARDING';
    const incoming = state.runSchedule.get(arrivalIdx) || [];
    const { boardedCount, leftBehind, boardedUids } = Puzzle.placePassengersIntoCar(state.grid, incoming, {
      strollerEnabled: state.stroller,
      elderlyEnabled: state.elderly,
      allocateStrollerGroupId,
    });
    recordBoardedPassengers(incoming, boardedUids);

    if (boardedCount > 0) {
      UI.renderGrid(el, state, boardedUids);
      UI.updateHUD(el, state);
      if (!(await pausableSleep(420, myRunId))) return;
    }

    // 万一の満員積み残しガード
    if (leftBehind > 0) {
      const overflowPen = leftBehind * 15;
      state.delaySec += overflowPen;
      sound.playDelayAlert();
      UI.triggerShake(el);
      UI.spawnFloatText(el, `満員積み残し ${leftBehind}人! +${overflowPen}秒`, 3, 3.5, 'text-rose-500', 'text-sm sm:text-base');
      UI.updateHUD(el, state);
      if (!(await pausableSleep(650, myRunId))) return;

      if (state.delaySec > MAX_DELAY_SEC) {
        showResult(false);
        return;
      }
    }

    // ドア閉め → 次区間出発
    el.doorsContainer.classList.remove('doors-open');
    if (!(await pausableSleep(420, myRunId))) return;

    beginRunningLeg(arrivalStopPos, new Set());
  }

  function showResult(isClear) {
    state.phase = isClear ? 'CLEAR' : 'GAMEOVER';
    scenery.setMode(false);

    // 完走定時ボーナス加算 → 難易度＆追加難易度倍率を適用して最終スコア確定
    const onTimeBonus = Puzzle.calcOnTimeBonus(state.delaySec, isClear);
    state.score += onTimeBonus;
    state.scoreBreakdown.onTimeBonus = onTimeBonus;

    const multInfo = Puzzle.calcScoreMultiplier(state.diffKey, {
      doorJizo: state.doorJizo,
      g1Active: state.g1Active,
      stroller: state.stroller,
      elderly: state.elderly,
    });
    const baseScore = state.score;
    const finalScore = Math.round(baseScore * multInfo.totalMult);
    state.score = finalScore;
    state.scoreBreakdown.baseScore = baseScore;
    state.scoreBreakdown.finalScore = finalScore;
    state.scoreBreakdown.multInfo = multInfo;
    UI.updateHUD(el, state);

    if (isClear) {
      sound.playClearFanfare();
    } else {
      sound.playGameOver();
    }

    UI.renderResultModal(el, state, isClear);
  }

  /* -------------------------------------------------------------------------
   * メインアニメーションループ（車窓描画 ＆ カウントダウン）
   * ------------------------------------------------------------------------- */
  let lastFrameTime = performance.now();

  function gameLoop(now) {
    const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    scenery.update(dt);

    if (state.phase === 'RUNNING' && !state.capturingScreenshot) {
      state.timeRemaining -= dt;
      syncRunningScenery();

      // 残り3秒カウントダウンビープ
      const ceilSec = Math.ceil(state.timeRemaining);
      if (ceilSec <= 3 && ceilSec >= 1 && ceilSec < state.lastTickSec) {
        state.lastTickSec = ceilSec;
        sound.playTick();
      }

      if (state.timeRemaining <= 0) {
        state.timeRemaining = 0;
        UI.updateTimerUI(el, state);
        triggerArrival(false);
      } else {
        UI.updateTimerUI(el, state);
        UI.updateFastForwardHint(el, state);
      }
    }

    requestAnimationFrame(gameLoop);
  }

  /* -------------------------------------------------------------------------
   * UIイベントバインド
   * ------------------------------------------------------------------------- */
  function bindUIEvents() {
    // 列車・区間選択（下り / 上り・LED行先表示器風）
    const getModifierBlockMessage = (modKey, courseKey) => {
      const isMorningRush = courseKey === 'nishikunitachi';
      const isNight = Boolean(COURSES[courseKey] && COURSES[courseKey].isNight);
      if (modKey === 'g1Event') {
        if (isMorningRush || isNight) {
          return 'この組み合わせでは遊べません';
        }
        const stops = Puzzle.getRouteStops(courseKey, state.direction);
        if (!stops.includes(G1_CONFIG.stationIdx)) {
          return 'この列車は府中本町に停車しません';
        }
      }
      if ((modKey === 'elderly' || modKey === 'stroller') && isMorningRush) {
        return '容赦ない南武線の朝ラッシュ、とても乗れません';
      }
      return null;
    };

    let toastTimer = null;
    const showToast = (msg, variant = 'success') => {
      if (!el.screenshotToast) return;
      el.screenshotToast.textContent = msg;
      el.screenshotToast.className =
        variant === 'warning'
          ? 'absolute top-14 right-3 z-[95] max-w-[calc(100%-1.5rem)] px-3 py-2 rounded-lg bg-slate-950/95 border-2 border-rose-500 text-rose-200 text-xs font-black shadow-xl pointer-events-none break-words'
          : 'absolute top-14 right-3 z-[95] max-w-[calc(100%-1.5rem)] px-3 py-1.5 rounded-lg bg-slate-950/95 border border-emerald-400/70 text-emerald-300 text-xs font-black shadow-xl pointer-events-none break-words';
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        el.screenshotToast.classList.add('hidden');
      }, variant === 'warning' ? 2800 : 2200);
    };

    const refreshModifierButtons = () => {
      document.querySelectorAll('.modifier-opt').forEach((btn) => {
        const key = btn.dataset.mod;
        const active = !!state[key];
        btn.className = `modifier-opt relative w-full min-w-0 flex flex-col items-center justify-center gap-1 py-2.5 px-1.5 rounded-xl border-2 text-center transition ${
          active ? 'border-amber-400 bg-amber-400/15' : 'border-slate-700 bg-slate-800/70 hover:border-slate-500'
        }`;
        const badge = btn.querySelector('.mod-state');
        if (badge) {
          badge.textContent = active ? 'ON' : 'OFF';
          badge.className = active
            ? 'mod-state absolute top-1 right-1 w-7 text-center text-[8px] py-0.5 rounded bg-amber-400 text-slate-950 font-black leading-none'
            : 'mod-state absolute top-1 right-1 w-7 text-center text-[8px] py-0.5 rounded bg-slate-700 text-slate-300 font-bold leading-none';
        }
      });
      if (el.modActiveBadge) {
        const count = [state.doorJizo, state.g1Event, state.stroller, state.elderly].filter(Boolean).length;
        el.modActiveBadge.textContent = `ON: ${count}`;
        el.modActiveBadge.classList.toggle('hidden', count === 0);
      }
    };

    document.querySelectorAll('.route-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.direction = btn.dataset.dir;
        state.step = (DIRECTIONS[state.direction] || DIRECTIONS.down).step;
        state.courseKey = btn.dataset.course;
        document.querySelectorAll('.route-opt').forEach((b) => {
          b.classList.toggle('is-active', b === btn);
        });

        // 選択した列車と組み合わせ不可の追加難易度がONだった場合は自動OFFにしてまとめて通知
        const modLabels = { g1Event: 'G1開催', stroller: 'ベビーカー', elderly: '御老人' };
        const disabledMods = [];
        ['g1Event', 'stroller', 'elderly'].forEach((modKey) => {
          if (state[modKey]) {
            const msg = getModifierBlockMessage(modKey, state.courseKey);
            if (msg) {
              state[modKey] = false;
              disabledMods.push({ key: modKey, label: modLabels[modKey] || modKey, msg });
            }
          }
        });
        refreshModifierButtons();
        if (disabledMods.length > 0) {
          sound.playDelayAlert();
          if (disabledMods.length === 1) {
            showToast(`⚠️ ${disabledMods[0].msg}（${disabledMods[0].label}をOFF）`, 'warning');
          } else {
            const names = disabledMods.map((d) => d.label).join('・');
            showToast(`⚠️ この列車では選択不可のため「${names}」をOFFにしました`, 'warning');
          }
        }
      });
    });

    // 「他の行き先を見る」トグル（下り / 上り）
    // 閉じた枠内の追加列車が選択中だった場合は、該当方向の標準列車（full）へ自動復帰
    const setupMoreToggle = (btn, container, dirKey) => {
      if (!btn || !container) return;
      btn.addEventListener('click', () => {
        const isHidden = container.classList.toggle('hidden');
        btn.textContent = isHidden ? '他の行き先を見る ▾' : '閉じる ▴';
        if (isHidden && container.querySelector('.route-opt.is-active')) {
          const fallbackBtn = document.querySelector(`.route-opt[data-dir="${dirKey}"][data-course="full"]`);
          if (fallbackBtn) fallbackBtn.click();
        }
      });
    };
    setupMoreToggle(el.btnToggleMoreDown, el.moreRoutesDown, 'down');
    setupMoreToggle(el.btnToggleMoreUp, el.moreRoutesUp, 'up');

    // 難易度選択（亀 / のんびり / 標準ダイヤ / 回復運転）
    const refreshDiffButtons = () => {
      document.querySelectorAll('.diff-opt').forEach((b) => {
        const active = b.dataset.diff === state.diffKey;
        b.className = `diff-opt p-2 rounded-xl border-2 text-center transition ${
          active ? 'border-yellow-400 bg-yellow-400/15' : 'border-slate-700 bg-slate-800/70 hover:border-slate-500'
        }`;
      });
    };

    document.querySelectorAll('.diff-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.diffKey = btn.dataset.diff;
        refreshDiffButtons();
      });
    });

    // 追加難易度設定トグル（ドア前地蔵 / G1開催 / ベビーカー / 御老人）＆折り畳み制御
    if (el.btnToggleMod && el.modifierGrid) {
      el.btnToggleMod.addEventListener('click', () => {
        const isHidden = el.modifierGrid.classList.toggle('hidden');
        el.btnToggleMod.textContent = isHidden ? '開く ▾' : '閉じる ▴';
      });
    }

    document.querySelectorAll('.modifier-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.mod;
        if (!state[key]) {
          const blockMsg = getModifierBlockMessage(key, state.courseKey);
          if (blockMsg) {
            sound.playDelayAlert();
            showToast(`⚠️ ${blockMsg}`, 'warning');
            return;
          }
        }
        state[key] = !state[key];
        refreshModifierButtons();
      });
    });

    // 追加難易度「詳細」モーダル ＆「遊び方」モーダル
    if (el.btnOpenModHelp && el.modalModHelp) {
      el.btnOpenModHelp.addEventListener('click', () => el.modalModHelp.classList.remove('hidden'));
    }
    if (el.btnCloseModHelp && el.modalModHelp) {
      el.btnCloseModHelp.addEventListener('click', () => el.modalModHelp.classList.add('hidden'));
    }
    if (el.btnOpenHowto && el.modalHowto) {
      el.btnOpenHowto.addEventListener('click', () => el.modalHowto.classList.remove('hidden'));
    }
    if (el.btnCloseHowto && el.modalHowto) {
      el.btnCloseHowto.addEventListener('click', () => el.modalHowto.classList.add('hidden'));
    }
    if (el.btnOpenAbout && el.modalAbout) {
      el.btnOpenAbout.addEventListener('click', () => el.modalAbout.classList.remove('hidden'));
    }
    if (el.btnCloseAbout && el.modalAbout) {
      el.btnCloseAbout.addEventListener('click', () => el.modalAbout.classList.add('hidden'));
    }

    // ゲーム開始
    el.btnStartGame.addEventListener('click', startGame);

    // 早送り
    el.btnFF.addEventListener('click', () => {
      if (state.capturingScreenshot) return;
      if (state.phase === 'RUNNING') {
        triggerArrival(true);
      }
    });

    // ミュート切替
    el.btnMute.addEventListener('click', () => {
      sound.muted = !sound.muted;
      el.btnMute.textContent = sound.muted ? '🔇' : '🔊';
      if (!sound.muted) sound.init();
    });

    // 一時停止（RUNNING / ALIGHTING / BOARDING 中に安全にメニューを開ける）
    el.btnPause.addEventListener('click', () => {
      if (state.capturingScreenshot) return;
      if (
        state.phase === 'RUNNING' ||
        state.phase === 'ALIGHTING' ||
        state.phase === 'BOARDING'
      ) {
        state.prevPhaseBeforePause = state.phase;
        state.phase = 'PAUSED';
        state.selectedCell = null;
        state.dragging = false;
        state.dragCell = null;
        releaseActivePointerCapture();
        scenery.setMode(false);
        if (state.prevPhaseBeforePause === 'RUNNING') {
          UI.renderGrid(el, state);
        }
        el.modalPause.classList.remove('hidden');
      }
    });

    el.btnResume.addEventListener('click', () => {
      el.modalPause.classList.add('hidden');
      state.phase = state.prevPhaseBeforePause;
      if (state.phase === 'RUNNING') {
        syncRunningScenery();
      }
      flushPauseWaiters();
    });

    el.btnRestart.addEventListener('click', startGame);

    const backToTitle = () => {
      state.runId = (state.runId || 0) + 1;
      state.phase = 'TITLE';
      flushPauseWaiters();
      state.selectedCell = null;
      state.dragging = false;
      state.dragCell = null;
      releaseActivePointerCapture();
      if (el.fxLayer) el.fxLayer.innerHTML = '';
      if (el.doorsContainer) el.doorsContainer.classList.remove('doors-open');
      if (el.strollerNotice) el.strollerNotice.classList.add('hidden');
      if (el.elderlyNotice) el.elderlyNotice.classList.add('hidden');
      scenery.setNight(false);
      scenery.setMode(false, 'city');
      if (el.modalDeparture) el.modalDeparture.classList.add('hidden');
      if (el.modalTransferBanner) el.modalTransferBanner.classList.add('hidden');
      if (el.modalResultDetail) el.modalResultDetail.classList.add('hidden');
      el.modalPause.classList.add('hidden');
      el.modalResult.classList.add('hidden');
      el.modalTitle.classList.remove('hidden');
    };

    el.btnBackTitle.addEventListener('click', backToTitle);
    el.btnResultTitle.addEventListener('click', backToTitle);
    el.btnResultRetry.addEventListener('click', startGame);

    // データ表モーダル（現在選択中の方向・種別・G1/ドア前地蔵設定で動的描画＋モーダル内での列車切替対応）
    const openData = () => {
      UI.buildDataTable(el, state.direction, state.odMode, state.courseKey, state.g1Event, state.doorJizo);
      el.modalData.classList.remove('hidden');
    };
    el.btnOpenData.addEventListener('click', openData);
    el.btnPauseData.addEventListener('click', openData);
    el.btnCloseData.addEventListener('click', () => el.modalData.classList.add('hidden'));

    document.querySelectorAll('.data-train-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        UI.buildDataTable(el, btn.dataset.dir, state.odMode, btn.dataset.course, state.g1Event, state.doorJizo);
      });
    });

    // スクリーンショット撮影（プレイ中 / リザルト / 詳細レポート）
    const triggerDownloadDataUrl = (dataUrl, filename) => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };

    const buildFallbackCanvas = (kind) => {
      const cv = document.createElement('canvas');
      cv.width = 760;
      cv.height = 460;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#ffd400';
      ctx.fillRect(0, 0, cv.width, 10);
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText('なぜ南武線は混んでるのか？', 30, 56);
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 16px sans-serif';
      const startSt = STATIONS[state.startStationIdx] || STATIONS[0];
      const endSt = STATIONS[state.endStationIdx] || STATIONS[25];
      const diff = DIFFICULTIES[state.diffKey] || DIFFICULTIES.normal;
      ctx.fillText(`${startSt.name}発 → ${endSt.name}行 / 難易度: ${diff.label} (${diff.timeMult}倍)`, 30, 92);
      ctx.fillStyle = '#fde047';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText(`SCORE: ${state.score.toLocaleString()} pt   遅延: ${Puzzle.formatMinSec(state.delaySec)}`, 30, 140);
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '15px sans-serif';
      const modeLabel = kind === 'result' ? 'リザルト' : kind === 'report' ? '詳細レポート' : 'プレイ中';
      ctx.fillText(`モード: ${modeLabel} / 累計乗車: ${(state.passengerLog || []).length}人`, 30, 180);
      return cv.toDataURL('image/png');
    };

    const waitAnimFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

    const captureScreenshot = async (targetEl, kind) => {
      if (!targetEl || state.capturingScreenshot) return;
      state.capturingScreenshot = true;
      sound.playFastForward();

      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const filename = `nanbu-puzzle_${kind}_${stamp}.png`;

      const restoreFns = [];
      let captureTarget = targetEl;

      // 別窓詳細レポート撮影時は画面外クローンを展開して撮影（表示中の画面を一切動かさない）
      if (kind === 'report' && el.resultDetailCard) {
        const cardWidth = el.resultDetailCard.offsetWidth;
        const host = document.createElement('div');
        host.style.position = 'fixed';
        host.style.left = '-99999px';
        host.style.top = '0';
        host.style.width = `${cardWidth}px`;
        host.style.pointerEvents = 'none';
        host.style.zIndex = '-1';

        const clone = el.resultDetailCard.cloneNode(true);
        clone.style.width = `${cardWidth}px`;
        clone.style.height = 'auto';
        clone.style.maxHeight = 'none';
        clone.style.overflow = 'visible';
        clone.classList.add('is-capturing');

        const innerScroll = clone.querySelector('.overflow-auto.custom-scroll');
        if (innerScroll) {
          innerScroll.style.overflow = 'visible';
          innerScroll.style.maxHeight = 'none';
          innerScroll.style.height = 'auto';
        }

        host.appendChild(clone);
        document.body.appendChild(host);
        captureTarget = clone;
        restoreFns.push(() => {
          if (host.parentNode) host.parentNode.removeChild(host);
        });
      } else {
        // 撮影中は対象要素内のアニメーションを静止し、ブレ・途中拡大を防止
        targetEl.classList.add('is-capturing');
        restoreFns.push(() => targetEl.classList.remove('is-capturing'));
      }

      const excludeIds = new Set([
        'screenshot-flash',
        'screenshot-toast',
        'btn-screenshot',
        'btn-result-screenshot',
        'btn-detail-screenshot',
        'btn-close-result-detail',
      ]);

      try {
        // Webフォント読み込み完了とレイアウト確定を待機
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
        await waitAnimFrame();

        const captureOpts = {
          scale: Math.min(global.devicePixelRatio || 1, 2),
          backgroundColor: kind === 'play' ? '#020617' : '#0f172a',
          width: captureTarget.offsetWidth,
          height: captureTarget.offsetHeight,
          style: {
            margin: '0',
          },
          filter: (node) => !(node && node.id && excludeIds.has(node.id)),
          fetch: {
            requestInit: { mode: 'cors' },
          },
        };

        let dataUrl = null;
        if (global.modernScreenshot && typeof global.modernScreenshot.domToPng === 'function') {
          try {
            dataUrl = await global.modernScreenshot.domToPng(captureTarget, captureOpts);
          } catch (_) {
            // file:// やオフライン等で Webフォント埋め込みに失敗した場合は font: false で再試行
            dataUrl = await global.modernScreenshot.domToPng(captureTarget, {
              ...captureOpts,
              font: false,
            });
          }
        }

        let usedFallback = false;
        if (dataUrl) {
          triggerDownloadDataUrl(dataUrl, filename);
        } else {
          usedFallback = true;
          triggerDownloadDataUrl(buildFallbackCanvas(kind), filename);
        }

        // フラッシュ演出は撮影完了後に発火（キャプチャへの混入を完全防止）
        if (el.screenshotFlash) {
          el.screenshotFlash.classList.remove('hidden');
          setTimeout(() => el.screenshotFlash.classList.add('hidden'), 130);
        }
        showToast(
          usedFallback ? '📸 簡易版スクリーンショットを保存しました' : '📸 スクリーンショットを保存しました',
          'success'
        );
      } catch (err) {
        triggerDownloadDataUrl(buildFallbackCanvas(kind), filename);
        showToast('📸 簡易版スクリーンショットを保存しました', 'success');
      } finally {
        restoreFns.reverse().forEach((fn) => fn());
        state.capturingScreenshot = false;
        lastFrameTime = performance.now();
        flushPauseWaiters();
      }
    };

    if (el.btnScreenshot) {
      el.btnScreenshot.addEventListener('click', () => captureScreenshot(el.appShell, 'play'));
    }
    if (el.btnResultScreenshot) {
      el.btnResultScreenshot.addEventListener('click', () => captureScreenshot(el.resultCard, 'result'));
    }
    if (el.btnDetailScreenshot) {
      el.btnDetailScreenshot.addEventListener('click', () => captureScreenshot(el.resultDetailCard, 'report'));
    }

    // リザルト詳細レポート別窓 ＆ 3タブ切替
    const setDetailTab = (tabKey) => {
      document.querySelectorAll('.detail-tab-btn').forEach((b) => {
        const active = b.dataset.detailTab === tabKey;
        b.className = active
          ? 'detail-tab-btn px-2 py-1.5 rounded-lg border text-[11px] sm:text-xs font-black transition border-yellow-400 bg-yellow-400/20 text-yellow-200 cursor-pointer'
          : 'detail-tab-btn px-2 py-1.5 rounded-lg border text-[11px] sm:text-xs font-bold transition border-slate-700 bg-slate-800/80 text-slate-300 hover:border-slate-500 cursor-pointer';
      });
      if (el.detailPanelOdList) el.detailPanelOdList.classList.toggle('hidden', tabKey !== 'od-list');
      if (el.detailPanelOdHeatmap) el.detailPanelOdHeatmap.classList.toggle('hidden', tabKey !== 'od-heatmap');
      if (el.detailPanelScoreDetail) el.detailPanelScoreDetail.classList.toggle('hidden', tabKey !== 'score-detail');
    };

    document.querySelectorAll('.detail-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => setDetailTab(btn.dataset.detailTab));
    });

    if (el.btnOpenResultDetail && el.modalResultDetail) {
      el.btnOpenResultDetail.addEventListener('click', () => {
        setDetailTab('od-list');
        el.modalResultDetail.classList.remove('hidden');
      });
    }
    if (el.btnCloseResultDetail && el.modalResultDetail) {
      el.btnCloseResultDetail.addEventListener('click', () => {
        el.modalResultDetail.classList.add('hidden');
      });
    }

    // Escape キー：サブモーダル優先で閉じ、閉じていてプレイ中（RUNNING / PAUSED）ならポーズをトグル
    global.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const subModals = [el.modalAbout, el.modalModHelp, el.modalHowto, el.modalData, el.modalResultDetail];
      for (const modal of subModals) {
        if (modal && !modal.classList.contains('hidden')) {
          modal.classList.add('hidden');
          return;
        }
      }
      if (state.capturingScreenshot) return;
      if (
        state.phase === 'RUNNING' ||
        state.phase === 'ALIGHTING' ||
        state.phase === 'BOARDING'
      ) {
        el.btnPause.click();
      } else if (state.phase === 'PAUSED') {
        el.btnResume.click();
      }
    });
  }

  /* -------------------------------------------------------------------------
   * 初期化エントリーポイント
   * ------------------------------------------------------------------------- */
  global.addEventListener('load', () => {
    el = UI.cacheElements();
    scenery = new SceneryRenderer(el.sceneryCanvas);

    // バージョン表記を NanbuData.APP_VERSION から一元同期
    document.querySelectorAll('.ver-badge').forEach((badge) => {
      badge.textContent = APP_VERSION;
    });
    if (document.title) {
      document.title = document.title.replace(/Ver\.\d+\.\d+[a-z]?/i, APP_VERSION);
    }

    UI.initGridDOM(el);
    UI.buildDataTable(el, state.direction, state.odMode, state.courseKey);
    bindGridPointerEvents();
    bindUIEvents();
    const handleLayoutResize = () => {
      UI.syncCarLayout(el);
      scenery.resize();
    };
    handleLayoutResize();
    global.addEventListener('resize', handleLayoutResize);
    if (typeof global.ResizeObserver === 'function' && el.mainStage) {
      const ro = new global.ResizeObserver(handleLayoutResize);
      ro.observe(el.mainStage);
      if (el.controlsPanel) ro.observe(el.controlsPanel);
      if (el.announceRow) ro.observe(el.announceRow);
    }

    lastFrameTime = performance.now();
    requestAnimationFrame(gameLoop);
  });
})(window);
