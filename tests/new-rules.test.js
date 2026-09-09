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
    code: opts.code || 'RULES',
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

// ============================================================
// 1. REVERSE CARDS CAN BE PLAYED IN PAIRS OR MORE
// ============================================================

describe('REVERSE multi-card play', () => {
  describe('isValidMultiPlay for reverse', () => {
    it('accepts 2 reverse cards of same color', () => {
      const room = makeRoom({
        players: 3,
        discardPile: [makeCard('top', 'red', 'reverse')],
        hands: [[makeCard('a', 'red', 'reverse'), makeCard('b', 'red', 'reverse'), makeCard('c', 'red', '5')], [], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
      assert.equal(r.valid, true);
    });

    it('accepts 2 reverse cards of different colors', () => {
      const room = makeRoom({
        players: 3,
        discardPile: [makeCard('top', 'red', 'reverse')],
        hands: [[makeCard('a', 'red', 'reverse'), makeCard('b', 'blue', 'reverse'), makeCard('c', 'red', '5')], [], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
      assert.equal(r.valid, true);
    });

    it('accepts 3 reverse cards of mixed colors', () => {
      const room = makeRoom({
        players: 3,
        discardPile: [makeCard('top', 'red', 'reverse')],
        hands: [[makeCard('a', 'red', 'reverse'), makeCard('b', 'blue', 'reverse'), makeCard('c', 'green', 'reverse')], [], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b', 'c']);
      assert.equal(r.valid, true);
    });

    it('accepts 4 reverse cards', () => {
      const room = makeRoom({
        players: 3,
        discardPile: [makeCard('top', 'red', 'reverse')],
        hands: [[
          makeCard('a', 'red', 'reverse'), makeCard('b', 'blue', 'reverse'),
          makeCard('c', 'green', 'reverse'), makeCard('d', 'yellow', 'reverse'),
        ], [], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b', 'c', 'd']);
      assert.equal(r.valid, true);
    });

    it('rejects reverse + skip (different values)', () => {
      const room = makeRoom({
        players: 3,
        discardPile: [makeCard('top', 'red', 'reverse')],
        hands: [[makeCard('a', 'red', 'reverse'), makeCard('b', 'blue', 'skip')], [], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
      assert.equal(r.valid, false);
      assert.ok(r.error.includes('Action cards must all have the same value'));
    });
  });

  describe('playMultipleCards with reverse', () => {
    it('2 reverses in 3-player: even count, direction unchanged', () => {
      const room = makeRoom({
        players: 3,
        discardPile: [makeCard('top', 'red', 'reverse')],
        hands: [[makeCard('a', 'red', 'reverse'), makeCard('b', 'blue', 'reverse'), makeCard('c', 'red', '5')], [], []],
      });
      game.playMultipleCards(room, 'p0', ['a', 'b']);
      assert.equal(room.direction, 1, 'even reverses: direction unchanged');
      assert.equal(room.currentTurn, 1, 'turn advances to next player');
    });

    it('3 reverses in 3-player: odd count, direction reversed', () => {
      const room = makeRoom({
        players: 3,
        discardPile: [makeCard('top', 'red', 'reverse')],
        hands: [[makeCard('a', 'red', 'reverse'), makeCard('b', 'blue', 'reverse'), makeCard('c', 'green', 'reverse'), makeCard('extra', 'red', '5')], [], []],
      });
      game.playMultipleCards(room, 'p0', ['a', 'b', 'c']);
      assert.equal(room.direction, -1, 'odd reverses: direction reversed');
      assert.equal(room.currentTurn, 2, 'turn advances in new direction');
    });

    it('4 reverses in 3-player: even count, direction unchanged', () => {
      const room = makeRoom({
        players: 3,
        discardPile: [makeCard('top', 'red', 'reverse')],
        hands: [[
          makeCard('a', 'red', 'reverse'), makeCard('b', 'blue', 'reverse'),
          makeCard('c', 'green', 'reverse'), makeCard('d', 'yellow', 'reverse'),
          makeCard('extra', 'red', '5'),
        ], [], []],
      });
      game.playMultipleCards(room, 'p0', ['a', 'b', 'c', 'd']);
      assert.equal(room.direction, 1, 'even reverses: direction unchanged');
      assert.equal(room.currentTurn, 1, 'turn advances to next player');
    });

    it('1 reverse in 2-player: acts as skip, turn stays with current player', () => {
      const room = makeRoom({
        players: 2,
        discardPile: [makeCard('top', 'red', 'reverse')],
        hands: [[makeCard('a', 'red', 'reverse'), makeCard('b', 'blue', 'reverse'), makeCard('c', 'red', '5')], []],
      });
      game.playMultipleCards(room, 'p0', ['a']);
      assert.equal(room.currentTurn, 0, 'single reverse in 2p: turn stays with current player');
    });

    it('2 reverses in 2-player: skip twice back to current player', () => {
      const room = makeRoom({
        players: 2,
        discardPile: [makeCard('top', 'red', 'reverse')],
        hands: [[makeCard('a', 'red', 'reverse'), makeCard('b', 'blue', 'reverse'), makeCard('c', 'red', '5')], []],
      });
      game.playMultipleCards(room, 'p0', ['a', 'b']);
      assert.equal(room.currentTurn, 0, '2 reverses in 2p: back to current player');
    });

    it('3 reverses in 2-player: skip 3 times, turn stays with current player', () => {
      const room = makeRoom({
        players: 2,
        discardPile: [makeCard('top', 'red', 'reverse')],
        hands: [[makeCard('a', 'red', 'reverse'), makeCard('b', 'blue', 'reverse'), makeCard('c', 'green', 'reverse')], []],
      });
      game.playMultipleCards(room, 'p0', ['a', 'b', 'c']);
      assert.equal(room.currentTurn, 0, '3 reverses in 2p: turn stays with current player');
    });

    it('4 reverses in 2-player: skip 4 times, back to current player', () => {
      const room = makeRoom({
        players: 2,
        discardPile: [makeCard('top', 'red', 'reverse')],
        hands: [[
          makeCard('a', 'red', 'reverse'), makeCard('b', 'blue', 'reverse'),
          makeCard('c', 'green', 'reverse'), makeCard('d', 'yellow', 'reverse'),
        ], []],
      });
      game.playMultipleCards(room, 'p0', ['a', 'b', 'c', 'd']);
      assert.equal(room.currentTurn, 0, '4 reverses in 2p: back to current player');
    });

    it('mixed color reverses work correctly', () => {
      const room = makeRoom({
        players: 3,
        discardPile: [makeCard('top', 'red', 'reverse')],
        hands: [[makeCard('a', 'blue', 'reverse'), makeCard('b', 'green', 'reverse'), makeCard('extra', 'red', '5')], [], []],
      });
      game.playMultipleCards(room, 'p0', ['a', 'b']);
      assert.equal(room.direction, 1, 'even reverses: direction unchanged');
      assert.equal(room.currentTurn, 1);
    });
  });
});

// ============================================================
// 2. SKIP CARDS CAN BE PLAYED IN PAIRS OR MORE
// ============================================================

describe('SKIP multi-card play', () => {
  describe('isValidMultiPlay for skip', () => {
    it('accepts 2 skip cards', () => {
      const room = makeRoom({
        players: 4,
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip'), makeCard('c', 'red', '5')], [], [], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
      assert.equal(r.valid, true);
    });

    it('accepts 3 skip cards', () => {
      const room = makeRoom({
        players: 4,
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip'), makeCard('c', 'green', 'skip')], [], [], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b', 'c']);
      assert.equal(r.valid, true);
    });

    it('accepts skip cards of mixed colors', () => {
      const room = makeRoom({
        players: 4,
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'yellow', 'skip')], [], [], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
      assert.equal(r.valid, true);
    });

    it('rejects skip + reverse (different values)', () => {
      const room = makeRoom({
        players: 4,
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'reverse')], [], [], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
      assert.equal(r.valid, false);
    });
  });

  describe('playMultipleCards with skip', () => {
    it('2 skips in 4-player: skips 2 players', () => {
      const room = makeRoom({
        players: 4,
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip'), makeCard('c', 'red', '5')], [], [], []],
      });
      game.playMultipleCards(room, 'p0', ['a', 'b']);
      assert.equal(room.currentTurn, 3, '2 skips: skip p1 and p2, land on p3');
    });

    it('3 skips in 4-player: skips 3 players', () => {
      const room = makeRoom({
        players: 4,
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip'), makeCard('c', 'green', 'skip')], [], [], []],
      });
      game.playMultipleCards(room, 'p0', ['a', 'b', 'c']);
      assert.equal(room.currentTurn, 0, '3 skips: skip p1, p2, p3, land on p0');
    });

    it('4 skips in 4-player: wraps around', () => {
      const room = makeRoom({
        players: 4,
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[
          makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip'),
          makeCard('c', 'green', 'skip'), makeCard('d', 'yellow', 'skip'),
          makeCard('extra', 'red', '5'),
        ], [], [], []],
      });
      game.playMultipleCards(room, 'p0', ['a', 'b', 'c', 'd']);
      assert.equal(room.currentTurn, 1, '4 skips in 4p: skip p1,p2,p3,p0, land on p1');
    });

    it('2 skips in 2-player: skips 2 positions', () => {
      const room = makeRoom({
        players: 2,
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip'), makeCard('c', 'red', '5')], []],
      });
      game.playMultipleCards(room, 'p0', ['a', 'b']);
      assert.equal(room.currentTurn, 1, '2 skips in 2p: skip p1 twice, land on p1');
    });

    it('3 skips in 2-player: skips 3 positions', () => {
      const room = makeRoom({
        players: 2,
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip'), makeCard('c', 'green', 'skip')], []],
      });
      game.playMultipleCards(room, 'p0', ['a', 'b', 'c']);
      assert.equal(room.currentTurn, 0, '3 skips in 2p: skip p1 three times, land on p0');
    });

    it('skip skips over eliminated players', () => {
      const room = makeRoom({
        players: 4,
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip'), makeCard('c', 'red', '5')], [], [], []],
      });
      room.players[1].eliminated = true;
      game.playMultipleCards(room, 'p0', ['a', 'b']);
      assert.ok(room.players[room.currentTurn].eliminated !== true, 'should not land on eliminated player');
    });

    it('skip skips over disconnected players', () => {
      const room = makeRoom({
        players: 4,
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip'), makeCard('c', 'red', '5')], [], [], []],
      });
      room.players[2].isConnected = false;
      game.playMultipleCards(room, 'p0', ['a', 'b']);
      assert.ok(room.players[room.currentTurn].isConnected !== false, 'should not land on disconnected player');
    });

    it('mixed color skips work correctly', () => {
      const room = makeRoom({
        players: 3,
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'blue', 'skip'), makeCard('b', 'green', 'skip'), makeCard('c', 'red', '5')], [], []],
      });
      game.playMultipleCards(room, 'p0', ['a', 'b']);
      assert.equal(room.currentTurn, 0, '2 skips in 3p: skip p1 and p2, land on p0');
    });
  });
});

// ============================================================
// 3. +2 / +4 STACKING RULE
// ============================================================

describe('Draw stack type enforcement', () => {
  describe('isValidPlay with drawStackType', () => {
    it('+2 on top of +2 stack: allowed', () => {
      const room = makeRoom({
        drawStack: 2,
        drawStackType: 'draw2',
        discardPile: [makeCard('top', 'red', 'draw2')],
        hands: [[makeCard('a', 'blue', 'draw2')], []],
      });
      const card = room.players[0].hand[0];
      assert.ok(game.isValidPlay(room, 'p0', card));
    });

    it('+4 on top of +2 stack: allowed', () => {
      const room = makeRoom({
        drawStack: 2,
        drawStackType: 'draw2',
        discardPile: [makeCard('top', 'red', 'draw2')],
        hands: [[makeCard('a', 'wild', 'wild4')], []],
      });
      const card = room.players[0].hand[0];
      assert.ok(game.isValidPlay(room, 'p0', card));
    });

    it('+4 on top of +4 stack: allowed', () => {
      const room = makeRoom({
        drawStack: 4,
        drawStackType: 'wild4',
        discardPile: [makeCard('top', 'wild', 'wild4')],
        hands: [[makeCard('a', 'wild', 'wild4')], []],
      });
      const card = room.players[0].hand[0];
      assert.ok(game.isValidPlay(room, 'p0', card));
    });

    it('+2 on top of +4 stack: NOT allowed', () => {
      const room = makeRoom({
        drawStack: 4,
        drawStackType: 'wild4',
        discardPile: [makeCard('top', 'wild', 'wild4')],
        hands: [[makeCard('a', 'blue', 'draw2')], []],
      });
      const card = room.players[0].hand[0];
      assert.ok(!game.isValidPlay(room, 'p0', card));
    });

    it('normal card on +2 stack: NOT allowed', () => {
      const room = makeRoom({
        drawStack: 2,
        drawStackType: 'draw2',
        discardPile: [makeCard('top', 'red', 'draw2')],
        hands: [[makeCard('a', 'red', '5')], []],
      });
      const card = room.players[0].hand[0];
      assert.ok(!game.isValidPlay(room, 'p0', card));
    });

    it('skip on +2 stack: NOT allowed', () => {
      const room = makeRoom({
        drawStack: 2,
        drawStackType: 'draw2',
        discardPile: [makeCard('top', 'red', 'draw2')],
        hands: [[makeCard('a', 'red', 'skip')], []],
      });
      const card = room.players[0].hand[0];
      assert.ok(!game.isValidPlay(room, 'p0', card));
    });

    it('reverse on +4 stack: NOT allowed', () => {
      const room = makeRoom({
        drawStack: 4,
        drawStackType: 'wild4',
        discardPile: [makeCard('top', 'wild', 'wild4')],
        hands: [[makeCard('a', 'red', 'reverse')], []],
      });
      const card = room.players[0].hand[0];
      assert.ok(!game.isValidPlay(room, 'p0', card));
    });

    it('wild (regular) on +2 stack: NOT allowed', () => {
      const room = makeRoom({
        drawStack: 2,
        drawStackType: 'draw2',
        discardPile: [makeCard('top', 'red', 'draw2')],
        hands: [[makeCard('a', 'wild', 'wild')], []],
      });
      const card = room.players[0].hand[0];
      assert.ok(!game.isValidPlay(room, 'p0', card));
    });
  });

  describe('playCard sets drawStackType correctly', () => {
    it('playing draw2 sets drawStackType to draw2', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', '3')],
        hands: [[makeCard('a', 'red', 'draw2'), makeCard('b', 'red', '5')], []],
      });
      game.playCard(room, 'p0', 'a');
      assert.equal(room.drawStack, 2);
      assert.equal(room.drawStackType, 'draw2');
    });

    it('playing wild4 sets drawStackType to wild4', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', '3')],
        hands: [[makeCard('a', 'wild', 'wild4'), makeCard('b', 'red', '5')], []],
      });
      game.playCard(room, 'p0', 'a', 'blue');
      assert.equal(room.drawStack, 4);
      assert.equal(room.drawStackType, 'wild4');
    });

    it('+2 then +4: stack accumulates correctly', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', '3')],
        hands: [[makeCard('a', 'red', 'draw2'), makeCard('c', 'red', '5')], [makeCard('b', 'wild', 'wild4'), makeCard('d', 'red', '7')]],
      });
      game.playCard(room, 'p0', 'a');
      assert.equal(room.drawStack, 2);
      assert.equal(room.drawStackType, 'draw2');
      assert.equal(room.currentTurn, 1, 'turn advanced to p1');

      game.playCard(room, 'p1', 'b', 'green');
      assert.equal(room.drawStack, 6);
      assert.equal(room.drawStackType, 'wild4');
    });

    it('+4 then +4: stack accumulates correctly', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', '3')],
        hands: [[makeCard('a', 'wild', 'wild4'), makeCard('c', 'red', '5')], [makeCard('b', 'wild', 'wild4'), makeCard('d', 'red', '7')]],
      });
      game.playCard(room, 'p0', 'a', 'blue');
      assert.equal(room.drawStack, 4);
      assert.equal(room.drawStackType, 'wild4');
      assert.equal(room.currentTurn, 1, 'turn advanced to p1');

      game.playCard(room, 'p1', 'b', 'green');
      assert.equal(room.drawStack, 8);
      assert.equal(room.drawStackType, 'wild4');
    });
  });

  describe('drawCards resets drawStackType', () => {
    it('drawing resets both drawStack and drawStackType', () => {
      const room = makeRoom({
        currentTurn: 1,
        drawStack: 6,
        drawStackType: 'wild4',
        discardPile: [makeCard('top', 'red', '3'), makeCard('w4', 'wild', 'wild4')],
        deck: [makeCard('d1', 'blue', '1'), makeCard('d2', 'green', '2'), makeCard('d3', 'yellow', '3'), makeCard('d4', 'blue', '4'), makeCard('d5', 'red', '5'), makeCard('d6', 'green', '6')],
        hands: [[], []],
      });
      game.drawCards(room, 'p1', 6);
      assert.equal(room.drawStack, 0);
      assert.equal(room.drawStackType, null);
    });
  });

  describe('multi-card draw2 during stack', () => {
    it('2 draw2 cards during +2 stack: accumulates correctly', () => {
      const room = makeRoom({
        drawStack: 2,
        drawStackType: 'draw2',
        discardPile: [makeCard('top', 'red', 'draw2')],
        hands: [[makeCard('a', 'blue', 'draw2'), makeCard('b', 'green', 'draw2'), makeCard('c', 'red', '5')], []],
      });
      game.playMultipleCards(room, 'p0', ['a', 'b']);
      assert.equal(room.drawStack, 6);
      assert.equal(room.drawStackType, 'draw2');
    });
  });

  describe('serializeRoomForPlayer includes drawStackType', () => {
    it('serialized state includes drawStackType', () => {
      const room = makeRoom({
        drawStack: 4,
        drawStackType: 'wild4',
        discardPile: [makeCard('top', 'wild', 'wild4')],
      });
      const view = game.serializeRoomForPlayer(room, 'p0');
      assert.equal(view.drawStackType, 'wild4');
    });

    it('serialized state includes null drawStackType when no stack', () => {
      const room = makeRoom({
        drawStack: 0,
        drawStackType: null,
        discardPile: [makeCard('top', 'red', '3')],
      });
      const view = game.serializeRoomForPlayer(room, 'p0');
      assert.equal(view.drawStackType, null);
    });
  });
});

// ============================================================
// 4. POWER CARDS CANNOT BE THE FINAL CARD
// ============================================================

describe('Final power card rejection', () => {
  describe('single card play', () => {
    it('rejects final Skip card', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip')], []],
      });
      const result = game.playCard(room, 'p0', 'a');
      assert.ok(result.error);
      assert.ok(result.error.includes('Power cards cannot be used as the final card'));
      assert.equal(room.players[0].hand.length, 1, 'hand unchanged');
    });

    it('rejects final Reverse card', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', 'reverse')],
        hands: [[makeCard('a', 'red', 'reverse')], []],
      });
      const result = game.playCard(room, 'p0', 'a');
      assert.ok(result.error);
      assert.ok(result.error.includes('Power cards cannot be used as the final card'));
      assert.equal(room.players[0].hand.length, 1, 'hand unchanged');
    });

    it('rejects final Draw2 card', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', 'draw2')],
        hands: [[makeCard('a', 'red', 'draw2')], []],
      });
      const result = game.playCard(room, 'p0', 'a');
      assert.ok(result.error);
      assert.ok(result.error.includes('Power cards cannot be used as the final card'));
      assert.equal(room.players[0].hand.length, 1, 'hand unchanged');
    });

    it('rejects final Wild card', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', '3')],
        hands: [[makeCard('a', 'wild', 'wild')], []],
      });
      const result = game.playCard(room, 'p0', 'a', 'blue');
      assert.ok(result.error);
      assert.ok(result.error.includes('Power cards cannot be used as the final card'));
      assert.equal(room.players[0].hand.length, 1, 'hand unchanged');
    });

    it('rejects final Wild4 card', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', '3')],
        hands: [[makeCard('a', 'wild', 'wild4')], []],
      });
      const result = game.playCard(room, 'p0', 'a', 'blue');
      assert.ok(result.error);
      assert.ok(result.error.includes('Power cards cannot be used as the final card'));
      assert.equal(room.players[0].hand.length, 1, 'hand unchanged');
    });

    it('allows final number card (wins)', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', '3')],
        hands: [[makeCard('a', 'red', '5')], [makeCard('b', 'blue', '1')]],
      });
      const result = game.playCard(room, 'p0', 'a');
      assert.equal(result.error, undefined);
      assert.equal(room.players[0].eliminated, true, 'player eliminated (won)');
    });

    it('allows non-final power card', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'red', '5')], []],
      });
      const result = game.playCard(room, 'p0', 'a');
      assert.equal(result.error, undefined);
      assert.equal(room.players[0].hand.length, 1, 'one card remains');
    });
  });

  describe('rejected play does not change game state', () => {
    it('rejected final power card does not modify hand', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip')], []],
      });
      const handBefore = room.players[0].hand.map(c => c.id);
      game.playCard(room, 'p0', 'a');
      assert.deepEqual(room.players[0].hand.map(c => c.id), handBefore, 'hand unchanged');
    });

    it('rejected final power card does not change turn', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip')], []],
      });
      const turnBefore = room.currentTurn;
      game.playCard(room, 'p0', 'a');
      assert.equal(room.currentTurn, turnBefore, 'turn unchanged');
    });

    it('rejected final power card does not trigger game_over', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip')], []],
      });
      game.playCard(room, 'p0', 'a');
      assert.equal(room.status, 'playing', 'game still playing');
      assert.equal(room.winner, null, 'no winner');
    });

    it('rejected final power card does not modify currentColor', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip')], []],
      });
      const colorBefore = room.currentColor;
      game.playCard(room, 'p0', 'a');
      assert.equal(room.currentColor, colorBefore, 'currentColor unchanged');
    });
  });
});

