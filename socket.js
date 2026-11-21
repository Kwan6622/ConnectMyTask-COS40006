const { Server } = require('socket.io');
const { env } = require('../config/env');

let io;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: String(env.FRONTEND_URL || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    // eslint-disable-next-line no-console
    console.log('Client connected to Socket.io', socket.id);

    socket.on('task:subscribe', (taskId) => {
      const id = String(taskId || '');
      if (!/^\d+$/.test(id)) return;
      socket.join(`task:${id}`);
    });

    socket.on('task:unsubscribe', (taskId) => {
      const id = String(taskId || '');
      if (!/^\d+$/.test(id)) return;
      socket.leave(`task:${id}`);
    });

    socket.on('disconnect', () => {
      // eslint-disable-next-line no-console
      console.log('Client disconnected from Socket.io', socket.id);
    });
  });
}

function publishTaskBidCount(taskId, bidCount) {
  if (!io) return;
  io.to(`task:${taskId}`).emit('task:bid-count', {
    taskId: String(taskId),
    bidCount,
    status: 'BIDDING',
  });
}

function getIO() {
  if (!io) {
    throw new Error('Socket.io has not been initialized');
  }
  return io;
}

module.exports = { initSocket, getIO, publishTaskBidCount };
