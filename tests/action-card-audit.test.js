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
    drawStackType: opts.drawStackType || null,
    winner: opts.winner ?? null,
    loser: opts.loser ?? null,
    finishOrder: opts.finishOrder ?? [],
  };
}

function setupRoom(hand, discardColor, discardValue, opts = {}) {
  return makeRoom({
    players: opts.players || 2,
    status: 'playing',
    currentTurn: 0,
    currentColor: discardColor,
    discardPile: [makeCard('top', discardColor, discardValue)],
    deck: [makeCard('d1', 'blue', '1'), makeCard('d2', 'green', '2')],
    hands: [hand, opts.oppHand || [makeCard('opp1', 'blue', '3'), makeCard('opp2', 'green', '4')]],
    ...opts,
  });
}

// ============================================================
// 1. SKIP — SINGLE CARD
// ============================================================
describe('SKIP — Single Card', () => {
  it('Red Skip against Red 5: valid by color', () => {
    const room = setupRoom([makeCard('a', 'red', 'skip')], 'red', '5');
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), true);
  });

  it('Blue Skip against Blue Skip: valid by value/type', () => {
    const room = setupRoom([makeCard('a', 'blue', 'skip')], 'blue', 'skip');
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), true);
  });

  it('Green Skip against Red 5: invalid (green ≠ red, skip ≠ 5)', () => {
    const room = setupRoom([makeCard('a', 'green', 'skip')], 'red', '5');
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), false);
  });

  it('playCard: Red Skip against Red 5 advances skip correctly', () => {
    const room = setupRoom(
      [makeCard('a', 'red', 'skip'), makeCard('b', 'green', '1')],
      'red', '5', { players: 3, hands: [
        [makeCard('a', 'red', 'skip'), makeCard('b', 'green', '1')],
        [makeCard('c', 'blue', '2'), makeCard('d', 'blue', '3')],
        [makeCard('e', 'green', '5'), makeCard('f', 'green', '6')],
      ]}
    );
    const result = game.playCard(room, 'p0', 'a');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.currentTurn, 2, 'skip should skip player 1, land on player 2');
  });
});

// ============================================================
// 2. REVERSE — SINGLE CARD
// ============================================================
describe('REVERSE — Single Card', () => {
  it('Red Reverse against Red 5: valid by color', () => {
    const room = setupRoom([makeCard('a', 'red', 'reverse')], 'red', '5');
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), true);
  });

  it('Blue Reverse against Blue Reverse: valid by value/type', () => {
    const room = setupRoom([makeCard('a', 'blue', 'reverse')], 'blue', 'reverse');
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), true);
  });

  it('3-player: Red Reverse against Red 5 reverses direction', () => {
    const room = setupRoom(
      [makeCard('a', 'red', 'reverse'), makeCard('b', 'green', '1')],
      'red', '5', { players: 3, direction: 1, hands: [
        [makeCard('a', 'red', 'reverse'), makeCard('b', 'green', '1')],
        [makeCard('c', 'blue', '2')],
        [makeCard('e', 'green', '5')],
      ]}
    );
    game.playCard(room, 'p0', 'a');
    assert.equal(room.direction, -1, 'direction should flip');
    assert.equal(room.currentTurn, 2, 'reverse in 3p goes backward');
  });

  it('2-player: Red Reverse against Red 5 = skip (same player goes again)', () => {
    const room = setupRoom(
      [makeCard('a', 'red', 'reverse'), makeCard('b', 'green', '1')],
      'red', '5'
    );
    game.playCard(room, 'p0', 'a');
    assert.equal(room.currentTurn, 0, '2-player reverse = skip, same player');
  });
});

// ============================================================
// 3. DRAW 2 — SINGLE CARD (no active stack)
// ============================================================
describe('DRAW2 — Single Card (no active stack)', () => {
  it('Red Draw2 against Red 5: valid by color', () => {
    const room = setupRoom([makeCard('a', 'red', 'draw2')], 'red', '5');
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), true);
  });

  it('Blue Draw2 against Blue Draw2: valid by value/type', () => {
    const room = setupRoom([makeCard('a', 'blue', 'draw2')], 'blue', 'draw2');
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), true);
  });

  it('Green Draw2 against Red 5: invalid', () => {
    const room = setupRoom([makeCard('a', 'green', 'draw2')], 'red', '5');
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), false);
  });

  it('playCard: Red Draw2 against Red 5 sets drawStack=2', () => {
    const room = setupRoom(
      [makeCard('a', 'red', 'draw2'), makeCard('b', 'green', '1')],
      'red', '5'
    );
    game.playCard(room, 'p0', 'a');
    assert.equal(room.drawStack, 2);
    assert.equal(room.drawStackType, 'draw2');
  });
});

