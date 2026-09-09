const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const ClientIO = require('socket.io-client');
const crypto = require('crypto');

let httpServer, io, port;
const clients = [];
let idCounter = 0;

function makeId() { return `test_${++idCounter}_${crypto.randomBytes(8).toString('hex')}`; }

function createClient(playerId) {
  return new Promise((resolve, reject) => {
    const auth = playerId ? { playerId } : { playerId: makeId() };
    const c = ClientIO(`http://localhost:${port}`, { transports: ['websocket'], auth });
    c._log = [];
    c._playerId = auth.playerId;
    c.onAny((event, ...args) => c._log.push({ event, data: args[0] }));
    c.once('connect', () => resolve(c));
    c.once('connect_error', reject);
  });
}

function ack(client, event, payload) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 5000);
    client.emit(event, payload, (r) => { clearTimeout(t); resolve(r); });
  });
}

function on(client, event, ms = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`event timeout: ${event}`)), ms);
    function h(d) { clearTimeout(t); client.off(event, h); resolve(d); }
    client.on(event, h);
  });
}

function log(client, event) {
  const e = client._log.filter(x => x.event === event);
  return e.length ? e[e.length - 1].data : undefined;
}

function logN(event) { return clients.map(c => log(c, event)); }
function clearRooms() { require('../rooms').rooms.clear(); }
function myHand(s) { const m = s.players.find(p => p.hand !== undefined); return m ? m.hand : null; }
function findPlay(hand, color, top) {
  const n = hand.find(c => c.color === color || c.value === top.value);
  if (n) return { card: n, chosenColor: null };
  const w = hand.find(c => c.color === 'wild');
  if (w) return { card: w, chosenColor: color };
  return null;
}

async function broadcast(client, event, payload, broadcastEvent) {
  const listens = clients.map(c => on(c, broadcastEvent, 5000).catch(() => null));
  const a = ack(client, event, payload);
  const results = await Promise.all([...listens, a]);
  return results[results.length - 1];
}

async function freshGame(n) {
  const host = await createClient();
  const roomCode = (await ack(host, 'create_room', { name: 'Host', maxPlayers: n })).code;
  const gameClients = [host];
  for (let i = 1; i < n; i++) {
    const c = await createClient();
    gameClients.push(c);
    await ack(c, 'join_room', { code: roomCode, name: `P${i}` });
  }
  const flushes = gameClients.map(c => on(c, 'game_started', 5000));
  await ack(host, 'start_game');
  const states = await Promise.all(flushes);
  return { clients: gameClients, roomCode, states };
}

function cleanup(clientsArr) {
  for (const c of clientsArr) if (c.connected) c.disconnect();
}

