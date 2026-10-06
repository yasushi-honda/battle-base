// ★ サンプル2: ミニボンバーマン（リアルタイム・2〜6人）
// URL の最後に ?game=bomber を付けて開くと、game.js のかわりにこのファイルが動く。
//
// ===== ルール =====
// ・爆弾を置いて、壊せるブロックを壊しながら進み、爆風で相手をやっつける
// ・爆弾は3秒で爆発し、爆風は上下左右の十字に広がる。爆風に触れた爆弾は、すぐに爆発する（誘爆）
// ・ブロックを壊すと、ときどきアイテムが出る（ボム増加・火力アップ・スピードアップ）
// ・最後の1人になったら勝ち。全員いっしょにやられたら引き分け。制限時間は2分
// ・1分たつと「サドンデス」。外側から壁がらせん状に落ちてきて、つぶされるとやられる
//
// ===== 操作 =====
// ・パソコン: 矢印キー / WASD で移動、スペースで爆弾
// ・スマホ: 画面の方向パッドと 💣 ボタン
// ・ゲームパッドには対応していない（agy に頼んで足してみよう。改造の挑戦テーマ）
//
// ★ まず触ってみよう（どれも、このファイルの上のほうを書き換えるだけ）
//   1. RANGE      … 最初の爆風の長さ（マス）
//   2. FUSE_MS    … 爆弾が爆発するまでの時間
//   3. SOFT_RATE  … 壊せるブロックの多さ（0〜1）
//   4. ITEM_RATE  … ブロックを壊したときに、アイテムが出る確率（0〜1）
//   5. SPEED      … 歩く速さ（1秒に進むマス数）
//   テストのときは、URL に &sd=10 のように付けると、サドンデスが10秒で始まる（全員のURLに付ける）。
//
// ===== 通信のしくみ（このサンプルの学習ポイント）: ホストが「審判」 =====
// 人生ゲームは「1人が操作 → 全員に送る → 全員が同じ計算をする」だった。
// リアルタイムのゲームでは、それぞれの画面で計算すると、通信の遅れで結果がずれてしまう
// （同じ爆発なのに、ある画面では当たり、別の画面では外れた、など）。そこで、
// 「審判」を1人決めて、大事な判定は審判だけが行い、結果を全員に配る。
//
//   みんな ──（自分の位置 pos / 爆弾を置きたい bombReq）──▶ 審判
//   審判   ──（爆弾 bomb・爆発 boom・アイテム pick・やられた dead・壁 wall・勝敗 over）──▶ みんな
//
//   ・審判は ctx.order[0] の人（全員で同じ並びなので、全員が同じ人を審判だとわかる）
//   ・自分の移動だけは、待たずに自分の画面で先に動かす（遅れなく動くように）
//   ・他の人の位置は、届いた位置へなめらかに近づけて描く
//   ・位置は「変わったときだけ、1秒に12回まで」送る（サーバーは1人1秒100通まで）
//   ・ブロックの最初の並びは、全員で共通の ctx.seed から作るので、送らなくても全員で同じになる
//
// ===== 知っておくこと（このしくみの限界） =====
// ・自分の位置は「自己申告」なので、画面を改造すればズルができる（壁抜けなど）
// ・審判の画面（ブラウザ）が重かったり、タブが裏に回ったりすると、全員の判定が遅れる
// ・審判が部屋を抜けると、ゲームはそこで終わる（審判の引き継ぎはしない）
//
// ctx の説明は game.js の先頭を見ること。
// 注意: 名前など他の人から届いた文字は、textContent で表示するか、canvas に長さを制限して描く（innerHTML に入れない）。

// ---------- ゲームの設定（ここを書き換えて遊びを変える） ----------
// 【公式】           = 本物のボンバーマンの決まりに合わせた値
// 【サンプルの決まり】 = 公式の値ではなく、このサンプルで決めた値（公式の値が確認できなかったもの）
const FUSE_MS = 3000;            // 【公式】爆弾が爆発するまでの時間（3秒）
const TIME_LIMIT_MS = 120000;    // 【公式】制限時間（2分）
const SUDDEN_DEATH_MS = 60000;   // 【公式】サドンデスが始まる時刻（開始から1分）
const RANGE = 2;                 // 【サンプルの決まり】最初の爆風の長さ（マス）
const FIRE_MS = 500;             // 【サンプルの決まり】爆風が残る時間（ミリ秒）
const START_BOMBS = 1;           // 【サンプルの決まり】最初に同時に置ける爆弾の数
const MAX_BOMBS = 6;             // 【サンプルの決まり】ボム増加の上限（同時に置ける数）
const MAX_RANGE = 6;             // 【サンプルの決まり】火力アップの上限（爆風のマス数）
const MAX_SPEED_UP = 4;          // 【サンプルの決まり】スピードアップの上限（段階）
const SPEED = 4.0;               // 【サンプルの決まり】歩く速さ（1秒に進むマス数）
const SPEED_STEP = 0.6;          // 【サンプルの決まり】スピードアップ1段階で速くなる量
const SOFT_RATE = 0.7;           // 【サンプルの決まり】空きマスに、壊せるブロックを置く割合（0〜1）
const ITEM_RATE = 0.35;          // 【サンプルの決まり】ブロックを壊したとき、アイテムが出る確率（0〜1）
const ITEM_WEIGHTS = [['bomb', 35], ['fire', 35], ['speed', 30]]; // 【サンプルの決まり】出るアイテムの割合
const SD_WARN_MS = 3000;         // 【サンプルの決まり】サドンデスの警告から、壁が落ち始めるまでの時間
const SD_WALL_MS = 250;          // 【サンプルの決まり】壁が1マス落ちる間隔（ミリ秒）
const SD_RINGS = 4;              // 【サンプルの決まり】外側から何周ぶん壁を落とすか（真ん中は残る）
const COUNTDOWN_MS = 3000;       // 開始前のカウントダウン（3・2・1）

// 盤面の作り（奇数の大きさ・外周が壁・「行も列も偶数」のマスに固定ブロック）は【公式】と同じ形。
// 大きさ 15×13（外周の壁を含む。遊べるのは13×11）は【サンプルの決まり】。どちらも奇数にすること。
const COLS = 15;
const ROWS = 13;

// ---------- ここから下は、しくみの設定（ふだんは変えなくてよい） ----------
const TILE = 40;                 // 1マスの大きさ（canvas に描くときのピクセル）
const HITBOX = 0.7;              // プレイヤーの当たり判定の大きさ（マス）
const CORNER_ASSIST = 0.4;       // 角で引っかからないよう、通路の中心へ寄せる範囲（マス）
const TICK_MS = 50;              // 審判が判定をする間隔（ミリ秒）
const POS_SEND_MS = 84;          // 位置を送る間隔の下限（84ms ≒ 1秒に最大12回）
const TIME_SYNC_MS = 1000;       // 審判が時刻合わせ（time）を送る間隔
const BOMB_REQ_MS = 200;         // 爆弾ボタンを連打したときの、要求の間隔の下限
const DEATH_ANIM_MS = 900;       // やられたときの演出の長さ

