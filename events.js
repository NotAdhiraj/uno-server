const {
	rooms,
	createRoom,
	getRoom,
	findRoomByPlayerId,
	joinRoom,
	reconnectPlayer,
	leaveRoom,
	markDisconnected,
} = require("./rooms");
const {
	initGame,
	isValidPlay,
	playCard,
	playMultipleCards,
	drawCards,
	drawMatchingCards,
	callUno,
	catchUno,
	playAgain,
	serializeRoomForPlayer,
} = require("./game");

function registerEvents(io, socket) {
	const playerId = socket.data.playerId;

	function findPlayerRoom() {
		return findRoomByPlayerId(playerId);
	}

	socket.on("session_restore", (__, cb) => {
		const room = findPlayerRoom();
		if (!room) return cb?.({ notInRoom: true, sessionNotFound: true });

		reconnectPlayer(playerId, socket.id);

		socket.join(room.code);

		if (room.status === "waiting") {
			io.to(room.code).emit("room_update", room);
			cb?.({ room });
		} else {
			for (const player of room.players) {
				io.to(player.socketId).emit(
					"state_update",
					serializeRoomForPlayer(room, player.id),
				);
			}
			cb?.({ room: serializeRoomForPlayer(room, playerId) });
		}
	});

	socket.on("create_room", ({ name, maxPlayers } = {}, cb) => {
		if (!name || !name.trim()) {
			return cb?.({ error: "Name is required" });
		}
		if (maxPlayers !== undefined && (maxPlayers < 2 || maxPlayers > 6)) {
			return cb?.({ error: "maxPlayers must be between 2 and 6" });
		}

		const existing = findPlayerRoom();
		if (existing) return cb?.({ error: "Already in a room" });

		const room = createRoom(socket.id, name.trim(), maxPlayers ?? 4, playerId);
		socket.join(room.code);

		io.to(room.code).emit("room_update", room);
		cb?.({ code: room.code });
	});

	socket.on("join_room", ({ code, name } = {}, cb) => {
		if (!name || !name.trim()) {
			return cb?.({ error: "Name is required" });
		}
		if (!code || typeof code !== "string") {
			return cb?.({ error: "Room code is required" });
		}

		const existing = findPlayerRoom();
		if (existing) return cb?.({ error: "Already in a room" });

		const result = joinRoom(
			code.toUpperCase(),
			socket.id,
			name.trim(),
			playerId,
		);
		if (result.error) {
			return cb?.({ error: result.error });
		}

		socket.join(result.room.code);
		io.to(result.room.code).emit("room_update", result.room);
		cb?.({ code: result.room.code });
	});

	socket.on("leave_room", (__, cb) => {
		const result = leaveRoom(playerId);
		if (result.notFound) {
			return cb?.({ error: "Not in any room" });
		}

		if (result.deleted) {
			socket.leave(result.code);
			cb?.({ ok: true });
			return;
		}

		socket.leave(result.room.code);
		io.to(result.room.code).emit("room_update", result.room);
		cb?.({ ok: true });
	});

	socket.on("start_game", (__, cb) => {
		const room = findPlayerRoom();
		if (!room) return cb?.({ error: "Not in any room" });
		if (room.hostId !== playerId)
			return cb?.({ error: "Only the host can start the game" });
		if (room.status !== "waiting")
			return cb?.({ error: "Game already started" });
		if (room.players.length < 2)
			return cb?.({ error: "Need at least 2 players" });

		initGame(room);
		console.log(`[GAME] Room ${room.code} game started by host`);

		for (const player of room.players) {
			io.to(player.socketId).emit(
				"game_started",
				serializeRoomForPlayer(room, player.id),
			);
		}
		cb?.({ ok: true });
	});

	socket.on("play_card", ({ cardId, chosenColor } = {}, cb) => {
		const room = findPlayerRoom();
		if (!room) return cb?.({ error: "Not in any room" });
		const me = room.players.find((p) => p.id === playerId);
		if (me && !me.isConnected) return cb?.({ error: "Not connected" });
		if (me && me.eliminated) return cb?.({ error: "Player eliminated" });

		const result = playCard(room, playerId, cardId, chosenColor);
		if (result.error) return cb?.({ error: result.error });

		const playerName = room.players.find((p) => p.id === playerId)?.name;
		const playedCard = room.discardPile[room.discardPile.length - 1];
		if (playedCard.color === "wild") {
			io.to(room.code).emit("game_event", {
				type: "wild_played",
				playerName,
				value: playedCard.value,
				chosenColor,
			});
		} else {
			io.to(room.code).emit("game_event", {
				type: "card_played",
				playerName,
				color: playedCard.color,
				value: playedCard.value,
			});
		}

		for (const player of room.players) {
			io.to(player.socketId).emit(
				"state_update",
				serializeRoomForPlayer(room, player.id),
			);
		}

		if (result.eliminated) {
			io.to(room.code).emit("player_eliminated", {
				playerId: result.eliminated.id,
				playerName: result.eliminated.name,
				finishPosition: result.eliminated.finishPosition,
			});
			io.to(room.code).emit("game_event", {
				type: "elimination",
				playerName: result.eliminated.name,
				position: result.eliminated.finishPosition,
			});
		}

		if (result.gameOver) {
			io.to(room.code).emit("game_over", {
				winner: room.winner,
				winnerName: room.players.find((p) => p.id === room.winner)?.name,
				loser: room.loser,
				loserName: room.players.find((p) => p.id === room.loser)?.name,
				finishOrder: room.finishOrder.map((pid) => {
					const p = room.players.find((pl) => pl.id === pid);
					return { id: pid, name: p?.name, finishPosition: p?.finishPosition };
				}),
			});
		}
		cb?.({ ok: true });
	});

	socket.on("play_multiple_cards", ({ cardIds } = {}, cb) => {
		const room = findPlayerRoom();
		if (!room) return cb?.({ error: "Not in any room" });
		if (!cardIds || !Array.isArray(cardIds))
			return cb?.({ error: "cardIds array required" });

		const result = playMultipleCards(room, playerId, cardIds);
		if (result.error) return cb?.({ error: result.error });

		const playerName = room.players.find((p) => p.id === playerId)?.name;
		io.to(room.code).emit("game_event", {
			type: "multi_play",
			playerName,
			count: cardIds.length,
		});

		for (const player of room.players) {
			io.to(player.socketId).emit(
				"state_update",
				serializeRoomForPlayer(room, player.id),
			);
		}

		if (result.eliminated) {
			io.to(room.code).emit("player_eliminated", {
				playerId: result.eliminated.id,
				playerName: result.eliminated.name,
				finishPosition: result.eliminated.finishPosition,
			});
			io.to(room.code).emit("game_event", {
				type: "elimination",
				playerName: result.eliminated.name,
				position: result.eliminated.finishPosition,
			});
		}

		if (result.gameOver) {
			io.to(room.code).emit("game_over", {
				winner: room.winner,
				winnerName: room.players.find((p) => p.id === room.winner)?.name,
				loser: room.loser,
				loserName: room.players.find((p) => p.id === room.loser)?.name,
				finishOrder: room.finishOrder.map((pid) => {
					const p = room.players.find((pl) => pl.id === pid);
					return { id: pid, name: p?.name, finishPosition: p?.finishPosition };
				}),
			});
		}

		cb?.({ ok: true });
	});

	socket.on("draw_card", (__, cb) => {
		const room = findPlayerRoom();
		if (!room) return cb?.({ error: "Not in any room" });
		const me = room.players.find((p) => p.id === playerId);
		if (me && !me.isConnected) return cb?.({ error: "Not connected" });
		if (me && me.eliminated) return cb?.({ error: "Player eliminated" });
		if (room.status !== "playing")
			return cb?.({ error: "Game not in progress" });

		const playerIdx = room.players.findIndex((p) => p.id === playerId);
		if (playerIdx === -1) return cb?.({ error: "Not in room" });
		if (room.currentTurn !== playerIdx) return cb?.({ error: "Not your turn" });

		const drawCount = room.drawStack > 0 ? room.drawStack : 1;
		const result = drawCards(room, playerId, drawCount);
		if (result.error) return cb?.({ error: result.error });

		const playerName = room.players.find((p) => p.id === playerId)?.name;
		if (drawCount > 1) {
			io.to(room.code).emit("game_event", { type: "penalty_draw", playerName, count: drawCount });
		} else {
			io.to(room.code).emit("game_event", { type: "card_drawn", playerName });
		}

		for (const player of room.players) {
			io.to(player.socketId).emit(
				"state_update",
				serializeRoomForPlayer(room, player.id),
			);
		}
		cb?.({ ok: true, drawn: result.drawn, turnKept: result.turnKept });
	});

	socket.on("call_uno", (__, cb) => {
		const room = findPlayerRoom();
		if (!room) return cb?.({ error: "Not in any room" });
		if (room.status !== "playing")
			return cb?.({ error: "Game not in progress" });

		const result = callUno(room, playerId);
		if (result.error) return cb?.({ error: result.error });

		const playerName = room.players.find((p) => p.id === playerId)?.name;
		io.to(room.code).emit("game_event", { type: "uno_call", playerName });

		for (const player of room.players) {
			io.to(player.socketId).emit(
				"state_update",
				serializeRoomForPlayer(room, player.id),
			);
		}
		io.to(room.code).emit("uno_called", { playerId, playerName });
		cb?.({ ok: true });
	});

	socket.on("catch_uno", ({ targetId } = {}, cb) => {
		const room = findPlayerRoom();
		if (!room) return cb?.({ error: "Not in any room" });
		if (room.status !== "playing")
			return cb?.({ error: "Game not in progress" });
		if (!targetId) return cb?.({ error: "Target player required" });

		const me = room.players.find((p) => p.id === playerId);
		if (me && !me.isConnected) return cb?.({ error: "Not connected" });
		if (me && me.eliminated) return cb?.({ error: "Player eliminated" });

		const result = catchUno(room, playerId, targetId);
		if (result.error) return cb?.({ error: result.error });

		const targetName = room.players.find((p) => p.id === targetId)?.name;
		const catcherName = room.players.find((p) => p.id === playerId)?.name;

		if (result.success) {
			io.to(room.code).emit("game_event", {
				type: "catch_success",
				catcherName,
				targetName,
			});
		} else {
			io.to(room.code).emit("game_event", {
				type: "catch_wrong",
				catcherName,
				targetName,
			});
		}

		for (const player of room.players) {
			io.to(player.socketId).emit(
				"state_update",
				serializeRoomForPlayer(room, player.id),
			);
		}

		io.to(room.code).emit("catch_result", {
			success: result.success,
			catcherId: playerId,
			catcherName,
			targetId,
			targetName,
		});

		cb?.({ ok: true, success: result.success });
	});

	socket.on("play_again", (__, cb) => {
		const room = findPlayerRoom();
		if (!room) return cb?.({ error: "Not in any room" });
		if (room.hostId !== playerId)
			return cb?.({ error: "Only the host can restart" });
		if (room.status !== "finished")
			return cb?.({ error: "Game is not finished" });

		const result = playAgain(room);
		if (result.error) return cb?.({ error: result.error });

		for (const player of room.players) {
			io.to(player.socketId).emit(
				"game_started",
				serializeRoomForPlayer(room, player.id),
			);
		}
		cb?.({ ok: true });
	});

	socket.on("disconnect", () => {
		let roomCode = null;
		for (const [code, room] of rooms) {
			if (room.players.some((p) => p.socketId === socket.id)) {
				roomCode = code;
				break;
			}
		}
		const result = markDisconnected(socket.id);
		if (roomCode) socket.leave(roomCode);
		if (result.room) {
			const playerName = result.room.players.find(
				(p) => p.id === playerId,
			)?.name;
			if (playerName) {
				io.to(roomCode).emit("game_event", {
					type: "player_disconnect",
					playerName,
				});
			}
			for (const player of result.room.players) {
				if (player.isConnected) {
					if (result.room.status === "waiting") {
						io.to(player.socketId).emit("room_update", result.room);
					} else {
						io.to(player.socketId).emit(
							"state_update",
							serializeRoomForPlayer(result.room, player.id),
						);
					}
				}
			}
		}
	});

	socket.on("reconnect_to_room", (__, cb) => {
		const room = findPlayerRoom();
		if (!room) return cb?.({ notInRoom: true, sessionNotFound: true });

		const result = reconnectPlayer(playerId, socket.id);
		if (result.notFound)
			return cb?.({ notInRoom: true, sessionNotFound: true });

		socket.join(room.code);

		const playerName = room.players.find((p) => p.id === playerId)?.name;
		if (playerName && room.status === "playing") {
			io.to(room.code).emit("game_event", {
				type: "player_reconnect",
				playerName,
			});
		}

		if (room.status === "waiting") {
			io.to(room.code).emit("room_update", room);
			cb?.({ room });
		} else {
			for (const player of room.players) {
				io.to(player.socketId).emit(
					"state_update",
					serializeRoomForPlayer(room, player.id),
				);
			}
			cb?.({ room: serializeRoomForPlayer(room, playerId) });
		}
	});
}

module.exports = { registerEvents };
