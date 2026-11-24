/**
 * なぜ南武線は混んでるのか？ - 車窓アニメーション描画
 * 川崎〜立川の駅間位置に応じて、以下の5種類の車窓（昼・夜間対応）を Canvas で描画する。
 *  - city          : 街並みモード（ビル・マンション群）
 *  - tower         : 高層タワーマンション群入り街並みモード（向河原〜武蔵小杉〜武蔵中原）
 *  - residential80 : 住宅地8割・ビル2割モード（尻手〜矢向、平間〜向河原、溝ノ口〜稲田堤・矢野口中間点、府中本町〜西国立）
 *  - mixed50       : 街並み5割・住宅地5割モード（稲田堤・矢野口中間点〜南多摩）
 *  - bridge        : 多摩川橋梁モード（南多摩〜府中本町）
 */
(function (global) {
  'use strict';

  /**
   * 連続駅座標 pos（0=川崎 〜 25=立川）から車窓モードを返す。
   * 境界点では進行方向 dir (+1: 下り / -1: 上り) に微小オフセットして判定する。
   */
  function getSceneryModeAtPos(pos, dir = 1) {
    const p = Math.max(0, Math.min(25, pos + (dir >= 0 ? 1e-4 : -1e-4)));
    if (p >= 18 && p < 19) return 'bridge';        // 南多摩〜府中本町
    if (p >= 5 && p < 7) return 'tower';           // 向河原〜武蔵小杉〜武蔵中原
    if (p >= 15.5 && p < 18) return 'mixed50';     // 稲田堤・矢野口中間点〜矢野口〜稲城長沼〜南多摩
    if (
      (p >= 1 && p < 2) ||                         // 尻手〜矢向
      (p >= 4 && p < 5) ||                         // 平間〜向河原
      (p >= 9 && p < 15.5) ||                      // 武蔵溝ノ口〜稲田堤〜稲田堤・矢野口中間点
      (p >= 19 && p < 24)                          // 府中本町〜分倍河原〜西府〜谷保〜矢川〜西国立
    ) {
      return 'residential80';
    }
    return 'city';                                 // 川崎〜尻手、矢向〜平間、武蔵中原〜武蔵溝ノ口、西国立〜立川
  }

  /**
   * 駅ホーム停車時の車窓モードを返す（南多摩・府中本町など橋梁隣接駅でも川の上で停車しないよう補正）
   */
  function getStationSceneryMode(stationIdx, dir = 1) {
    if (stationIdx === 18) return 'mixed50';       // 南多摩駅ホーム
    if (stationIdx === 19) return 'residential80'; // 府中本町駅ホーム
    const mode = getSceneryModeAtPos(stationIdx, dir);
    return mode === 'bridge' ? 'residential80' : mode;
  }

  /**
   * 発駅 fromIdx → 次停車駅 nextIdx の走行進捗 progress (0..1) から、
   * 駅間実距離に応じた連続駅座標 pos (0..25) を計算する（快速の通過区間も正確に対応）。
   */
  function calcTrackPosition(stations, fromIdx, nextIdx, progress) {
    if (fromIdx === nextIdx || !stations || !stations.length) return fromIdx || 0;
    const t = Math.max(0, Math.min(1, progress));
    const step = nextIdx > fromIdx ? 1 : -1;

    if (Math.abs(nextIdx - fromIdx) === 1) {
      return fromIdx + (nextIdx - fromIdx) * t;
    }

    const segs = [];
    let totalDist = 0;
    for (let k = fromIdx; k !== nextIdx; k += step) {
      const segIdx = step > 0 ? k : k - 1;
      const d = Math.max(0.1, (stations[segIdx] && stations[segIdx].dist) || 1.0);
      segs.push({ start: k, end: k + step, dist: d });
      totalDist += d;
    }

    let targetDist = totalDist * t;
    for (const seg of segs) {
      if (targetDist <= seg.dist || seg === segs[segs.length - 1]) {
        const localT = seg.dist > 0 ? Math.min(1, targetDist / seg.dist) : 1;
        return seg.start + (seg.end - seg.start) * localT;
      }
      targetDist -= seg.dist;
    }
    return nextIdx;
  }

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
      this.ctx = canvas.getContext('2d');
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
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(100, Math.floor(rect.width * dpr));
      this.canvas.height = Math.max(30, Math.floor(rect.height * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.w = rect.width;
      this.h = rect.height;
    }

    setNight(isNight) {
      this.isNight = !!isNight;
    }

    setMode(running, mode = null) {
      this.targetSpeed = running ? 210 : 0;
      if (mode === null || mode === undefined) return;
      const nextMode = typeof mode === 'boolean' ? (mode ? 'bridge' : 'city') : mode;
      if (nextMode !== this.mode) {
        this.prevMode = this.mode;
        this.mode = nextMode;
        this.fadeProgress = 0;
      }
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
          this._drawResidentialSlot(ctx, sx, h, step, i);
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
    getSceneryModeAtPos,
    getStationSceneryMode,
    calcTrackPosition,
  };
})(window);
