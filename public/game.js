// ★ ここが「ゲームの中身」。自分たちのゲームを作るときは、このファイルを書き換える。
//
// ===== このサンプル: ミニ人生ゲーム（ターン制・2〜6人） =====
// ・順番にさいころを振り、コマを進める
// ・止まったマスのイベントで、お金が増えたり減ったり、1回休みになったりする
// ・全員がゴールしたら、お金がいちばん多い人の勝ち
//
// ★ まず触ってみよう（どれも、このファイルの上のほうを書き換えるだけ）
//   1. BOARD のマスを増やす・変える        （新しいイベントを作る）
//   2. GOAL_BONUS の金額を変える           （早くゴールするほど得、の強さ）
//   3. START_MONEY を変える                （最初のお金）
//
// ===== startGame(ctx) について =====
// ホストが「ゲームを始める」を押すと、全員の画面で startGame(ctx) が呼ばれる。
//   ctx.area        ゲームを描く場所
//   ctx.me          自分のID（例: 'p1'）
//   ctx.players     参加者の一覧 [{ id, name }, ...]
//   ctx.order       プレイヤーの順番（IDの配列。全員で同じ並び）
//   ctx.seed        全員で共通の乱数のタネ
//   ctx.send(data)  自分以外の全員にデータを送る
//   ctx.onMessage(fn)  届いたデータを受け取る。fn({ from, payload })
//   ctx.onPlayers(fn)  参加者が増減したとき。fn(players)
//
// 注意: 名前など他の人から届いた文字は、textContent で表示する（innerHTML に入れない）。

// ---------- ゲームの設定（ここを書き換えて遊びを変える） ----------
const START_MONEY = 100;            // 最初のお金（万円）
const GOAL_BONUS = [50, 30, 10, 0]; // ゴールした順のボーナス（1着, 2着, 3着, 4着以降）

// マスの種類を作る道具
const normal = () => ({ type: 'normal', label: '' });
const plus = (label, amount) => ({ type: 'plus', label, amount });     // お金がもらえる
const minus = (label, amount) => ({ type: 'minus', label, amount });   // お金が減る
const skip = (label) => ({ type: 'skip', label });                     // 次の1回を休む
const move = (label, steps) => ({ type: 'move', label, steps });       // 進む（+）／戻る（-）

// 盤面（スタートからゴールまで25マス）。上から順に、左から右へ並ぶ
const BOARD = [
    { type: 'start', label: 'スタート' },
    normal(),
    plus('アルバイト代', 10),
    normal(),
    minus('財布を落とした', 10),
    move('追い風', 2),
    normal(),
    plus('宝くじ', 30),
    skip('かぜをひいた'),
    normal(),
    minus('スマホ代', 20),
    plus('お年玉', 20),
    normal(),
    move('道に迷った', -2),
    normal(),
    plus('副業が成功', 40),
    minus('買いすぎた', 30),
    normal(),
    skip('電車が止まった'),
    plus('ボーナス', 20),
    normal(),
    move('近道を発見', 3),
    minus('修理代', 20),
    normal(),
    { type: 'goal', label: 'ゴール' },
];
const GOAL_INDEX = BOARD.length - 1;

const COLORS = ['#ff5d73', '#4da3ff', '#ffd23f', '#4ade80', '#c084fc', '#fb923c'];
const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