// ============================================================
// 4. DRAW STACK BEHAVIOR
// ============================================================
describe('DRAW STACK — Active Draw2', () => {
  it('Draw2 against active Draw2: allowed', () => {
    const room = setupRoom(
      [makeCard('a', 'blue', 'draw2'), makeCard('b', 'red', '1')],
      'red', '5', { drawStack: 2, drawStackType: 'draw2' }
    );
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), true);
  });

  it('Wild4 against active Draw2: allowed', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild4'), makeCard('b', 'red', '1')],
      'red', '5', { drawStack: 2, drawStackType: 'draw2' }
    );
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), true);
  });

  it('Number card against active Draw2: rejected', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'blue', '1')],
      'red', '5', { drawStack: 2, drawStackType: 'draw2' }
    );
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), false);
  });

  it('Skip against active Draw2: rejected', () => {
    const room = setupRoom(
      [makeCard('a', 'red', 'skip'), makeCard('b', 'blue', '1')],
      'red', '5', { drawStack: 2, drawStackType: 'draw2' }
    );
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), false);
  });
});

describe('DRAW STACK — Active Wild4', () => {
  it('Wild4 against active Wild4: allowed', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild4'), makeCard('b', 'red', '1')],
      'red', '5', { drawStack: 4, drawStackType: 'wild4' }
    );
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), true);
  });

  it('Draw2 against active Wild4: rejected', () => {
    const room = setupRoom(
      [makeCard('a', 'red', 'draw2'), makeCard('b', 'blue', '1')],
      'red', '5', { drawStack: 4, drawStackType: 'wild4' }
    );
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), false);
  });

  it('Number card against active Wild4: rejected', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'blue', '1')],
      'red', '5', { drawStack: 4, drawStackType: 'wild4' }
    );
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), false);
  });
});

// ============================================================
// 5. WILD / COLOR CHANGE — SINGLE CARD
// ============================================================
describe('WILD — Single Card', () => {
  it('Wild against Red 1: always valid', () => {
    const room = setupRoom([makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')], 'red', '1');
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), true);
  });

  it('Wild against Blue Skip: always valid', () => {
    const room = setupRoom([makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')], 'blue', 'skip');
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), true);
  });

  it('playCard: Wild → Red sets currentColor to red', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    const result = game.playCard(room, 'p0', 'a', 'red');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.currentColor, 'red');
  });

  it('playCard: Wild → Green sets currentColor to green', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    const result = game.playCard(room, 'p0', 'a', 'green');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.currentColor, 'green');
  });

  it('playCard: Wild → Blue sets currentColor to blue', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    const result = game.playCard(room, 'p0', 'a', 'blue');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.currentColor, 'blue');
  });

  it('playCard: Wild → Yellow sets currentColor to yellow', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    const result = game.playCard(room, 'p0', 'a', 'yellow');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.currentColor, 'yellow');
  });

  it('playCard: Wild with invalid color rejected', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    const result = game.playCard(room, 'p0', 'a', 'purple');
    assert.ok(result.error);
  });

  it('playCard: Wild advances turn', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    game.playCard(room, 'p0', 'a', 'red');
    assert.equal(room.currentTurn, 1);
  });

  it('playCard: Wild as last card is rejected (Wild is a power card)', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild')],
      'red', '1'
    );
    const result = game.playCard(room, 'p0', 'a', 'blue');
    assert.ok(result.error, 'Wild should be rejected as final card');
    assert.ok(result.error.includes('final card'));
  });
});

// ============================================================
// 6. WILD4 — SINGLE CARD
// ============================================================
describe('WILD4 — Single Card', () => {
  it('Wild4 against Red 1: always valid', () => {
    const room = setupRoom([makeCard('a', 'wild', 'wild4'), makeCard('b', 'green', '1')], 'red', '1');
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), true);
  });

  it('playCard: Wild4 → Red sets currentColor to red and adds 4 to drawStack', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild4'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    const result = game.playCard(room, 'p0', 'a', 'red');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.currentColor, 'red');
    assert.equal(room.drawStack, 4);
    assert.equal(room.drawStackType, 'wild4');
  });

  it('playCard: Wild4 advances turn', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild4'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    game.playCard(room, 'p0', 'a', 'green');
    assert.equal(room.currentTurn, 1);
  });
});

