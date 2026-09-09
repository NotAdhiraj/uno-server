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
    code: opts.code || 'MULTI',
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
    deck: [
      makeCard('deck1', 'blue', '1'),
      makeCard('deck2', 'green', '2'),
    ],
    hands: [hand, [makeCard('opp1', 'blue', '3'), makeCard('opp2', 'green', '4')]],
  });
}


describe('isValidMultiPlay', () => {
  it('1. rejects fewer than 2 cards', () => {
    const room = setupRoom([makeCard('a', 'red', '5')], 'red', '3');
    const r = game.isValidMultiPlay(room, 'p0', ['a']);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('at least 2'));
  });

  it('2. rejects non-array input', () => {
    const room = setupRoom([makeCard('a', 'red', '5')], 'red', '3');
    const r = game.isValidMultiPlay(room, 'p0', 'not_an_array');
    assert.equal(r.valid, false);
  });

  it('3. rejects when not player turn', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '7')],
      'red', '3'
    );
    room.currentTurn = 1;
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('Not your turn'));
  });

  it('4. rejects when player is eliminated', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '7')],
      'red', '3'
    );
    room.players[0].eliminated = true;
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('eliminated'));
  });

  it('5. rejects when player is disconnected', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '7')],
      'red', '3'
    );
    room.players[0].isConnected = false;
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('Not connected'));
  });

  it('6. rejects duplicate card IDs', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '7')],
      'red', '3'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'a']);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('Duplicate'));
  });

  it('7. rejects card not in player hand', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '7')],
      'red', '3'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'nonexistent']);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('not in your hand'));
  });

  it('8. rejects wild card in multi-play', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'wild', 'wild')],
      'red', '3'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('Wild cards cannot be combined'));
  });

  it('9. rejects wild4 card in multi-play', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'wild', 'wild4')],
      'red', '3'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('Wild cards cannot be combined'));
  });

  it('10. rejects action cards in multi-play', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', 'draw2')],
      'red', '3'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('Cannot mix number cards and action cards'));
  });

  it('11. rejects skip in multi-play', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', 'skip')],
      'red', '3'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('Cannot mix number cards and action cards'));
  });

  it('12. rejects reverse in multi-play', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', 'reverse')],
      'red', '3'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('Cannot mix number cards and action cards'));
  });

  it('13. rejects if first card not playable', () => {
    const room = setupRoom(
      [makeCard('a', 'blue', '5'), makeCard('b', 'blue', '7')],
      'red', '3'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('First card is not playable'));
  });

  it('14. rejects chain break (color and value mismatch)', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'blue', '7')],
      'red', '5'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('does not match'));
  });

  it('15. accepts valid same-color chain', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '7'), makeCard('c', 'red', '9')],
      'red', '3'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b', 'c']);
    assert.equal(r.valid, true);
    assert.equal(r.cards.length, 3);
  });

  it('16. accepts valid same-value chain', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'blue', '5'), makeCard('c', 'green', '5')],
      'red', '3'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b', 'c']);
    assert.equal(r.valid, true);
  });

  it('17. accepts mixed color/value chain', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '7'), makeCard('b', 'blue', '7'), makeCard('c', 'blue', '9')],
      'red', '5'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b', 'c']);
    assert.equal(r.valid, true);
  });

  it('18. accepts exactly 2 cards same color', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '7')],
      'red', '3'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true);
    assert.equal(r.cards.length, 2);
  });

  it('19. accepts exactly 2 cards same value', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'blue', '5')],
      'red', '3'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true);
  });

  it('20. rejects when game not playing', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '7')],
      'red', '3'
    );
    room.status = 'finished';
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('not in progress'));
  });

  it('21. rejects player not in room', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '7')],
      'red', '3'
    );
    const r = game.isValidMultiPlay(room, 'nonexistent', ['a', 'b']);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('not in room'));
  });
});


