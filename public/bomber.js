// ★ サンプル2: ミニボンバーマン（リアルタイム・2〜6人）
// URL の最後に ?game=bomber を付けて開くと、game.js のかわりにこのファイルが動く。
//
// ===== ルール =====
// ・爆弾を置いて、ブロックを壊しながら進み、爆風で相手をやっつける
// ・最後の1人になったら勝ち（全員いっしょにやられたら引き分け）
//
// ===== 操作 =====
// ・パソコン: 矢印キー / WASD で移動、スペースで爆弾
// ・スマホ: 画面の方向ボタンと 💣 ボタン
//
// ★ まず触ってみよう（どれも、このファイルの上のほうを書き換えるだけ）
//   1. BLOCK_RATE  … ブロックの多さ（0〜1）
//   2. RANGE       … 爆風の長さ（マス）
//   3. FUSE_MS     … 爆弾が爆発するまでの時間
//   4. MOVE_MS     … 1マス進むのにかかる時間（小さいほど速い）
//
// ===== 通信のしくみ（このサンプルの学習ポイント） =====
// 人生ゲームは「1人が操作 → 全員に送る」だけでよかった。
// リアルタイムゲームは、動きを全部送ると通信が多すぎる（サーバーは1秒100通まで）。そこで:
//   ① 自分の「位置」だけを送る。しかも、変わったときだけ・1秒に10回までに間引く（kind:'pos'）
//   ② 爆弾は、置いたときに1回だけ送る（kind:'bomb'）。
//      爆発の計算（十字に広がる・壁で止まる・ブロックが壊れる・ほかの爆弾が誘爆する）は、
//      全員の画面が「同じルール」で、それぞれ自分で行う。爆風そのものは送らない
//   ③ やられたかどうかは「本人」が判定して、1回だけ送る（kind:'dead'）
//   ④ 最初のブロック配置は、みんなで共通の ctx.seed から作るので、送らなくても同じになる
// 受け取った側は、通信にかかった時間のぶん、爆弾のタイミングが少しずれることがある（このサンプルは許容している）。
// 近くで2つの爆弾が同時に爆発すると、画面ごとに爆発の順番が入れかわり、壊れるブロックが少し変わることもある。
// （ぴったり合わせるには「爆発する時刻」も送る、などの工夫が必要。改造の挑戦テーマにしてよい）
//
// ctx の説明は game.js の先頭を見ること。
// 注意: 名前など他の人から届いた文字は、textContent で表示する（innerHTML に入れない）。

// ---------- ゲームの設定（ここを書き換えて遊びを変える） ----------
const COLS = 13;              // 盤面の横のマス数
const ROWS = 11;              // 盤面の縦のマス数
const BLOCK_RATE = 0.6;       // 壊せるブロックを置く割合（0〜1）
const RANGE = 2;              // 爆風が届くマス数（十字の4方向それぞれ）
const FUSE_MS = 2000;         // 爆弾が爆発するまでの時間（ミリ秒）
const FIRE_MS = 400;          // 爆風が残る時間（ミリ秒）
const MOVE_MS = 150;          // 1マス進むのにかかる時間（ミリ秒）
const MAX_BOMBS = 2;          // 同時に置ける爆弾の数
const COUNTDOWN_MS = 3000;    // 開始前のカウントダウン
const END_WAIT_MS = 600;      // 最後の1人が決まってから、勝敗を出すまで待つ時間（遅れて届くデータを待つ）
const SEND_INTERVAL_MS = 100; // 位置を送る間隔の下限（100ms = 1秒に最大10回）

const COLORS = ['#ff5d73', '#4da3ff', '#ffd23f', '#4ade80', '#c084fc', '#fb923c'];
const CELL = 32;              // 1マスの大きさ（画面に描くときのピクセル）
const EMPTY = 0, WALL = 1, BLOCK = 2; // マスの種類（WALL=こわせない柱、BLOCK=こわせるブロック）

