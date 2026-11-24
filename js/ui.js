/**
 * なぜ南武線は常に混んでるのか - UI描画・DOM操作層
 * DOM参照キャッシュ、盤面レンダリング、LCD/HUD/タイマー更新、演出エフェクト、リザルト＆種別停車駅路線図・各駅情報表描画を担当する。
 */
(function (global) {
  'use strict';

  const { BOARD_CONFIG, STATIONS, DIRECTIONS, OD_MODES, DIFFICULTIES, RAPID_CONNECTIONS } = global.NanbuData;
  const { ROWS, COLS, MAX_CAPACITY, MAX_DELAY_SEC } = BOARD_CONFIG;
  const Puzzle = global.NanbuPuzzle;

  function cacheElements() {
    return {
      mainStage: document.getElementById('main-stage'),
      sceneryWrap: document.getElementById('scenery-wrap'),
      gridStage: document.getElementById('grid-stage'),
      grid: document.getElementById('puzzle-grid'),
      fxLayer: document.getElementById('fx-layer'),
      carBody: document.getElementById('car-body'),
      doorsPlatformWrap: document.getElementById('doors-platform-wrap'),
      doorsContainer: document.getElementById('doors-container'),
      sceneryCanvas: document.getElementById('scenery-canvas'),
      sceneryTag: document.getElementById('scenery-tag'),

      lcdLedType: document.getElementById('lcd-led-type'),
      lcdOrigin: document.getElementById('lcd-origin-label'),
      lcdPhase: document.getElementById('lcd-phase-label'),
      lcdLedDest: document.getElementById('lcd-led-dest'),

      hudScore: document.getElementById('hud-score'),
      hudScoreMobile: document.getElementById('hud-score-mobile'),
      hudOcc: document.getElementById('hud-occupancy'),
      hudDelayText: document.getElementById('hud-delay-text'),
      hudDelayBar: document.getElementById('hud-delay-bar'),
      timerBar: document.getElementById('timer-bar'),
      timerText: document.getElementById('timer-text'),
      announceText: document.getElementById('announce-text'),

      alightTotal: document.getElementById('alight-total-count'),
      alightOk: document.getElementById('alight-ok-count'),
      alightBlocked: document.getElementById('alight-blocked-count'),
      btnFF: document.getElementById('btn-fast-forward'),
      ffHint: document.getElementById('ff-bonus-hint'),
      strollerNotice: document.getElementById('stroller-notice'),
      elderlyNotice: document.getElementById('elderly-notice'),

      btnMute: document.getElementById('btn-mute'),
      btnPause: document.getElementById('btn-pause'),
      btnStartGame: document.getElementById('btn-start-game'),
      btnOpenData: document.getElementById('btn-open-data'),
      btnResume: document.getElementById('btn-resume'),
      btnPauseData: document.getElementById('btn-pause-data'),
      btnRestart: document.getElementById('btn-restart'),
      btnBackTitle: document.getElementById('btn-back-title'),
      btnResultRetry: document.getElementById('btn-result-retry'),
      btnResultTitle: document.getElementById('btn-result-title'),
      btnCloseData: document.getElementById('btn-close-data'),
      btnOpenModHelp: document.getElementById('btn-open-mod-help'),
      btnCloseModHelp: document.getElementById('btn-close-mod-help'),
      btnOpenHowto: document.getElementById('btn-open-howto'),
      btnCloseHowto: document.getElementById('btn-close-howto'),
      btnOpenAbout: document.getElementById('btn-open-about'),
      btnCloseAbout: document.getElementById('btn-close-about'),
      btnToggleMoreDown: document.getElementById('btn-toggle-more-down'),
      btnToggleMoreUp: document.getElementById('btn-toggle-more-up'),
      moreRoutesDown: document.getElementById('more-routes-down'),
      moreRoutesUp: document.getElementById('more-routes-up'),
      btnToggleMod: document.getElementById('btn-toggle-mod'),
      modifierGrid: document.getElementById('modifier-grid'),
      modActiveBadge: document.getElementById('mod-active-badge'),
      btnScreenshot: document.getElementById('btn-screenshot'),
      btnResultScreenshot: document.getElementById('btn-result-screenshot'),
      btnDetailScreenshot: document.getElementById('btn-detail-screenshot'),
      btnOpenResultDetail: document.getElementById('btn-open-result-detail'),
      btnCloseResultDetail: document.getElementById('btn-close-result-detail'),
      dataRouteColLabel: document.getElementById('data-route-col-label'),

      appShell: document.getElementById('app-shell'),
      resultCard: document.getElementById('result-card'),
      resultDetailCard: document.getElementById('result-detail-card'),
      modalTitle: document.getElementById('modal-title'),
      modalPause: document.getElementById('modal-pause'),
      modalResult: document.getElementById('modal-result'),
      modalResultDetail: document.getElementById('modal-result-detail'),
      modalData: document.getElementById('modal-data'),
      modalModHelp: document.getElementById('modal-mod-help'),
      modalHowto: document.getElementById('modal-howto'),
      modalAbout: document.getElementById('modal-about'),
      modalDeparture: document.getElementById('modal-departure'),
      departureRoute: document.getElementById('departure-route-text'),
      departureType: document.getElementById('departure-type-badge'),
      modalTransferBanner: document.getElementById('modal-transfer-banner'),
      transferBannerTitle: document.getElementById('transfer-banner-title'),
      transferBannerText: document.getElementById('transfer-banner-text'),
      transferBannerSub: document.getElementById('transfer-banner-sub'),
      screenshotFlash: document.getElementById('screenshot-flash'),
      screenshotToast: document.getElementById('screenshot-toast'),
      dataTableSubtitle: document.getElementById('data-table-subtitle'),
      dataTableBody: document.getElementById('data-table-body'),

      resBadge: document.getElementById('res-badge'),
      resTitle: document.getElementById('res-title'),
      resSubtitle: document.getElementById('res-subtitle'),
      resMeta: document.getElementById('res-meta'),
      resRank: document.getElementById('res-rank'),
      resMultTag: document.getElementById('res-mult-tag'),
      resScore: document.getElementById('res-score'),
      resDelay: document.getElementById('res-delay'),
      resSmooth: document.getElementById('res-smooth-rate'),
      resChain: document.getElementById('res-max-chain'),
      resOdSummary: document.getElementById('res-od-summary'),
      resOdList: document.getElementById('res-od-list'),
      resSectionSummary: document.getElementById('res-section-summary'),
      resSectionLoad: document.getElementById('res-section-load'),
      resOdHeatmap: document.getElementById('res-od-heatmap'),
      resScoreDetail: document.getElementById('res-score-detail'),
      detailMiniRank: document.getElementById('detail-mini-rank'),
      detailMiniScore: document.getElementById('detail-mini-score'),
      detailMiniDelay: document.getElementById('detail-mini-delay'),
      detailMiniSmooth: document.getElementById('detail-mini-smooth'),
      detailMiniMeta: document.getElementById('detail-mini-meta'),
      detailPanelOdList: document.getElementById('detail-panel-od-list'),
      detailPanelOdHeatmap: document.getElementById('detail-panel-od-heatmap'),
      detailPanelScoreDetail: document.getElementById('detail-panel-score-detail'),
    };
  }

  function initGridDOM(el) {
    el.grid.innerHTML = '';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        if (Puzzle.isSeatCell(r, c)) cell.classList.add('cell-seat');
        if (Puzzle.isDoorCell(r, c)) cell.classList.add('cell-door');
        if (Puzzle.isPriorityCell(r, c)) cell.classList.add('cell-priority');
        el.grid.appendChild(cell);
      }
    }
  }

  function getCellEl(el, r, c) {
    return el.grid.children[r * COLS + c];
  }

  function getNextStopIdx(state) {
    const stops = state.routeStops;
    if (!stops || stops.length === 0) return state.endStationIdx;
    const nextPos = Math.min(state.currentStopPos + 1, stops.length - 1);
    return stops[nextPos];
  }

  function spawnFloatText(el, text, r, c, colorClass = 'text-yellow-300', sizeClass = 'text-sm sm:text-base') {
    const fx = document.createElement('div');
    fx.className = `float-text ${colorClass} ${sizeClass}`;
    fx.textContent = text;
    const xPct = ((c + 0.5) / COLS) * 100;
    const yPct = ((r + 0.35) / ROWS) * 100;
    fx.style.left = `${xPct}%`;
    fx.style.top = `${yPct}%`;
    el.fxLayer.appendChild(fx);
    setTimeout(() => fx.remove(), 920);
  }

  function triggerShake(el) {
    el.carBody.classList.remove('shake-effect');
    void el.carBody.offsetWidth;
    el.carBody.classList.add('shake-effect');
  }

  function updateReachabilityCounters(el, total, ok, blocked) {
    el.alightTotal.textContent = total;
    el.alightOk.textContent = ok;
    el.alightBlocked.textContent = blocked;
  }

  // 案1インフォグラフィック用・反転背景向け大型白ピクトグラムSVG
  const SVG_STROLLER =
    '<svg viewBox="0 0 24 24" class="w-7 h-7 sm:w-9 sm:h-9 text-white drop-shadow-sm shrink-0" fill="currentColor" aria-hidden="true">' +
    '<path d="M5 4H2v2h2.2l2.1 7.6A2.5 2.5 0 0 0 8.7 15.5H17a2.5 2.5 0 0 0 2.4-1.8l1.6-5.2A1 1 0 0 0 20 7.2h-7.2L12 4.5a4.5 4.5 0 0 0-4.2-3H6.5V3.5h1.3a2.5 2.5 0 0 1 2.3 1.6L11 7.2H6.4L5 4zm4 13a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>' +
    '</svg>';

  const SVG_ELDERLY =
    '<svg viewBox="0 0 24 24" class="w-4 h-4 text-white shrink-0" fill="currentColor" aria-hidden="true">' +
    '<circle cx="12.5" cy="4.2" r="2.2"/>' +
    '<path d="M10.2 7.5c1.5-.3 3 .5 3.6 1.8l1.2 2.4 1.8.8a1 1 0 0 1-.8 1.8l-2.3-1-.9-1.7-.6 3 2.1 5.6a1 1 0 1 1-1.9.7l-1.9-5-1.3 5a1 1 0 1 1-1.9-.5l1.6-6.3.7-3.4-1.1 1.2v2.4a1 1 0 0 1-2 0V11c0-.4.2-.8.5-1.1l2.2-2.4zM18 13.5a1.5 1.5 0 0 1 1.5 1.5v6a.75.75 0 0 1-1.5 0v-6a.25.25 0 0 0-.5 0 .75.75 0 0 1-1.5 0 1.5 1.5 0 0 1 2-1.5z"/>' +
    '</svg>';

  const SVG_JIZO =
    '<svg viewBox="0 0 24 24" class="w-4 h-4 text-slate-100 shrink-0" fill="currentColor" aria-hidden="true">' +
    '<circle cx="12" cy="5.5" r="3"/>' +
    '<path d="M7.5 11.5C7.5 9.6 9.5 8.5 12 8.5s4.5 1.1 4.5 3v6.5h-9v-6.5zm-2 7.5h13v2.5h-13V19z"/>' +
    '</svg>';

  const SVG_JIZO_LOCK =
    '<svg viewBox="0 0 20 20" class="w-3 h-3 text-amber-300 shrink-0" fill="currentColor" aria-hidden="true">' +
    '<path fill-rule="evenodd" d="M10 2a4 4 0 0 0-4 4v2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1V6a4 4 0 0 0-4-4zm2 6V6a2 2 0 1 0-4 0v2h4z" clip-rule="evenodd"/>' +
    '</svg>';

  function renderGrid(el, state, newlyBoardedUids = new Set()) {
    const nextIdx = getNextStopIdx(state);
    const activeDragGroup =
      state.dragging && state.dragCell && state.grid[state.dragCell.r][state.dragCell.c]
        ? state.grid[state.dragCell.r][state.dragCell.c].strollerGroupId || null
        : null;
    const activeSelectGroup =
      state.selectedCell && state.grid[state.selectedCell.r][state.selectedCell.c]
        ? state.grid[state.selectedCell.r][state.selectedCell.c].strollerGroupId || null
        : null;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cellEl = getCellEl(el, r, c);
        const p = state.grid[r][c];
        cellEl.innerHTML = '';

        if (!p) continue;

        const st = STATIONS[p.destIdx];
        const isTarget = p.destIdx === nextIdx;
        const isOk = isTarget ? state.reachability.get(p.uid) : false;

        const token = document.createElement('div');
        token.className = 'passenger';
        token.dataset.uid = p.uid;
        token.style.setProperty('--st-color', st.bg);

        if (p.isJizo) token.classList.add('is-jizo');
        if (p.isElderly) token.classList.add('is-elderly');
        if (p.strollerGroupId) {
          token.classList.add(p.strollerPart === 'top' ? 'is-stroller-top' : 'is-stroller-bottom');
        }
        if (isTarget) token.classList.add('is-target');
        if (newlyBoardedUids.has(p.uid)) token.classList.add('anim-board');

        const isDraggingThis =
          (state.dragging && state.dragCell && state.dragCell.r === r && state.dragCell.c === c) ||
          (activeDragGroup && p.strollerGroupId === activeDragGroup);
        const isSelectedThis =
          (state.selectedCell && state.selectedCell.r === r && state.selectedCell.c === c) ||
          (activeSelectGroup && p.strollerGroupId === activeSelectGroup);

        if (isDraggingThis) {
          token.classList.add('is-dragging');
        } else if (isSelectedThis) {
          token.classList.add('is-selected');
        }

        const nameLen = st.short.length;
        const nameScaleClass = nameLen >= 4 ? 'len-4' : nameLen === 3 ? 'len-3' : '';

        if (p.strollerGroupId && p.strollerPart === 'bottom') {
          // ベビーカー下段：反転ピンク地に特大白ピクト＋状態チップ
          const body = document.createElement('div');
          body.className = 'passenger-body gap-0.5';
          body.innerHTML = SVG_STROLLER;

          const inPrio = Puzzle.isStrollerInPrioritySpace(r - 1, c);
          const subSpan = document.createElement('span');
          if (isTarget) {
            subSpan.className = 'text-[7.5px] sm:text-[8.5px] font-black px-1 py-0.5 rounded bg-emerald-400 text-slate-950 whitespace-nowrap leading-none';
            subSpan.textContent = '次駅降車';
          } else {
            subSpan.className = `text-[7.5px] sm:text-[8.5px] font-black px-1 py-0.5 rounded whitespace-nowrap leading-none ${
              inPrio ? 'bg-white text-pink-700' : 'bg-yellow-300 text-slate-950 animate-pulse'
            }`;
            subSpan.textContent = inPrio ? '優先OK' : '優先へ!';
          }
          body.appendChild(subSpan);
          token.appendChild(body);
        } else {
          // 上部カラー帯（大きめの駅番号＋ロックアイコン）
          const header = document.createElement('div');
          header.className = 'passenger-header';
          const numSpan = document.createElement('span');
          numSpan.className = 'passenger-num';
          numSpan.textContent = st.num;
          header.appendChild(numSpan);
          if (p.isJizo) {
            header.insertAdjacentHTML('beforeend', SVG_JIZO_LOCK);
          }

          // 下部エリア（全客種共通で駅名を中央に大きく表示）
          const body = document.createElement('div');
          body.className = 'passenger-body';
          const nameSpan = document.createElement('span');
          nameSpan.className = `passenger-name ${nameScaleClass}`.trim();
          nameSpan.textContent = st.short;
          body.appendChild(nameSpan);

          token.appendChild(header);
          token.appendChild(body);
        }

        // 御老人・ドア前地蔵のピクトグラムは左上角に重ねてバッジ表示
        if (p.isElderly) {
          const pBadge = document.createElement('div');
          pBadge.className = 'pict-badge pict-badge-elderly';
          pBadge.innerHTML = SVG_ELDERLY;
          token.appendChild(pBadge);
        } else if (p.isJizo) {
          const pBadge = document.createElement('div');
          pBadge.className = 'pict-badge pict-badge-jizo';
          pBadge.innerHTML = SVG_JIZO;
          token.appendChild(pBadge);
        }

        if (isTarget && (!p.strollerGroupId || p.strollerPart === 'top')) {
          const badge = document.createElement('div');
          badge.className = `status-badge ${isOk ? 'badge-ok' : 'badge-blocked'}`;
          badge.textContent = isOk ? 'OK' : '!詰';
          token.appendChild(badge);
        }

        cellEl.appendChild(token);
      }
    }
  }

  function updateHUD(el, state) {
    const nextIdx = getNextStopIdx(state);
    const curSt = STATIONS[state.currentStationIdx];
    const nextSt = STATIONS[nextIdx];
    const startSt = STATIONS[state.startStationIdx] || STATIONS[0];
    const endSt = STATIONS[state.endStationIdx] || STATIONS[25];
    const leg = Puzzle.getLegInfo(state.currentStationIdx, nextIdx);
    const isRapid = Puzzle.isRapidCourse(state.courseKey);

    // 上段左：LED行先表示器風（種別ボックス ＋ 発駅 ＋ 行先）
    if (el.lcdLedType) {
      if (isRapid) {
        el.lcdLedType.className =
          'led-type-rapid shrink-0 w-[56px] sm:w-[66px] h-[40px] sm:h-[46px] rounded-[4px] px-1 flex items-center justify-center text-lg sm:text-xl tracking-wider select-none';
        el.lcdLedType.innerHTML = '快速';
      } else {
        el.lcdLedType.className =
          'led-type-local shrink-0 w-[56px] sm:w-[66px] h-[40px] sm:h-[46px] rounded-[4px] flex items-center justify-center select-none';
        el.lcdLedType.innerHTML =
          '<div class="inline-flex flex-col text-[15px] sm:text-[18px] leading-[1.0] tracking-tight"><span class="block text-left">各駅</span><span class="block text-left pl-2.5 sm:pl-3">停車</span></div>';
      }
    }
    if (el.lcdOrigin) {
      el.lcdOrigin.textContent = `${startSt.name}発`;
    }
    if (el.lcdLedDest) {
      el.lcdLedDest.textContent = `${endSt.name}行`;
    }

    const typeLabel = isRapid ? '快速 ' : '';
    if (state.phase === 'CLEAR') {
      el.sceneryTag.textContent = `${typeLabel}終点 ${endSt.name} 到着`;
    } else {
      el.sceneryTag.textContent = `${typeLabel}${curSt.name} → ${nextSt.name} (${leg.dist.toFixed(1)}km)${leg.isBridge ? ' 🌊多摩川鉄橋' : ''}`;
    }

    // スコア＆乗車率
    el.hudScore.textContent = state.score.toLocaleString();
    el.hudScoreMobile.textContent = state.score.toLocaleString();
    const occ = Puzzle.getOccupancy(state.grid);
    el.hudOcc.textContent = `${occ}/${MAX_CAPACITY}`;
    el.hudOcc.className = `text-xs font-black tabular-nums ${occ >= 36 ? 'text-rose-400' : occ >= 28 ? 'text-amber-300' : 'text-sky-300'}`;

    // 累計遅延ゲージ
    el.hudDelayText.textContent = Puzzle.formatMinSec(state.delaySec);
    const delayPct = Math.min(100, (state.delaySec / MAX_DELAY_SEC) * 100);
    el.hudDelayBar.style.width = `${delayPct}%`;
    if (delayPct >= 75) {
      el.hudDelayText.className = 'text-xs font-black text-rose-400 tabular-nums';
      el.hudDelayBar.className = 'h-full bg-rose-500 transition-all duration-300';
    } else if (delayPct >= 40) {
      el.hudDelayText.className = 'text-xs font-black text-amber-400 tabular-nums';
      el.hudDelayBar.className = 'h-full bg-amber-400 transition-all duration-300';
    } else {
      el.hudDelayText.className = 'text-xs font-black text-emerald-400 tabular-nums';
      el.hudDelayBar.className = 'h-full bg-emerald-400 transition-all duration-300';
    }

    // ベビーカー・御老人乗車中のみ下部注意書きを表示
    if (el.strollerNotice) {
      const hasStroller = Puzzle.getActiveStrollers(state.grid).length > 0;
      el.strollerNotice.classList.toggle('hidden', !hasStroller);
    }
    if (el.elderlyNotice) {
      const hasElderly = Puzzle.getActiveElderly(state.grid).length > 0;
      el.elderlyNotice.classList.toggle('hidden', !hasElderly);
    }

    // 早送りボタン状態更新
    const canFF = state.phase === 'RUNNING';
    el.btnFF.disabled = !canFF;
    if (canFF) {
      const recov = Puzzle.calcFastForwardRecovery(state.delaySec, state.timeRemaining);
      const allOk = state.targetBlocked === 0;
      el.ffHint.textContent = recov > 0 ? `遅延-${recov}秒` : allOk ? '準備OK!' : '即到着';
      if (allOk) {
        el.btnFF.className =
          'game-btn flex-1 max-w-[270px] py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 hover:brightness-105 text-slate-950 font-black text-xs sm:text-sm shadow-[0_3px_0_#0f766e] flex items-center justify-center gap-1.5';
      } else {
        el.btnFF.className =
          'game-btn flex-1 max-w-[270px] py-2 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:brightness-105 text-slate-950 font-black text-xs sm:text-sm shadow-[0_3px_0_#b45309] flex items-center justify-center gap-1.5';
      }
    }
  }

  function updateTimerUI(el, state) {
    const ratio = state.timeTotal > 0 ? Math.max(0, state.timeRemaining / state.timeTotal) : 0;
    el.timerBar.style.width = `${ratio * 100}%`;
    el.timerText.textContent = `${Math.max(0, state.timeRemaining).toFixed(1)}s`;

    if (state.timeRemaining <= 3.0 && state.phase === 'RUNNING') {
      el.timerBar.className = 'h-full bg-gradient-to-r from-rose-600 to-red-400 transition-all duration-75 ease-linear';
      el.timerText.className = 'w-12 text-right text-xs sm:text-sm font-black text-rose-400 tabular-nums animate-pulse';
    } else {
      el.timerBar.className = 'h-full bg-gradient-to-r from-yellow-400 via-amber-400 to-emerald-400 transition-all duration-100 ease-linear';
      el.timerText.className = 'w-12 text-right text-xs sm:text-sm font-black text-yellow-300 tabular-nums';
    }
  }

  function updateFastForwardHint(el, state) {
    const recov = Puzzle.calcFastForwardRecovery(state.delaySec, state.timeRemaining);
    el.ffHint.textContent = recov > 0 ? `遅延-${recov}秒` : state.targetBlocked === 0 ? '準備OK!' : '即到着';
  }

  function renderResultModal(el, state, isClear) {
    const endSt = STATIONS[state.endStationIdx];
    const dir = DIRECTIONS[state.direction] || DIRECTIONS.down;
    const typeLabel = Puzzle.isRapidCourse(state.courseKey) ? '快速' : '各停';
    const smoothRate =
      state.totalAlighted > 0 ? Math.round((state.smoothAlighted / state.totalAlighted) * 100) : 100;

    let rank = 'D';
    let rankColor = 'text-rose-500';

    if (isClear) {
      const evaluated = Puzzle.evaluateClearRank(state.delaySec, smoothRate);
      rank = evaluated.rank;
      rankColor = evaluated.rankColor;
      el.resBadge.textContent = `🎉 ${dir.shortLabel}${typeLabel}・${endSt.name}到着！`;
      el.resBadge.className =
        'inline-block px-3 py-0.5 rounded-full text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 mb-1.5';
      el.resTitle.textContent = `${endSt.name}駅 到着！`;
      el.resSubtitle.textContent =
        rank === 'SS'
          ? '完璧すぎる……貴方は南武線博士ですか？'
          : rank === 'S'
            ? '南武線の定時運行を守り抜きました！'
            : '今日も南武線は混んでいました';
      el.resRank.textContent = rank;
      el.resRank.className = `font-round text-5xl font-extrabold leading-none mt-0.5 drop-shadow ${rankColor}`;
    } else {
      const curSt = STATIONS[getNextStopIdx(state)];
      el.resBadge.textContent = '🚨 運　転　中　止';
      el.resBadge.className =
        'inline-block px-3 py-0.5 rounded-full text-xs font-black bg-rose-500/20 text-rose-300 border border-rose-500/40 mb-1.5';
      el.resTitle.textContent = `${curSt.name}駅付近で大幅遅延`;
      el.resSubtitle.textContent =
        '累計遅延が許容上限（2分00秒）を超過しました。主要駅の1〜2駅手前から先読み整理するのがコツです！';
      el.resRank.textContent = rank;
      el.resRank.className = `font-round text-5xl font-extrabold leading-none mt-0.5 drop-shadow ${rankColor}`;
    }

    const bd = state.scoreBreakdown || {};
    const multInfo = bd.multInfo || { baseMult: 1.0, modSum: 0, modItems: [], totalMult: 1.0 };

    if (el.resMultTag) {
      el.resMultTag.textContent = `倍率 ×${multInfo.totalMult.toFixed(2)}`;
    }
    el.resScore.textContent = `${state.score.toLocaleString()} pt`;
    el.resDelay.textContent = Puzzle.formatMinSec(state.delaySec);
    el.resSmooth.textContent = `${smoothRate}% (${state.smoothAlighted}/${state.totalAlighted})`;
    el.resChain.textContent = `${state.maxChain}人`;

    // 選択した列車・難易度・追加難易度設定のメタ情報表示
    const startSt = STATIONS[state.startStationIdx];
    const diff = DIFFICULTIES[state.diffKey] || DIFFICULTIES.normal;
    let scenarioTag = '';
    if (state.courseKey === 'tachikawa_nakahara') scenarioTag = '・終電間際';
    else if (state.courseKey === 'nishikunitachi') scenarioTag = '・朝ラッシュ';
    else if (state.courseKey === 'rapid_inagi') scenarioTag = '・立川行連絡';
    else if (state.courseKey === 'rapid_noborito') scenarioTag = '・各停連絡';

    if (el.resMeta) {
      const mods = [];
      if (state.doorJizo) mods.push('🗿ドア前地蔵');
      if (state.g1Active) mods.push('🏇G1開催');
      if (state.stroller) mods.push('👶ベビーカー');
      if (state.elderly) mods.push('👴御老人');

      const chips = [
        `<span class="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-slate-100 font-bold">🚃 ${dir.shortLabel}${typeLabel} ${startSt.name}→${endSt.name}${scenarioTag}</span>`,
        `<span class="px-2 py-0.5 rounded-md bg-yellow-400/15 border border-yellow-400/40 text-yellow-200 font-bold">⏱ ${diff.label} (${diff.timeMult.toFixed(1)}倍)</span>`,
      ];
      if (mods.length > 0) {
        mods.forEach((m) => {
          chips.push(`<span class="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-200 font-bold">${m}</span>`);
        });
      } else {
        chips.push(`<span class="px-2 py-0.5 rounded-md bg-slate-800/70 border border-slate-700/70 text-slate-400 font-semibold">追加設定なし</span>`);
      }
      el.resMeta.innerHTML = chips.join('');
    }

    // 別窓詳細レポート上部のミニ運行評価バーを更新
    if (el.detailMiniRank) {
      el.detailMiniRank.textContent = rank;
      el.detailMiniRank.className = `font-round text-lg font-extrabold leading-none ${rankColor}`;
    }
    if (el.detailMiniScore) el.detailMiniScore.textContent = `${state.score.toLocaleString()} pt`;
    if (el.detailMiniDelay) el.detailMiniDelay.textContent = `遅延 ${Puzzle.formatMinSec(state.delaySec)}`;
    if (el.detailMiniSmooth) el.detailMiniSmooth.textContent = `スムーズ ${smoothRate}%`;
    if (el.detailMiniMeta) {
      el.detailMiniMeta.textContent = `${dir.shortLabel}${typeLabel} ${startSt.name}→${endSt.name}${scenarioTag} / ${diff.label} (合計倍率 ×${multInfo.totalMult.toFixed(2)})`;
    }

    // このプレイで湧いた乗客の動向（タブ①一覧 ＆ タブ②ヒートマップ）
    const log = state.passengerLog || [];
    const totalBoarded = log.length;
    const groups = new Map();
    const pairCounts = new Map();
    const activeFromSet = new Set();
    const activeToSet = new Set();

    log.forEach((item) => {
      const key = item.isOriginTransfer ? `${item.fromIdx}_tr` : `${item.fromIdx}`;
      if (!groups.has(key)) {
        groups.set(key, {
          fromIdx: item.fromIdx,
          isOriginTransfer: !!item.isOriginTransfer,
          total: 0,
          dests: new Map(),
        });
      }
      const g = groups.get(key);
      g.total++;
      g.dests.set(item.toIdx, (g.dests.get(item.toIdx) || 0) + 1);

      const pKey = `${item.fromIdx}-${item.toIdx}`;
      pairCounts.set(pKey, (pairCounts.get(pKey) || 0) + 1);
      activeFromSet.add(item.fromIdx);
      activeToSet.add(item.toIdx);
    });

    let topPairText = '';
    let topPairVal = 0;
    pairCounts.forEach((cnt, pKey) => {
      if (cnt > topPairVal) {
        topPairVal = cnt;
        const [fStr, tStr] = pKey.split('-');
        const fSt = STATIONS[Number(fStr)];
        const tSt = STATIONS[Number(tStr)];
        if (fSt && tSt) {
          topPairText = ` / 最多 ${fSt.short}→${tSt.short}(${cnt}人)`;
        }
      }
    });

    if (el.resOdSummary) {
      el.resOdSummary.textContent = `総乗車 ${totalBoarded}人${topPairText}`;
    }

    const routeStops = state.routeStops || [];

    // タブ①上部：各駅間ごとの乗車人数（車内人数推移グラフ）
    // ゲームオーバー時は実際に走行した区間（0 .. state.currentStopPos）のみ集計し、未走行区間を除外
    if (el.resSectionLoad && el.resSectionSummary) {
      const legs = [];
      const isDown = state.step > 0;
      const maxLegIdx = isClear
        ? routeStops.length - 2
        : Math.min(routeStops.length - 2, state.currentStopPos);
      for (let k = 0; k <= maxLegIdx; k++) {
        const fromIdx = routeStops[k];
        const toIdx = routeStops[k + 1];
        let count = 0;
        for (const item of log) {
          if (isDown) {
            if (item.fromIdx <= fromIdx && item.toIdx >= toIdx) count++;
          } else {
            if (item.fromIdx >= fromIdx && item.toIdx <= toIdx) count++;
          }
        }
        legs.push({ fromIdx, toIdx, count });
      }

      if (legs.length === 0) {
        el.resSectionSummary.textContent = 'データなし';
        el.resSectionLoad.innerHTML = `<div class="text-[10px] text-slate-500 text-center py-2">駅間データがありません</div>`;
      } else {
        let peakLeg = legs[0];
        legs.forEach((l) => {
          if (l.count > peakLeg.count) peakLeg = l;
        });
        const peakFrom = STATIONS[peakLeg.fromIdx];
        const peakTo = STATIONS[peakLeg.toIdx];
        const stopNote = !isClear ? '（運転中止まで）' : '';
        el.resSectionSummary.textContent = `最混雑 ${peakFrom.short}→${peakTo.short} (${peakLeg.count}/${MAX_CAPACITY}人)${stopNote}`;

        const toTwo = (st) => (st.short === '溝ノ口' ? '溝口' : st.short.slice(0, 2));
        const isMany = legs.length >= 15;
        const barsHtml = legs
          .map((l) => {
            const fSt = STATIONS[l.fromIdx];
            const tSt = STATIONS[l.toIdx];
            const pct = Math.min(100, Math.round((l.count / MAX_CAPACITY) * 100));
            const barHeightPct = l.count > 0 ? Math.max(4, pct) : 0;
            const barColor =
              l.count >= 34
                ? 'bg-rose-500'
                : l.count >= 24
                  ? 'bg-amber-400'
                  : 'bg-sky-400';
            const two = toTwo(fSt);
            const labelHtml = isMany ? `${two[0]}<br>${two[1] || ''}` : two;
            return `
              <div class="flex-1 min-w-0 flex flex-col items-center justify-end gap-0.5" title="${fSt.name} → ${tSt.name}：${l.count}/${MAX_CAPACITY}人 (${pct}%)">
                <span class="${isMany ? 'text-[7px] sm:text-[8px]' : 'text-[9px]'} font-black ${l.count > 0 ? 'text-slate-200' : 'text-slate-600'} tabular-nums leading-none">${l.count}</span>
                <div class="w-full h-14 sm:h-16 bg-slate-900 rounded-sm overflow-hidden flex items-end border border-slate-800/80">
                  <div class="w-full ${barColor} rounded-t-sm transition-all" style="height:${barHeightPct}%"></div>
                </div>
                <span class="${isMany ? 'text-[7px] sm:text-[7.5px] leading-[1.05]' : 'text-[8.5px] leading-tight'} font-bold text-slate-400 text-center">${labelHtml}</span>
              </div>
            `;
          })
          .join('');

        el.resSectionLoad.innerHTML = `<div class="flex items-end gap-[2px] sm:gap-1 w-full pt-1">${barsHtml}</div>`;
      }
    }

    // タブ①：乗客動向（一覧）
    if (el.resOdList) {
      if (groups.size === 0) {
        el.resOdList.innerHTML = `<div class="col-span-full text-[11px] text-slate-400 text-center py-4">乗車データがありません</div>`;
      } else {
        const orderedGroups = [];
        routeStops.forEach((sIdx) => {
          if (groups.has(`${sIdx}`)) orderedGroups.push(groups.get(`${sIdx}`));
          if (groups.has(`${sIdx}_tr`)) orderedGroups.push(groups.get(`${sIdx}_tr`));
        });

        const maxGroupTotal = Math.max(1, ...orderedGroups.map((g) => g.total));
        const isDown = state.step > 0;

        el.resOdList.innerHTML = orderedGroups
          .map((g) => {
            const fromSt = STATIONS[g.fromIdx];
            const barWidthPct = Math.max(12, Math.round((g.total / maxGroupTotal) * 100));
            const sortedDests = Array.from(g.dests.entries()).sort((a, b) =>
              isDown ? a[0] - b[0] : b[0] - a[0]
            );

            const segmentsHtml = sortedDests
              .map(([dIdx, cnt]) => {
                const dSt = STATIONS[dIdx];
                const segPct = (cnt / g.total) * 100;
                return `<div style="width:${segPct.toFixed(2)}%; background:${dSt.bg};" class="h-full first:rounded-l last:rounded-r border-r border-slate-950/50 last:border-r-0" title="${fromSt.name} → ${dSt.name}: ${cnt}人"></div>`;
              })
              .join('');

            const chipsHtml = sortedDests
              .map(([dIdx, cnt]) => {
                const dSt = STATIONS[dIdx];
                return `<span class="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-slate-900 border border-slate-700/80 text-[9px] font-bold text-slate-200 leading-none"><span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:${dSt.bg}"></span>${dSt.short}<span class="text-slate-400">×${cnt}</span></span>`;
              })
              .join('');

            const fromTag = g.isOriginTransfer
              ? `<span class="text-[8.5px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-black">各停乗継</span>`
              : '';

            return `
              <div class="bg-slate-950/80 border border-slate-800 rounded-lg px-2 py-1.5 flex flex-col gap-1">
                <div class="flex items-center justify-between gap-1.5">
                  <div class="flex items-center gap-1 min-w-0">
                    <span class="shrink-0 text-[8.5px] font-black px-1 py-0.5 rounded text-white leading-none tabular-nums" style="background:${fromSt.bg}">${fromSt.num}</span>
                    <span class="text-[10.5px] font-black text-white truncate">${fromSt.name}発</span>
                    ${fromTag}
                  </div>
                  <span class="shrink-0 text-[10px] font-black text-sky-300 tabular-nums">${g.total}人</span>
                </div>
                <div class="w-full h-2 bg-slate-800/90 rounded overflow-hidden">
                  <div class="h-full flex" style="width:${barWidthPct}%">${segmentsHtml}</div>
                </div>
                <div class="flex flex-wrap gap-1">${chipsHtml}</div>
              </div>
            `;
          })
          .join('');
      }
    }

    // タブ②：乗客ヒートマップ（発駅 × 着駅マトリクス・26駅全線でもスクロール無し1画面フィット）
    if (el.resOdHeatmap) {
      const fromCols = routeStops.filter((idx) => activeFromSet.has(idx));
      const toCols = routeStops.filter((idx) => activeToSet.has(idx));

      if (fromCols.length === 0 || toCols.length === 0) {
        el.resOdHeatmap.innerHTML = `<div class="text-[11px] text-slate-400 text-center py-6">ヒートマップデータがありません</div>`;
      } else {
        const toTwoChars = (st) => {
          if (st.short === '溝ノ口') return '溝口';
          return st.short.slice(0, 2);
        };

        const maxCell = Math.max(1, topPairVal);
        const isDense = toCols.length >= 16 || fromCols.length >= 16;
        const colTotals = toCols.map((tIdx) => {
          let sum = 0;
          fromCols.forEach((fIdx) => { sum += pairCounts.get(`${fIdx}-${tIdx}`) || 0; });
          return sum;
        });

        const getHeatClass = (cnt) => {
          const r = cnt / maxCell;
          if (r >= 0.78) return 'bg-rose-500 text-white font-black';
          if (r >= 0.48) return 'bg-amber-500/85 text-slate-950 font-black';
          if (r >= 0.24) return 'bg-sky-500/75 text-white font-bold';
          return 'bg-sky-900/75 text-sky-200 font-bold';
        };

        const cellTextCls = isDense ? 'text-[7.5px] sm:text-[8.5px] leading-none py-[2px]' : 'text-[9.5px] leading-tight py-1';
        const rowLabelCls = isDense ? 'text-[7.5px] sm:text-[8.5px] leading-none px-1 py-[2px]' : 'text-[9.5px] leading-tight px-1.5 py-1';
        const headTextCls = isDense ? 'text-[7.5px] sm:text-[8px] leading-[1.05] py-0.5' : 'text-[9px] leading-tight py-1';

        const headerCells = toCols
          .map((tIdx) => {
            const st = STATIONS[tIdx];
            const two = toTwoChars(st);
            const labelHtml = isDense ? `${two[0]}<br>${two[1] || ''}` : two;
            return `<th class="px-0 ${headTextCls} text-center font-black text-slate-200 border-b border-slate-700" title="着駅：${st.name}"><div class="mx-auto w-1.5 h-1.5 rounded-full mb-0.5" style="background:${st.bg}"></div><div>${labelHtml}</div></th>`;
          })
          .join('');

        const bodyRows = fromCols
          .map((fIdx) => {
            const fSt = STATIONS[fIdx];
            const two = toTwoChars(fSt);
            let rowSum = 0;
            const cells = toCols
              .map((tIdx) => {
                const cnt = pairCounts.get(`${fIdx}-${tIdx}`) || 0;
                rowSum += cnt;
                if (cnt <= 0) {
                  return `<td class="px-0 ${cellTextCls} text-center text-slate-700 border border-slate-800/50">·</td>`;
                }
                const tSt = STATIONS[tIdx];
                return `<td class="px-0 ${cellTextCls} text-center tabular-nums border border-slate-950/60 ${getHeatClass(cnt)}" title="${fSt.name} → ${tSt.name}: ${cnt}人">${cnt}</td>`;
              })
              .join('');

            return `
              <tr>
                <th class="bg-slate-900 ${rowLabelCls} text-left font-black text-white border-r border-slate-700 whitespace-nowrap" title="発駅：${fSt.name}">
                  <span class="inline-block w-1.5 h-1.5 rounded-full mr-0.5 align-middle" style="background:${fSt.bg}"></span>${two}
                </th>
                ${cells}
                <td class="px-0.5 ${cellTextCls} text-right font-black text-sky-300 tabular-nums border-l border-slate-700">${rowSum}</td>
              </tr>
            `;
          })
          .join('');

        const footerCells = colTotals
          .map((sum) => `<td class="px-0 ${cellTextCls} text-center font-black text-emerald-300 tabular-nums border-t border-slate-700">${sum}</td>`)
          .join('');

        el.resOdHeatmap.innerHTML = `
          <table class="w-full table-fixed border-collapse text-center">
            <colgroup>
              <col style="width: ${isDense ? '34px' : '46px'}" />
              ${toCols.map(() => '<col />').join('')}
              <col style="width: ${isDense ? '22px' : '28px'}" />
            </colgroup>
            <thead>
              <tr>
                <th class="bg-slate-900 px-1 py-0.5 text-left text-[7.5px] sm:text-[8.5px] font-bold text-slate-400 border-b border-r border-slate-700 whitespace-nowrap">発＼着</th>
                ${headerCells}
                <th class="px-0.5 py-0.5 text-right text-[7.5px] sm:text-[8.5px] font-black text-sky-300 border-b border-l border-slate-700">計</th>
              </tr>
            </thead>
            <tbody>
              ${bodyRows}
            </tbody>
            <tfoot>
              <tr>
                <th class="bg-slate-900 ${rowLabelCls} text-left font-black text-emerald-300 border-t border-r border-slate-700 whitespace-nowrap">計</th>
                ${footerCells}
                <td class="px-0.5 ${cellTextCls} text-right font-black text-yellow-300 tabular-nums border-t border-l border-slate-700">${totalBoarded}</td>
              </tr>
            </tfoot>
          </table>
        `;
      }
    }

    // タブ③：スコア詳細
    if (el.resScoreDetail) {
      const fmtPt = (n, sign = '+') => `${sign}${Math.abs(Math.round(n || 0)).toLocaleString()} pt`;
      const modRowsHtml =
        multInfo.modItems.length > 0
          ? multInfo.modItems
              .map(
                (m) => `<div class="flex justify-between items-center text-xs"><span class="text-slate-300">${m.label}</span><span class="font-black text-amber-300 tabular-nums">+${m.bonus.toFixed(2)}</span></div>`
              )
              .join('')
          : `<div class="text-[11px] text-slate-500">追加難易度ボーナスなし（+0.00）</div>`;

      el.resScoreDetail.innerHTML = `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left">
          <!-- 左：基礎スコア内訳 -->
          <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-3 flex flex-col gap-1.5">
            <div class="text-xs font-black text-sky-300 border-b border-slate-800 pb-1">① 基礎スコア内訳</div>
            <div class="flex justify-between text-xs"><span class="text-slate-300">スムーズ降車（基本）</span><span class="font-bold text-white tabular-nums">${fmtPt(bd.smoothBase)}</span></div>
            <div class="flex justify-between text-xs"><span class="text-slate-300">連続ノー詰まりコンボ加点 <span class="text-[10px] text-amber-300">(最大${state.maxPerfectStreak || 0}駅)</span></span><span class="font-bold text-amber-300 tabular-nums">${fmtPt(bd.streakExtra)}</span></div>
            <div class="flex justify-between text-xs"><span class="text-slate-300">一気降車ボーナス（3人以上）</span><span class="font-bold text-emerald-300 tabular-nums">${fmtPt(bd.chainBonus)}</span></div>
            <div class="flex justify-between text-xs"><span class="text-slate-300">早送りボーナス</span><span class="font-bold text-sky-300 tabular-nums">${fmtPt(bd.fastForward)}</span></div>
            <div class="flex justify-between text-xs"><span class="text-slate-300">座席ボーナス</span><span class="font-bold text-slate-200 tabular-nums">${fmtPt(bd.seatBonus)}</span></div>
            <div class="flex justify-between text-xs"><span class="text-slate-300">完走定時ボーナス</span><span class="font-bold text-yellow-300 tabular-nums">${fmtPt(bd.onTimeBonus)}</span></div>
            ${bd.strollerPenalty ? `<div class="flex justify-between text-xs"><span class="text-pink-300">👶 ベビーカー優先外減点</span><span class="font-bold text-rose-400 tabular-nums">${fmtPt(bd.strollerPenalty, '-')}</span></div>` : ''}
            ${bd.elderlyPenalty ? `<div class="flex justify-between text-xs"><span class="text-sky-300">👴 御老人 座席外減点</span><span class="font-bold text-rose-400 tabular-nums">${fmtPt(bd.elderlyPenalty, '-')}</span></div>` : ''}
            <div class="flex justify-between text-xs font-black border-t border-slate-700 pt-1.5 mt-1">
              <span class="text-slate-200">基礎スコア小計</span>
              <span class="text-white tabular-nums">${(bd.baseScore || 0).toLocaleString()} pt</span>
            </div>
          </div>

          <!-- 右：難易度倍率＆最終スコア -->
          <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-3 flex flex-col justify-between gap-2.5">
            <div class="flex flex-col gap-1.5">
              <div class="text-xs font-black text-amber-300 border-b border-slate-800 pb-1">② 難易度・追加設定倍率</div>
              <div class="flex justify-between items-center text-xs">
                <span class="text-slate-300">ダイヤ難易度（${diff.label}）</span>
                <span class="font-black text-white tabular-nums">×${multInfo.baseMult.toFixed(2)}</span>
              </div>
              ${modRowsHtml}
              <div class="flex justify-between text-xs font-black border-t border-slate-700 pt-1.5 mt-1">
                <span class="text-slate-200">合計倍率</span>
                <span class="text-yellow-300 tabular-nums">×${multInfo.totalMult.toFixed(2)}</span>
              </div>
            </div>

            <div class="bg-slate-900 border border-yellow-400/50 rounded-xl p-3 text-center">
              <div class="text-[10px] font-bold text-slate-400">最終スコア（基礎スコア × 合計倍率）</div>
              <div class="text-xs text-slate-300 tabular-nums mt-0.5">${(bd.baseScore || 0).toLocaleString()} × ${multInfo.totalMult.toFixed(2)}</div>
              <div class="text-2xl font-black text-yellow-300 tabular-nums mt-0.5">${state.score.toLocaleString()} pt</div>
            </div>
          </div>
        </div>
      `;
    }

    el.modalResult.classList.remove('hidden');
  }

  function formatTransferSuffix(st, state) {
    if (!st) return '';
    const list = st.transfers ? [...st.transfers] : [];
    if (state && Puzzle.isRapidCourse(state.courseKey)) {
      if (state.courseKey === 'rapid_inagi' && st.num === '18') {
        list.push('立川行各駅停車連絡');
      } else if (state.courseKey === 'rapid_noborito' && st.num === '14') {
        list.push('立川発各駅停車連絡');
      } else if (state.direction === 'down' && st.num === '18') {
        list.push('各駅停車連絡');
      } else if (state.direction === 'up' && st.num === '14') {
        list.push('各駅停車連絡');
      }
    }
    if (list.length === 0) return '';
    return `（乗換：${list.join('・')}）`;
  }

  function formatRunningAnnounce(nextSt, state) {
    return `次は　${nextSt.name}　/　Next ${nextSt.en.toUpperCase()}${formatTransferSuffix(nextSt, state)}`;
  }

  function formatArrivalAnnounce(arrivalSt, state) {
    return `まもなく　${arrivalSt.name}${formatTransferSuffix(arrivalSt, state)}`;
  }

  /**
   * 選択中の運行方向・種別に応じた各駅情報テーブル（縦型の種別通停路線図列を含む）を描画する
   */
  function buildDataTable(el, dirKey, odModeKey, courseKey = 'full', g1Event = false) {
    const dir = DIRECTIONS[dirKey] || DIRECTIONS.down;
    const mode = OD_MODES[odModeKey] || OD_MODES.balanced;
    const isRapid = Puzzle.isRapidCourse(courseKey);
    const routeStops = Puzzle.getRouteStops(courseKey, dir.key);
    const minStop = Math.min(...routeStops);
    const maxStop = Math.max(...routeStops);
    const courseDef = global.NanbuData.COURSES && global.NanbuData.COURSES[courseKey];
    const g1Disallowed = courseKey === 'nishikunitachi' || Boolean(courseDef && courseDef.isNight);
    const g1Active = !!g1Event && !g1Disallowed && routeStops.includes(global.NanbuData.G1_CONFIG.stationIdx);
    const stats = Puzzle.computeDirectionStats(dir.key, mode.key, isRapid, { g1Active, courseKey });
    const routeStopSet = new Set(routeStops);

    // トップ画面の「他の行き先を見る」展開状態に応じて、モーダル内列車切替ボタンの表示/非表示を同期
    const downMoreOpen = el.moreRoutesDown ? !el.moreRoutesDown.classList.contains('hidden') : false;
    const upMoreOpen = el.moreRoutesUp ? !el.moreRoutesUp.classList.contains('hidden') : false;

    document.querySelectorAll('.data-train-opt').forEach((b) => {
      const active = b.dataset.dir === dir.key && b.dataset.course === courseKey;
      const extraDir = b.dataset.extra;
      const shouldHide =
        !active &&
        ((extraDir === 'down' && !downMoreOpen) || (extraDir === 'up' && !upMoreOpen));

      b.className = `${shouldHide ? 'hidden ' : ''}data-train-opt px-2 py-1 rounded-lg border text-[10px] sm:text-[11px] transition ${
        active
          ? 'font-black border-yellow-400 bg-yellow-400/20 text-yellow-200'
          : 'font-bold border-slate-700 bg-slate-800/80 text-slate-300 hover:border-slate-500'
      }`;
    });

    // 路線図列ヘッダーを選択中の種別のみ表示
    if (el.dataRouteColLabel) {
      el.dataRouteColLabel.textContent = isRapid ? '快速' : '各停';
      el.dataRouteColLabel.className = isRapid
        ? 'text-[10px] font-black leading-none text-rose-400'
        : 'text-[10px] font-black leading-none text-yellow-300';
    }

    el.dataTableBody.innerHTML = '';
    const isDown = dir.step > 0;
    // 選んだ列車の運行区間（始発〜終着）のみを表示し、区間外は非表示にする
    const indices = [];
    if (isDown) {
      for (let i = minStop; i <= maxStop; i++) indices.push(i);
    } else {
      for (let i = maxStop; i >= minStop; i--) indices.push(i);
    }

    const totalRows = indices.length;

    indices.forEach((idx, rowPos) => {
      const st = STATIONS[idx];
      const isStoppingHere = routeStopSet.has(idx);
      const stopPos = routeStops.indexOf(idx);
      const isTerminal = stopPos === routeStops.length - 1;
      const nextStopIdx = !isTerminal && stopPos >= 0 ? routeStops[stopPos + 1] : idx;
      const leg = !isTerminal && isStoppingHere ? Puzzle.getLegInfo(idx, nextStopIdx) : { time: 0 };
      const stdSec = leg.time > 0 ? +(leg.time * DIFFICULTIES.normal.timeMult).toFixed(1) : 0;

      let expText = '—';
      if (isStoppingHere && !isTerminal) {
        let suffix = '';
        if (courseKey === 'tachikawa_nakahara' && !isDown) {
          if (idx === 25) suffix = ' (2.2倍)';
          else if (idx === 23 || idx === 22 || idx === 21) suffix = ' (0.7倍)';
          else if (idx === 18 || idx === 17 || idx === 16 || idx === 14 || idx === 12 || idx === 11 || idx === 10) suffix = ' (0.3倍)';
          else if (idx === 8) suffix = ' (0.25倍)';
        } else if (courseKey === 'nishikunitachi' && !isDown) {
          if (idx === 24) suffix = ' (10倍)';
          else if (idx <= 23 && idx >= 14) suffix = ' (2.5倍)';
          else if (idx <= 13 && idx >= 11) suffix = ' (1.2倍)';
          else if (idx === 10) suffix = ' (1.4倍)';
          else if (idx <= 6 && idx >= 1) suffix = ' (1.5倍)';
        } else if (!isDown && (courseKey === 'rapid' || courseKey === 'full') && idx === 25) {
          suffix = ' (1.5倍)';
        } else if (courseKey === 'rapid_noborito' && idx === 13) {
          suffix = ' (乗継込)';
        }
        if (g1Active && idx === global.NanbuData.G1_CONFIG.stationIdx) {
          suffix += ' (G1)';
        }

        if (stats.expBoard[idx] < 1) {
          expText = `1.0* (${stats.expBoard[idx].toFixed(2)})${suffix}`;
        } else {
          expText = `${stats.expBoard[idx].toFixed(1)}人${suffix}`;
        }
      } else if (!isStoppingHere) {
        expText = '通過';
      }

      // 縦路線図の上下端処理（始端は中央から下へ、終端は上から中央まで、途中駅は上下貫通）
      const lineSpanClass =
        rowPos === 0
          ? 'top-1/2 -bottom-[1px]'
          : rowPos === totalRows - 1
            ? '-top-[1px] bottom-1/2'
            : '-top-[1px] -bottom-[1px]';

      // 該当する快速を選んだ場合のみ、その列車の接続状況を表示
      let connText = '';
      if (courseKey === 'rapid' && dir.key === 'down' && idx === RAPID_CONNECTIONS.down.transferStationIdx) {
        connText = '下り各停連絡';
      } else if (courseKey === 'rapid' && dir.key === 'up' && idx === RAPID_CONNECTIONS.up.transferStationIdx) {
        connText = '上り各停連絡';
      } else if (courseKey === 'rapid_inagi' && idx === 17) {
        connText = '立川行各停連絡';
      } else if (courseKey === 'rapid_noborito' && idx === 13) {
        connText = '立川発各停連絡';
      }
      const isConn = Boolean(connText);

      // 選択中の種別ライン＆ノードのみ描画
      const lineColorClass = isRapid ? 'bg-rose-500' : 'bg-yellow-400';
      let nodeHtml = '';
      if (!isRapid) {
        nodeHtml = `<span class="relative z-10 w-3 h-3 rounded-full bg-white border-[2.5px] border-yellow-500 shadow-sm"></span>`;
      } else if (isStoppingHere) {
        nodeHtml = `<span class="relative z-10 w-3.5 h-3.5 rounded-full flex items-center justify-center ${
          isConn
            ? 'bg-amber-300 border-2 border-white ring-2 ring-rose-500 shadow'
            : 'bg-white border-[2.5px] border-rose-500 shadow-sm'
        }" title="${isConn ? `快速停車（${connText}）` : '快速停車'}"></span>`;
      }

      const connLabelHtml = isConn
        ? `<span class="ml-1.5 text-[9px] font-bold px-1 py-0.5 rounded bg-amber-400/15 text-amber-300 border border-amber-400/40">${connText}</span>`
        : '';

      const tr = document.createElement('tr');
      tr.className = `h-8 ${!isStoppingHere ? 'bg-slate-900/40' : ''}`;
      tr.innerHTML = `
        <td class="p-1.5 font-black whitespace-nowrap ${!isStoppingHere ? 'opacity-50' : ''}">
          <span class="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style="background:${st.bg}"></span>${st.num}
        </td>
        <td class="p-1.5 font-bold whitespace-nowrap ${!isStoppingHere ? 'opacity-50 text-slate-400' : 'text-white'}">
          <span>${st.name}</span>${connLabelHtml}
        </td>
        <td class="p-0 relative w-20 select-none">
          <div class="relative w-full h-8 flex items-center justify-center">
            <div class="relative w-8 h-full flex items-center justify-center">
              <div class="absolute left-1/2 -translate-x-1/2 w-1.5 ${lineColorClass} ${lineSpanClass}"></div>
              ${nodeHtml}
            </div>
          </div>
        </td>
        <td class="p-1.5 text-right tabular-nums font-bold ${!isStoppingHere ? 'opacity-50 text-slate-500' : leg.time === 7 ? 'text-rose-400' : leg.time >= 13 ? 'text-emerald-400' : 'text-slate-200'}">
          ${!isStoppingHere ? '通過' : stdSec > 0 ? stdSec + '秒' : '終点'}
        </td>
        <td class="p-1.5 text-right tabular-nums font-bold ${!isStoppingHere ? 'opacity-50 text-slate-500' : 'text-sky-300'}">${expText}</td>
      `;
      el.dataTableBody.appendChild(tr);
    });
  }

  function syncCarLayout(el) {
    if (!el || !el.mainStage || !el.carBody || !el.gridStage) return;
    const mainStyle = global.getComputedStyle(el.mainStage);
    const mainPadX = (parseFloat(mainStyle.paddingLeft) || 0) + (parseFloat(mainStyle.paddingRight) || 0);
    const availMainW = Math.max(0, el.mainStage.clientWidth - mainPadX);
    const maxCarW = Math.min(660, availMainW);

    const carStyle = global.getComputedStyle(el.carBody);
    const carChromeX =
      (parseFloat(carStyle.borderLeftWidth) || 0) +
      (parseFloat(carStyle.borderRightWidth) || 0) +
      (parseFloat(carStyle.paddingLeft) || 0) +
      (parseFloat(carStyle.paddingRight) || 0);

    const availStageW = Math.max(0, maxCarW - carChromeX);
    const availStageH = el.gridStage.clientHeight;
    if (availStageW <= 0 || availStageH <= 0) return;

    const targetGridW = Math.min(availStageW, (availStageH * COLS) / ROWS);
    const targetCarW = Math.round(targetGridW + carChromeX);
    const widthStr = `${targetCarW}px`;

    el.carBody.style.width = widthStr;
    if (el.sceneryWrap) el.sceneryWrap.style.width = widthStr;
    if (el.doorsPlatformWrap) el.doorsPlatformWrap.style.width = widthStr;
  }

  global.NanbuUI = {
    cacheElements,
    initGridDOM,
    syncCarLayout,
    getCellEl,
    getNextStopIdx,
    spawnFloatText,
    triggerShake,
    updateReachabilityCounters,
    formatRunningAnnounce,
    formatArrivalAnnounce,
    renderGrid,
    updateHUD,
    updateTimerUI,
    updateFastForwardHint,
    renderResultModal,
    buildDataTable,
  };
})(window);
