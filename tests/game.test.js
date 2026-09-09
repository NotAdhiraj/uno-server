const { describe, it, beforeEach } = require('node:test');
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
    code: opts.code || 'TROOM',
    hostId: opts.hostId || 'p0',
    maxPlayers: opts.maxPlayers || n,
    players,
    status: opts.status || 'waiting',
    deck: opts.deck || [],
    discardPile: opts.discardPile || [],
    currentColor: opts.currentColor || null,
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
  const where = {};
  for (const c of room.discardPile) {
    total++;
    where[c.id] = 'discard';
  }
  for (const p of room.players) {
    for (const c of (p.hand || [])) {
      total++;
      where[c.id] = `hand:${p.id}`;
    }
  }
  total += room.deck.length;
  for (const c of room.deck) {
    where[c.id] = 'deck';
  }
  return { total, where };
}

function findDuplicates(room) {
  const ids = [];
  for (const c of room.discardPile) ids.push(c.id);
  for (const p of room.players) for (const c of (p.hand || [])) ids.push(c.id);
  for (const c of room.deck) ids.push(c.id);
  const seen = new Set();
  const dupes = [];
  for (const id of ids) {
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  return dupes;
}

// ─── buildDeck ────────────────────────────────────────────────────

describe('buildDeck', () => {
  it('returns exactly 108 cards', () => {
    const deck = game.buildDeck();
    assert.equal(deck.length, 108);
  });

  it('every card has a unique id', () => {
    const deck = game.buildDeck();
    const ids = deck.map(c => c.id);
    assert.equal(new Set(ids).size, 108);
  });

  it('has correct composition for each color', () => {
    const deck = game.buildDeck();
    for (const color of ['red', 'blue', 'green', 'yellow']) {
      const colored = deck.filter(c => c.color === color);
      const byVal = {};
      for (const c of colored) byVal[c.value] = (byVal[c.value] || 0) + 1;

      assert.equal(byVal['0'], 1, `${color} should have one 0`);
      for (const v of ['1','2','3','4','5','6','7','8','9']) {
        assert.equal(byVal[v], 2, `${color} should have two ${v}s`);
      }
      assert.equal(byVal['skip'], 2, `${color} should have two skip`);
      assert.equal(byVal['reverse'], 2, `${color} should have two reverse`);
      assert.equal(byVal['draw2'], 2, `${color} should have two draw2`);
      assert.equal(colored.length, 25, `${color} should have 25 cards total`);
    }
  });

  it('has exactly 4 wild and 4 wild4', () => {
    const deck = game.buildDeck();
    const wilds = deck.filter(c => c.value === 'wild');
    const wild4s = deck.filter(c => c.value === 'wild4');
    assert.equal(wilds.length, 4);
    assert.equal(wild4s.length, 4);
    for (const c of wilds) assert.equal(c.color, 'wild');
    for (const c of wild4s) assert.equal(c.color, 'wild');
  });

  it('has no unexpected cards', () => {
    const deck = game.buildDeck();
    const validColors = new Set(['red','blue','green','yellow','wild']);
    const validValues = new Set(['0','1','2','3','4','5','6','7','8','9','skip','reverse','draw2','wild','wild4']);
    for (const c of deck) {
      assert.ok(validColors.has(c.color), `unexpected color: ${c.color}`);
      assert.ok(validValues.has(c.value), `unexpected value: ${c.value}`);
    }
  });
});

// ─── initGame ─────────────────────────────────────────────────────

describe('initGame', () => {
  it('initializes a 2-player game correctly', () => {
    const room = makeRoom({ players: 2 });
    game.initGame(room);

    assert.equal(room.status, 'playing');
    assert.equal(room.direction, 1);
    assert.equal(room.drawStack, 0);
    assert.ok(room.currentTurn >= 0 && room.currentTurn < 2);
    assert.equal(room.discardPile.length, 1);

    const startCard = room.discardPile[0];
    assert.ok(/^\d+$/.test(startCard.value), `starting card should be a number, got: ${startCard.value}`);
    assert.equal(room.currentColor, startCard.color);

    for (const p of room.players) {
      assert.equal(p.hand.length, 7, `${p.name} should have 7 cards`);
    }

    const counts = countAllCards(room);
    assert.equal(counts.total, 108);
    assert.equal(findDuplicates(room).length, 0);
  });

  it('initializes a 6-player game correctly', () => {
    const room = makeRoom({ players: 6 });
    game.initGame(room);

    assert.equal(room.status, 'playing');
    assert.equal(room.discardPile.length, 1);
    assert.ok(/^\d+$/.test(room.discardPile[0].value));

    for (const p of room.players) {
      assert.equal(p.hand.length, 7, `${p.name} should have 7 cards`);
    }

    const counts = countAllCards(room);
    assert.equal(counts.total, 108);
    assert.equal(findDuplicates(room).length, 0);
  });
});

// ─── isValidPlay ──────────────────────────────────────────────────

describe('isValidPlay', () => {
  function setupValidPlay(drawStack = 0) {
    return makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'blue',
      discardPile: [makeCard('top1', 'blue', '9')],
      drawStack,
      hands: [
        [
          makeCard('c1', 'red', '5'),
          makeCard('c2', 'blue', 'skip'),
          makeCard('c3', 'wild', 'wild'),
          makeCard('c4', 'yellow', '3'),
          makeCard('c5', 'blue', '7'),
          makeCard('c6', 'red', 'draw2'),
          makeCard('c7', 'wild', 'wild4'),
        ],
        [makeCard('c8', 'green', '1')],
      ],
    });
  }

  it('same color is valid', () => {
    const room = setupValidPlay();
    const card = room.players[0].hand.find(c => c.id === 'c2');
    assert.ok(game.isValidPlay(room, 'p0', card));
  });

  it('same value is valid', () => {
    const room = setupValidPlay();
    // top is value '9', play a '9' of different color
    room.players[0].hand.push(makeCard('c99', 'red', '9'));
    const card = room.players[0].hand.find(c => c.id === 'c99');
    assert.ok(game.isValidPlay(room, 'p0', card));
  });

  it('wild is always valid', () => {
    const room = setupValidPlay();
    const card = room.players[0].hand.find(c => c.id === 'c3');
    assert.ok(game.isValidPlay(room, 'p0', card));
  });

  it('unrelated color + unrelated value is invalid', () => {
    const room = setupValidPlay();
    const card = room.players[0].hand.find(c => c.id === 'c1'); // red 5
    assert.ok(!game.isValidPlay(room, 'p0', card));
  });

  describe('when drawStack > 0', () => {
    it('draw2 is valid', () => {
      const room = setupValidPlay(2);
      const card = room.players[0].hand.find(c => c.id === 'c6');
      assert.ok(game.isValidPlay(room, 'p0', card));
    });

    it('wild4 is valid', () => {
      const room = setupValidPlay(4);
      const card = room.players[0].hand.find(c => c.id === 'c7');
      assert.ok(game.isValidPlay(room, 'p0', card));
    });

    it('normal number is invalid', () => {
      const room = setupValidPlay(2);
      room.players[0].hand.push(makeCard('c98', 'blue', '9'));
      const card = room.players[0].hand.find(c => c.id === 'c98');
      assert.ok(!game.isValidPlay(room, 'p0', card));
    });

    it('skip is invalid', () => {
      const room = setupValidPlay(2);
      const card = room.players[0].hand.find(c => c.id === 'c2');
      assert.ok(!game.isValidPlay(room, 'p0', card));
    });

    it('reverse is invalid', () => {
      const room = setupValidPlay(2);
      room.players[0].hand.push(makeCard('c97', 'blue', 'reverse'));
      const card = room.players[0].hand.find(c => c.id === 'c97');
      assert.ok(!game.isValidPlay(room, 'p0', card));
    });

    it('normal wild is invalid', () => {
      const room = setupValidPlay(2);
      const card = room.players[0].hand.find(c => c.id === 'c3');
      assert.ok(!game.isValidPlay(room, 'p0', card));
    });
  });
});

