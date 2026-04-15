import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io('/', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
    });
  }
  return socket;
}

export function subscribeToJob(jobId: string) {
  getSocket().emit('subscribe:job', jobId);
}

export function subscribeToCorpus() {
  getSocket().emit('subscribe:corpus');
}
