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

function advanceTurn(room) {
  const count = room.players.length;
  let nextIdx = room.currentTurn;
  do {
    nextIdx = (nextIdx + room.direction + count) % count;
  } while (room.players[nextIdx].eliminated && nextIdx !== room.currentTurn);
  room.currentTurn = nextIdx;
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
  } else if (card.value === 'wild4') {
    room.drawStack += 4;
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
    const skipTarget = (room.currentTurn + 2 * room.direction + playerCount) % playerCount;
    room.currentTurn = skipTarget;
    if (room.players[room.currentTurn].eliminated || !room.players[room.currentTurn].isConnected) {
      advanceTurn(room);
    }
  } else {
    advanceTurn(room);
  }

  return { room };
}

const ACTION_CARD_VALUES = ['draw2', 'wild4', 'skip', 'reverse'];

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

  for (const card of cards) {
    if (card.color === 'wild' || card.value === 'wild4') {
      return { valid: false, error: 'Wild cards cannot be combined in a multi-card play' };
    }
    if (ACTION_CARD_VALUES.includes(card.value)) {
      return { valid: false, error: 'Action cards cannot be combined' };
    }
  }

  if (!isValidPlay(room, playerId, cards[0])) {
    return { valid: false, error: 'First card is not playable against the current discard' };
  }

  for (let i = 1; i < cards.length; i++) {
    const prev = cards[i - 1];
    const curr = cards[i];
    if (curr.color !== prev.color && curr.value !== prev.value) {
      return { valid: false, error: `Card ${i + 1} does not match the previous card in the chain` };
    }
  }

  return { valid: true, cards };
}

function playMultipleCards(room, playerId, cardIds, chosenColor) {
  const validation = isValidMultiPlay(room, playerId, cardIds);
  if (!validation.valid) return { error: validation.error };

  const player = room.players.find(p => p.id === playerId);
  const cards = validation.cards;

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

  advanceTurn(room);
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
  advanceTurn(room);

  console.log(`[GAME] Room ${room.code}: "${player.name}" drew ${count} card${count > 1 ? 's' : ''}${wasStacking ? ' (stack resolved)' : ''}`);
  return { room, drawn };
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
  let matchColor = null;
  let matchValue = null;

  while (room.deck.length > 0 || room.discardPile.length > 1) {
    ensureDeck(room, 1);
    if (room.deck.length === 0) break;

    const card = room.deck[0];

    if (card.color === 'wild') break;

    if (drawn.length === 0) {
      drawn.push(room.deck.shift());
      matchColor = card.color;
      matchValue = card.value;
      continue;
    }

    if (card.color === matchColor || card.value === matchValue) {
      drawn.push(room.deck.shift());
      matchColor = card.color;
      matchValue = card.value;
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
    currentColor: room.currentColor,
    direction: room.direction,
    drawStack: room.drawStack,
    winner: room.winner,
    loser: room.loser,
    finishOrder: room.finishOrder || [],
    discardTop: topCard(room),
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      isConnected: p.isConnected,
      hand: p.id === playerId ? p.hand : undefined,
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
  COLORS,
};