// ─── playCard ─────────────────────────────────────────────────────

describe('playCard', () => {
  function setup(numPlayers = 2) {
    const hand0 = [
      makeCard('n1', 'blue', '5'),
      makeCard('n2', 'blue', 'skip'),
      makeCard('n3', 'blue', 'reverse'),
      makeCard('n4', 'blue', 'draw2'),
      makeCard('w1', 'wild', 'wild'),
      makeCard('w2', 'wild', 'wild4'),
      makeCard('n5', 'yellow', '7'),
    ];
    const hands = [hand0];
    for (let i = 1; i < numPlayers; i++) {
      hands.push([makeCard(`extra${i}`, 'red', '1')]);
    }
    return makeRoom({
      players: numPlayers,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'blue',
      discardPile: [makeCard('top', 'blue', '9')],
      drawStack: 0,
      hands,
    });
  }

  it('number card advances turn normally', () => {
    const room = setup(3);
    const r = game.playCard(room, 'p0', 'n1');
    assert.equal(r.error, undefined);
    assert.equal(room.currentTurn, 1);
    assert.equal(room.currentColor, 'blue');
  });

  it('skip advances turn by 2', () => {
    const room = setup(3);
    game.playCard(room, 'p0', 'n2');
    assert.equal(room.currentTurn, 2);
  });

  it('reverse changes direction', () => {
    const room = setup(3);
    game.playCard(room, 'p0', 'n3');
    assert.equal(room.direction, -1);
    // from 0 going -1 in a 3-player game: (0 + -1 + 3) % 3 = 2
    assert.equal(room.currentTurn, 2);
  });

  it('reverse in 2-player game behaves as skip', () => {
    const room = setup(2);
    room.players[0].hand.push(makeCard('rev', 'blue', 'reverse'));
    game.playCard(room, 'p0', 'rev');
    // (0 + 2) % 2 = 0, stays on same player
    assert.equal(room.currentTurn, 0);
    assert.equal(room.direction, 1, 'direction should NOT change in 2p reverse');
  });

  it('draw2 increases drawStack by 2', () => {
    const room = setup(3);
    game.playCard(room, 'p0', 'n4');
    assert.equal(room.drawStack, 2);
    assert.equal(room.currentTurn, 1);
  });

  it('wild requires valid chosenColor', () => {
    const room = setup();
    const r = game.playCard(room, 'p0', 'w1', 'purple');
    assert.ok(r.error);
  });

  it('wild changes currentColor', () => {
    const room = setup();
    game.playCard(room, 'p0', 'w1', 'red');
    assert.equal(room.currentColor, 'red');
  });

  it('wild4 increases drawStack by 4', () => {
    const room = setup(3);
    game.playCard(room, 'p0', 'w2', 'green');
    assert.equal(room.drawStack, 4);
    assert.equal(room.currentColor, 'green');
    assert.equal(room.currentTurn, 1);
  });

  it('wild4 requires valid chosenColor', () => {
    const room = setup();
    const r = game.playCard(room, 'p0', 'w2', 'orange');
    assert.ok(r.error);
  });

  it('invalid chosenColor is rejected', () => {
    const room = setup();
    const r = game.playCard(room, 'p0', 'w1', 'purple');
    assert.ok(r.error);
    assert.match(r.error, /color/i);
  });

  it('cannot play a card not in hand', () => {
    const room = setup();
    const r = game.playCard(room, 'p0', 'nonexistent');
    assert.equal(r.error, 'Card not in hand');
  });

  it('cannot play when not your turn', () => {
    const room = setup();
    const r = game.playCard(room, 'p1', 'n1');
    assert.equal(r.error, 'Not your turn');
  });

  it('cannot play an invalid card', () => {
    const room = setup();
    // n5 is yellow 7, top is blue 9 — color doesn't match, value doesn't match
    const r = game.playCard(room, 'p0', 'n5');
    assert.equal(r.error, 'Invalid play');
  });

  it('playing final card finishes game', () => {
    const room = setup();
    room.players[0].hand = [makeCard('last', 'blue', '3')];
    game.playCard(room, 'p0', 'last');
    assert.equal(room.status, 'finished');
    assert.equal(room.winner, 'p0');
  });
});

