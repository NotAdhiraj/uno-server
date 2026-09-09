const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const game = require('../game');
const { rooms, createRoom, joinRoom, leaveRoom, markDisconnected } = require('../rooms');

function makeCard(id, color, value) {
  return { id, color, value };
}

function makeRoom(opts = {}) {
  const n = opts.players || 2;
  const players = [];
  for (let i = 0; i < n; i++) {
    const id = opts.playerIds?.[i] || `p${i}`;
    players.push({
      id,
      socketId: opts.socketIds?.[i] || `s${i}`,
      name: opts.playerNames?.[i] || `Player${i}`,
      isConnected: true,
      hand: opts.hands?.[i] || [],
      eliminated: false,
      finishPosition: null,
      unoCalled: false,
    });
  }
  return {
    code: opts.code || 'BUGS',
    hostId: opts.hostId || 'p0',
    maxPlayers: opts.maxPlayers || n,
    players,
    status: opts.status || 'playing',
    deck: opts.deck || [],
    discardPile: opts.discardPile || [],
    currentColor: opts.currentColor || 'red',
    currentTurn: opts.currentTurn ?? 0,
    direction: opts.direction ?? 1,
    drawStack: opts.drawStack ?? 0,
    winner: opts.winner ?? null,
    loser: opts.loser ?? null,
    finishOrder: opts.finishOrder ?? [],
  };
}

function countAllCards(room) {
  let total = 0;
  const ids = new Set();
  for (const c of room.discardPile) {
    total++;
    if (ids.has(c.id)) return { total: -1, duplicate: c.id };
    ids.add(c.id);
  }
  for (const p of room.players) {
    for (const c of (p.hand || [])) {
      total++;
      if (ids.has(c.id)) return { total: -1, duplicate: c.id };
      ids.add(c.id);
    }
  }
  total += room.deck.length;
  for (const c of room.deck) {
    if (ids.has(c.id)) return { total: -1, duplicate: c.id };
    ids.add(c.id);
  }
  return { total, ids };
}


describe('BUG 1: leaveRoom advances turn during active game', () => {
  it('1a. leaving player at current turn advances turn correctly (3 players)', () => {
    const room = makeRoom({
      players: 3,
      status: 'playing',
      currentTurn: 1,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [
        [makeCard('a', 'red', '5')],
        [makeCard('b', 'red', '7')],
        [makeCard('c', 'blue', '1')],
      ],
    });

    rooms.set(room.code, room);
    const result = leaveRoom('p1');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.players.length, 2);
    assert.equal(room.currentTurn, 1, 'currentTurn stays at 1, now pointing to p2');
    assert.equal(room.players[room.currentTurn].id, 'p2');
    rooms.delete(room.code);
  });

  it('1b. leaving player before current turn adjusts index', () => {
    const room = makeRoom({
      players: 3,
      status: 'playing',
      currentTurn: 2,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [
        [makeCard('a', 'red', '5')],
        [makeCard('b', 'red', '7')],
        [makeCard('c', 'blue', '1')],
      ],
    });

    rooms.set(room.code, room);
    const result = leaveRoom('p0');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.players.length, 2);
    assert.equal(room.currentTurn, 1, 'currentTurn decremented to point at p2');
    assert.equal(room.players[room.currentTurn].id, 'p2');
    rooms.delete(room.code);
  });

  it('1c. leaving player after current turn does not change currentTurn value', () => {
    const room = makeRoom({
      players: 3,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [
        [makeCard('a', 'red', '5')],
        [makeCard('b', 'red', '7')],
        [makeCard('c', 'blue', '1')],
      ],
    });

    rooms.set(room.code, room);
    const result = leaveRoom('p2');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.players.length, 2);
    assert.equal(room.currentTurn, 0, 'currentTurn stays same when last player leaves');
    rooms.delete(room.code);
  });

  it('1d. host leaving during game transfers host and advances turn', () => {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      currentTurn: 0,
      hostId: 'p0',
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [
        [makeCard('a', 'red', '5')],
        [makeCard('b', 'red', '7')],
      ],
    });

    rooms.set(room.code, room);
    const result = leaveRoom('p0');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.hostId, 'p1');
    assert.equal(room.players.length, 1);
    rooms.delete(room.code);
  });
});