// ============================================================
// 5. MULTI-CARD FINAL POWER CARD REJECTION
// ============================================================

describe('Multi-card final power card rejection', () => {
  it('rejects playing multiple power cards as final cards', () => {
    const room = makeRoom({
      players: 3,
      discardPile: [makeCard('top', 'red', 'skip')],
      hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip')], [], []],
    });
    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.ok(result.error);
    assert.ok(result.error.includes('Power cards cannot be used as the final card'));
    assert.equal(room.players[0].hand.length, 2, 'hand unchanged');
  });

  it('rejects playing power cards as final cards even with number card in between', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'red', '5')],
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', 'skip')], []],
    });
    // a is number, b is power - mixed types are not allowed in multi-play
    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.ok(result.error, 'number + power mix is rejected');
    assert.ok(result.error.includes('Cannot mix number cards and action cards'));
  });

  it('allows playing number cards as final cards via multi-play', () => {
    const room = makeRoom({
      players: 3,
      discardPile: [makeCard('top', 'red', '3')],
      hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '7')], [], []],
    });
    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.equal(result.error, undefined);
    assert.equal(room.players[0].eliminated, true, 'player won');
  });

  it('rejected multi-card final power play does not modify hand', () => {
    const room = makeRoom({
      players: 3,
      discardPile: [makeCard('top', 'red', 'skip')],
      hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip')], [], []],
    });
    const handBefore = room.players[0].hand.map(c => c.id);
    game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.deepEqual(room.players[0].hand.map(c => c.id), handBefore, 'hand unchanged');
  });

  it('rejected multi-card final power play does not change turn', () => {
    const room = makeRoom({
      players: 3,
      discardPile: [makeCard('top', 'red', 'skip')],
      hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip')], [], []],
    });
    const turnBefore = room.currentTurn;
    game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.equal(room.currentTurn, turnBefore, 'turn unchanged');
  });

  it('rejected multi-card final power play does not trigger game_over', () => {
    const room = makeRoom({
      players: 3,
      discardPile: [makeCard('top', 'red', 'skip')],
      hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip')], [], []],
    });
    game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.equal(room.status, 'playing', 'game still playing');
    assert.equal(room.winner, null, 'no winner');
  });
});