// ─── drawCards ────────────────────────────────────────────────────

describe('drawCards', () => {
  function setupDeck(handSize = 7) {
    const hand = [];
    for (let i = 0; i < handSize; i++) {
      hand.push(makeCard(`h${i}`, 'red', String(i)));
    }
    const deck = [];
    for (let i = 0; i < 20; i++) {
      deck.push(makeCard(`d${i}`, 'blue', String(i % 10)));
    }
    return makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [makeCard('top', 'red', '5')],
      drawStack: 0,
      deck,
      hands: [hand, [makeCard('other', 'green', '1')]],
    });
  }

  it('normal draw gives exactly 1 card', () => {
    const room = setupDeck();
    const before = room.players[0].hand.length;
    game.drawCards(room, 'p0', 1);
    assert.equal(room.players[0].hand.length, before + 1);
  });

  it('drawing multiple cards gives the requested number', () => {
    const room = setupDeck();
    const before = room.players[0].hand.length;
    game.drawCards(room, 'p0', 5);
    assert.equal(room.players[0].hand.length, before + 5);
  });

  it('drawStack is reset after drawing', () => {
    const room = setupDeck();
    room.drawStack = 6;
    game.drawCards(room, 'p0', 6);
    assert.equal(room.drawStack, 0);
  });

  it('turn advances after drawing', () => {
    const room = setupDeck();
    game.drawCards(room, 'p0', 1);
    assert.equal(room.currentTurn, 1);
  });

  it('reshuffles discard pile when deck runs low', () => {
    const room = makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [
        makeCard('dp1', 'red', '1'),
        makeCard('dp2', 'blue', '2'),
        makeCard('dp3', 'green', '3'),
      ],
      drawStack: 0,
      deck: [makeCard('dk1', 'yellow', '4')],
      hands: [[makeCard('h1', 'red', '5')], [makeCard('h2', 'green', '6')]],
    });

    game.drawCards(room, 'p0', 3);
    // deck had 1, discard had 3 (top stays), so deck should now have 2 cards reshuffled + drawn 3
    // After: deck had 1, we need 3, so reshuffle: pop top (dp3), push dp1+dp2 to deck (2 cards), then draw 3 from 3 total
    assert.equal(room.players[0].hand.length, 4); // was 1, drew 3
    assert.equal(room.discardPile.length, 1); // only top card remains
    assert.equal(room.discardPile[0].id, 'dp3');
  });

  it('top discard card is NOT reshuffled into deck', () => {
    const room = makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [
        makeCard('dp1', 'red', '1'),
        makeCard('dp2', 'blue', '2'),
      ],
      drawStack: 0,
      deck: [],
      hands: [[makeCard('h1', 'red', '5')], [makeCard('h2', 'green', '6')]],
    });

    game.drawCards(room, 'p0', 2);
    const ids = new Set();
    for (const c of room.deck) ids.add(c.id);
    for (const c of room.players[0].hand) ids.add(c.id);
    // top card dp2 should NOT be in deck or hand
    assert.ok(!ids.has('dp2'), 'top discard card should not be in deck or hand');
    assert.equal(room.discardPile[0].id, 'dp2');
  });

  it('no duplicate/lost cards during reshuffle', () => {
    const room = makeRoom({
      status: 'playing',
      currentTurn: 0,
      currentColor: 'red',
      discardPile: [
        makeCard('dp1', 'red', '1'),
        makeCard('dp2', 'blue', '2'),
        makeCard('dp3', 'green', '3'),
      ],
      drawStack: 0,
      deck: [makeCard('dk1', 'yellow', '4'), makeCard('dk2', 'red', '5')],
      hands: [
        [makeCard('h1', 'red', '5'), makeCard('h2', 'blue', '6')],
        [makeCard('h3', 'green', '7')],
      ],
    });

    game.drawCards(room, 'p0', 3);
    const counts = countAllCards(room);
    assert.equal(counts.total, 8, 'total cards should be 8 (2 deck + 3 discard + 2 hand0 + 1 hand1)');
    assert.equal(findDuplicates(room).length, 0, 'no duplicate cards');
  });
});

// ─── serializeRoomForPlayer ───────────────────────────────────────

