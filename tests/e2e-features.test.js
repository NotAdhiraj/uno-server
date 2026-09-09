const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const game = require("../game");

function makeCard(id, color, value) {
	return { id, color, value };
}

function makeRoom(opts = {}) {
	const n = opts.players || 2;
	const players = [];
	for (let i = 0; i < n; i++) {
		players.push({
			id: opts.playerIds?.[i] || `p${i}`,
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
		code: opts.code || "TROOM",
		hostId: opts.hostId || "p0",
		maxPlayers: opts.maxPlayers || n,
		players,
		status: opts.status || "waiting",
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

describe("BUG REPRODUCTION: Play Again", () => {
	it("playAgain resets all game state correctly", () => {
		const room = makeRoom({
			players: 3,
			status: "finished",
			currentTurn: 1,
			currentColor: "red",
			discardPile: [makeCard("top", "red", "5")],
			drawStack: 2,
			direction: -1,
			winner: "p0",
			loser: "p2",
			finishOrder: ["p0", "p1", "p2"],
			hands: [[], [], []],
		});
		room.players[0].eliminated = true;
		room.players[0].finishPosition = 1;
		room.players[1].eliminated = true;
		room.players[1].finishPosition = 2;
		room.players[2].eliminated = true;
		room.players[2].finishPosition = 3;
		room.players[0].unoCalled = true;

		const result = game.playAgain(room);
		assert.equal(result.error, undefined, "playAgain should not error");

		assert.equal(room.status, "playing", "status should be playing");
		assert.equal(room.winner, null, "winner should be null");
		assert.equal(room.loser, null, "loser should be null");
		assert.deepEqual(room.finishOrder, [], "finishOrder should be empty");
		assert.equal(room.drawStack, 0, "drawStack should be 0");
		assert.equal(room.direction, 1, "direction should be reset");

		for (const p of room.players) {
			assert.equal(p.eliminated, false, `${p.name} should not be eliminated`);
			assert.equal(
				p.finishPosition,
				null,
				`${p.name} finishPosition should be null`,
			);
			assert.equal(p.unoCalled, false, `${p.name} unoCalled should be false`);
			assert.ok(
				p.hand.length === 7,
				`${p.name} should have 7 cards, has ${p.hand.length}`,
			);
		}

		assert.ok(
			room.discardPile.length >= 1,
			"discardPile should have a start card",
		);
		assert.ok(room.deck.length > 0, "deck should have remaining cards");
	});

	it("serialized state after playAgain has status playing and hands", () => {
		const room = makeRoom({
			players: 2,
			status: "finished",
			currentTurn: 0,
			currentColor: "blue",
			discardPile: [makeCard("top", "blue", "9")],
			drawStack: 0,
			hands: [[], []],
			winner: "p0",
			loser: "p1",
			finishOrder: ["p0", "p1"],
		});

		game.playAgain(room);

		const s0 = game.serializeRoomForPlayer(room, "p0");
		const s1 = game.serializeRoomForPlayer(room, "p1");

		assert.equal(s0.status, "playing");
		assert.equal(s1.status, "playing");
		assert.ok(
			s0.players[0].hand.length === 7,
			"p0 should have hand in serialized state",
		);
		assert.ok(
			s0.players[1].hand === undefined,
			"p1 hand should not leak to p0",
		);
		assert.ok(
			s1.players[1].hand.length === 7,
			"p1 should have hand in serialized state",
		);
		assert.ok(
			s1.players[0].hand === undefined,
			"p0 hand should not leak to p1",
		);
		assert.equal(s0.winner, null);
		assert.equal(s0.loser, null);
	});

	it("playAgain fails on non-finished game", () => {
		const room = makeRoom({
			status: "playing",
			currentTurn: 0,
			currentColor: "blue",
			discardPile: [makeCard("top", "blue", "9")],
			drawStack: 0,
			hands: [[makeCard("h0", "blue", "1")], [makeCard("h1", "blue", "2")]],
		});
		const result = game.playAgain(room);
		assert.ok(result.error, "should error on non-finished game");
	});
});

describe("BUG REPRODUCTION: UNO call and catch", () => {
	it("callUno requires exactly 1 card", () => {
		const room = makeRoom({
			players: 2,
			status: "playing",
			currentTurn: 0,
			currentColor: "blue",
			discardPile: [makeCard("top", "blue", "9")],
			drawStack: 0,
			hands: [
				[makeCard("h0", "blue", "1"), makeCard("h1", "blue", "2")],
				[makeCard("h2", "blue", "3")],
			],
		});

		const r1 = game.callUno(room, "p0");
		assert.ok(r1.error, "should fail with 2 cards");

		room.players[0].hand = [makeCard("last", "blue", "5")];
		const r2 = game.callUno(room, "p0");
		assert.equal(r2.error, undefined, "should succeed with 1 card");
		assert.equal(room.players[0].unoCalled, true);
	});

	it("catchUno penalizes target with 1 card (successful catch)", () => {
		const room = makeRoom({
			players: 2,
			status: "playing",
			currentTurn: 0,
			currentColor: "blue",
			discardPile: [makeCard("top", "blue", "9")],
			drawStack: 0,
			deck: [
				makeCard("pen1", "red", "1"),
				makeCard("pen2", "green", "2"),
				makeCard("pen3", "blue", "3"),
				makeCard("pen4", "yellow", "4"),
				makeCard("pen5", "red", "5"),
			],
			hands: [[makeCard("h0", "blue", "1")], [makeCard("h1", "blue", "3")]],
		});
		room.players[1].hand = [makeCard("last", "blue", "5")];

		const r = game.catchUno(room, "p0", "p1");
		assert.equal(r.error, undefined);
		assert.equal(r.success, true);
		assert.equal(
			room.players[1].hand.length,
			6,
			"target should have 6 cards after +5 penalty",
		);
	});

	it("wrong catch penalizes catcher when target has >1 card", () => {
		const room = makeRoom({
			players: 2,
			status: "playing",
			currentTurn: 0,
			currentColor: "blue",
			discardPile: [makeCard("top", "blue", "9")],
			drawStack: 0,
			deck: [
				makeCard("pen1", "red", "1"),
				makeCard("pen2", "green", "2"),
				makeCard("pen3", "blue", "3"),
				makeCard("pen4", "yellow", "4"),
				makeCard("pen5", "red", "5"),
			],
			hands: [
				[makeCard("h0", "blue", "1"), makeCard("h2", "blue", "2")],
				[makeCard("h1", "blue", "3")],
			],
		});

		const r = game.catchUno(room, "p1", "p0");
		assert.equal(r.error, undefined);
		assert.equal(r.success, false);
		assert.equal(
			room.players[1].hand.length,
			6,
			"catcher should have 6 cards after wrong catch",
		);
	});

	it("serialized state includes handCount but hides hand and unoCalled for opponents", () => {
		const room = makeRoom({
			players: 2,
			status: "playing",
			currentTurn: 0,
			currentColor: "blue",
			discardPile: [makeCard("top", "blue", "9")],
			drawStack: 0,
			hands: [[makeCard("h0", "blue", "1")], [makeCard("h1", "blue", "3")]],
		});

		room.players[0].unoCalled = true;
		const s = game.serializeRoomForPlayer(room, "p0");
		assert.equal(s.players[0].hand.length, 1, "own hand should be visible");
		assert.equal(
			s.players[1].hand,
			undefined,
			"opponent hand should be hidden",
		);
		assert.equal(
			s.players[1].handCount,
			1,
			"opponent handCount should be exposed as number",
		);
		assert.equal(
			s.players[0].unoCalled,
			undefined,
			"unoCalled should not be serialized",
		);
	});
});

describe("BUG REPRODUCTION: Multi-card draw", () => {
	it("drawMatchingCards draws matching color sequence", () => {
		const room = makeRoom({
			players: 2,
			status: "playing",
			currentTurn: 0,
			currentColor: "red",
			discardPile: [makeCard("top", "red", "3")],
			drawStack: 0,
			deck: [
				makeCard("d1", "red", "5"),
				makeCard("d2", "blue", "5"),
				makeCard("d3", "blue", "7"),
				makeCard("d4", "green", "9"),
			],
			hands: [[], []],
		});

		const result = game.drawMatchingCards(room, "p0");
		assert.equal(result.error, undefined);
		assert.equal(result.drawn.length, 3, "should draw Red 5, Blue 5, Blue 7");
		assert.equal(result.drawn[0].id, "d1");
		assert.equal(result.drawn[1].id, "d2");
		assert.equal(result.drawn[2].id, "d3");
		assert.equal(room.players[0].hand.length, 3);
		assert.equal(room.deck.length, 1, "Green 9 should remain");
		assert.equal(room.deck[0].id, "d4");
		assert.equal(room.currentTurn, 1, "turn advances once");
	});

	it("drawMatchingCards draws matching value sequence", () => {
		const room = makeRoom({
			players: 2,
			status: "playing",
			currentTurn: 0,
			currentColor: "red",
			discardPile: [makeCard("top", "red", "3")],
			drawStack: 0,
			deck: [
				makeCard("d1", "red", "8"),
				makeCard("d2", "blue", "8"),
				makeCard("d3", "green", "8"),
				makeCard("d4", "yellow", "3"),
			],
			hands: [[], []],
		});

		const result = game.drawMatchingCards(room, "p0");
		assert.equal(result.drawn.length, 3, "should draw three 8s");
		assert.equal(room.deck[0].id, "d4", "Yellow 3 should remain");
	});

	it("drawMatchingCards stops at wild card", () => {
		const room = makeRoom({
			players: 2,
			status: "playing",
			currentTurn: 0,
			currentColor: "red",
			discardPile: [makeCard("top", "red", "3")],
			drawStack: 0,
			deck: [
				makeCard("d1", "red", "5"),
				makeCard("d2", "wild", "wild"),
				makeCard("d3", "blue", "5"),
			],
			hands: [[], []],
		});

		const result = game.drawMatchingCards(room, "p0");
		assert.equal(result.drawn.length, 1, "should draw only Red 5");
		assert.equal(result.drawn[0].id, "d1");
		assert.equal(room.deck.length, 2, "wild and Blue 5 remain");
	});

	it("first card is wild — draws only 1", () => {
		const room = makeRoom({
			players: 2,
			status: "playing",
			currentTurn: 0,
			currentColor: "red",
			discardPile: [makeCard("top", "red", "3")],
			drawStack: 0,
			deck: [makeCard("d1", "wild", "wild"), makeCard("d2", "red", "5")],
			hands: [[], []],
		});

		const result = game.drawMatchingCards(room, "p0");
		assert.equal(result.drawn.length, 1, "should draw only the wild");
		assert.equal(result.drawn[0].color, "wild");
	});

	it("turn advances exactly once", () => {
		const room = makeRoom({
			players: 2,
			status: "playing",
			currentTurn: 0,
			currentColor: "red",
			discardPile: [makeCard("top", "red", "3")],
			drawStack: 0,
			deck: [makeCard("d1", "red", "5"), makeCard("d2", "red", "6")],
			hands: [[], []],
		});

		game.drawMatchingCards(room, "p0");
		assert.equal(room.currentTurn, 1, "turn should advance once to p1");
	});

	it("draw stack delegates to drawCards", () => {
		const room = makeRoom({
			players: 2,
			status: "playing",
			currentTurn: 0,
			currentColor: "red",
			discardPile: [makeCard("top", "red", "3")],
			drawStack: 4,
			deck: [
				makeCard("d1", "red", "5"),
				makeCard("d2", "red", "6"),
				makeCard("d3", "blue", "7"),
				makeCard("d4", "green", "8"),
			],
			hands: [[], []],
		});

		const result = game.drawMatchingCards(room, "p0");
		assert.equal(result.drawn.length, 4, "should draw 4 for stack");
		assert.equal(room.drawStack, 0, "stack should be cleared");
		assert.equal(room.currentTurn, 1);
	});
});