// ============================================================
// 6. MULTI-CARD SELECTION VALIDATION
// ============================================================

describe('Multi-card selection validation', () => {
  describe('same-value action card groups', () => {
    it('skip + skip: valid', () => {
      const room = makeRoom({
        players: 3,
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip'), makeCard('c', 'red', '5')], [], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
      assert.equal(r.valid, true);
    });

    it('reverse + reverse: valid', () => {
      const room = makeRoom({
        players: 3,
        discardPile: [makeCard('top', 'red', 'reverse')],
        hands: [[makeCard('a', 'red', 'reverse'), makeCard('b', 'blue', 'reverse'), makeCard('c', 'red', '5')], [], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
      assert.equal(r.valid, true);
    });

    it('draw2 + draw2: valid', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', 'draw2')],
        hands: [[makeCard('a', 'red', 'draw2'), makeCard('b', 'blue', 'draw2'), makeCard('c', 'red', '5')], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
      assert.equal(r.valid, true);
    });
  });

  describe('invalid mixed groups', () => {
    it('skip + reverse: invalid', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'reverse')], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
      assert.equal(r.valid, false);
    });

    it('skip + draw2: invalid', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'draw2')], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
      assert.equal(r.valid, false);
    });

    it('reverse + draw2: invalid', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', 'reverse')],
        hands: [[makeCard('a', 'red', 'reverse'), makeCard('b', 'blue', 'draw2')], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
      assert.equal(r.valid, false);
    });

    it('wild + skip: invalid', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', 'skip')],
        hands: [[makeCard('a', 'wild', 'wild'), makeCard('b', 'blue', 'skip')], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
      assert.equal(r.valid, false);
    });

    it('number + action card mixed: invalid', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', '5')],
        hands: [[makeCard('a', 'red', '5'), makeCard('b', 'blue', 'skip')], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
      assert.equal(r.valid, false);
    });
  });

  describe('number card groups', () => {
    it('same value different colors: valid', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', '3')],
        hands: [[makeCard('a', 'red', '5'), makeCard('b', 'blue', '5')], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
      assert.equal(r.valid, true);
    });

    it('same color different values: valid', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', '3')],
        hands: [[makeCard('a', 'red', '5'), makeCard('b', 'red', '7')], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
      assert.equal(r.valid, true);
    });

    it('mixed color/value chain: valid', () => {
      const room = makeRoom({
        discardPile: [makeCard('top', 'red', '3')],
        hands: [[makeCard('a', 'red', '5'), makeCard('b', 'blue', '5'), makeCard('c', 'blue', '9')], []],
      });
      const r = game.isValidMultiPlay(room, 'p0', ['a', 'b', 'c']);
      assert.equal(r.valid, true);
    });
  });
});