describe('serializeRoomForPlayer', () => {
  it('player sees their own hand', () => {
    const room = makeRoom({
      status: 'playing',
      currentColor: 'blue',
      currentTurn: 0,
      discardPile: [makeCard('top', 'blue', '9')],
      hands: [
        [makeCard('a1', 'red', '1'), makeCard('a2', 'blue', '2')],
        [makeCard('b1', 'green', '3')],
      ],
    });

    const view = game.serializeRoomForPlayer(room, 'p0');
    assert.ok(view.players[0].hand, 'player should have hand array');
    assert.equal(view.players[0].hand.length, 2);
  });

  it('other players do NOT have hand arrays', () => {
    const room = makeRoom({
      players: 3,
      status: 'playing',
      currentColor: 'blue',
      currentTurn: 0,
      discardPile: [makeCard('top', 'blue', '9')],
      hands: [
        [makeCard('a1', 'red', '1')],
        [makeCard('b1', 'green', '3')],
        [makeCard('c1', 'yellow', '4')],
      ],
    });

    const view = game.serializeRoomForPlayer(room, 'p0');
    assert.equal(view.players[1].hand, undefined);
    assert.equal(view.players[2].hand, undefined);
  });

  it('opponents do not expose handCount or hand', () => {
    const room = makeRoom({
      status: 'playing',
      currentColor: 'blue',
      currentTurn: 0,
      discardPile: [makeCard('top', 'blue', '9')],
      hands: [
        [makeCard('a1', 'red', '1'), makeCard('a2', 'blue', '2')],
        [makeCard('b1', 'green', '3'), makeCard('b2', 'yellow', '4'), makeCard('b3', 'red', '5')],
      ],
    });

    const view = game.serializeRoomForPlayer(room, 'p0');
    assert.equal(view.players[1].handCount, undefined, 'handCount should not be exposed');
    assert.equal(view.players[1].hand, undefined, 'hand should not be exposed');
  });

  it('card identities from other hands are not leaked into own view', () => {
    const room = makeRoom({
      status: 'playing',
      currentColor: 'blue',
      currentTurn: 0,
      discardPile: [makeCard('top', 'blue', '9')],
      hands: [
        [makeCard('secret_a', 'red', '1')],
        [makeCard('secret_b', 'green', '3')],
      ],
    });

    const view = game.serializeRoomForPlayer(room, 'p0');
    const serialized = JSON.stringify(view);
    assert.ok(!serialized.includes('secret_b'), 'opponent card id should not appear in serialized state');
  });

  it('includes game state fields', () => {
    const room = makeRoom({
      status: 'playing',
      currentColor: 'yellow',
      currentTurn: 1,
      direction: -1,
      drawStack: 3,
    });
    room.discardPile = [makeCard('top', 'yellow', '7')];

    const view = game.serializeRoomForPlayer(room, 'p0');
    assert.equal(view.status, 'playing');
    assert.equal(view.currentColor, 'yellow');
    assert.equal(view.currentTurn, 1);
    assert.equal(view.direction, -1);
    assert.equal(view.drawStack, 3);
    assert.equal(view.discardTop.id, 'top');
  });
});

// ─── State integrity ──────────────────────────────────────────────

describe('State integrity', () => {
  it('no card exists in two places after initGame', () => {
    const room = makeRoom({ players: 2 });
    game.initGame(room);

    assert.equal(findDuplicates(room).length, 0);
    assert.equal(countAllCards(room).total, 108);
  });

  it('no duplicates after a sequence of plays and draws', () => {
    const room = makeRoom({ players: 2 });
    game.initGame(room);

    const top = room.discardPile[room.discardPile.length - 1];

    // find a card in p0's hand that matches the top card
    const playable = room.players[0].hand.find(
      c => c.color === room.currentColor || c.value === top.value || c.color === 'wild'
    );
    if (playable) {
      game.playCard(room, 'p0', playable.id, playable.color === 'wild' ? 'red' : undefined);
      assert.equal(findDuplicates(room).length, 0);
      assert.equal(countAllCards(room).total, 108);
    }

    // now p1 draws
    game.drawCards(room, 'p1', 1);
    assert.equal(findDuplicates(room).length, 0);
    assert.equal(countAllCards(room).total, 108);
  });

  it('currentTurn always points to a valid player', () => {
    const room = makeRoom({ players: 4 });
    game.initGame(room);

    for (let i = 0; i < 10; i++) {
      assert.ok(room.currentTurn >= 0 && room.currentTurn < room.players.length,
        `currentTurn ${room.currentTurn} out of range after ${i} iterations`);

      // just draw to advance turn
      game.drawCards(room, room.players[room.currentTurn].id, 1);
    }
  });

  it('currentColor is always a valid color', () => {
    const room = makeRoom({ players: 2 });
    game.initGame(room);

    const validColors = ['red', 'blue', 'green', 'yellow'];
    assert.ok(validColors.includes(room.currentColor), `initial currentColor ${room.currentColor} invalid`);

    // play through a few turns
    for (let i = 0; i < 5; i++) {
      const p = room.players[room.currentTurn];
      const playable = p.hand.find(c =>
        c.color === room.currentColor ||
        c.value === room.discardPile[room.discardPile.length - 1].value ||
        c.color === 'wild'
      );
      if (playable) {
        game.playCard(room, p.id, playable.id, playable.color === 'wild' ? 'red' : undefined);
        assert.ok(validColors.includes(room.currentColor),
          `currentColor ${room.currentColor} invalid after play ${i}`);
      } else {
        game.drawCards(room, p.id, 1);
      }
    }
  });

  it('total cards remain 108 after draw + play sequence', () => {
    const room = makeRoom({ players: 2 });
    game.initGame(room);

    // play a valid card
    const top = room.discardPile[room.discardPile.length - 1];
    const playable = room.players[0].hand.find(
      c => c.color === room.currentColor || c.value === top.value || c.color === 'wild'
    );
    if (playable) {
      game.playCard(room, 'p0', playable.id, playable.color === 'wild' ? 'red' : undefined);
      assert.equal(countAllCards(room).total, 108);
    }

    // p1 draws
    game.drawCards(room, 'p1', 1);
    assert.equal(countAllCards(room).total, 108);
  });

  it('game status remains valid through play sequence', () => {
    const room = makeRoom({ players: 2 });
    game.initGame(room);
    assert.equal(room.status, 'playing');

    // play/draw a few turns
    for (let i = 0; i < 4; i++) {
      const p = room.players[room.currentTurn];
      if (!p || room.status !== 'playing') break;

      const top = room.discardPile[room.discardPile.length - 1];
      const playable = p.hand.find(c =>
        c.color === room.currentColor ||
        c.value === top.value ||
        c.color === 'wild'
      );
      if (playable) {
        game.playCard(room, p.id, playable.id, playable.color === 'wild' ? 'green' : undefined);
      } else {
        game.drawCards(room, p.id, 1);
      }
    }

    assert.ok(room.status === 'playing' || room.status === 'finished');
  });
});

