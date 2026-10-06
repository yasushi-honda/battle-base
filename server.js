// 対戦ゲームの土台サーバー
// 役割: ① 画面ファイル（public/）を配る ② 部屋を作る ③ 部屋の中でメッセージを中継する
// ゲームのルールはここには書かない。ルールは public/game.js に書く。
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 8000;

// ---- 設定（ここを変えると、部屋の人数などが変わる） ----
const MAX_PLAYERS = 6;            // 1つの部屋に入れる人数の上限
const MIN_PLAYERS = 2;            // ゲームを始めるのに必要な人数
const MAX_ROOMS = 30;             // 同時に作れる部屋の数の上限（作りすぎを防ぐ）
// この時間、動き（入室・開始・メッセージの中継）のない部屋は閉じる（枠を埋めたままにされるのを防ぐ）
const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MS) || 30 * 60 * 1000;
const MAX_NAME_LENGTH = 12;       // 名前の最大文字数
// 公開ポートは誰でも接続できるため、1通のサイズと送信頻度に上限を設ける
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_MESSAGES_PER_SECOND = 100;

const MIME_TYPES = {
    '.html': 'text/html; charset=UTF-8',
    '.css': 'text/css; charset=UTF-8',
    '.js': 'application/javascript; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

// ---- 画面ファイルを配る ----
const server = http.createServer((req, res) => {
    let reqPath;
    try {
        reqPath = decodeURIComponent(req.url.split('?')[0]);
    } catch {
        res.writeHead(400);
        res.end('Bad Request');
        return;
    }
    if (reqPath === '/') reqPath = '/index.html';

    const filePath = path.join(PUBLIC_DIR, reqPath);
    // public/ の外のファイルは返さない
    if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
        });
        fs.createReadStream(filePath).pipe(res);
    });
});

// ---- 部屋 ----
const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD_BYTES });
const rooms = new Map(); // roomId -> { id, players: Map(playerId -> {id, name, ws}), hostId, started, seq }

function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return rooms.has(id) ? generateRoomId() : id;
}

// サーバーの動きを、ターミナルに1行で出す。
// ターミナルへの出力があると、Codespacesの「操作なしで停止」までの時間がリセットされる（公式）。
// 名前は他の人が入力した文字なので、端末を乱す制御文字は取り除いてから出す
function log(text) {
    const time = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    console.log(`[${time}] ${stripInvisible(text)}`);
}

// 制御文字（C0・C1）、書式文字（表示の向きを変えるものなど）、行区切りを取り除く
function stripInvisible(text) {
    return String(text ?? '').replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '');
}

function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function touch(room) {
    room.lastActivity = Date.now();
}

function playerList(room) {
    return [...room.players.values()].map((p) => ({ id: p.id, name: p.name }));
}

function broadcast(room, data, exceptId = null) {
    for (const p of room.players.values()) {
        if (p.id !== exceptId) send(p.ws, data);
    }
}

function sendPlayers(room) {
    broadcast(room, { type: 'players', players: playerList(room), hostId: room.hostId, started: room.started });
}

function cleanName(name) {
    const s = stripInvisible(name).trim().slice(0, MAX_NAME_LENGTH);
    return s || 'ななし';
}

function addPlayer(room, ws, name) {
    const id = `p${++room.seq}`;
    room.players.set(id, { id, name: cleanName(name), ws });
    ws.roomId = room.id;
    ws.playerId = id;
    if (!room.hostId) room.hostId = id;
    return id;
}