const COLORS = ['#ff5d73', '#4da3ff', '#ffd23f', '#4ade80', '#c084fc', '#fb923c'];
const FLOOR = 0, HARD = 1, SOFT = 2; // マスの種類（HARD=壊せない壁・固定ブロック、SOFT=壊せるブロック）
const ITEM_TYPES = ITEM_WEIGHTS.map(([type]) => type);
const HALF = HITBOX / 2;

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
};

// スタート位置（外周の壁を含めた座標。0始まり）。ctx.order の順に使う。
// safe = スタートの隣で、必ず空けておくマス（スタートと合わせてL字の3マス）
const MID = Math.floor(COLS / 2) % 2 === 1 ? Math.floor(COLS / 2) : Math.floor(COLS / 2) - 1; // 真ん中の通路の列（奇数）
const STARTS = [
    { x: 1, y: 1, safe: [[1, 0], [0, 1]] },                       // 左上
    { x: COLS - 2, y: ROWS - 2, safe: [[-1, 0], [0, -1]] },       // 右下
    { x: COLS - 2, y: 1, safe: [[-1, 0], [0, 1]] },               // 右上
    { x: 1, y: ROWS - 2, safe: [[1, 0], [0, -1]] },               // 左下
    { x: MID, y: 1, safe: [[-1, 0], [0, 1]] },                    // 上の辺の中央
    { x: MID, y: ROWS - 2, safe: [[1, 0], [0, -1]] },             // 下の辺の中央
];

// テスト用: URL の sd=秒数 で、サドンデスが始まるまでの時間を変えられる（範囲外の値は無視）
const sdParam = Number(new URLSearchParams(location.search).get('sd'));
const SD_AT_MS = Number.isInteger(sdParam) && sdParam >= 1 && sdParam * 1000 < TIME_LIMIT_MS ? sdParam * 1000 : SUDDEN_DEATH_MS;

// ========== 盤面づくり ==========

// seed から、毎回同じ数列になる乱数を作る（全員で同じ盤面にするため。Math.random は人によって違ってしまう）
function makeRandom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const key = (x, y) => `${x},${y}`;
const isPillar = (x, y) => x % 2 === 0 && y % 2 === 0; // 固定ブロックのマス（行も列も偶数）
const isEdge = (x, y) => x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
const isTile = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < COLS && y >= 0 && y < ROWS;

// 盤面を作る。grid[y][x] にマスの種類が入る
function makeGrid(seed, starts) {
    const random = makeRandom(seed);
    const safe = new Set();
    for (const s of starts) {
        safe.add(key(s.x, s.y));
        for (const [dx, dy] of s.safe) safe.add(key(s.x + dx, s.y + dy));
    }
    const grid = [];
    for (let y = 0; y < ROWS; y++) {
        const row = [];
        for (let x = 0; x < COLS; x++) {
            if (isEdge(x, y) || isPillar(x, y)) {
                row.push(HARD);
            } else {
                const r = random(); // 空きマスごとに必ず1回引く（並びが全員で同じになるように）
                row.push(!safe.has(key(x, y)) && r < SOFT_RATE ? SOFT : FLOOR);
            }
        }
        grid.push(row);
    }
    return grid;
}

// サドンデスで壁が落ちる順番: 遊べる範囲の外周から、時計回りのらせん（固定ブロックのマスは飛ばす）
function makeSpiral() {
    const list = [];
    for (let r = 0; r < SD_RINGS; r++) {
        const left = 1 + r, top = 1 + r, right = COLS - 2 - r, bottom = ROWS - 2 - r;
        if (left > right || top > bottom) break;
        for (let x = left; x <= right; x++) list.push([x, top]);                         // 上の辺: 左 → 右
        for (let y = top + 1; y <= bottom; y++) list.push([right, y]);                   // 右の辺: 上 → 下
        if (bottom > top) for (let x = right - 1; x >= left; x--) list.push([x, bottom]); // 下の辺: 右 → 左
        if (right > left) for (let y = bottom - 1; y > top; y--) list.push([left, y]);    // 左の辺: 下 → 上
    }
    return list.filter(([x, y]) => !isPillar(x, y));
}