// ============================================================
// 7. MULTI-CARD ACTION BATCHES
// ============================================================
describe('MULTI-CARD — Action Card Batches', () => {
  it('Red Skip + Blue Skip (value batch): valid', () => {
    const room = setupRoom(
      [makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip')],
      'red', '5'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true, r.error);
  });

  it('Red Reverse + Blue Reverse (value batch): valid', () => {
    const room = setupRoom(
      [makeCard('a', 'red', 'reverse'), makeCard('b', 'blue', 'reverse')],
      'red', '5'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true, r.error);
  });

  it('Red Draw2 + Blue Draw2 (value batch): valid', () => {
    const room = setupRoom(
      [makeCard('a', 'red', 'draw2'), makeCard('b', 'blue', 'draw2')],
      'red', '5'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true, r.error);
  });

  it('Skip + Reverse: invalid (mixed action types)', () => {
    const room = setupRoom(
      [makeCard('a', 'red', 'skip'), makeCard('b', 'red', 'reverse')],
      'red', '5'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
  });

  it('Skip + Draw2: invalid (mixed action types)', () => {
    const room = setupRoom(
      [makeCard('a', 'red', 'skip'), makeCard('b', 'red', 'draw2')],
      'red', '5'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
  });

  it('Number + Action: invalid (mixed card types)', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', 'skip')],
      'red', '5'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
  });

  it('Wild in multi-play: rejected', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'wild', 'wild')],
      'red', '5'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
  });

  it('Wild4 in multi-play: rejected', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild4'), makeCard('b', 'wild', 'wild4')],
      'red', '5'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
  });
});

// ============================================================
// 8. REGRESSION: Number card batches still work
// ============================================================
describe('REGRESSION — Number Card Batches', () => {
  it('Red 9 + Green 9 (value batch, top Red 1): valid', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '9'), makeCard('b', 'green', '9')],
      'red', '1'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true, r.error);
  });

  it('Red 5 + Red 9 (color batch, top Red 1): valid', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '5'), makeCard('b', 'red', '9')],
      'red', '1'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true, r.error);
  });

  it('Red 9 + Green 5 (mixed, top Red 1): invalid', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '9'), makeCard('b', 'green', '5')],
      'red', '1'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
  });
});

// ============================================================
// 9. FINAL CARD RESTRICTION
// ============================================================
describe('FINAL CARD — Power Card Restriction', () => {
  it('Skip as last card: rejected', () => {
    const room = setupRoom(
      [makeCard('a', 'red', 'skip')],
      'red', '5'
    );
    const result = game.playCard(room, 'p0', 'a');
    assert.ok(result.error.includes('final card'));
  });

  it('Reverse as last card: rejected', () => {
    const room = setupRoom(
      [makeCard('a', 'red', 'reverse')],
      'red', '5'
    );
    const result = game.playCard(room, 'p0', 'a');
    assert.ok(result.error.includes('final card'));
  });

  it('Draw2 as last card: rejected', () => {
    const room = setupRoom(
      [makeCard('a', 'red', 'draw2')],
      'red', '5'
    );
    const result = game.playCard(room, 'p0', 'a');
    assert.ok(result.error.includes('final card'));
  });

  it('Wild as last card: rejected (Wild is a power card)', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild')],
      'red', '5'
    );
    const result = game.playCard(room, 'p0', 'a', 'blue');
    assert.ok(result.error.includes('final card'));
  });

  it('Wild4 as last card: rejected', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild4')],
      'red', '5'
    );
    const result = game.playCard(room, 'p0', 'a', 'blue');
    assert.ok(result.error.includes('final card'));
  });

  it('Multi-card all-power final: rejected', () => {
    const room = setupRoom(
      [makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip')],
      'red', '5'
    );
    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.ok(result.error, 'should reject all-power hand');
  });
});

// ============================================================
// 10. WILD IN MULTI-CARD (must stay rejected)
// ============================================================
describe('WILD — Must NOT Join Multi-Card Batches', () => {
  it('Wild + number card: rejected', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'red', '5')],
      'red', '5'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
  });

  it('Wild + Skip: rejected', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'red', 'skip')],
      'red', '5'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
  });

  it('Wild4 + number card: rejected', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild4'), makeCard('b', 'red', '5')],
      'red', '5'
    );
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
  });
});