function handleLeave(ws) {
    const room = rooms.get(ws.roomId);
    if (!room) return;
    const leaving = room.players.get(ws.playerId);
    room.players.delete(ws.playerId);
    ws.roomId = null;
    ws.playerId = null;
    log(`部屋 ${room.id}: ${leaving?.name ?? '誰か'} が出ました（残り${room.players.size}人）`);

    if (room.players.size === 0) {
        rooms.delete(room.id);
        log(`部屋 ${room.id}: 誰もいなくなったので閉じました`);
        return;
    }
    // 部屋のリーダー（ホスト）が抜けたら、残った先頭の人に引き継ぐ
    if (!room.players.has(room.hostId)) {
        room.hostId = room.players.keys().next().value;
    }
    sendPlayers(room);
}

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.roomId = null;
    ws.playerId = null;
    ws.windowStart = Date.now();
    ws.windowCount = 0;

    ws.on('pong', () => { ws.isAlive = true; });
    // 上限超過などの通信エラーでサーバー全体が落ちないよう、接続ごとに受け止める
    ws.on('error', () => {});

    ws.on('message', (message) => {
        const now = Date.now();
        if (now - ws.windowStart >= 1000) {
            ws.windowStart = now;
            ws.windowCount = 0;
        }
        if (++ws.windowCount > MAX_MESSAGES_PER_SECOND) return;

        let msg;
        try {
            msg = JSON.parse(message);
        } catch {
            return;
        }
        if (!msg || typeof msg !== 'object') return;

        switch (msg.type) {
            case 'create_room': {
                if (ws.roomId) return;
                if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', message: '部屋が多すぎます。しばらくしてからやり直してください。' });
                const room = { id: generateRoomId(), players: new Map(), hostId: null, started: false, seq: 0, relayed: 0, lastActivity: Date.now() };
                rooms.set(room.id, room);
                const you = addPlayer(room, ws, msg.name);
                log(`部屋 ${room.id}: ${room.players.get(you).name} が部屋を作りました`);
                send(ws, {
                    type: 'room_joined', roomId: room.id, you,
                    players: playerList(room), hostId: room.hostId, maxPlayers: MAX_PLAYERS,
                });
                break;
            }

            case 'join_room': {
                if (ws.roomId) return;
                const room = rooms.get(String(msg.roomId ?? '').trim().toUpperCase());
                if (!room) return send(ws, { type: 'error', message: '部屋が見つかりません。' });
                if (room.started) return send(ws, { type: 'error', message: 'この部屋はもうゲームが始まっています。' });
                if (room.players.size >= MAX_PLAYERS) return send(ws, { type: 'error', message: 'この部屋は満員です。' });
                const you = addPlayer(room, ws, msg.name);
                touch(room);
                log(`部屋 ${room.id}: ${room.players.get(you).name} が入りました（${room.players.size}人）`);
                send(ws, {
                    type: 'room_joined', roomId: room.id, you,
                    players: playerList(room), hostId: room.hostId, maxPlayers: MAX_PLAYERS,
                });
                sendPlayers(room);
                break;
            }

            // ホストだけがゲームを始められる。全員に同じ乱数のタネと順番を配る
            case 'start': {
                const room = rooms.get(ws.roomId);
                if (!room || ws.playerId !== room.hostId || room.started) return;
                if (room.players.size < MIN_PLAYERS) return send(ws, { type: 'error', message: `ゲームを始めるには${MIN_PLAYERS}人以上必要です。` });
                room.started = true;
                touch(room);
                log(`部屋 ${room.id}: ゲーム開始（${room.players.size}人）`);
                const order = playerList(room).map((p) => p.id);
                for (let i = order.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [order[i], order[j]] = [order[j], order[i]];
                }
                const seed = Math.floor(Math.random() * 1000000);
                broadcast(room, { type: 'started', seed, order, players: playerList(room) });
                sendPlayers(room);
                break;
            }

            // ゲーム中のメッセージを、部屋の自分以外の全員に中継する（中身は見ない）
            case 'send': {
                const room = rooms.get(ws.roomId);
                if (!room || !room.started) return;
                broadcast(room, { type: 'message', from: ws.playerId, payload: msg.payload }, ws.playerId);
                room.relayed++;
                touch(room);
                break;
            }

            // ホストだけが、ゲームを終えてロビーに戻せる
            case 'back_to_lobby': {
                const room = rooms.get(ws.roomId);
                if (!room || ws.playerId !== room.hostId || !room.started) return;
                room.started = false;
                touch(room);
                log(`部屋 ${room.id}: ロビーに戻りました`);
                broadcast(room, { type: 'lobby' });
                sendPlayers(room);
                break;
            }

            case 'leave_room':
                handleLeave(ws);
                break;
        }
    });

    ws.on('close', () => handleLeave(ws));
});

// 切れた接続を片付ける
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// 1分ごとの見回り: ① 遊んでいる間の動きを1行だけ出す（1通ごとに出すと多すぎるため）
// ② 長い間動きのない部屋を閉じる
const logInterval = setInterval(() => {
    for (const room of rooms.values()) {
        if (room.relayed > 0) {
            log(`部屋 ${room.id}: メッセージを${room.relayed}通中継（直近1分）`);
            room.relayed = 0;
        }
        if (Date.now() - room.lastActivity > ROOM_IDLE_MS) {
            log(`部屋 ${room.id}: 長い間動きがないので閉じます`);
            for (const p of [...room.players.values()]) {
                send(p.ws, { type: 'error', message: '長い間動きがなかったので、部屋を閉じました。' });
                p.ws.close(); // 閉じると、handleLeave が部屋を片付ける
            }
        }
    }
}, Math.min(60000, ROOM_IDLE_MS));

wss.on('close', () => {
    clearInterval(interval);
    clearInterval(logInterval);
});

server.listen(PORT, () => {
    console.log(`Battle Base Server running on http://localhost:${PORT}`);
});
