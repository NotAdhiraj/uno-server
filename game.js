const COLORS = ['red', 'blue', 'green', 'yellow'];

let cardIdCounter = 0;

function nextId() {
  return `card_${++cardIdCounter}`;
}

function buildDeck() {
  const deck = [];

  for (const color of COLORS) {
    deck.push({ id: nextId(), color, value: '0' });
    for (let i = 0; i < 2; i++) {
      for (const value of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2']) {
        deck.push({ id: nextId(), color, value });
      }
    }
  }

  for (let i = 0; i < 4; i++) {
    deck.push({ id: nextId(), color: 'wild', value: 'wild' });
    deck.push({ id: nextId(), color: 'wild', value: 'wild4' });
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function drawFromDeck(room, count) {
  ensureDeck(room, count);
  const drawn = room.deck.splice(0, count);
  return drawn;
}

function initGame(room) {
  room.deck = buildDeck();
  room.discardPile = [];
  room.direction = 1;
  room.drawStack = 0;
  room.drawStackType = null;
  room.currentTurn = 0;
  room.winner = null;
  room.loser = null;
  room.finishOrder = [];

  for (const player of room.players) {
    player.hand = drawFromDeck(room, 7);
    player.eliminated = false;
    player.finishPosition = null;
    player.unoCalled = false;
  }

  let startCard;
  do {
    startCard = room.deck.pop();
    if (startCard.color === 'wild' || !/^\d+$/.test(startCard.value)) {
      room.deck.unshift(startCard);
      for (let i = room.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [room.deck[i], room.deck[j]] = [room.deck[j], room.deck[i]];
      }
      startCard = null;
    }
  } while (!startCard);

  room.discardPile.push(startCard);
  room.currentColor = startCard.color;
  room.status = 'playing';

  console.log(`[GAME] Room ${room.code} started. First card: ${startCard.color} ${startCard.value}`);
  return room;
}

function topCard(room) {
  return room.discardPile[room.discardPile.length - 1];
}

function getActivePlayers(room) {
  return room.players.filter(p => !p.eliminated);
}

function isTurnEligible(player) {
  return !player.eliminated && player.isConnected !== false;
}

function advanceTurn(room) {
  const count = room.players.length;
  let nextIdx = room.currentTurn;
  let safety = 0;
  do {
    nextIdx = (nextIdx + room.direction + count) % count;
    safety++;
  } while (!isTurnEligible(room.players[nextIdx]) && nextIdx !== room.currentTurn && safety <= count);
  room.currentTurn = nextIdx;
}

function getNextTurn(room) {
  const count = room.players.length;
  let nextIdx = room.currentTurn;
  let safety = 0;
  do {
    nextIdx = (nextIdx + room.direction + count) % count;
    safety++;
  } while (!isTurnEligible(room.players[nextIdx]) && nextIdx !== room.currentTurn && safety <= count);
  return nextIdx;
}

function isValidPlay(room, playerId, card) {
  if (room.status !== 'playing') return false;

  const playerIdx = room.players.findIndex(p => p.id === playerId);
  if (playerIdx === -1) return false;
  if (room.currentTurn !== playerIdx) return false;

  const player = room.players[playerIdx];
  if (!player.hand.some(c => c.id === card.id)) return false;

  const top = topCard(room);

  if (room.drawStack > 0) {
    if (room.drawStackType === 'wild4') {
      return card.value === 'wild4';
    }
    return card.value === 'draw2' || card.value === 'wild4';
  }

  if (card.color === 'wild') return true;
  if (card.color === room.currentColor) return true;
  if (card.value === top.value) return true;

  return false;
}

function playCard(room, playerId, cardId, chosenColor) {
  const playerIdx = room.players.findIndex(p => p.id === playerId);
  if (playerIdx === -1) return { error: 'Player not in room' };
  if (room.currentTurn !== playerIdx) return { error: 'Not your turn' };
  if (room.status !== 'playing') return { error: 'Game not in progress' };

  const player = room.players[playerIdx];
  if (player.eliminated) return { error: 'Player eliminated' };

  const cardIdx = player.hand.findIndex(c => c.id === cardId);
  if (cardIdx === -1) return { error: 'Card not in hand' };

  const card = player.hand[cardIdx];

  if (!isValidPlay(room, playerId, card)) {
    return { error: 'Invalid play' };
  }

  if ((card.value === 'wild' || card.value === 'wild4') && !COLORS.includes(chosenColor)) {
    return { error: 'Must choose a valid color (red, blue, green, yellow)' };
  }

  if (player.hand.length === 1 && isPowerCard(card)) {
    return { error: 'Power cards cannot be used as the final card' };
  }

  player.hand.splice(cardIdx, 1);
  room.discardPile.push(card);

  if (card.value === 'wild' || card.value === 'wild4') {
    room.currentColor = chosenColor;
  } else {
    room.currentColor = card.color;
  }

  player.unoCalled = false;

  console.log(`[GAME] Room ${room.code}: "${player.name}" played ${card.color} ${card.value}`);

  const playerCount = room.players.length;

  if (card.value === 'draw2') {
    room.drawStack += 2;
    room.drawStackType = 'draw2';
  } else if (card.value === 'wild4') {
    room.drawStack += 4;
    room.drawStackType = 'wild4';
  } else if (card.value === 'reverse' && playerCount > 2) {
    room.direction *= -1;
  }

  if (player.hand.length === 0) {
    const activeCount = room.players.filter(p => !p.eliminated).length;
    const finishPosition = room.players.length - activeCount + 1;
    player.eliminated = true;
    player.finishPosition = finishPosition;
    room.finishOrder.push(player.id);
    console.log(`[GAME] Room ${room.code}: "${player.name}" finished #${finishPosition}`);

    if (activeCount - 1 === 1) {
      const lastPlayer = room.players.find(p => !p.eliminated);
      lastPlayer.eliminated = true;
      lastPlayer.finishPosition = room.players.length;
      room.finishOrder.push(lastPlayer.id);
      room.status = 'finished';
      room.winner = room.finishOrder[0];
      room.loser = lastPlayer.id;
      console.log(`[GAME] Room ${room.code}: Game over. Winner: "${room.players.find(p => p.id === room.winner)?.name}", Loser: "${lastPlayer.name}"`);
      return { room, eliminated: player, gameOver: true };
    }

    advanceTurn(room);
    return { room, eliminated: player, gameOver: false };
  }

  if (card.value === 'reverse') {
    if (playerCount === 2) {
      room.currentTurn = (room.currentTurn + 2) % playerCount;
    } else {
      advanceTurn(room);
    }
  } else if (card.value === 'skip') {
    // Skip one eligible (connected + non-eliminated) player: advance twice,
    // each step landing only on eligible players. This keeps 2-player
    // behavior (turn returns to the same player) without index arithmetic
    // that would count eliminated/disconnected players as participants.
    advanceTurn(room);
    advanceTurn(room);
  } else {
    advanceTurn(room);
  }

  return { room };
}

const ACTION_CARD_VALUES = ['draw2', 'wild4', 'skip', 'reverse'];
const POWER_CARD_VALUES = ['skip', 'reverse', 'draw2', 'wild', 'wild4'];
const NUMBER_CARD_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

function isPowerCard(card) {
  return POWER_CARD_VALUES.includes(card.value);
}

function isNumberCard(card) {
  return NUMBER_CARD_VALUES.includes(card.value);
}

function isValidMultiPlay(room, playerId, cardIds) {
  if (!Array.isArray(cardIds) || cardIds.length < 2) {
    return { valid: false, error: 'Multi-card play requires at least 2 cards' };
  }

  if (room.status !== 'playing') {
    return { valid: false, error: 'Game not in progress' };
  }

  const playerIdx = room.players.findIndex(p => p.id === playerId);
  if (playerIdx === -1) return { valid: false, error: 'Player not in room' };
  if (room.currentTurn !== playerIdx) return { valid: false, error: 'Not your turn' };

  const player = room.players[playerIdx];
  if (player.eliminated) return { valid: false, error: 'Player eliminated' };
  if (!player.isConnected) return { valid: false, error: 'Not connected' };

  const uniqueIds = new Set(cardIds);
  if (uniqueIds.size !== cardIds.length) {
    return { valid: false, error: 'Duplicate card IDs not allowed' };
  }

  const cards = [];
  for (const id of cardIds) {
    const card = player.hand.find(c => c.id === id);
    if (!card) return { valid: false, error: `Card ${id} not in your hand` };
    cards.push(card);
  }

  // Wild cards (wild, wild4) cannot be in multi-play
  for (const card of cards) {
    if (card.color === 'wild' || card.value === 'wild4') {
      return { valid: false, error: 'Wild cards cannot be combined in a multi-card play' };
    }
  }

  // Capture the ORIGINAL game state BEFORE any validation
  // This is critical: every card must be validated against this original state
  const originalTop = topCard(room);
  const originalColor = room.currentColor;

  // Check for mixed card types (number + action card in same group)
  const hasNumberCard = cards.some(c => isNumberCard(c));
  const hasActionCard = cards.some(c => !isNumberCard(c));
  if (hasNumberCard && hasActionCard) {
    return { valid: false, error: 'Cannot mix number cards and action cards in a multi-card play' };
  }

  // For action cards: only same-value grouping allowed (skip+skip, reverse+reverse, draw2+draw2)
  const isActionCard = !isNumberCard(cards[0]);

  if (isActionCard) {
    const firstValue = cards[0].value;
    const allSameValue = cards.every(c => c.value === firstValue);
    if (!allSameValue) {
      return { valid: false, error: 'Action cards must all have the same value' };
    }
  }

  // During an active draw stack, only draw2 cards can be played
  // (wild4 is already excluded above)
  if (room.drawStack > 0) {
    if (!cards.every(c => c.value === 'draw2')) {
      return { valid: false, error: 'Only Draw Two cards can be played during an active draw stack' };
    }
    return { valid: true, cards };
  }

  // BATCH COHERENCE: all cards must form ONE valid homogeneous batch
  // COLOR BATCH: every card shares the current playable color
  // VALUE BATCH: every card shares the same value (any value)
  const allSameColor = cards.every(c => c.color === originalColor);
  const allSameValue = cards.every(c => c.value === cards[0].value);

  if (!allSameColor && !allSameValue) {
    return { valid: false, error: 'Selected cards do not form a valid batch' };
  }

  // At least one card must be individually playable against the original state
  // This anchors the batch to the current game state
  const hasPlayableCard = cards.some(card => {
    return card.color === originalColor || card.value === originalTop.value;
  });

  if (!hasPlayableCard) {
    return { valid: false, error: 'No card in the batch is playable against the current discard' };
  }

  return { valid: true, cards };
}

function playMultipleCards(room, playerId, cardIds, chosenColor) {
  const validation = isValidMultiPlay(room, playerId, cardIds);
  if (!validation.valid) return { error: validation.error };

  const player = room.players.find(p => p.id === playerId);
  const cards = validation.cards;

  // Final power card check: if playing these cards empties the hand, all must be number cards
  if (player.hand.length === cards.length) {
    const allPower = cards.every(c => isPowerCard(c));
    if (allPower) {
      return { error: 'Power cards cannot be used as the final card' };
    }
  }

  for (const card of cards) {
    const idx = player.hand.findIndex(c => c.id === card.id);
    player.hand.splice(idx, 1);
    room.discardPile.push(card);
  }

  const lastCard = cards[cards.length - 1];
  room.currentColor = lastCard.color;
  player.unoCalled = false;

  console.log(`[GAME] Room ${room.code}: "${player.name}" played ${cards.length} cards: ${cards.map(c => `${c.color} ${c.value}`).join(', ')}`);

  const playerCount = room.players.length;

  if (player.hand.length === 0) {
    const activeCount = room.players.filter(p => !p.eliminated).length;
    const finishPosition = room.players.length - activeCount + 1;
    player.eliminated = true;
    player.finishPosition = finishPosition;
    room.finishOrder.push(player.id);
    console.log(`[GAME] Room ${room.code}: "${player.name}" finished #${finishPosition}`);

    if (activeCount - 1 === 1) {
      const lastPlayer = room.players.find(p => !p.eliminated);
      lastPlayer.eliminated = true;
      lastPlayer.finishPosition = room.players.length;
      room.finishOrder.push(lastPlayer.id);
      room.status = 'finished';
      room.winner = room.finishOrder[0];
      room.loser = lastPlayer.id;
      console.log(`[GAME] Room ${room.code}: Game over. Winner: "${room.players.find(p => p.id === room.winner)?.name}", Loser: "${lastPlayer.name}"`);
      return { room, eliminated: player, gameOver: true };
    }

    advanceTurn(room);
    return { room, eliminated: player, gameOver: false };
  }

  // Handle action card effects for multi-card plays
  const firstCardValue = cards[0].value;

  if (firstCardValue === 'reverse') {
    const reverseCount = cards.length;
    if (playerCount > 2) {
      // Odd number of reverses: flip direction. Even: no change.
      if (reverseCount % 2 === 1) {
        room.direction *= -1;
      }
      advanceTurn(room);
    }
    // In 2-player, reverse = skip (same player goes again). Don't advance turn.
  } else if (firstCardValue === 'skip') {
    const skipCount = cards.length;
    // N consecutive skips = skip N eligible players: advance N+1 times so
    // each step lands only on connected, non-eliminated players.
    for (let i = 0; i <= skipCount; i++) {
      advanceTurn(room);
    }
  } else if (firstCardValue === 'draw2') {
    room.drawStack += cards.length * 2;
    room.drawStackType = 'draw2';
    advanceTurn(room);
  } else {
    advanceTurn(room);
  }

  return { room };
}

function drawCards(room, playerId, count) {
  const playerIdx = room.players.findIndex(p => p.id === playerId);
  if (playerIdx === -1) return { error: 'Player not in room' };
  if (room.currentTurn !== playerIdx) return { error: 'Not your turn' };
  if (room.status !== 'playing') return { error: 'Game not in progress' };

  const player = room.players[playerIdx];
  if (player.eliminated) return { error: 'Player eliminated' };

  const drawn = drawFromDeck(room, count);
  player.hand.push(...drawn);

  const wasStacking = room.drawStack > 0;
  room.drawStack = 0;
  room.drawStackType = null;
  advanceTurn(room);

  console.log(`[GAME] Room ${room.code}: "${player.name}" drew ${count} card${count > 1 ? 's' : ''}${wasStacking ? ' (stack resolved)' : ''}`);
  return { room, drawn, turnKept: false };
}

function ensureDeck(room, needed = 1) {
  if (room.deck.length >= needed) return;
  const top = room.discardPile.pop();
  room.deck.push(...room.discardPile);
  room.discardPile = top ? [top] : [];
  for (let i = room.deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [room.deck[i], room.deck[j]] = [room.deck[j], room.deck[i]];
  }
}

function drawMatchingCards(room, playerId) {
  const playerIdx = room.players.findIndex(p => p.id === playerId);
  if (playerIdx === -1) return { error: 'Player not in room' };
  if (room.currentTurn !== playerIdx) return { error: 'Not your turn' };
  if (room.status !== 'playing') return { error: 'Game not in progress' };

  const player = room.players[playerIdx];
  if (player.eliminated) return { error: 'Player eliminated' };

  if (room.drawStack > 0) {
    return drawCards(room, playerId, room.drawStack);
  }

  const drawn = [];
  let matchValue = null;

  while (room.deck.length > 0 || room.discardPile.length > 1) {
    ensureDeck(room, 1);
    if (room.deck.length === 0) break;

    const card = room.deck[0];

    if (card.color === 'wild') break;

    if (drawn.length === 0) {
      drawn.push(room.deck.shift());
      matchValue = card.value;
      continue;
    }

    // Multi-card DRAW rule: same VALUE only. Color is irrelevant, so a
    // same-color card with a different value (e.g. Red 7 after Red 5)
    // stops the chain.
    if (card.value === matchValue) {
      drawn.push(room.deck.shift());
    } else {
      break;
    }
  }

  if (drawn.length === 0) {
    ensureDeck(room, 1);
    const card = room.deck.shift();
    if (card) drawn.push(card);
  }

  player.hand.push(...drawn);

  const turnKept = drawn.length === 1 && isValidPlay(room, playerId, drawn[0]);
  if (!turnKept) {
    advanceTurn(room);
  }

  console.log(`[GAME] Room ${room.code}: "${player.name}" drew ${drawn.length} card${drawn.length > 1 ? 's' : ''}${turnKept ? ' (playable, turn kept)' : ' (multi-draw)'}`);
  return { room, drawn, turnKept };
}

function callUno(room, playerId) {
  const player = room.players.find(p => p.id === playerId);
  if (!player) return { error: 'Player not in room' };
  if (player.eliminated) return { error: 'Player eliminated' };
  if (player.hand.length !== 1) return { error: 'UNO can only be called with exactly 1 card' };
  if (player.unoCalled) return { error: 'Already called UNO' };

  player.unoCalled = true;
  console.log(`[GAME] Room ${room.code}: "${player.name}" called UNO!`);
  return { room, called: true };
}

function catchUno(room, catcherId, targetId) {
  const catcher = room.players.find(p => p.id === catcherId);
  if (!catcher) return { error: 'Catcher not in room' };
  if (catcher.eliminated) return { error: 'Catcher eliminated' };

  const target = room.players.find(p => p.id === targetId);
  if (!target) return { error: 'Target not in room' };
  if (target === catcher) return { error: 'Cannot catch yourself' };
  if (target.eliminated) return { error: 'Target already eliminated' };
  if (target.unoCalled) return { error: 'Player has already called UNO' };

  const PENALTY = 5;

  if (target.hand.length === 1) {
    const penalty = drawFromDeck(room, PENALTY);
    target.hand.push(...penalty);
    target.unoCalled = false;
    console.log(`[GAME] Room ${room.code}: "${catcher.name}" caught "${target.name}"! +${PENALTY} cards penalty`);
    return { room, success: true, penaltyCards: penalty.length };
  } else {
    const penalty = drawFromDeck(room, PENALTY);
    catcher.hand.push(...penalty);
    if (catcher.hand.length !== 1) catcher.unoCalled = false;
    console.log(`[GAME] Room ${room.code}: "${catcher.name}" wrong catch on "${target.name}"! +${PENALTY} cards to catcher`);
    return { room, success: false, penaltyCards: penalty.length };
  }
}

function playAgain(room) {
  if (room.status !== 'finished') return { error: 'Game is not finished' };

  for (const player of room.players) {
    player.isConnected = true;
  }

  initGame(room);
  console.log(`[GAME] Room ${room.code}: Play Again started`);
  return { room };
}

function serializeRoomForPlayer(room, playerId) {
  return {
    code: room.code,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    status: room.status,
    currentTurn: room.currentTurn,
    nextTurn: room.status === 'playing' ? getNextTurn(room) : null,
    currentColor: room.currentColor,
    direction: room.direction,
    drawStack: room.drawStack,
    drawStackType: room.drawStackType || null,
    winner: room.winner,
    loser: room.loser,
    finishOrder: room.finishOrder || [],
    discardTop: topCard(room),
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      isConnected: p.isConnected,
      hand: p.id === playerId ? p.hand : undefined,
      handCount: p.id !== playerId ? p.hand.length : undefined,
      eliminated: p.eliminated || false,
      finishPosition: p.finishPosition || null,
      canBeCaught: p.id !== playerId && !p.eliminated && p.isConnected && !p.unoCalled && room.status === 'playing',
    })),
  };
}

module.exports = {
  buildDeck,
  initGame,
  isValidPlay,
  isValidMultiPlay,
  playCard,
  playMultipleCards,
  drawCards,
  drawMatchingCards,
  callUno,
  catchUno,
  playAgain,
  serializeRoomForPlayer,
  getActivePlayers,
  advanceTurn,
  getNextTurn,
  COLORS,
};