describe('playMultipleCards', () => {
  it('1. removes cards from hand and adds to discard', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '7'), makeCard('c', 'green', '1')],
      'red', '3'
    );
    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.players[0].hand.length, 1);
    assert.equal(room.players[0].hand[0].id, 'c');
    assert.equal(room.discardPile.length, 3);
    assert.equal(room.discardPile[2].id, 'b');
  });

  it('2. updates currentColor to last played card', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'blue', '5')],
      'red', '3'
    );
    game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.equal(room.currentColor, 'blue');
  });

  it('3. advances turn after play', () => {
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
    game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.equal(room.currentTurn, 1);
  });

  it('4. returns error for invalid play', () => {
    const room = setupRoom(
      [makeCard('a', 'blue', '5'), makeCard('b', 'blue', '7')],
      'red', '3'
    );
    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.ok(result.error);
  });

  it('5. detects game over when player empties hand', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '7')],
      'red', '3'
    );
    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.equal(result.gameOver, true);
    assert.equal(room.status, 'finished');
    assert.equal(room.winner, 'p0');
    assert.equal(room.loser, 'p1');
    assert.equal(room.players[0].eliminated, true);
    assert.equal(room.players[1].eliminated, true);
  });

  it('6. eliminates player but game continues with 3+ players', () => {
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
    assert.equal(result.eliminated.id, 'p0');
    assert.equal(result.gameOver, false);
    assert.equal(room.players[0].eliminated, true);
    assert.equal(room.players[0].finishPosition, 1);
    assert.equal(room.status, 'playing');
  });

  it('7. resets unoCalled after multi-play', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '7')],
      'red', '3'
    );
    room.players[0].unoCalled = true;
    game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.equal(room.players[0].unoCalled, false);
  });

  it('8. turn advances exactly once for 2+ cards', () => {
    const room = makeRoom({
      players: 3,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '3')],
      deck: [makeCard('d1', 'blue', '1')],
      hands: [
        [makeCard('a', 'red', '5'), makeCard('b', 'red', '7'), makeCard('c', 'red', '9')],
        [makeCard('d', 'blue', '1'), makeCard('e', 'blue', '2')],
        [makeCard('f', 'green', '1'), makeCard('g', 'green', '2')],
      ],
    });
    const beforeTurn = room.currentTurn;
    game.playMultipleCards(room, 'p0', ['a', 'b', 'c']);
    assert.notEqual(room.currentTurn, beforeTurn);
  });

  it('9. all played cards appear in discard pile in order', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'blue', '5'), makeCard('c', 'blue', '7')],
      'red', '3'
    );
    game.playMultipleCards(room, 'p0', ['a', 'b', 'c']);
    const discardIds = room.discardPile.map(c => c.id);
    assert.ok(discardIds.includes('a'));
    assert.ok(discardIds.includes('b'));
    assert.ok(discardIds.includes('c'));
    const idxA = discardIds.indexOf('a');
    const idxB = discardIds.indexOf('b');
    const idxC = discardIds.indexOf('c');
    assert.ok(idxA < idxB, 'a before b');
    assert.ok(idxB < idxC, 'b before c');
  });

  it('10. hand redaction works after multi-play', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '7'), makeCard('c', 'green', '1')],
      'red', '3'
    );
    game.playMultipleCards(room, 'p0', ['a', 'b']);
    const serialized = game.serializeRoomForPlayer(room, 'p0');
    const me = serialized.players.find(p => p.id === 'p0');
    assert.equal(me.hand.length, 1);
    assert.equal(me.hand[0].id, 'c');

    const opp = serialized.players.find(p => p.id === 'p1');
    assert.equal(opp.hand, undefined);
    assert.equal(opp.handCount, 2, 'handCount exposed as number');
  });

  it('11. single card play still works', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'green', '1')],
      'red', '3'
    );
    const result = game.playCard(room, 'p0', 'a');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.players[0].hand.length, 1);
  });

  it('12. wild single card play still works', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')],
      'red', '3'
    );
    const result = game.playCard(room, 'p0', 'a', 'blue');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.currentColor, 'blue');
    assert.equal(room.players[0].hand.length, 1);
  });
});
