/**
 * なぜ南武線は混んでるのか？ - パズル・運行ロジック層
 * DOMに依存しない盤面計算・BFS降車到達判定・第13回実ODによる2段階確率乗客生成（快速・緩急接続対応）・上下線区間制御を担当する。
 */
(function (global) {
  'use strict';

  const {
    BOARD_CONFIG,
    STATIONS,
    OD_MATRIX_13,
    DIRECTIONS,
    OD_MODES,
    DIFFICULTIES,
    MODIFIER_SCORE_BONUSES,
    COURSES,
    RAPID_STOPS,
    RAPID_SEGMENT_TIMES,
    RAPID_CONNECTIONS,
    G1_CONFIG,
    GUARANTEED_PASSENGERS,
    JIZO_CELLS,
    PRIORITY_SPACES,
    STROLLER_CONFIG,
    ELDERLY_CONFIG,
    HIGHSCORE_CONFIG,
    TRAIN_ORDER,
  } = global.NanbuData;
  const { ROWS, COLS, MAX_CAPACITY, PEAK_TARGET, DOOR_CELLS } = BOARD_CONFIG;
  const STATION_COUNT = STATIONS.length;
  const STATS_STATION_COUNT = STATIONS.length;
  const RAPID_STOP_SET = new Set(RAPID_STOPS);
  const VALID_TRAIN_SET = new Set(Array.isArray(TRAIN_ORDER) ? TRAIN_ORDER : []);

  function createEmptyGrid() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  function isSeatCell(r, c) {
    return r === 0 && c >= 1 && c <= 6;
  }

  function isDoorCell(r, c) {
    return r === 4 && (c === 1 || c === 2 || c === 5 || c === 6);
  }

  function isPriorityCell(r, c) {
    return PRIORITY_SPACES.some((pair) => pair.some((cell) => cell.r === r && cell.c === c));
  }

  function isStrollerInPrioritySpace(topR, topC) {
    return PRIORITY_SPACES.some(
      (pair) => pair[0].r === topR && pair[0].c === topC && pair[1].r === topR + 1 && pair[1].c === topC
    );
  }

  function getActiveStrollers(grid) {
    const list = [];
    for (let r = 0; r < ROWS - 1; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = grid[r][c];
        if (p && p.strollerGroupId && p.strollerPart === 'top') {
          list.push({
            groupId: p.strollerGroupId,
            topR: r,
            topC: c,
            bottomR: r + 1,
            bottomC: c,
            destIdx: p.destIdx,
            inPriority: isStrollerInPrioritySpace(r, c),
          });
        }
      }
    }
    return list;
  }

  function getActiveElderly(grid) {
    const list = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = grid[r][c];
        if (p && p.isElderly) {
          list.push({
            r,
            c,
            uid: p.uid,
            destIdx: p.destIdx,
            inSeat: isSeatCell(r, c),
          });
        }
      }
    }
    return list;
  }

  function findStrollerTop(grid, r, c) {
    const p = grid[r][c];
    if (!p || !p.strollerGroupId) return null;
    if (p.strollerPart === 'top') return { r, c };
    if (r > 0 && grid[r - 1][c] && grid[r - 1][c].strollerGroupId === p.strollerGroupId) {
      return { r: r - 1, c };
    }
    return null;
  }

  /**
   * 縦2マス固定ベビーカーを上下左右に1マス移動する（地蔵・他ベビーカーとの衝突を厳密に回避）
   */
  function tryMoveStroller(grid, topR, topC, dr, dc) {
    const topP = grid[topR][topC];
    const botP = grid[topR + 1] ? grid[topR + 1][topC] : null;
    if (!topP || !botP || !topP.strollerGroupId || topP.strollerGroupId !== botP.strollerGroupId) {
      return { moved: false };
    }

    if (dr === -1 && dc === 0) {
      // 上へ1マス
      const nr = topR - 1;
      if (nr < 0) return { moved: false };
      const target = grid[nr][topC];
      if (target && (target.isJizo || target.strollerGroupId)) return { moved: false };
      grid[nr][topC] = topP;
      grid[topR][topC] = botP;
      grid[topR + 1][topC] = target;
      return { moved: true, newTopR: nr, newTopC: topC };
    }

    if (dr === 1 && dc === 0) {
      // 下へ1マス
      const nr = topR + 2;
      if (nr >= ROWS) return { moved: false };
      const target = grid[nr][topC];
      if (target && (target.isJizo || target.strollerGroupId)) return { moved: false };
      grid[nr][topC] = botP;
      grid[topR + 1][topC] = topP;
      grid[topR][topC] = target;
      return { moved: true, newTopR: topR + 1, newTopC: topC };
    }

    if (dr === 0 && (dc === -1 || dc === 1)) {
      // 左右へ1マス（2マスまとめてスワップ）
      const nc = topC + dc;
      if (nc < 0 || nc >= COLS) return { moved: false };
      const tTop = grid[topR][nc];
      const tBot = grid[topR + 1][nc];
      if ((tTop && tTop.isJizo) || (tBot && tBot.isJizo)) return { moved: false };

      // 隣に別のベビーカーがある場合は、縦位置が完全一致するときのみ2セット同士でスワップ許可
      const tTopG = tTop && tTop.strollerGroupId ? tTop.strollerGroupId : null;
      const tBotG = tBot && tBot.strollerGroupId ? tBot.strollerGroupId : null;
      if (tTopG || tBotG) {
        if (!(tTopG && tTopG === tBotG)) return { moved: false };
      }

      grid[topR][nc] = topP;
      grid[topR + 1][nc] = botP;
      grid[topR][topC] = tTop;
      grid[topR + 1][topC] = tBot;
      return { moved: true, newTopR: topR, newTopC: nc };
    }

    return { moved: false };
  }

  function isRapidStop(stationIdx) {
    return RAPID_STOP_SET.has(stationIdx);
  }

  function isRapidCourse(courseKey) {
    return Boolean(COURSES[courseKey] && COURSES[courseKey].isRapid);
  }

  function getMinDoorDistance(r, c) {
    let minDist = 99;
    for (const d of DOOR_CELLS) {
      const dist = Math.abs(r - d.r) + Math.abs(c - d.c);
      if (dist < minDist) minDist = dist;
    }
    return minDist;
  }

  function formatMinSec(sec) {
    const s = Math.max(0, Math.round(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  /**
   * コースと運行方向から、実際に停車する駅インデックス配列を順番通りに返す
   */
  function getRouteStops(courseKey, dirKey) {
    const dir = DIRECTIONS[dirKey] || DIRECTIONS.down;
    if (courseKey === 'rapid') {
      return dir.step > 0 ? [...RAPID_STOPS] : [...RAPID_STOPS].reverse();
    }
    if (courseKey === 'rapid_inagi') {
      return RAPID_STOPS.filter((s) => s <= 17);
    }
    if (courseKey === 'rapid_noborito') {
      return RAPID_STOPS.filter((s) => s <= 13).reverse();
    }

    let startIdx = courseKey === 'trial' ? dir.trialStart : dir.fullStart;
    let endIdx = courseKey === 'trial' ? dir.trialEnd : dir.fullEnd;

    if (courseKey === 'nakahara') {
      startIdx = dir.step > 0 ? 0 : 7;
      endIdx = dir.step > 0 ? 7 : 0;
    } else if (courseKey === 'noborito') {
      startIdx = 0;
      endIdx = 13;
    } else if (courseKey === 'nishikunitachi') {
      startIdx = 24;
      endIdx = 0;
    } else if (courseKey === 'mizonokuchi') {
      startIdx = 9;
      endIdx = 0;
    } else if (courseKey === 'inagi_naganuma') {
      startIdx = 17;
      endIdx = 0;
    } else if (courseKey === 'tachikawa_nakahara') {
      startIdx = 25;
      endIdx = 7;
    }

    const step = endIdx >= startIdx ? 1 : -1;
    const stops = [];
    for (let i = startIdx; ; i += step) {
      stops.push(i);
      if (i === endIdx) break;
    }
    return stops;
  }

  /**
   * 発駅と次停車駅から、走行区間の実距離・標準時間・多摩川鉄橋フラグを取得する（各停・快速両対応）
   */
  function getLegInfo(fromIdx, nextIdx) {
    if (fromIdx === nextIdx || nextIdx === undefined || nextIdx === null) {
      return { fromIdx, nextIdx: fromIdx, dist: 0, time: 0, isBridge: false };
    }
    const lo = Math.min(fromIdx, nextIdx);
    const hi = Math.max(fromIdx, nextIdx);
    let dist = 0;
    let time = 0;
    let isBridge = false;

    for (let k = lo; k < hi; k++) {
      dist += STATIONS[k].dist;
      time += STATIONS[k].time;
      if (STATIONS[k].isBridge) isBridge = true;
    }

    const rapidKey = `${lo}-${hi}`;
    if (hi - lo > 1 && RAPID_SEGMENT_TIMES[rapidKey]) {
      time = RAPID_SEGMENT_TIMES[rapidKey];
    }

    return {
      fromIdx,
      nextIdx,
      dist: +dist.toFixed(1),
      time,
      isBridge,
    };
  }

  function getOccupancy(grid) {
    let count = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c]) count++;
      }
    }
    return count;
  }

  function countDestinations(grid) {
    const destCounts = {};
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = grid[r][c];
        if (!p) continue;
        destCounts[p.destIdx] = (destCounts[p.destIdx] || 0) + 1;
      }
    }
    return destCounts;
  }

  function countSeatedPassengers(grid) {
    let seatedCount = 0;
    for (let c = 1; c <= 6; c++) {
      const p = grid[0][c];
      if (p && !p.strollerGroupId) seatedCount++;
    }
    return seatedCount;
  }

  /**
   * BFSによるリアルタイム降車到達判定
   * 条件：「ドア前マスにいる」または「空きマスか同じ次駅降車客だけを経由して
   *       ドア前マスに4近傍で到達できる」次駅降車客は OK
   */
  function evaluateReachability(grid, nextIdx) {
    const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    const queue = [];

    for (const d of DOOR_CELLS) {
      const p = grid[d.r][d.c];
      if (!p || p.destIdx === nextIdx) {
        visited[d.r][d.c] = true;
        queue.push({ r: d.r, c: d.c });
      }
    }

    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const [dr, dc] of dirs) {
        const nr = cur.r + dr;
        const nc = cur.c + dc;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || visited[nr][nc]) continue;
        const p = grid[nr][nc];
        if (!p || p.destIdx === nextIdx) {
          visited[nr][nc] = true;
          queue.push({ r: nr, c: nc });
        }
      }
    }

    // ベビーカー（同一 strollerGroupId の上下2マス）はどちらかが到達可能なら全体 OK とし、2人分（2マス）として集計
    const strollerReach = new Map();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = grid[r][c];
        if (p && p.destIdx === nextIdx && p.strollerGroupId) {
          const prev = strollerReach.get(p.strollerGroupId) || false;
          strollerReach.set(p.strollerGroupId, prev || visited[r][c]);
        }
      }
    }

    const reachability = new Map();
    let total = 0;
    let ok = 0;
    let blocked = 0;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = grid[r][c];
        if (p && p.destIdx === nextIdx) {
          const canReach = p.strollerGroupId ? !!strollerReach.get(p.strollerGroupId) : visited[r][c];
          reachability.set(p.uid, canReach);
          total++;
          if (canReach) ok++;
          else blocked++;
        }
      }
    }

    return { reachability, total, ok, blocked };
  }

  /**
   * 到着駅の降車対象を「OK（ドア近い順）」と「!詰」に仕分ける。
   * 同一 strollerGroupId を持つ縦2マスベビーカーは 1 つの降車ユニットとしてまとめる。
   */
  function partitionAlightingTargets(grid, arrivalIdx, reachability) {
    const okTargets = [];
    const blockedTargets = [];
    const strollerBuckets = new Map();

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = grid[r][c];
        if (!p || p.destIdx !== arrivalIdx) continue;

        if (p.strollerGroupId) {
          if (!strollerBuckets.has(p.strollerGroupId)) {
            strollerBuckets.set(p.strollerGroupId, []);
          }
          strollerBuckets.get(p.strollerGroupId).push({ r, c, p });
        } else {
          const item = {
            r,
            c,
            p,
            cells: [{ r, c, p }],
            minDist: getMinDoorDistance(r, c),
            isStroller: false,
          };
          if (reachability.get(p.uid)) okTargets.push(item);
          else blockedTargets.push(item);
        }
      }
    }

    strollerBuckets.forEach((cells) => {
      // 上段セルを代表座標とする（フロートテキスト表示用）
      const topCell = cells.find((item) => item.p.strollerPart === 'top') || cells[0];
      const minDist = Math.min(...cells.map((item) => getMinDoorDistance(item.r, item.c)));
      const isOk = cells.some((item) => reachability.get(item.p.uid));
      const unit = {
        r: topCell.r,
        c: topCell.c,
        p: topCell.p,
        cells,
        minDist,
        isStroller: true,
      };
      if (isOk) okTargets.push(unit);
      else blockedTargets.push(unit);
    });

    okTargets.sort((a, b) => a.minDist - b.minDist);
    return { okTargets, blockedTargets };
  }

  /**
   * 種別（各停／快速）と運行方向・コースに応じた有効OD行列（26×26）を構築する
   * - 各停：OD_MATRIX_13 をそのまま使用
   * - 快速（全線）：快速停車駅発のみ有効。緩急接続駅（下り：稲城長沼17、上り：登戸13）より
   *                 手前から乗車し、連絡対象の通過駅へ向かう旅客は緩急接続駅への乗換客として合算。
   * - 快速 稲城長沼行（rapid_inagi）：終点稲城長沼で立川行きに連絡するため、南多摩(18)〜立川(25)へ向かう旅客を全て稲城長沼(17)行きへ合算。
   * - 登戸発 快速 川崎行（rapid_noborito）：始発登戸(13)で立川(25)〜中野島(14)からの各停に連絡するため、それらの旅客も登戸発の快速停車駅(9..0)行きへ合算。
   */
  function buildEffectiveODMatrix(dirKey, isRapid = false, g1Active = false, courseKey = '') {
    const isDown = dirKey !== 'up';
    const mat = Array.from({ length: STATION_COUNT }, () => Array(STATION_COUNT).fill(0));

    if (courseKey === 'rapid_inagi') {
      for (let i = 0; i < 17; i++) {
        if (!RAPID_STOP_SET.has(i)) continue;
        for (let j = i + 1; j < STATION_COUNT; j++) {
          const v = OD_MATRIX_13[i][j];
          if (v <= 0) continue;
          if (j >= 18) {
            // 南多摩〜立川方面の旅客はすべて終点・稲城長沼（立川行連絡）行きとして湧く
            mat[i][17] += v;
          } else if (RAPID_STOP_SET.has(j)) {
            mat[i][j] += v;
          }
        }
      }
    } else if (courseKey === 'rapid_noborito') {
      const targetStops = RAPID_STOPS.filter((s) => s < 13);
      // 始発・登戸(13)：登戸発の旅客 ＋ 立川(25)〜中野島(14)からの各停乗継旅客
      for (const j of targetStops) {
        mat[13][j] += OD_MATRIX_13[13][j];
        for (let k = 14; k < STATION_COUNT; k++) {
          mat[13][j] += OD_MATRIX_13[k][j];
        }
      }
      // 途中停車駅（武蔵溝ノ口〜鹿島田）
      for (const i of targetStops) {
        if (i === 0) continue;
        for (const j of targetStops) {
          if (j < i) {
            mat[i][j] += OD_MATRIX_13[i][j];
          }
        }
      }
    } else if (!isRapid) {
      const routeStops = courseKey ? getRouteStops(courseKey, dirKey) : null;
      const minStop = routeStops ? Math.min(...routeStops) : 0;
      const maxStop = routeStops ? Math.max(...routeStops) : STATION_COUNT - 1;
      for (let i = minStop; i <= maxStop; i++) {
        for (let j = minStop; j <= maxStop; j++) {
          if ((isDown && i < j) || (!isDown && i > j)) {
            mat[i][j] = OD_MATRIX_13[i][j];
          }
        }
      }
    } else {
      const routeStops = courseKey ? getRouteStops(courseKey, dirKey) : null;
      const minStop = routeStops ? Math.min(...routeStops) : 0;
      const maxStop = routeStops ? Math.max(...routeStops) : STATION_COUNT - 1;
      const conn = isDown ? RAPID_CONNECTIONS.down : RAPID_CONNECTIONS.up;
      const transferIdx = conn.transferStationIdx;
      const coveredSet = new Set(conn.coveredPassingStops);

      for (let i = minStop; i <= maxStop; i++) {
        if (!RAPID_STOP_SET.has(i)) continue;
        for (let j = minStop; j <= maxStop; j++) {
          if ((isDown && j <= i) || (!isDown && j >= i)) continue;
          const v = OD_MATRIX_13[i][j];
          if (v <= 0) continue;

          if (RAPID_STOP_SET.has(j)) {
            mat[i][j] += v;
          } else if (coveredSet.has(j)) {
            // 緩急接続駅より手前から乗車した場合のみ、緩急接続駅で各駅停車へ乗り換える
            if ((isDown && i < transferIdx) || (!isDown && i > transferIdx)) {
              mat[i][transferIdx] += v;
            }
          }
        }
      }
    }

    // G1開催時：府中本町(19)の乗降ODをブースト
    if (g1Active) {
      const f = G1_CONFIG.stationIdx;
      for (let i = 0; i < STATION_COUNT; i++) {
        if (mat[i][f] > 0) mat[i][f] = Math.round(mat[i][f] * G1_CONFIG.alightMult);
      }
      for (let j = 0; j < STATION_COUNT; j++) {
        if (mat[f][j] > 0) mat[f][j] = Math.round(mat[f][j] * G1_CONFIG.boardMult);
      }
    }

    return mat;
  }

  /**
   * 第13回OD行列から、指定方向・スケーリング方式・種別における駅別乗降・断面期待値を算出する
   */
  function computeDirectionStats(dirKey, odModeKey, isRapid = false, options = {}) {
    const isDown = dirKey !== 'up';
    const mode = OD_MODES[odModeKey] || OD_MODES.balanced;
    const gamma = mode.gamma;
    const g1Active = !!options.g1Active;
    const courseKey = options.courseKey || '';
    const peakTarget = options.peakTarget || (g1Active ? G1_CONFIG.peakTarget : PEAK_TARGET);
    const effOD = buildEffectiveODMatrix(dirKey, isRapid, g1Active, courseKey);

    const rawBoard = Array(STATION_COUNT).fill(0);
    const rawAlight = Array(STATION_COUNT).fill(0);
    const rawSection = Array(STATION_COUNT - 1).fill(0);

    for (let i = 0; i < STATION_COUNT; i++) {
      for (let j = 0; j < STATION_COUNT; j++) {
        if ((isDown && i < j) || (!isDown && i > j)) {
          const v = effOD[i][j];
          if (v <= 0) continue;
          rawBoard[i] += v;
          rawAlight[j] += v;
          const lo = Math.min(i, j);
          const hi = Math.max(i, j);
          for (let k = lo; k < hi; k++) {
            rawSection[k] += v;
          }
        }
      }
    }

    const peakRaw = Math.max(1, ...rawSection);
    const transBoard = rawBoard.map((v) => (v > 0 ? Math.pow(v, gamma) : 0));

    // シナリオ固有の期待乗車倍率をピーク正規化より前に適用し、倍率後の断面負荷で peakTarget へ正規化する
    if (courseKey === 'tachikawa_nakahara' && !isDown) {
      // 終電間際（立川発 武蔵中原行）
      transBoard[25] *= 2.2;                           // 立川 2.2倍
      [23, 22, 21].forEach((i) => { transBoard[i] *= 0.7; });              // 矢川・谷保・西府 0.7倍
      [18, 17, 16, 14, 12, 11, 10].forEach((i) => { transBoard[i] *= 0.3; }); // 南多摩〜矢野口・中野島・宿河原〜津田山 0.3倍
      transBoard[8] *= 0.25;                           // 新城 0.25倍
    } else if (courseKey === 'nishikunitachi' && !isDown) {
      // 朝ラッシュ（西国立発 川崎行）：西国立10倍・矢川〜中野島2.5倍・登戸〜久地1.2倍・津田山1.4倍・武蔵小杉〜尻手1.5倍
      transBoard[24] *= 10;
      for (let i = 23; i >= 14; i--) {
        transBoard[i] *= 2.5;
      }
      for (let i = 13; i >= 11; i--) {
        transBoard[i] *= 1.2;
      }
      transBoard[10] *= 1.4;
      for (let i = 6; i >= 1; i--) {
        transBoard[i] *= 1.5;
      }
    } else if (!isDown && (courseKey === 'rapid' || courseKey === 'full')) {
      // 立川発 快速 川崎行 / 立川発 川崎行：立川 1.5倍
      transBoard[25] *= 1.5;
    }

    const transSection = Array(STATION_COUNT - 1).fill(0);

    for (let i = 0; i < STATION_COUNT; i++) {
      if (rawBoard[i] <= 0 || transBoard[i] <= 0) continue;
      for (let j = 0; j < STATION_COUNT; j++) {
        if ((isDown && i < j) || (!isDown && i > j)) {
          const v = effOD[i][j];
          if (v <= 0) continue;
          const scaled = transBoard[i] * (v / rawBoard[i]);
          const lo = Math.min(i, j);
          const hi = Math.max(i, j);
          for (let k = lo; k < hi; k++) {
            transSection[k] += scaled;
          }
        }
      }
    }

    const peakTrans = Math.max(1e-6, ...transSection);
    const scale = peakTrans / peakTarget;
    const expBoard = transBoard.map((v) => v / scale);
    const expSection = transSection.map((v) => v / scale);
    const expAlight = Array(STATION_COUNT).fill(0);

    for (let i = 0; i < STATION_COUNT; i++) {
      if (rawBoard[i] <= 0 || expBoard[i] <= 0) continue;
      for (let j = 0; j < STATION_COUNT; j++) {
        if ((isDown && i < j) || (!isDown && i > j)) {
          expAlight[j] += expBoard[i] * (effOD[i][j] / rawBoard[i]);
        }
      }
    }

    return {
      effOD,
      rawBoard,
      rawAlight,
      rawSection,
      expBoard,
      expAlight,
      expSection,
      peakRaw,
      unitTripsPerTile: peakRaw / peakTarget,
    };
  }

  /**
   * 任意の着駅重み配列から1人ぶんの着駅を抽選する
   */
  function sampleDestinationFromWeights(weights, endIdx, isDown) {
    let totalWeight = 0;
    const candidates = [];
    for (let j = 0; j < weights.length; j++) {
      const w = weights[j];
      if (w > 0) {
        candidates.push({ destIdx: j, weight: w });
        totalWeight += w;
      }
    }
    if (totalWeight <= 0) return endIdx;
    let r = Math.random() * totalWeight;
    let chosen = candidates[candidates.length - 1].destIdx;
    for (const item of candidates) {
      r -= item.weight;
      if (r <= 0) {
        chosen = item.destIdx;
        break;
      }
    }
    return isDown ? Math.min(chosen, endIdx) : Math.max(chosen, endIdx);
  }

  /**
   * 発駅 i の有効OD行から、終点 endIdx までの停車範囲内で着駅を重み付き抽選する。
   * （終点より先の目的地を終点行きに集約する処理は buildEffectiveODMatrix 側の「川崎発 快速 稲城長沼行」のみ適用）
   */
  function sampleDestinationFromOD(effOD, stationIdx, endIdx, isDown) {
    let totalWeight = 0;
    const candidates = [];

    for (let j = 0; j < STATION_COUNT; j++) {
      if ((isDown && j > stationIdx && j <= endIdx) || (!isDown && j < stationIdx && j >= endIdx)) {
        const w = effOD[stationIdx][j];
        if (w > 0) {
          candidates.push({ destIdx: j, weight: w });
          totalWeight += w;
        }
      }
    }

    if (totalWeight <= 0) return endIdx;

    let r = Math.random() * totalWeight;
    let chosen = candidates[candidates.length - 1].destIdx;
    for (const item of candidates) {
      r -= item.weight;
      if (r <= 0) {
        chosen = item.destIdx;
        break;
      }
    }

    return chosen;
  }

  /**
   * 1運行ぶんの全停車駅乗車スケジュールを第13回実ODから2段階確率生成する
   * - Stage 1: 期待乗車数を確率的丸め（Stochastic Rounding）＋ 全停車駅最低1人保証
   * - Stage 2: 乗客ごとに有効OD行列（快速時は緩急接続反映済み）から着駅を重み付き抽選
   * - 最大乗車数が40マス以内に収まる試行を採用し、理不尽なランダム積み残しを防止
   */
  function generateRunSchedule(courseKey, dirKey, odModeKey, diffKey, allocateUid, options = {}) {
    const dir = DIRECTIONS[dirKey] || DIRECTIONS.down;
    const isDown = dir.step > 0;
    const isRapid = isRapidCourse(courseKey);
    const routeStops = getRouteStops(courseKey, dirKey);
    const endIdx = routeStops[routeStops.length - 1];
    const boardingStops = routeStops.slice(0, -1);

    const doorJizo = !!options.doorJizo;
    const jizoReserve = doorJizo ? JIZO_CELLS.length : 0;
    const effectiveCap = MAX_CAPACITY - jizoReserve;
    const g1Active = !!options.g1Event && routeStops.includes(G1_CONFIG.stationIdx);
    const peakTarget = g1Active
      ? Math.min(G1_CONFIG.peakTarget, effectiveCap - 2)
      : Math.min(PEAK_TARGET, effectiveCap - 2);

    const stats = computeDirectionStats(dirKey, odModeKey, isRapid, { g1Active, peakTarget, courseKey });
    const guaranteedRules = (GUARANTEED_PASSENGERS && GUARANTEED_PASSENGERS[`${dirKey}:${courseKey}`]) || [];

    // 登戸発快速川崎行用：登戸固有ODと立川〜中野島乗継ODの比率・重みを事前算出
    let noboritoLocalWeights = null;
    let noboritoTransferWeights = null;
    let noboritoLocalRatio = 0.33;
    if (courseKey === 'rapid_noborito') {
      const targetStops = RAPID_STOPS.filter((s) => s < 13);
      noboritoLocalWeights = Array(STATION_COUNT).fill(0);
      noboritoTransferWeights = Array(STATION_COUNT).fill(0);
      let sumLocal = 0;
      let sumTransfer = 0;
      for (const j of targetStops) {
        noboritoLocalWeights[j] = OD_MATRIX_13[13][j];
        sumLocal += OD_MATRIX_13[13][j];
        let tr = 0;
        for (let k = 14; k < STATION_COUNT; k++) tr += OD_MATRIX_13[k][j];
        noboritoTransferWeights[j] = tr;
        sumTransfer += tr;
      }
      if (sumLocal + sumTransfer > 0) {
        noboritoLocalRatio = sumLocal / (sumLocal + sumTransfer);
      }
    }

    const MAX_ATTEMPTS = 80;
    let bestPlan = null;
    let bestTransferDests = [];
    let bestMaxOcc = Infinity;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const plan = new Map();
      let transferDests = [];
      const onboardByDest = new Map();
      let curOcc = 0;
      let maxOcc = 0;

      for (const s of boardingStops) {
        const alighting = onboardByDest.get(s) || 0;
        if (alighting > 0) {
          curOcc -= alighting;
          onboardByDest.delete(s);
        }

        const stationGuarantees = guaranteedRules.filter((r) => r.boardIdx === s);
        const guaranteedTotal = stationGuarantees.reduce((acc, r) => acc + r.count, 0);

        const lam = stats.expBoard[s];
        const fl = Math.floor(lam);
        let cnt = fl + (Math.random() < lam - fl ? 1 : 0);
        const minStationCnt =
          courseKey === 'rapid_noborito' && s === 13
            ? Math.max(2, guaranteedTotal)
            : Math.max(1, guaranteedTotal);
        if (cnt < minStationCnt) cnt = minStationCnt;
        if (cnt > effectiveCap) {
          cnt = effectiveCap;
        }

        if (courseKey === 'rapid_noborito' && s === 13) {
          const localCnt = Math.max(1, Math.min(cnt - 1, Math.round(cnt * noboritoLocalRatio)));
          const transferCnt = Math.max(1, cnt - localCnt);
          const localList = [];
          for (let i = 0; i < localCnt; i++) {
            const destIdx = sampleDestinationFromWeights(noboritoLocalWeights, endIdx, false);
            localList.push({ destIdx, isGuaranteed: false });
            onboardByDest.set(destIdx, (onboardByDest.get(destIdx) || 0) + 1);
          }
          const trList = [];
          for (let i = 0; i < transferCnt; i++) {
            const destIdx = sampleDestinationFromWeights(noboritoTransferWeights, endIdx, false);
            trList.push({ destIdx, isGuaranteed: false });
            onboardByDest.set(destIdx, (onboardByDest.get(destIdx) || 0) + 1);
          }
          for (let i = localList.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [localList[i], localList[j]] = [localList[j], localList[i]];
          }
          for (let i = trList.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [trList[i], trList[j]] = [trList[j], trList[i]];
          }
          curOcc += localList.length + trList.length;
          if (curOcc > maxOcc) maxOcc = curOcc;
          plan.set(s, localList);
          transferDests = trList;
          continue;
        }

        // 最低保証枠を先頭へ確保し（isGuaranteed: true）、残り人数を通常通り実ODから抽選する
        const destList = [];
        for (const rule of stationGuarantees) {
          for (let g = 0; g < rule.count && destList.length < cnt; g++) {
            destList.push({ destIdx: rule.destIdx, isGuaranteed: true });
            onboardByDest.set(rule.destIdx, (onboardByDest.get(rule.destIdx) || 0) + 1);
          }
        }
        const remainingCnt = cnt - destList.length;
        for (let i = 0; i < remainingCnt; i++) {
          const destIdx = sampleDestinationFromOD(stats.effOD, s, endIdx, isDown);
          destList.push({ destIdx, isGuaranteed: false });
          onboardByDest.set(destIdx, (onboardByDest.get(destIdx) || 0) + 1);
        }

        curOcc += cnt;
        if (curOcc > maxOcc) maxOcc = curOcc;
        plan.set(s, destList);
      }

      if (maxOcc < bestMaxOcc) {
        bestMaxOcc = maxOcc;
        bestPlan = plan;
        bestTransferDests = transferDests;
      }
      if (maxOcc <= effectiveCap) {
        break;
      }
    }

    const schedule = new Map();
    let originTransferPassengers = [];
    const verifyOnboard = new Map();
    let curOcc = 0;
    let finalMaxOcc = 0;

    for (const s of boardingStops) {
      const al = verifyOnboard.get(s) || 0;
      if (al > 0) {
        curOcc -= al;
        verifyOnboard.delete(s);
      }

      const rawDests = bestPlan.get(s) || [];
      const room = Math.max(0, effectiveCap - curOcc);
      const acceptedDests = rawDests.slice(0, room);
      // 固定保証枠が slice で削られないよう、確定後にランダム順へシャッフル
      for (let i = acceptedDests.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [acceptedDests[i], acceptedDests[j]] = [acceptedDests[j], acceptedDests[i]];
      }
      const passengers = acceptedDests.map((item) => {
        verifyOnboard.set(item.destIdx, (verifyOnboard.get(item.destIdx) || 0) + 1);
        return {
          uid: allocateUid(),
          destIdx: item.destIdx,
          boardedAt: s,
          isGuaranteed: !!item.isGuaranteed,
        };
      });

      curOcc += passengers.length;

      if (courseKey === 'rapid_noborito' && s === 13 && bestTransferDests.length > 0) {
        const trRoom = Math.max(0, effectiveCap - curOcc);
        const acceptedTr = bestTransferDests.slice(0, trRoom);
        originTransferPassengers = acceptedTr.map((item) => {
          verifyOnboard.set(item.destIdx, (verifyOnboard.get(item.destIdx) || 0) + 1);
          return {
            uid: allocateUid(),
            destIdx: item.destIdx,
            boardedAt: s,
            isOriginTransfer: true,
            isGuaranteed: !!item.isGuaranteed,
          };
        });
        curOcc += originTransferPassengers.length;
      }

      if (curOcc > finalMaxOcc) finalMaxOcc = curOcc;
      schedule.set(s, passengers);
    }

    return {
      routeStops,
      schedule,
      originTransferPassengers,
      maxPlannedOcc: finalMaxOcc + jizoReserve,
      unitTripsPerTile: stats.unitTripsPerTile,
      g1Active,
    };
  }

  /**
   * 乗客を空きマスへ配置（ドア付近・中程から優先的に流入しつつ自然なばらけ）
   * strollerEnabled が有効かつ2人以上乗車する場合、車内合計最大2セットまでランダムで縦2マス固定ベビーカーとして配置する。
   */
  function placePassengersIntoCar(grid, passengers, options = {}) {
    const boardedUids = new Set();
    let leftBehind = 0;
    const remaining = [...passengers];

    if (options.strollerEnabled && remaining.length >= 2) {
      const allocateStrollerGroupId = options.allocateStrollerGroupId || (() => Math.floor(Math.random() * 1e9));
      let activeCount = getActiveStrollers(grid).length;
      const maxSlots = STROLLER_CONFIG.maxActiveSets - activeCount;

      for (let sAttempt = 0; sAttempt < maxSlots && remaining.length >= 2; sAttempt++) {
        const spawnProb = activeCount === 0 ? 0.5 : 0.35;
        if (Math.random() >= spawnProb) continue;

        // 縦2マス連続で空いている場所を探す（優先スペース外をやや優先して移動パズル性を持たせる）
        const verticalPairs = [];
        for (let r = 0; r < ROWS - 1; r++) {
          for (let c = 0; c < COLS; c++) {
            if (!grid[r][c] && !grid[r + 1][c]) {
              const dist = Math.min(getMinDoorDistance(r, c), getMinDoorDistance(r + 1, c));
              const prioPenalty = isStrollerInPrioritySpace(r, c) ? 4 : 0;
              verticalPairs.push({ r, c, score: dist + prioPenalty + Math.random() * 2.0 });
            }
          }
        }
        if (verticalPairs.length === 0) break;

        verticalPairs.sort((a, b) => a.score - b.score);
        const spot = verticalPairs[0];

        // 40マス定員保証を崩さないよう、まず同一 destIdx の2人ペアを優先抽出する
        let pairIdxA = -1;
        let pairIdxB = -1;
        const firstByDest = new Map();
        for (let i = 0; i < remaining.length; i++) {
          const d = remaining[i].destIdx;
          if (firstByDest.has(d)) {
            pairIdxA = firstByDest.get(d);
            pairIdxB = i;
            break;
          }
          firstByDest.set(d, i);
        }

        let pTop;
        let pBot;
        if (pairIdxA !== -1 && pairIdxB !== -1) {
          pBot = remaining.splice(pairIdxB, 1)[0];
          pTop = remaining.splice(pairIdxA, 1)[0];
        } else {
          // 同一 destIdx ペアが無い場合は保証客（isGuaranteed）の着駅を書き換えないよう除外して2人選ぶ
          const nonGuaranteedIndices = [];
          for (let i = 0; i < remaining.length; i++) {
            if (!remaining[i].isGuaranteed) {
              nonGuaranteedIndices.push(i);
              if (nonGuaranteedIndices.length === 2) break;
            }
          }
          if (nonGuaranteedIndices.length < 2) {
            continue;
          }
          pBot = remaining.splice(nonGuaranteedIndices[1], 1)[0];
          pTop = remaining.splice(nonGuaranteedIndices[0], 1)[0];
          const distTop = Math.abs(pTop.destIdx - pTop.boardedAt);
          const distBot = Math.abs(pBot.destIdx - pBot.boardedAt);
          const nearerDest = distTop <= distBot ? pTop.destIdx : pBot.destIdx;
          pTop.destIdx = nearerDest;
          pBot.destIdx = nearerDest;
        }

        const groupId = allocateStrollerGroupId();
        pTop.strollerGroupId = groupId;
        pTop.strollerPart = 'top';
        pBot.strollerGroupId = groupId;
        pBot.strollerPart = 'bottom';

        grid[spot.r][spot.c] = pTop;
        grid[spot.r + 1][spot.c] = pBot;
        boardedUids.add(pTop.uid);
        boardedUids.add(pBot.uid);
        activeCount++;
      }
    }

    // 御老人オプションON時：車内最大6人（座席数分）までランダムで通常乗客を御老人に割り当て
    if (options.elderlyEnabled && remaining.length > 0) {
      let activeElderly = getActiveElderly(grid).length;
      for (const p of remaining) {
        if (activeElderly >= ELDERLY_CONFIG.maxActiveCount) break;
        const rate = activeElderly === 0 ? 0.32 : 0.22;
        if (Math.random() < rate) {
          p.isElderly = true;
          activeElderly++;
        }
      }
    }

    const emptyCells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!grid[r][c]) {
          const minDist = getMinDoorDistance(r, c);
          emptyCells.push({ r, c, score: minDist + Math.random() * 2.2 });
        }
      }
    }

    emptyCells.sort((a, b) => a.score - b.score);

    for (const p of remaining) {
      if (emptyCells.length === 0) {
        leftBehind++;
        continue;
      }
      const spot = emptyCells.shift();
      grid[spot.r][spot.c] = p;
      boardedUids.add(p.uid);
    }

    return { boardedCount: boardedUids.size, leftBehind, boardedUids };
  }

  function calcFastForwardRecovery(delaySec, timeRemaining) {
    if (delaySec <= 0 || timeRemaining < 1.5) return 0;
    return Math.min(3, delaySec, Math.max(1, Math.floor(timeRemaining * 0.45)));
  }

  function calcScoreMultiplier(diffKey, modifiers = {}) {
    const diff = DIFFICULTIES[diffKey] || DIFFICULTIES.normal;
    const baseMult = diff.scoreMult || 1.0;
    const modItems = [];
    let modSum = 0;

    if (modifiers.doorJizo) {
      modSum += MODIFIER_SCORE_BONUSES.doorJizo;
      modItems.push({ label: '🗿 ドア前地蔵', bonus: MODIFIER_SCORE_BONUSES.doorJizo });
    }
    if (modifiers.g1Active) {
      modSum += MODIFIER_SCORE_BONUSES.g1Event;
      modItems.push({ label: '🏇 G1開催', bonus: MODIFIER_SCORE_BONUSES.g1Event });
    }
    if (modifiers.stroller) {
      modSum += MODIFIER_SCORE_BONUSES.stroller;
      modItems.push({ label: '👶 ベビーカー', bonus: MODIFIER_SCORE_BONUSES.stroller });
    }
    if (modifiers.elderly) {
      modSum += MODIFIER_SCORE_BONUSES.elderly;
      modItems.push({ label: '👴 御老人', bonus: MODIFIER_SCORE_BONUSES.elderly });
    }

    const totalMult = +(baseMult + modSum).toFixed(2);
    return { baseMult, modSum: +modSum.toFixed(2), modItems, totalMult };
  }

  function calcOnTimeBonus(delaySec, isClear) {
    if (!isClear) return 0;
    if (delaySec <= 0) return 3000;
    if (delaySec <= 15) return 1500;
    return 0;
  }

  function calcSmoothRate(smoothAlighted, totalAlighted) {
    if (!totalAlighted || totalAlighted <= 0) return 100;
    return Math.max(0, Math.min(100, Math.round((smoothAlighted / totalAlighted) * 100)));
  }

  function evaluateClearRank(delaySec, smoothRate) {
    if (delaySec <= 0 && smoothRate >= 98) {
      return { rank: 'SS', rankColor: 'text-amber-300' };
    }
    if (delaySec <= 15 && smoothRate >= 90) {
      return { rank: 'S', rankColor: 'text-yellow-400' };
    }
    if (delaySec <= 40 && smoothRate >= 78) {
      return { rank: 'A', rankColor: 'text-emerald-400' };
    }
    if (delaySec <= 75) {
      return { rank: 'B', rankColor: 'text-sky-400' };
    }
    return { rank: 'C', rankColor: 'text-slate-300' };
  }

  /* -------------------------------------------------------------------------
   * 列車キー（`${dirKey}:${courseKey}`）ユーティリティ
   * ------------------------------------------------------------------------- */
  function getTrainKey(dirKey, courseKey) {
    return `${dirKey}:${courseKey}`;
  }

  function parseTrainKey(trainKey) {
    const str = typeof trainKey === 'string' ? trainKey.trim() : '';
    const idx = str.indexOf(':');
    if (idx <= 0) return null;
    const dirKey = str.slice(0, idx);
    const courseKey = str.slice(idx + 1);
    if (!DIRECTIONS[dirKey] || !COURSES[courseKey]) return null;
    if (VALID_TRAIN_SET.size > 0 && !VALID_TRAIN_SET.has(str)) return null;
    return { dirKey, courseKey, trainKey: str };
  }

  function formatTrainDisplayName(trainKey) {
    const parsed = parseTrainKey(trainKey);
    if (!parsed) return String(trainKey || '');
    const { dirKey, courseKey } = parsed;
    const course = COURSES[courseKey];
    const stops = getRouteStops(courseKey, dirKey);
    const startSt = STATIONS[stops[0]];
    const endSt = STATIONS[stops[stops.length - 1]];
    const typeStr = course && course.isRapid ? '快速' : '各停';
    let suffix = '';
    if (courseKey === 'rapid_inagi') suffix = '・立川連絡';
    else if (courseKey === 'nishikunitachi') suffix = '・朝ラッシュ';
    else if (courseKey === 'tachikawa_nakahara') suffix = '・終電間際';
    else if (courseKey === 'rapid_noborito') suffix = '・各停連絡';
    return `${typeStr} ${startSt ? startSt.name : ''}→${endSt ? endSt.name : ''}${suffix}`;
  }

  /* -------------------------------------------------------------------------
   * ハイスコア記録・ランキング管理・CSVセーブ／ロード
   * ------------------------------------------------------------------------- */
  const VALID_RANK_SET = new Set(['SS', 'S', 'A', 'B', 'C']);
  const VALID_MOD_ORDER = ['doorJizo', 'g1Event', 'stroller', 'elderly'];
  let memoryHighScoreStore = null;

  function parseNonNegativeNumber(val) {
    if (val === null || val === undefined) return NaN;
    if (typeof val === 'string' && val.trim() === '') return NaN;
    const num = Number(val);
    return Number.isFinite(num) && num >= 0 ? num : NaN;
  }

  function createEmptyStats() {
    return {
      totalRuns: 0,
      totalCarried: 0,
      stationBoarded: Array(STATS_STATION_COUNT).fill(0),
      stationAlighted: Array(STATS_STATION_COUNT).fill(0),
    };
  }

  function sanitizeStats(rawStats) {
    const stats = createEmptyStats();
    if (!rawStats || typeof rawStats !== 'object') return stats;
    const runsNum = Number(rawStats.totalRuns);
    const carriedNum = Number(rawStats.totalCarried);
    stats.totalRuns = Number.isFinite(runsNum) && runsNum >= 0 ? Math.round(runsNum) : 0;
    stats.totalCarried = Number.isFinite(carriedNum) && carriedNum >= 0 ? Math.round(carriedNum) : 0;

    if (Array.isArray(rawStats.stationBoarded)) {
      for (let i = 0; i < STATS_STATION_COUNT; i++) {
        const v = Number(rawStats.stationBoarded[i]);
        stats.stationBoarded[i] = Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
      }
    }
    if (Array.isArray(rawStats.stationAlighted)) {
      for (let i = 0; i < STATS_STATION_COUNT; i++) {
        const v = Number(rawStats.stationAlighted[i]);
        stats.stationAlighted[i] = Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
      }
    }
    return stats;
  }

  function createEmptyHighScoreStore() {
    return { version: 1, overall: [], byCourse: {}, stats: createEmptyStats() };
  }

  function normalizeScoreRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const courseKey = typeof raw.courseKey === 'string' ? raw.courseKey.trim() : '';
    if (!parseTrainKey(courseKey)) return null;

    const scoreNum = parseNonNegativeNumber(raw.score);
    if (!Number.isFinite(scoreNum)) return null;
    const score = Math.round(scoreNum);

    const hasRawRank = typeof raw.rank === 'string' && raw.rank.trim() !== '';
    const rankStr = hasRawRank ? raw.rank.trim().toUpperCase() : 'C';
    if (hasRawRank && !VALID_RANK_SET.has(rankStr)) return null;
    const rank = VALID_RANK_SET.has(rankStr) ? rankStr : 'C';

    const diffRaw = typeof raw.diffKey === 'string' ? raw.diffKey.trim() : 'normal';
    const diffKey = DIFFICULTIES[diffRaw] ? diffRaw : 'normal';

    let modsArr = [];
    if (Array.isArray(raw.mods)) {
      modsArr = raw.mods;
    } else if (typeof raw.mods === 'string' && raw.mods.trim()) {
      modsArr = raw.mods.split(/[+|;,]/);
    }
    const modSet = new Set(
      modsArr.map((m) => String(m || '').trim()).filter((m) => VALID_MOD_ORDER.includes(m))
    );
    const mods = VALID_MOD_ORDER.filter((m) => modSet.has(m));

    const delayNum = parseNonNegativeNumber(raw.delaySec);
    const delaySec = Number.isFinite(delayNum) ? Math.round(delayNum) : 0;

    const smoothNum = parseNonNegativeNumber(raw.smoothRate);
    const smoothRate = Number.isFinite(smoothNum)
      ? Math.max(0, Math.min(100, Math.round(smoothNum)))
      : 100;

    let achievedAt = '';
    if (typeof raw.achievedAt === 'string' && raw.achievedAt.trim()) {
      const parsed = Date.parse(raw.achievedAt.trim());
      if (!Number.isNaN(parsed)) {
        achievedAt = new Date(parsed).toISOString();
      }
    }

    return {
      courseKey,
      score,
      rank,
      diffKey,
      mods,
      delaySec,
      smoothRate,
      achievedAt,
    };
  }

  function scoreRecordKey(rec) {
    return `${rec.courseKey}|${rec.score}|${rec.rank}|${rec.diffKey}|${(rec.mods || []).join('+')}|${rec.delaySec}|${rec.smoothRate}|${rec.achievedAt}`;
  }

  function compareScoreRecords(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if (a.delaySec !== b.delaySec) return a.delaySec - b.delaySec;
    if (b.smoothRate !== a.smoothRate) return b.smoothRate - a.smoothRate;
    return String(b.achievedAt || '').localeCompare(String(a.achievedAt || ''));
  }

  function dedupeAndSortRecords(list, limit) {
    const map = new Map();
    for (const item of list || []) {
      const rec = normalizeScoreRecord(item);
      if (!rec) continue;
      const key = scoreRecordKey(rec);
      if (!map.has(key)) map.set(key, rec);
    }
    return Array.from(map.values()).sort(compareScoreRecords).slice(0, limit);
  }

  function sanitizeHighScoreStore(rawStore) {
    const maxOverall = (HIGHSCORE_CONFIG && HIGHSCORE_CONFIG.maxOverall) || 20;
    const maxPerCourse = (HIGHSCORE_CONFIG && HIGHSCORE_CONFIG.maxPerCourse) || 3;
    const store = createEmptyHighScoreStore();
    if (!rawStore || typeof rawStore !== 'object') return store;

    store.overall = dedupeAndSortRecords(rawStore.overall, maxOverall);
    if (rawStore.byCourse && typeof rawStore.byCourse === 'object') {
      Object.keys(rawStore.byCourse).forEach((courseKey) => {
        if (!parseTrainKey(courseKey)) return;
        const cleaned = dedupeAndSortRecords(rawStore.byCourse[courseKey], maxPerCourse);
        if (cleaned.length > 0) {
          store.byCourse[courseKey] = cleaned;
        }
      });
    }
    store.stats = sanitizeStats(rawStore.stats);
    return store;
  }

  function loadHighScores() {
    try {
      const key = (HIGHSCORE_CONFIG && HIGHSCORE_CONFIG.storageKey) || 'nanbu_highscores_v1';
      const raw = global.localStorage ? global.localStorage.getItem(key) : null;
      if (raw) {
        const parsed = sanitizeHighScoreStore(JSON.parse(raw));
        memoryHighScoreStore = parsed;
        return parsed;
      }
    } catch (_e) {
      // localStorage利用不可時はメモリフォールバックを使用
    }
    return sanitizeHighScoreStore(memoryHighScoreStore);
  }

  function saveHighScores(store) {
    const sanitized = sanitizeHighScoreStore(store);
    memoryHighScoreStore = sanitized;
    try {
      const key = (HIGHSCORE_CONFIG && HIGHSCORE_CONFIG.storageKey) || 'nanbu_highscores_v1';
      if (global.localStorage) {
        global.localStorage.setItem(key, JSON.stringify(sanitized));
      }
    } catch (_e) {
      // 容量不足・プライベートモード等の書込例外時は無視
    }
    return sanitized;
  }

  function recordHighScore(rawRecord, passengerLog = []) {
    const rec = normalizeScoreRecord(rawRecord);
    const store = loadHighScores();
    if (!rec) {
      return {
        store,
        record: null,
        overallRank: null,
        courseRank: null,
        isNewOverallBest: false,
        isNewCourseBest: false,
      };
    }

    const prevCourseBest =
      store.byCourse[rec.courseKey] && store.byCourse[rec.courseKey][0]
        ? store.byCourse[rec.courseKey][0].score
        : -1;
    const prevOverallBest = store.overall[0] ? store.overall[0].score : -1;

    const maxOverall = (HIGHSCORE_CONFIG && HIGHSCORE_CONFIG.maxOverall) || 20;
    const maxPerCourse = (HIGHSCORE_CONFIG && HIGHSCORE_CONFIG.maxPerCourse) || 3;

    const nextOverall = dedupeAndSortRecords([...store.overall, rec], maxOverall);
    const prevCourseList = store.byCourse[rec.courseKey] || [];
    const nextCourseList = dedupeAndSortRecords([...prevCourseList, rec], maxPerCourse);

    store.overall = nextOverall;
    store.byCourse[rec.courseKey] = nextCourseList;

    // 完走時の累計輸送人数・全26駅乗降統計を加算
    const stats = sanitizeStats(store.stats);
    stats.totalRuns += 1;
    let carriedThisRun = 0;
    if (Array.isArray(passengerLog)) {
      for (const item of passengerLog) {
        if (!item || item.isJizo) continue;
        const fromIdx = Number(item.fromIdx);
        const toIdx = Number(item.toIdx);
        if (Number.isInteger(fromIdx) && fromIdx >= 0 && fromIdx < STATS_STATION_COUNT) {
          stats.stationBoarded[fromIdx] += 1;
        }
        if (Number.isInteger(toIdx) && toIdx >= 0 && toIdx < STATS_STATION_COUNT) {
          stats.stationAlighted[toIdx] += 1;
        }
        carriedThisRun += 1;
      }
    }
    stats.totalCarried += carriedThisRun;
    store.stats = stats;

    const saved = saveHighScores(store);

    const targetKey = scoreRecordKey(rec);
    const overallIdx = saved.overall.findIndex((item) => scoreRecordKey(item) === targetKey);
    const courseIdx = (saved.byCourse[rec.courseKey] || []).findIndex((item) => scoreRecordKey(item) === targetKey);
    const overallRank = overallIdx >= 0 ? overallIdx + 1 : null;
    const courseRank = courseIdx >= 0 ? courseIdx + 1 : null;

    return {
      store: saved,
      record: rec,
      overallRank,
      courseRank,
      isNewOverallBest: overallRank === 1 && rec.score >= prevOverallBest,
      isNewCourseBest: courseRank === 1 && rec.score >= prevCourseBest,
    };
  }

  function clearHighScores() {
    return saveHighScores(createEmptyHighScoreStore());
  }

  function deleteOverallHighScores(recordKeys) {
    const store = loadHighScores();
    const keySet = new Set(Array.isArray(recordKeys) ? recordKeys : []);
    if (keySet.size === 0) return store;
    store.overall = (store.overall || []).filter((rec) => !keySet.has(scoreRecordKey(rec)));
    return saveHighScores(store);
  }

  function escapeCsvField(val) {
    const str = String(val == null ? '' : val);
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function exportHighScoresToCsv(store = null) {
    const data = sanitizeHighScoreStore(store || loadHighScores());
    const header = [
      'scope',
      'courseKey',
      'courseName',
      'score',
      'rank',
      'diffKey',
      'mods',
      'delaySec',
      'smoothRate',
      'achievedAt',
    ];
    const lines = [header.join(',')];

    const pushRow = (scope, rec) => {
      const courseName = formatTrainDisplayName(rec.courseKey);
      lines.push(
        [
          scope,
          rec.courseKey,
          courseName,
          rec.score,
          rec.rank,
          rec.diffKey,
          (rec.mods || []).join('|'),
          rec.delaySec,
          rec.smoothRate,
          rec.achievedAt,
        ]
          .map(escapeCsvField)
          .join(',')
      );
    };

    data.overall.forEach((rec) => pushRow('overall', rec));
    const baseOrder = Array.isArray(TRAIN_ORDER) ? TRAIN_ORDER : [];
    const orderedKeys = [...baseOrder, ...Object.keys(data.byCourse).filter((k) => !baseOrder.includes(k))];
    orderedKeys.forEach((courseKey) => {
      (data.byCourse[courseKey] || []).forEach((rec) => pushRow('course', rec));
    });

    // 輸送実績（累計・駅別）を出力
    const stats = sanitizeStats(data.stats);
    lines.push(
      ['stats_total', 'TOTAL', '累計輸送実績', stats.totalCarried, '', '', '', stats.totalRuns, '', '']
        .map(escapeCsvField)
        .join(',')
    );
    for (let i = 0; i < STATS_STATION_COUNT; i++) {
      const st = STATIONS[i];
      const stName = st ? `${st.num} ${st.name}` : `駅${i}`;
      lines.push(
        [
          'stats_station',
          String(i),
          stName,
          stats.stationBoarded[i] || 0,
          '',
          '',
          '',
          stats.stationAlighted[i] || 0,
          '',
          '',
        ]
          .map(escapeCsvField)
          .join(',')
      );
    }

    return '\uFEFF' + lines.join('\r\n');
  }

  function parseCsvRows(text) {
    const clean = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      if (inQuotes) {
        if (ch === '"') {
          if (clean[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && clean[i + 1] === '\n') i++;
        row.push(field);
        if (row.some((cell) => cell.trim() !== '')) {
          rows.push(row);
        }
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    row.push(field);
    if (row.some((cell) => cell.trim() !== '')) {
      rows.push(row);
    }
    return rows;
  }

  function importHighScoresFromCsv(csvText) {
    const rows = parseCsvRows(csvText);
    if (rows.length < 1) {
      return { ok: false, error: 'CSVが空です', importedCount: 0, skippedCount: 0, store: loadHighScores() };
    }

    const header = rows[0].map((h) => h.trim());
    const idxCourseKey = header.indexOf('courseKey');
    const idxScore = header.indexOf('score');
    if (idxCourseKey < 0 || idxScore < 0) {
      return {
        ok: false,
        error: 'CSVのヘッダ形式が不正です（courseKey / score 列が必要）',
        importedCount: 0,
        skippedCount: 0,
        store: loadHighScores(),
      };
    }

    const idxScope = header.indexOf('scope');
    const idxRank = header.indexOf('rank');
    const idxDiff = header.indexOf('diffKey');
    const idxMods = header.indexOf('mods');
    const idxDelay = header.indexOf('delaySec');
    const idxSmooth = header.indexOf('smoothRate');
    const idxAt = header.indexOf('achievedAt');

    const current = loadHighScores();
    const overallPool = [...current.overall];
    const byCoursePools = {};
    Object.keys(current.byCourse).forEach((k) => {
      byCoursePools[k] = [...current.byCourse[k]];
    });
    const mergedStats = sanitizeStats(current.stats);

    let importedScoreCount = 0;
    let importedStatsCount = 0;
    let skippedCount = 0;

    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r];
      const scope = idxScope >= 0 ? String(cols[idxScope] || '').trim().toLowerCase() : '';

      if (scope === 'stats_total') {
        const carriedNum = parseNonNegativeNumber(cols[idxScore]);
        const runsNum = idxDelay >= 0 ? parseNonNegativeNumber(cols[idxDelay]) : 0;
        if (Number.isFinite(carriedNum)) {
          mergedStats.totalCarried = Math.max(mergedStats.totalCarried, Math.round(carriedNum));
          if (Number.isFinite(runsNum)) {
            mergedStats.totalRuns = Math.max(mergedStats.totalRuns, Math.round(runsNum));
          }
          if (carriedNum > 0 || (Number.isFinite(runsNum) && runsNum > 0)) {
            importedStatsCount++;
          }
        } else {
          skippedCount++;
        }
        continue;
      }

      if (scope === 'stats_station') {
        const stIdx = parseNonNegativeNumber(cols[idxCourseKey]);
        const boardedNum = parseNonNegativeNumber(cols[idxScore]);
        const alightedNum = idxDelay >= 0 ? parseNonNegativeNumber(cols[idxDelay]) : 0;
        if (
          Number.isInteger(stIdx) &&
          stIdx >= 0 &&
          stIdx < STATS_STATION_COUNT &&
          Number.isFinite(boardedNum)
        ) {
          mergedStats.stationBoarded[stIdx] = Math.max(
            mergedStats.stationBoarded[stIdx],
            Math.round(boardedNum)
          );
          if (Number.isFinite(alightedNum)) {
            mergedStats.stationAlighted[stIdx] = Math.max(
              mergedStats.stationAlighted[stIdx],
              Math.round(alightedNum)
            );
          }
          if (boardedNum > 0 || (Number.isFinite(alightedNum) && alightedNum > 0)) {
            importedStatsCount++;
          }
        } else {
          skippedCount++;
        }
        continue;
      }

      const rec = normalizeScoreRecord({
        courseKey: cols[idxCourseKey],
        score: cols[idxScore],
        rank: idxRank >= 0 ? cols[idxRank] : 'C',
        diffKey: idxDiff >= 0 ? cols[idxDiff] : 'normal',
        mods: idxMods >= 0 ? cols[idxMods] : '',
        delaySec: idxDelay >= 0 ? cols[idxDelay] : 0,
        smoothRate: idxSmooth >= 0 ? cols[idxSmooth] : 100,
        achievedAt: idxAt >= 0 ? cols[idxAt] : '',
      });
      if (!rec) {
        skippedCount++;
        continue;
      }

      if (scope === 'overall') {
        overallPool.push(rec);
      } else if (scope === 'course') {
        if (!byCoursePools[rec.courseKey]) byCoursePools[rec.courseKey] = [];
        byCoursePools[rec.courseKey].push(rec);
      } else {
        overallPool.push(rec);
        if (!byCoursePools[rec.courseKey]) byCoursePools[rec.courseKey] = [];
        byCoursePools[rec.courseKey].push(rec);
      }
      importedScoreCount++;
    }

    if (importedScoreCount === 0 && importedStatsCount === 0) {
      return {
        ok: false,
        error: '取り込み可能なスコアデータが見つかりませんでした',
        importedCount: 0,
        importedScoreCount: 0,
        importedStatsCount: 0,
        skippedCount,
        store: current,
      };
    }

    const maxOverall = (HIGHSCORE_CONFIG && HIGHSCORE_CONFIG.maxOverall) || 20;
    const maxPerCourse = (HIGHSCORE_CONFIG && HIGHSCORE_CONFIG.maxPerCourse) || 3;
    const merged = createEmptyHighScoreStore();
    merged.overall = dedupeAndSortRecords(overallPool, maxOverall);
    Object.keys(byCoursePools).forEach((k) => {
      const cleaned = dedupeAndSortRecords(byCoursePools[k], maxPerCourse);
      if (cleaned.length > 0) merged.byCourse[k] = cleaned;
    });
    const sumBoarded = mergedStats.stationBoarded.reduce((a, b) => a + b, 0);
    const sumAlighted = mergedStats.stationAlighted.reduce((a, b) => a + b, 0);
    mergedStats.totalCarried = Math.max(mergedStats.totalCarried, sumBoarded, sumAlighted);
    merged.stats = mergedStats;

    const saved = saveHighScores(merged);
    return {
      ok: true,
      importedCount: importedScoreCount,
      importedScoreCount,
      importedStatsCount,
      skippedCount,
      store: saved,
    };
  }

  global.NanbuPuzzle = {
    createEmptyGrid,
    isSeatCell,
    isDoorCell,
    isPriorityCell,
    isStrollerInPrioritySpace,
    getActiveStrollers,
    getActiveElderly,
    findStrollerTop,
    tryMoveStroller,
    isRapidStop,
    isRapidCourse,
    getMinDoorDistance,
    formatMinSec,
    getRouteStops,
    getLegInfo,
    getOccupancy,
    countDestinations,
    countSeatedPassengers,
    evaluateReachability,
    partitionAlightingTargets,
    buildEffectiveODMatrix,
    computeDirectionStats,
    generateRunSchedule,
    placePassengersIntoCar,
    calcFastForwardRecovery,
    calcScoreMultiplier,
    calcOnTimeBonus,
    calcSmoothRate,
    evaluateClearRank,
    getTrainKey,
    parseTrainKey,
    formatTrainDisplayName,
    getScoreRecordKey: scoreRecordKey,
    loadHighScores,
    saveHighScores,
    recordHighScore,
    clearHighScores,
    deleteOverallHighScores,
    exportHighScoresToCsv,
    importHighScoresFromCsv,
  };
})(window);
