/**
 * なぜ南武線は常に混んでるのか - サウンドエンジン
 * Web Audio API による外部音声ファイル不要の軽量シンセサイザー。
 */
(function (global) {
  'use strict';

  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.masterOut = null;
      this.muted = false;
      this.lastSwapTime = -1;
    }

    init() {
      if (this.muted) return;
      if (!this.ctx) {
        const AudioCtx = global.AudioContext || global.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
          const masterGain = this.ctx.createGain();
          masterGain.gain.setValueAtTime(0.9, this.ctx.currentTime);
          masterGain.connect(this.ctx.destination);
          if (typeof this.ctx.createDynamicsCompressor === 'function') {
            const comp = this.ctx.createDynamicsCompressor();
            comp.threshold.setValueAtTime(-12, this.ctx.currentTime);
            comp.knee.setValueAtTime(12, this.ctx.currentTime);
            comp.ratio.setValueAtTime(8, this.ctx.currentTime);
            comp.attack.setValueAtTime(0.003, this.ctx.currentTime);
            comp.release.setValueAtTime(0.15, this.ctx.currentTime);
            comp.connect(masterGain);
            this.masterOut = comp;
          } else {
            this.masterOut = masterGain;
          }
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }

    tone(freq, dur, type = 'sine', vol = 0.12, delay = 0) {
      if (this.muted || !this.ctx) return;
      const now = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(vol, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(gain);
      gain.connect(this.masterOut || this.ctx.destination);
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch (_) {
          // 既に切断済みの場合は無視
        }
      };
      osc.start(now);
      osc.stop(now + dur + 0.02);
    }

    playSwap() {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      // 短時間内の多重発音による音量スパイク（位相重畳）を防止
      if (now - this.lastSwapTime < 0.045) return;
      this.lastSwapTime = now;
      this.tone(520, 0.06, 'triangle', 0.1);
      this.tone(720, 0.05, 'sine', 0.08, 0.025);
    }

    playDoorChime() {
      this.init();
      // 通勤電車風の爽やかなドアチャイム
      const notes = [659.25, 523.25, 659.25, 523.25];
      notes.forEach((f, i) => {
        this.tone(f, 0.22, 'sine', 0.11, i * 0.17);
      });
    }

    playAlightChain(step) {
      this.init();
      // ペンタトニック音階で連鎖ごとに上昇
      const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51];
      const f = scale[Math.min(step, scale.length - 1)];
      this.tone(f, 0.16, 'triangle', 0.13);
      this.tone(f * 1.5, 0.12, 'sine', 0.06, 0.03);
    }

    playDelayAlert() {
      this.init();
      this.tone(210, 0.18, 'sawtooth', 0.12, 0);
      this.tone(175, 0.24, 'sawtooth', 0.12, 0.14);
    }

    playTick() {
      this.init();
      this.tone(880, 0.05, 'square', 0.05);
    }

    playFastForward() {
      this.init();
      this.tone(587.33, 0.08, 'triangle', 0.1, 0);
      this.tone(880.0, 0.14, 'triangle', 0.1, 0.06);
    }

    playDeparture() {
      this.init();
      // 発車合図風の2音チャイム
      this.tone(523.25, 0.16, 'triangle', 0.11, 0);
      this.tone(659.25, 0.28, 'triangle', 0.12, 0.14);
    }

    playClearFanfare() {
      this.init();
      const melody = [
        { f: 523.25, d: 0.16, t: 0 },
        { f: 659.25, d: 0.16, t: 0.14 },
        { f: 783.99, d: 0.16, t: 0.28 },
        { f: 1046.5, d: 0.45, t: 0.42 },
      ];
      melody.forEach((n) => this.tone(n.f, n.d, 'triangle', 0.15, n.t));
    }

    playGameOver() {
      this.init();
      const notes = [392.0, 349.23, 311.13, 261.63];
      notes.forEach((f, i) => this.tone(f, 0.28, 'sawtooth', 0.09, i * 0.22));
    }
  }

  global.NanbuSound = {
    SoundEngine,
  };
})(window);