// プレイヤーの初期位置（ctx.order の順に、四隅 → 上下の辺の中央）
const STARTS = [[0, 0], [COLS - 1, ROWS - 1], [COLS - 1, 0], [0, ROWS - 1], [(COLS - 1) / 2, 0], [(COLS - 1) / 2, ROWS - 1]];

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
};

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

// ---------- ゲーム本体 ----------
export function startGame(ctx) {
    // 盤面を作る。柱は1マスおき、ブロックは seed から決める（スタート付近は空けておく）
    const random = makeRandom(ctx.seed);
    const grid = [];
    for (let y = 0; y < ROWS; y++) {
        grid.push([]);
        for (let x = 0; x < COLS; x++) {
            let kind = EMPTY;
            if (x % 2 === 1 && y % 2 === 1) kind = WALL;
            else if (random() < BLOCK_RATE) kind = BLOCK;
            // スタート位置から2マス以内は、ブロックを置かない（動けなくなるのを防ぐ）
            if (kind === BLOCK && STARTS.some(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) <= 2)) kind = EMPTY;
            grid[y].push(kind);
        }
    }

    // 全員の画面で、同じ順序・同じ初期状態から始める
    const state = ctx.order.map((id, i) => ({
        id,
        name: ctx.players.find((p) => p.id === id)?.name ?? id,
        color: COLORS[i % COLORS.length],
        x: STARTS[i % STARTS.length][0],
        y: STARTS[i % STARTS.length][1],
        alive: true,
        left: false,
    }));
    const byId = (id) => state.find((p) => p.id === id);
    const mine = byId(ctx.me);

    const bombs = [];         // 置かれた爆弾 { x, y, owner, at（爆発する時刻） }
    const fires = new Map();  // 爆風のマス "x,y" -> 消える時刻
    const startAt = Date.now() + COUNTDOWN_MS;
    let over = false;
    let resultText = '';
    let endAt = 0;            // 生き残りが1人以下になった時刻（0 = まだ）
    let dir = null;           // 今押している方向
    let tapDir = null;        // ちょん押しした方向（短く押しても、1マスは必ず進めるため）
    let nextMoveAt = 0;
    let dirty = false;        // 位置が変わったけれど、まだ送っていない
    let lastSentAt = 0;

    ctx.area.replaceChildren();
    ctx.area.hidden = false;

    // ----- 画面の部品 -----
    const root = el('div', 'bm');
    const bar = el('div', 'bm-bar');
    const canvas = el('canvas', 'bm-canvas');
    canvas.width = COLS * CELL;
    canvas.height = ROWS * CELL;
    const g = canvas.getContext('2d');
    const pad = el('div', 'bm-pad');
    for (const [name, label] of [['left', '◀'], ['up', '▲'], ['down', '▼'], ['right', '▶']]) {
        const b = el('button', `bm-btn bm-btn--${name}`, label);
        // 押している間だけ動く（指を離す・画面外に出るとやめる）
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); dir = tapDir = name; });
        for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
            b.addEventListener(ev, () => { if (dir === name) dir = null; });
        }
        pad.append(b);
    }
    const bombBtn = el('button', 'bm-btn bm-btn--bomb', '💣');
    bombBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); placeBomb(); });
    pad.append(bombBtn);
    const panel = el('div', 'bm-panel');
    root.append(bar, canvas, pad, panel);
    ctx.area.append(root);

    // ----- ルール（全員の画面で同じ計算をする） -----
    const inBoard = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < COLS && y >= 0 && y < ROWS;
    const bombAt = (x, y) => bombs.find((b) => b.x === x && b.y === y);

    // 爆弾を置く（自分が置いたときも、誰かから届いたときも、同じ関数を使う）
    function addBomb(owner, x, y) {
        if (over || !inBoard(x, y) || grid[y][x] === WALL || bombAt(x, y)) return false;
        if (bombs.filter((b) => b.owner === owner).length >= MAX_BOMBS) return false;
        bombs.push({ x, y, owner, at: Date.now() + FUSE_MS }); // 届いた時刻から導火線を数える
        return true;
    }

    // 爆発: 十字に広がる。柱で止まる。ブロックは壊して止まる。ほかの爆弾に当たると誘爆する
    function explode(bomb) {
        bombs.splice(bombs.indexOf(bomb), 1);
        const until = Date.now() + FIRE_MS;
        fires.set(`${bomb.x},${bomb.y}`, until);
        for (const [dx, dy] of Object.values(DIRS)) {
            for (let i = 1; i <= RANGE; i++) {
                const x = bomb.x + dx * i;
                const y = bomb.y + dy * i;
                if (!inBoard(x, y) || grid[y][x] === WALL) break;
                fires.set(`${x},${y}`, until);
                if (grid[y][x] === BLOCK) { grid[y][x] = EMPTY; break; }
                const other = bombAt(x, y);
                if (other) { explode(other); break; }
            }
        }
    }

    // 自分が動けるマスか（柱・ブロック・爆弾の上には進めない）
    function canWalk(x, y) {
        return inBoard(x, y) && grid[y][x] === EMPTY && !bombAt(x, y);
    }

    function placeBomb() {
        if (over || !mine.alive || Date.now() < startAt) return;
        if (addBomb(ctx.me, mine.x, mine.y)) ctx.send({ kind: 'bomb', x: mine.x, y: mine.y });
    }

    // やられた判定は「本人」が行い、1回だけ送る
    function die() {
        mine.alive = false;
        ctx.send({ kind: 'dead' });
        checkWinner();
    }

    // 生き残りが1人以下になったら、少し待ってから終わりにする
    // （同じ爆発でほぼ同時にやられた人の 'dead' が、遅れて届くのを待つため。待たないと引き分けにならない）
    function checkWinner() {
        if (over || endAt) return;
        if (state.filter((p) => p.alive && !p.left).length <= 1) endAt = Date.now() + END_WAIT_MS;
    }
    function finish() {
        const alive = state.filter((p) => p.alive && !p.left);
        over = true;
        resultText = alive.length === 1 ? `ゲーム終了！ ${alive[0].name} の勝ち！` : 'ゲーム終了！ 引き分け';
    }

    // ----- 毎フレームの処理 -----
    function tick() {
        if (!root.isConnected) return stop(); // ロビーに戻って画面が消えたら止める
        const now = Date.now();

        // 移動（1マスずつ。押しっぱなしで MOVE_MS ごとに進む）
        if (!over && mine.alive && now >= startAt && (dir || tapDir) && now >= nextMoveAt) {
            const d = dir ?? tapDir;
            tapDir = null;
            const nx = mine.x + DIRS[d][0];
            const ny = mine.y + DIRS[d][1];
            if (canWalk(nx, ny)) {
                mine.x = nx;
                mine.y = ny;
                dirty = true;
            }
            nextMoveAt = now + MOVE_MS;
        }
        // 位置は、変わったときだけ・SEND_INTERVAL_MS 以上あけて送る（通信の間引き）
        if (dirty && now - lastSentAt >= SEND_INTERVAL_MS) {
            ctx.send({ kind: 'pos', x: mine.x, y: mine.y });
            dirty = false;
            lastSentAt = now;
        }

        if (endAt && !over && now >= endAt) finish();

        // 導火線が燃え尽きた爆弾を爆発させる
        for (const b of [...bombs]) {
            if (bombs.includes(b) && now >= b.at) explode(b);
        }
        // 爆風が消える時刻を過ぎたマスを片付ける
        for (const [key, until] of fires) if (now >= until) fires.delete(key);
        // 自分が爆風に当たっていたら、やられた
        if (mine.alive && fires.has(`${mine.x},${mine.y}`)) die();

        draw(now);
    }

    // ----- 描画 -----
    function draw(now) {
        g.fillStyle = '#0d1424';
        g.fillRect(0, 0, canvas.width, canvas.height);
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                if (grid[y][x] === WALL) g.fillStyle = '#4a587a';
                else if (grid[y][x] === BLOCK) g.fillStyle = '#9a6b3c';
                else g.fillStyle = (x + y) % 2 ? '#162033' : '#131c2e';
                g.fillRect(x * CELL, y * CELL, CELL, CELL);
            }
        }
        for (const key of fires.keys()) {
            const [x, y] = key.split(',').map(Number);
            g.fillStyle = '#ff9f1c';
            g.fillRect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4);
        }
        for (const b of bombs) {
            g.fillStyle = Math.floor((b.at - now) / 250) % 2 ? '#e8eefc' : '#ff5d73'; // もうすぐ爆発すると点滅
            g.beginPath();
            g.arc(b.x * CELL + CELL / 2, b.y * CELL + CELL / 2, CELL * 0.32, 0, Math.PI * 2);
            g.fill();
        }
        g.font = 'bold 14px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        for (const p of state) {
            if (!p.alive || p.left) continue;
            g.fillStyle = p.color;
            g.strokeStyle = p.id === ctx.me ? '#ffffff' : '#101826';
            g.lineWidth = 2;
            g.beginPath();
            g.arc(p.x * CELL + CELL / 2, p.y * CELL + CELL / 2, CELL * 0.4, 0, Math.PI * 2);
            g.fill();
            g.stroke();
            g.fillStyle = '#101826';
            g.fillText(Array.from(p.name)[0] ?? '?', p.x * CELL + CELL / 2, p.y * CELL + CELL / 2 + 1);
        }
        if (now < startAt) {
            g.fillStyle = '#000a';
            g.fillRect(0, 0, canvas.width, canvas.height);
            g.fillStyle = '#fff';
            g.font = 'bold 64px sans-serif';
            g.fillText(String(Math.ceil((startAt - now) / 1000)), canvas.width / 2, canvas.height / 2);
        }
        // 上の表示と参加者の一覧（文字は textContent で入れる）
        bar.textContent = over ? resultText : !mine.alive ? 'やられた…。ほかの人の対戦を見よう' : now < startAt ? 'まもなく開始！' : '最後の1人をめざせ！';
        bar.className = 'bm-bar' + (over ? ' bm-bar--end' : '');
        panel.replaceChildren();
        for (const p of state) {
            const row = el('span', 'bm-chip' + (p.alive && !p.left ? '' : ' bm-chip--out'));
            row.style.borderColor = p.color;
            row.textContent = p.name + (p.id === ctx.me ? '（あなた）' : '') + (p.left ? '（退出）' : p.alive ? '' : '（やられた）');
            panel.append(row);
        }
    }

    // ----- 入力 -----
    function onKeyDown(e) {
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === ' ') {
            e.preventDefault();
            if (!e.repeat) placeBomb();
        } else if (KEYS[e.key]) {
            e.preventDefault();
            dir = tapDir = KEYS[e.key];
        }
    }
    function onKeyUp(e) {
        if (KEYS[e.key] === dir) dir = null;
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    const timer = setInterval(tick, 50);
    function stop() {
        clearInterval(timer);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
    }

    // ----- 通信 -----
    ctx.onMessage(({ from, payload }) => {
        const p = byId(from);
        if (!p || p.id === ctx.me || !p.alive || p.left) return; // 知らない人・自分・やられた人のデータは無視
        // 届いたデータは、形と値をたしかめてから使う
        if (payload?.kind === 'pos' && inBoard(payload.x, payload.y) && grid[payload.y][payload.x] !== WALL) {
            p.x = payload.x;
            p.y = payload.y;
        } else if (payload?.kind === 'bomb') {
            addBomb(from, payload.x, payload.y);
        } else if (payload?.kind === 'dead') {
            p.alive = false;
            checkWinner();
        }
    });

    ctx.onPlayers((list) => {
        for (const p of state) {
            if (!p.left && !list.some((q) => q.id === p.id)) {
                p.left = true; // 抜けた人は、やられた扱い
            }
        }
        checkWinner();
    });

    draw(Date.now());
}

function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}