// ─── Elimination system ─────────────────────────────────────────

describe('Elimination system', () => {
  function setupElimination(numPlayers = 4) {
    const hands = [];
    for (let i = 0; i < numPlayers; i++) {
      hands.push([makeCard(`h${i}`, 'blue', String(i))]);
    }
    return makeRoom({
      players: numPlayers,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'blue',
      discardPile: [makeCard('top', 'blue', '9')],
      drawStack: 0,
      hands,
    });
  }

  it('1. first player to empty hand gets 1st place', () => {
    const room = setupElimination(4);
    room.players[0].hand = [makeCard('last', 'blue', '5')];
    const result = game.playCard(room, 'p0', 'last');
    assert.equal(result.error, undefined);
    assert.equal(room.players[0].eliminated, true);
    assert.equal(room.players[0].finishPosition, 1);
    assert.deepEqual(room.finishOrder, ['p0']);
  });

  it('2. eliminated player is removed from turn rotation', () => {
    const room = setupElimination(4);
    room.players[0].hand = [makeCard('last', 'blue', '5')];
    game.playCard(room, 'p0', 'last');
    assert.notEqual(room.currentTurn, 0);
    assert.ok(room.players[room.currentTurn].eliminated !== true);
  });

  it('3. eliminated player cannot play', () => {
    const room = setupElimination(4);
    room.players[0].hand = [makeCard('last', 'blue', '5')];
    game.playCard(room, 'p0', 'last');
    const r = game.playCard(room, 'p0', 'h0');
    assert.ok(r.error);
  });

  it('4. eliminated player cannot draw', () => {
    const room = setupElimination(4);
    room.players[0].hand = [makeCard('last', 'blue', '5')];
    game.playCard(room, 'p0', 'last');
    room.currentTurn = 0;
    const r = game.drawCards(room, 'p0', 1);
    assert.ok(r.error);
  });

  it('5. second player to empty hand gets 2nd place', () => {
    const room = setupElimination(4);
    room.players[0].hand = [makeCard('last0', 'blue', '5')];
    game.playCard(room, 'p0', 'last0');

    const activeTurn = room.currentTurn;
    room.players[activeTurn].hand = [makeCard('last1', 'blue', String(activeTurn))];
    game.playCard(room, room.players[activeTurn].id, 'last1');

    assert.equal(room.players[activeTurn].eliminated, true);
    assert.equal(room.players[activeTurn].finishPosition, 2);
    assert.deepEqual(room.finishOrder, ['p0', room.players[activeTurn].id]);
  });

  it('6. third player gets 3rd place, last player loses', () => {
    const room = setupElimination(4);

    room.players[0].hand = [makeCard('l0', 'blue', '5')];
    game.playCard(room, 'p0', 'l0');

    const t1 = room.currentTurn;
    room.players[t1].hand = [makeCard('l1', 'blue', String(t1))];
    game.playCard(room, room.players[t1].id, 'l1');

    const t2 = room.currentTurn;
    room.players[t2].hand = [makeCard('l2', 'blue', String(t2))];
    const result = game.playCard(room, room.players[t2].id, 'l2');

    assert.equal(result.gameOver, true);
    assert.equal(room.status, 'finished');
    assert.equal(room.finishOrder.length, 4);
    assert.ok(room.winner);
    assert.ok(room.loser);
    assert.notEqual(room.winner, room.loser);
  });

  it('7. 2-player: first to empty hand wins, second is final loser', () => {
    const room = setupElimination(2);
    room.players[0].hand = [makeCard('last', 'blue', '5')];
    const result = game.playCard(room, 'p0', 'last');
    assert.equal(result.gameOver, true);
    assert.equal(room.status, 'finished');
    assert.equal(room.winner, 'p0');
    assert.equal(room.loser, 'p1');
    assert.deepEqual(room.finishOrder, ['p0', 'p1']);
  });

  it('8. 3-player: elimination continues until one remains', () => {
    const room = setupElimination(3);

    room.players[0].hand = [makeCard('l0', 'blue', '5')];
    game.playCard(room, 'p0', 'l0');

    const t1 = room.currentTurn;
    room.players[t1].hand = [makeCard('l1', 'blue', String(t1))];
    const result = game.playCard(room, room.players[t1].id, 'l1');

    assert.equal(result.gameOver, true);
    assert.equal(room.status, 'finished');
    assert.equal(room.finishOrder.length, 3);
  });

  it('9. 4-player: all positions correctly assigned', () => {
    const room = setupElimination(4);
    const order = [];

    room.players[0].hand = [makeCard('l0', 'blue', '5')];
    game.playCard(room, 'p0', 'l0');
    order.push('p0');

    for (let i = 0; i < 2; i++) {
      const t = room.currentTurn;
      const pid = room.players[t].id;
      room.players[t].hand = [makeCard(`lx${i}`, 'blue', String(t))];
      game.playCard(room, pid, `lx${i}`);
      order.push(pid);
    }

    assert.equal(room.status, 'finished');
    assert.equal(room.finishOrder.length, 4);
    assert.deepEqual(room.finishOrder.slice(0, 3), order);
  });

  it('10. eliminated players get correct finishPosition', () => {
    const room = setupElimination(3);

    room.players[0].hand = [makeCard('l0', 'blue', '5')];
    game.playCard(room, 'p0', 'l0');

    const t1 = room.currentTurn;
    room.players[t1].hand = [makeCard('l1', 'blue', String(t1))];
    game.playCard(room, room.players[t1].id, 'l1');

    assert.equal(room.players[0].finishPosition, 1);
    assert.equal(room.players[t1].finishPosition, 2);
    const loser = room.players.find(p => p.finishPosition === 3);
    assert.ok(loser);
  });

  it('11. final winner is the FIRST player to empty hand', () => {
    const room = setupElimination(3);

    room.players[0].hand = [makeCard('l0', 'blue', '5')];
    game.playCard(room, 'p0', 'l0');

    const t1 = room.currentTurn;
    room.players[t1].hand = [makeCard('l1', 'blue', String(t1))];
    game.playCard(room, room.players[t1].id, 'l1');

    assert.equal(room.winner, 'p0');
  });

  it('12. final loser is the LAST remaining player', () => {
    const room = setupElimination(3);

    room.players[0].hand = [makeCard('l0', 'blue', '5')];
    game.playCard(room, 'p0', 'l0');

    const t1 = room.currentTurn;
    room.players[t1].hand = [makeCard('l1', 'blue', String(t1))];
    game.playCard(room, room.players[t1].id, 'l1');

    const eliminatedIds = room.finishOrder;
    const loser = room.players.find(p => !eliminatedIds.includes(p.id) || p.id === room.loser);
    assert.equal(room.loser, room.players.find(p => p.finishPosition === 3)?.id);
  });

  it('13. reverse works correctly with eliminated players', () => {
    const room = setupElimination(4);
    room.players[0].hand = [
      makeCard('rev', 'blue', 'reverse'),
      makeCard('extra', 'blue', '7'),
    ];
    game.playCard(room, 'p0', 'rev');
    assert.equal(room.direction, -1);
    assert.ok(room.players[room.currentTurn].eliminated !== true);
  });

  it('14. skip works correctly with eliminated players', () => {
    const room = setupElimination(3);
    room.players[0].hand = [makeCard('sk', 'blue', 'skip')];
    game.playCard(room, 'p0', 'sk');
    assert.ok(room.players[room.currentTurn].eliminated !== true);
    assert.notEqual(room.currentTurn, 0);
  });

  it('15. draw2 works correctly with eliminated players', () => {
    const room = setupElimination(3);
    room.players[0].hand = [makeCard('d2', 'blue', 'draw2')];
    game.playCard(room, 'p0', 'd2');
    assert.equal(room.drawStack, 2);
    assert.ok(room.players[room.currentTurn].eliminated !== true);
  });

  it('16. initGame resets elimination state', () => {
    const room = makeRoom({ players: 3 });
    room.players[0].eliminated = true;
    room.players[0].finishPosition = 1;
    room.finishOrder = ['p0'];
    room.winner = 'p0';
    room.loser = 'p1';
    game.initGame(room);
    for (const p of room.players) {
      assert.equal(p.eliminated, false);
      assert.equal(p.finishPosition, null);
    }
    assert.deepEqual(room.finishOrder, []);
    assert.equal(room.winner, null);
    assert.equal(room.loser, null);
  });

  it('17. serializeRoomForPlayer includes elimination data', () => {
    const room = setupElimination(2);
    room.players[0].eliminated = true;
    room.players[0].finishPosition = 1;
    room.finishOrder = ['p0'];
    const view = game.serializeRoomForPlayer(room, 'p1');
    assert.equal(view.players[0].eliminated, true);
    assert.equal(view.players[0].finishPosition, 1);
    assert.equal(view.players[1].eliminated, false);
    assert.deepEqual(view.finishOrder, ['p0']);
  });

  it('18. getActivePlayers returns only non-eliminated', () => {
    const room = setupElimination(4);
    room.players[1].eliminated = true;
    room.players[2].eliminated = true;
    const active = game.getActivePlayers(room);
    assert.equal(active.length, 2);
    assert.ok(active.every(p => !p.eliminated));
  });

  it('19. drawCards skips eliminated players in turn advancement', () => {
    const room = setupElimination(3);
    room.players[0].eliminated = true;
    room.currentTurn = 1;
    room.players[1].hand = [makeCard('h1', 'blue', '1')];
    game.drawCards(room, 'p1', 1);
    assert.ok(room.players[room.currentTurn].eliminated !== true);
    assert.notEqual(room.currentTurn, 0);
  });

  it('20. finish order is preserved as array of player IDs', () => {
    const room = setupElimination(2);
    assert.ok(Array.isArray(room.finishOrder));
    room.players[0].hand = [makeCard('last', 'blue', '5')];
    game.playCard(room, 'p0', 'last');
    assert.ok(Array.isArray(room.finishOrder));
    assert.equal(room.finishOrder.length, 2);
  });
});

