const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { registerEvents } = require('./events');

const PORT = process.env.PORT || 3001;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

io.use((socket, next) => {
  const playerId = socket.handshake.auth?.playerId;
  if (!playerId || typeof playerId !== 'string') {
    return next(new Error('Invalid playerId'));
  }
  socket.data.playerId = playerId;
  next();
});

io.on('connection', (socket) => {
  console.log(`[SOCKET] Connected: ${socket.id} (player: ${socket.data.playerId})`);
  registerEvents(io, socket);
  socket.on('disconnect', () => {
    console.log(`[SOCKET] Disconnected: ${socket.id} (player: ${socket.data.playerId})`);
  });
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