// ========== ゲーム本体 ==========
export function startGame(ctx) {
    // ----- 全員で同じ初期状態を作る -----
    const players = ctx.order.map((id, i) => {
        const start = STARTS[i % STARTS.length];
        return {
            id,
            name: ctx.players.find((p) => p.id === id)?.name ?? id,
            color: COLORS[i % COLORS.length],
            start,
            x: start.x, y: start.y,       // 画面に描く位置（マス単位の小数。マスの中心が整数）
            netX: start.x, netY: start.y, // 最後に届いた位置（審判は、これで判定する）
            dir: 'down',
            alive: true,
            left: false,                  // 部屋を抜けた
            deadAt: 0,
            bombs: START_BOMBS,           // 同時に置ける爆弾の数
            fire: RANGE,                  // 爆風の長さ
            speed: 0,                     // スピードアップの段階
            walk: 0,                      // 歩くアニメーションの進み
            moving: false,
        };
    });
    const byId = (id) => players.find((p) => p.id === id);
    const me = byId(ctx.me);
    const refereeId = ctx.order[0];
    const isReferee = ctx.me === refereeId;
    const referee = byId(refereeId);

    const grid = makeGrid(ctx.seed, players.map((p) => p.start));
    const bombs = new Map();   // 爆弾 id -> { id, x, y, owner, range, bornAt }
    const fires = new Map();   // 爆風のマス "x,y" -> { x, y, born, until }
    const items = new Map();   // アイテム "x,y" -> { x, y, type, bornAt }
    const falling = new Map(); // サドンデスで落ちた壁 "x,y" -> 落ちた時刻（落ちる演出用）

    const startedAt = performance.now();
    let goAt = startedAt + COUNTDOWN_MS; // 「GO!」の時刻（審判の time で少しずつ合わせる）
    let warnAt = 0;                      // サドンデスの警告が出た時刻（0 = まだ）
    let over = false;
    let winner = null;                   // 勝った人の id（null = 引き分け）
    let overElapsed = 0;                 // 終わったときの経過時間（残り時間の表示を止める）
    let endText = '';                    // 終わったときに画面中央に出す文字

    ctx.area.replaceChildren();
    ctx.area.hidden = false;

    // ----- 画面の部品 -----
    const root = el('div', 'bm');
    const hud = el('div', 'bm-hud');
    const timeEl = el('div', 'bm-time', '2:00');
    const chipsEl = el('div', 'bm-players');
    hud.append(timeEl, chipsEl);
    const canvas = el('canvas', 'bm-canvas');
    const W = COLS * TILE;
    const H = ROWS * TILE;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1)); // 高精細な画面でもぼやけないように
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const g = canvas.getContext('2d');
    const statsEl = el('div', 'bm-stats');
    const help = el('p', 'bm-help', '矢印キー / WASD で移動、スペースで爆弾');
    const pad = el('div', 'bm-pad');
    const dpad = el('div', 'bm-dpad');
    const arrows = {};
    for (const [name, label] of [['up', '▲'], ['down', '▼'], ['left', '◀'], ['right', '▶']]) {
        arrows[name] = el('span', `bm-arrow bm-arrow--${name}`, label);
        dpad.append(arrows[name]);
    }
    const bombBtn = el('button', 'bm-bomb', '💣');
    bombBtn.setAttribute('aria-label', '爆弾を置く');
    pad.append(dpad, bombBtn);
    root.append(hud, canvas, statsEl, help, pad);
    ctx.area.append(root);

    // ========== 審判の処理（審判の画面でだけ動く） ==========
    // 審判は、出来事（イベント）を作ると、自分の画面にすぐ反映し（applyEvent）、
    // 50ms ごとにまとめて全員に送る（{ kind: 'events', list: [...] }）。
    const fuseAt = new Map();                       // 爆弾 id -> 爆発する時刻（審判の時計）
    const refRandom = makeRandom(ctx.seed ^ 0x5bd1e995); // アイテム用の乱数（審判だけが使う）
    const spiral = makeSpiral();
    let outbox = [];
    let nextBombId = 1;
    let lastTimeSync = 0;
    let warned = false;
    let wallIndex = 0;
    let nextWallAt = 0;

    function emit(ev) {
        applyEvent(ev, performance.now());
        outbox.push(ev);
    }
    function flush() {
        if (outbox.length === 0) return;
        ctx.send({ kind: 'events', list: outbox });
        outbox = [];
    }

    // 審判が判定に使う、各プレイヤーの位置（自分は手元の位置、ほかの人は最後に届いた位置）
    function refPos(p) {
        return p === me ? [me.x, me.y] : [p.netX, p.netY];
    }

    // 爆弾を置く（置く場所は、その人の最後の位置を四捨五入したマス）
    function refPlaceBomb(p) {
        const now = performance.now();
        if (over || !p || !p.alive || now < goAt) return;
        const [px, py] = refPos(p);
        const x = Math.round(px);
        const y = Math.round(py);
        if (!isTile(x, y) || grid[y][x] !== FLOOR || bombAt(x, y)) return;
        const placed = [...bombs.values()].filter((b) => b.owner === p.id).length;
        if (placed >= p.bombs) return;
        const id = nextBombId++;
        fuseAt.set(id, now + FUSE_MS);
        emit({ kind: 'bomb', id, x, y, owner: p.id, range: p.fire });
    }

    // アイテムの種類を、ITEM_WEIGHTS の割合で選ぶ
    function pickItemType() {
        const total = ITEM_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
        let r = refRandom() * total;
        for (const [type, w] of ITEM_WEIGHTS) {
            if ((r -= w) < 0) return type;
        }
        return ITEM_WEIGHTS[0][0];
    }

    // 爆発: 十字に広がる。壁・固定ブロックで止まる。壊せるブロックは壊して、その先へは伸びない。
    // ほかの爆弾に当たると、その爆弾もすぐ爆発する（誘爆。連鎖した爆発も、同じ1回の boom にまとめる）
    function refExplode(first) {
        const queue = [...first];
        const done = new Set(queue.map((b) => b.id));
        const cells = new Map();  // "x,y" -> [x, y]
        const broken = new Map(); // 壊れるブロック
        const gone = new Map();   // 爆風に巻き込まれて消えるアイテム
        for (let i = 0; i < queue.length; i++) {
            const b = queue[i];
            cells.set(key(b.x, b.y), [b.x, b.y]);
            for (const [dx, dy] of Object.values(DIRS)) {
                for (let n = 1; n <= b.range; n++) {
                    const x = b.x + dx * n;
                    const y = b.y + dy * n;
                    if (!isTile(x, y) || grid[y][x] === HARD) break;
                    cells.set(key(x, y), [x, y]);
                    if (grid[y][x] === SOFT) { broken.set(key(x, y), [x, y]); break; }
                    if (items.has(key(x, y))) gone.set(key(x, y), [x, y]);
                    const other = bombAt(x, y);
                    if (other && !done.has(other.id)) {
                        done.add(other.id);
                        queue.push(other); // 誘爆
                        break;
                    }
                }
            }
        }
        // 壊れたブロックから、ITEM_RATE の確率でアイテムが出る
        const newItems = [];
        for (const [x, y] of broken.values()) {
            if (refRandom() < ITEM_RATE) newItems.push([x, y, pickItemType()]);
        }
        for (const b of queue) fuseAt.delete(b.id);
        emit({
            kind: 'boom',
            ids: queue.map((b) => b.id),
            fire: [...cells.values()],
            broken: [...broken.values()],
            items: newItems,
            gone: [...gone.values()],
        });
    }

    // 審判の1回分の判定（TICK_MS ごと）
    function refTick() {
        if (!root.isConnected) return stop(); // ロビーに戻って画面が消えたら止める
        const now = performance.now();
        if (over || now < goAt) return;
        const elapsed = now - goAt;

        // 時刻合わせ（みんなの残り時間の表示を、審判の時計にそろえる）
        if (now - lastTimeSync >= TIME_SYNC_MS) {
            lastTimeSync = now;
            emit({ kind: 'time', t: Math.round(elapsed) });
        }

        // 導火線が燃え尽きた爆弾、爆風が残っているマスに置かれた爆弾を爆発させる
        const due = [...bombs.values()].filter((b) => now >= (fuseAt.get(b.id) ?? 0) || isFire(b.x, b.y, now));
        if (due.length > 0) refExplode(due);

        // サドンデス: 警告 → SD_WARN_MS 後から、らせんの順に壁を落とす
        if (!warned && elapsed >= SD_AT_MS) {
            warned = true;
            nextWallAt = goAt + SD_AT_MS + SD_WARN_MS;
            emit({ kind: 'warn' });
        }
        while (warned && wallIndex < spiral.length && now >= nextWallAt) {
            const [x, y] = spiral[wallIndex++];
            nextWallAt += SD_WALL_MS;
            emit({ kind: 'wall', x, y });
        }

        // やられた判定: 最後の位置（マスに丸める）が、爆風か壁のマスに入っていたら、やられた
        for (const p of players) {
            if (!p.alive) continue;
            const [px, py] = refPos(p);
            const x = Math.round(px);
            const y = Math.round(py);
            if (isFire(x, y, now) || grid[y]?.[x] === HARD) emit({ kind: 'dead', id: p.id });
        }

        // アイテムを拾う: 最後の位置のマスにアイテムがあったら、その人の能力を上げる
        for (const p of players) {
            if (!p.alive) continue;
            const [px, py] = refPos(p);
            const item = items.get(key(Math.round(px), Math.round(py)));
            if (!item) continue;
            const bombsN = item.type === 'bomb' ? Math.min(MAX_BOMBS, p.bombs + 1) : p.bombs;
            const fireN = item.type === 'fire' ? Math.min(MAX_RANGE, p.fire + 1) : p.fire;
            const speedN = item.type === 'speed' ? Math.min(MAX_SPEED_UP, p.speed + 1) : p.speed;
            emit({ kind: 'pick', id: p.id, x: item.x, y: item.y, type: item.type, bombs: bombsN, fire: fireN, speed: speedN });
        }

        // 勝敗: 生き残りが1人以下なら終わり。制限時間になっても複数人が残っていたら引き分け
        const alive = players.filter((p) => p.alive);
        if (alive.length <= 1) emit({ kind: 'over', winner: alive[0]?.id ?? null });
        else if (elapsed >= TIME_LIMIT_MS) emit({ kind: 'over', winner: null });

        flush();
    }

    // ========== 出来事を画面に反映する（審判も、審判以外も、同じ関数を使う） ==========
    function applyEvent(ev, now) {
        if (over) return;
        switch (ev.kind) {
            case 'bomb':
                bombs.set(ev.id, { id: ev.id, x: ev.x, y: ev.y, owner: ev.owner, range: ev.range, bornAt: now });
                break;
            case 'boom':
                for (const id of ev.ids) bombs.delete(id);
                for (const [x, y] of ev.fire) fires.set(key(x, y), { x, y, born: now, until: now + FIRE_MS });
                for (const [x, y] of ev.broken) grid[y][x] = FLOOR;
                for (const [x, y] of ev.gone) items.delete(key(x, y));
                for (const [x, y, type] of ev.items) items.set(key(x, y), { x, y, type, bornAt: now });
                break;
            case 'pick': {
                const p = byId(ev.id);
                items.delete(key(ev.x, ev.y));
                p.bombs = ev.bombs;
                p.fire = ev.fire;
                p.speed = ev.speed;
                break;
            }
            case 'dead': {
                const p = byId(ev.id);
                if (p.alive) {
                    p.alive = false;
                    p.deadAt = now;
                }
                break;
            }
            case 'warn':
                warnAt = now;
                break;
            case 'wall': {
                // 壁が落ちたマスの、ブロック・爆弾・アイテムは消える（そこにいた人は、審判が「やられた」にする）
                grid[ev.y][ev.x] = HARD;
                falling.set(key(ev.x, ev.y), now);
                items.delete(key(ev.x, ev.y));
                const b = bombAt(ev.x, ev.y);
                if (b) bombs.delete(b.id);
                break;
            }
            case 'time':
                goAt = now - ev.t;
                break;
            case 'over':
                finish(ev.winner, now);
                break;
        }
    }

    function finish(winnerId, now) {
        over = true;
        winner = winnerId;
        overElapsed = Math.max(0, now - goAt);
        const w = byId(winnerId);
        if (!w) endText = '引き分け';
        else if (w === me) endText = 'あなたの勝ち！';
        else endText = `${shortName(w.name, 8)} の勝ち！`;
    }

    // 審判から届いた出来事の形と値を確かめる（おかしなデータは使わない）
    const tileList = (list, extra) => Array.isArray(list) && list.length <= COLS * ROWS
        && list.every((c) => Array.isArray(c) && isTile(c[0], c[1]) && (!extra || extra(c)));
    const isLevel = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
    function validEvent(ev) {
        if (!ev || typeof ev !== 'object') return false;
        switch (ev.kind) {
            case 'bomb':
                return Number.isInteger(ev.id) && isTile(ev.x, ev.y) && !!byId(ev.owner) && isLevel(ev.range, MAX_RANGE) && ev.range >= 1;
            case 'boom':
                return Array.isArray(ev.ids) && ev.ids.length <= 100 && ev.ids.every(Number.isInteger)
                    && tileList(ev.fire) && tileList(ev.broken) && tileList(ev.gone)
                    && tileList(ev.items, (c) => ITEM_TYPES.includes(c[2]));
            case 'pick':
                return !!byId(ev.id) && isTile(ev.x, ev.y) && ITEM_TYPES.includes(ev.type)
                    && isLevel(ev.bombs, MAX_BOMBS) && ev.bombs >= 1 && isLevel(ev.fire, MAX_RANGE) && ev.fire >= 1
                    && isLevel(ev.speed, MAX_SPEED_UP);
            case 'dead':
                return !!byId(ev.id);
            case 'warn':
                return true;
            case 'wall':
                return isTile(ev.x, ev.y);
            case 'time':
                return Number.isFinite(ev.t) && ev.t >= 0 && ev.t <= TIME_LIMIT_MS + 10000;
            case 'over':
                return ev.winner === null || !!byId(ev.winner);
            default:
                return false;
        }
    }

    // ----- 盤面を調べる道具 -----
    function bombAt(x, y) {
        for (const b of bombs.values()) if (b.x === x && b.y === y) return b;
        return null;
    }
    function isFire(x, y, now) {
        const f = fires.get(key(x, y));
        return !!f && f.until > now;
    }

    // ========== 自分の動き（どの画面でも、自分のキャラだけはここで動かす） ==========
    let held = [];          // 押しているキー（最後に押した向きを使う）
    let padDir = null;      // スマホの方向パッドの向き
    let bombWanted = false; // 爆弾ボタンが押された（次に送るときに bombReq を送る）
    let lastBombReqAt = 0;
    let lastSent = { x: me.x, y: me.y, dir: me.dir };
    let lastSentAt = 0;

    // そのマスは通れないか（盤面の外・壁・ブロック・爆弾）
    function solidAt(tx, ty) {
        if (!isTile(tx, ty)) return true;
        return grid[ty][tx] !== FLOOR || !!bombAt(tx, ty);
    }
    // 位置 (x, y) に置いたプレイヤーの四角が、マス (tx, ty) に重なるか
    function overlaps(x, y, tx, ty) {
        return x + HALF > tx - 0.5 && x - HALF < tx + 0.5 && y + HALF > ty - 0.5 && y - HALF < ty + 0.5;
    }
    // (nx, ny) に動けるか。いま重なっているマスは、通れないマスでも無視する
    // （置いた直後の爆弾の上にいる間は通れて、離れたら壁になる、のはこのしくみ）
    function canStand(nx, ny) {
        for (let ty = Math.floor(ny - HALF + 0.5); ty <= Math.floor(ny + HALF + 0.5 - 1e-6); ty++) {
            for (let tx = Math.floor(nx - HALF + 0.5); tx <= Math.floor(nx + HALF + 0.5 - 1e-6); tx++) {
                if (solidAt(tx, ty) && !overlaps(me.x, me.y, tx, ty)) return false;
            }
        }
        return true;
    }

    // 向き dir に、dist マスだけ動かす（なめらかな連続移動）
    function moveMe(dir, dist) {
        const [dx, dy] = DIRS[dir];
        const nx = me.x + dx * dist;
        const ny = me.y + dy * dist;
        if (canStand(nx, ny)) {
            me.x = nx;
            me.y = ny;
            return;
        }
        // ぶつかる場合は、壁の手前ぴったりまで進む
        let used = 0;
        if (dx !== 0) {
            const lead = dx > 0 ? Math.floor(nx + HALF + 0.5 - 1e-6) : Math.floor(nx - HALF + 0.5);
            const limit = dx > 0 ? lead - 0.5 - HALF - 1e-4 : lead + 0.5 + HALF + 1e-4;
            if ((limit - me.x) * dx > 0 && canStand(limit, me.y)) { used = Math.abs(limit - me.x); me.x = limit; }
        } else {
            const lead = dy > 0 ? Math.floor(ny + HALF + 0.5 - 1e-6) : Math.floor(ny - HALF + 0.5);
            const limit = dy > 0 ? lead - 0.5 - HALF - 1e-4 : lead + 0.5 + HALF + 1e-4;
            if ((limit - me.y) * dy > 0 && canStand(me.x, limit)) { used = Math.abs(limit - me.y); me.y = limit; }
        }
        // 角で引っかからないように: 進みたい方向の先が空いている通路が、横に CORNER_ASSIST マス以内にあれば、
        // その通路の中心へ少しずつ寄せる
        const side = dx !== 0 ? me.y : me.x; // 進む向きと直角の座標
        let best = null;
        for (const lane of new Set([Math.floor(side), Math.ceil(side)])) {
            const gap = Math.abs(side - lane);
            if (gap < 1e-3 || gap > CORNER_ASSIST) continue;
            const here = dx !== 0 ? [Math.round(me.x), lane] : [lane, Math.round(me.y)];
            const ahead = dx !== 0 ? [Math.round(me.x) + dx, lane] : [lane, Math.round(me.y) + dy];
            if (solidAt(...here) || solidAt(...ahead)) continue;
            if (best === null || gap < Math.abs(side - best)) best = lane;
        }
        if (best === null) return;
        const step = Math.min(Math.max(dist - used, dist * 0.5), Math.abs(side - best)) * Math.sign(best - side);
        if (dx !== 0 && canStand(me.x, me.y + step)) me.y += step;
        if (dy !== 0 && canStand(me.x + step, me.y)) me.x += step;
    }

    // 爆弾を置きたい（審判なら、その場で置く。審判以外は、審判に頼む）
    function requestBomb() {
        const now = performance.now();
        if (over || !me.alive || now < goAt || now - lastBombReqAt < BOMB_REQ_MS) return;
        lastBombReqAt = now;
        if (isReferee) refPlaceBomb(me);
        else bombWanted = true;
    }

    // 自分の位置を送る（変わったときだけ、POS_SEND_MS 以上あけて）。爆弾の要求は、最新の位置を送ってから送る
    function sendMine(now) {
        const x = Math.round(me.x * 100) / 100;
        const y = Math.round(me.y * 100) / 100;
        const changed = x !== lastSent.x || y !== lastSent.y || me.dir !== lastSent.dir;
        let sentPos = false;
        if (changed && now - lastSentAt >= POS_SEND_MS) {
            ctx.send({ kind: 'pos', x, y, dir: me.dir });
            lastSent = { x, y, dir: me.dir };
            lastSentAt = now;
            sentPos = true;
        }
        if (bombWanted && (!changed || sentPos)) {
            bombWanted = false;
            ctx.send({ kind: 'bombReq' }); // 場所は入れない（審判が、最後に届いた位置から決める）
        }
    }

    // ========== 毎フレームの処理 ==========
    let lastFrame = performance.now();
    let rafId = 0;
    function frame() {
        if (!root.isConnected) return stop(); // ロビーに戻って画面が消えたら止める
        const now = performance.now();
        const dt = Math.min(0.05, (now - lastFrame) / 1000); // 1フレームで進みすぎないように上限をつける
        lastFrame = now;

        // 自分の移動
        const dir = held[held.length - 1] ?? padDir;
        me.moving = false;
        if (!over && me.alive && now >= goAt && dir) {
            const bx = me.x, by = me.y;
            me.dir = dir;
            moveMe(dir, (SPEED + me.speed * SPEED_STEP) * dt);
            me.moving = Math.abs(me.x - bx) + Math.abs(me.y - by) > 1e-4;
            if (me.moving) me.walk += dt * 14;
        }
        me.netX = me.x;
        me.netY = me.y;
        if (!over && me.alive) sendMine(now);

        // ほかの人: 届いた位置へ、なめらかに近づける（離れすぎていたら、すぐその位置へ）
        const k = 1 - Math.exp(-dt * 15);
        for (const p of players) {
            if (p === me) continue;
            const ex = p.netX - p.x;
            const ey = p.netY - p.y;
            const far = Math.abs(ex) + Math.abs(ey);
            if (far > 2) { p.x = p.netX; p.y = p.netY; } else { p.x += ex * k; p.y += ey * k; }
            p.moving = far > 0.02;
            if (p.moving) p.walk += dt * 14;
        }

        // 消える時刻を過ぎた爆風を片付ける
        for (const [k2, f] of fires) if (now >= f.until) fires.delete(k2);

        draw(now);
        updateHud(now);
        rafId = requestAnimationFrame(frame);
    }

    // ========== 描画 ==========
    function draw(now) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        // 床（緑の市松模様）
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                g.fillStyle = (x + y) % 2 === 0 ? '#3f9b3f' : '#388c39';
                g.fillRect(x * TILE, y * TILE, TILE, TILE);
            }
        }
        // ブロックの影（右下にずらした半透明の四角。先に全部描いてから、上にブロックを描く）
        g.fillStyle = 'rgba(0, 24, 0, 0.32)';
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                if (grid[y][x] !== FLOOR && !isEdge(x, y)) g.fillRect(x * TILE + 6, y * TILE + 6, TILE, TILE);
            }
        }
        // 外周の内側にも影を落とす（上と左の壁の影）
        g.fillRect(TILE, TILE, (COLS - 2) * TILE, 6);
        g.fillRect(TILE, TILE, 6, (ROWS - 2) * TILE);
        // ブロック
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                if (grid[y][x] === SOFT) drawSoftBlock(g, x * TILE, y * TILE);
                if (grid[y][x] !== HARD) continue;
                const fallAt = falling.get(key(x, y));
                const drop = fallAt === undefined ? 0 : Math.max(0, 1 - (now - fallAt) / 220); // 落ちてくる演出
                drawHardBlock(g, x * TILE, y * TILE - drop * TILE * 1.5);
            }
        }
        // アイテム（ふわふわ上下に動く）
        for (const it of items.values()) {
            const bob = Math.sin((now - it.bornAt) / 260) * 2.5;
            drawItem(g, it.type, (it.x + 0.5) * TILE, (it.y + 0.5) * TILE + bob);
        }
        // 爆弾（爆発が近づくほど、速く脈打つ）
        for (const b of bombs.values()) {
            const age = now - b.bornAt;
            const pulse = 1 + 0.07 * Math.sin(age * 0.008 + age * age * 0.0000035);
            drawBomb(g, (b.x + 0.5) * TILE, (b.y + 0.5) * TILE + 2, TILE * 0.34 * pulse, now);
        }
        drawFires(g, fires, now);
        // キャラ（下にいる人ほど手前に描く）
        const nameSize = Math.min(22, Math.round(12 / Math.min(1, canvas.clientWidth / W || 1)));
        for (const p of [...players].sort((a, b) => a.y - b.y)) {
            if (p.left && p.alive) continue;
            const cx = (p.x + 0.5) * TILE;
            const cy = (p.y + 0.5) * TILE;
            drawBomber(g, cx, cy, p, now);
            if (p.alive) {
                label(g, shortName(p.name, 6), cx, cy - TILE * 0.86, nameSize, p === me ? '#ffe66d' : '#ffffff');
                if (p === me && now < goAt + 1500) { // 最初だけ、自分の上に矢印を出す
                    const yy = cy - TILE * 1.25 - Math.abs(Math.sin(now / 150)) * 5;
                    g.fillStyle = '#ffe66d';
                    g.beginPath();
                    g.moveTo(cx - 7, yy - 8); g.lineTo(cx + 7, yy - 8); g.lineTo(cx, yy);
                    g.fill();
                }
            }
        }
        drawOverlay(now);
    }

    // 画面中央の大きな文字（カウントダウン・サドンデスの警告・勝敗）
    function drawOverlay(now) {
        if (now < goAt) {
            g.fillStyle = 'rgba(0, 0, 0, 0.35)';
            g.fillRect(0, 0, W, H);
            bigText(g, String(Math.ceil((goAt - now) / 1000)), W / 2, H / 2, 120, '#ffffff');
        } else if (now < goAt + 700 && !over) {
            bigText(g, 'GO!', W / 2, H / 2, 110, '#ffe66d');
        }
        if (warnAt && !over && now - warnAt < SD_WARN_MS + 2000 && Math.floor((now - warnAt) / 300) % 2 === 0) {
            bigText(g, 'サドンデス！', W / 2, H / 2 - 30, 64, '#ff4d5e');
            bigText(g, '壁がせまってくる', W / 2, H / 2 + 36, 32, '#ffffff');
        }
        if (over) {
            g.fillStyle = 'rgba(0, 0, 0, 0.5)';
            g.fillRect(0, 0, W, H);
            const w = byId(winner);
            bigText(g, endText, W / 2, H / 2 - 10, 56, w ? w.color : '#ffffff');
            bigText(g, 'ゲーム終了', W / 2, H / 2 + 50, 26, '#ffffff');
        } else if (!me.alive) {
            bigText(g, 'やられた…（観戦中）', W / 2, H - 28, 26, '#ffffff');
        }
    }

    // 上のバー（残り時間・参加者）と、下の自分の能力。変わったときだけ書き換える
    let hudKey = '';
    function updateHud(now) {
        const elapsed = over ? overElapsed : Math.max(0, now - goAt);
        const left = Math.max(0, TIME_LIMIT_MS - elapsed);
        const sec = Math.ceil(left / 1000);
        const time = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
        const status = players.map((p) => `${p.alive && !p.left ? 1 : 0}`).join('');
        const next = `${time}|${status}|${me.bombs},${me.fire},${me.speed}|${warnAt > 0}`;
        if (next === hudKey) return;
        hudKey = next;
        timeEl.textContent = time;
        timeEl.className = 'bm-time' + (warnAt ? ' bm-time--sd' : '');
        chipsEl.replaceChildren();
        for (const p of players) {
            const chip = el('span', 'bm-chip' + (p.alive && !p.left ? '' : ' bm-chip--out') + (p === me ? ' bm-chip--me' : ''));
            const dot = el('span', 'bm-chip-dot');
            dot.style.background = p.color;
            chip.append(dot, el('span', '', p.name + (p === me ? '（あなた）' : '')));
            chip.title = p.name;
            chipsEl.append(chip);
        }
        statsEl.replaceChildren(
            el('span', '', `💣 ×${me.bombs}`),
            el('span', '', `🔥 ×${me.fire}`),
            el('span', '', `👟 ×${me.speed}`),
            el('span', 'bm-referee', `審判: ${referee.name}${isReferee ? '（あなた）' : ''}`),
        );
    }

    // ========== 入力 ==========
    function onKeyDown(e) {
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === ' ') {
            e.preventDefault();
            if (!e.repeat) requestBomb();
        } else if (KEYS[e.key]) {
            e.preventDefault();
            held = held.filter((d) => d !== KEYS[e.key]);
            held.push(KEYS[e.key]);
        }
    }
    function onKeyUp(e) {
        if (KEYS[e.key]) held = held.filter((d) => d !== KEYS[e.key]);
    }
    function onBlur() {
        held = []; // 画面の外に出たら、押しっぱなしを解除する
    }
    // 方向パッド: 指の位置が中心からどちらにずれているかで、向きを決める（指をすべらせても向きが変わる）
    function onPad(e) {
        e.preventDefault();
        const r = dpad.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        padDir = Math.hypot(dx, dy) < r.width * 0.12 ? null
            : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        for (const [name, a] of Object.entries(arrows)) a.classList.toggle('on', name === padDir);
    }
    function onPadEnd() {
        padDir = null;
        for (const a of Object.values(arrows)) a.classList.remove('on');
    }
    dpad.addEventListener('pointerdown', (e) => { dpad.setPointerCapture(e.pointerId); onPad(e); });
    dpad.addEventListener('pointermove', (e) => { if (dpad.hasPointerCapture(e.pointerId)) onPad(e); });
    dpad.addEventListener('pointerup', onPadEnd);
    dpad.addEventListener('pointercancel', onPadEnd);
    bombBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); requestBomb(); });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    const timer = isReferee ? setInterval(refTick, TICK_MS) : 0;
    rafId = requestAnimationFrame(frame);
    function stop() {
        clearInterval(timer);
        cancelAnimationFrame(rafId);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
    }

    // ========== 通信 ==========
    ctx.onMessage(({ from, payload }) => {
        const p = byId(from);
        if (!p || p === me || !payload || typeof payload !== 'object') return; // 知らない人・自分のデータは無視
        // 届いたデータは、形と値をたしかめてから使う
        if (payload.kind === 'pos') {
            const { x, y, dir } = payload;
            if (!p.alive || !Number.isFinite(x) || !Number.isFinite(y) || !DIRS[dir]) return;
            if (x < 1 || x > COLS - 2 || y < 1 || y > ROWS - 2) return; // 盤面の内側だけ
            p.netX = x;
            p.netY = y;
            p.dir = dir;
        } else if (payload.kind === 'bombReq' && isReferee) {
            refPlaceBomb(p);
        } else if (payload.kind === 'events' && from === refereeId && !isReferee) {
            if (!Array.isArray(payload.list) || payload.list.length > 300) return;
            const now = performance.now();
            for (const ev of payload.list) if (validEvent(ev)) applyEvent(ev, now);
        }
    });

    ctx.onPlayers((list) => {
        const now = performance.now();
        for (const p of players) {
            if (p.left || list.some((q) => q.id === p.id)) continue;
            p.left = true;
            // 審判が抜けたら、ゲームはそこで終わり（引き継ぎはしない）
            if (p === referee && !over) {
                finish(null, now);
                endText = `審判（${shortName(p.name, 6)}）が抜けたので終了`;
            }
            // 審判以外が抜けたら、やられた扱い（審判が決めて、全員に送る）
            if (isReferee && p.alive) emit({ kind: 'dead', id: p.id });
        }
    });
}

