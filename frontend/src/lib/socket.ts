import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

let socket: Socket | null = null;

export const getSocket = (token: string): Socket => {
  if (socket && socket.connected) return socket;
  socket = io(SOCKET_URL, {
    auth: { token },
    autoConnect: true,
  });
  return socket;
};

export const disconnectSocket = (): void => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