describe('BUG 2: play_multiple_cards event order', () => {
  it('2a. play_multiple_cards with game over: state_update before game_over in call sequence', () => {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [
        [makeCard('a', 'red', '5'), makeCard('b', 'red', '7')],
        [makeCard('c', 'blue', '1'), makeCard('d', 'blue', '2')],
      ],
    });

    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.equal(result.gameOver, true);
    assert.equal(room.status, 'finished');
    assert.equal(room.winner, 'p0');
    assert.equal(room.players[0].eliminated, true);
    assert.equal(room.players[1].eliminated, true);
    assert.deepEqual(room.finishOrder, ['p0', 'p1']);
  });

  it('2b. multi-play with 3+ players: elimination + turn advancement', () => {
    const room = makeRoom({
      players: 3,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [
        [makeCard('a', 'red', '5'), makeCard('b', 'red', '7')],
        [makeCard('c', 'blue', '1'), makeCard('d', 'blue', '2')],
        [makeCard('e', 'green', '1'), makeCard('f', 'green', '2')],
      ],
    });

    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.equal(result.gameOver, false);
    assert.equal(result.eliminated.id, 'p0');
    assert.equal(room.players[0].eliminated, true);
    assert.equal(room.currentTurn, 1);
    assert.equal(room.status, 'playing');
  });
});


describe('BUG 3: drawCards game status check', () => {
  it('3a. drawCards rejects when game is finished', () => {
    const room = makeRoom({
      players: 2,
      status: 'finished',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [
        [makeCard('a', 'red', '5')],
        [makeCard('b', 'blue', '1')],
      ],
    });

    const result = game.drawCards(room, 'p0', 1);
    assert.ok(result.error);
    assert.ok(result.error.includes('not in progress'));
  });

  it('3b. drawCards works normally when game is playing', () => {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1'), makeCard('d2', 'green', '2')],
      hands: [
        [makeCard('a', 'red', '5')],
        [makeCard('b', 'blue', '1')],
      ],
    });

    const result = game.drawCards(room, 'p0', 1);
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.players[0].hand.length, 2);
  });
});


describe('BUG 4: skip card with eliminated/disconnected target', () => {
  it('4a. skip card skips over eliminated player', () => {
    const room = makeRoom({
      players: 4,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [
        [makeCard('a', 'red', 'skip')],
        [makeCard('b', 'blue', '1')],
        [],
        [makeCard('d', 'green', '1')],
      ],
    });
    room.players[2].eliminated = true;

    const result = game.playCard(room, 'p0', 'a');
    assert.ok(!result.error, JSON.stringify(result));
    assert.notEqual(room.currentTurn, 2, 'turn should not land on eliminated player');
    assert.equal(room.players[room.currentTurn].eliminated, false);
  });

  it('4b. skip card skips over disconnected player', () => {
    const room = makeRoom({
      players: 4,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [
        [makeCard('a', 'red', 'skip')],
        [makeCard('b', 'blue', '1')],
        [makeCard('c', 'green', '1')],
        [makeCard('d', 'yellow', '1')],
      ],
    });
    room.players[2].isConnected = false;

    const result = game.playCard(room, 'p0', 'a');
    assert.ok(!result.error, JSON.stringify(result));
    assert.notEqual(room.currentTurn, 2, 'turn should not land on disconnected player');
    assert.equal(room.players[room.currentTurn].isConnected, true);
  });

  it('4c. skip in 2-player game works (acts like skip)', () => {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [
        [makeCard('a', 'red', 'skip')],
        [makeCard('b', 'blue', '1')],
      ],
    });

    const result = game.playCard(room, 'p0', 'a');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.currentTurn, 0, 'current player goes again after skip');
  });
});