// ─── UNO call/penalty system ────────────────────────────────────

describe('UNO call/penalty system', () => {
  function setupUno(numPlayers = 2) {
    const hands = [];
    for (let i = 0; i < numPlayers; i++) {
      hands.push([makeCard(`h${i}`, 'blue', String(i))]);
    }
    return makeRoom({
      players: numPlayers,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'blue',
      discardPile: [makeCard('top', 'blue', '9')],
      drawStack: 0,
      hands,
    });
  }

  it('1. player starts with unoCalled = false', () => {
    const room = setupUno(2);
    assert.equal(room.players[0].unoCalled, false);
  });

  it('2. call_uno works with exactly 1 card', () => {
    const room = setupUno(2);
    room.players[0].hand = [makeCard('last', 'blue', '5')];
    const result = game.callUno(room, 'p0');
    assert.equal(result.error, undefined);
    assert.equal(result.called, true);
    assert.equal(room.players[0].unoCalled, true);
  });

  it('3. call_uno rejected when player has >1 card', () => {
    const room = setupUno(2);
    room.players[0].hand = [makeCard('a', 'blue', '1'), makeCard('b', 'blue', '2')];
    const result = game.callUno(room, 'p0');
    assert.ok(result.error);
    assert.equal(room.players[0].unoCalled, false);
  });

  it('4. duplicate UNO call rejected', () => {
    const room = setupUno(2);
    room.players[0].hand = [makeCard('last', 'blue', '5')];
    game.callUno(room, 'p0');
    const result = game.callUno(room, 'p0');
    assert.ok(result.error);
  });

  it('5. successful catch when target has exactly 1 card', () => {
    const room = setupUno(2);
    room.players[0].hand = [makeCard('last', 'blue', '5')];
    room.deck = [makeCard('pen1', 'red', '1'), makeCard('pen2', 'green', '2'), makeCard('pen3', 'blue', '3'), makeCard('pen4', 'yellow', '4'), makeCard('pen5', 'red', '5')];
    const handBefore = room.players[0].hand.length;
    const result = game.catchUno(room, 'p1', 'p0');
    assert.equal(result.error, undefined);
    assert.equal(result.success, true);
    assert.equal(room.players[0].hand.length, handBefore + 5);
  });

  it('6. wrong catch penalizes catcher when target has >1 card', () => {
    const room = setupUno(2);
    room.players[0].hand = [makeCard('a', 'blue', '1'), makeCard('b', 'blue', '2')];
    room.deck = [makeCard('pen1', 'red', '1'), makeCard('pen2', 'green', '2'), makeCard('pen3', 'blue', '3'), makeCard('pen4', 'yellow', '4'), makeCard('pen5', 'red', '5')];
    const catcherHandBefore = room.players[1].hand.length;
    const targetHandBefore = room.players[0].hand.length;
    const result = game.catchUno(room, 'p1', 'p0');
    assert.equal(result.error, undefined);
    assert.equal(result.success, false);
    assert.equal(room.players[1].hand.length, catcherHandBefore + 5, 'catcher gets +5 penalty');
    assert.equal(room.players[0].hand.length, targetHandBefore, 'target unchanged');
  });

  it('8. eliminated players cannot call UNO', () => {
    const room = setupUno(2);
    room.players[0].hand = [makeCard('last', 'blue', '5')];
    room.players[0].eliminated = true;
    const result = game.callUno(room, 'p0');
    assert.ok(result.error);
  });

  it('9. eliminated players cannot be caught', () => {
    const room = setupUno(2);
    room.players[0].hand = [makeCard('last', 'blue', '5')];
    room.players[0].eliminated = true;
    const result = game.catchUno(room, 'p1', 'p0');
    assert.ok(result.error);
  });

  it('10. unoCalled resets when new card is played', () => {
    const room = setupUno(2);
    room.players[0].hand = [
      makeCard('last', 'blue', '5'),
      makeCard('extra', 'blue', '6'),
    ];
    room.players[0].unoCalled = true;
    game.playCard(room, 'p0', 'extra');
    assert.equal(room.players[0].unoCalled, false);
  });
});