// ============================================================
// 11. ATOMIC REJECTION — zero state mutation
// ============================================================
describe('ATOMIC REJECTION — Invalid Batch', () => {
  it('invalid batch: hand unchanged, discard unchanged, turn unchanged', () => {
    const room = setupRoom(
      [makeCard('a', 'red', '9'), makeCard('b', 'green', '5'), makeCard('c', 'blue', '3')],
      'red', '1'
    );
    const handBefore = room.players[0].hand.map(c => c.id).join(',');
    const discardLen = room.discardPile.length;
    const turnBefore = room.currentTurn;
    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.ok(result.error);
    assert.equal(room.players[0].hand.map(c => c.id).join(','), handBefore);
    assert.equal(room.discardPile.length, discardLen);
    assert.equal(room.currentTurn, turnBefore);
  });
});

// ============================================================
// 12. WILD REGRESSION — Full lifecycle
// ============================================================
describe('WILD REGRESSION — Full Lifecycle', () => {
  it('Wild can be played as single card against any top', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), true);
  });

  it('Wild4 can be played as single card against any top', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild4'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    assert.equal(game.isValidPlay(room, 'p0', room.players[0].hand[0]), true);
  });

  it('Wild → Red: currentColor changes to red, turn advances', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    const result = game.playCard(room, 'p0', 'a', 'red');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.currentColor, 'red');
    assert.equal(room.currentTurn, 1);
  });

  it('Wild → Green: currentColor changes to green, turn advances', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    const result = game.playCard(room, 'p0', 'a', 'green');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.currentColor, 'green');
    assert.equal(room.currentTurn, 1);
  });

  it('Wild → Blue: currentColor changes to blue, turn advances', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    const result = game.playCard(room, 'p0', 'a', 'blue');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.currentColor, 'blue');
    assert.equal(room.currentTurn, 1);
  });

  it('Wild → Yellow: currentColor changes to yellow, turn advances', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    const result = game.playCard(room, 'p0', 'a', 'yellow');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.currentColor, 'yellow');
    assert.equal(room.currentTurn, 1);
  });

  it('Wild: hand shrinks by 1, card added to discard', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    game.playCard(room, 'p0', 'a', 'blue');
    assert.equal(room.players[0].hand.length, 1);
    assert.equal(room.players[0].hand[0].id, 'b');
    assert.equal(room.discardPile.length, 2);
    assert.equal(room.discardPile[1].id, 'a');
  });

  it('Wild4: sets drawStack=4 and currentColor', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild4'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    const result = game.playCard(room, 'p0', 'a', 'yellow');
    assert.ok(!result.error, JSON.stringify(result));
    assert.equal(room.currentColor, 'yellow');
    assert.equal(room.drawStack, 4);
    assert.equal(room.drawStackType, 'wild4');
  });

  it('Wild: next player can only play against chosen color', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')],
      'red', '1', { hands: [
        [makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')],
        [makeCard('c', 'red', '3'), makeCard('d', 'blue', '5')],
      ]}
    );
    game.playCard(room, 'p0', 'a', 'green');
    // Player 1 has red 3 and blue 5. currentColor is now green, top is Wild (value 'wild')
    // Red 3: red ≠ green, '3' ≠ 'wild' → NOT playable
    // Blue 5: blue ≠ green, '5' ≠ 'wild' → NOT playable
    const p1Hand = room.players[1].hand;
    assert.equal(game.isValidPlay(room, 'p1', p1Hand[0]), false, 'red 3 not playable against green');
    assert.equal(game.isValidPlay(room, 'p1', p1Hand[1]), false, 'blue 5 not playable against green');
  });

  it('Wild: invalid color rejected', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    const result = game.playCard(room, 'p0', 'a', 'purple');
    assert.ok(result.error);
  });

  it('Wild: unoCalled reset after play', () => {
    const room = setupRoom(
      [makeCard('a', 'wild', 'wild'), makeCard('b', 'green', '1')],
      'red', '1'
    );
    room.players[0].unoCalled = true;
    game.playCard(room, 'p0', 'a', 'blue');
    assert.equal(room.players[0].unoCalled, false);
  });
});