// ========== 描画の道具（図形だけで描く。画像は使わない） ==========

// 他の人の名前は長さを制限して描く（長すぎる名前で画面が埋まらないように）
function shortName(name, max) {
    const chars = Array.from(String(name));
    return chars.length > max ? chars.slice(0, max).join('') + '…' : chars.join('');
}

function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}

function ellipse(g, x, y, rx, ry, rot = 0) {
    g.beginPath();
    g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

// 固定ブロック・外周の壁: 灰色の立体（左上が明るく、右下が暗い）
function drawHardBlock(g, x, y) {
    const T = TILE, b = 5;
    g.fillStyle = '#8f98a3';
    g.fillRect(x, y, T, T);
    g.fillStyle = '#dfe4ea'; // 上と左のハイライト
    g.beginPath();
    g.moveTo(x, y); g.lineTo(x + T, y); g.lineTo(x + T - b, y + b); g.lineTo(x + b, y + b); g.lineTo(x + b, y + T - b); g.lineTo(x, y + T);
    g.fill();
    g.fillStyle = '#525b66'; // 下と右の影
    g.beginPath();
    g.moveTo(x + T, y); g.lineTo(x + T, y + T); g.lineTo(x, y + T); g.lineTo(x + b, y + T - b); g.lineTo(x + T - b, y + T - b); g.lineTo(x + T - b, y + b);
    g.fill();
    g.fillStyle = '#a9b1bb'; // 上の面
    g.fillRect(x + b, y + b, T - b * 2, T - b * 2);
    g.fillStyle = 'rgba(255, 255, 255, 0.35)';
    g.fillRect(x + b + 3, y + b + 3, 8, 3);
    g.strokeStyle = '#3a4048';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
}

// 壊せるブロック: レンガ柄（茶〜オレンジ）
function drawSoftBlock(g, x, y) {
    const T = TILE;
    g.fillStyle = '#6e3416'; // 目地
    g.fillRect(x, y, T, T);
    const rows = 3, bh = T / rows;
    for (let r = 0; r < rows; r++) {
        const offset = r % 2 === 0 ? 0 : -T / 4;
        for (let c = -1; c < 3; c++) {
            const bx = x + offset + c * (T / 2);
            const left = Math.max(bx + 1.5, x + 1);
            const right = Math.min(bx + T / 2 - 1.5, x + T - 1);
            if (right <= left) continue;
            const by = y + r * bh + 1.5;
            g.fillStyle = '#d27a3c';
            g.fillRect(left, by, right - left, bh - 3);
            g.fillStyle = '#f2a865'; // レンガの上の明るい線
            g.fillRect(left, by, right - left, 2);
            g.fillStyle = '#a4521f'; // レンガの下の暗い線
            g.fillRect(left, by + bh - 5, right - left, 2);
        }
    }
    g.strokeStyle = '#4a2008';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
}

// 爆弾: 黒い球にハイライト、導火線と火花
function drawBomb(g, cx, cy, r, now) {
    g.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ellipse(g, cx + 2, cy + r * 0.9, r * 0.85, r * 0.28);
    g.fill();
    // 導火線の口金
    g.save();
    g.translate(cx + r * 0.55, cy - r * 0.62);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#7b8494';
    g.fillRect(-r * 0.22, -r * 0.2, r * 0.44, r * 0.34);
    g.restore();
    // 球
    const grad = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    grad.addColorStop(0, '#5d6274');
    grad.addColorStop(0.55, '#1b1d27');
    grad.addColorStop(1, '#050609');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ellipse(g, cx - r * 0.38, cy - r * 0.42, r * 0.2, r * 0.11, -0.7);
    g.fill();
    // 導火線
    const fx = cx + r * 0.95, fy = cy - r * 1.1;
    g.strokeStyle = '#d8b878';
    g.lineWidth = Math.max(2, r * 0.13);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx + r * 0.62, cy - r * 0.7);
    g.quadraticCurveTo(cx + r * 0.95, cy - r * 0.8, fx, fy);
    g.stroke();
    // 火花（ちらちら大きさが変わる）
    const s = r * (0.28 + 0.1 * Math.sin(now / 45));
    g.fillStyle = '#ff8a1f';
    star(g, fx, fy, s, s * 0.45, 8, now / 200);
    g.fill();
    g.fillStyle = '#fff3a0';
    star(g, fx, fy, s * 0.55, s * 0.25, 8, -now / 150);
    g.fill();
}