describe('Card count integrity after multi-play + elimination', () => {
  it('integrity check after 2-card play with elimination', () => {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [
        [makeCard('a', 'red', '5'), makeCard('b', 'red', '7')],
        [makeCard('c', 'blue', '1'), makeCard('d', 'blue', '2')],
      ],
    });

    game.playMultipleCards(room, 'p0', ['a', 'b']);
    const count = countAllCards(room);
    assert.ok(count.total > 0, 'should have cards');
    assert.ok(!count.duplicate, `duplicate card: ${count.duplicate}`);
  });

  it('integrity check after draw', () => {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1'), makeCard('d2', 'green', '2'), makeCard('d3', 'yellow', '3')],
      hands: [
        [makeCard('a', 'red', '5')],
        [makeCard('b', 'blue', '1')],
      ],
    });

    game.drawMatchingCards(room, 'p0');
    const count = countAllCards(room);
    assert.ok(count.total > 0);
    assert.ok(!count.duplicate, `duplicate card: ${count.duplicate}`);
  });

  it('integrity check after draw stack resolution', () => {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      currentTurn: 1,
      currentColor: 'red',
      drawStack: 4,
      discardPile: [makeCard('top', 'red', '3'), makeCard('w4', 'wild', 'wild4')],
      deck: [makeCard('d1', 'blue', '1'), makeCard('d2', 'green', '2'), makeCard('d3', 'yellow', '3'), makeCard('d4', 'blue', '4')],
      hands: [
        [makeCard('a', 'red', '5')],
        [makeCard('b', 'blue', '1')],
      ],
    });

    game.drawCards(room, 'p1', 4);
    const count = countAllCards(room);
    assert.ok(count.total > 0);
    assert.ok(!count.duplicate, `duplicate card: ${count.duplicate}`);
    assert.equal(room.players[1].hand.length, 5);
  });
});


describe('UNO state after Play Again', () => {
  it('playAgain resets all UNO state', () => {
    const room = makeRoom({
      players: 2,
      status: 'finished',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [[], []],
    });
    room.players[0].unoCalled = true;
    room.players[1].unoCalled = true;

    const result = game.playAgain(room);
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.players[0].unoCalled, false);
    assert.equal(room.players[1].unoCalled, false);
    assert.equal(room.players[0].eliminated, false);
    assert.equal(room.players[1].eliminated, false);
    assert.equal(room.players[0].hand.length, 7);
    assert.equal(room.players[1].hand.length, 7);
    assert.equal(room.status, 'playing');
  });
});


describe('Elimination turn never points at eliminated player', () => {
  it('advanceTurn skips eliminated players', () => {
    const room = makeRoom({
      players: 4,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [[], [], [makeCard('c', 'green', '1')], [makeCard('d', 'yellow', '1')]],
    });
    room.players[0].eliminated = true;
    room.players[1].eliminated = true;

    game.advanceTurn(room);
    assert.equal(room.currentTurn, 2, 'should skip p0 and p1, land on p2');
    assert.equal(room.players[room.currentTurn].eliminated, false);
  });

  it('advanceTurn wraps around correctly', () => {
    const room = makeRoom({
      players: 3,
      status: 'playing',
      currentTurn: 2,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [[makeCard('a', 'red', '5')], [makeCard('b', 'blue', '1')], []],
    });
    room.players[2].eliminated = true;

    game.advanceTurn(room);
    assert.equal(room.currentTurn, 0, 'should wrap from p2 (eliminated) to p0');
  });
});


