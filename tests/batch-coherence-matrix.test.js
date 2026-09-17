const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const game = require('../game');

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
    code: opts.code || 'TEST',
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

function setupRoom(hand, discardColor, discardValue) {
  return makeRoom({
    players: 2,
    status: 'playing',
    currentTurn: 0,
    currentColor: discardColor,
    discardPile: [makeCard('top', discardColor, discardValue)],
    deck: [makeCard('d1', 'blue', '1'), makeCard('d2', 'green', '2')],
    hands: [hand, [makeCard('opp1', 'blue', '3'), makeCard('opp2', 'green', '4')]],
  });
}

describe('CRITICAL BUG: Red 9 + Green 9 against Red 1', () => {
  it('backend accepts Red 9 + Green 9 as valid VALUE BATCH (top=Red 1)', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '9'), makeCard('b', 'green', '9')],
      'red', '1'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    console.log('Red 9 + Green 9 result:', JSON.stringify(r));
    assert.equal(r.valid, true, `Expected valid, got error: ${r.error}`);
  });

  it('backend accepts Green 9 + Red 9 (reversed order) as valid', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '9'), makeCard('b', 'green', '9')],
      'red', '1'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['b', 'a']);
    console.log('Green 9 + Red 9 result:', JSON.stringify(r));
    assert.equal(r.valid, true, `Expected valid, got error: ${r.error}`);
  });

  it('backend accepts Red 9 + Green 9 + Blue 9 as valid VALUE BATCH', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '9'), makeCard('b', 'green', '9'), makeCard('c', 'blue', '9')],
      'red', '1'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b', 'c']);
    console.log('Red 9 + Green 9 + Blue 9 result:', JSON.stringify(r));
    assert.equal(r.valid, true, `Expected valid, got error: ${r.error}`);
  });
});

describe('COLOR BATCH tests (top=Red 1)', () => {
  it('Red 5 + Red 9 = valid COLOR BATCH', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '9')],
      'red', '1'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true);
  });

  it('Red 2 + Red 6 + Red 9 = valid COLOR BATCH', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '2'), makeCard('b', 'red', '6'), makeCard('c', 'red', '9')],
      'red', '1'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b', 'c']);
    assert.equal(r.valid, true);
  });

  it('Red 5 + Red 9 + Blue 9 = INVALID (mixed basis)', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '9'), makeCard('c', 'blue', '9')],
      'red', '1'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b', 'c']);
    assert.equal(r.valid, false);
  });
});

describe('VALUE BATCH tests (top=Red 1)', () => {
  it('Red 1 + Green 1 = valid VALUE BATCH', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '1'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true);
  });

  it('Red 9 + Green 9 + Blue 9 + Yellow 9 = valid VALUE BATCH', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '9'), makeCard('b', 'green', '9'), makeCard('c', 'blue', '9'), makeCard('d', 'yellow', '9')],
      'red', '1'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b', 'c', 'd']);
    assert.equal(r.valid, true);
  });
});

describe('MIXED INVALID batches (top=Red 1)', () => {
  it('Red 9 + Green 5 = INVALID (no common basis)', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '9'), makeCard('b', 'green', '5')],
      'red', '1'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
  });

  it('Red 9 + Green 9 + Red 5 = INVALID (mixed basis)', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '9'), makeCard('b', 'green', '9'), makeCard('c', 'red', '5')],
      'red', '1'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b', 'c']);
    assert.equal(r.valid, false);
  });

  it('Green 1 + Red 9 = INVALID (Green 1 playable by value, Red 9 playable by color, no common basis)', () => {
    const room = setupRoom(
      [makeCard('a', 'green', '1'), makeCard('b', 'red', '9')],
      'red', '1'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
  });

  it('Red 5 + Blue 5 + Red 9 = INVALID (mixed basis)', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'blue', '5'), makeCard('c', 'red', '9')],
      'red', '1'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b', 'c']);
    assert.equal(r.valid, false);
  });
});

describe('INDIVIDUAL PLAYABILITY (top=Red 1)', () => {
  it('Red 9 is individually playable (by color)', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '9'), makeCard('b', 'green', '9')],
      'red', '1'
    );
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), true);
  });

  it('Green 1 is individually playable (by value)', () => {
    const room = setupRoom(
      [makeCard('a', 'green', '1'), makeCard('b', 'red', '9')],
      'red', '1'
    );
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), true);
  });

  it('Green 9 is NOT individually playable against Red 1', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '9'), makeCard('b', 'green', '9')],
      'red', '1'
    );
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[1]), false);
  });

  it('Blue 5 is NOT individually playable against Red 1', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '9'), makeCard('b', 'blue', '5')],
      'red', '1'
    );
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[1]), false);
  });
});

describe('ORDER INDEPENDENCE', () => {
  it('Red 9 -> Green 9 same result as Green 9 -> Red 9', () => {
    const room1 = setupRoom(
      [makeCard('a', 'red', '9'), makeCard('b', 'green', '9')],
      'red', '1'
    );
    const r1 = game.isValidMultiPlay(room1, 'p0', ['a', 'b']);

    const room2 = setupRoom(
      [makeCard('a', 'red', '9'), makeCard('b', 'green', '9')],
      'red', '1'
    );
    const r2 = game.isValidMultiPlay(room2, 'p0', ['b', 'a']);

    assert.equal(r1.valid, r2.valid, 'order should not matter');
  });

  it('Red 5 -> Red 9 same result as Red 9 -> Red 5', () => {
    const room1 = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '9')],
      'red', '1'
    );
    const r1 = game.isValidMultiPlay(room1, 'p0', ['a', 'b']);

    const room2 = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '9')],
      'red', '1'
    );
    const r2 = game.isValidMultiPlay(room2, 'p0', ['b', 'a']);

    assert.equal(r1.valid, r2.valid, 'order should not matter');
  });
});

describe('playMultipleCards atomic execution', () => {
  it('Red 9 + Green 9: removes both from hand, adds to discard', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '9'), makeCard('b', 'green', '9'), makeCard('c', 'blue', '3')],
      'red', '1'
    );
    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.players[0].hand.length, 1);
    assert.equal(room.players[0].hand[0].id, 'c');
    assert.equal(room.discardPile.length, 3);
  });

  it('invalid batch: zero state mutation', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '9'), makeCard('b', 'green', '5'), makeCard('c', 'blue', '3')],
      'red', '1'
    );
    const handBefore = room.players[0].hand.map(c => c.id).join(',');
    const discardBefore = room.discardPile.length;
    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.ok(result.error);
    assert.equal(room.players[0].hand.map(c => c.id).join(','), handBefore);
    assert.equal(room.discardPile.length, discardBefore);
  });
});