function star(g, cx, cy, outer, inner, points, rot) {
    g.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const rr = i % 2 === 0 ? outer : inner;
        const a = rot + (i * Math.PI) / points;
        g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
}

// 爆風: オレンジの十字＋黄色の芯。となりの爆風のマスとつなげて描くので、十字になり、先端は丸くなる。
// 時間がたつと少し細くなって消える
function drawFires(g, fires, now) {
    const layers = [['#ff6a13', 0.9], ['#ffc531', 0.58], ['#fff8d6', 0.26]];
    for (const [color, width] of layers) {
        g.fillStyle = color;
        for (const f of fires.values()) {
            const t = Math.min(1, (now - f.born) / (f.until - f.born));
            const w = TILE * width * (1 - 0.45 * t);
            const cx = (f.x + 0.5) * TILE;
            const cy = (f.y + 0.5) * TILE;
            g.globalAlpha = t > 0.75 ? (1 - t) / 0.25 : 1;
            g.beginPath();
            g.arc(cx, cy, w / 2, 0, Math.PI * 2);
            g.fill();
            for (const [dx, dy] of Object.values(DIRS)) {
                if (!fires.has(key(f.x + dx, f.y + dy))) continue;
                // となりのマスの方向へ、マスの端まで帯を伸ばす
                if (dx !== 0) g.fillRect(dx > 0 ? cx : cx - TILE / 2, cy - w / 2, TILE / 2, w);
                else g.fillRect(cx - w / 2, dy > 0 ? cy : cy - TILE / 2, w, TILE / 2);
            }
        }
    }
    g.globalAlpha = 1;
}

