/**
 * 非線形ユニゾン＆24dB/octフィルター特化型 Web Audio API シンセサイザー
 * クラシック <script defer> 読込向けに IIFE（global.NanbuSynth）で提供する。
 */
(function (global) {
  'use strict';

  class UnisonFilterSynth {
    /**
     * @param {AudioContext} ctx
     * @param {AudioNode} [destination] 出力先（省略時は ctx.destination）
     */
    constructor(ctx, destination = ctx.destination) {
      this.ctx = ctx;
      this.destination = destination;
      this.maxFreq = Math.min(20000, ctx.sampleRate * 0.45);
    }

    /**
     * MIDIノート番号を周波数(Hz)に変換
     */
    static midiToFreq(midi) {
      return 440 * Math.pow(2, (midi - 69) / 12);
    }

    /**
     * 非線形・非対称のデチューン値(cent)とパン位置(-1..1)の配列を生成
     * 中心付近を狭く、外側ほど広く配置し、わずかな非対称性で周期的なうなり(フェイザー感)を防ぐ
     */
    static computeUnisonLayout(voices, detuneSpread, stereoSpread) {
      if (voices <= 1) {
        return [{ detune: 0, pan: 0 }];
      }

      const layout = [];
      const mid = (voices - 1) / 2;

      for (let i = 0; i < voices; i++) {
        // -1.0 〜 +1.0 に正規化
        const norm = (i - mid) / mid;
        const sign = Math.sign(norm);
        const abs = Math.abs(norm);

        // 2次カーブで中心を密・外側を疎に配置
        // プラス側にごく僅かな非対称オフセット(+4%)を混ぜて周期的干渉を回避
        const asymmetry = sign > 0 ? 1.04 : 1.0;
        const detune = sign * Math.pow(abs, 1.65) * detuneSpread * asymmetry;
        const pan = norm * stereoSpread;

        layout.push({ detune, pan });
      }
      return layout;
    }

    /**
     * ノート発音を開始し、停止用ハンドル(release関数)を返す
     * @param {number} midi MIDIノート番号 (例: 60 = C4)
     * @param {object} preset プリセットオブジェクト
     * @param {object} [options]
     * @param {number} [options.velocity=0.8] 0.0〜1.0
     * @param {number} [options.time] 発音開始時刻(AudioContext時間)
     */
    noteOn(midi, preset, { velocity = 0.8, time = this.ctx.currentTime } = {}) {
      const ctx = this.ctx;
      const freq = UnisonFilterSynth.midiToFreq(midi);
      const vel = Math.max(0.01, Math.min(1.0, velocity));
      const t0 = Math.max(ctx.currentTime, time);

      const {
        voices = 3,
        wave = 'sawtooth',
        subOsc = { enabled: false, wave: 'square', gain: 0.35, octave: -1 },
        detuneSpread = 15,
        stereoSpread = 0.7,
        gain = 0.25,
        filter: fCfg,
        amp: aCfg,
      } = preset;

      // --- 1. ゲイン・フィルター・アンプ段の構築 ---
      const preGain = ctx.createGain();
      const totalSources = voices + (subOsc && subOsc.enabled ? 1 : 0);
      // ボイス数増加による音割れを 1/sqrt(N) で自動補正
      preGain.gain.setValueAtTime(1 / Math.sqrt(totalSources), t0);

      // 12dB/oct (1段) または 24dB/oct (2段直列) フィルター
      const filterStages = fCfg.stages === 2 ? 2 : 1;
      const filters = [];
      // 2段直列時はレゾナンスが2乗で効くため平方根でバランス補正
      const rawQ = fCfg.q ?? 1.0;
      const stageQ = filterStages === 2 ? Math.max(0.7, Math.sqrt(rawQ)) : rawQ;

      for (let s = 0; s < filterStages; s++) {
        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.Q.setValueAtTime(stageQ, t0);
        filters.push(lpf);
      }

      const ampGain = ctx.createGain();
      ampGain.gain.setValueAtTime(0.0001, t0);

      // 接続: preGain -> filter[0] (-> filter[1]) -> ampGain -> destination
      let tailNode = preGain;
      for (const f of filters) {
        tailNode.connect(f);
        tailNode = f;
      }
      tailNode.connect(ampGain);
      ampGain.connect(this.destination);

      // --- 2. オシレーター群（ユニゾン＆ステレオ配置）---
      const oscNodes = [];
      const auxNodes = [preGain, ...filters, ampGain];
      const layout = UnisonFilterSynth.computeUnisonLayout(voices, detuneSpread, stereoSpread);

      for (let i = 0; i < layout.length; i++) {
        const { detune, pan } = layout[i];
        const osc = ctx.createOscillator();
        osc.type = wave;
        osc.frequency.setValueAtTime(freq, t0);
        osc.detune.setValueAtTime(detune, t0);

        // 位相揃いによる発音時の破裂音を防ぐ微小オフセット (0〜1.5ms)
        const jitter = i === 0 ? 0 : Math.random() * 0.0015;

        if (stereoSpread > 0 && typeof ctx.createStereoPanner === 'function') {
          const panner = ctx.createStereoPanner();
          panner.pan.setValueAtTime(pan, t0);
          osc.connect(panner);
          panner.connect(preGain);
          auxNodes.push(panner);
        } else {
          osc.connect(preGain);
        }

        osc.start(t0 + jitter);
        oscNodes.push(osc);
      }

      // サブオシレーター（中央固定で低域の芯を作る）
      if (subOsc && subOsc.enabled) {
        const sub = ctx.createOscillator();
        const subGainNode = ctx.createGain();
        const octRatio = Math.pow(2, subOsc.octave ?? -1);

        sub.type = subOsc.wave ?? 'square';
        sub.frequency.setValueAtTime(freq * octRatio, t0);
        subGainNode.gain.setValueAtTime(subOsc.gain ?? 0.35, t0);

        sub.connect(subGainNode);
        subGainNode.connect(preGain);
        sub.start(t0);

        oscNodes.push(sub);
        auxNodes.push(subGainNode);
      }

      // --- 3. フィルターエンベロープ（キートラッキング＆ベロシティ連動）---
      const clampFreq = (hz) => Math.max(25, Math.min(this.maxFreq, hz));

      const baseCutoff = clampFreq(freq * (fCfg.keyTrack ?? 1.0) + (fCfg.baseHz ?? 0));
      const velCurve = Math.pow(vel, fCfg.velSensitivity ?? 1.3);
      const peakCutoff = clampFreq(baseCutoff + (fCfg.envAmount ?? 3000) * velCurve);
      const sustainCutoff = clampFreq(baseCutoff + (peakCutoff - baseCutoff) * (fCfg.sustain ?? 0.2));

      const fAtk = Math.max(0.002, fCfg.attack ?? 0.01);
      const fDec = Math.max(0.01, fCfg.decay ?? 0.25);

      for (const lpf of filters) {
        lpf.frequency.setValueAtTime(baseCutoff, t0);
        lpf.frequency.exponentialRampToValueAtTime(peakCutoff, t0 + fAtk);
        lpf.frequency.setTargetAtTime(sustainCutoff, t0 + fAtk, fDec / 3);
      }

      // --- 4. アンプエンベロープ（指数カーブ）---
      const peakAmp = gain * vel;
      const sustainAmp = Math.max(0.0001, peakAmp * (aCfg.sustain ?? 0.7));
      const aAtk = Math.max(0.002, aCfg.attack ?? 0.01);
      const aDec = Math.max(0.01, aCfg.decay ?? 0.2);

      ampGain.gain.setValueAtTime(0.0001, t0);
      ampGain.gain.linearRampToValueAtTime(peakAmp, t0 + aAtk);
      ampGain.gain.setTargetAtTime(sustainAmp, t0 + aAtk, aDec / 3);

      // --- 5. リリース処理（フィルター先閉じによる疑似残響＆自動GC）---
      let released = false;
      const release = (releaseTime = ctx.currentTime) => {
        if (released) return;
        released = true;

        const tRel = Math.max(t0 + 0.005, releaseTime);
        const fRel = Math.max(0.01, fCfg.release ?? 0.3);
        const aRel = Math.max(0.015, aCfg.release ?? 0.5);

        for (const lpf of filters) {
          lpf.frequency.cancelScheduledValues(tRel);
          lpf.frequency.setTargetAtTime(baseCutoff, tRel, fRel / 3);
        }

        ampGain.gain.cancelScheduledValues(tRel);
        ampGain.gain.setTargetAtTime(0.0001, tRel, aRel / 3.5);

        const stopAt = tRel + aRel * 1.6 + 0.05;
        oscNodes.forEach((osc, idx) => {
          osc.stop(stopAt);
          if (idx === 0) {
            osc.onended = () => {
              try {
                oscNodes.forEach((o) => o.disconnect());
                auxNodes.forEach((n) => n.disconnect());
              } catch (_) {
                // 既に切断済みの場合は無視
              }
            };
          }
        });
      };

      return { release };
    }

    /**
     * シーケンサー向け：開始時刻と音の長さ(duration)を指定して発音
     */
    playNote(midi, preset, { velocity = 0.8, time = this.ctx.currentTime, duration = 0.5 } = {}) {
      const t0 = Math.max(this.ctx.currentTime, time);
      const voice = this.noteOn(midi, preset, { velocity, time: t0 });
      voice.release(t0 + duration);
      return voice;
    }
  }

  global.NanbuSynth = {
    UnisonFilterSynth,
  };
})(window);