// ─── Multi-card draw ────────────────────────────────────────────

describe('Multi-card draw', () => {
  function setupMultiDraw() {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'blue',
      discardPile: [makeCard('top', 'blue', '9')],
      drawStack: 0,
      hands: [[], []],
    });
    return room;
  }

  it('1. same-color cards can be drawn together', () => {
    const room = setupMultiDraw();
    room.deck = [
      makeCard('d1', 'blue', '1'),
      makeCard('d2', 'blue', '3'),
      makeCard('d3', 'blue', '5'),
      makeCard('d4', 'red', '7'),
    ];
    const result = game.drawMatchingCards(room, 'p0');
    assert.equal(result.drawn.length, 3);
    assert.equal(room.players[0].hand.length, 3);
  });

  it('2. same-value cards can be drawn together', () => {
    const room = setupMultiDraw();
    room.deck = [
      makeCard('d1', 'red', '8'),
      makeCard('d2', 'blue', '8'),
      makeCard('d3', 'green', '8'),
      makeCard('d4', 'yellow', '3'),
    ];
    const result = game.drawMatchingCards(room, 'p0');
    assert.equal(result.drawn.length, 3);
  });

  it('3. sequence stops when neither color nor value matches (chain matching)', () => {
    const room = setupMultiDraw();
    room.deck = [
      makeCard('d1', 'red', '5'),
      makeCard('d2', 'blue', '5'),
      makeCard('d3', 'blue', '7'),
      makeCard('d4', 'green', '9'),
    ];
    const result = game.drawMatchingCards(room, 'p0');
    assert.equal(result.drawn.length, 3, 'Red 5, Blue 5 (value match), Blue 7 (color match with Blue 5)');
    assert.equal(result.drawn[0].id, 'd1');
    assert.equal(result.drawn[1].id, 'd2');
    assert.equal(result.drawn[2].id, 'd3');
  });

  it('4. wild does not match everything', () => {
    const room = setupMultiDraw();
    room.deck = [
      makeCard('d1', 'blue', '1'),
      makeCard('d2', 'wild', 'wild'),
    ];
    const result = game.drawMatchingCards(room, 'p0');
    assert.equal(result.drawn.length, 1);
  });

  it('5. +2/+4 draw stack behavior unchanged', () => {
    const room = setupMultiDraw();
    room.drawStack = 2;
    room.deck = [
      makeCard('d1', 'blue', '1'),
      makeCard('d2', 'blue', '3'),
    ];
    const result = game.drawMatchingCards(room, 'p0');
    assert.equal(result.drawn.length, 2);
    assert.equal(room.drawStack, 0);
  });

  it('6. turn advances exactly once after multi-draw', () => {
    const room = setupMultiDraw();
    room.deck = [
      makeCard('d1', 'blue', '1'),
      makeCard('d2', 'blue', '3'),
      makeCard('d3', 'red', '7'),
    ];
    game.drawMatchingCards(room, 'p0');
    assert.equal(room.currentTurn, 1);
  });

  it('7. draws at least 1 card even if deck has matching cards', () => {
    const room = setupMultiDraw();
    room.deck = [makeCard('d1', 'red', '7')];
    const result = game.drawMatchingCards(room, 'p0');
    assert.equal(result.drawn.length, 1);
  });

  it('8. works when deck is empty (reshuffles)', () => {
    const room = setupMultiDraw();
    room.deck = [];
    room.discardPile = [
      makeCard('top', 'blue', '9'),
      makeCard('d1', 'red', '1'),
      makeCard('d2', 'green', '2'),
      makeCard('d3', 'blue', '3'),
    ];
    const result = game.drawMatchingCards(room, 'p0');
    assert.ok(result.drawn.length >= 1);
  });
});