// アイテム: 角丸の四角の上にアイコン（ボム・炎・靴）
function drawItem(g, type, cx, cy) {
    const s = TILE * 0.8;
    const colors = { bomb: ['#9fd3ff', '#2f6fd6'], fire: ['#ff9a8a', '#c2261b'], speed: ['#fff07a', '#d99a06'] };
    const [c1, c2] = colors[type];
    g.fillStyle = 'rgba(0, 0, 0, 0.3)';
    roundRect(g, cx - s / 2 + 3, cy - s / 2 + 4, s, s, 7);
    g.fill();
    const grad = g.createLinearGradient(0, cy - s / 2, 0, cy + s / 2);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    g.fillStyle = grad;
    roundRect(g, cx - s / 2, cy - s / 2, s, s, 7);
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.stroke();
    g.strokeStyle = '#1d1b33';
    g.lineWidth = 1;
    roundRect(g, cx - s / 2 - 1, cy - s / 2 - 1, s + 2, s + 2, 8);
    g.stroke();
    if (type === 'bomb') {
        drawBomb(g, cx - 2, cy + 2, s * 0.25, 0);
        // 「＋」
        g.fillStyle = '#ffffff';
        g.fillRect(cx + s * 0.18, cy + s * 0.04, s * 0.22, s * 0.07);
        g.fillRect(cx + s * 0.255, cy - s * 0.035, s * 0.07, s * 0.22);
    } else if (type === 'fire') {
        flame(g, cx, cy + 2, s * 0.36, '#ff7a1a');
        flame(g, cx, cy + 6, s * 0.2, '#ffe25a');
    } else {
        shoe(g, cx + 2, cy + 1, s * 0.34);
    }
}

