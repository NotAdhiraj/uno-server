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
    code: opts.code || 'CHAIN',
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
    drawStackType: opts.drawStackType ?? null,
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

// ============================================================
// TEST GROUP 1 — ORIGINAL TOP CARD (Blue 5)
// ============================================================

describe('CHAIN BUG FIX — TEST GROUP 1: Original top card validation (Blue 5)', () => {
  it('Blue 2 + Blue 7 → VALID (both match BLUE)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'blue', '2'), makeCard('b', 'blue', '7')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true);
  });

  it('Blue 2 + Blue 9 → VALID (both match BLUE)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'blue', '2'), makeCard('b', 'blue', '9')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true);
  });

  it('Red 5 + Green 5 → VALID (both match VALUE 5)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'green', '5')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true);
  });

  it('Yellow 5 + Green 5 → VALID (both match VALUE 5)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'yellow', '5'), makeCard('b', 'green', '5')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true);
  });
});

// ============================================================
// TEST GROUP 2 — CHAINING BUG (THE BUG WE ARE FIXING)
// ============================================================

describe('CHAIN BUG FIX — TEST GROUP 2: Chain validation bug must NOT happen', () => {
  it('Red 5 + Red 7 → INVALID (Red 7 does not match Blue 5)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '7')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
  });

  it('Red 5 + Red 8 → INVALID (Red 8 does not match Blue 5)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '8')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
  });

  it('Red 5 + Red 9 → INVALID (Red 9 does not match Blue 5)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '9')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
  });

  it('Green 5 + Green 8 → INVALID (Green 8 does not match Blue 5)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'green', '5'), makeCard('b', 'green', '8')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
  });

  it('Yellow 5 + Yellow 2 → INVALID (Yellow 2 does not match Blue 5)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'yellow', '5'), makeCard('b', 'yellow', '2')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
  });

  it('Red 5 + Red 7 + Red 9 → INVALID (Red 7 and Red 9 do not match Blue 5)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '7'), makeCard('c', 'red', '9')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b', 'c']);
    assert.equal(r.valid, false);
  });
});

// ============================================================
// TEST GROUP 3 — 10 RED CARDS CASE
// ============================================================

describe('CHAIN BUG FIX — TEST GROUP 3: 10 red cards against Blue 5', () => {
  function tenRedCards() {
    return [
      makeCard('r0', 'red', '0'),
      makeCard('r1', 'red', '1'),
      makeCard('r2', 'red', '2'),
      makeCard('r3', 'red', '3'),
      makeCard('r4', 'red', '4'),
      makeCard('r5', 'red', '5'),
      makeCard('r6', 'red', '6'),
      makeCard('r7', 'red', '7'),
      makeCard('r8', 'red', '8'),
      makeCard('r9', 'red', '9'),
    ];
  }

  it('Red 5 alone → VALID', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [tenRedCards(), []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['r5']);
    assert.equal(r.valid, false); // needs at least 2 cards
  });

  it('Red 5 + Red 7 → INVALID', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [tenRedCards(), []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['r5', 'r7']);
    assert.equal(r.valid, false);
  });

  it('Red 5 + Red 8 → INVALID', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [tenRedCards(), []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['r5', 'r8']);
    assert.equal(r.valid, false);
  });

  it('Red 5 + Red 9 → INVALID', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [tenRedCards(), []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['r5', 'r9']);
    assert.equal(r.valid, false);
  });

  it('Red 0 + Red 1 → INVALID (neither matches Blue 5)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [tenRedCards(), []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['r0', 'r1']);
    assert.equal(r.valid, false);
  });

  it('Red 1 + Red 2 → INVALID (neither matches Blue 5)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [tenRedCards(), []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['r1', 'r2']);
    assert.equal(r.valid, false);
  });

  it('Red 5 + Red 7 + Red 9 → INVALID', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [tenRedCards(), []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['r5', 'r7', 'r9']);
    assert.equal(r.valid, false);
  });

  it('All 10 red cards → INVALID', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [tenRedCards(), []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9']);
    assert.equal(r.valid, false);
  });
});

// ============================================================
// TEST GROUP 4 — SAME COLOR (all independently valid against Blue 5)
// ============================================================

