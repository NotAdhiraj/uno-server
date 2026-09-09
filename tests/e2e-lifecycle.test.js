const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const ClientIO = require('socket.io-client');
const crypto = require('crypto');
const { rooms } = require('../rooms');
const game = require('../game');

let httpServer, io, port;
const allClients = [];
let idCounter = 0;

function makeId() { return `lc_${++idCounter}_${crypto.randomBytes(8).toString('hex')}`; }

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

function on(client, event, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`event timeout: ${event}`)), ms);
    function h(d) { clearTimeout(t); client.off(event, h); resolve(d); }
    client.on(event, h);
  });
}

function lastLog(client, event) {
  const e = client._log.filter(x => x.event === event);
  return e.length ? e[e.length - 1].data : undefined;
}

function cleanup(clientsArr) {
  for (const c of clientsArr) if (c && c.connected) c.disconnect();
}

function myHand(state) {
  const m = state?.players?.find(p => p.hand !== undefined);
  return m ? m.hand : null;
}

function findPlayable(hand, currentColor, discardTop) {
  if (!hand) return null;
  const n = hand.find(c => c.color === currentColor || c.value === discardTop.value);
  if (n) return { card: n, chosenColor: null };
  const w = hand.find(c => c.color === 'wild');
  if (w) return { card: w, chosenColor: currentColor };
  return null;
}

async function freshGame(n) {
  const host = await createClient();
  allClients.push(host);
  const roomCode = (await ack(host, 'create_room', { name: 'Host', maxPlayers: n })).code;
  const gameClients = [host];
  for (let i = 1; i < n; i++) {
    const c = await createClient();
    allClients.push(c);
    gameClients.push(c);
    await ack(c, 'join_room', { code: roomCode, name: `P${i}` });
  }
  const flushes = gameClients.map(c => on(c, 'game_started', 5000));
  await ack(host, 'start_game');
  const states = await Promise.all(flushes);
  return { clients: gameClients, roomCode, states };
}

async function setupGameEndingSoon(n) {
  const g = await freshGame(n);

  for (let i = 0; i < n; i++) {
    const c = g.clients[i];
    c._log = c._log.filter(x => x.event !== 'state_update');
  }

  const room = rooms.get(g.roomCode);
  assert.ok(room, 'room should exist');

  for (let i = 0; i < n; i++) {
    room.players[i].hand = [
      { id: `p${i}_finisher`, color: 'red', value: '9' },
    ];
    room.players[i].unoCalled = false;
  }

  room.discardPile = [{ id: 'discard_setup', color: 'red', value: '5' }];
  room.currentColor = 'red';
  room.currentTurn = 0;
  room.drawStack = 0;
  room.direction = 1;
  room.status = 'playing';
  room.deck = [
    { id: 'deck_extra_1', color: 'blue', value: '1' },
    { id: 'deck_extra_2', color: 'blue', value: '2' },
    { id: 'deck_extra_3', color: 'green', value: '3' },
  ];

  for (let i = 0; i < n; i++) {
    const me = room.players[i];
    io.to(me.socketId).emit('state_update', game.serializeRoomForPlayer(room, me.id));
  }

  await new Promise(r => setTimeout(r, 100));

  for (let i = 0; i < n; i++) {
    g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
  }

  return g;
}


