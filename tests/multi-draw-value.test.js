const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const game = require('../game');

function makeCard(id, color, value) {
  return { id, color, value };
}

// Deck order = draw order (deck[0] is drawn first).
function makeDrawRoom(cards) {
  return {
    code: 'MDV',
    status: 'playing',
    currentTurn: 0,
    currentColor: 'red',
    direction: 1,
    drawStack: 0,
    drawStackType: null,
    deck: cards.map((c, i) => makeCard(`d${i}`, c[0], c[1])),
    discardPile: [makeCard('top', 'red', '3')],
    players: [
      { id: 'p0', socketId: 's0', name: 'P0', isConnected: true, hand: [], eliminated: false, finishPosition: null, unoCalled: false },
      { id: 'p1', socketId: 's1', name: 'P1', isConnected: true, hand: [], eliminated: false, finishPosition: null, unoCalled: false },
    ],
    finishOrder: [],
    winner: null,
    loser: null,
  };
}

function drawnIds(result) {
  return result.drawn.map(c => `${c.color} ${c.value}`);
}

describe('MULTI-CARD DRAW: same value only (color irrelevant)', () => {
  it('VALID: Red 5 + Blue 5', () => {
    const room = makeDrawRoom([['red', '5'], ['blue', '5'], ['green', '6']]);
    const result = game.drawMatchingCards(room, 'p0');
    assert.deepEqual(drawnIds(result), ['red 5', 'blue 5']);
    assert.equal(room.players[0].hand.length, 2);
  });

  it('VALID: Red 5 + Green 5 + Yellow 5', () => {
    const room = makeDrawRoom([['red', '5'], ['green', '5'], ['yellow', '5'], ['blue', '1']]);
    const result = game.drawMatchingCards(room, 'p0');
    assert.deepEqual(drawnIds(result), ['red 5', 'green 5', 'yellow 5']);
    assert.equal(room.players[0].hand.length, 3);
  });

  it('VALID: Blue 7 + Red 7', () => {
    const room = makeDrawRoom([['blue', '7'], ['red', '7'], ['yellow', '2']]);
    const result = game.drawMatchingCards(room, 'p0');
    assert.deepEqual(drawnIds(result), ['blue 7', 'red 7']);
  });

  it('VALID: four different colors, same number', () => {
    const room = makeDrawRoom([['red', '9'], ['yellow', '9'], ['green', '9'], ['blue', '9'], ['red', '1']]);
    const result = game.drawMatchingCards(room, 'p0');
    assert.deepEqual(drawnIds(result), ['red 9', 'yellow 9', 'green 9', 'blue 9']);
    assert.equal(room.players[0].hand.length, 4);
  });

  it('INVALID: Red 5 + Red 7 (same color, different value)', () => {
    const room = makeDrawRoom([['red', '5'], ['red', '7']]);
    const result = game.drawMatchingCards(room, 'p0');
    assert.deepEqual(drawnIds(result), ['red 5']);
    assert.equal(room.deck[0].value, '7', 'Red 7 must remain in deck');
    assert.equal(room.players[0].hand.length, 1);
  });

  it('INVALID: Blue 5 + Blue 7 (same color, different value)', () => {
    const room = makeDrawRoom([['blue', '5'], ['blue', '7']]);
    const result = game.drawMatchingCards(room, 'p0');
    assert.deepEqual(drawnIds(result), ['blue 5']);
    assert.equal(room.deck[0].value, '7', 'Blue 7 must remain in deck');
  });

  it('INVALID: Red 5 + Blue 5 + Red 7 (third card differs)', () => {
    const room = makeDrawRoom([['red', '5'], ['blue', '5'], ['red', '7']]);
    const result = game.drawMatchingCards(room, 'p0');
    assert.deepEqual(drawnIds(result), ['red 5', 'blue 5']);
    assert.equal(room.deck[0].value, '7', 'Red 7 must remain in deck');
    assert.equal(room.players[0].hand.length, 2);
  });

  it('INVALID: Red 5 + Green 5 + Yellow 7 (third card differs)', () => {
    const room = makeDrawRoom([['red', '5'], ['green', '5'], ['yellow', '7']]);
    const result = game.drawMatchingCards(room, 'p0');
    assert.deepEqual(drawnIds(result), ['red 5', 'green 5']);
    assert.equal(room.deck[0].value, '7', 'Yellow 7 must remain in deck');
  });

  it('INVALID: Red 2 + Red 3 + Red 4 (all same color, all different values)', () => {
    const room = makeDrawRoom([['red', '2'], ['red', '3'], ['red', '4']]);
    const result = game.drawMatchingCards(room, 'p0');
    assert.deepEqual(drawnIds(result), ['red 2']);
    assert.equal(room.deck.length, 2, 'Red 3 and Red 4 must remain in deck');
  });

  it('selection integrity: [Red 5] then Red 7 rejected, Red 5 batch intact', () => {
    const room = makeDrawRoom([['red', '5'], ['red', '7'], ['blue', '7']]);
    const handBefore = room.players[0].hand.length;
    const result = game.drawMatchingCards(room, 'p0');
    assert.equal(result.drawn.length, 1, 'Red 7 must NOT be added to the Red 5 batch');
    assert.equal(result.drawn[0].color, 'red');
    assert.equal(result.drawn[0].value, '5', 'existing Red 5 selection remains intact');
    assert.equal(room.players[0].hand.length, handBefore + 1);
  });

  it('selection integrity: [Red 5, Blue 5] then Green 7 rejected, batch intact', () => {
    const room = makeDrawRoom([['red', '5'], ['blue', '5'], ['green', '7']]);
    const handBefore = room.players[0].hand.length;
    const result = game.drawMatchingCards(room, 'p0');
    assert.equal(result.drawn.length, 2, 'Green 7 must NOT be added to [Red 5, Blue 5]');
    assert.ok(result.drawn.every(c => c.value === '5'), '[Red 5, Blue 5] remains intact');
    assert.equal(room.players[0].hand.length, handBefore + 2);
    assert.equal(room.deck[0].value, '7', 'Green 7 stays on top of the deck');
  });

  it('selection integrity: [Red 5, Blue 5] accepts another 5 of any color', () => {
    const room = makeDrawRoom([['red', '5'], ['blue', '5'], ['yellow', '5'], ['green', '8']]);
    const result = game.drawMatchingCards(room, 'p0');
    assert.equal(result.drawn.length, 3);
    assert.ok(result.drawn.every(c => c.value === '5'));
  });

  it('no partial mutation: stopped card is untouched in deck, hand grows only by drawn', () => {
    const room = makeDrawRoom([['red', '5'], ['blue', '5'], ['red', '7']]);
    const deckBefore = room.deck.length;
    const result = game.drawMatchingCards(room, 'p0');
    assert.equal(room.deck.length, deckBefore - result.drawn.length);
    assert.equal(room.players[0].hand.length, result.drawn.length);
    assert.deepEqual(room.players[0].hand.map(c => c.id), result.drawn.map(c => c.id));
  });

  it('draw-stack delegation unchanged (draws exact stack count)', () => {
    const room = makeDrawRoom([['red', '5'], ['red', '6'], ['blue', '7'], ['green', '8']]);
    room.drawStack = 2;
    const result = game.drawMatchingCards(room, 'p0');
    assert.equal(result.drawn.length, 2);
    assert.equal(room.drawStack, 0);
  });

  it('wild still stops the chain', () => {
    const room = makeDrawRoom([['red', '5'], ['blue', '5']]);
    room.deck.splice(2, 0, makeCard('w', 'wild', 'wild'));
    const result = game.drawMatchingCards(room, 'p0');
    assert.equal(result.drawn.length, 2);
    assert.equal(room.deck[0].color, 'wild');
  });
});