function flame(g, cx, cy, s, color) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(cx, cy - s);
    g.bezierCurveTo(cx + s * 0.95, cy - s * 0.15, cx + s * 0.75, cy + s * 0.8, cx, cy + s * 0.8);
    g.bezierCurveTo(cx - s * 0.75, cy + s * 0.8, cx - s * 0.95, cy - s * 0.15, cx, cy - s);
    g.fill();
}

// 靴（スピードアップ）: 横から見たスニーカー＋スピード線
function shoe(g, cx, cy, s) {
    g.fillStyle = '#2459d8';
    g.strokeStyle = '#13183a';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(cx - s * 0.75, cy - s * 0.65);
    g.lineTo(cx - s * 0.15, cy - s * 0.65);
    g.lineTo(cx - s * 0.02, cy - s * 0.12);
    g.quadraticCurveTo(cx + s * 0.8, cy - s * 0.05, cx + s * 0.85, cy + s * 0.35);
    g.lineTo(cx - s * 0.75, cy + s * 0.35);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff'; // 靴底
    g.fillRect(cx - s * 0.8, cy + s * 0.35, s * 1.7, s * 0.22);
    g.strokeRect(cx - s * 0.8, cy + s * 0.35, s * 1.7, s * 0.22);
    g.strokeStyle = '#ffffff'; // ひも
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(cx - s * 0.12, cy - s * 0.4); g.lineTo(cx + s * 0.1, cy - s * 0.32);
    g.moveTo(cx - s * 0.06, cy - s * 0.2); g.lineTo(cx + s * 0.18, cy - s * 0.12);
    g.stroke();
    g.strokeStyle = '#13183a'; // スピード線
    g.beginPath();
    for (const dy of [-0.4, 0, 0.3]) {
        g.moveTo(cx - s * 1.25, cy + s * dy);
        g.lineTo(cx - s * 0.9, cy + s * dy);
    }
    g.stroke();
}