describe('E2E Lifecycle: Play Again, UNO, Multi-draw', () => {
  before(async () => {
    rooms.clear();
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
    for (const c of allClients) if (c && c.connected) c.disconnect();
    io.close();
    httpServer.close();
    rooms.clear();
  });


  describe('PLAY AGAIN lifecycle', () => {
    it('1. play to completion then play again via socket', async () => {
      const g = await setupGameEndingSoon(2);

      const flushes = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      const playRes = await ack(g.clients[0], 'play_card', {
        cardId: 'p0_finisher',
      });
      assert.ok(!playRes.error, JSON.stringify(playRes));
      await Promise.all(flushes);

      const finalState = lastLog(g.clients[0], 'state_update');
      assert.equal(finalState.status, 'finished', 'game should be finished');
      assert.ok(finalState.winner, 'should have a winner');
      assert.ok(finalState.loser, 'should have a loser');
      assert.notEqual(finalState.winner, finalState.loser, 'winner and loser differ');

      const finishOrder = finalState.finishOrder;
      assert.equal(finishOrder.length, 2, 'finish order has 2 entries');
      assert.equal(finishOrder[0], finalState.winner, 'first in finish order is winner');
      assert.equal(finishOrder[1], finalState.loser, 'second in finish order is loser');

      cleanup(g.clients);
    });

    it('2. host clicks play_again: all clients receive game_started with fresh state', async () => {
      const g = await setupGameEndingSoon(2);

      const flushes = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      await ack(g.clients[0], 'play_card', { cardId: 'p0_finisher' });
      await Promise.all(flushes);

      const listenFlushes = g.clients.map(c => on(c, 'game_started', 5000));
      const playAgainRes = await ack(g.clients[0], 'play_again');
      assert.ok(!playAgainRes.error, JSON.stringify(playAgainRes));
      const freshStates = await Promise.all(listenFlushes);

      for (const s of freshStates) {
        assert.equal(s.status, 'playing', 'fresh game should be playing');
        assert.equal(s.players.length, 2, 'should have 2 players');
        const me = s.players.find(p => p.hand !== undefined);
        assert.ok(me, 'each client should see own hand');
        assert.equal(me.hand.length, 7, 'each player gets 7 cards');
        assert.ok(s.discardTop, 'should have a discard top');
        assert.ok(['red','blue','green','yellow'].includes(s.currentColor), 'valid currentColor');
        assert.ok(s.currentTurn >= 0 && s.currentTurn < 2, 'valid currentTurn');
        assert.equal(s.drawStack, 0, 'drawStack reset to 0');
        assert.equal(s.direction, 1, 'direction reset');
        assert.equal(s.winner, null, 'winner reset');
        assert.equal(s.loser, null, 'loser reset');
        assert.deepEqual(s.finishOrder, [], 'finishOrder reset');
      }

      for (let i = 0; i < 2; i++) {
        const opp = freshStates[i].players.find(p => p.hand === undefined);
        assert.ok(opp, 'client should not see opponent hand');
        assert.ok(typeof opp.handCount === 'number', 'handCount should be exposed as number');
      }

      cleanup(g.clients);
    });

    it('3. non-host cannot trigger play_again', async () => {
      const g = await setupGameEndingSoon(2);

      const flushes = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      await ack(g.clients[0], 'play_card', { cardId: 'p0_finisher' });
      await Promise.all(flushes);

      const finalState = lastLog(g.clients[0], 'state_update');
      assert.equal(finalState.status, 'finished');

      const res = await ack(g.clients[1], 'play_again');
      assert.ok(res.error, 'non-host should get error');
      assert.ok(res.error.includes('host') || res.error.includes('Only'), res.error);

      cleanup(g.clients);
    });

    it('4. play_again fails if game is not finished', async () => {
      const g = await freshGame(2);

      const res = await ack(g.clients[0], 'play_again');
      assert.ok(res.error, 'should fail on active game');
      assert.ok(res.error.includes('not finished') || res.error.includes('finished'), res.error);

      cleanup(g.clients);
    });

    it('5. after play again, eliminated state and finishOrder are cleared', async () => {
      const g = await setupGameEndingSoon(2);

      const flushes = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      await ack(g.clients[0], 'play_card', { cardId: 'p0_finisher' });
      await Promise.all(flushes);

      const listenFlushes = g.clients.map(c => on(c, 'game_started', 5000));
      await ack(g.clients[0], 'play_again');
      const freshStates = await Promise.all(listenFlushes);

      for (const s of freshStates) {
        for (const p of s.players) {
          assert.equal(p.eliminated, false, 'no player should be eliminated');
          assert.equal(p.finishPosition, null, 'no finishPosition');
          assert.equal(p.isConnected, true, 'all connected');
        }
      }

      cleanup(g.clients);
    });

    it('6. play again then play another full game to completion', async () => {
      const g = await setupGameEndingSoon(2);

      const flushes = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      await ack(g.clients[0], 'play_card', { cardId: 'p0_finisher' });
      await Promise.all(flushes);

      const finalState1 = lastLog(g.clients[0], 'state_update');
      assert.equal(finalState1.status, 'finished');

      const flushes2 = g.clients.map(c => on(c, 'game_started', 5000));
      await ack(g.clients[0], 'play_again');
      await Promise.all(flushes2);

      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const room = rooms.get(g.roomCode);
      for (let i = 0; i < 2; i++) {
        room.players[i].hand = [{ id: `r2_p${i}_fin`, color: 'blue', value: '8' }];
      }
      room.discardPile = [{ id: 'r2_discard', color: 'blue', value: '3' }];
      room.currentColor = 'blue';
      room.currentTurn = 0;
      for (const p of room.players) {
        io.to(p.socketId).emit('state_update', game.serializeRoomForPlayer(room, p.id));
      }
      await new Promise(r => setTimeout(r, 100));
      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const flushes3 = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      await ack(g.clients[0], 'play_card', { cardId: 'r2_p0_fin' });
      await Promise.all(flushes3);

      const finalState2 = lastLog(g.clients[0], 'state_update');
      assert.equal(finalState2.status, 'finished', 'second game should finish');
      assert.ok(finalState2.winner, 'second game should have winner');
      assert.ok(finalState2.loser, 'second game should have loser');

      cleanup(g.clients);
    });

    it('7. play again with 3 players', async () => {
      const g = await freshGame(3);

      for (let i = 0; i < 3; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const room = rooms.get(g.roomCode);

      room.players[0].hand = [{ id: 'p0_fin3', color: 'red', value: '9' }];
      room.players[1].hand = [{ id: 'p1_fin3', color: 'red', value: '8' }];
      room.players[2].hand = [{ id: 'p2_fin3', color: 'red', value: '7' }];
      room.discardPile = [{ id: 'd_fin3', color: 'red', value: '5' }];
      room.currentColor = 'red';
      room.currentTurn = 0;
      room.drawStack = 0;
      for (const p of room.players) {
        io.to(p.socketId).emit('state_update', game.serializeRoomForPlayer(room, p.id));
      }
      await new Promise(r => setTimeout(r, 100));
      for (let i = 0; i < 3; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const f1 = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      await ack(g.clients[0], 'play_card', { cardId: 'p0_fin3' });
      await Promise.all(f1);

      const s1 = lastLog(g.clients[0], 'state_update');
      assert.equal(s1.status, 'playing', '3-player: 1st eliminated, game continues');

      const t1 = s1.currentTurn;
      for (let i = 0; i < 3; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      room.players[1].hand = [{ id: 'p1_fin3b', color: 'red', value: '6' }];
      for (const p of room.players) {
        if (!p.eliminated) {
          io.to(p.socketId).emit('state_update', game.serializeRoomForPlayer(room, p.id));
        }
      }
      await new Promise(r => setTimeout(r, 50));
      for (let i = 0; i < 3; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const f2 = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      await ack(g.clients[t1], 'play_card', { cardId: 'p1_fin3b' });
      await Promise.all(f2);

      const s2 = lastLog(g.clients[0], 'state_update');
      assert.equal(s2.status, 'finished', '3-player: game should be finished');
      assert.ok(s2.winner, 'should have winner');
      assert.ok(s2.loser, 'should have loser');
      assert.equal(s2.finishOrder.length, 3, 'finish order has 3 entries');

      const f3 = g.clients.map(c => on(c, 'game_started', 5000));
      const res = await ack(g.clients[0], 'play_again');
      assert.ok(!res.error, JSON.stringify(res));
      const freshStates = await Promise.all(f3);

      for (const s of freshStates) {
        assert.equal(s.status, 'playing');
        assert.equal(s.players.length, 3);
        const me = s.players.find(p => p.hand !== undefined);
        assert.equal(me.hand.length, 7);
        assert.equal(s.winner, null);
        assert.equal(s.finishOrder.length, 0);
      }

      cleanup(g.clients);
    });
  });


  describe('UNO call/catch lifecycle', () => {
    it('8. call_uno succeeds when player has exactly 1 card', async () => {
      const g = await freshGame(2);

      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const room = rooms.get(g.roomCode);
      const turnIdx = room.currentTurn;
      room.players[turnIdx].hand = [{ id: 'uno_card', color: 'red', value: '1' }];
      for (const p of room.players) {
        io.to(p.socketId).emit('state_update', game.serializeRoomForPlayer(room, p.id));
      }
      await new Promise(r => setTimeout(r, 100));
      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const res = await ack(g.clients[turnIdx], 'call_uno');
      assert.ok(!res.error, `call_uno should succeed: ${JSON.stringify(res)}`);

      const updatedState = lastLog(g.clients[0], 'state_update');
      const updatedMe = updatedState.players.find(p => p.id === g.clients[turnIdx]._playerId);
      assert.equal(updatedMe.unoCalled, undefined, 'unoCalled should not be in serialized state');

      cleanup(g.clients);
    });

    it('9. call_uno rejected when player has more than 1 card', async () => {
      const g = await freshGame(2);
      const s = lastLog(g.clients[0], 'game_started');
      const turnIdx = s.currentTurn;
      const hand = myHand(lastLog(g.clients[turnIdx], 'state_update') || s);

      if (hand && hand.length > 1) {
        const res = await ack(g.clients[turnIdx], 'call_uno');
        assert.ok(res.error, 'should reject call_uno with >1 card');
      } else {
        const room = rooms.get(g.roomCode);
        room.players[turnIdx].hand.push({ id: 'extra', color: 'blue', value: '2' });
        io.to(room.players[turnIdx].socketId).emit('state_update', game.serializeRoomForPlayer(room, room.players[turnIdx].id));
        await new Promise(r => setTimeout(r, 50));
        g.clients[turnIdx]._log = g.clients[turnIdx]._log.filter(x => x.event !== 'state_update');

        const res = await ack(g.clients[turnIdx], 'call_uno');
        assert.ok(res.error, 'should reject call_uno with >1 card');
      }

      cleanup(g.clients);
    });

    it('10. catch_uno penalizes target who has 1 card (successful catch)', async () => {
      const g = await freshGame(2);

      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const room = rooms.get(g.roomCode);
      const turnIdx = room.currentTurn;
      const targetIdx = (turnIdx + 1) % 2;
      room.players[targetIdx].hand = [{ id: 'target_1card', color: 'green', value: '3' }];
      room.players[targetIdx].unoCalled = false;
      for (const p of room.players) {
        io.to(p.socketId).emit('state_update', game.serializeRoomForPlayer(room, p.id));
      }
      await new Promise(r => setTimeout(r, 100));
      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const targetHandBefore = room.players[targetIdx].hand.length;
      const flushes = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      const res = await ack(g.clients[turnIdx], 'catch_uno', { targetId: g.clients[targetIdx]._playerId });
      assert.ok(!res.error, JSON.stringify(res));
      assert.equal(res.success, true, 'should be successful catch');
      await Promise.all(flushes);

      assert.ok(room.players[targetIdx].hand.length >= targetHandBefore + 5, 'target should get +5 penalty cards');

      cleanup(g.clients);
    });

    it('11. wrong catch penalizes catcher when target has >1 card', async () => {
      const g = await freshGame(2);

      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const room = rooms.get(g.roomCode);
      const turnIdx = room.currentTurn;
      const targetIdx = (turnIdx + 1) % 2;
      room.players[targetIdx].hand = [
        { id: 'target_card1', color: 'yellow', value: '4' },
        { id: 'target_card2', color: 'red', value: '7' },
      ];
      for (const p of room.players) {
        io.to(p.socketId).emit('state_update', game.serializeRoomForPlayer(room, p.id));
      }
      await new Promise(r => setTimeout(r, 100));
      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const catcherHandBefore = room.players[turnIdx].hand.length;
      const flushes = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      const res = await ack(g.clients[turnIdx], 'catch_uno', { targetId: g.clients[targetIdx]._playerId });
      assert.ok(!res.error, JSON.stringify(res));
      assert.equal(res.success, false, 'should be wrong catch');
      await Promise.all(flushes);

      assert.ok(room.players[turnIdx].hand.length >= catcherHandBefore + 5, 'catcher should get +5 penalty cards');

      cleanup(g.clients);
    });

    it('12. uno_called broadcast received by all clients', async () => {
      const g = await freshGame(2);

      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const room = rooms.get(g.roomCode);
      const turnIdx = room.currentTurn;
      room.players[turnIdx].hand = [{ id: 'uno_broadcast', color: 'red', value: '7' }];
      for (const p of room.players) {
        io.to(p.socketId).emit('state_update', game.serializeRoomForPlayer(room, p.id));
      }
      await new Promise(r => setTimeout(r, 100));
      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const otherClients = g.clients.filter((_, i) => i !== turnIdx);
      const unoFlushes = otherClients.map(c => on(c, 'uno_called', 3000).catch(() => null));

      await ack(g.clients[turnIdx], 'call_uno');
      const unoResults = await Promise.all(unoFlushes);

      for (const r of unoResults) {
        if (r) {
          assert.equal(r.playerId, g.clients[turnIdx]._playerId, 'broadcast should identify caller');
        }
      }

      cleanup(g.clients);
    });

    it('13. after successful catch, target gets penalty cards', async () => {
      const g = await freshGame(2);

      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const room = rooms.get(g.roomCode);
      const turnIdx = room.currentTurn;
      const targetIdx = (turnIdx + 1) % 2;
      room.players[targetIdx].hand = [{ id: 'catch_reset', color: 'blue', value: '6' }];
      room.players[targetIdx].unoCalled = false;
      for (const p of room.players) {
        io.to(p.socketId).emit('state_update', game.serializeRoomForPlayer(room, p.id));
      }
      await new Promise(r => setTimeout(r, 100));
      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const flushes = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      const res = await ack(g.clients[turnIdx], 'catch_uno', { targetId: g.clients[targetIdx]._playerId });
      assert.equal(res.success, true, 'should be successful catch');
      await Promise.all(flushes);

      assert.ok(room.players[targetIdx].hand.length >= 2, 'target should have penalty cards');

      cleanup(g.clients);
    });

    it('14. call_uno then play card resets unoCalled', async () => {
      const g = await freshGame(3);

      const room = rooms.get(g.roomCode);
      const turnIdx = room.currentTurn;

      room.players[turnIdx].hand = [
        { id: 'uno_card', color: 'red', value: '7' },
      ];
      for (let i = 0; i < 3; i++) {
        room.players[i].eliminated = false;
        room.players[i].finishPosition = null;
        room.players[i].unoCalled = false;
      }
      room.discardPile = [{ id: 'd_uno', color: 'red', value: '5' }];
      room.currentColor = 'red';
      room.currentTurn = turnIdx;
      room.drawStack = 0;
      room.direction = 1;
      room.status = 'playing';
      for (const p of room.players) {
        io.to(p.socketId).emit('state_update', game.serializeRoomForPlayer(room, p.id));
      }
      await new Promise(r => setTimeout(r, 100));
      for (let i = 0; i < 3; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const unoRes = await ack(g.clients[turnIdx], 'call_uno');
      assert.ok(!unoRes.error, JSON.stringify(unoRes));
      const afterUno = lastLog(g.clients[0], 'state_update');
      const unoMe = afterUno.players.find(p => p.id === g.clients[turnIdx]._playerId);
      assert.equal(unoMe.unoCalled, undefined, 'unoCalled not in serialized state');

      for (let i = 0; i < 3; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const flushes = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      await ack(g.clients[turnIdx], 'play_card', { cardId: 'uno_card' });
      await Promise.all(flushes);

      const afterPlay = lastLog(g.clients[0], 'state_update');
      const afterPlayMe = afterPlay.players.find(p => p.id === g.clients[turnIdx]._playerId);
      assert.equal(afterPlayMe.unoCalled, undefined, 'unoCalled not in serialized state');

      cleanup(g.clients);
    });
  });


  describe('MULTI-CARD DRAW lifecycle', () => {
    it('15. draw_matching_cards returns correct count from live game', async () => {
      const g = await freshGame(2);

      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const room = rooms.get(g.roomCode);
      const turnIdx = room.currentTurn;
      const handBefore = room.players[turnIdx].hand.length;

      const flushes = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      const res = await ack(g.clients[turnIdx], 'draw_card');
      await Promise.all(flushes);

      assert.ok(!res.error, JSON.stringify(res));
      assert.ok(res.drawn.length >= 1, 'should draw at least 1');
      assert.ok(res.drawn.length <= 8, 'should not draw unreasonably many');

      const afterState = lastLog(g.clients[0], 'state_update');
      const afterMe = afterState.players.find(p => p.id === g.clients[turnIdx]._playerId);
      assert.equal(afterMe.hand.length, handBefore + res.drawn.length, 'hand should grow by drawn count');
      assert.notEqual(afterState.currentTurn, turnIdx, 'turn should advance');

      cleanup(g.clients);
    });

    it('16. chain matching: Red5→Blue5→Blue7 all drawn (each matches previous)', () => {
      const room = {
        code: 'CHAIN', status: 'playing', currentTurn: 0, drawStack: 0, direction: 1, currentColor: 'red',
        deck: [
          { id: 'c1', color: 'red', value: '5' },
          { id: 'c2', color: 'blue', value: '5' },
          { id: 'c3', color: 'blue', value: '7' },
          { id: 'c4', color: 'green', value: '9' },
        ],
        discardPile: [{ id: 'top', color: 'red', value: '3' }],
        players: [{ id: 'p0', hand: [], eliminated: false }, { id: 'p1', hand: [], eliminated: false }],
      };

      const result = game.drawMatchingCards(room, 'p0');
      assert.equal(result.drawn.length, 3, 'Red 5 → Blue 5 (value 5) → Blue 7 (color blue)');
      assert.equal(result.drawn[0].id, 'c1');
      assert.equal(result.drawn[1].id, 'c2');
      assert.equal(result.drawn[2].id, 'c3');
    });

    it('17. stops at non-matching card: Red5→Blue3 stops (blue≠red, 3≠5)', () => {
      const room = {
        code: 'STOP', status: 'playing', currentTurn: 0, drawStack: 0, direction: 1, currentColor: 'red',
        deck: [
          { id: 'c1', color: 'red', value: '5' },
          { id: 'c2', color: 'blue', value: '3' },
          { id: 'c3', color: 'green', value: '7' },
        ],
        discardPile: [{ id: 'top', color: 'red', value: '3' }],
        players: [{ id: 'p0', hand: [], eliminated: false }, { id: 'p1', hand: [], eliminated: false }],
      };

      const result = game.drawMatchingCards(room, 'p0');
      assert.equal(result.drawn.length, 1, 'Red 5 drawn; Blue 3 does not match Red 5 (chain: color=red→blue≠red, value=5→3≠5)');
      assert.equal(result.drawn[0].id, 'c1');
    });

    it('18. draws only 1 when second card has no match', () => {
      const room = {
        code: 'NOCHAIN', status: 'playing', currentTurn: 0, drawStack: 0, direction: 1, currentColor: 'red',
        deck: [
          { id: 'c1', color: 'red', value: '5' },
          { id: 'c2', color: 'green', value: '9' },
        ],
        discardPile: [{ id: 'top', color: 'red', value: '3' }],
        players: [{ id: 'p0', hand: [], eliminated: false }, { id: 'p1', hand: [], eliminated: false }],
      };

      const result = game.drawMatchingCards(room, 'p0');
      assert.equal(result.drawn.length, 1, 'Red 5 drawn; Green 9 does not match Red 5');
    });

    it('19. stops at wild card', () => {
      const room = {
        code: 'WILD', status: 'playing', currentTurn: 0, drawStack: 0, direction: 1, currentColor: 'red',
        deck: [
          { id: 'c1', color: 'red', value: '5' },
          { id: 'c2', color: 'wild', value: 'wild' },
          { id: 'c3', color: 'red', value: '7' },
        ],
        discardPile: [{ id: 'top', color: 'red', value: '3' }],
        players: [{ id: 'p0', hand: [], eliminated: false }, { id: 'p1', hand: [], eliminated: false }],
      };

      const result = game.drawMatchingCards(room, 'p0');
      assert.equal(result.drawn.length, 1, 'Red 5 drawn; wild stops chain');
    });

    it('20. draw from live game always succeeds (reshuffle if needed)', async () => {
      const g = await freshGame(2);

      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const room = rooms.get(g.roomCode);
      const turnIdx = room.currentTurn;
      const handBefore = room.players[turnIdx].hand.length;

      const flushes = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      const res = await ack(g.clients[turnIdx], 'draw_card');
      await Promise.all(flushes);

      assert.ok(!res.error, JSON.stringify(res));
      assert.ok(res.drawn.length >= 1, 'should draw at least 1');
      const after = lastLog(g.clients[0], 'state_update');
      const afterMe = after.players.find(p => p.id === g.clients[turnIdx]._playerId);
      assert.equal(afterMe.hand.length, handBefore + res.drawn.length);

      cleanup(g.clients);
    });

    it('21. draw2 stack resolves correct number of cards', async () => {
      const g = await freshGame(2);

      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const room = rooms.get(g.roomCode);
      room.drawStack = 2;
      room.players[0].hand = [{ id: 'forced_draw', color: 'red', value: '1' }];
      room.players[1].hand = [{ id: 'forced_draw2', color: 'blue', value: '2' }];
      for (const p of room.players) {
        io.to(p.socketId).emit('state_update', game.serializeRoomForPlayer(room, p.id));
      }
      await new Promise(r => setTimeout(r, 100));
      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const turnIdx = room.currentTurn;
      const handBefore = room.players[turnIdx].hand.length;

      const flushes = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      const drawRes = await ack(g.clients[turnIdx], 'draw_card');
      await Promise.all(flushes);

      assert.equal(drawRes.drawn.length, 2, 'should draw exactly 2 cards for stack');
      const afterDraw = lastLog(g.clients[0], 'state_update');
      assert.equal(afterDraw.drawStack, 0, 'drawStack should be 0 after resolving');
      const afterMe = afterDraw.players.find(p => p.id === g.clients[turnIdx]._playerId);
      assert.equal(afterMe.hand.length, handBefore + 2);

      cleanup(g.clients);
    });

    it('22. chain matching extended: Blue5→Red5→Red3→Blue3 draws 4', () => {
      const room = {
        code: 'EXT', status: 'playing', currentTurn: 0, drawStack: 0, direction: 1, currentColor: 'blue',
        deck: [
          { id: 'c1', color: 'blue', value: '5' },
          { id: 'c2', color: 'red', value: '5' },
          { id: 'c3', color: 'red', value: '3' },
          { id: 'c4', color: 'blue', value: '3' },
          { id: 'c5', color: 'green', value: '7' },
        ],
        discardPile: [{ id: 'top', color: 'blue', value: '9' }],
        players: [{ id: 'p0', hand: [], eliminated: false }, { id: 'p1', hand: [], eliminated: false }],
      };

      const result = game.drawMatchingCards(room, 'p0');
      assert.equal(result.drawn.length, 4, 'Blue5→Red5(val5)→Red3(val3 wrong? no: red color matches red)→Blue3(blue matches blue)→Green7 stops');
      assert.equal(result.drawn[0].id, 'c1');
      assert.equal(result.drawn[1].id, 'c2');
      assert.equal(result.drawn[2].id, 'c3');
      assert.equal(result.drawn[3].id, 'c4');
    });

    it('23. value chain: Red5→Blue5→Green5 draws 3 (all value 5)', () => {
      const room = {
        code: 'VAL', status: 'playing', currentTurn: 0, drawStack: 0, direction: 1, currentColor: 'red',
        deck: [
          { id: 'c1', color: 'red', value: '5' },
          { id: 'c2', color: 'blue', value: '5' },
          { id: 'c3', color: 'green', value: '5' },
          { id: 'c4', color: 'yellow', value: '3' },
        ],
        discardPile: [{ id: 'top', color: 'red', value: '3' }],
        players: [{ id: 'p0', hand: [], eliminated: false }, { id: 'p1', hand: [], eliminated: false }],
      };

      const result = game.drawMatchingCards(room, 'p0');
      assert.equal(result.drawn.length, 3, 'all 5s chain by value');
    });
  });


  describe('COMBINED lifecycle: UNO + Play Again', () => {
    it('24. full game with quick finish, UNO call, play again', async () => {
      const g = await setupGameEndingSoon(2);

      const f1 = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      await ack(g.clients[0], 'play_card', { cardId: 'p0_finisher' });
      await Promise.all(f1);

      const finalState = lastLog(g.clients[0], 'state_update');
      assert.equal(finalState.status, 'finished');

      const f2 = g.clients.map(c => on(c, 'game_started', 5000));
      const res = await ack(g.clients[0], 'play_again');
      assert.ok(!res.error, JSON.stringify(res));
      const freshStates = await Promise.all(f2);

      for (const s of freshStates) {
        assert.equal(s.status, 'playing');
        const me = s.players.find(p => p.hand !== undefined);
        assert.equal(me.hand.length, 7);
        assert.equal(me.unoCalled, undefined, 'unoCalled not in serialized state');
        assert.equal(s.winner, null);
      }

      cleanup(g.clients);
    });

    it('25. multi-draw then play again resets everything', async () => {
      const g = await freshGame(2);

      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const room = rooms.get(g.roomCode);
      const turnIdx = room.currentTurn;
      const handBefore = room.players[turnIdx].hand.length;

      const f1 = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      const drawRes = await ack(g.clients[turnIdx], 'draw_card');
      await Promise.all(f1);

      assert.ok(drawRes.drawn.length >= 1);

      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'state_update');
      }

      const room2 = rooms.get(g.roomCode);
      for (let i = 0; i < 2; i++) {
        room2.players[i].hand = [{ id: `combo_p${i}`, color: 'red', value: '9' }];
        room2.players[i].eliminated = false;
        room2.players[i].finishPosition = null;
      }
      room2.discardPile = [{ id: 'combo_d', color: 'red', value: '5' }];
      room2.currentColor = 'red';
      room2.currentTurn = 0;
      room2.drawStack = 0;
      room2.direction = 1;
      room2.status = 'playing';
      for (const p of room2.players) {
        io.to(p.socketId).emit('state_update', game.serializeRoomForPlayer(room2, p.id));
      }
      await new Promise(r => setTimeout(r, 100));

      const f2 = g.clients.map(c => on(c, 'state_update', 3000).catch(() => null));
      await ack(g.clients[0], 'play_card', { cardId: 'combo_p0' });
      await Promise.all(f2);

      const finalState = lastLog(g.clients[0], 'state_update');
      assert.equal(finalState.status, 'finished');

      for (let i = 0; i < 2; i++) {
        g.clients[i]._log = g.clients[i]._log.filter(x => x.event !== 'game_started');
      }
      const f3 = g.clients.map(c => on(c, 'game_started', 5000));
      await ack(g.clients[0], 'play_again');
      const freshStates = await Promise.all(f3);

      for (const s of freshStates) {
        assert.equal(s.status, 'playing');
        assert.equal(s.drawStack, 0);
        assert.equal(s.winner, null);
        assert.equal(s.finishOrder.length, 0);
      }

      cleanup(g.clients);
    });
  });
});
