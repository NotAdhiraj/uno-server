const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

function createRoom(hostSocketId, hostName, maxPlayers, hostPlayerId) {
  const code = generateRoomCode();
  const room = {
    code,
    hostId: hostPlayerId,
    maxPlayers: Math.min(6, Math.max(2, maxPlayers)),
    players: [{
      id: hostPlayerId,
      socketId: hostSocketId,
      name: hostName,
      isConnected: true,
      eliminated: false,
      finishPosition: null,
    }],
    status: 'waiting',
    finishOrder: [],
    winner: null,
    loser: null,
  };
  rooms.set(code, room);
  console.log(`[ROOM] Created room ${code} by "${hostName}" (max ${room.maxPlayers} players)`);
  return room;
}

function getRoom(code) {
  return rooms.get(code) || null;
}

function findRoomByPlayerId(playerId) {
  for (const [, room] of rooms) {
    if (room.players.some(p => p.id === playerId)) {
      return room;
    }
  }
  return null;
}

function joinRoom(code, socketId, name, playerId) {
  const room = rooms.get(code);
  if (!room) return { error: 'Room not found' };
  if (room.players.length >= room.maxPlayers) return { error: 'Room is full' };
  if (room.status !== 'waiting') return { error: 'Game already started' };
  if (room.players.some(p => p.id === playerId)) return { error: 'Already in room' };

  room.players.push({
    id: playerId,
    socketId,
    name,
    isConnected: true,
    eliminated: false,
    finishPosition: null,
  });
  console.log(`[ROOM] "${name}" joined room ${code} (${room.players.length}/${room.maxPlayers} players)`);
  return { room };
}

function reconnectPlayer(playerId, socketId) {
  const room = findRoomByPlayerId(playerId);
  if (!room) return { notFound: true };

  const player = room.players.find(p => p.id === playerId);
  if (!player) return { notFound: true };

  player.socketId = socketId;
  player.isConnected = true;
  console.log(`[ROOM] "${player.name}" reconnected to room ${room.code}`);

  return { room };
}

function leaveRoom(playerId) {
  for (const [code, room] of rooms) {
    const idx = room.players.findIndex(p => p.id === playerId);
    if (idx === -1) continue;

    const player = room.players[idx];
    room.players.splice(idx, 1);
    console.log(`[ROOM] "${player.name}" left room ${code}`);

    if (room.players.length === 0) {
      rooms.delete(code);
      console.log(`[ROOM] Room ${code} deleted (empty)`);
      return { deleted: true, code };
    }

    if (room.hostId === playerId) {
      room.hostId = room.players[0].id;
      console.log(`[ROOM] Host transferred to "${room.players[0].name}" in room ${code}`);
    }

    if (room.status === 'playing') {
      if (room.currentTurn > idx) {
        room.currentTurn--;
      } else if (room.currentTurn === idx) {
        if (room.currentTurn >= room.players.length) {
          room.currentTurn = 0;
        }
      }

      const current = room.players[room.currentTurn];
      if (current && (current.eliminated || !current.isConnected)) {
        let nextIdx = room.currentTurn;
        let safety = 0;
        do {
          nextIdx = (nextIdx + room.direction + room.players.length) % room.players.length;
          safety++;
        } while (
          (room.players[nextIdx].eliminated || !room.players[nextIdx].isConnected) &&
          nextIdx !== room.currentTurn &&
          safety < room.players.length
        );
        room.currentTurn = nextIdx;
      }
    }

    return { room };
  }
  return { notFound: true };
}

function markDisconnected(socketId) {
  for (const [, room] of rooms) {
    const player = room.players.find(p => p.socketId === socketId);
    if (player) {
      player.isConnected = false;
      console.log(`[ROOM] "${player.name}" disconnected from room ${room.code}`);

      if (room.status === 'playing') {
        const playerIdx = room.players.findIndex(p => p.socketId === socketId);
        if (room.currentTurn === playerIdx) {
          const activeConnected = room.players.filter(p => p.isConnected && !p.eliminated);
          if (activeConnected.length === 0) {
            room.status = 'finished';
            room.winner = null;
            console.log(`[ROOM] Room ${room.code} finished (all players disconnected)`);
          } else {
            let nextIdx = room.currentTurn;
            do {
              nextIdx = (nextIdx + room.direction + room.players.length) % room.players.length;
            } while ((room.players[nextIdx].eliminated || !room.players[nextIdx].isConnected) && nextIdx !== room.currentTurn);
            room.currentTurn = nextIdx;
            console.log(`[ROOM] Turn advanced to "${room.players[nextIdx].name}" in room ${room.code}`);
          }
        }
      }

      return { room };
    }
  }
  return { notFound: true };
}

module.exports = { rooms, createRoom, getRoom, findRoomByPlayerId, joinRoom, reconnectPlayer, leaveRoom, markDisconnected };
