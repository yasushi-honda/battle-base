// ロビー（部屋を作る／入る／参加者の一覧／ゲーム開始）を担当するファイル。
// ふだんは書き換えなくてよい。ゲームの中身は game.js に書く。
import { createNet } from './net.js';

const params = new URLSearchParams(location.search);
// URL に ?game=bomber が付いていたら bomber.js（ボンバーマン）、なければ game.js（人生ゲーム）
const gameName = params.get('game') === 'bomber' ? 'bomber' : '';
const { startGame } = await import(gameName ? './bomber.js' : './game.js');

const $ = (id) => document.getElementById(id);
const net = createNet();

let me = null;
let hostId = null;
let started = false;
let players = [];
let messageHandlers = [];
let playersHandlers = [];

if (params.get('room')) $('room-code').value = params.get('room').toUpperCase().slice(0, 4);
$('name').value = localStorage.getItem('battle-base-name') ?? '';

function toast(text) {
    $('toast').textContent = text;
}

function myName() {
    const name = $('name').value.trim();
    localStorage.setItem('battle-base-name', name);
    return name;
}

function renderRoom() {
    const list = $('players');
    list.replaceChildren();
    for (const p of players) {
        const li = document.createElement('li');
        li.textContent = p.name + (p.id === me ? '（あなた）' : '');
        if (p.id === hostId) {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = 'ホスト';
            li.append(badge);
        }
        list.append(li);
    }
    // ゲーム中は、参加者の一覧をゲーム画面（game.js）にまかせて隠す
    list.hidden = started;
    const isHost = me === hostId;
    $('start-btn').hidden = started || !isHost;
    $('start-btn').disabled = players.length < 2;
    $('back-btn').hidden = !started || !isHost;
    $('wait-note').textContent = started
        ? ''
        : isHost
            ? (players.length < 2 ? '2人以上そろったら、ゲームを始められます。' : '')
            : 'ホストがゲームを始めるのを待っています。';
}

function showRoom() {
    $('lobby').hidden = true;
    $('room').hidden = false;
}

function showLobby() {
    me = null;
    hostId = null;
    started = false;
    players = [];
    $('room').hidden = true;
    $('game-area').hidden = true;
    $('game-area').replaceChildren();
    $('lobby').hidden = false;
}

net.on('room_joined', (msg) => {
    me = msg.you;
    hostId = msg.hostId;
    players = msg.players;
    started = false;
    $('room-id').textContent = msg.roomId;
    toast('');
    showRoom();
    renderRoom();
});

net.on('players', (msg) => {
    players = msg.players;
    hostId = msg.hostId;
    started = msg.started;
    renderRoom();
    for (const fn of playersHandlers) fn(players);
});

net.on('started', (msg) => {
    started = true;
    players = msg.players;
    messageHandlers = [];
    playersHandlers = [];
    renderRoom();
    startGame({
        area: $('game-area'),
        me,
        players,
        order: msg.order,
        seed: msg.seed,
        send: (payload) => net.send('send', { payload }),
        onMessage: (fn) => messageHandlers.push(fn),
        onPlayers: (fn) => playersHandlers.push(fn),
    });
});

net.on('message', (msg) => {
    for (const fn of messageHandlers) fn({ from: msg.from, payload: msg.payload });
});

net.on('lobby', () => {
    started = false;
    $('game-area').hidden = true;
    $('game-area').replaceChildren();
    messageHandlers = [];
    playersHandlers = [];
    renderRoom();
});

net.on('error', (msg) => toast(msg.message));

net.onClose(() => {
    showLobby();
    toast('サーバーとの接続が切れました。ページを開き直してください。');
});

net.opened.catch(() => toast('サーバーに接続できません。npm start を実行しているか確認してください。'));

$('create-btn').addEventListener('click', () => net.send('create_room', { name: myName() }));
$('join-btn').addEventListener('click', () => {
    net.send('join_room', { roomId: $('room-code').value, name: myName() });
});
$('start-btn').addEventListener('click', () => net.send('start'));
$('back-btn').addEventListener('click', () => net.send('back_to_lobby'));
$('leave-btn').addEventListener('click', () => {
    net.send('leave_room');
    showLobby();
});
$('copy-btn').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?room=${$('room-id').textContent}${gameName ? `&game=${gameName}` : ''}`;
    try {
        await navigator.clipboard.writeText(url);
        toast('招待リンクをコピーしました。チームに送ってください。');
    } catch {
        toast(url);
    }
});
