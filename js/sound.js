/**
 * なぜ南武線は混んでるのか？ - サウンドエンジン
 * Web Audio API による外部音声ファイル不要の軽量シンセサイザー。
 * 音量設定の永続化と、BGMプレイヤーとの単一 AudioContext 共有も管理する。
 */
(function (global) {
  'use strict';

  const AudioCfg = (global.NanbuData && global.NanbuData.AUDIO_CONFIG) || {};
  const AUDIO_STORAGE_KEY = AudioCfg.storageKey || 'nanbu_audio_settings_v1';
  const DEFAULT_SE_PCT = typeof AudioCfg.defaultSeVolume === 'number' ? AudioCfg.defaultSeVolume : 100;
  const DEFAULT_BGM_PCT = typeof AudioCfg.defaultBgmVolume === 'number' ? AudioCfg.defaultBgmVolume : 10;
  const SE_BASE_GAIN = typeof AudioCfg.seBaseGain === 'number' ? AudioCfg.seBaseGain : 0.9;

  function clampVolPct(val, fallback) {
    const num = Number(val);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(100, Math.round(num)));
  }

  function loadAudioSettings() {
    const defaults = {
      seVolume: DEFAULT_SE_PCT,
      bgmVolume: DEFAULT_BGM_PCT,
      muted: false,
    };
    try {
      const raw = global.localStorage ? global.localStorage.getItem(AUDIO_STORAGE_KEY) : null;
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return defaults;
      return {
        seVolume: clampVolPct(parsed.seVolume, DEFAULT_SE_PCT),
        bgmVolume: clampVolPct(parsed.bgmVolume, DEFAULT_BGM_PCT),
        muted: Boolean(parsed.muted),
      };
    } catch (_) {
      return defaults;
    }
  }

  function saveAudioSettings(settings) {
    const clean = {
      seVolume: clampVolPct(settings && settings.seVolume, DEFAULT_SE_PCT),
      bgmVolume: clampVolPct(settings && settings.bgmVolume, DEFAULT_BGM_PCT),
      muted: Boolean(settings && settings.muted),
    };
    try {
      if (global.localStorage) {
        global.localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(clean));
      }
    } catch (_) {
      // localStorage書込不可時は無視
    }
    return clean;
  }

  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.masterOut = null;
      this._muted = false;
      this._seVolume = DEFAULT_SE_PCT / 100;
      this.lastSwapTime = -1;
    }

    get muted() {
      return this._muted;
    }

    set muted(flag) {
      this.setMuted(flag);
    }

    get seVolume() {
      return this._seVolume;
    }

    _effectiveMasterGain() {
      if (this._muted || this._seVolume <= 0) return 0;
      return this._seVolume * SE_BASE_GAIN;
    }

    _syncMasterGain(instant = false) {
      if (!this.ctx || !this.masterGain) return;
      const now = this.ctx.currentTime;
      const target = this._effectiveMasterGain();
      this.masterGain.gain.cancelScheduledValues(now);
      if (instant) {
        this.masterGain.gain.setValueAtTime(target, now);
      } else {
        this.masterGain.gain.setTargetAtTime(target, now, 0.02);
      }
    }

    setMuted(flag) {
      this._muted = !!flag;
      this._syncMasterGain(false);
    }

    setSeVolume(value01) {
      const clamped = Math.max(0, Math.min(1, Number(value01) || 0));
      this._seVolume = clamped;
      this._syncMasterGain(false);
    }

    getContext() {
      return this.ctx;
    }

    ensureContext() {
      return this.init(true);
    }

    init(force = false) {
      if (this._muted && !force) return this.ctx;
      if (!this.ctx) {
        const AudioCtx = global.AudioContext || global.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
          const masterGain = this.ctx.createGain();
          masterGain.gain.setValueAtTime(this._effectiveMasterGain(), this.ctx.currentTime);
          masterGain.connect(this.ctx.destination);
          this.masterGain = masterGain;
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
      if (
        this.ctx &&
        this.ctx.state === 'suspended' &&
        (!this._muted || force) &&
        !(global.document && global.document.hidden)
      ) {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    }

    pause() {
      if (this.ctx && this.ctx.state === 'running') {
        this.ctx.suspend().catch(() => {});
      }
    }

    resume() {
      if (
        !this._muted &&
        this.ctx &&
        this.ctx.state === 'suspended' &&
        !(global.document && global.document.hidden)
      ) {
        this.ctx.resume().catch(() => {});
      }
    }

    tone(freq, dur, type = 'sine', vol = 0.12, delay = 0) {
      if (this._muted || this._seVolume <= 0 || !this.ctx) return;
      if (global.document && global.document.hidden) return;
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

    playVolumeTest() {
      this.init();
      if (!this.ctx) return;
      this.tone(659.25, 0.11, 'triangle', 0.11, 0);
      this.tone(880.0, 0.14, 'sine', 0.09, 0.06);
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
    loadAudioSettings,
    saveAudioSettings,
    SoundEngine,
  };
})(window);