// ---------- ゲーム本体 ----------
export function startGame(ctx) {
    // 全員の画面で、同じ順序・同じ初期状態から始める
    const state = ctx.order.map((id, i) => ({
        id,
        name: ctx.players.find((p) => p.id === id)?.name ?? id,
        color: COLORS[i % COLORS.length],
        pos: 0,
        money: START_MONEY,
        skip: 0,        // 休みの残り回数
        finished: false,
        rank: 0,        // ゴールした順（1から）
        left: false,    // 途中で抜けた
    }));
    const byId = (id) => state.find((p) => p.id === id);
    let turn = 0;       // 今の番の人（state の番号）
    let finishedCount = 0;
    let over = false;
    let lastRoll = null;

    ctx.area.replaceChildren();
    ctx.area.hidden = false;

    // ----- 画面の部品 -----
    const root = el('div', 'jg');
    const turnBar = el('div', 'jg-turn');
    const boardEl = el('div', 'jg-board');
    const controls = el('div', 'jg-controls');
    const diceEl = el('div', 'jg-dice', '🎲');
    const rollBtn = el('button', '', 'さいころを振る');
    controls.append(diceEl, rollBtn);
    const panel = el('div', 'jg-panel');
    const logEl = el('div', 'jg-log');
    root.append(turnBar, boardEl, controls, panel, logEl);
    ctx.area.append(root);

    // 盤面のマスを作る
    const squareEls = BOARD.map((sq, i) => {
        const s = el('div', `jg-sq jg-sq--${sq.type}`);
        s.append(el('span', 'jg-sq-no', String(i)));
        s.append(el('span', 'jg-sq-label', sq.label));
        const note = squareNote(sq);
        if (note) s.append(el('span', 'jg-sq-note', note));
        s.append(el('span', 'jg-pawns'));
        boardEl.append(s);
        return s;
    });

    // ----- ルール -----
    function log(text) {
        logEl.prepend(el('div', '', text));
    }

    // さいころの目を反映する（自分が振ったときも、誰かから届いたときも、同じ関数を使う）
    function applyRoll(id, value) {
        if (over) return;
        const p = state[turn];
        if (p.id !== id) return; // 自分の番でない人のデータは無視する

        lastRoll = value;
        p.pos = Math.min(p.pos + value, GOAL_INDEX);
        let message = `${p.name} は ${value} が出て ${p.pos} マス目へ。`;

        const sq = BOARD[p.pos];
        if (sq.type === 'plus') { p.money += sq.amount; message += `「${sq.label}」+${sq.amount}万円！`; }
        if (sq.type === 'minus') { p.money -= sq.amount; message += `「${sq.label}」-${sq.amount}万円…`; }
        if (sq.type === 'skip') { p.skip = 1; message += `「${sq.label}」次は1回休み。`; }
        if (sq.type === 'move') {
            p.pos = Math.max(0, Math.min(p.pos + sq.steps, GOAL_INDEX));
            message += `「${sq.label}」${sq.steps > 0 ? sq.steps + 'マス進む' : -sq.steps + 'マス戻る'}（${p.pos}マス目）。`;
        }
        if (p.pos >= GOAL_INDEX) {
            p.finished = true;
            p.rank = ++finishedCount;
            const bonus = GOAL_BONUS[Math.min(p.rank - 1, GOAL_BONUS.length - 1)];
            p.money += bonus;
            message += `ゴール！ ${p.rank}着（ボーナス+${bonus}万円）`;
        }
        log(message);
        nextTurn();
        draw();
    }

    // 次の番の人を決める。ゴール済み・抜けた人は飛ばし、休みの人は休みを1つ消費して飛ばす
    function nextTurn() {
        const active = state.filter((p) => !p.left && !p.finished);
        if (active.length === 0) {
            over = true;
            return;
        }
        for (let i = 0; i < state.length * 2; i++) {
            turn = (turn + 1) % state.length;
            const p = state[turn];
            if (p.left || p.finished) continue;
            if (p.skip > 0) {
                p.skip--;
                log(`${p.name} は1回休み。`);
                continue;
            }
            return;
        }
    }

    // ----- 描画 -----
    function draw() {
        // コマ
        for (const s of squareEls) s.querySelector('.jg-pawns').replaceChildren();
        for (const p of state) {
            if (p.left) continue;
            const pawn = el('span', 'jg-pawn', p.name.slice(0, 1));
            pawn.style.background = p.color;
            squareEls[p.pos].querySelector('.jg-pawns').append(pawn);
        }
        // 手番の表示
        const cur = state[turn];
        if (over) {
            const top = [...state].filter((p) => !p.left).sort((a, b) => b.money - a.money)[0];
            turnBar.textContent = top ? `ゲーム終了！ ${top.name} の勝ち（${top.money}万円）` : 'ゲーム終了';
            turnBar.className = 'jg-turn jg-turn--end';
        } else {
            turnBar.textContent = cur.id === ctx.me ? 'あなたの番です。さいころを振ろう' : `${cur.name} の番です`;
            turnBar.className = 'jg-turn';
        }
        diceEl.textContent = lastRoll ? DICE[lastRoll - 1] : '🎲';
        rollBtn.disabled = over || cur.id !== ctx.me;
        // 参加者の一覧（お金・状態）
        panel.replaceChildren();
        for (const p of state) {
            const row = el('div', 'jg-row' + (!over && p === cur ? ' jg-row--now' : ''));
            const dot = el('span', 'jg-dot');
            dot.style.background = p.color;
            const status = p.left ? '（退出）' : p.finished ? `${p.rank}着` : p.skip > 0 ? '1回休み' : '';
            row.append(dot, el('span', 'jg-name', p.name + (p.id === ctx.me ? '（あなた）' : '')),
                el('span', 'jg-status', status), el('span', 'jg-money', `${p.money}万円`));
            panel.append(row);
        }
    }

    // ----- 通信 -----
    rollBtn.addEventListener('click', () => {
        if (over || state[turn].id !== ctx.me) return;
        const value = 1 + Math.floor(Math.random() * 6);
        ctx.send({ kind: 'roll', value });
        applyRoll(ctx.me, value);
    });

    ctx.onMessage(({ from, payload }) => {
        // 届いたデータは、形と値をたしかめてから使う
        if (payload?.kind === 'roll' && Number.isInteger(payload.value) && payload.value >= 1 && payload.value <= 6) {
            applyRoll(from, payload.value);
        }
    });

    ctx.onPlayers((list) => {
        for (const p of state) {
            if (!p.left && !list.some((q) => q.id === p.id)) {
                p.left = true;
                log(`${p.name} が退出しました。`);
            }
        }
        if (!over && state[turn].left) nextTurn();
        draw();
    });

    log('ゲーム開始！ スタートから、さいころでゴールを目指そう。');
    draw();
}

function squareNote(sq) {
    if (sq.type === 'plus') return `+${sq.amount}`;
    if (sq.type === 'minus') return `-${sq.amount}`;
    if (sq.type === 'skip') return '休み';
    if (sq.type === 'move') return sq.steps > 0 ? `${sq.steps}進む` : `${-sq.steps}戻る`;
    return '';
}

function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}
