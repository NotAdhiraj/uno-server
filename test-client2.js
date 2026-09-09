// test-client2.js
const { io } = require("socket.io-client");
const socket = io("http://localhost:3001");

socket.on("connect", () => {
	console.log("connected:", socket.id);
	socket.emit("join_room", { code: "9HSPA", name: "Friend" }, (res) => {
		console.log("join callback:", res);
	});
});

socket.on("room_update", (data) => console.log("room_update:", data));
