// test-client.js
const { io } = require("socket.io-client");
const socket = io("http://localhost:3001");

socket.on("connect", () => {
  console.log("connected:", socket.id);
  socket.emit("create_room", { name: "Stark", maxPlayers: 4 });
});

socket.on("room_update", (data) => console.log("room_update:", data));
socket.on("error", (err) => console.log("error:", err));