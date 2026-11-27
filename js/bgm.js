/**
 * なぜ南武線は混んでるのか？ - BGM シーケンサーエンジン
 * トップ画面用（84 BPM / シンセOFF・軽量素音）とゲーム画面用（104 BPM / UnisonFilterSynth＋エフェクト）の
 * 2モードを切り替え、SoundEngine と単一の AudioContext を共有して動作する。
 */
(function (global) {
  'use strict';

  const { UnisonFilterSynth } = global.NanbuSynth;
  const AudioCfg = (global.NanbuData && global.NanbuData.AUDIO_CONFIG) || {};
  const BGM_MAX_GAIN = AudioCfg.bgmMaxGain || 0.85;
  const DEFAULT_BGM_VOL =
    typeof AudioCfg.defaultBgmVolume === 'number' ? AudioCfg.defaultBgmVolume / 100 : 0.1;
  const DEFAULT_GAME_DELAY_SEC =
    typeof AudioCfg.gameBgmDelaySec === 'number' ? AudioCfg.gameBgmDelaySec : 1.3;

  /**
   * モード別のテンポ・シンセ設定
   * - title: トップ画面用（84 BPM / シンセOFF・標準単一オシレーター構成）
   * - game:  ゲーム画面用（104 BPM / シンセON・UnisonFilterSynth＋エフェクト構成）
   */
  const BGM_MODES = {
    title: {
      bpm: 84,
      useSynth: false,
      label: 'トップ画面用（84 BPM / シンセOFF）',
    },
    game: {
      bpm: 104,
      useSynth: true,
      label: 'ゲーム画面用（104 BPM / シンセON）',
    },
  };

  /**
   * UnisonFilterSynth 用音色プリセット（ゲーム画面用・シンセON時に使用）
   */
  const SYNTH_PRESETS = {
    lead: {
      voices: 5,
      wave: 'sawtooth',
      subOsc: { enabled: true, wave: 'square', gain: 0.22, octave: -1 },
      detuneSpread: 13,
      stereoSpread: 0.65,
      gain: 0.23,
      filter: {
        stages: 2,
        q: 1.7,
        keyTrack: 1.2,
        baseHz: 380,
        velSensitivity: 1.2,
        envAmount: 3800,
        attack: 0.018,
        decay: 0.3,
        sustain: 0.45,
        release: 0.38,
      },
      amp: {
        attack: 0.015,
        decay: 0.24,
        sustain: 0.72,
        release: 0.4,
      },
    },
    bass: {
      voices: 3,
      wave: 'sawtooth',
      subOsc: { enabled: true, wave: 'sine', gain: 0.68, octave: -1 },
      detuneSpread: 7,
      stereoSpread: 0.2,
      gain: 0.27,
      filter: {
        stages: 2,
        q: 2.0,
        keyTrack: 0.85,
        baseHz: 105,
        velSensitivity: 1.3,
        envAmount: 2000,
        attack: 0.006,
        decay: 0.18,
        sustain: 0.2,
        release: 0.14,
      },
      amp: {
        attack: 0.005,
        decay: 0.16,
        sustain: 0.66,
        release: 0.16,
      },
    },
    chord: {
      voices: 4,
      wave: 'sawtooth',
      subOsc: { enabled: false },
      detuneSpread: 17,
      stereoSpread: 0.85,
      gain: 0.09,
      filter: {
        stages: 2,
        q: 1.2,
        keyTrack: 1.0,
        baseHz: 300,
        velSensitivity: 1.1,
        envAmount: 2400,
        attack: 0.015,
        decay: 0.26,
        sustain: 0.22,
        release: 0.3,
      },
      amp: {
        attack: 0.012,
        decay: 0.22,
        sustain: 0.56,
        release: 0.32,
      },
    },
    arp: {
      voices: 3,
      wave: 'triangle',
      subOsc: { enabled: true, wave: 'sine', gain: 0.28, octave: 1 },
      detuneSpread: 9,
      stereoSpread: 0.9,
      gain: 0.11,
      filter: {
        stages: 1,
        q: 1.5,
        keyTrack: 1.3,
        baseHz: 600,
        velSensitivity: 1.2,
        envAmount: 3100,
        attack: 0.004,
        decay: 0.14,
        sustain: 0.06,
        release: 0.18,
      },
      amp: {
        attack: 0.004,
        decay: 0.12,
        sustain: 0.12,
        release: 0.2,
      },
    },
  };

  /**
   * 標準単一オシレーター用設定（トップ画面用・シンセOFF時に使用）
   */
  const SIMPLE_PRESETS = {
    lead: { wave: 'triangle', gain: 0.22, attack: 0.015, release: 0.22 },
    bass: { wave: 'sine', gain: 0.26, attack: 0.008, release: 0.14 },
    chord: { wave: 'triangle', gain: 0.065, attack: 0.012, release: 0.2 },
    arp: { wave: 'sine', gain: 0.095, attack: 0.005, release: 0.14 },
  };

  const TOTAL_STEPS = 256; // 16小節 × 16ステップ（16分音符単位）

  /**
   * テーマ「田舎から都会へ向かう汽車」16小節主旋律データ（D Major）
   */
  const MELODY_NOTES = [
    // === 前半（1〜8小節）：田舎の田園風景 ===
    { step: 0, midi: 78, dur: 3, vel: 0.90 },
    { step: 3, midi: 81, dur: 3, vel: 0.88 },
    { step: 6, midi: 86, dur: 4, vel: 0.95 },
    { step: 10, midi: 85, dur: 2, vel: 0.82 },
    { step: 12, midi: 81, dur: 2, vel: 0.85 },
    { step: 14, midi: 78, dur: 2, vel: 0.80 },

    { step: 16, midi: 76, dur: 4, vel: 0.88 },
    { step: 20, midi: 73, dur: 2, vel: 0.80 },
    { step: 22, midi: 76, dur: 2, vel: 0.82 },
    { step: 24, midi: 78, dur: 3, vel: 0.86 },
    { step: 27, midi: 76, dur: 3, vel: 0.84 },
    { step: 30, midi: 73, dur: 2, vel: 0.78 },

    { step: 32, midi: 74, dur: 3, vel: 0.90 },
    { step: 35, midi: 78, dur: 3, vel: 0.86 },
    { step: 38, midi: 83, dur: 4, vel: 0.92 },
    { step: 42, midi: 81, dur: 2, vel: 0.84 },
    { step: 44, midi: 78, dur: 2, vel: 0.82 },
    { step: 46, midi: 74, dur: 2, vel: 0.80 },

    { step: 48, midi: 73, dur: 3, vel: 0.85 },
    { step: 51, midi: 76, dur: 3, vel: 0.85 },
    { step: 54, midi: 81, dur: 4, vel: 0.90 },
    { step: 58, midi: 78, dur: 2, vel: 0.82 },
    { step: 60, midi: 76, dur: 4, vel: 0.84 },

    { step: 64, midi: 71, dur: 2, vel: 0.84 },
    { step: 66, midi: 74, dur: 2, vel: 0.86 },
    { step: 68, midi: 79, dur: 4, vel: 0.92 },
    { step: 72, midi: 78, dur: 2, vel: 0.85 },
    { step: 74, midi: 76, dur: 2, vel: 0.84 },
    { step: 76, midi: 74, dur: 2, vel: 0.84 },
    { step: 78, midi: 71, dur: 2, vel: 0.80 },

    { step: 80, midi: 69, dur: 3, vel: 0.85 },
    { step: 83, midi: 74, dur: 3, vel: 0.88 },
    { step: 86, midi: 78, dur: 4, vel: 0.90 },
    { step: 90, midi: 76, dur: 2, vel: 0.82 },
    { step: 92, midi: 74, dur: 4, vel: 0.85 },

    { step: 96, midi: 76, dur: 2, vel: 0.86 },
    { step: 98, midi: 78, dur: 2, vel: 0.86 },
    { step: 100, midi: 79, dur: 3, vel: 0.90 },
    { step: 103, midi: 83, dur: 3, vel: 0.92 },
    { step: 106, midi: 81, dur: 2, vel: 0.86 },
    { step: 108, midi: 79, dur: 2, vel: 0.85 },
    { step: 110, midi: 78, dur: 2, vel: 0.84 },

    { step: 112, midi: 76, dur: 4, vel: 0.88 },
    { step: 116, midi: 74, dur: 2, vel: 0.84 },
    { step: 118, midi: 76, dur: 2, vel: 0.86 },
    { step: 120, midi: 78, dur: 2, vel: 0.88 },
    { step: 122, midi: 79, dur: 2, vel: 0.90 },
    { step: 124, midi: 81, dur: 4, vel: 0.95 },

    // === 後半（9〜16小節）：都会の街並みへ ===
    { step: 128, midi: 83, dur: 3, vel: 0.98 },
    { step: 131, midi: 86, dur: 3, vel: 0.96 },
    { step: 134, midi: 85, dur: 2, vel: 0.90 },
    { step: 136, midi: 83, dur: 2, vel: 0.90 },
    { step: 138, midi: 81, dur: 2, vel: 0.88 },
    { step: 140, midi: 79, dur: 2, vel: 0.86 },
    { step: 142, midi: 81, dur: 2, vel: 0.90 },

    { step: 144, midi: 83, dur: 4, vel: 0.95 },
    { step: 148, midi: 81, dur: 2, vel: 0.88 },
    { step: 150, midi: 78, dur: 2, vel: 0.86 },
    { step: 152, midi: 76, dur: 3, vel: 0.86 },
    { step: 155, midi: 81, dur: 3, vel: 0.90 },
    { step: 158, midi: 83, dur: 2, vel: 0.92 },

    { step: 160, midi: 85, dur: 3, vel: 0.96 },
    { step: 163, midi: 83, dur: 3, vel: 0.90 },
    { step: 166, midi: 81, dur: 4, vel: 0.92 },
    { step: 170, midi: 78, dur: 2, vel: 0.85 },
    { step: 172, midi: 81, dur: 2, vel: 0.88 },
    { step: 174, midi: 85, dur: 2, vel: 0.92 },

    { step: 176, midi: 86, dur: 3, vel: 1.00 },
    { step: 179, midi: 85, dur: 3, vel: 0.90 },
    { step: 182, midi: 83, dur: 2, vel: 0.88 },
    { step: 184, midi: 81, dur: 2, vel: 0.86 },
    { step: 186, midi: 78, dur: 2, vel: 0.85 },
    { step: 188, midi: 81, dur: 2, vel: 0.88 },
    { step: 190, midi: 83, dur: 2, vel: 0.92 },

    { step: 192, midi: 79, dur: 2, vel: 0.90 },
    { step: 194, midi: 81, dur: 2, vel: 0.88 },
    { step: 196, midi: 83, dur: 2, vel: 0.92 },
    { step: 198, midi: 86, dur: 2, vel: 0.96 },
    { step: 200, midi: 85, dur: 2, vel: 0.92 },
    { step: 202, midi: 83, dur: 2, vel: 0.88 },
    { step: 204, midi: 81, dur: 2, vel: 0.86 },
    { step: 206, midi: 79, dur: 2, vel: 0.85 },

    { step: 208, midi: 78, dur: 3, vel: 0.90 },
    { step: 211, midi: 81, dur: 3, vel: 0.92 },
    { step: 214, midi: 86, dur: 4, vel: 0.96 },
    { step: 218, midi: 85, dur: 2, vel: 0.88 },
    { step: 220, midi: 81, dur: 2, vel: 0.86 },
    { step: 222, midi: 78, dur: 2, vel: 0.84 },

    { step: 224, midi: 79, dur: 2, vel: 0.90 },
    { step: 226, midi: 83, dur: 2, vel: 0.92 },
    { step: 228, midi: 86, dur: 2, vel: 0.96 },
    { step: 230, midi: 90, dur: 2, vel: 1.00 },
    { step: 232, midi: 88, dur: 4, vel: 0.95 },
    { step: 236, midi: 86, dur: 4, vel: 0.92 },

    { step: 240, midi: 83, dur: 3, vel: 0.92 },
    { step: 243, midi: 81, dur: 3, vel: 0.90 },
    { step: 246, midi: 79, dur: 2, vel: 0.86 },
    { step: 248, midi: 81, dur: 4, vel: 0.94 },
    { step: 252, midi: 79, dur: 2, vel: 0.86 },
    { step: 254, midi: 76, dur: 2, vel: 0.84 },
  ];

  const CHORD_PROGRESSION = [
    { root: 38, notes: [62, 66, 69, 73] },
    { root: 37, notes: [61, 64, 69, 73] },
    { root: 35, notes: [62, 66, 69, 71] },
    { root: 42, notes: [61, 64, 66, 69] },
    { root: 43, notes: [62, 66, 67, 71] },
    { root: 42, notes: [62, 66, 69, 74] },
    { root: 40, notes: [62, 64, 67, 71] },
    { root: 45, notes: [62, 64, 67, 69] },

    { root: 43, notes: [62, 66, 67, 71] },
    { root: 43, notes: [61, 64, 69, 73] },
    { root: 42, notes: [61, 64, 66, 69] },
    { root: 35, notes: [62, 66, 69, 71] },
    { root: 40, notes: [62, 64, 67, 71] },
    { root: 42, notes: [61, 64, 66, 69] },
    { root: 43, notes: [62, 66, 69, 71] },
    { root: 45, notes: [61, 64, 67, 69] },
  ];

  class TrainPuzzleBgmPlayer {
    /**
     * @param {object} [options]
     * @param {function} [options.getAudioContext] 共有AudioContext供給関数
     * @param {function} [options.onStep] ステップ進行コールバック
     * @param {number} [options.initialVolume=0.1] 初期BGM音量 (0.0〜1.0)
     */
    constructor({ getAudioContext = null, onStep = null, initialVolume = DEFAULT_BGM_VOL } = {}) {
      this.getAudioContext = getAudioContext;
      this.ctx = null;
      this.synth = null;
      this.masterGain = null;
      this.directBusGain = null;
      this.synthBusGain = null;
      this.delayNode = null;
      this.delayFeedback = null;
      this.delayWet = null;
      this.noiseBuffer = null;

      this.volume = Math.max(0, Math.min(1, initialVolume));
      this.muted = false;
      this.desiredMode = null; // 'title' | 'game' | null
      this.paused = false;

      this.mode = 'title';
      this.bpm = BGM_MODES.title.bpm;
      this.useSynth = BGM_MODES.title.useSynth;

      this.isPlaying = false;
      this._starting = false;
      this.currentStep = 0;
      this.nextNoteTime = 0;
      this.timerId = null;
      this.startDelayTimer = null;
      this.startDelayRemainingMs = 0;
      this.startDelayStartedAt = 0;
      this._sessionSeq = 0;
      this.onStep = onStep;

      this.melodyMap = new Map();
      for (const n of MELODY_NOTES) {
        this.melodyMap.set(n.step, n);
      }
    }

    _effectiveGain() {
      if (this.muted || this.volume <= 0) return 0;
      return this.volume * BGM_MAX_GAIN;
    }

    _syncMasterGain(instant = false) {
      if (!this.masterGain || !this.ctx) return;
      const target = this._effectiveGain();
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      if (instant) {
        this.masterGain.gain.setValueAtTime(target, now);
      } else {
        this.masterGain.gain.setTargetAtTime(target, now, 0.02);
      }
    }

    _initAudio() {
      const providedCtx = typeof this.getAudioContext === 'function' ? this.getAudioContext() : null;
      if (this.ctx && (!providedCtx || providedCtx === this.ctx)) return;

      if (providedCtx) {
        this.ctx = providedCtx;
      } else if (!this.ctx) {
        const AudioCtx = global.AudioContext || global.webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
      }

      if (!this.ctx) return;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this._effectiveGain(), this.ctx.currentTime);

      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
      compressor.knee.setValueAtTime(12, this.ctx.currentTime);
      compressor.ratio.setValueAtTime(4, this.ctx.currentTime);
      compressor.attack.setValueAtTime(0.005, this.ctx.currentTime);
      compressor.release.setValueAtTime(0.15, this.ctx.currentTime);

      const synthBusGain = this.ctx.createGain();
      synthBusGain.gain.setValueAtTime(this.useSynth ? 1 : 0, this.ctx.currentTime);

      const delay = this.ctx.createDelay(1.0);
      delay.delayTime.setValueAtTime((60 / BGM_MODES.game.bpm) * 0.75, this.ctx.currentTime);
      const delayFeedback = this.ctx.createGain();
      delayFeedback.gain.setValueAtTime(this.useSynth ? 0.2 : 0, this.ctx.currentTime);
      const delayFilter = this.ctx.createBiquadFilter();
      delayFilter.type = 'lowpass';
      delayFilter.frequency.setValueAtTime(2400, this.ctx.currentTime);
      const delayWet = this.ctx.createGain();
      delayWet.gain.setValueAtTime(this.useSynth ? 0.15 : 0, this.ctx.currentTime);

      compressor.connect(synthBusGain);
      synthBusGain.connect(this.masterGain);
      synthBusGain.connect(delay);
      delay.connect(delayFilter);
      delayFilter.connect(delayFeedback);
      delayFeedback.connect(delay);
      delayFilter.connect(delayWet);
      delayWet.connect(this.masterGain);

      this.masterGain.connect(this.ctx.destination);
      this.directBusGain = this.ctx.createGain();
      this.directBusGain.gain.setValueAtTime(1, this.ctx.currentTime);
      this.directBusGain.connect(this.masterGain);
      this.synthBusGain = synthBusGain;
      this.delayNode = delay;
      this.delayFeedback = delayFeedback;
      this.delayWet = delayWet;
      this.synth = new UnisonFilterSynth(this.ctx, compressor);

      const bufferSize = Math.floor(this.ctx.sampleRate * 0.5);
      this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }

    _clearStartDelay() {
      if (this.startDelayTimer !== null) {
        clearTimeout(this.startDelayTimer);
        this.startDelayTimer = null;
      }
      this.startDelayRemainingMs = 0;
      this.startDelayStartedAt = 0;
    }

    _consumeStartDelayElapsed() {
      if (this.startDelayStartedAt > 0) {
        const elapsed = Date.now() - this.startDelayStartedAt;
        this.startDelayRemainingMs = Math.max(0, this.startDelayRemainingMs - elapsed);
        this.startDelayStartedAt = 0;
      }
      if (this.startDelayTimer !== null) {
        clearTimeout(this.startDelayTimer);
        this.startDelayTimer = null;
      }
      return this.startDelayRemainingMs;
    }

    _scheduleStartDelay(delayMs, seq = this._sessionSeq) {
      if (this.startDelayTimer !== null) {
        clearTimeout(this.startDelayTimer);
        this.startDelayTimer = null;
      }
      const waitMs = Math.max(0, Math.round(delayMs));
      if (waitMs <= 0) {
        this.startDelayRemainingMs = 0;
        this.startDelayStartedAt = 0;
        if (seq === this._sessionSeq && !this.paused && this.desiredMode === 'game' && !this.muted && this.volume > 0) {
          this._start(true, seq).catch(() => {});
        }
        return;
      }
      this.startDelayRemainingMs = waitMs;
      this.startDelayStartedAt = Date.now();
      if (this.muted || this.volume <= 0 || this.paused) {
        return;
      }
      this.startDelayTimer = setTimeout(() => {
        this.startDelayTimer = null;
        this.startDelayRemainingMs = 0;
        this.startDelayStartedAt = 0;
        if (seq === this._sessionSeq && !this.paused && this.desiredMode === 'game' && !this.muted && this.volume > 0) {
          this._start(true, seq).catch(() => {});
        }
      }, waitMs);
    }

    isWaitingStartDelay() {
      if (this.startDelayTimer !== null) return true;
      if (this.startDelayRemainingMs <= 0) return false;
      if (this.paused || this.startDelayStartedAt <= 0) return true;
      return Date.now() - this.startDelayStartedAt < this.startDelayRemainingMs;
    }

    isActiveOrPending() {
      return this.isPlaying || this._starting || this.isWaitingStartDelay();
    }

    _resetDirectBus() {
      if (!this.ctx || !this.masterGain) return;
      const oldBus = this.directBusGain;
      if (oldBus) {
        const now = this.ctx.currentTime;
        try {
          oldBus.gain.cancelScheduledValues(now);
          oldBus.gain.setValueAtTime(0, now);
          oldBus.disconnect();
        } catch (_) {
          // 既に切断済みの場合は無視
        }
      }
      const nextBus = this.ctx.createGain();
      nextBus.gain.setValueAtTime(1, this.ctx.currentTime);
      nextBus.connect(this.masterGain);
      this.directBusGain = nextBus;
    }

    _setSynthFxActive(active, instant = false) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const apply = (param, val) => {
        if (!param) return;
        param.cancelScheduledValues(now);
        if (instant) {
          param.setValueAtTime(val, now);
        } else {
          param.setTargetAtTime(val, now, 0.015);
        }
      };
      apply(this.synthBusGain && this.synthBusGain.gain, active ? 1 : 0);
      apply(this.delayFeedback && this.delayFeedback.gain, active ? 0.2 : 0);
      apply(this.delayWet && this.delayWet.gain, active ? 0.15 : 0);
    }

    /**
     * トップ画面用BGMを先頭から再生（84 BPM / シンセOFF）
     */
    async playTitle() {
      const seq = ++this._sessionSeq;
      this._clearStartDelay();
      this.desiredMode = 'title';
      this.paused = false;
      this._applyMode('title');
      this._stopScheduler();
      this._resetDirectBus();
      this._setSynthFxActive(false, true);
      if (this.muted || this.volume <= 0) return false;
      return await this._start(true, seq);
    }

    /**
     * ゲーム画面用BGMを先頭から再生（104 BPM / シンセON、既定1.3秒待機）
     */
    async playGame({ delaySec = DEFAULT_GAME_DELAY_SEC } = {}) {
      const seq = ++this._sessionSeq;
      this._clearStartDelay();
      this.desiredMode = 'game';
      this.paused = false;
      this._applyMode('game');
      this._stopScheduler();
      this._resetDirectBus();
      this._setSynthFxActive(false, true);
      this.currentStep = 0;
      if (this.masterGain && this.ctx) {
        const now = this.ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setTargetAtTime(0, now, 0.015);
      }
      const waitMs = Math.max(0, Math.round(delaySec * 1000));
      if (waitMs > 0) {
        this._scheduleStartDelay(waitMs, seq);
        return true;
      }
      if (this.muted || this.volume <= 0) return false;
      return await this._start(true, seq);
    }

    _applyMode(mode) {
      const cfg = BGM_MODES[mode];
      this.mode = mode;
      this.bpm = cfg.bpm;
      this.useSynth = cfg.useSynth;
    }

    _stopScheduler() {
      this.isPlaying = false;
      this._starting = false;
      if (this.timerId !== null) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
    }

    /**
     * 再生停止（リザルト画面等：次回再生時は先頭から開始）
     */
    stop() {
      this._sessionSeq++;
      this._clearStartDelay();
      this.desiredMode = null;
      this.paused = false;
      this.currentStep = 0;
      this._stopScheduler();
      this._resetDirectBus();
      this._setSynthFxActive(false, false);
      if (this.masterGain && this.ctx) {
        const now = this.ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setTargetAtTime(0, now, 0.025);
      }
    }

    /**
     * 一時停止（曲位置および開始待機残時間を保持したまま停止）
     */
    pause() {
      this._sessionSeq++;
      this._consumeStartDelayElapsed();
      if (this.isPlaying || this._starting) {
        this._stopScheduler();
      }
      this._resetDirectBus();
      this._setSynthFxActive(false, false);
      if (this.desiredMode) {
        this.paused = true;
      }
    }

    /**
     * 一時停止からの再開（保持した曲位置または待機残時間から継続）
     */
    async resume() {
      if (!this.paused) return false;
      const seq = ++this._sessionSeq;
      this.paused = false;
      if (!this.desiredMode) return false;
      if (this.desiredMode === 'game' && this.startDelayRemainingMs > 0) {
        this._scheduleStartDelay(this.startDelayRemainingMs, seq);
        return true;
      }
      if (this.muted || this.volume <= 0) return false;
      return await this._start(false, seq);
    }

    _syncPlaybackAfterAudioSettingChange() {
      if (this.muted || this.volume <= 0) {
        this._sessionSeq++;
        if (this.startDelayTimer !== null) {
          clearTimeout(this.startDelayTimer);
          this.startDelayTimer = null;
        }
        this._stopScheduler();
        return;
      }
      if (this.paused || !this.desiredMode || this.isPlaying || this._starting) {
        return;
      }
      const seq = ++this._sessionSeq;
      this._applyMode(this.desiredMode);
      const remaining = this._consumeStartDelayElapsed();
      if (this.desiredMode === 'game' && remaining > 0) {
        this._scheduleStartDelay(remaining, seq);
      } else {
        this._start(false, seq).catch(() => {});
      }
    }

    /**
     * 全体ミュート状態の反映
     */
    setMuted(flag) {
      this.muted = !!flag;
      this._syncMasterGain(false);
      this._syncPlaybackAfterAudioSettingChange();
    }

    /**
     * BGM音量調整 (0.0 〜 1.0)
     */
    setVolume(value) {
      const num = Number(value);
      this.volume = Math.max(0, Math.min(1, Number.isFinite(num) ? num : 0));
      this._syncMasterGain(false);
      this._syncPlaybackAfterAudioSettingChange();
    }

    async _start(resetPosition = true, expectedSeq = this._sessionSeq) {
      this._initAudio();
      if (!this.ctx) return false;
      this._starting = true;
      try {
        if (this.ctx.state !== 'running') {
          try {
            await this.ctx.resume();
          } catch (_) {
            // 自動再生制限中はユーザージェスチャ後に再試行される
          }
        }
        if (expectedSeq !== this._sessionSeq) return false;
        if (this.ctx.state !== 'running') return false;
        if (!this.desiredMode || this.paused || this.muted || this.volume <= 0) return false;

        this._setSynthFxActive(this.useSynth, true);
        this._syncMasterGain(true);
        if (this.isPlaying && !resetPosition) return true;

        this._stopScheduler();
        if (resetPosition) {
          this.currentStep = 0;
        }
        this.isPlaying = true;
        this.nextNoteTime = this.ctx.currentTime + 0.05;
        this.timerId = setInterval(() => this._scheduler(), 25);
        return true;
      } finally {
        if (expectedSeq === this._sessionSeq) {
          this._starting = false;
        }
      }
    }

    _scheduler() {
      if (!this.isPlaying || !this.ctx || this.ctx.state !== 'running') return;
      if (this.muted || this.volume <= 0) {
        this._stopScheduler();
        return;
      }

      const secondsPer16th = 60 / this.bpm / 4;
      const lookahead = 0.12;

      // 遅延による複数ステップ同時発音・過剰キャッチアップを防止
      if (this.nextNoteTime < this.ctx.currentTime - 0.08) {
        this.nextNoteTime = this.ctx.currentTime + 0.02;
      }

      while (this.nextNoteTime < this.ctx.currentTime + lookahead) {
        this._scheduleStep(this.currentStep, this.nextNoteTime, secondsPer16th);
        this.nextNoteTime += secondsPer16th;
        this.currentStep = (this.currentStep + 1) % TOTAL_STEPS;
      }
    }

    _scheduleStep(step, time, stepDur) {
      const bar = Math.floor(step / 16);
      const localStep = step % 16;
      const isCitySection = bar >= 8;
      const chord = CHORD_PROGRESSION[bar];

      if (typeof this.onStep === 'function') {
        this.onStep({
          step,
          bar: bar + 1,
          scene: isCitySection ? 'city' : 'countryside',
          mode: this.mode,
          bpm: this.bpm,
          useSynth: this.useSynth,
        });
      }

      // 1. 主旋律（LEAD）
      const mel = this.melodyMap.get(step);
      if (mel) {
        this._playPartNote('lead', mel.midi, {
          velocity: mel.vel,
          time,
          duration: mel.dur * stepDur * 0.92,
        });
      }

      // 2. ベース（BASS）
      if (localStep % 2 === 0) {
        let bassMidi = chord.root;
        let bassVel = 0.9;
        if (localStep === 6 || localStep === 14) {
          bassMidi = chord.root + 7;
          bassVel = 0.78;
        } else if (localStep % 4 === 2) {
          bassMidi = chord.root + 12;
          bassVel = 0.8;
        }
        this._playPartNote('bass', bassMidi, {
          velocity: bassVel,
          time,
          duration: stepDur * 1.45,
        });
      }

      // 3. コードバッキング（CHORD）
      const chordHits = isCitySection
        ? [
            { s: 0, dur: 2.2, vel: 0.76 },
            { s: 3, dur: 1.8, vel: 0.66 },
            { s: 6, dur: 1.8, vel: 0.72 },
            { s: 10, dur: 2.0, vel: 0.7 },
            { s: 14, dur: 1.6, vel: 0.74 },
          ]
        : [
            { s: 0, dur: 3.5, vel: 0.74 },
            { s: 4, dur: 3.2, vel: 0.65 },
            { s: 8, dur: 3.5, vel: 0.72 },
            { s: 12, dur: 3.0, vel: 0.66 },
          ];
      const hit = chordHits.find((h) => h.s === localStep);
      if (hit) {
        for (const noteMidi of chord.notes) {
          this._playPartNote('chord', noteMidi, {
            velocity: hit.vel,
            time,
            duration: hit.dur * stepDur,
          });
        }
      }

      // 4. アルペジオ（ARP）
      const arpOrder = [0, 1, 2, 3, 2, 1, 2, 3];
      const arpIdx = arpOrder[localStep % arpOrder.length];
      const arpOctave = localStep % 8 >= 4 ? 12 : 0;
      const arpNote = chord.notes[arpIdx] + 12 + arpOctave;
      const arpVel = localStep % 4 === 0 ? 0.66 : 0.46;
      this._playPartNote('arp', arpNote, {
        velocity: arpVel,
        time,
        duration: stepDur * 0.8,
      });

      // 5. 蒸気機関車リズム（STEAM）
      this._playSteamPercussion(localStep, time);
    }

    _playPartNote(partKey, midi, { velocity, time, duration }) {
      if (this.useSynth) {
        this.synth.playNote(midi, SYNTH_PRESETS[partKey], {
          velocity,
          time,
          duration,
        });
      } else {
        this._playSimpleNote(partKey, midi, {
          velocity,
          time,
          duration,
        });
      }
    }

    _playSimpleNote(partKey, midi, { velocity, time, duration }) {
      const ctx = this.ctx;
      const cfg = SIMPLE_PRESETS[partKey];
      const freq = UnisonFilterSynth.midiToFreq(midi);
      const t0 = Math.max(ctx.currentTime, time);

      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = cfg.wave;
      osc.frequency.setValueAtTime(freq, t0);

      const peak = cfg.gain * velocity;
      const atk = cfg.attack;
      const rel = cfg.release;
      const releaseStart = Math.max(t0 + atk + 0.01, t0 + duration);

      gainNode.gain.setValueAtTime(0.0001, t0);
      gainNode.gain.linearRampToValueAtTime(peak, t0 + atk);
      gainNode.gain.setTargetAtTime(peak * 0.72, t0 + atk, 0.08);
      gainNode.gain.setTargetAtTime(0.0001, releaseStart, rel / 3.5);

      osc.connect(gainNode);
      gainNode.connect(this.directBusGain || this.masterGain);

      const stopAt = releaseStart + rel * 1.5 + 0.03;
      osc.start(t0);
      osc.stop(stopAt);
      osc.onended = () => {
        try {
          osc.disconnect();
          gainNode.disconnect();
        } catch (_) {
          // 既に切断済みの場合は無視
        }
      };
    }

    _playSteamPercussion(localStep, time) {
      const ctx = this.ctx;
      const t0 = Math.max(ctx.currentTime, time);
      const levelScale = this.useSynth ? 1.0 : 0.72;
      const outBus = this.directBusGain || this.masterGain;

      // 動輪ピストンの低域鼓動（1拍目・3拍目）
      if (localStep % 8 === 0) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(118, t0);
        osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.11);

        gain.gain.setValueAtTime(0.28 * levelScale, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);

        osc.connect(gain);
        gain.connect(outBus);
        osc.onended = () => {
          try {
            osc.disconnect();
            gain.disconnect();
          } catch (_) {}
        };
        osc.start(t0);
        osc.stop(t0 + 0.15);
      }

      // 蒸気シリンダー噴出音
      if (this.noiseBuffer) {
        const steamPattern = [0.05, 0.025, 0.095, 0.035];
        const steamLevel = steamPattern[localStep % 4] * levelScale;
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(localStep % 4 === 2 ? 4200 : 6200, t0);
        filter.Q.setValueAtTime(1.4, t0);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(steamLevel, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.055);

        src.connect(filter);
        filter.connect(gain);
        gain.connect(outBus);
        src.onended = () => {
          try {
            src.disconnect();
            filter.disconnect();
            gain.disconnect();
          } catch (_) {}
        };
        src.start(t0);
        src.stop(t0 + 0.06);
      }

      // レールの継ぎ目音（2拍目・4拍目）
      if (localStep === 4 || localStep === 12) {
        [0, 0.055].forEach((offset, idx) => {
          const hitTime = t0 + offset;
          const rimOsc = ctx.createOscillator();
          const rimGain = ctx.createGain();
          rimOsc.type = 'triangle';
          rimOsc.frequency.setValueAtTime(idx === 0 ? 520 : 440, hitTime);
          rimOsc.frequency.exponentialRampToValueAtTime(130, hitTime + 0.04);

          rimGain.gain.setValueAtTime((idx === 0 ? 0.12 : 0.09) * levelScale, hitTime);
          rimGain.gain.exponentialRampToValueAtTime(0.001, hitTime + 0.045);

          rimOsc.connect(rimGain);
          rimGain.connect(outBus);
          rimOsc.onended = () => {
            try {
              rimOsc.disconnect();
              rimGain.disconnect();
            } catch (_) {}
          };
          rimOsc.start(hitTime);
          rimOsc.stop(hitTime + 0.05);
        });
      }
    }
  }

  global.NanbuBgm = {
    BGM_MODES,
    TrainPuzzleBgmPlayer,
  };
})(window);
