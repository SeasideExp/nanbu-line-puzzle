/**
 * なぜ南武線は混んでるのか？ - 車窓エンジン＆上部1面横スクロールCanvasレンダラー
 * 駅固有IDベースの無向路線グラフ（buildTrackGraph / resolveTrackSegment）と
 * 駅間タイムライン正規化・逆方向自動反転（normalizeTimeline / getSegmentScenery / getSceneryForLeg）により、
 * 車両上部1面の横長車窓（昼・夜間対応の5景観）をクロスフェード描画する。
 *  - city          : 街並みモード（ビル・マンション群）
 *  - tower         : 高層タワーマンション群入り街並みモード
 *  - residential80 : 住宅地8割・ビル2割モード
 *  - mixed50       : 街並み5割・住宅地5割モード
 *  - bridge        : 多摩川橋梁モード
 */
(function (global) {
  'use strict';

  const Data = global.NanbuData || {};
  const DEFAULT_STATIONS = Array.isArray(Data.STATIONS) ? Data.STATIONS : [];
  const DEFAULT_BASE_STATION_COUNT =
    typeof Data.BASE_STATION_COUNT === 'number'
      ? Data.BASE_STATION_COUNT
      : DEFAULT_STATIONS.filter((st) => st && !st.isExtra).length;
  const DEFAULT_EXTRA_LEGS = Data.EXTRA_SEGMENT_LEGS || {};
  const DEFAULT_SCENERY_CONFIG = Data.SCENERY_CONFIG || {
    defaultMode: 'city',
    stationBaseDir: 'down',
    stations: {},
    segments: {},
  };

  /**
   * 駅固有IDまたは配列インデックスから駅固有ID（文字列）を解決する
   */
  function resolveStationId(stationIdOrIdx, stations = DEFAULT_STATIONS) {
    if (typeof stationIdOrIdx === 'string' && stationIdOrIdx) {
      return stationIdOrIdx;
    }
    if (typeof stationIdOrIdx === 'number' && stations[stationIdOrIdx] && stations[stationIdOrIdx].id) {
      return stations[stationIdOrIdx].id;
    }
    return '';
  }

  function resolveSingleMode(mode, fallbackMode) {
    if (typeof mode === 'string' && mode) return mode;
    return fallbackMode;
  }

  /**
   * 駅間景観定義（単一文字列／累積比率 to／相対重み ratio／実距離 km）を
   * 正規化タイムライン [{ to: 0..1, mode }, ...] へ変換する
   */
  function normalizeTimeline(def, fallbackMode = DEFAULT_SCENERY_CONFIG.defaultMode || 'city') {
    const fb = resolveSingleMode(fallbackMode, 'city');
    if (!def) {
      return [{ to: 1, mode: fb }];
    }
    if (typeof def === 'string') {
      return [{ to: 1, mode: def }];
    }
    if (!Array.isArray(def) || def.length === 0) {
      return [{ to: 1, mode: fb }];
    }

    const usesWeights = def.some((item) => item && (item.ratio != null || item.km != null));
    if (usesWeights) {
      const weights = def.map((item) => {
        if (!item) return 0;
        const w = Number(item.ratio != null ? item.ratio : item.km);
        return Number.isFinite(w) && w > 0 ? w : 0;
      });
      const total = weights.reduce((sum, w) => sum + w, 0);
      if (total <= 0) {
        return [{ to: 1, mode: resolveSingleMode(def[0] && def[0].mode, fb) }];
      }
      const slices = [];
      let acc = 0;
      for (let i = 0; i < def.length; i++) {
        if (weights[i] <= 0) continue;
        acc += weights[i];
        slices.push({
          to: acc / total,
          mode: resolveSingleMode(def[i] && def[i].mode, fb),
        });
      }
      if (slices.length === 0) return [{ to: 1, mode: fb }];
      slices[slices.length - 1].to = 1;
      return slices;
    }

    const slices = def
      .filter((item) => item && typeof item.mode === 'string' && item.mode)
      .map((item) => {
        const toNum = Number(item.to);
        return {
          to: Number.isFinite(toNum) ? Math.max(0, Math.min(1, toNum)) : 1,
          mode: item.mode,
        };
      })
      .sort((a, b) => a.to - b.to);

    if (slices.length === 0) {
      return [{ to: 1, mode: fb }];
    }
    if (slices[slices.length - 1].to < 1) {
      slices[slices.length - 1].to = 1;
    }
    return slices;
  }

  function pickTimelineSlice(timeline, t) {
    const localT = Math.max(0, Math.min(1, Number(t) || 0));
    for (let i = 0; i < timeline.length - 1; i++) {
      if (localT < timeline[i].to) {
        return timeline[i].mode;
      }
    }
    return timeline[timeline.length - 1].mode;
  }

  /**
   * 駅固有IDベースの無向路線グラフ（隣接駅IDと営業キロ）を構築する
   */
  function buildTrackGraph(
    stations = DEFAULT_STATIONS,
    extraSegmentLegs = DEFAULT_EXTRA_LEGS,
    baseStationCount = DEFAULT_BASE_STATION_COUNT
  ) {
    const adj = new Map();
    const ensureNode = (id) => {
      if (!adj.has(id)) adj.set(id, new Map());
      return adj.get(id);
    };
    const addEdge = (idA, idB, dist) => {
      if (!idA || !idB || idA === idB) return;
      const d = Math.max(0.1, Number(dist) || 1.0);
      ensureNode(idA).set(idB, d);
      ensureNode(idB).set(idA, d);
    };

    const mainLimit = Math.min(baseStationCount || stations.length, stations.length);
    for (let i = 0; i < mainLimit - 1; i++) {
      const a = stations[i];
      const b = stations[i + 1];
      if (a && b && a.id && b.id) {
        addEdge(a.id, b.id, a.dist);
      }
    }

    const findStationToken = (token) => {
      const byId = stations.find((s) => s && s.id === token);
      if (byId) return byId;
      if (/^\d+$/.test(token)) {
        const idx = Number(token);
        if (Number.isInteger(idx) && stations[idx]) return stations[idx];
      }
      return null;
    };

    Object.entries(extraSegmentLegs || {}).forEach(([pairKey, leg]) => {
      if (!leg) return;
      const parts = pairKey.split('-');
      if (parts.length !== 2) return;
      const a = findStationToken(parts[0]);
      const b = findStationToken(parts[1]);
      if (a && b && a.id && b.id) {
        addEdge(a.id, b.id, leg.dist);
      }
    });

    return adj;
  }

  const defaultTrackGraph = buildTrackGraph(DEFAULT_STATIONS, DEFAULT_EXTRA_LEGS, DEFAULT_BASE_STATION_COUNT);
  const defaultPathCache = new Map();
  const normalizedSegmentCache = new WeakMap();

  function getCachedNormalizedTimeline(sceneryConfig, key) {
    const cfg = sceneryConfig || DEFAULT_SCENERY_CONFIG;
    const segments = cfg.segments || {};
    if (!Object.prototype.hasOwnProperty.call(segments, key)) return null;
    let map = normalizedSegmentCache.get(cfg);
    if (!map) {
      map = new Map();
      normalizedSegmentCache.set(cfg, map);
    }
    if (!map.has(key)) {
      map.set(key, normalizeTimeline(segments[key], cfg.defaultMode || 'city'));
    }
    return map.get(key);
  }

  /**
   * 発駅ID → 次停車駅ID の隣接区間チェーン（BFS最短経路）を解決・キャッシュする
   */
  function getSegmentChain(fromId, nextId, trackGraph = defaultTrackGraph, pathCache = defaultPathCache) {
    if (!fromId || !nextId || fromId === nextId) return null;
    const cacheKey = `${fromId}>${nextId}`;
    if (pathCache && pathCache.has(cacheKey)) {
      return pathCache.get(cacheKey);
    }

    const directNeighbors = trackGraph.get(fromId);
    if (directNeighbors && directNeighbors.has(nextId)) {
      const dist = directNeighbors.get(nextId);
      const chain = { edges: [{ fromId, toId: nextId, dist }], totalDist: dist };
      if (pathCache) pathCache.set(cacheKey, chain);
      return chain;
    }

    if (!trackGraph.has(fromId) || !trackGraph.has(nextId)) {
      if (pathCache) pathCache.set(cacheKey, null);
      return null;
    }

    const queue = [fromId];
    const prev = new Map([[fromId, null]]);
    let head = 0;
    let found = false;

    while (head < queue.length) {
      const cur = queue[head++];
      if (cur === nextId) {
        found = true;
        break;
      }
      const neighbors = trackGraph.get(cur);
      if (!neighbors) continue;
      for (const nxt of neighbors.keys()) {
        if (!prev.has(nxt)) {
          prev.set(nxt, cur);
          queue.push(nxt);
        }
      }
    }

    if (!found) {
      if (pathCache) pathCache.set(cacheKey, null);
      return null;
    }

    const nodeIds = [];
    for (let cur = nextId; cur !== null; cur = prev.get(cur)) {
      nodeIds.push(cur);
    }
    nodeIds.reverse();

    const edges = [];
    let totalDist = 0;
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const a = nodeIds[i];
      const b = nodeIds[i + 1];
      const dist = trackGraph.get(a).get(b);
      edges.push({ fromId: a, toId: b, dist });
      totalDist += dist;
    }

    const chain = { edges, totalDist };
    if (pathCache) pathCache.set(cacheKey, chain);
    return chain;
  }

  /**
   * 発駅 → 次停車駅の走行進捗 progress (0..1) から、
   * 現在通過中の隣接2駅IDと区間内比率 localT (0..1) を営業キロ比例で解決する
   */
  function resolveTrackSegment(fromIdOrIdx, nextIdOrIdx, progress, options = null) {
    const stations = (options && options.stations) || DEFAULT_STATIONS;
    const trackGraph = (options && options.trackGraph) || defaultTrackGraph;
    const pathCache = options && options.trackGraph ? options.pathCache || null : defaultPathCache;
    const fromId = resolveStationId(fromIdOrIdx, stations);
    const nextId = resolveStationId(nextIdOrIdx, stations);
    if (!fromId || !nextId || fromId === nextId) return null;

    const t = Math.max(0, Math.min(1, Number(progress) || 0));
    const chain = getSegmentChain(fromId, nextId, trackGraph, pathCache);
    if (!chain || chain.edges.length === 0) return null;

    if (chain.edges.length === 1) {
      return {
        fromId: chain.edges[0].fromId,
        toId: chain.edges[0].toId,
        localT: t,
        totalDist: chain.totalDist,
      };
    }

    let targetDist = chain.totalDist * t;
    for (let i = 0; i < chain.edges.length; i++) {
      const edge = chain.edges[i];
      if (targetDist < edge.dist || i === chain.edges.length - 1) {
        const localT = edge.dist > 0 ? Math.max(0, Math.min(1, targetDist / edge.dist)) : 1;
        return {
          fromId: edge.fromId,
          toId: edge.toId,
          localT,
          totalDist: chain.totalDist,
        };
      }
      targetDist -= edge.dist;
    }

    const last = chain.edges[chain.edges.length - 1];
    return { fromId: last.fromId, toId: last.toId, localT: 1, totalDist: chain.totalDist };
  }

  /**
   * 隣接2駅の固有IDペア (fromId -> toId) と区間内進捗 localT (0..1) から車窓モードを取得する
   * 逆方向 ('toId>fromId') のみ登録されている場合は進捗 (1 - localT) へ自動反転して解決する
   */
  function getSegmentScenery(fromIdOrIdx, toIdOrIdx, localT, sceneryConfig = DEFAULT_SCENERY_CONFIG) {
    const cfg = sceneryConfig || DEFAULT_SCENERY_CONFIG;
    const fromId = resolveStationId(fromIdOrIdx);
    const toId = resolveStationId(toIdOrIdx);
    const fallback = resolveSingleMode(cfg.stations && cfg.stations[fromId], cfg.defaultMode || 'city');
    if (!fromId || !toId) return fallback;

    const forwardTimeline = getCachedNormalizedTimeline(cfg, `${fromId}>${toId}`);
    if (forwardTimeline) {
      return pickTimelineSlice(forwardTimeline, localT);
    }

    const reverseTimeline = getCachedNormalizedTimeline(cfg, `${toId}>${fromId}`);
    if (reverseTimeline) {
      const revT = 1 - Math.max(0, Math.min(1, Number(localT) || 0));
      return pickTimelineSlice(reverseTimeline, revT);
    }

    return fallback;
  }

  /**
   * 駅ホーム停車時の車窓モードを駅固有ID（またはインデックス）から取得する
   */
  function getStationSceneryMode(stationIdOrIdx, _dir = 'down', sceneryConfig = DEFAULT_SCENERY_CONFIG) {
    const cfg = sceneryConfig || DEFAULT_SCENERY_CONFIG;
    const stationId = resolveStationId(stationIdOrIdx);
    return resolveSingleMode(cfg.stations && cfg.stations[stationId], cfg.defaultMode || 'city');
  }

  /**
   * 発駅 → 次停車駅（各停・快速・支線すべて対応）の進捗 progress (0..1) に対応する車窓モードを返す
   */
  function getSceneryForLeg(fromIdOrIdx, nextIdOrIdx, progress, dir = 'down', sceneryConfig = DEFAULT_SCENERY_CONFIG, options = null) {
    const stations = (options && options.stations) || DEFAULT_STATIONS;
    const fromId = resolveStationId(fromIdOrIdx, stations);
    const nextId = resolveStationId(nextIdOrIdx, stations);
    const defaultMode = (sceneryConfig && sceneryConfig.defaultMode) || 'city';
    if (!fromId) return defaultMode;
    if (!nextId || fromId === nextId) {
      return getStationSceneryMode(fromId, dir, sceneryConfig);
    }
    const seg = resolveTrackSegment(fromId, nextId, progress, options);
    if (!seg) {
      return getStationSceneryMode(fromId, dir, sceneryConfig);
    }
    return getSegmentScenery(seg.fromId, seg.toId, seg.localT, sceneryConfig);
  }

  /* -------------------------------------------------------------------------
   * 上部1面横スクロール車窓レンダラー（路線知識を持たない純粋描画層）
   * ------------------------------------------------------------------------- */
  // 街並みビル定義（8パターン）
  const CITY_HEIGHTS = [0.55, 0.38, 0.68, 0.44, 0.52, 0.72, 0.40, 0.60];
  const CITY_COLORS_DAY = ['#94a3b8', '#64748b', '#cbd5e1', '#7c8ea3', '#94a3b8', '#475569', '#a8b5c4', '#64748b'];
  const CITY_COLORS_NIGHT = ['#1e293b', '#0f172a', '#263449', '#172236', '#1e293b', '#0b1324', '#243146', '#131d30'];

  // 住宅地カラー＆屋根パレット
  const HOUSE_WALLS_DAY = ['#f8fafc', '#fef3c7', '#f1f5f9', '#fde68a', '#e2e8f0', '#fef9c3'];
  const HOUSE_ROOFS_DAY = ['#9a3412', '#334155', '#7c2d12', '#1e3a5f', '#475569', '#3f6212'];
  const HOUSE_WALLS_NIGHT = ['#1e293b', '#273043', '#1a2335', '#242c3f', '#182133', '#222b3d'];
  const HOUSE_ROOFS_NIGHT = ['#0f172a', '#090e1a', '#141926', '#0c1322', '#111827', '#0f172a'];

  // スロット構成（住宅地8割・ビル2割 = 10スロット中 8住宅 / 2ビル）
  const PATTERN_RESIDENTIAL_80 = [
    'house', 'house', 'house', 'bldg', 'house',
    'house', 'house', 'house', 'bldg', 'house',
  ];

  // スロット構成（街並み5割・住宅地5割 = 8スロット中 4ビル / 4住宅）
  const PATTERN_MIXED_50 = [
    'bldg', 'house', 'bldg', 'house',
    'house', 'bldg', 'bldg', 'house',
  ];

  class SceneryRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas ? canvas.getContext('2d') : null;
      this.offset = 0;
      this.speed = 0;
      this.targetSpeed = 0;
      this.mode = 'city';
      this.prevMode = null;
      this.fadeProgress = 1;
      this.isNight = false;
      this.w = 0;
      this.h = 0;
      this.resize();
    }

    resize() {
      if (!this.canvas || !this.ctx) return;
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(100, Math.floor(rect.width * dpr));
      this.canvas.height = Math.max(30, Math.floor(rect.height * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.w = rect.width;
      this.h = rect.height;
      this.draw();
    }

    setNight(isNight) {
      this.isNight = !!isNight;
    }

    setMode(running, mode = null) {
      this.targetSpeed = running ? 210 : 0;
      if (typeof mode !== 'string' || !mode) return;
      if (mode !== this.mode) {
        this.prevMode = this.mode;
        this.mode = mode;
        this.fadeProgress = 0;
      }
    }

    reset(mode = 'city') {
      this.speed = 0;
      this.targetSpeed = 0;
      this.mode = resolveSingleMode(mode, 'city');
      this.prevMode = null;
      this.fadeProgress = 1;
      this.draw();
    }

    update(dt) {
      this.speed += (this.targetSpeed - this.speed) * Math.min(1, dt * 4.5);
      this.offset += this.speed * dt;
      if (this.fadeProgress < 1) {
        this.fadeProgress = Math.min(1, this.fadeProgress + dt * 2.4);
        if (this.fadeProgress >= 1) {
          this.prevMode = null;
        }
      }
      this.draw();
    }

    draw() {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const w = this.w;
      const h = this.h;
      if (!w || !h) return;

      if (this.prevMode && this.fadeProgress < 1) {
        this._drawScene(ctx, w, h, this.prevMode);
        ctx.save();
        ctx.globalAlpha = this.fadeProgress;
        this._drawScene(ctx, w, h, this.mode);
        ctx.restore();
      } else {
        this._drawScene(ctx, w, h, this.mode);
      }
    }

    _drawScene(ctx, w, h, mode) {
      const night = this.isNight;

      // 空グラデーション（昼 / 夜間）
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      if (night) {
        sky.addColorStop(0, '#020617');
        sky.addColorStop(0.55, '#0f172a');
        sky.addColorStop(1, '#1e293b');
      } else if (mode === 'bridge') {
        sky.addColorStop(0, '#38bdf8');
        sky.addColorStop(0.6, '#bae6fd');
        sky.addColorStop(1, '#e0f2fe');
      } else if (mode === 'residential80') {
        sky.addColorStop(0, '#56a3f5');
        sky.addColorStop(1, '#e0f2fe');
      } else {
        sky.addColorStop(0, '#60a5fa');
        sky.addColorStop(1, '#dbeafe');
      }
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      if (night) {
        // 夜空の星＆月
        ctx.fillStyle = 'rgba(248, 250, 252, 0.78)';
        for (let i = 0; i < 24; i++) {
          const sx = (((i * 53 + 17 - this.offset * 0.03) % w) + w) % w;
          const sy = 4 + ((i * 19) % Math.max(8, Math.floor(h * 0.48)));
          const sz = i % 4 === 0 ? 1.8 : 1.1;
          ctx.fillRect(sx, sy, sz, sz);
        }
        // 右寄りの月
        const moonX = w * 0.82;
        const moonY = Math.max(10, h * 0.24);
        const moonR = Math.max(4.5, Math.min(8, h * 0.14));
        ctx.fillStyle = 'rgba(254, 240, 138, 0.18)';
        ctx.beginPath();
        ctx.arc(moonX, moonY, moonR * 1.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
        ctx.fill();
        // 三日月風の陰
        ctx.fillStyle = '#091226';
        ctx.beginPath();
        ctx.arc(moonX - moonR * 0.38, moonY - moonR * 0.15, moonR * 0.82, 0, Math.PI * 2);
        ctx.fill();

        // 夜雲
        ctx.fillStyle = 'rgba(51, 65, 85, 0.35)';
        for (let i = -1; i < 5; i++) {
          const cx = (((i * 200 - this.offset * 0.10) % (w + 220)) + (w + 220)) % (w + 220) - 60;
          ctx.beginPath();
          ctx.arc(cx, h * 0.28, 13, 0, Math.PI * 2);
          ctx.arc(cx + 15, h * 0.25, 16, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // 昼の雲
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        for (let i = -1; i < 6; i++) {
          const cx = (((i * 180 - this.offset * 0.12) % (w + 220)) + (w + 220)) % (w + 220) - 60;
          ctx.beginPath();
          ctx.arc(cx, h * 0.25, 14, 0, Math.PI * 2);
          ctx.arc(cx + 14, h * 0.22, 17, 0, Math.PI * 2);
          ctx.arc(cx + 28, h * 0.26, 12, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (mode === 'bridge') {
        this._drawBridge(ctx, w, h);
      } else if (mode === 'tower') {
        this._drawTowerCityscape(ctx, w, h);
      } else if (mode === 'residential80') {
        this._drawMixedLand(ctx, w, h, PATTERN_RESIDENTIAL_80);
      } else if (mode === 'mixed50') {
        this._drawMixedLand(ctx, w, h, PATTERN_MIXED_50);
      } else {
        this._drawCityscape(ctx, w, h);
      }
    }

    _drawBridge(ctx, w, h) {
      const night = this.isNight;
      const riverY = h * 0.56;

      // 対岸の遠景ビル群・街並みシルエット（ゆっくりパララックス）
      const farStep = 24;
      const farHeights = [0.16, 0.24, 0.12, 0.28, 0.14, 0.20, 0.10, 0.26, 0.15, 0.18, 0.11, 0.22];
      const farColors = night
        ? ['#0f172a', '#1e293b', '#172554', '#0f172a', '#1e293b', '#111827']
        : ['#94a3b8', '#a8b5c4', '#cbd5e1', '#8fa3b8', '#b6c4d4', '#94a3b8'];
      const farPeriod = farStep * farHeights.length;
      const farStart = -((this.offset * 0.16) % farPeriod);

      for (let i = -2; i < Math.ceil(w / farStep) + farHeights.length + 2; i++) {
        const idx = ((i % farHeights.length) + farHeights.length) % farHeights.length;
        const fx = farStart + i * farStep;
        const fh = Math.max(5, h * farHeights[idx]);
        const fw = idx % 3 === 0 ? 15 : 19;
        const fy = riverY - fh - 2;
        ctx.fillStyle = farColors[idx % farColors.length];
        ctx.fillRect(fx, fy, fw, fh + 2);

        if (fh >= 9) {
          ctx.fillStyle = night ? 'rgba(253, 224, 71, 0.65)' : 'rgba(241, 245, 249, 0.5)';
          for (let wy = fy + 2; wy < riverY - 4; wy += 4) {
            ctx.fillRect(fx + 3, wy, fw - 6, 1.5);
          }
        }
      }

      // 対岸の河川敷・土手ライン
      ctx.fillStyle = night ? '#14532d' : '#65a30d';
      ctx.fillRect(0, riverY - 3, w, 3);
      ctx.fillStyle = night ? '#166534' : '#84cc16';
      ctx.fillRect(0, riverY - 2, w, 1.5);

      // 多摩川の川面
      const riverGrad = ctx.createLinearGradient(0, riverY, 0, h);
      if (night) {
        riverGrad.addColorStop(0, '#082f49');
        riverGrad.addColorStop(1, '#020617');
      } else {
        riverGrad.addColorStop(0, '#0284c7');
        riverGrad.addColorStop(1, '#0369a1');
      }
      ctx.fillStyle = riverGrad;
      ctx.fillRect(0, riverY, w, h - riverY);

      // 川面のきらめき（夜間は街灯・月光の反射）
      ctx.fillStyle = night ? 'rgba(254, 240, 138, 0.35)' : 'rgba(186, 230, 253, 0.55)';
      for (let i = 0; i < 16; i++) {
        const wx = (((i * 70 - this.offset * 0.45) % (w + 80)) + (w + 80)) % (w + 80) - 40;
        const wy = riverY + 4 + (i % 3) * 6;
        ctx.fillRect(wx, wy, 22, 2);
      }

      // 開放的な桁橋の低い手すり＋架線柱・架線（トラスなし）
      const railY = h - 7;
      ctx.fillStyle = night ? '#0f172a' : '#475569';
      ctx.fillRect(0, h - 4, w, 4);
      ctx.fillStyle = night ? '#334155' : '#64748b';
      ctx.fillRect(0, railY, w, 1.5);

      const postSpan = 28;
      const postStart = -((this.offset * 1.1) % postSpan);
      ctx.fillStyle = night ? '#1e293b' : '#475569';
      for (let px = postStart; px < w + postSpan; px += postSpan) {
        ctx.fillRect(px, railY, 2, 7);
      }

      ctx.fillStyle = night ? '#0f172a' : '#334155';
      const poleSpan = 165;
      const pStart = -((this.offset * 1.1) % poleSpan);
      for (let px = pStart; px < w + poleSpan; px += poleSpan) {
        ctx.fillRect(px, 0, 4, h);
      }

      ctx.strokeStyle = night ? 'rgba(148,163,184,0.28)' : 'rgba(30,41,59,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h * 0.26);
      ctx.lineTo(w, h * 0.26);
      ctx.stroke();
    }

    _drawCityscape(ctx, w, h) {
      const bStep = 54;
      const bStart = -((this.offset * 0.4) % (bStep * 8));
      for (let i = -2; i < Math.ceil(w / bStep) + 10; i++) {
        const idx = ((i % 8) + 8) % 8;
        const bx = bStart + i * bStep;
        this._drawBuildingBlock(ctx, bx, h, bStep - 8, idx);
      }
      this._drawTrackForeground(ctx, w, h);
    }

    _drawTowerCityscape(ctx, w, h) {
      const night = this.isNight;
      const tStep = 66;
      const towerSpecs = [
        { width: 32, heightRatio: 0.90, body: night ? '#1e293b' : '#64748b', glass: night ? '#fde047' : '#bae6fd', crown: true,  light: true  },
        { width: 26, heightRatio: 0.80, body: night ? '#0f172a' : '#94a3b8', glass: night ? '#fef08a' : '#e0f2fe', crown: false, light: false },
        { width: 36, heightRatio: 0.94, body: night ? '#172554' : '#475569', glass: night ? '#38bdf8' : '#7dd3fc', crown: true,  light: true  },
        { width: 24, heightRatio: 0.74, body: night ? '#1e293b' : '#7c8ea3', glass: night ? '#fde68a' : '#e2e8f0', crown: false, light: false },
        { width: 34, heightRatio: 0.88, body: night ? '#0f172a' : '#52657a', glass: night ? '#fef08a' : '#bae6fd', crown: true,  light: true  },
        { width: 28, heightRatio: 0.82, body: night ? '#1e293b' : '#64748b', glass: night ? '#7dd3fc' : '#e0f2fe', crown: true,  light: false },
      ];
      const tPeriod = tStep * towerSpecs.length;
      const tStart = -((this.offset * 0.22) % tPeriod);

      for (let i = -2; i < Math.ceil(w / tStep) + 8; i++) {
        const idx = ((i % towerSpecs.length) + towerSpecs.length) % towerSpecs.length;
        const spec = towerSpecs[idx];
        const tx = tStart + i * tStep + 8;
        const th = h * spec.heightRatio;
        const ty = h - th - 6;

        ctx.fillStyle = spec.body;
        ctx.fillRect(tx, ty, spec.width, th);

        if (spec.crown) {
          const cw = spec.width * 0.62;
          ctx.fillStyle = night ? '#020617' : '#334155';
          ctx.fillRect(tx + (spec.width - cw) * 0.5, ty - 3, cw, 3);
        }

        if (spec.light) {
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(tx + spec.width * 0.5 - 1, Math.max(1, ty - 5), 2, 2);
        }

        ctx.save();
        ctx.fillStyle = spec.glass;
        ctx.globalAlpha = ctx.globalAlpha * (night ? 0.72 : 0.55);
        for (let wy = ty + 4; wy < h - 10; wy += 5) {
          ctx.fillRect(tx + 3, wy, spec.width - 6, 2);
        }
        ctx.restore();

        ctx.fillStyle = night ? 'rgba(148,163,184,0.12)' : 'rgba(255,255,255,0.22)';
        ctx.fillRect(tx, ty, 3, th);
      }

      const bStep = 54;
      const bStart = -((this.offset * 0.4) % (bStep * 8));
      for (let i = -2; i < Math.ceil(w / bStep) + 10; i++) {
        const idx = ((i % 8) + 8) % 8;
        if (idx === 2 || idx === 5) continue;
        const bx = bStart + i * bStep;
        this._drawBuildingBlock(ctx, bx, h, bStep - 8, idx, 0.82);
      }

      this._drawTrackForeground(ctx, w, h);
    }

    _drawMixedLand(ctx, w, h, pattern) {
      const step = 54;
      const len = pattern.length;
      const start = -((this.offset * 0.4) % (step * len));

      for (let i = -2; i < Math.ceil(w / step) + len + 2; i++) {
        const idx = ((i % len) + len) % len;
        const sx = start + i * step;
        if (pattern[idx] === 'bldg') {
          this._drawBuildingBlock(ctx, sx, h, step - 8, idx % 8);
        } else {
          this._drawResidentialSlot(ctx, sx, h, step, idx);
        }
      }

      this._drawTrackForeground(ctx, w, h);
    }

    _drawBuildingBlock(ctx, bx, h, bw, colorIdx, heightScale = 1.0) {
      const night = this.isNight;
      const idx = ((colorIdx % 8) + 8) % 8;
      const bh = h * CITY_HEIGHTS[idx] * heightScale;
      const by = h - bh - 6;
      ctx.fillStyle = night ? CITY_COLORS_NIGHT[idx] : CITY_COLORS_DAY[idx];
      ctx.fillRect(bx, by, bw, bh);

      // 建物の窓（夜間は温かく点灯）
      ctx.fillStyle = night ? 'rgba(253, 224, 71, 0.78)' : 'rgba(254, 249, 195, 0.45)';
      let row = 0;
      for (let wy = by + 5; wy < h - 12; wy += 8) {
        if (!night || (idx + row) % 3 !== 0) ctx.fillRect(bx + 6, wy, 6, 4);
        if (!night || (idx + row) % 2 === 0) ctx.fillRect(bx + 18, wy, 6, 4);
        if (bw > 34 && (!night || (idx + row) % 4 !== 1)) ctx.fillRect(bx + 30, wy, 6, 4);
        row++;
      }
    }

    _drawResidentialSlot(ctx, sx, h, step, seed) {
      const night = this.isNight;
      const baseY = h - 7;
      const s1 = ((seed * 3 + 1) % 6 + 6) % 6;
      const s2 = ((seed * 5 + 3) % 6 + 6) % 6;

      // 奥の庭木
      ctx.fillStyle = night ? '#14532d' : '#4d7c0f';
      ctx.beginPath();
      ctx.arc(sx + step * 0.48, baseY - h * 0.20, Math.max(4, h * 0.13), 0, Math.PI * 2);
      ctx.fill();

      const walls = night ? HOUSE_WALLS_NIGHT : HOUSE_WALLS_DAY;
      const roofs = night ? HOUSE_ROOFS_NIGHT : HOUSE_ROOFS_DAY;

      // 左の家
      const w1 = 21;
      const h1 = h * (0.26 + (s1 % 3) * 0.045);
      const x1 = sx + 2;
      const y1 = baseY - h1;
      const roofH1 = Math.max(5, h * 0.14);

      ctx.fillStyle = walls[s1];
      ctx.fillRect(x1, y1, w1, h1);
      ctx.fillStyle = roofs[s1];
      ctx.beginPath();
      ctx.moveTo(x1 - 2, y1 + 1);
      ctx.lineTo(x1 + w1 * 0.5, y1 - roofH1);
      ctx.lineTo(x1 + w1 + 2, y1 + 1);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = night ? '#fde047' : '#64748b';
      ctx.fillRect(x1 + 4, y1 + 4, 4, 4);
      if (!night || s1 % 2 === 0) ctx.fillRect(x1 + 12, y1 + 4, 4, 4);

      // 右の家
      const w2 = 22;
      const h2 = h * (0.22 + (s2 % 3) * 0.045);
      const x2 = sx + 27;
      const y2 = baseY - h2;
      const roofH2 = Math.max(5, h * 0.13);

      ctx.fillStyle = walls[s2];
      ctx.fillRect(x2, y2, w2, h2);
      ctx.fillStyle = roofs[s2];
      ctx.beginPath();
      ctx.moveTo(x2 - 2, y2 + 1);
      ctx.lineTo(x2 + w2 * 0.5, y2 - roofH2);
      ctx.lineTo(x2 + w2 + 2, y2 + 1);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = night ? '#fcd34d' : '#64748b';
      if (!night || s2 % 3 !== 0) ctx.fillRect(x2 + 4, y2 + 3, 4, 4);
      ctx.fillRect(x2 + 13, y2 + 3, 4, 4);

      // 手前の生垣
      ctx.fillStyle = night ? '#166534' : '#65a30d';
      ctx.fillRect(sx + 23, baseY - 5, 4, 5);
    }

    _drawTrackForeground(ctx, w, h) {
      const night = this.isNight;
      ctx.fillStyle = night ? '#0f172a' : '#475569';
      ctx.fillRect(0, h - 8, w, 8);
      ctx.fillStyle = night ? '#020617' : '#334155';
      const poleSpan = 150;
      const pStart = -((this.offset * 1.1) % poleSpan);
      for (let px = pStart; px < w + poleSpan; px += poleSpan) {
        ctx.fillRect(px, 0, 5, h);
      }

      ctx.strokeStyle = night ? 'rgba(148,163,184,0.28)' : 'rgba(30,41,59,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h * 0.28);
      ctx.lineTo(w, h * 0.28);
      ctx.stroke();
    }
  }

  global.NanbuScenery = {
    SceneryRenderer,
    normalizeTimeline,
    buildTrackGraph,
    resolveTrackSegment,
    getSegmentScenery,
    getSceneryForLeg,
    getStationSceneryMode,
  };
})(window);
