/**
 * STELARIS PRO 2.0 — Multiplayer WebSocket Server
 * Run: node server.js
 * Requires: npm install ws
 */
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = 4200;
const MAX_USERS_PER_ROOM = 5;
const COLORS = ['#00e0ff', '#ff0099', '#7c3aed', '#00ff88', '#ffaa00'];

const rooms = new Map();

const wss = new WebSocket.Server({ port: PORT }, () => {
    console.log(`[STELARIS] Multiplayer server running on ws://localhost:${PORT}`);
});

wss.on('connection', (ws) => {
    ws._id = crypto.randomUUID().slice(0, 8);
    ws._room = null;
    ws._name = 'Editor ' + ws._id.slice(0, 4);
    ws._color = '#888';

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        switch (msg.type) {
            case 'create-room': handleCreate(ws, msg); break;
            case 'join-room': handleJoin(ws, msg); break;
            case 'leave-room': handleLeave(ws); break;
            case 'cursor': broadcast(ws, { type: 'cursor', userId: ws._id, name: ws._name, color: ws._color, x: msg.x, time: msg.time }); break;
            case 'lock-clip': broadcast(ws, { type: 'lock-clip', userId: ws._id, clipId: msg.clipId }); break;
            case 'unlock-clip': broadcast(ws, { type: 'unlock-clip', userId: ws._id, clipId: msg.clipId }); break;
            case 'chat': broadcast(ws, { type: 'chat', userId: ws._id, name: ws._name, color: ws._color, text: msg.text, ts: Date.now() }); break;
            case 'state-sync': broadcast(ws, { type: 'state-sync', userId: ws._id, state: msg.state }); break;
        }
    });

    ws.on('close', () => handleLeave(ws));
});

function handleCreate(ws, msg) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const room = { code, host: ws._id, users: new Map() };
    ws._name = msg.name || ws._name;
    ws._color = COLORS[0];
    ws._room = code;
    room.users.set(ws._id, ws);
    rooms.set(code, room);
    ws.send(JSON.stringify({ type: 'room-created', code, userId: ws._id, color: ws._color }));
    console.log(`[Room ${code}] Created by ${ws._name}`);
}

function handleJoin(ws, msg) {
    const room = rooms.get(msg.code);
    if (!room) return ws.send(JSON.stringify({ type: 'error', message: 'Sala no encontrada' }));
    if (room.users.size >= MAX_USERS_PER_ROOM) return ws.send(JSON.stringify({ type: 'error', message: 'Sala llena (máx 5)' }));

    ws._name = msg.name || ws._name;
    ws._color = COLORS[room.users.size % COLORS.length];
    ws._room = msg.code;
    room.users.set(ws._id, ws);

    const userList = [...room.users.values()].map(u => ({ id: u._id, name: u._name, color: u._color }));
    ws.send(JSON.stringify({ type: 'room-joined', code: msg.code, userId: ws._id, color: ws._color, users: userList }));
    broadcast(ws, { type: 'user-joined', userId: ws._id, name: ws._name, color: ws._color, users: userList });
    console.log(`[Room ${msg.code}] ${ws._name} joined (${room.users.size}/${MAX_USERS_PER_ROOM})`);
}

function handleLeave(ws) {
    if (!ws._room) return;
    const room = rooms.get(ws._room);
    if (!room) return;
    room.users.delete(ws._id);
    const userList = [...room.users.values()].map(u => ({ id: u._id, name: u._name, color: u._color }));
    broadcast(ws, { type: 'user-left', userId: ws._id, name: ws._name, users: userList });
    if (room.users.size === 0) { rooms.delete(ws._room); console.log(`[Room ${ws._room}] Deleted (empty)`); }
    ws._room = null;
}

function broadcast(sender, msg) {
    const room = rooms.get(sender._room);
    if (!room) return;
    const data = JSON.stringify(msg);
    room.users.forEach((ws, id) => {
        if (id !== sender._id && ws.readyState === WebSocket.OPEN) ws.send(data);
    });
}
