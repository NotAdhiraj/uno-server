const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const game = require('../game');
const rooms = require('../rooms');

function makeCard(id, color, value) {
  return { id, color, value };
}

function makeGameRoom(opts = {}) {
  const n = opts.players || 2;
  const players = [];
  for (let i = 0; i < n; i++) {
    const id = opts.playerIds?.[i] || `p${i}`;
    players.push({
      id,
      socketId: opts.socketIds?.[i] || `s${i}`,
      name: opts.playerNames?.[i] || `Player${i}`,
      isConnected: opts.disconnected?.includes(i) ? false : true,
      hand: opts.hands?.[i] || [],
      eliminated: opts.eliminated?.includes(i) ? true : false,
      finishPosition: null,
      unoCalled: false,
    });
  }
  return {
    code: opts.code || 'TEST',
    hostId: opts.hostId || 'p0',
    maxPlayers: opts.maxPlayers || n,
    players,
    status: opts.status || 'playing',
    deck: opts.deck || [makeCard('d1', 'blue', '1')],
    discardPile: opts.discardPile || [makeCard('top', 'red', '5')],
    currentColor: opts.currentColor || 'red',
    currentTurn: opts.currentTurn ?? 0,
    direction: opts.direction ?? 1,
    drawStack: opts.drawStack ?? 0,
    drawStackType: opts.drawStackType ?? null,
    winner: opts.winner ?? null,
    loser: opts.loser ?? null,
    finishOrder: opts.finishOrder ?? [],
  };
}

function makeFinishedRoom(code, ids) {
  const room = {
    code,
    hostId: ids[0],
    maxPlayers: ids.length,
    players: ids.map((id, i) => ({
      id, socketId: `s_${id}`, name: `P${i}`,
      isConnected: true, eliminated: true, finishPosition: i + 1,
    })),
    status: 'finished',
    finishOrder: [...ids],
    winner: ids[0],
    loser: ids[ids.length - 1],
  };
  rooms.rooms.set(code, room);
  return room;
}

// ============================================================
// LEAVE REGRESSIONS
// ============================================================