describe('CHAIN BUG FIX — TEST GROUP 4: Same color, all independently valid', () => {
  it('Blue 1 + Blue 7 → VALID (both match BLUE)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'blue', '1'), makeCard('b', 'blue', '7')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true);
  });

  it('Blue 2 + Blue 8 → VALID (both match BLUE)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'blue', '2'), makeCard('b', 'blue', '8')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true);
  });

  it('Blue 3 + Blue 4 + Blue 6 + Blue 9 → VALID (all match BLUE)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'blue', '3'), makeCard('b', 'blue', '4'), makeCard('c', 'blue', '6'), makeCard('d', 'blue', '9')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b', 'c', 'd']);
    assert.equal(r.valid, true);
  });
});

// ============================================================
// TEST GROUP 5 — SAME VALUE (all independently valid against Blue 5)
// ============================================================

describe('CHAIN BUG FIX — TEST GROUP 5: Same value, all independently valid', () => {
  it('Red 5 + Green 5 → VALID (both match VALUE 5)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'green', '5')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true);
  });

  it('Red 5 + Yellow 5 + Green 5 → VALID (all match VALUE 5)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'yellow', '5'), makeCard('c', 'green', '5')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b', 'c']);
    assert.equal(r.valid, true);
  });
});

// ============================================================
// TEST GROUP 6 — WILD CARD INTERACTIONS
// ============================================================

describe('CHAIN BUG FIX — TEST GROUP 6: Wild cards excluded from multi-play', () => {
  it('Wild + Red 7 → INVALID (wild cards cannot be in multi-play)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'wild', 'wild'), makeCard('b', 'red', '7')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('Wild cards cannot be combined'));
  });

  it('Wild4 + Blue 5 → INVALID (wild4 cards cannot be in multi-play)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'wild', 'wild4'), makeCard('b', 'blue', '5')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('Wild cards cannot be combined'));
  });
});

// ============================================================
// TEST GROUP 7 — ATOMICITY (rejected play changes nothing)
// ============================================================

describe('CHAIN BUG FIX — TEST GROUP 7: Atomicity — rejected play changes nothing', () => {
  it('Red 5 + Red 7 rejected against Blue 5: hand unchanged', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '7'), makeCard('c', 'green', '1')], []],
    });
    const handBefore = room.players[0].hand.map(c => c.id);
    game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.deepEqual(room.players[0].hand.map(c => c.id), handBefore, 'hand unchanged');
  });

  it('Red 5 + Red 7 rejected against Blue 5: discard unchanged', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '7')], []],
    });
    const discardBefore = room.discardPile.map(c => c.id);
    game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.deepEqual(room.discardPile.map(c => c.id), discardBefore, 'discard unchanged');
  });

  it('Red 5 + Red 7 rejected against Blue 5: turn unchanged', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '7')], []],
    });
    const turnBefore = room.currentTurn;
    game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.equal(room.currentTurn, turnBefore, 'turn unchanged');
  });

  it('Red 5 + Red 7 rejected against Blue 5: currentColor unchanged', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '7')], []],
    });
    const colorBefore = room.currentColor;
    game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.equal(room.currentColor, colorBefore, 'currentColor unchanged');
  });

  it('Red 5 + Red 7 rejected against Blue 5: drawStack unchanged', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '7')], []],
    });
    const stackBefore = room.drawStack;
    game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.equal(room.drawStack, stackBefore, 'drawStack unchanged');
  });

  it('Red 5 + Red 7 rejected against Blue 5: no elimination', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '7')], []],
    });
    game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.equal(room.players[0].eliminated, false, 'no elimination');
  });

  it('Red 5 + Red 7 rejected against Blue 5: no game_over', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '7')], []],
    });
    game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.equal(room.status, 'playing', 'game still playing');
    assert.equal(room.winner, null, 'no winner');
  });

  it('Red 5 + Red 7 rejected: both cards still in hand', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '7')], []],
    });
    game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.ok(room.players[0].hand.some(c => c.id === 'a'), 'card a still in hand');
    assert.ok(room.players[0].hand.some(c => c.id === 'b'), 'card b still in hand');
  });
});

// ============================================================
// TEST GROUP 8 — SECURITY (malicious payloads)
// ============================================================

