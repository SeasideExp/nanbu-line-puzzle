/**
 * なぜ南武線は常に混んでるのか - マスターデータ層
 * 出典：国土交通省「第13回大都市交通センサス（2021年12月調査・IC定期外）」南武線内相互OD行列（26×26有向行列）。
 * 駅一覧・実駅間距離・標準走行時間・ゾーン配色・運行方向・コース・ODスケーリング方式・難易度を定義する。
 */
(function (global) {
  'use strict';

  const APP_VERSION = 'Ver.0.80';

  const BOARD_CONFIG = {
    ROWS: 5,
    COLS: 8,
    MAX_CAPACITY: 40,
    MAX_DELAY_SEC: 120,
    PEAK_TARGET: 35, // 40マス盤面に対するピーク区間の期待乗車数目標
    DOOR_CELLS: [
      { r: 4, c: 1 },
      { r: 4, c: 2 },
      { r: 4, c: 5 },
      { r: 4, c: 6 },
    ],
  };

  /**
   * 南武線 全26駅・25区間の正確な距離(km)、標準制限時間(秒)、表示名、駅別グラデーションカラー
   * 川崎(01)から立川(26)まで26駅すべて異なる色合いのグラデーションを割り当てる。
   */
  const STATIONS = [
    { id: '01', num: '01', name: '川崎',       en: 'Kawasaki',            short: '川崎',     hub: true,  dist: 1.7, time: 11, bg: '#dc2626', dark: '#991b1b', transfers: ['東海道線', '京浜東北線', '京急線'] },
    { id: '02', num: '02', name: '尻手',       en: 'Shitte',              short: '尻手',     hub: false, dist: 0.9, time: 7,  bg: '#e03a1e', dark: '#9e2412', transfers: ['南武支線'] },
    { id: '03', num: '03', name: '矢向',       en: 'Yako',                short: '矢向',     hub: false, dist: 1.5, time: 10, bg: '#e34f17', dark: '#a3330c', transfers: [] },
    { id: '04', num: '04', name: '鹿島田',     en: 'Kashimada',           short: '鹿島田',   hub: false, dist: 1.2, time: 9,  bg: '#e06310', dark: '#9e4208', transfers: [] },
    { id: '05', num: '05', name: '平間',       en: 'Hirama',              short: '平間',     hub: false, dist: 1.3, time: 9,  bg: '#d97706', dark: '#964e04', transfers: [] },
    { id: '06', num: '06', name: '向河原',     en: 'Mukaigawara',         short: '向河原',   hub: false, dist: 0.9, time: 7,  bg: '#ca8a04', dark: '#8a5b03', transfers: [] },
    { id: '07', num: '07', name: '武蔵小杉',   en: 'Musashi-Kosugi',      short: '小杉',     hub: true,  dist: 1.7, time: 11, bg: '#b59a06', dark: '#7a6604', transfers: ['東横線', '目黒線', '横須賀線', '湘南新宿ライン'] },
    { id: '08', num: '08', name: '武蔵中原',   en: 'Musashi-Nakahara',    short: '中原',     hub: false, dist: 1.3, time: 9,  bg: '#96a30b', dark: '#646e06', transfers: [] },
    { id: '09', num: '09', name: '武蔵新城',   en: 'Musashi-Shinjo',      short: '新城',     hub: false, dist: 2.2, time: 13, bg: '#74a814', dark: '#4c730a', transfers: [] },
    { id: '10', num: '10', name: '武蔵溝ノ口', en: 'Musashi-Mizonokuchi', short: '溝ノ口',   hub: true,  dist: 1.2, time: 9,  bg: '#4fa81e', dark: '#337311', transfers: ['田園都市線', '大井町線'] },
    { id: '11', num: '11', name: '津田山',     en: 'Tsudayama',           short: '津田山',   hub: false, dist: 1.0, time: 8,  bg: '#2ca32c', dark: '#1c701c', transfers: [] },
    { id: '12', num: '12', name: '久地',       en: 'Kuji',                short: '久地',     hub: false, dist: 1.3, time: 9,  bg: '#16a34a', dark: '#0f6e32', transfers: [] },
    { id: '13', num: '13', name: '宿河原',     en: 'Shukugawara',         short: '宿河原',   hub: false, dist: 1.1, time: 8,  bg: '#10a368', dark: '#0a6e46', transfers: [] },
    { id: '14', num: '14', name: '登戸',       en: 'Noborito',            short: '登戸',     hub: true,  dist: 2.2, time: 13, bg: '#0d9c82', dark: '#086957', transfers: ['小田急線'] },
    { id: '15', num: '15', name: '中野島',     en: 'Nakanoshima',         short: '中野島',   hub: false, dist: 1.3, time: 9,  bg: '#0b969c', dark: '#076569', transfers: [] },
    { id: '16', num: '16', name: '稲田堤',     en: 'Inadazutsumi',        short: '稲田堤',   hub: true,  dist: 1.6, time: 10, bg: '#088cb8', dark: '#055e7d', transfers: ['京王相模原線'] },
    { id: '17', num: '17', name: '矢野口',     en: 'Yanokuchi',           short: '矢野口',   hub: false, dist: 1.7, time: 11, bg: '#0c7fd1', dark: '#08558f', transfers: [] },
    { id: '18', num: '18', name: '稲城長沼',   en: 'Inagi-Naganuma',      short: '稲城長沼', hub: false, dist: 1.4, time: 10, bg: '#1d70e0', dark: '#124b99', transfers: [] },
    { id: '19', num: '19', name: '南多摩',     en: 'Minami-Tama',         short: '南多摩',   hub: false, dist: 2.4, time: 14, bg: '#2e60eb', dark: '#1d40a3', transfers: [], isBridge: true },
    { id: '20', num: '20', name: '府中本町',   en: 'Fuchuhommachi',       short: '府中本町', hub: true,  dist: 0.9, time: 7,  bg: '#4652f0', dark: '#2e37a8', transfers: ['武蔵野線'] },
    { id: '21', num: '21', name: '分倍河原',   en: 'Bubaigawara',         short: '分倍河原', hub: true,  dist: 1.2, time: 9,  bg: '#6048ed', dark: '#412fa6', transfers: ['京王線'] },
    { id: '22', num: '22', name: '西府',       en: 'Nishifu',             short: '西府',     hub: false, dist: 1.6, time: 10, bg: '#7742e8', dark: '#522ba3', transfers: [] },
    { id: '23', num: '23', name: '谷保',       en: 'Yaho',                short: '谷保',     hub: false, dist: 1.4, time: 10, bg: '#8d3ee0', dark: '#61279c', transfers: [] },
    { id: '24', num: '24', name: '矢川',       en: 'Yagawa',              short: '矢川',     hub: false, dist: 1.3, time: 9,  bg: '#a43ad6', dark: '#732496', transfers: [] },
    { id: '25', num: '25', name: '西国立',     en: 'Nishi-Kunitachi',     short: '西国立',   hub: false, dist: 1.2, time: 9,  bg: '#b837c4', dark: '#82228c', transfers: [] },
    { id: '26', num: '26', name: '立川',       en: 'Tachikawa',           short: '立川',     hub: true,  dist: 0,   time: 0,  bg: '#c934ab', dark: '#8f2179', transfers: ['中央線', '青梅線', '多摩モノレール'] },
  ];

  /**
   * 第13回大都市交通センサス（2021年12月調査・IC定期外）
   * 南武線 全26駅 26×26 有向OD行列（行=発駅, 列=着駅, 単位=人/日）
   * 上三角 (i < j): 下り（川崎→立川） / 下三角 (i > j): 上り（立川→川崎）
   */
  const OD_MATRIX_13 = [
    [0,818,1019,1411,695,396,2468,1079,918,1555,83,239,110,516,201,197,87,61,48,101,99,44,29,13,28,196],
    [778,0,63,123,61,43,189,57,52,98,10,15,7,23,0,17,8,0,0,6,7,0,0,0,0,16],
    [967,55,0,161,84,48,304,111,69,108,7,11,7,40,17,11,0,6,0,4,0,0,0,0,0,19],
    [1352,115,148,0,154,72,600,172,128,236,19,15,26,73,24,22,17,14,0,15,6,6,6,0,0,28],
    [677,60,83,160,0,51,403,74,93,141,7,20,13,55,14,9,9,5,0,6,6,4,0,0,0,16],
    [417,39,59,77,55,0,140,93,94,144,7,22,15,56,20,30,9,17,0,16,10,14,6,4,0,17],
    [2320,193,294,666,465,186,0,836,1052,1286,81,160,113,427,144,188,54,33,31,50,65,36,25,8,15,204],
    [1035,54,115,157,89,97,888,0,295,628,14,69,36,158,58,59,32,13,9,30,23,12,12,9,4,33],
    [828,64,71,128,89,101,1021,252,0,1149,41,96,43,181,67,55,28,19,11,20,10,17,9,6,8,74],
    [1383,85,92,263,122,109,1297,585,1224,0,166,621,356,787,357,381,142,76,64,90,74,31,31,17,16,203],
    [87,14,4,24,6,8,86,13,39,199,0,24,15,58,19,12,11,0,0,9,6,0,6,0,0,7],
    [212,14,6,16,24,25,165,73,97,695,24,0,42,175,54,39,11,5,0,11,13,6,0,0,0,39],
    [97,11,8,27,11,24,100,36,41,328,12,53,0,201,40,43,19,8,5,11,10,7,0,0,0,43],
    [456,25,36,70,40,50,366,157,170,732,53,198,123,0,401,327,129,58,67,103,68,29,45,12,22,248],
    [186,9,14,19,18,23,108,47,74,296,14,57,38,390,0,134,44,15,38,48,21,8,6,0,4,89],
    [176,10,10,23,10,28,161,58,57,354,17,47,46,329,132,0,67,59,50,38,44,22,13,10,10,173],
    [83,10,6,18,10,12,45,26,35,117,8,14,21,144,43,84,0,71,54,81,30,26,14,9,20,199],
    [60,6,4,14,9,15,30,13,15,53,0,8,10,58,12,65,58,0,49,111,61,25,20,11,8,199],
    [39,0,0,0,0,6,37,9,10,54,0,7,5,74,28,72,58,44,0,136,59,15,25,14,24,231],
    [79,11,8,14,5,16,56,28,26,78,9,12,20,90,59,39,78,121,136,0,60,90,55,47,43,382],
    [100,8,0,6,11,11,53,26,16,79,0,12,6,65,17,35,39,51,56,80,0,139,80,50,68,620],
    [59,0,0,7,5,23,32,6,17,35,0,5,7,31,9,16,26,27,16,80,147,0,49,27,35,416],
    [20,0,0,6,0,8,17,10,9,31,6,4,0,44,5,13,16,19,22,57,67,45,0,38,65,579],
    [15,0,0,4,0,0,10,4,6,12,0,0,0,12,4,8,7,9,12,45,44,24,37,0,57,646],
    [17,0,0,0,0,4,16,0,5,24,0,0,0,17,4,5,15,10,22,41,65,27,79,46,0,491],
    [193,20,15,40,13,17,238,56,92,214,11,44,42,237,99,205,219,197,240,383,657,436,621,680,537,0],
  ];

  const DIRECTIONS = {
    down: {
      key: 'down',
      label: '下り（川崎→立川）',
      shortLabel: '下り',
      destName: '立川行き',
      step: 1,
      fullStart: 0,
      fullEnd: 25,
      trialStart: 0,
      trialEnd: 9,
      trialSubtitle: '川崎 → 武蔵溝ノ口（約2分）',
      fullSubtitle: '川崎 → 立川（約5分・本番）',
    },
    up: {
      key: 'up',
      label: '上り（立川→川崎）',
      shortLabel: '上り',
      destName: '川崎行き',
      step: -1,
      fullStart: 25,
      fullEnd: 0,
      trialStart: 13,
      trialEnd: 0,
      trialSubtitle: '登戸発 川崎行',
      fullSubtitle: '立川発 川崎行',
    },
  };

  const OD_MODES = {
    balanced: {
      key: 'balanced',
      label: 'バランス補正',
      gamma: 0.75,
      desc: '実OD比率ベース・全駅1人以上＆後半も遊びやすい調整（γ=0.75）',
    },
  };

  const DIFFICULTIES = {
    turtle:   { label: '亀',         timeMult: 1.3, scoreMult: 0.7 },
    easy:     { label: 'のんびり',   timeMult: 1.0, scoreMult: 0.9 },
    normal:   { label: '標準ダイヤ', timeMult: 0.8, scoreMult: 1.0 },
    recovery: { label: '回復運転',   timeMult: 0.6, scoreMult: 1.3 },
  };

  const MODIFIER_SCORE_BONUSES = {
    doorJizo: 0.25,
    g1Event:  0.10,
    stroller: 0.25,
    elderly:  0.20,
  };

  const COURSES = {
    full:               { label: '各駅停車（全線）',             isRapid: false },
    trial:              { label: '各駅停車（区間）',             isRapid: false },
    rapid:              { label: '快速',                         isRapid: true  },
    nakahara:           { label: '各駅停車（武蔵中原発着）',     isRapid: false },
    noborito:           { label: '各駅停車（登戸行）',           isRapid: false },
    rapid_inagi:        { label: '快速（稲城長沼行・立川連絡）', isRapid: true,  rapidInagiTransfer: true, isNight: true },
    nishikunitachi:     { label: '各駅停車（朝ラッシュ）',       isRapid: false },
    mizonokuchi:        { label: '各駅停車（武蔵溝ノ口発）',     isRapid: false },
    tachikawa_nakahara: { label: '各駅停車（終電間際）',         isRapid: false, isNight: true },
    rapid_noborito:     { label: '快速（登戸発・各停連絡）',     isRapid: true,  noboritoOriginTransfer: true, isNight: true },
  };

  /**
   * 南武線 快速停車駅インデックス（全12駅）
   * 0:川崎, 3:鹿島田, 6:武蔵小杉, 7:武蔵中原, 8:武蔵新城, 9:武蔵溝ノ口,
   * 13:登戸, 15:稲田堤, 17:稲城長沼, 19:府中本町, 20:分倍河原, 25:立川
   */
  const RAPID_STOPS = [0, 3, 6, 7, 8, 9, 13, 15, 17, 19, 20, 25];

  /**
   * 快速の通過区間における実所要時間（分）に準拠した標準ゲーム秒数
   * - 川崎(0)⇔鹿島田(3): 4.1km / 実所要約5分 -> 16秒
   * - 鹿島田(3)⇔武蔵小杉(6): 3.4km / 実所要約4分 -> 14秒
   * - 武蔵小杉(6)〜武蔵溝ノ口(9): 各駅停車（11秒, 9秒, 13秒）
   * - 武蔵溝ノ口(9)⇔登戸(13): 4.6km / 実所要約5.5分 -> 17秒
   * - 登戸(13)⇔稲田堤(15): 3.5km / 実所要約4分 -> 14秒
   * - 稲田堤(15)⇔稲城長沼(17): 3.3km / 実所要約4分 -> 14秒
   * - 稲城長沼(17)⇔府中本町(19): 3.8km / 実所要約4.5分 -> 15秒
   * - 府中本町(19)⇔分倍河原(20): 隣駅停車（7秒）
   * - 分倍河原(20)⇔立川(25): 6.7km / 実所要約7分 -> 20秒
   */
  const RAPID_SEGMENT_TIMES = {
    '0-3': 16,
    '3-6': 14,
    '9-13': 17,
    '13-15': 14,
    '15-17': 14,
    '17-19': 15,
    '20-25': 20,
  };

  /**
   * 快速の緩急接続（各駅停車連絡）定義
   * - 下り（川崎→立川）：稲城長沼(17)で各駅停車に連絡（南多摩18・西府21・谷保22・矢川23・西国立24への旅客は稲城長沼乗換として湧く）
   * - 上り（立川→川崎）：登戸(13)で各駅停車に連絡（宿河原12・久地11・津田山10・向河原5・平間4・矢向2・尻手1への旅客は登戸乗換として湧く）
   */
  const RAPID_CONNECTIONS = {
    down: {
      transferStationIdx: 17, // 稲城長沼
      coveredPassingStops: [18, 21, 22, 23, 24], // 南多摩〜西国立
    },
    up: {
      transferStationIdx: 13, // 登戸
      coveredPassingStops: [12, 11, 10, 5, 4, 2, 1], // 宿河原〜尻手
    },
  };

  const G1_CONFIG = {
    stationIdx: 19, // 府中本町（府中の競馬場最寄り）
    alightMult: 2,  // 府中本町で降りる客は2倍
    boardMult: 10,  // 府中本町から乗る客は10倍
    peakTarget: 37, // 40マスを溢れないギリギリまで引き上げ
  };

  /**
   * 方式A：特定列車・発駅における最低保証乗客ルール（固定枠）
   * キー: `${dirKey}:${courseKey}`
   */
  const GUARANTEED_PASSENGERS = {
    'down:full': [
      { boardIdx: 0, destIdx: 25, count: 1 }, // 川崎発 各停 立川行：川崎→立川 1人保証
    ],
    'down:rapid': [
      { boardIdx: 0, destIdx: 25, count: 2 }, // 川崎発 快速 立川行：川崎→立川 2人保証
    ],
    'down:rapid_inagi': [
      { boardIdx: 0, destIdx: 17, count: 3 }, // 川崎発 快速 稲城長沼行：川崎→稲城長沼 3人保証
    ],
    'up:rapid': [
      { boardIdx: 25, destIdx: 0, count: 1 }, // 立川発 快速 川崎行：立川→川崎 1人保証
      { boardIdx: 19, destIdx: 0, count: 1 }, // 立川発 快速 川崎行：府中本町→川崎 1人保証
    ],
    'up:nishikunitachi': [
      { boardIdx: 5, destIdx: 0, count: 1 },  // 西国立発 川崎行（朝ラッシュ）：向河原→川崎 1人保証
      { boardIdx: 4, destIdx: 0, count: 1 },  // 西国立発 川崎行（朝ラッシュ）：平間→川崎 1人保証
      { boardIdx: 3, destIdx: 0, count: 1 },  // 西国立発 川崎行（朝ラッシュ）：鹿島田→川崎 1人保証
      { boardIdx: 2, destIdx: 0, count: 1 },  // 西国立発 川崎行（朝ラッシュ）：矢向→川崎 1人保証
    ],
  };

  const JIZO_CELLS = [
    { r: 4, c: 2 }, // 左ドア内側（優先スペース横の (4,1) を空ける）
    { r: 4, c: 5 }, // 右ドア内側（優先スペース横の (4,6) を空ける）
  ];

  const PRIORITY_SPACES = [
    [
      { r: 3, c: 0 },
      { r: 4, c: 0 },
    ], // 下左端タテ2マス
    [
      { r: 3, c: 7 },
      { r: 4, c: 7 },
    ], // 下右端タテ2マス
  ];

  const STROLLER_CONFIG = {
    maxActiveSets: 2,
    penaltyPerStation: 150,
  };

  const ELDERLY_CONFIG = {
    maxActiveCount: 6, // 座席数（Row 0, Col 1..6）と同じ最大6人
    penaltyPerStation: 100,
  };

  global.NanbuData = {
    APP_VERSION,
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
  };
})(window);