describe('LEAVE regressions', () => {
  beforeEach(() => { rooms.rooms.clear(); });

  it('1. leave during active game removes player and fixes turn', () => {
    const room = makeGameRoom({ players: 4, currentTurn: 2 });
    rooms.rooms.set('L1', room);
    const res = rooms.leaveRoom('p1');
    assert.ok(!res.notFound);
    assert.equal(room.players.length, 3);
    assert.ok(!room.players.some(p => p.id === 'p1'));
    assert.ok(room.currentTurn >= 0 && room.currentTurn < 3);
  });

  it('2. leave after game over removes player', () => {
    makeFinishedRoom('L2', ['w', 'a', 'b']);
    const res = rooms.leaveRoom('a');
    assert.ok(!res.notFound && !res.deleted);
    assert.equal(res.room.players.length, 2);
    assert.ok(!res.room.players.some(p => p.id === 'a'));
  });

  it('3. winner leaves after winning', () => {
    makeFinishedRoom('L3', ['w', 'a', 'b']);
    const res = rooms.leaveRoom('w');
    assert.ok(res.room);
    assert.ok(!res.room.players.some(p => p.id === 'w'));
    assert.equal(res.room.players.length, 2);
  });

  it('4. non-winner leaves after game over', () => {
    makeFinishedRoom('L4', ['w', 'a', 'b']);
    const res = rooms.leaveRoom('b');
    assert.ok(res.room);
    assert.ok(!res.room.players.some(p => p.id === 'b'));
  });

  it('5. leave with 2 players keeps room for the other', () => {
    makeFinishedRoom('L5', ['w', 'a']);
    const res = rooms.leaveRoom('w');
    assert.ok(res.room && !res.deleted);
    assert.equal(res.room.players.length, 1);
    assert.equal(res.room.players[0].id, 'a');
  });

  it('6. leave with 3+ players keeps everyone else stable', () => {
    makeFinishedRoom('L6', ['w', 'a', 'b', 'c']);
    const before = rooms.rooms.get('L6').players.map(p => p.id);
    rooms.leaveRoom('a');
    const after = rooms.rooms.get('L6').players.map(p => p.id);
    assert.deepEqual(after, before.filter(id => id !== 'a'));
  });

  it('7. host leaves after game over transfers host', () => {
    makeFinishedRoom('L7', ['h', 'a', 'b']);
    const res = rooms.leaveRoom('h');
    assert.equal(res.room.hostId, 'a');
  });

  it('8. double leave is safe (second returns notFound, no crash)', () => {
    makeFinishedRoom('L8', ['w', 'a']);
    const first = rooms.leaveRoom('a');
    assert.ok(first.ok !== false && !first.notFound);
    const second = rooms.leaveRoom('a');
    assert.ok(second.notFound);
    assert.ok(rooms.rooms.has('L8'));
  });

  it('9. last player leave deletes room', () => {
    makeFinishedRoom('L9', ['solo']);
    const res = rooms.leaveRoom('solo');
    assert.ok(res.deleted);
    assert.ok(!rooms.rooms.has('L9'));
  });

  it('10. leave then lookup finds nothing (no session restore)', () => {
    makeFinishedRoom('L10', ['w', 'a']);
    rooms.leaveRoom('a');
    assert.equal(rooms.findRoomByPlayerId('a'), null);
  });

  it('11. leave does not create ghost players or stale refs', () => {
    makeFinishedRoom('L11', ['w', 'a', 'b']);
    rooms.leaveRoom('w');
    const room = rooms.rooms.get('L11');
    const ids = room.players.map(p => p.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(!ids.includes('w'));
    assert.ok(room.hostId !== 'w');
  });

  it('12. leave current-turn player during play keeps valid turn', () => {
    const room = makeGameRoom({ players: 3, currentTurn: 1 });
    rooms.rooms.set('L12', room);
    rooms.leaveRoom(room.players[1].id);
    assert.ok(room.currentTurn >= 0 && room.currentTurn < room.players.length);
  });
});

// ============================================================
// SKIP REGRESSIONS
// ============================================================

describe('SKIP regressions', () => {
  it('1. single skip by color advances exactly 2 seats', () => {
    const room = makeGameRoom({ players: 4, hands: [[makeCard('s', 'red', 'skip'), makeCard('x', 'blue', '1')], [], [], []] });
    const r = game.playCard(room, 'p0', 's');
    assert.ok(!r.error);
    assert.equal(room.currentTurn, 2);
  });

  it('2. skip by color (red skip on red 5)', () => {
    const room = makeGameRoom({
      players: 3, discardPile: [makeCard('top', 'red', '5')], currentColor: 'red',
      hands: [[makeCard('s', 'red', 'skip'), makeCard('x', 'blue', '1')], [], []],
    });
    assert.ok(!game.playCard(room, 'p0', 's').error);
    assert.equal(room.currentTurn, 2);
  });

  it('3. skip by type (blue skip on red skip)', () => {
    const room = makeGameRoom({
      players: 3, discardPile: [makeCard('top', 'red', 'skip')], currentColor: 'red',
      hands: [[makeCard('s', 'blue', 'skip'), makeCard('x', 'blue', '1')], [], []],
    });
    assert.ok(!game.playCard(room, 'p0', 's').error);
    assert.equal(room.currentTurn, 2);
  });

  it('4. multi-skip (2 skips, 4p) lands 3 seats ahead', () => {
    const room = makeGameRoom({
      players: 4, currentColor: 'red', discardPile: [makeCard('top', 'red', '3')],
      hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip'), makeCard('x', 'green', '1')], [], [], []],
    });
    assert.ok(!game.playMultipleCards(room, 'p0', ['a', 'b']).error);
    assert.equal(room.currentTurn, 3);
  });

  it('5. skip with 2 players returns turn to same player', () => {
    const room = makeGameRoom({ players: 2, hands: [[makeCard('s', 'red', 'skip'), makeCard('x', 'blue', '1')], [makeCard('y', 'green', '2')]] });
    assert.ok(!game.playCard(room, 'p0', 's').error);
    assert.equal(room.currentTurn, 0);
  });

  it('6. skip with 3+ players lands correctly', () => {
    const room = makeGameRoom({ players: 5, hands: [[makeCard('s', 'red', 'skip'), makeCard('x', 'blue', '1')], [], [], [], []] });
    assert.ok(!game.playCard(room, 'p0', 's').error);
    assert.equal(room.currentTurn, 2);
  });

  it('7. skip with eliminated players skips active players only', () => {
    const room = makeGameRoom({
      players: 4, eliminated: [1],
      hands: [[makeCard('s', 'red', 'skip'), makeCard('x', 'blue', '1')], [], [makeCard('b', 'green', '2')], [makeCard('c', 'yellow', '3')]],
    });
    assert.ok(!game.playCard(room, 'p0', 's').error);
    assert.equal(room.currentTurn, 3);
  });

  it('8. skip with disconnected players skips them', () => {
    const room = makeGameRoom({
      players: 4, disconnected: [1],
      hands: [[makeCard('s', 'red', 'skip'), makeCard('x', 'blue', '1')], [makeCard('a', 'red', '1')], [makeCard('b', 'green', '2')], [makeCard('c', 'yellow', '3')]],
    });
    assert.ok(!game.playCard(room, 'p0', 's').error);
    assert.equal(room.currentTurn, 3);
    assert.ok(room.players[room.currentTurn].isConnected !== false);
  });

  it('9. skip near game end (1 card left) resolves turn, power-final rule preserved', () => {
    const room = makeGameRoom({
      players: 3,
      hands: [[makeCard('s', 'red', 'skip'), makeCard('x', 'blue', '1')], [makeCard('a', 'blue', '1')], [makeCard('b', 'green', '2')]],
    });
    const r = game.playCard(room, 'p0', 's');
    assert.ok(!r.error);
    assert.equal(room.players[0].hand.length, 1);
    assert.ok(!room.players[0].eliminated);
    assert.equal(room.status, 'playing');
    assert.equal(room.currentTurn, 2);
    // And a lone skip still cannot be the final card (existing rule intact)
    const room2 = makeGameRoom({
      players: 3,
      hands: [[makeCard('s', 'red', 'skip')], [makeCard('a', 'blue', '1')], [makeCard('b', 'green', '2')]],
    });
    assert.ok(game.playCard(room2, 'p0', 's').error);
  });

  it('10. skip+reverse mixed batch stays invalid', () => {
    const room = makeGameRoom({
      players: 4, currentColor: 'red', discardPile: [makeCard('top', 'red', '3')],
      hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'red', 'reverse'), makeCard('x', 'green', '1')], [], [], []],
    });
    const r = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.ok(r.error);
    assert.equal(room.currentTurn, 0);
    assert.equal(room.players[0].hand.length, 3);
  });

  it('11. skip keeps all serialized clients in agreement', () => {
    const room = makeGameRoom({ players: 3, hands: [[makeCard('s', 'red', 'skip'), makeCard('x', 'blue', '1')], [makeCard('a', 'blue', '1')], [makeCard('b', 'green', '2')]] });
    game.playCard(room, 'p0', 's');
    const views = room.players.map(p => game.serializeRoomForPlayer(room, p.id));
    for (let i = 1; i < views.length; i++) {
      assert.equal(views[i].currentTurn, views[0].currentTurn);
      assert.equal(views[i].discardTop.id, views[0].discardTop.id);
    }
  });

  it('12. invalid skip does not partially mutate state', () => {
    const room = makeGameRoom({
      players: 3, currentTurn: 1,
      hands: [[makeCard('s', 'red', 'skip'), makeCard('x', 'blue', '1')], [makeCard('a', 'blue', '1')], []],
    });
    const before = JSON.stringify({ hand: room.players[0].hand, pile: room.discardPile, turn: room.currentTurn });
    const r = game.playCard(room, 'p0', 's');
    assert.ok(r.error);
    assert.equal(JSON.stringify({ hand: room.players[0].hand, pile: room.discardPile, turn: room.currentTurn }), before);
  });

  it('13. repeated skips resolve each turn correctly', () => {
    const room = makeGameRoom({
      players: 4,
      hands: [
        [makeCard('s0', 'red', 'skip'), makeCard('x', 'blue', '1')],
        [makeCard('f', 'red', '1')],
        [makeCard('s2', 'red', 'skip'), makeCard('y', 'green', '1')],
        [makeCard('g', 'yellow', '1')],
      ],
    });
    assert.ok(!game.playCard(room, 'p0', 's0').error);
    assert.equal(room.currentTurn, 2);
    assert.ok(!game.playCard(room, 'p2', 's2').error);
    assert.equal(room.currentTurn, 0);
  });

  it('14. skip after reverse follows reversed direction', () => {
    const room = makeGameRoom({
      players: 4, direction: -1, currentTurn: 0,
      hands: [[makeCard('s', 'red', 'skip'), makeCard('x', 'blue', '1')], [], [], []],
    });
    assert.ok(!game.playCard(room, 'p0', 's').error);
    assert.equal(room.currentTurn, 2);
  });

  it('15. reverse after skip works', () => {
    const room = makeGameRoom({
      players: 4,
      hands: [
        [makeCard('s0', 'red', 'skip'), makeCard('x', 'blue', '1')],
        [makeCard('f', 'red', '1')],
        [makeCard('r2', 'red', 'reverse'), makeCard('y', 'green', '1')],
        [makeCard('g', 'yellow', '1')],
      ],
    });
    assert.ok(!game.playCard(room, 'p0', 's0').error);
    assert.equal(room.currentTurn, 2);
    assert.ok(!game.playCard(room, 'p2', 'r2').error);
    assert.equal(room.direction, -1);
  });

  it('16. skip with currentTurn at array boundary wraps', () => {
    const room = makeGameRoom({
      players: 4, currentTurn: 3, currentColor: 'red',
      discardPile: [makeCard('top', 'red', '7')],
      hands: [[], [], [], [makeCard('s', 'red', 'skip'), makeCard('x', 'blue', '1')]],
    });
    assert.ok(!game.playCard(room, 'p3', 's').error);
    assert.equal(room.currentTurn, 1);
  });

  it('17. advanceTurn and getNextTurn skip disconnected players', () => {
    const room = makeGameRoom({ players: 3, disconnected: [1], currentTurn: 0 });
    game.advanceTurn(room);
    assert.equal(room.currentTurn, 2);
    const room2 = makeGameRoom({ players: 3, disconnected: [1], currentTurn: 0 });
    assert.equal(game.getNextTurn(room2), 2);
  });
});