// キャラ: 白い丸い頭、色つきの体、目、頭の上の触角（玉）。向きで顔の位置が変わり、歩くと体が上下する。
// やられたら、回転しながら小さくなって消える
function drawBomber(g, cx, cy, p, now) {
    const T = TILE;
    let alpha = 1, rot = 0, scale = 1;
    if (!p.alive) {
        const k = (now - p.deadAt) / DEATH_ANIM_MS;
        if (k >= 1) return;
        rot = k * Math.PI * 3;
        scale = 1 - k * 0.85;
        alpha = 1 - k;
    }
    const walking = p.alive && p.moving;
    const swing = walking ? Math.sin(p.walk) : 0;
    const bob = walking ? Math.abs(Math.sin(p.walk)) * T * 0.05 : 0;
    const outline = '#1c1d2e';

    if (p.alive) { // 足元の影
        g.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ellipse(g, cx, cy + T * 0.38, T * 0.27, T * 0.08);
        g.fill();
    }
    g.save();
    g.globalAlpha = alpha;
    g.translate(cx, cy);
    g.rotate(rot);
    g.scale(scale, scale);
    g.lineWidth = 1.5;
    g.strokeStyle = outline;

    // 足（歩くと交互に動く）
    g.fillStyle = '#3d2c5c';
    ellipse(g, -T * 0.12, T * 0.33 - Math.max(0, swing) * T * 0.05, T * 0.1, T * 0.065);
    g.fill(); g.stroke();
    ellipse(g, T * 0.12, T * 0.33 - Math.max(0, -swing) * T * 0.05, T * 0.1, T * 0.065);
    g.fill(); g.stroke();
    // 体
    g.fillStyle = p.color;
    roundRect(g, -T * 0.19, T * 0.02 - bob, T * 0.38, T * 0.28, T * 0.09);
    g.fill(); g.stroke();
    g.fillStyle = 'rgba(0, 0, 0, 0.25)'; // ベルト
    g.fillRect(-T * 0.18, T * 0.17 - bob, T * 0.36, T * 0.05);
    // 手
    g.fillStyle = '#ffffff';
    ellipse(g, -T * 0.25, T * 0.13 - bob + swing * T * 0.03, T * 0.065, T * 0.065);
    g.fill(); g.stroke();
    ellipse(g, T * 0.25, T * 0.13 - bob - swing * T * 0.03, T * 0.065, T * 0.065);
    g.fill(); g.stroke();
    // 触角（玉）
    const hy = -T * 0.2 - bob; // 頭の中心
    const hr = T * 0.27;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, hy - hr + 2);
    g.lineTo(0, hy - hr - T * 0.12);
    g.stroke();
    g.lineWidth = 1.5;
    g.fillStyle = p.color;
    g.beginPath();
    g.arc(0, hy - hr - T * 0.15, T * 0.07, 0, Math.PI * 2);
    g.fill(); g.stroke();
    // 頭
    const grad = g.createRadialGradient(-hr * 0.35, hy - hr * 0.4, hr * 0.1, 0, hy, hr);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#cfd5e2');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, hy, hr, 0, Math.PI * 2);
    g.fill(); g.stroke();
    // 顔と目（後ろ向きのときは見えない）
    if (p.dir !== 'up') {
        const fx = p.dir === 'left' ? -T * 0.07 : p.dir === 'right' ? T * 0.07 : 0;
        g.fillStyle = '#ffc9a6';
        roundRect(g, fx - T * 0.16, hy - T * 0.08, T * 0.32, T * 0.19, T * 0.07);
        g.fill(); g.stroke();
        g.fillStyle = '#111111';
        for (const ex of [-T * 0.06, T * 0.06]) {
            ellipse(g, fx + ex, hy + T * 0.015, T * 0.026, T * 0.055);
            g.fill();
        }
    }
    g.restore();
}

// ふちどりつきの文字（どんな背景の上でも読めるように）
function bigText(g, text, x, y, size, color) {
    g.font = `900 ${size}px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif`;
    const width = g.measureText(text).width;
    if (width > COLS * TILE - 40) { // 横にはみ出すときは、文字を小さくする
        size = Math.floor(size * (COLS * TILE - 40) / width);
        g.font = `900 ${size}px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(4, size * 0.16);
    g.strokeStyle = '#1a1020';
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
}

function label(g, text, x, y, size, color) {
    g.font = `bold ${size}px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
}

function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}