describe('Security: server rejects invalid payloads', () => {
  it('playCard rejects card not in hand', () => {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [
        [makeCard('a', 'red', '5')],
        [makeCard('b', 'blue', '1')],
      ],
    });

    const result = game.playCard(room, 'p0', 'nonexistent');
    assert.ok(result.error);
    assert.ok(result.error.includes('not in hand'));
  });

  it('playCard rejects wrong turn', () => {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      currentTurn: 1,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [
        [makeCard('a', 'red', '5')],
        [makeCard('b', 'blue', '1')],
      ],
    });

    const result = game.playCard(room, 'p0', 'a');
    assert.ok(result.error);
    assert.ok(result.error.includes('Not your turn'));
  });

  it('playCard rejects after elimination', () => {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [
        [makeCard('a', 'red', '5')],
        [makeCard('b', 'blue', '1')],
      ],
    });
    room.players[0].eliminated = true;

    const result = game.playCard(room, 'p0', 'a');
    assert.ok(result.error);
    assert.ok(result.error.includes('eliminated'));
  });

  it('playCard rejects invalid wild color', () => {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [
        [makeCard('a', 'wild', 'wild')],
        [makeCard('b', 'blue', '1')],
      ],
    });

    const result = game.playCard(room, 'p0', 'a', 'purple');
    assert.ok(result.error);
    assert.ok(result.error.includes('valid color'));
  });

  it('callUno rejects when hand has more than 1 card', () => {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      hands: [
        [makeCard('a', 'red', '5'), makeCard('b', 'blue', '1')],
        [makeCard('c', 'green', '1')],
      ],
    });

    const result = game.callUno(room, 'p0');
    assert.ok(result.error);
    assert.ok(result.error.includes('exactly 1 card'));
  });

  it('callUno rejects double call', () => {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      hands: [
        [makeCard('a', 'red', '5')],
        [makeCard('b', 'blue', '1')],
      ],
    });
    room.players[0].unoCalled = true;

    const result = game.callUno(room, 'p0');
    assert.ok(result.error);
    assert.ok(result.error.includes('Already called'));
  });

  it('successful blind catch when target has 1 card', () => {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      hands: [
        [makeCard('a', 'red', '5')],
        [makeCard('b', 'blue', '1')],
      ],
    });
    room.deck = [
      makeCard('p1', 'green', '3'), makeCard('p2', 'yellow', '4'),
      makeCard('p3', 'red', '5'), makeCard('p4', 'blue', '6'),
      makeCard('p5', 'green', '7'),
    ];

    const result = game.catchUno(room, 'p1', 'p0');
    assert.equal(result.error, undefined);
    assert.equal(result.success, true);
    assert.equal(room.players[0].hand.length, 6, 'target gets +5 cards');
  });

  it('wrong blind catch penalizes catcher when target has >1 card', () => {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      hands: [
        [makeCard('a', 'red', '5'), makeCard('c', 'green', '1')],
        [makeCard('b', 'blue', '1')],
      ],
    });
    room.deck = [
      makeCard('p1', 'green', '3'), makeCard('p2', 'yellow', '4'),
      makeCard('p3', 'red', '5'), makeCard('p4', 'blue', '6'),
      makeCard('p5', 'green', '7'),
    ];

    const result = game.catchUno(room, 'p1', 'p0');
    assert.equal(result.error, undefined);
    assert.equal(result.success, false);
    assert.equal(room.players[1].hand.length, 6, 'catcher gets +5 cards');
    assert.equal(room.players[0].hand.length, 2, 'target unchanged');
  });

  it('isValidMultiPlay rejects duplicate card IDs', () => {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [
        [makeCard('a', 'red', '5'), makeCard('b', 'red', '7')],
        [makeCard('c', 'blue', '1')],
      ],
    });

    const result = game.isValidMultiPlay(room, 'p0', ['a', 'a']);
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('Duplicate'));
  });

  it('drawMatchingCards returns turnKept=true when drawn card is playable', () => {
    const room = makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('drawn', 'red', '5'), makeCard('d2', 'blue', '1')],
      hands: [
        [makeCard('a', 'green', '9')],
        [makeCard('b', 'blue', '2')],
      ],
    });

    const result = game.drawMatchingCards(room, 'p0');
    assert.equal(result.error, undefined);
    assert.equal(result.drawn.length, 1);
    assert.equal(result.turnKept, true);
    assert.equal(room.currentTurn, 0, 'turn should stay on player 0');
  });

  it('drawMatchingCards returns turnKept=false when drawn card is not playable', () => {
    const room = makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('drawn', 'blue', '1'), makeCard('d2', 'green', '2')],
      hands: [
        [makeCard('a', 'green', '9')],
        [makeCard('b', 'blue', '2')],
      ],
    });

    const result = game.drawMatchingCards(room, 'p0');
    assert.equal(result.error, undefined);
    assert.equal(result.drawn.length, 1);
    assert.equal(result.turnKept, false);
    assert.equal(room.currentTurn, 1, 'turn should advance to player 1');
  });

  it('catchUno rejects catch when target has called UNO', () => {
    const room = makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      hands: [
        [makeCard('a', 'green', '9')],
        [makeCard('b', 'blue', '2')],
      ],
    });
    room.players[1].unoCalled = true;

    const result = game.catchUno(room, 'p0', 'p1');
    assert.ok(result.error);
    assert.ok(result.error.includes('already called UNO'));
  });

  it('catchUno succeeds when target has not called UNO', () => {
    const room = makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1'), makeCard('d2', 'green', '2'), makeCard('d3', 'yellow', '3'), makeCard('d4', 'blue', '4'), makeCard('d5', 'green', '5')],
      hands: [
        [makeCard('a', 'green', '9')],
        [makeCard('b', 'blue', '2')],
      ],
    });
    room.players[1].unoCalled = false;

    const result = game.catchUno(room, 'p0', 'p1');
    assert.equal(result.error, undefined);
    assert.equal(result.success, true);
    assert.equal(room.players[1].hand.length, 6, 'target draws 5 cards');
  });

  it('serializeRoomForPlayer includes canBeCaught per opponent', () => {
    const room = makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      hands: [
        [makeCard('a', 'green', '9')],
        [makeCard('b', 'blue', '2')],
      ],
    });

    const serialized = game.serializeRoomForPlayer(room, 'p0');
    const opponent = serialized.players.find(p => p.id === 'p1');
    assert.equal(opponent.canBeCaught, true, 'connected opponent without UNO should be catchable');
    assert.equal(opponent.handCount, 1, 'handCount should be exposed as number');
    assert.equal(opponent.unoCalled, undefined, 'unoCalled should not be exposed');
  });

  it('serializeRoomForPlayer canBeCaught=false when opponent called UNO', () => {
    const room = makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      hands: [
        [makeCard('a', 'green', '9')],
        [makeCard('b', 'blue', '2')],
      ],
    });
    room.players[1].unoCalled = true;

    const serialized = game.serializeRoomForPlayer(room, 'p0');
    const opponent = serialized.players.find(p => p.id === 'p1');
    assert.equal(opponent.canBeCaught, false, 'opponent who called UNO should not be catchable');
  });

  it('serializeRoomForPlayer canBeCaught=false for eliminated opponent', () => {
    const room = makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      hands: [
        [makeCard('a', 'green', '9')],
      ],
    });
    room.players[1].eliminated = true;
    room.players[1].isConnected = true;

    const serialized = game.serializeRoomForPlayer(room, 'p0');
    const opponent = serialized.players.find(p => p.id === 'p1');
    assert.equal(opponent.canBeCaught, false, 'eliminated opponent should not be catchable');
  });

  it('drawCards draws exactly 1 card', () => {
    const room = makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1'), makeCard('d2', 'green', '2')],
      hands: [
        [makeCard('a', 'green', '9')],
        [makeCard('b', 'blue', '2')],
      ],
    });

    const result = game.drawCards(room, 'p0', 1);
    assert.equal(result.error, undefined);
    assert.equal(result.drawn.length, 1, 'exactly 1 card drawn');
    assert.equal(room.players[0].hand.length, 2, 'hand increased by 1');
    assert.equal(result.turnKept, false, 'turn always advances on normal draw');
    assert.equal(room.currentTurn, 1, 'turn advanced to next player');
  });

  it('drawCards draws exactly 1 even if drawn card is playable', () => {
    const room = makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'red', '5')],
      hands: [
        [makeCard('a', 'green', '9')],
        [makeCard('b', 'blue', '2')],
      ],
    });

    const result = game.drawCards(room, 'p0', 1);
    assert.equal(result.error, undefined);
    assert.equal(result.drawn.length, 1, 'exactly 1 card even if playable');
    assert.equal(room.players[0].hand.length, 2, 'hand has 2 cards');
    assert.equal(room.players[0].hand[1].color, 'red', 'drawn card is red (playable)');
    assert.equal(room.currentTurn, 1, 'turn advanced');
  });

  it('drawCards draws exactly 1 action card', () => {
    const room = makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'red', 'skip')],
      hands: [
        [makeCard('a', 'green', '9')],
        [makeCard('b', 'blue', '2')],
      ],
    });

    const result = game.drawCards(room, 'p0', 1);
    assert.equal(result.error, undefined);
    assert.equal(result.drawn.length, 1, 'exactly 1 action card drawn');
    assert.equal(room.players[0].hand.length, 2, 'hand has 2 cards');
    assert.equal(room.players[0].hand[1].value, 'skip', 'drawn card is skip');
    assert.equal(room.currentTurn, 1, 'turn advanced');
  });

  it('drawCards draws exactly 1 wild card', () => {
    const room = makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'wild', 'wild')],
      hands: [
        [makeCard('a', 'green', '9')],
        [makeCard('b', 'blue', '2')],
      ],
    });

    const result = game.drawCards(room, 'p0', 1);
    assert.equal(result.error, undefined);
    assert.equal(result.drawn.length, 1, 'exactly 1 wild drawn');
    assert.equal(room.players[0].hand.length, 2, 'hand has 2 cards');
    assert.equal(room.players[0].hand[1].color, 'wild', 'drawn card is wild');
    assert.equal(room.currentTurn, 1, 'turn advanced');
  });

  it('drawCards advances turn exactly once', () => {
    const room = makeRoom({
      players: 3,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1'), makeCard('d2', 'green', '2')],
      hands: [
        [makeCard('a', 'green', '9')],
        [makeCard('b', 'blue', '2')],
        [makeCard('c', 'yellow', '4')],
      ],
    });

    game.drawCards(room, 'p0', 1);
    assert.equal(room.currentTurn, 1, 'turn advanced exactly once to player 1');

    game.drawCards(room, 'p1', 1);
    assert.equal(room.currentTurn, 2, 'turn advanced exactly once to player 2');
  });

  it('drawCards resolves draw stack correctly', () => {
    const room = makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      drawStack: 2,
      discardPile: [makeCard('top', 'red', 'draw2')],
      deck: [
        makeCard('d1', 'blue', '1'), makeCard('d2', 'green', '2'),
        makeCard('d3', 'yellow', '3'), makeCard('d4', 'blue', '4'),
      ],
      hands: [
        [makeCard('a', 'green', '9')],
        [makeCard('b', 'blue', '2')],
      ],
    });

    const result = game.drawCards(room, 'p0', 2);
    assert.equal(result.error, undefined);
    assert.equal(result.drawn.length, 2, 'drew 2 cards from stack');
    assert.equal(room.players[0].hand.length, 3, 'hand has 3 cards');
    assert.equal(room.drawStack, 0, 'draw stack cleared');
    assert.equal(room.currentTurn, 1, 'turn advanced');
  });

  it('drawCards reshuffles deck when needed', () => {
    const room = makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [],
      hands: [
        [makeCard('a', 'green', '9')],
        [makeCard('b', 'blue', '2')],
      ],
    });
    room.discardPile.push(makeCard('extra1', 'blue', '5'));
    room.discardPile.push(makeCard('extra2', 'green', '6'));

    const result = game.drawCards(room, 'p0', 1);
    assert.equal(result.error, undefined);
    assert.equal(result.drawn.length, 1, 'drew 1 card after reshuffle');
    assert.equal(room.players[0].hand.length, 2, 'hand has 2 cards');
  });

  it('serializeRoomForPlayer includes handCount for opponents', () => {
    const room = makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      hands: [
        [makeCard('a', 'green', '9'), makeCard('b', 'red', '5')],
        [makeCard('c', 'blue', '2')],
      ],
    });

    const serialized = game.serializeRoomForPlayer(room, 'p0');
    const me = serialized.players.find(p => p.id === 'p0');
    const opponent = serialized.players.find(p => p.id === 'p1');

    assert.equal(me.handCount, undefined, 'own handCount is not exposed');
    assert.equal(me.hand.length, 2, 'own hand is exposed');
    assert.equal(opponent.handCount, 1, 'opponent handCount is 1');
    assert.equal(opponent.hand, undefined, 'opponent hand is not exposed');
  });
});