// ============================================================
// 7. SECURITY: server-side validation
// ============================================================

describe('Security: server enforces all rules', () => {
  it('playCard rejects power card as final card even if client tries', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'red', 'skip')],
      hands: [[makeCard('a', 'red', 'skip')], []],
    });
    const result = game.playCard(room, 'p0', 'a');
    assert.ok(result.error);
    assert.ok(result.error.includes('Power cards cannot be used as the final card'));
  });

  it('playMultipleCards rejects all-power final cards', () => {
    const room = makeRoom({
      players: 3,
      discardPile: [makeCard('top', 'red', 'skip')],
      hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'skip')], [], []],
    });
    const result = game.playMultipleCards(room, 'p0', ['a', 'b']);
    assert.ok(result.error);
    assert.ok(result.error.includes('Power cards cannot be used as the final card'));
  });

  it('isValidPlay rejects +2 when drawStackType is wild4', () => {
    const room = makeRoom({
      drawStack: 4,
      drawStackType: 'wild4',
      discardPile: [makeCard('top', 'wild', 'wild4')],
      hands: [[makeCard('a', 'red', 'draw2')], []],
    });
    assert.ok(!game.isValidPlay(room, 'p0', room.players[0].hand[0]));
  });

  it('isValidMultiPlay rejects mixed action card types', () => {
    const room = makeRoom({
      discardPile: [makeCard('top', 'red', 'skip')],
      hands: [[makeCard('a', 'red', 'skip'), makeCard('b', 'blue', 'reverse')], []],
    });
    const r = game.isValidMultiPlay(room, 'p0', ['a', 'b']);
    assert.equal(r.valid, false);
  });

  it('drawCards resets drawStackType to null', () => {
    const room = makeRoom({
      currentTurn: 0,
      drawStack: 4,
      drawStackType: 'wild4',
      discardPile: [makeCard('top', 'wild', 'wild4')],
      deck: [makeCard('d1', 'blue', '1'), makeCard('d2', 'green', '2'), makeCard('d3', 'yellow', '3'), makeCard('d4', 'blue', '4')],
      hands: [[], []],
    });
    game.drawCards(room, 'p0', 4);
    assert.equal(room.drawStack, 0);
    assert.equal(room.drawStackType, null);
  });

  it('initGame initializes drawStackType to null', () => {
    const room = makeRoom({ players: 2 });
    game.initGame(room);
    assert.equal(room.drawStackType, null);
  });
});