describe('CHAIN BUG FIX — TEST GROUP 8: Security — server rejects malicious payloads', () => {
  it('Malicious: valid Red 5 + invalid Red 7 → rejected', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '7')], []],
    });
    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.ok(result.error, 'server must reject');
    assert.ok(room.players[0].hand.length === 2, 'hand unchanged');
  });

  it('Malicious: valid Blue 5 + invalid Red 7 → rejected', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'blue', '5'), makeCard('b', 'red', '7')], []],
    });
    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.ok(result.error, 'server must reject');
    assert.ok(room.players[0].hand.length === 2, 'hand unchanged');
  });

  it('Malicious: valid Red 5 + valid Green 5 → accepted', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'green', '5')], []],
    });
    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.equal(result.error, undefined, 'valid play should not error');
    assert.ok(room.players[0].hand.length === 0, 'hand emptied');
  });

  it('Malicious: all 10 red cards when only Red 5 valid → rejected, hand intact', () => {
    const hand = [
      makeCard('r0', 'red', '0'), makeCard('r1', 'red', '1'),
      makeCard('r2', 'red', '2'), makeCard('r3', 'red', '3'),
      makeCard('r4', 'red', '4'), makeCard('r5', 'red', '5'),
      makeCard('r6', 'red', '6'), makeCard('r7', 'red', '7'),
      makeCard('r8', 'red', '8'), makeCard('r9', 'red', '9'),
    ];
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [hand, []],
    });
    const result = game.playMultipleCards(room, 'p0', ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9']);
    assert.ok(result.error, 'server must reject');
    assert.equal(room.players[0].hand.length, 10, 'all 10 cards still in hand');
  });
});

// ============================================================
// TEST GROUP 9 — VALID MULTI-PLAY STILL WORKS
// ============================================================

describe('CHAIN BUG FIX — TEST GROUP 9: Valid multi-play still works', () => {
  it('Red 5 + Red 7 against Red 3 → VALID (both match COLOR red)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'red', '3')],
      currentColor: 'red',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '7')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true);
  });

  it('Red 5 + Green 5 against Red 3 → VALID (value batch: both share value 5, Red 5 playable by color)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'red', '3')],
      currentColor: 'red',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'green', '5')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true);
  });

  it('Blue 2 + Blue 7 against Blue 3 → VALID (both match BLUE)', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '3')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'blue', '2'), makeCard('b', 'blue', '7')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true);
  });

  it('Same-color number cards: Red 1 + Red 5 against Red 3 → VALID', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'red', '3')],
      currentColor: 'red',
      hands: [[makeCard('a', 'red', '1'), makeCard('b', 'red', '5')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, true);
  });

  it('playMultipleCards: Red 5 + Red 7 against Red 3 → removes cards, handles game over', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'red', '3')],
      currentColor: 'red',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '7')], []],
    });
    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.equal(result.error, undefined);
    assert.equal(room.players[0].hand.length, 0);
    assert.equal(room.discardPile.length, 3);
    assert.equal(room.players[0].eliminated, true, 'player won');
    assert.equal(room.status, 'finished', 'game over in 2-player');
    assert.equal(room.winner, 'p0');
  });

  it('playMultipleCards: Red 5 + Red 7 against Red 3 (3 players) → removes cards, advances turn', () => {
    const room = makeRoom({
      players: 3,
      discardPile: [makeCard('top', 'red', '3')],
      currentColor: 'red',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '7')], [], []],
    });
    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.equal(result.error, undefined);
    assert.equal(room.players[0].hand.length, 0);
    assert.equal(room.players[0].eliminated, true, 'player eliminated');
    assert.equal(room.status, 'playing', 'game continues');
  });
});

// ============================================================
// TEST GROUP 10 — CARD INTEGRITY
// ============================================================

describe('CHAIN BUG FIX — TEST GROUP 10: Card integrity after failed multi-play', () => {
  it('No duplicate cards after rejected multi-play', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '7'), makeCard('c', 'green', '1')], []],
    });
    game.playMultipleCards(room, 'p0', ['a', 'b']);
    const count = countAllCards(room);
    assert.ok(count.total > 0, 'should have cards');
    assert.ok(!count.duplicate, `duplicate card: ${count.duplicate}`);
  });

  it('No duplicate cards after accepted multi-play', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'blue', '5')],
      currentColor: 'blue',
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'green', '5')], []],
    });
    game.playMultipleCards(room, 'p0', ['a', 'b']);
    const count = countAllCards(room);
    assert.ok(count.total > 0, 'should have cards');
    assert.ok(!count.duplicate, `duplicate card: ${count.duplicate}`);
  });
});
