// HTTP & WebSocket Server for Suberri Crime
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const { GameRoom } = require('./gameRoom');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve public static frontend
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Active rooms map: roomCode -> GameRoom
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// REST API for Lobby discovery & status
app.get('/api/rooms', (req, res) => {
  const publicRooms = [];
  for (const [code, room] of rooms.entries()) {
    if (room.isPublic && room.state === 'lobby') {
      publicRooms.push({
        code,
        playersCount: room.players.size,
        maxPlayers: room.settings.maxPlayers,
        impostors: room.settings.impostorCount
      });
    }
  }
  res.json({ rooms: publicRooms });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', activeRooms: rooms.size });
});

// WebSocket Connection handling
wss.on('connection', (ws) => {
  let currentRoomCode = null;
  let playerId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'CREATE_ROOM': {
          let code = generateRoomCode();
          while (rooms.has(code)) {
            code = generateRoomCode();
          }
          const isPublic = msg.isPublic !== false;
          const room = new GameRoom(code, playerId, isPublic);
          rooms.set(code, room);
          currentRoomCode = code;

          const joinRes = room.addPlayer(playerId, msg.playerName, ws);
          ws.send(JSON.stringify({
            type: 'ROOM_CREATED',
            roomCode: code,
            playerId,
            hostId: room.hostId,
            settings: room.settings
          }));
          break;
        }

        case 'JOIN_ROOM': {
          const targetCode = (msg.roomCode || '').toUpperCase().trim();
          const room = rooms.get(targetCode);
          if (!room) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Sala no encontrada.' }));
            return;
          }

          const joinRes = room.addPlayer(playerId, msg.playerName, ws);
          if (!joinRes.success) {
            ws.send(JSON.stringify({ type: 'ERROR', message: joinRes.reason }));
            return;
          }

          currentRoomCode = targetCode;
          ws.send(JSON.stringify({
            type: 'ROOM_JOINED',
            roomCode: targetCode,
            playerId,
            hostId: room.hostId,
            settings: room.settings
          }));
          break;
        }

        case 'UPDATE_SETTINGS': {
          const room = rooms.get(currentRoomCode);
          if (room) {
            room.updateSettings(msg.settings, playerId);
          }
          break;
        }

        case 'START_GAME': {
          const room = rooms.get(currentRoomCode);
          if (room) {
            const startRes = room.startGame(playerId);
            if (!startRes.success) {
              ws.send(JSON.stringify({ type: 'ERROR', message: startRes.reason }));
            }
          }
          break;
        }

        case 'RETURN_TO_LOBBY': {
          const room = rooms.get(currentRoomCode);
          if (room) {
            room.returnToLobby(playerId);
          }
          break;
        }

        case 'PLAY_AGAIN': {
          const room = rooms.get(currentRoomCode);
          if (room) {
            const res = room.playAgain(playerId);
            if (!res.success) {
              ws.send(JSON.stringify({ type: 'ERROR', message: res.reason }));
            }
          }
          break;
        }

        case 'INPUT': {
          const room = rooms.get(currentRoomCode);
          if (room && msg.inputs) {
            room.handlePlayerInput(playerId, msg.inputs);
          }
          break;
        }

        case 'KILL': {
          const room = rooms.get(currentRoomCode);
          if (room && msg.targetId) {
            const res = room.handleKill(playerId, msg.targetId);
            if (!res.success) {
              ws.send(JSON.stringify({ type: 'ACTION_FAILED', action: 'KILL', reason: res.reason }));
            }
          }
          break;
        }

        case 'VENT': {
          const room = rooms.get(currentRoomCode);
          if (room && msg.ventId) {
            room.handleVent(playerId, msg.ventId);
          }
          break;
        }

        case 'REPORT': {
          const room = rooms.get(currentRoomCode);
          if (room) {
            room.handleReport(playerId, msg.bodyId);
          }
          break;
        }

        case 'EMERGENCY_BUTTON': {
          const room = rooms.get(currentRoomCode);
          if (room) {
            room.handleEmergencyButton(playerId);
          }
          break;
        }

        case 'VOTE': {
          const room = rooms.get(currentRoomCode);
          if (room && msg.targetId) {
            room.handleVote(playerId, msg.targetId);
          }
          break;
        }

        case 'COMPLETE_TASK': {
          const room = rooms.get(currentRoomCode);
          if (room && msg.taskId) {
            room.handleCompleteTask(playerId, msg.taskId);
          }
          break;
        }

        case 'SABOTAGE': {
          const room = rooms.get(currentRoomCode);
          if (room && msg.sabotageType) {
            room.handleSabotage(playerId, msg.sabotageType, msg.target);
          }
          break;
        }

        case 'REPAIR_SABOTAGE': {
          const room = rooms.get(currentRoomCode);
          if (room && msg.sabotageType) {
            room.handleRepairSabotage(playerId, msg.sabotageType, msg.data);
          }
          break;
        }

        case 'CHAT': {
          const room = rooms.get(currentRoomCode);
          if (room && msg.text) {
            room.handleChatMessage(playerId, msg.text);
          }
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error('WS Error:', err);
    }
  });

  ws.on('close', () => {
    if (currentRoomCode && rooms.has(currentRoomCode)) {
      const room = rooms.get(currentRoomCode);
      room.removePlayer(playerId);
      if (room.players.size === 0) {
        room.stop();
        rooms.delete(currentRoomCode);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`[Suberri Crime Server] Server running on port ${PORT}`);
  console.log(`[Suberri Crime Server] Tickrate: 30Hz - Server-Authoritative Engine`);
});

module.exports = { app, server, rooms };
