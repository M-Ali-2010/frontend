// backend/socket.js
function setupSocket(io) {
  io.on('connection', (socket) => {
    // No auth required for broadcast; frontend can still fetch JWT for protected actions.
    socket.on('disconnect', () => {});
  });
}

module.exports = { setupSocket };