// ─── Play Again ─────────────────────────────────────────────────

describe('Play Again', () => {
  it('1. finished game can restart', () => {
    const room = makeRoom({
      players: 2,
      status: 'finished',
      currentTurn: 0,
      currentColor: 'blue',
      discardPile: [makeCard('top', 'blue', '9')],
      drawStack: 0,
      hands: [[], []],
      finishOrder: ['p0', 'p1'],
      winner: 'p0',
      loser: 'p1',
    });
    room.players[0].eliminated = true;
    room.players[1].eliminated = true;
    room.players[0].finishPosition = 1;
    room.players[1].finishPosition = 2;

    const result = game.playAgain(room);
    assert.equal(result.error, undefined);
    assert.equal(room.status, 'playing');
  });

  it('2. new deck is generated', () => {
    const room = makeRoom({
      players: 2,
      status: 'finished',
      currentTurn: 0,
      currentColor: 'blue',
      discardPile: [makeCard('top', 'blue', '9')],
      drawStack: 0,
      hands: [[], []],
    });
    game.playAgain(room);
    assert.ok(room.deck.length > 0);
    assert.ok(room.discardPile.length >= 1);
  });

  it('3. all players receive 7 cards', () => {
    const room = makeRoom({
      players: 3,
      status: 'finished',
      currentTurn: 0,
      currentColor: 'blue',
      discardPile: [makeCard('top', 'blue', '9')],
      drawStack: 0,
      hands: [[], [], []],
    });
    game.playAgain(room);
    for (const p of room.players) {
      assert.equal(p.hand.length, 7);
    }
  });

  it('4. eliminated state resets', () => {
    const room = makeRoom({
      players: 2,
      status: 'finished',
      currentTurn: 0,
      currentColor: 'blue',
      discardPile: [makeCard('top', 'blue', '9')],
      drawStack: 0,
      hands: [[], []],
    });
    room.players[0].eliminated = true;
    room.players[1].eliminated = true;
    game.playAgain(room);
    for (const p of room.players) {
      assert.equal(p.eliminated, false);
    }
  });

  it('5. finish order resets', () => {
    const room = makeRoom({
      players: 2,
      status: 'finished',
      currentTurn: 0,
      currentColor: 'blue',
      discardPile: [makeCard('top', 'blue', '9')],
      drawStack: 0,
      hands: [[], []],
      finishOrder: ['p0', 'p1'],
    });
    game.playAgain(room);
    assert.deepEqual(room.finishOrder, []);
  });

  it('6. winner/loser reset', () => {
    const room = makeRoom({
      players: 2,
      status: 'finished',
      currentTurn: 0,
      currentColor: 'blue',
      discardPile: [makeCard('top', 'blue', '9')],
      drawStack: 0,
      hands: [[], []],
      winner: 'p0',
      loser: 'p1',
    });
    game.playAgain(room);
    assert.equal(room.winner, null);
    assert.equal(room.loser, null);
  });

  it('7. current turn is valid', () => {
    const room = makeRoom({
      players: 3,
      status: 'finished',
      currentTurn: 0,
      currentColor: 'blue',
      discardPile: [makeCard('top', 'blue', '9')],
      drawStack: 0,
      hands: [[], [], []],
    });
    game.playAgain(room);
    assert.ok(room.currentTurn >= 0 && room.currentTurn < 3);
  });

  it('8. cannot restart non-finished game', () => {
    const room = makeRoom({
      players: 2,
      status: 'playing',
      currentTurn: 0,
      currentColor: 'blue',
      discardPile: [makeCard('top', 'blue', '9')],
      drawStack: 0,
      hands: [[makeCard('h0', 'blue', '1')], [makeCard('h1', 'blue', '2')]],
    });
    const result = game.playAgain(room);
    assert.ok(result.error);
  });

  it('9. unoCalled resets on play again', () => {
    const room = makeRoom({
      players: 2,
      status: 'finished',
      currentTurn: 0,
      currentColor: 'blue',
      discardPile: [makeCard('top', 'blue', '9')],
      drawStack: 0,
      hands: [[], []],
    });
    room.players[0].unoCalled = true;
    game.playAgain(room);
    for (const p of room.players) {
      assert.equal(p.unoCalled, false);
    }
  });
});