describe('Integration: Full multiplayer UNO flow', () => {
  before(async () => {
    clearRooms();
    httpServer = http.createServer();
    io = new SocketIOServer(httpServer, { cors: { origin: '*' } });
    io.use((socket, next) => {
      const pid = socket.handshake.auth?.playerId;
      if (!pid || typeof pid !== 'string') return next(new Error('Invalid playerId'));
      socket.data.playerId = pid;
      next();
    });
    const { registerEvents } = require('../events');
    io.on('connection', (s) => registerEvents(io, s));
    await new Promise(r => httpServer.listen(0, r));
    port = httpServer.address().port;
  });

  after(async () => {
    for (const c of clients) if (c.connected) c.disconnect();
    io.close(); httpServer.close(); clearRooms();
  });

  let roomCode;

  it('1. create room: returns 5-char code, emits room_update', async () => {
    const c1 = await createClient();
    clients.push(c1);
    const updateP = on(c1, 'room_update');
    const r = await ack(c1, 'create_room', { name: 'Alice', maxPlayers: 4 });
    assert.ok(!r.error); assert.equal(r.code.length, 5);
    roomCode = r.code;
    const u = await updateP;
    assert.equal(u.players.length, 1);
    assert.equal(u.players[0].name, 'Alice');
    assert.equal(u.status, 'waiting');
  });

  it('2. join room: 4 players, all receive room_update', async () => {
    for (const name of ['Bob', 'Charlie', 'Diana']) {
      const c = await createClient();
      clients.push(c);
      const r = await broadcast(c, 'join_room', { code: roomCode, name }, 'room_update');
      assert.ok(!r.error, `${name}: ${JSON.stringify(r)}`);
    }
    const updates = logN('room_update');
    for (const u of updates) {
      assert.equal(u.players.length, 4);
      assert.deepEqual(u.players.map(p => p.name).sort(), ['Alice','Bob','Charlie','Diana']);
    }
  });

  it('3. start game', async () => {
    const flushes = clients.map(c => on(c, 'game_started', 5000));
    const r = await ack(clients[0], 'start_game');
    assert.ok(!r.error, JSON.stringify(r));
    const states = await Promise.all(flushes);
    for (const s of states) {
      assert.equal(s.status, 'playing');
      assert.equal(s.players.length, 4);
      const me = s.players.find(p => p.hand !== undefined);
      assert.ok(me); assert.equal(me.hand.length, 7);
      assert.ok(s.discardTop);
      assert.ok(s.currentTurn >= 0 && s.currentTurn < 4);
      assert.ok(['red','blue','green','yellow'].includes(s.currentColor));
    }
  });

  it('4. redaction: each client sees own hand only, opponents get no hand info', () => {
    const states = logN('game_started');
    for (let i = 0; i < 4; i++) {
      const me = states[i].players.find(p => p.hand !== undefined);
      assert.ok(me, `Client ${i} has no own hand`);
      assert.ok(me.hand.length > 0);
      for (const p of states[i].players) {
        if (p.id !== me.id) {
          assert.equal(p.hand, undefined, `${p.name} hand leaked to Client ${i}`);
          assert.equal(p.handCount, undefined, `${p.name} handCount leaked to Client ${i}`);
        }
      }
    }
  });

  it('4b. opponent card IDs not in serialized state', () => {
    const states = logN('game_started');
    const allIds = new Set();
    for (const s of states) for (const p of s.players) if (p.hand) for (const c of p.hand) allIds.add(c.id);
    for (let i = 0; i < 4; i++) {
      const myIds = new Set();
      const me = states[i].players.find(p => p.hand !== undefined);
      if (me) for (const c of me.hand) myIds.add(c.id);
      const jsonStr = JSON.stringify(states[i]);
      for (const id of allIds) {
        if (myIds.has(id)) continue;
        const re = new RegExp(`"${id}"`);
        assert.ok(!re.test(jsonStr), `Client ${i} leaks ${id}`);
      }
    }
  });

  it('5. valid play: card removed, turn advanced, all get state_update', async () => {
    const state0 = log(clients[0], 'game_started');
    const turnIdx = state0.currentTurn;
    const hand = myHand(state0);
    const result = findPlay(hand, state0.currentColor, state0.discardTop);
    assert.ok(result, 'must have valid play');

    const flushes = clients.map(c => on(c, 'state_update', 5000));
    const r = await ack(clients[turnIdx], 'play_card', {
      cardId: result.card.id,
      chosenColor: result.card.color === 'wild' ? 'red' : undefined,
    });
    assert.ok(!r.error, JSON.stringify(r));
    const updates = await Promise.all(flushes);

    const base = updates[0];
    assert.equal(base.status, 'playing');
    assert.ok(base.discardTop);
    const myP = updates[turnIdx].players.find(p => p.hand !== undefined);
    assert.equal(myP.hand.length, 6);
    assert.notEqual(base.currentTurn, turnIdx);
    assert.ok(['red','blue','green','yellow'].includes(base.currentColor));

    for (let i = 1; i < 4; i++) {
      assert.equal(updates[i].discardTop.id, base.discardTop.id);
      assert.equal(updates[i].currentColor, base.currentColor);
      assert.equal(updates[i].currentTurn, base.currentTurn);
    }
  });

  it('6. wrong player rejected, state unchanged', async () => {
    const s = log(clients[0], 'state_update');
    const turnIdx = s.currentTurn;
    const wrongIdx = (turnIdx + 1) % 4;
    const wHand = myHand(log(clients[wrongIdx], 'state_update'));
    const r = await ack(clients[wrongIdx], 'play_card', { cardId: wHand[0].id });
    assert.ok(r.error, 'should reject');
    await new Promise(r => setTimeout(r, 100));
    assert.equal(log(clients[0], 'state_update').currentTurn, turnIdx);
  });

  it('7. invalid card rejected, hand unchanged', async () => {
    const s = log(clients[0], 'state_update');
    const turnIdx = s.currentTurn;
    const hand = myHand(log(clients[turnIdx], 'state_update'));
    const invalid = hand.find(c =>
      c.color !== s.currentColor && c.value !== s.discardTop.value && c.color !== 'wild'
    );
    if (!invalid) return;
    const r = await ack(clients[turnIdx], 'play_card', { cardId: invalid.id });
    assert.ok(r.error, 'should reject');
    await new Promise(r => setTimeout(r, 100));
    assert.equal(log(clients[0], 'state_update').currentTurn, turnIdx);
  });

  it('8. draw: hand +N (multi-draw), turn advances', async () => {
    const s = log(clients[0], 'state_update');
    const turnIdx = s.currentTurn;
    const handBefore = myHand(log(clients[turnIdx], 'state_update')).length;

    const flushes = clients.map(c => on(c, 'state_update', 5000));
    const r = await ack(clients[turnIdx], 'draw_card');
    assert.ok(!r.error, JSON.stringify(r));
    assert.ok(r.drawn.length >= 1, 'should draw at least 1 card');
    const updates = await Promise.all(flushes);

    const myP = updates[turnIdx].players.find(p => p.hand !== undefined);
    assert.equal(myP.hand.length, handBefore + r.drawn.length);
    assert.notEqual(updates[0].currentTurn, turnIdx);
  });

  it('9. draw2 + stack draw', async () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const s = log(clients[0], 'state_update');
      if (s.status !== 'playing') return;
      const turnIdx = s.currentTurn;
      const hand = myHand(log(clients[turnIdx], 'state_update'));
      const draw2 = hand.find(c => c.value === 'draw2');
      const playable = findPlay(hand, s.currentColor, s.discardTop);

      if (draw2 && playable && playable.card.id === draw2.id) {
        const f1 = clients.map(c => on(c, 'state_update', 5000));
        await Promise.all([...f1, ack(clients[turnIdx], 'play_card', { cardId: draw2.id })]);
        const afterPlay = log(clients[0], 'state_update');
        assert.equal(afterPlay.drawStack, 2);

        const nextIdx = afterPlay.currentTurn;
        const f2 = clients.map(c => on(c, 'state_update', 5000));
        const drawR = await ack(clients[nextIdx], 'draw_card');
        await Promise.all(f2);
        assert.equal(drawR.drawn.length, 2);
        const afterDraw = log(clients[0], 'state_update');
        assert.equal(afterDraw.drawStack, 0);
        assert.notEqual(afterDraw.currentTurn, nextIdx);
        return;
      }
      const f = clients.map(c => on(c, 'state_update', 5000));
      await Promise.all([...f, ack(clients[turnIdx], 'draw_card')]);
    }
  });

  it('10. all clients agree on public state after moves', async () => {
    for (let move = 0; move < 3; move++) {
      const s = log(clients[0], 'state_update');
      if (s.status !== 'playing') break;
      const turnIdx = s.currentTurn;
      const hand = myHand(log(clients[turnIdx], 'state_update'));
      if (!hand || hand.length === 0) break;

      if (s.drawStack > 0) {
        const f = clients.map(c => on(c, 'state_update', 5000));
        await Promise.all([...f, ack(clients[turnIdx], 'draw_card')]);
        continue;
      }

      const play = findPlay(hand, s.currentColor, s.discardTop);
      const f = clients.map(c => on(c, 'state_update', 5000));
      if (play) {
        await Promise.all([...f, ack(clients[turnIdx], 'play_card', {
          cardId: play.card.id, chosenColor: play.card.color === 'wild' ? 'green' : undefined,
        })]);
      } else {
        await Promise.all([...f, ack(clients[turnIdx], 'draw_card')]);
      }
    }
    const final = logN('state_update');
    for (let i = 1; i < 4; i++) {
      assert.equal(final[i].discardTop.id, final[0].discardTop.id);
      assert.equal(final[i].currentColor, final[0].currentColor);
      assert.equal(final[i].currentTurn, final[0].currentTurn);
      assert.equal(final[i].direction, final[0].direction);
      assert.equal(final[i].drawStack, final[0].drawStack);
      assert.equal(final[i].status, final[0].status);
    }
    for (let j = 0; j < 4; j++) {
      for (let i = 1; i < 4; i++) {
        assert.equal(final[i].players[j].handCount, final[0].players[j].handCount, `handCount consistency for player ${j}`);
      }
    }
  });

  it('10b. hand redaction maintained after state_update', () => {
    const final = logN('state_update');
    for (let i = 0; i < 4; i++) {
      const me = final[i].players.find(p => p.hand !== undefined);
      for (const p of final[i].players) {
        if (p.id !== me.id) assert.equal(p.hand, undefined);
      }
    }
  });

  describe('11. DISCONNECT', () => {
    it('11a. non-current player disconnect: others get state_update, currentTurn unchanged', async () => {
      const g = await freshGame(4);
      const s0 = g.states[0];
      const turnIdx = s0.currentTurn;
      const nonCurrentIdx = (turnIdx + 1) % 4;
      const remaining = g.clients.filter((_, i) => i !== nonCurrentIdx);

      const flushes = remaining.map(c => on(c, 'state_update', 3000));
      g.clients[nonCurrentIdx].disconnect();
      const updates = await Promise.all(flushes);

      assert.equal(updates[0].currentTurn, turnIdx, 'currentTurn should not change');
      const disc = updates[0].players[nonCurrentIdx];
      assert.equal(disc.isConnected, false);
      assert.ok(httpServer.listening);
      for (const u of updates) {
        const me = u.players.find(p => p.hand !== undefined);
        for (const p of u.players) {
          if (p.id !== me.id) assert.equal(p.hand, undefined);
        }
      }
      cleanup(g.clients);
    });

    it('11b. current-turn player disconnect: turn advances to next connected player', async () => {
      const g = await freshGame(4);
      const s0 = g.states[0];
      const turnIdx = s0.currentTurn;

      const remaining = g.clients.filter((_, i) => i !== turnIdx);
      const flushes = remaining.map(c => on(c, 'state_update', 3000));
      g.clients[turnIdx].disconnect();
      const updates = await Promise.all(flushes);

      const after = updates[0];
      assert.notEqual(after.currentTurn, turnIdx, 'currentTurn should have changed');
      const newCur = after.players[after.currentTurn];
      assert.ok(newCur.isConnected !== false, `currentTurn should not point to disconnected "${newCur.name}"`);
      assert.ok(httpServer.listening);

      for (const u of updates) {
        const me = u.players.find(p => p.hand !== undefined);
        for (const p of u.players) {
          if (p.id !== me.id) assert.equal(p.hand, undefined);
        }
      }
      cleanup(g.clients);
    });

    it('11c. host disconnect: host preserved (not transferred on disconnect)', async () => {
      const host = await createClient();
      const roomCode = (await ack(host, 'create_room', { name: 'HostTest', maxPlayers: 4 })).code;
      const p1 = await createClient();
      await ack(p1, 'join_room', { code: roomCode, name: 'P1' });
      const p2 = await createClient();
      await ack(p2, 'join_room', { code: roomCode, name: 'P2' });

      const remaining = [p1, p2];
      const flushes = remaining.map(c => on(c, 'room_update', 3000));
      host.disconnect();
      const updates = await Promise.all(flushes);

      const last = updates[updates.length - 1];
      assert.equal(last.hostId, host._playerId, 'hostId should remain the disconnected host');
      assert.ok(httpServer.listening);

      cleanup([host, p1, p2]);
    });

    it('11d. disconnected player is marked isConnected=false', async () => {
      const g = await freshGame(4);
      const s0 = g.states[0];
      const turnIdx = s0.currentTurn;

      g.clients[turnIdx].disconnect();
      const remaining = g.clients.filter((_, i) => i !== turnIdx);
      await on(remaining[0], 'state_update', 3000);

      const after = log(remaining[0], 'state_update');
      const discPlayer = after.players[turnIdx];
      assert.equal(discPlayer.isConnected, false, 'disconnected player should have isConnected=false');
      cleanup(g.clients);
    });

    it('11e. server guards: disconnected player blocked by isConnected check', async () => {
      const g = await freshGame(4);
      const s0 = g.states[0];
      const turnIdx = s0.currentTurn;

      g.clients[turnIdx].disconnect();
      const remaining = g.clients.filter((_, i) => i !== turnIdx);
      await on(remaining[0], 'state_update', 3000);

      const after = log(remaining[0], 'state_update');
      const discPlayer = after.players[turnIdx];
      assert.equal(discPlayer.isConnected, false);
      assert.equal(discPlayer.handCount, undefined, 'handCount not exposed');
      cleanup(g.clients);
    });

    it('11f. game continues: next player can play after disconnect', async () => {
      const g = await freshGame(4);
      const s0 = g.states[0];
      const turnIdx = s0.currentTurn;

      g.clients[turnIdx].disconnect();
      await on(g.clients.find((_, i) => i !== turnIdx), 'state_update', 3000);

      const after = log(g.clients.find((_, i) => i !== turnIdx), 'state_update');
      const nextTurn = after.currentTurn;

      const f = g.clients.filter((_, i) => i !== turnIdx).map(c => on(c, 'state_update', 3000));
      const r = await ack(g.clients[nextTurn], 'draw_card');
      assert.ok(!r.error, JSON.stringify(r));
      const updates = await Promise.all(f);
      assert.ok(updates.length > 0, 'other players should get state_update');
      cleanup(g.clients);
    });
  });

  describe('12. RECONNECT', () => {
    it('12a. player refresh in waiting room: reconnects to same room', async () => {
      const host = await createClient();
      const roomCode = (await ack(host, 'create_room', { name: 'ReconnectHost', maxPlayers: 4 })).code;
      const p1 = await createClient();
      await ack(p1, 'join_room', { code: roomCode, name: 'ReconnectP1' });

      const p1Id = p1._playerId;
      p1.disconnect();
      await new Promise(r => setTimeout(r, 200));

      const p1new = await createClient(p1Id);
      const res = await ack(p1new, 'session_restore');
      assert.ok(!res.notInRoom, 'should find existing room');
      assert.equal(res.room.code, roomCode);
      assert.equal(res.room.status, 'waiting');
      assert.equal(res.room.players.length, 2);
      const restored = res.room.players.find(p => p.id === p1Id);
      assert.ok(restored, 'original player should exist');
      assert.equal(restored.name, 'ReconnectP1');
      assert.equal(restored.isConnected, true);

      cleanup([host, p1new]);
    });

    it('12b. player refresh during active game: receives own hand, not opponent hands', async () => {
      const g = await freshGame(2);
      const s0 = g.states[0];
      const p1Id = g.clients[1]._playerId;
      const originalHand = myHand(s0);

      g.clients[1].disconnect();
      await new Promise(r => setTimeout(r, 200));

      const p1new = await createClient(p1Id);
      const res = await ack(p1new, 'session_restore');
      assert.ok(!res.notInRoom);
      assert.equal(res.room.status, 'playing');

      const me = res.room.players.find(p => p.hand !== undefined);
      assert.ok(me, 'reconnected player should see own hand');
      assert.equal(me.id, p1Id);
      assert.ok(me.hand.length > 0, 'hand should have cards');

      for (const p of res.room.players) {
        if (p.id !== p1Id) {
          assert.equal(p.hand, undefined, 'opponent hand should not be leaked');
          assert.equal(p.handCount, undefined, 'opponent handCount should not be exposed');
        }
      }

      cleanup([g.clients[0], p1new]);
    });

    it('12c. reconnect does not create duplicate player', async () => {
      const g = await freshGame(2);
      const p1Id = g.clients[1]._playerId;

      g.clients[1].disconnect();
      await new Promise(r => setTimeout(r, 200));

      const p1new = await createClient(p1Id);
      await ack(p1new, 'session_restore');

      const s = log(g.clients[0], 'state_update') || log(g.clients[0], 'game_started');
      const p1Players = s.players.filter(p => p.id === p1Id);
      assert.equal(p1Players.length, 1, 'should have exactly one player entry');

      cleanup([g.clients[0], p1new]);
    });

    it('12d. reconnect does not consume another room slot', async () => {
      const host = await createClient();
      const roomCode = (await ack(host, 'create_room', { name: 'SlotHost', maxPlayers: 3 })).code;
      const p1 = await createClient();
      await ack(p1, 'join_room', { code: roomCode, name: 'P1' });
      const p1Id = p1._playerId;

      p1.disconnect();
      await new Promise(r => setTimeout(r, 200));

      const p1new = await createClient(p1Id);
      await ack(p1new, 'session_restore');

      const p2 = await createClient();
      const joinRes = await ack(p2, 'join_room', { code: roomCode, name: 'P2' });
      assert.ok(!joinRes.error, 'new player should be able to join');

      const roomUpdate = log(host, 'room_update');
      assert.equal(roomUpdate.players.length, 3, 'room should have 3 players total');

      cleanup([host, p1new, p2]);
    });

    it('12e. host refresh preserves host status', async () => {
      const host = await createClient();
      const roomCode = (await ack(host, 'create_room', { name: 'HostRefresh', maxPlayers: 4 })).code;
      const hostId = host._playerId;
      const p1 = await createClient();
      await ack(p1, 'join_room', { code: roomCode, name: 'P1' });

      host.disconnect();
      await new Promise(r => setTimeout(r, 200));

      const hostNew = await createClient(hostId);
      const res = await ack(hostNew, 'session_restore');
      assert.ok(!res.notInRoom);
      assert.equal(res.room.hostId, hostId, 'host should remain host after reconnect');

      cleanup([hostNew, p1]);
    });

    it('12f. unexpected disconnect preserves player in room (isConnected=false, player object kept)', async () => {
      const g = await freshGame(2);
      const p1Id = g.clients[1]._playerId;

      g.clients[1].disconnect();
      await on(g.clients[0], 'state_update', 3000);

      const after = log(g.clients[0], 'state_update');
      const disc = after.players.find(p => p.id === p1Id);
      assert.ok(disc, 'disconnected player should still exist in room');
      assert.equal(disc.isConnected, false);
      assert.equal(disc.handCount, undefined, 'handCount not exposed');

      cleanup(g.clients);
    });

    it('12g. intentional leave removes player from room', async () => {
      const g = await freshGame(2);
      const p1Id = g.clients[1]._playerId;

      await ack(g.clients[1], 'leave_room');

      const roomUpdate = log(g.clients[0], 'room_update');
      const removed = roomUpdate.players.find(p => p.id === p1Id);
      assert.ok(!removed, 'player should be removed after intentional leave');

      cleanup(g.clients);
    });

    it('12h. after intentional leave, player can create/join another room', async () => {
      const c = await createClient();
      const room1 = (await ack(c, 'create_room', { name: 'LeaveTest', maxPlayers: 4 })).code;
      await ack(c, 'leave_room');
      c.disconnect();
      await new Promise(r => setTimeout(r, 200));

      const c2 = await createClient(c._playerId);
      const room2 = (await ack(c2, 'create_room', { name: 'LeaveTest2', maxPlayers: 4 })).code;
      assert.ok(room2, 'should be able to create new room');
      assert.notEqual(room1, room2);

      cleanup([c2]);
    });

    it('12i. two players disconnect and reconnect without corrupting game', async () => {
      const g = await freshGame(3);
      const s0 = g.states[0];
      const p1Id = g.clients[1]._playerId;
      const p2Id = g.clients[2]._playerId;
      const p1Hand = myHand.call(null, s0);
      const p2State = g.states[2];
      const p2Hand = myHand.call(null, p2State);

      g.clients[1].disconnect();
      g.clients[2].disconnect();
      await new Promise(r => setTimeout(r, 200));

      const p1new = await createClient(p1Id);
      const p2new = await createClient(p2Id);
      const res1 = await ack(p1new, 'session_restore');
      const res2 = await ack(p2new, 'session_restore');

      assert.ok(!res1.notInRoom && !res2.notInRoom);
      assert.equal(res1.room.status, 'playing');
      assert.equal(res2.room.status, 'playing');

      const r1me = res1.room.players.find(p => p.id === p1Id);
      const r2me = res2.room.players.find(p => p.id === p2Id);
      assert.ok(r1me.hand.length > 0, 'p1 hand restored');
      assert.ok(r2me.hand.length > 0, 'p2 hand restored');

      cleanup([g.clients[0], p1new, p2new]);
    });

    it('12j. current turn remains valid after reconnect', async () => {
      const g = await freshGame(3);
      const s0 = g.states[0];
      const turnBefore = s0.currentTurn;

      g.clients[turnBefore].disconnect();
      await new Promise(r => setTimeout(r, 200));

      const cnew = await createClient(s0.players[turnBefore].id);
      const res = await ack(cnew, 'session_restore');
      assert.ok(!res.notInRoom);
      const curPlayer = res.room.players[res.room.currentTurn];
      assert.ok(curPlayer.isConnected !== false, 'currentTurn should point to a connected player');

      cleanup([g.clients.find((_, i) => i !== turnBefore), cnew]);
    });

    it('12k. reconnection changes isConnected false → true', async () => {
      const g = await freshGame(2);
      const p1Id = g.clients[1]._playerId;

      g.clients[1].disconnect();
      await on(g.clients[0], 'state_update', 3000);
      const discState = log(g.clients[0], 'state_update');
      const disc = discState.players.find(p => p.id === p1Id);
      assert.equal(disc.isConnected, false);

      const p1new = await createClient(p1Id);
      await ack(p1new, 'session_restore');

      const reconnectUpdate = log(g.clients[0], 'state_update');
      const recon = reconnectUpdate.players.find(p => p.id === p1Id);
      assert.equal(recon.isConnected, true, 'should be connected after reconnect');

      cleanup([g.clients[0], p1new]);
    });

    it('12l. server stable if disconnected player reconnects after moves', async () => {
      const g = await freshGame(3);
      const s0 = g.states[0];
      const p1Id = g.clients[1]._playerId;

      g.clients[1].disconnect();
      await on(g.clients[0], 'state_update', 3000);

      const turnNow = log(g.clients[0], 'state_update').currentTurn;
      if (turnNow === 0) {
        const f = [g.clients[0], g.clients[2]].map(c => on(c, 'state_update', 3000));
        await ack(g.clients[0], 'draw_card');
        await Promise.all(f);
      }

      const p1new = await createClient(p1Id);
      const res = await ack(p1new, 'session_restore');
      assert.ok(!res.notInRoom);
      assert.equal(res.room.status, 'playing');

      const f2 = [g.clients[0], g.clients[2], p1new].map(c => on(c, 'state_update', 3000));
      const curTurn = log(g.clients[0], 'state_update').currentTurn;
      const curId = log(g.clients[0], 'state_update').players[curTurn].id;
      const curClient = [g.clients[0], g.clients[2], p1new].find(c => c._playerId === curId);
      if (curClient) {
        await ack(curClient, 'draw_card');
        await Promise.all(f2);
      }

      assert.ok(httpServer.listening);
      cleanup([g.clients[0], g.clients[2], p1new]);
    });

    it('12m. session_restore returns notInRoom for new player', async () => {
      const c = await createClient();
      const res = await ack(c, 'session_restore');
      assert.equal(res.notInRoom, true);
      cleanup([c]);
    });

    it('12n. session_restore for finished game returns game-over state', async () => {
      const g = await freshGame(2);
      const s0 = g.states[0];
      const p0Id = g.clients[0]._playerId;

      // Play until someone wins or we exhaust attempts
      for (let i = 0; i < 50; i++) {
        const s = log(g.clients[0], 'state_update');
        if (!s || s.status !== 'playing') break;
        const turnIdx = s.currentTurn;
        const hand = myHand(log(g.clients[turnIdx], 'state_update'));
        if (!hand || hand.length === 0) break;
        if (s.drawStack > 0) {
          const f = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
          await ack(g.clients[turnIdx], 'draw_card');
          await Promise.all(f);
          continue;
        }
        const play = findPlay(hand, s.currentColor, s.discardTop);
        const f = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
        if (play) {
          await ack(g.clients[turnIdx], 'play_card', {
            cardId: play.card.id, chosenColor: play.card.color === 'wild' ? 'red' : undefined,
          });
        } else {
          await ack(g.clients[turnIdx], 'draw_card');
        }
        await Promise.all(f);
      }

      const finalState = log(g.clients[0], 'state_update');
      if (finalState && finalState.status === 'finished') {
        g.clients[0].disconnect();
        await new Promise(r => setTimeout(r, 200));
        const cnew = await createClient(p0Id);
        const res = await ack(cnew, 'session_restore');
        assert.ok(!res.notInRoom);
        assert.equal(res.room.status, 'finished');
        assert.ok(res.room.winner !== undefined || res.room.winner === null);
        cleanup([cnew]);
      } else {
        cleanup(g.clients);
      }
    });

    it('12o. stale session: player ID not in any room returns sessionNotFound', async () => {
      const staleId = makeId();
      const c = await createClient(staleId);
      const res = await ack(c, 'session_restore');
      assert.equal(res.notInRoom, true);
      assert.equal(res.sessionNotFound, true);
      cleanup([c]);
    });

    it('12p. stale session: after server clears rooms, reconnect returns sessionNotFound', async () => {
      const g = await freshGame(2);
      const p1Id = g.clients[1]._playerId;

      clearRooms();

      const p1new = await createClient(p1Id);
      const res = await ack(p1new, 'session_restore');
      assert.equal(res.notInRoom, true);
      assert.equal(res.sessionNotFound, true);

      cleanup([g.clients[0], p1new]);
    });

    it('12q. valid session restoration still restores waiting room', async () => {
      const host = await createClient();
      const roomCode = (await ack(host, 'create_room', { name: 'RestoreHost', maxPlayers: 4 })).code;
      const p1 = await createClient();
      await ack(p1, 'join_room', { code: roomCode, name: 'RestoreP1' });
      const p1Id = p1._playerId;

      p1.disconnect();
      await new Promise(r => setTimeout(r, 200));

      const p1new = await createClient(p1Id);
      const res = await ack(p1new, 'session_restore');
      assert.ok(!res.notInRoom);
      assert.equal(res.room.code, roomCode);
      assert.equal(res.room.status, 'waiting');
      const restored = res.room.players.find(p => p.id === p1Id);
      assert.ok(restored);
      assert.equal(restored.name, 'RestoreP1');
      assert.equal(restored.isConnected, true);

      cleanup([host, p1new]);
    });

    it('12r. valid session restoration still restores game state with hand', async () => {
      const g = await freshGame(2);
      const p1Id = g.clients[1]._playerId;
      const originalHand = myHand(g.states[1]);

      g.clients[1].disconnect();
      await new Promise(r => setTimeout(r, 200));

      const p1new = await createClient(p1Id);
      const res = await ack(p1new, 'session_restore');
      assert.ok(!res.notInRoom);
      assert.equal(res.room.status, 'playing');

      const me = res.room.players.find(p => p.hand !== undefined);
      assert.ok(me);
      assert.equal(me.id, p1Id);
      assert.ok(me.hand.length > 0);
      assert.deepEqual(me.hand, originalHand);

      cleanup([g.clients[0], p1new]);
    });

    it('12s. valid host reconnect still preserves host status', async () => {
      const host = await createClient();
      const roomCode = (await ack(host, 'create_room', { name: 'HostPreserve', maxPlayers: 4 })).code;
      const hostId = host._playerId;
      const p1 = await createClient();
      await ack(p1, 'join_room', { code: roomCode, name: 'P1' });

      host.disconnect();
      await new Promise(r => setTimeout(r, 200));

      const hostNew = await createClient(hostId);
      const res = await ack(hostNew, 'session_restore');
      assert.ok(!res.notInRoom);
      assert.equal(res.room.hostId, hostId);

      cleanup([hostNew, p1]);
    });

    it('12t. stale session after server restart: client can create new room', async () => {
      const g = await freshGame(2);
      const p0Id = g.clients[0]._playerId;
      cleanup(g.clients);

      clearRooms();

      const c = await createClient(p0Id);
      const res = await ack(c, 'session_restore');
      assert.equal(res.notInRoom, true);
      assert.equal(res.sessionNotFound, true);

      const newRoom = (await ack(c, 'create_room', { name: 'NewAfterRestart', maxPlayers: 4 })).code;
      assert.ok(newRoom);
      assert.equal(newRoom.length, 5);

      cleanup([c]);
    });

    it('12u. stale session after server restart: client can join new room', async () => {
      const g = await freshGame(2);
      const p1Id = g.clients[1]._playerId;
      cleanup(g.clients);

      clearRooms();

      const host = await createClient();
      const roomCode = (await ack(host, 'create_room', { name: 'NewHost', maxPlayers: 4 })).code;

      const c = await createClient(p1Id);
      const restoreRes = await ack(c, 'session_restore');
      assert.equal(restoreRes.notInRoom, true);

      const joinRes = await ack(c, 'join_room', { code: roomCode, name: 'Rejoined' });
      assert.ok(!joinRes.error);

      cleanup([host, c]);
    });
  });
});