// ============================================================
// 7. NEXT TURN INDICATOR
// ============================================================

describe('getNextTurn', () => {
  describe('normal turns', () => {
    it('4-player clockwise: next turn goes to next player', () => {
      const room = makeRoom({ players: 4, currentTurn: 0, direction: 1 });
      assert.equal(game.getNextTurn(room), 1);
    });

    it('4-player clockwise from middle: next turn advances by 1', () => {
      const room = makeRoom({ players: 4, currentTurn: 2, direction: 1 });
      assert.equal(game.getNextTurn(room), 3);
    });

    it('4-player clockwise at end: wraps to first player', () => {
      const room = makeRoom({ players: 4, currentTurn: 3, direction: 1 });
      assert.equal(game.getNextTurn(room), 0);
    });

    it('4-player counter-clockwise: next turn goes backward', () => {
      const room = makeRoom({ players: 4, currentTurn: 0, direction: -1 });
      assert.equal(game.getNextTurn(room), 3);
    });

    it('4-player counter-clockwise from middle: goes backward', () => {
      const room = makeRoom({ players: 4, currentTurn: 2, direction: -1 });
      assert.equal(game.getNextTurn(room), 1);
    });

    it('3-player clockwise: wraps correctly', () => {
      const room = makeRoom({ players: 3, currentTurn: 2, direction: 1 });
      assert.equal(game.getNextTurn(room), 0);
    });

    it('3-player counter-clockwise: wraps correctly', () => {
      const room = makeRoom({ players: 3, currentTurn: 0, direction: -1 });
      assert.equal(game.getNextTurn(room), 2);
    });
  });

  describe('2-player games', () => {
    it('2-player clockwise: next turn is opponent', () => {
      const room = makeRoom({ players: 2, currentTurn: 0, direction: 1 });
      assert.equal(game.getNextTurn(room), 1);
    });

    it('2-player counter-clockwise: next turn is opponent', () => {
      const room = makeRoom({ players: 2, currentTurn: 0, direction: -1 });
      assert.equal(game.getNextTurn(room), 1);
    });

    it('2-player from player 1: next turn is player 0', () => {
      const room = makeRoom({ players: 2, currentTurn: 1, direction: 1 });
      assert.equal(game.getNextTurn(room), 0);
    });
  });

  describe('eliminated players', () => {
    it('skips eliminated players clockwise', () => {
      const room = makeRoom({ players: 4, currentTurn: 0, direction: 1 });
      room.players[1].eliminated = true;
      assert.equal(game.getNextTurn(room), 2);
    });

    it('skips multiple consecutive eliminated players', () => {
      const room = makeRoom({ players: 4, currentTurn: 0, direction: 1 });
      room.players[1].eliminated = true;
      room.players[2].eliminated = true;
      assert.equal(game.getNextTurn(room), 3);
    });

    it('skips eliminated players counter-clockwise', () => {
      const room = makeRoom({ players: 4, currentTurn: 0, direction: -1 });
      room.players[3].eliminated = true;
      assert.equal(game.getNextTurn(room), 2);
    });

    it('wraps around eliminated players at boundary', () => {
      const room = makeRoom({ players: 4, currentTurn: 3, direction: 1 });
      room.players[0].eliminated = true;
      assert.equal(game.getNextTurn(room), 1);
    });

    it('skips eliminated player right after current turn', () => {
      const room = makeRoom({ players: 3, currentTurn: 0, direction: 1 });
      room.players[1].eliminated = true;
      assert.equal(game.getNextTurn(room), 2);
    });

    it('2-player: returns current turn if opponent is eliminated', () => {
      const room = makeRoom({ players: 2, currentTurn: 0, direction: 1 });
      room.players[1].eliminated = true;
      assert.equal(game.getNextTurn(room), 0);
    });
  });

  describe('serialized state', () => {
    it('serializeRoomForPlayer includes nextTurn', () => {
      const room = makeRoom({
        players: 3,
        currentTurn: 0,
        direction: 1,
        discardPile: [makeCard('top', 'red', '5')],
        hands: [[makeCard('a', 'red', '3')], [], []],
      });
      const serialized = game.serializeRoomForPlayer(room, 'p0');
      assert.equal(serialized.nextTurn, 1);
    });

    it('serializeRoomForPlayer nextTurn skips eliminated players', () => {
      const room = makeRoom({
        players: 4,
        currentTurn: 0,
        direction: 1,
        discardPile: [makeCard('top', 'red', '5')],
        hands: [[makeCard('a', 'red', '3')], [], [], []],
      });
      room.players[1].eliminated = true;
      const serialized = game.serializeRoomForPlayer(room, 'p0');
      assert.equal(serialized.nextTurn, 2);
    });

    it('serializeRoomForPlayer nextTurn is null when game not playing', () => {
      const room = makeRoom({
        players: 2,
        currentTurn: 0,
        status: 'waiting',
        discardPile: [makeCard('top', 'red', '5')],
        hands: [[makeCard('a', 'red', '3')], []],
      });
      const serialized = game.serializeRoomForPlayer(room, 'p0');
      assert.equal(serialized.nextTurn, null);
    });
  });
});
