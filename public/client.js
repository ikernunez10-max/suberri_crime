// Suberri Crime - Client Core & Rendering Engine
// Handles WebSockets, UI navigation, Canvas 2D map & entities, local prediction, task minigames

// Network & State
let ws = null;
let currentRoomCode = null;
let myPlayerId = null;
let isHost = false;
let lastServerTick = null;
let currentScreen = 'screen-menu';

// Input tracking (WASD & Arrow keys)
const inputs = { up: false, down: false, left: false, right: false };
let inputDirty = false;

// Task mini-game state
let currentActiveTask = null;
let activeSabotagePanel = null;
let wiresState = null;
let downloadInterval = null;

// Canvas setup
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
let camera = { x: 1000, y: 300 };

// Animation state cache for players: playerId -> { x, y, walkCycle, facingRight, isMoving, footstepTimer }
const playerAnimStates = new Map();

// Resize canvas to window
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- Screen Switching ---
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) {
    target.classList.add('active');
    currentScreen = screenId;
  }
}

// --- WebSocket Connection ---
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('Conectado al servidor de Suberri Crime.');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch (e) {
      console.error('Error al procesar mensaje del servidor:', e);
    }
  };

  ws.onclose = () => {
    console.warn('Conexión perdida con el servidor.');
  };
}

// Start WS connection immediately
initWebSocket();

// --- Network Message Dispatcher ---
function handleServerMessage(msg) {
  switch (msg.type) {
    case 'ROOM_CREATED':
    case 'ROOM_JOINED': {
      currentRoomCode = msg.roomCode;
      myPlayerId = msg.playerId;
      isHost = msg.hostId === myPlayerId;
      document.getElementById('lobby-code-display').innerText = currentRoomCode;
      document.getElementById('host-badge').style.display = isHost ? 'inline-block' : 'none';
      document.getElementById('btn-start-game').style.display = isHost ? 'block' : 'none';
      document.getElementById('lobby-wait-text').style.display = isHost ? 'none' : 'block';

      // Lock settings inputs if not host
      document.querySelectorAll('#settings-controls select').forEach(sel => {
        sel.disabled = !isHost;
      });

      showScreen('screen-lobby');
      break;
    }

    case 'GAME_TICK': {
      lastServerTick = msg;
      isHost = msg.hostId === myPlayerId;

      if (msg.state === 'lobby') {
        if (currentScreen !== 'screen-lobby') showScreen('screen-lobby');
        renderLobbyUI(msg);
      } else if (msg.state === 'playing') {
        if (currentScreen !== 'screen-game') {
          showScreen('screen-game');
          document.getElementById('ejection-overlay').classList.add('hidden');
        }
        renderGameUI(msg);
      } else if (msg.state === 'discussion' || msg.state === 'voting') {
        if (currentScreen !== 'screen-meeting') {
          showScreen('screen-meeting');
          window.soundEngine.playMeetingAlert();
        }
        renderMeetingUI(msg);
      } else if (msg.state === 'ended') {
        if (currentScreen !== 'screen-gameover') {
          showScreen('screen-gameover');
          renderGameOverUI(msg);
        }
      }
      break;
    }

    case 'ERROR': {
      alert(`[Suberri Error] ${msg.message}`);
      break;
    }

    default:
      break;
  }
}

// --- Menu & Public Rooms ---
async function fetchPublicRooms() {
  try {
    const res = await fetch('/api/rooms');
    const data = await res.json();
    const list = document.getElementById('public-rooms-list');
    list.innerHTML = '';

    if (!data.rooms || data.rooms.length === 0) {
      list.innerHTML = '<div class="empty-list">No hay salas disponibles en este momento. ¡Crea una!</div>';
      return;
    }

    data.rooms.forEach(r => {
      const row = document.createElement('div');
      row.className = 'room-item-row';
      row.innerHTML = `
        <span>SALA: ${r.code} (${r.playersCount}/${r.maxPlayers})</span>
        <button class="btn btn-sm" onclick="joinRoomByCode('${r.code}')">UNIRSE</button>
      `;
      list.appendChild(row);
    });
  } catch (err) {
    console.error('Error fetching rooms:', err);
  }
}

document.getElementById('btn-refresh-rooms').addEventListener('click', fetchPublicRooms);
setInterval(fetchPublicRooms, 5000);
fetchPublicRooms();

window.joinRoomByCode = function(code) {
  const name = document.getElementById('player-name-input').value.trim() || 'Agente';
  window.soundEngine.init();
  ws.send(JSON.stringify({
    type: 'JOIN_ROOM',
    roomCode: code,
    playerName: name
  }));
};

document.getElementById('btn-create-room').addEventListener('click', () => {
  const name = document.getElementById('player-name-input').value.trim() || 'Agente';
  window.soundEngine.init();
  ws.send(JSON.stringify({
    type: 'CREATE_ROOM',
    playerName: name,
    isPublic: true
  }));
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  if (code.length === 6) {
    joinRoomByCode(code);
  } else {
    alert('Introduce un código válido de 6 caracteres.');
  }
});

document.getElementById('btn-copy-code').addEventListener('click', () => {
  if (currentRoomCode) {
    navigator.clipboard.writeText(currentRoomCode);
    alert('¡Código de sala copiado al portapapeles!');
  }
});

// --- Lobby Setup & Settings ---
function renderLobbyUI(tick) {
  const playersList = document.getElementById('lobby-players-list');
  playersList.innerHTML = '';
  document.getElementById('lobby-player-count').innerText = `Jugadores: ${tick.players.length}/${tick.settings.maxPlayers}`;

  tick.players.forEach(p => {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.innerHTML = `
      <div class="player-avatar-circle" style="background-color: ${p.color};">🧑‍🚀</div>
      <div class="player-card-name">${escapeHtml(p.name)}</div>
      ${p.id === tick.hostId ? '<span class="host-badge-small">HOST</span>' : ''}
    `;
    playersList.appendChild(card);
  });
}

// Send settings when Host modifies dropdowns
['set-impostors', 'set-speed', 'set-kill-cd', 'set-kill-dist', 'set-discussion-time', 'set-tasks-count'].forEach(id => {
  const elem = document.getElementById(id);
  elem.addEventListener('change', () => {
    if (!isHost) return;
    const settings = {
      impostorCount: parseInt(document.getElementById('set-impostors').value, 10),
      moveSpeed: parseFloat(document.getElementById('set-speed').value),
      killCooldown: parseInt(document.getElementById('set-kill-cd').value, 10),
      killDistance: document.getElementById('set-kill-dist').value,
      discussionTime: parseInt(document.getElementById('set-discussion-time').value, 10),
      tasksCount: parseInt(document.getElementById('set-tasks-count').value, 10)
    };
    ws.send(JSON.stringify({ type: 'UPDATE_SETTINGS', settings }));
  });
});

document.getElementById('btn-start-game').addEventListener('click', () => {
  if (isHost) {
    ws.send(JSON.stringify({ type: 'START_GAME' }));
  }
});

// --- Input Handling ---
window.addEventListener('keydown', (e) => {
  if (currentScreen !== 'screen-game') return;
  // If typing in chat or input
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

  let changed = false;
  if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
    if (!inputs.up) { inputs.up = true; changed = true; }
  }
  if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
    if (!inputs.down) { inputs.down = true; changed = true; }
  }
  if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
    if (!inputs.left) { inputs.left = true; changed = true; }
  }
  if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
    if (!inputs.right) { inputs.right = true; changed = true; }
  }

  // Hotkeys: Q = Kill, E = Use, R = Report, Space = Vent
  if (e.key === 'q' || e.key === 'Q') {
    document.getElementById('btn-action-kill').click();
  }
  if (e.key === 'e' || e.key === 'E') {
    document.getElementById('btn-action-use').click();
  }
  if (e.key === 'r' || e.key === 'R') {
    document.getElementById('btn-action-report').click();
  }
  if (e.key === ' ' || e.key === 'Spacebar') {
    document.getElementById('btn-action-vent').click();
  }

  if (changed) sendInputs();
});

window.addEventListener('keyup', (e) => {
  if (currentScreen !== 'screen-game') return;
  let changed = false;
  if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
    if (inputs.up) { inputs.up = false; changed = true; }
  }
  if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
    if (inputs.down) { inputs.down = false; changed = true; }
  }
  if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
    if (inputs.left) { inputs.left = false; changed = true; }
  }
  if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
    if (inputs.right) { inputs.right = false; changed = true; }
  }
  if (changed) sendInputs();
});

function sendInputs() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'INPUT', inputs }));
  }
}

// --- Map Constants (Mirror of Server Definition - Suberri 1. Solairua) ---
const ROOMS = [
  { id: 'aula_101', name: 'Aula 101 (Norte)', x: 740, y: 160, w: 260, h: 260 },
  { id: 'aula_102', name: 'Aula 102 (Norte)', x: 1020, y: 160, w: 280, h: 260 },
  { id: 'aula_103', name: 'Aula 103 (Norte)', x: 1320, y: 160, w: 280, h: 260 },
  { id: 'laboratorio_norte', name: 'Laboratorio Norte', x: 1620, y: 160, w: 240, h: 320 },
  { id: 'despacho_oeste', name: 'Despacho Orientación', x: 300, y: 460, w: 280, h: 220 },
  { id: 'sala_reuniones', name: 'Sala de Profesores / Reuniones', x: 300, y: 700, w: 280, h: 420, isMeetingRoom: true },
  { id: 'aula_104', name: 'Aula 104 (Punto Seguro)', x: 600, y: 700, w: 260, h: 420 },
  { id: 'aula_105', name: 'Aula 105 (Sur)', x: 880, y: 700, w: 260, h: 420 },
  { id: 'aula_106', name: 'Aula 106 (Sur)', x: 1160, y: 700, w: 260, h: 420 },
  { id: 'taller_1', name: 'Taller Técnico 1', x: 1440, y: 700, w: 220, h: 420 },
  { id: 'taller_2', name: 'Taller Técnico 2', x: 1680, y: 700, w: 240, h: 420 },
  { id: 'escalera_central', name: 'Escaleras Principales', x: 1040, y: 460, w: 240, h: 180 },
  { id: 'aseos', name: 'Aseos Suberri', x: 860, y: 460, w: 160, h: 180 },
  { id: 'despacho_este', name: 'Despacho Dirección', x: 1620, y: 500, w: 240, h: 180 }
];

const EMERGENCY_BTN_POS = { x: 1040, y: 660, radius: 45 };

const WALLS = [
  // Perímetro exterior
  [280, 140, 1880, 140],
  [1880, 140, 1880, 1140],
  [1880, 1140, 280, 1140],
  [280, 1140, 280, 140],

  // Aulas Norte
  [740, 140, 740, 420], [1000, 140, 1000, 420],
  [740, 420, 810, 420], [930, 420, 1000, 420],
  [1000, 140, 1000, 420], [1300, 140, 1300, 420],
  [1000, 420, 1090, 420], [1210, 420, 1300, 420],
  [1300, 140, 1300, 420], [1600, 140, 1600, 420],
  [1300, 420, 1390, 420], [1510, 420, 1600, 420],
  [1600, 140, 1600, 480],
  [1600, 480, 1690, 480], [1810, 480, 1880, 480],

  // Núcleo Central (Aseos y Escaleras)
  [860, 460, 1020, 460], [860, 640, 1020, 640],
  [860, 460, 860, 500], [860, 600, 860, 640],
  [1020, 460, 1020, 640],
  [1020, 460, 1280, 460], [1020, 640, 1280, 640],
  [1280, 460, 1280, 500], [1280, 600, 1280, 640],

  // Ala Oeste
  [580, 420, 580, 490], [580, 610, 580, 680],
  [280, 680, 580, 680],
  [580, 680, 580, 730], [580, 850, 580, 1140],

  // Ala Este
  [1600, 480, 1600, 530], [1600, 650, 1600, 700],

  // Aulas Sur
  [580, 700, 680, 700], [800, 700, 950, 700],
  [1070, 700, 1230, 700], [1350, 700, 1490, 700],
  [1610, 700, 1750, 700], [1870, 700, 1880, 700],
  [870, 700, 870, 1140], [1150, 700, 1150, 1140],
  [1430, 700, 1430, 1140], [1670, 700, 1670, 1140]
];

const VENTS = [
  { id: 'vent_aula101', x: 800, y: 220 },
  { id: 'vent_aseos', x: 920, y: 520 },
  { id: 'vent_aula104', x: 700, y: 800 },
  { id: 'vent_profesores', x: 380, y: 800 },
  { id: 'vent_lab_norte', x: 1720, y: 240 },
  { id: 'vent_escalera', x: 1220, y: 520 },
  { id: 'vent_taller1', x: 1540, y: 820 },
  { id: 'vent_taller2', x: 1780, y: 820 }
];

const SABOTAGE_STATIONS = [
  { id: 'o2_panel_1', type: 'critical_o2', name: 'Gas Laboratorio', x: 1740, y: 380 },
  { id: 'o2_panel_2', type: 'critical_o2', name: 'Purga Taller 1', x: 1540, y: 1020 },
  { id: 'lights_panel', type: 'lights', name: 'Cuadro General Suberri', x: 1820, y: 1040 },
  { id: 'comms_panel', type: 'comms', name: 'Rack Servidores', x: 440, y: 520 }
];

// --- In-Game UI & Controls ---
function renderGameUI(tick) {
  const me = tick.playerMe;
  if (!me) return;

  // Task bar progress
  const progressPercent = tick.tasksProgress.total > 0
    ? (tick.tasksProgress.completed / tick.tasksProgress.total) * 100
    : 0;
  document.getElementById('task-progress-fill').style.width = `${progressPercent}%`;

  // Role tag
  const roleTag = document.getElementById('role-tag');
  if (me.role === 'criminal') {
    roleTag.innerText = 'CRIMINAL (IMPOSTOR)';
    roleTag.className = 'role-tag impostor';
    document.getElementById('btn-action-kill').classList.remove('hidden');
    document.getElementById('btn-action-vent').classList.remove('hidden');
    document.getElementById('btn-action-sabotage').classList.remove('hidden');
  } else {
    roleTag.innerText = 'INOCENTE';
    roleTag.className = 'role-tag crewmate';
    document.getElementById('btn-action-kill').classList.add('hidden');
    document.getElementById('btn-action-vent').classList.add('hidden');
    document.getElementById('btn-action-sabotage').classList.add('hidden');
  }

  // Sabotage alert banner
  const sabAlert = document.getElementById('sabotage-alert');
  if (tick.sabotages.critical.active) {
    sabAlert.classList.remove('hidden');
    document.getElementById('sabotage-timer').innerText = tick.sabotages.critical.timeLeft;
  } else {
    sabAlert.classList.add('hidden');
  }

  // Tasks list
  const tasksListElem = document.getElementById('my-tasks-list');
  tasksListElem.innerHTML = '';
  if (tick.sabotages.comms.active && me.role === 'innocent') {
    tasksListElem.innerHTML = '<li class="task-item" style="color:#ef4444;">⚠️ COMUNICACIONES SABOTEADAS</li>';
  } else {
    me.tasks.forEach(t => {
      const li = document.createElement('li');
      li.className = `task-item ${t.completed ? 'completed' : ''} ${t.isFake ? 'fake' : ''}`;
      li.innerText = `${t.name} (${t.room}) ${t.completed ? '✓' : ''}`;
      tasksListElem.appendChild(li);
    });
  }

  // Current Room Detection
  let inRoom = ROOMS.find(r => me.x >= r.x && me.x <= r.x + r.w && me.y >= r.y && me.y <= r.y + r.h);
  document.getElementById('current-room-name').innerText = inRoom ? inRoom.name : 'Pasillo Suberri';

  // --- Dynamic Action Buttons Status ---
  // Kill Button
  const btnKill = document.getElementById('btn-action-kill');
  const cdText = document.getElementById('kill-cd-text');
  if (me.role === 'criminal') {
    const cd = Math.ceil(me.killCooldown || 0);
    if (cd > 0) {
      cdText.style.display = 'flex';
      cdText.innerText = `${cd}s`;
      btnKill.disabled = true;
    } else {
      cdText.style.display = 'none';
      // Find eligible alive target in range (rango ampliado para que matar sea mucho más fluido)
      const killRanges = { short: 100, medium: 160, long: 220 };
      const maxDist = killRanges[tick.settings.killDistance] || 160;
      const target = tick.players.find(p => p.id !== me.id && !p.isDead && p.role !== 'criminal' && Math.hypot(p.x - me.x, p.y - me.y) <= maxDist);
      btnKill.disabled = !target || me.isDead;
      btnKill.onclick = () => {
        if (target) {
          ws.send(JSON.stringify({ type: 'KILL', targetId: target.id }));
          window.soundEngine.playKill();
        }
      };
    }
  }

  // Vent Button
  const btnVent = document.getElementById('btn-action-vent');
  if (me.role === 'criminal') {
    const nearVent = VENTS.find(v => Math.hypot(v.x - me.x, v.y - me.y) <= 85);
    btnVent.disabled = (!nearVent && !me.inVent) || me.isDead;
    btnVent.onclick = () => {
      if (me.inVent) {
        ws.send(JSON.stringify({ type: 'VENT', ventId: me.inVent }));
        window.soundEngine.playVent();
      } else if (nearVent) {
        ws.send(JSON.stringify({ type: 'VENT', ventId: nearVent.id }));
        window.soundEngine.playVent();
      }
    };
  }

  // Report Button
  const btnReport = document.getElementById('btn-action-report');
  const nearBody = tick.deadBodies.find(b => Math.hypot(b.x - me.x, b.y - me.y) <= 120);
  btnReport.disabled = !nearBody || me.isDead;
  btnReport.onclick = () => {
    if (nearBody) {
      ws.send(JSON.stringify({ type: 'REPORT', bodyId: nearBody.id }));
    }
  };

  // Use Button (Emergency button, Tasks, Repair panels)
  const btnUse = document.getElementById('btn-action-use');
  let useAction = null;

  // Check emergency button
  const distEmerg = Math.hypot(me.x - EMERGENCY_BTN_POS.x, me.y - EMERGENCY_BTN_POS.y);
  if (distEmerg <= EMERGENCY_BTN_POS.radius + 35 && !tick.sabotages.critical.active && !me.isDead) {
    useAction = () => ws.send(JSON.stringify({ type: 'EMERGENCY_BUTTON' }));
  }

  // Check Sabotage repairs
  if (!useAction) {
    const nearSab = SABOTAGE_STATIONS.find(s => Math.hypot(s.x - me.x, s.y - me.y) <= 80);
    if (nearSab && !me.isDead) {
      if (nearSab.type === 'critical_o2' && tick.sabotages.critical.active) {
        useAction = () => openO2KeypadModal(nearSab.id);
      } else if (nearSab.type === 'lights' && tick.sabotages.lights.active) {
        useAction = () => openLightsModal(tick.sabotages.lights.switches);
      } else if (nearSab.type === 'comms' && tick.sabotages.comms.active) {
        useAction = () => {
          ws.send(JSON.stringify({ type: 'REPAIR_SABOTAGE', sabotageType: 'comms' }));
          window.soundEngine.playTaskComplete();
        };
      }
    }
  }

  // Check normal tasks (rango de interacción aumentado a 110px para fácil acceso)
  if (!useAction) {
    const uncompletedTasks = me.tasks.filter(t => !t.completed);
    const nearTask = uncompletedTasks.find(t => Math.hypot(t.x - me.x, t.y - me.y) <= 110);
    if (nearTask && !me.isDead) {
      useAction = () => openTaskModal(nearTask);
    }
  }

  btnUse.disabled = !useAction;
  btnUse.onclick = useAction || null;
}

// Sabotage Modal Open/Close
document.getElementById('btn-action-sabotage').addEventListener('click', () => {
  document.getElementById('sabotage-modal').classList.remove('hidden');
});
document.getElementById('btn-close-sabotage').addEventListener('click', () => {
  document.getElementById('sabotage-modal').classList.add('hidden');
});

// Sabotage actions triggered by criminal
document.getElementById('btn-sab-o2').addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'SABOTAGE', sabotageType: 'critical_o2' }));
  window.soundEngine.playSabotageSiren();
  document.getElementById('sabotage-modal').classList.add('hidden');
});
document.getElementById('btn-sab-lights').addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'SABOTAGE', sabotageType: 'lights' }));
  document.getElementById('sabotage-modal').classList.add('hidden');
});
document.getElementById('btn-sab-comms').addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'SABOTAGE', sabotageType: 'comms' }));
  document.getElementById('sabotage-modal').classList.add('hidden');
});
document.getElementById('btn-sab-doors-elec').addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'SABOTAGE', sabotageType: 'doors', target: 'taller_2' }));
  document.getElementById('sabotage-modal').classList.add('hidden');
});
document.getElementById('btn-sab-doors-med').addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'SABOTAGE', sabotageType: 'doors', target: 'laboratorio_norte' }));
  document.getElementById('sabotage-modal').classList.add('hidden');
});
document.getElementById('btn-sab-doors-cafe').addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'SABOTAGE', sabotageType: 'doors', target: 'sala_reuniones' }));
  document.getElementById('sabotage-modal').classList.add('hidden');
});

// --- Mini-Games Implementation (RF-04) ---
window.closeAllTaskModals = function() {
  document.getElementById('task-modal-wires').classList.add('hidden');
  document.getElementById('task-modal-download').classList.add('hidden');
  document.getElementById('task-modal-calibrate').classList.add('hidden');
  document.getElementById('repair-modal-lights').classList.add('hidden');
  document.getElementById('repair-modal-o2').classList.add('hidden');
  if (downloadInterval) clearInterval(downloadInterval);
  currentActiveTask = null;
  activeSabotagePanel = null;
};

function completeCurrentTask() {
  if (currentActiveTask) {
    ws.send(JSON.stringify({ type: 'COMPLETE_TASK', taskId: currentActiveTask.id }));
    window.soundEngine.playTaskComplete();
  }
  closeAllTaskModals();
}

function openTaskModal(task) {
  closeAllTaskModals();
  currentActiveTask = task;

  if (task.type === 'wires') {
    startWiresMiniGame();
  } else if (task.type === 'download') {
    startDownloadMiniGame();
  } else if (task.type === 'calibrate') {
    startCalibrateMiniGame();
  }
}

// 1. Wires Mini-game
function startWiresMiniGame() {
  const modal = document.getElementById('task-modal-wires');
  modal.classList.remove('hidden');

  const wireColors = [
    { name: 'Rojo', hex: '#ef4444', icon: '■' },
    { name: 'Azul', hex: '#3b82f6', icon: '▲' },
    { name: 'Amarillo', hex: '#f59e0b', icon: '●' },
    { name: 'Magenta', hex: '#ec4899', icon: '★' }
  ];

  const leftOrder = [...wireColors].sort(() => 0.5 - Math.random());
  const rightOrder = [...wireColors].sort(() => 0.5 - Math.random());

  const leftCol = document.getElementById('wires-left-col');
  const rightCol = document.getElementById('wires-right-col');
  const svg = document.getElementById('wires-svg');

  leftCol.innerHTML = '';
  rightCol.innerHTML = '';
  svg.innerHTML = '';

  let selectedLeft = null;
  let connectedWires = 0;

  leftOrder.forEach((color, idx) => {
    const node = document.createElement('div');
    node.className = 'wire-node';
    node.style.backgroundColor = color.hex;
    node.innerText = color.icon;
    node.dataset.color = color.name;
    node.dataset.idx = idx;

    node.onclick = () => {
      document.querySelectorAll('.wire-node').forEach(n => n.style.borderColor = 'rgba(255,255,255,0.4)');
      node.style.borderColor = '#ffffff';
      selectedLeft = { color: color.name, elem: node, hex: color.hex };
    };
    leftCol.appendChild(node);
  });

  rightOrder.forEach((color, idx) => {
    const node = document.createElement('div');
    node.className = 'wire-node';
    node.style.backgroundColor = color.hex;
    node.innerText = color.icon;
    node.dataset.color = color.name;

    node.onclick = () => {
      if (!selectedLeft) return;
      if (selectedLeft.color === color.name) {
        // Draw line in SVG
        const r1 = selectedLeft.elem.getBoundingClientRect();
        const r2 = node.getBoundingClientRect();
        const cont = svg.getBoundingClientRect();

        const x1 = r1.right - cont.left;
        const y1 = r1.top + r1.height / 2 - cont.top;
        const x2 = r2.left - cont.left;
        const y2 = r2.top + r2.height / 2 - cont.top;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', selectedLeft.hex);
        line.setAttribute('stroke-width', '6');
        line.setAttribute('stroke-linecap', 'round');
        svg.appendChild(line);

        selectedLeft.elem.onclick = null;
        node.onclick = null;
        selectedLeft = null;
        connectedWires++;

        if (connectedWires >= 4) {
          setTimeout(completeCurrentTask, 400);
        }
      } else {
        selectedLeft.elem.style.borderColor = 'rgba(255,255,255,0.4)';
        selectedLeft = null;
      }
    };
    rightCol.appendChild(node);
  });
}

// 2. Download Mini-game
function startDownloadMiniGame() {
  const modal = document.getElementById('task-modal-download');
  modal.classList.remove('hidden');

  const bar = document.getElementById('download-progress-bar');
  const status = document.getElementById('download-status-text');
  const btn = document.getElementById('btn-start-download');

  bar.style.width = '0%';
  status.innerText = 'Listo para transferir...';
  btn.disabled = false;

  btn.onclick = () => {
    btn.disabled = true;
    let progress = 0;
    downloadInterval = setInterval(() => {
      progress += 5;
      bar.style.width = `${progress}%`;
      status.innerText = `Transfiriendo archivos... ${progress}%`;

      if (progress >= 100) {
        clearInterval(downloadInterval);
        status.innerText = '¡Transferencia Completa!';
        setTimeout(completeCurrentTask, 500);
      }
    }, 120);
  };
}

// 3. Calibrate Mini-game
function startCalibrateMiniGame() {
  const modal = document.getElementById('task-modal-calibrate');
  modal.classList.remove('hidden');

  const targetFreq = Math.floor(Math.random() * 80 + 60);
  document.getElementById('target-freq').innerText = targetFreq;

  const slider = document.getElementById('freq-slider');
  slider.value = 0;
  document.getElementById('current-freq').innerText = '0';

  slider.oninput = () => {
    document.getElementById('current-freq').innerText = slider.value;
  };

  document.getElementById('btn-calibrate-confirm').onclick = () => {
    const val = parseInt(slider.value, 10);
    if (Math.abs(val - targetFreq) <= 3) {
      completeCurrentTask();
    } else {
      alert('Frecuencia desalineada. Ajusta con mayor precisión.');
    }
  };
}

// 4. Sabotage Repair: Lights Switches (RF-06)
function openLightsModal(initialSwitches) {
  closeAllTaskModals();
  const modal = document.getElementById('repair-modal-lights');
  modal.classList.remove('hidden');

  const switches = [...initialSwitches];
  const rack = document.getElementById('switches-rack');
  rack.innerHTML = '';

  function renderSwitches() {
    rack.innerHTML = '';
    switches.forEach((state, i) => {
      const unit = document.createElement('div');
      unit.className = `switch-unit ${state ? 'active' : ''}`;
      unit.innerHTML = `
        <div class="switch-lever">
          <div class="switch-knob"></div>
        </div>
        <div style="font-size:0.8rem; font-weight:700;">#${i + 1}</div>
      `;
      unit.onclick = () => {
        switches[i] = !switches[i];
        ws.send(JSON.stringify({
          type: 'REPAIR_SABOTAGE',
          sabotageType: 'lights',
          data: { switches }
        }));
        renderSwitches();
        if (switches.every(s => s === true)) {
          setTimeout(closeAllTaskModals, 300);
        }
      };
      rack.appendChild(unit);
    });
  }
  renderSwitches();
}

// 5. Sabotage Repair: O2 Keypad
function openO2KeypadModal(panelId) {
  closeAllTaskModals();
  activeSabotagePanel = panelId;
  const modal = document.getElementById('repair-modal-o2');
  modal.classList.remove('hidden');

  const screen = document.getElementById('o2-keypad-screen');
  const grid = document.getElementById('o2-keypad-buttons');
  let entered = '';
  screen.innerText = '----';
  grid.innerHTML = '';

  ['1','2','3','4','5','6','7','8','9','C','0','OK'].forEach(k => {
    const b = document.createElement('button');
    b.className = 'keypad-btn';
    b.innerText = k;
    b.onclick = () => {
      if (k === 'C') {
        entered = '';
        screen.innerText = '----';
      } else if (k === 'OK') {
        if (entered === '8429') {
          ws.send(JSON.stringify({
            type: 'REPAIR_SABOTAGE',
            sabotageType: 'critical_o2',
            data: { panelId: activeSabotagePanel }
          }));
          window.soundEngine.playTaskComplete();
          closeAllTaskModals();
        } else {
          entered = '';
          screen.innerText = 'ERROR';
        }
      } else {
        if (entered.length < 4) {
          entered += k;
          screen.innerText = entered;
        }
      }
    };
    grid.appendChild(b);
  });
}

// --- Screen 4: Discussion & Voting (RF-08) ---
function renderMeetingUI(tick) {
  const me = tick.playerMe;
  const meeting = tick.meeting;

  // Header & Timer
  document.getElementById('meeting-title').innerText = meeting.reason === 'body'
    ? '¡CADÁVER REPORTADO!'
    : '¡REUNIÓN DE EMERGENCIA!';

  const reporter = tick.players.find(p => p.id === meeting.reporterId);
  document.getElementById('meeting-subtitle').innerText = reporter
    ? `Convocada por ${escapeHtml(reporter.name)}`
    : 'Convocada por un tripulante';

  document.getElementById('meeting-phase-label').innerText = meeting.phase === 'discussion'
    ? 'FASE DE DISCUSIÓN'
    : 'FASE DE VOTACIÓN';

  document.getElementById('meeting-timer').innerText = `${meeting.timer}s`;

  // Voting grid
  const grid = document.getElementById('voting-players-grid');
  grid.innerHTML = '';

  const canVote = meeting.phase === 'voting' && !me.isDead && !me.votedFor;

  tick.players.forEach(p => {
    const card = document.createElement('div');
    card.className = `vote-card ${p.isDead ? 'voted-dead' : ''}`;
    card.innerHTML = `
      <div class="vote-card-info">
        <div class="vote-card-avatar" style="background-color: ${p.color};">
          ${p.isDead ? '💀' : '🧑‍🚀'}
        </div>
        <div>
          <div style="font-weight:700;">${escapeHtml(p.name)}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${p.isDead ? 'FALLECIDO' : (p.votedFor ? '✓ HA VOTADO' : 'Pensando...')}</div>
        </div>
      </div>
    `;

    if (canVote && !p.isDead) {
      card.onclick = () => {
        if (confirm(`¿Confirmas tu voto para expulsar a ${p.name}?`)) {
          ws.send(JSON.stringify({ type: 'VOTE', targetId: p.id }));
        }
      };
    }
    grid.appendChild(card);
  });

  // Skip vote button
  const skipBtn = document.getElementById('btn-vote-skip');
  skipBtn.disabled = !canVote;
  skipBtn.onclick = () => {
    if (confirm('¿Deseas saltarte el voto?')) {
      ws.send(JSON.stringify({ type: 'VOTE', targetId: 'skip' }));
    }
  };

  // Chat render
  renderMeetingChat(tick.chat, me);

  // Ejection animation overlay if determined
  if (meeting.resultText) {
    const overlay = document.getElementById('ejection-overlay');
    overlay.classList.remove('hidden');
    document.getElementById('ejection-message').innerText = meeting.resultText;
    const avatar = document.getElementById('ejected-avatar');
    if (meeting.ejectedPlayer) {
      avatar.style.backgroundColor = '#ef4444';
      avatar.innerText = '🧑‍🚀';
    } else {
      avatar.innerText = '🛸';
    }
  }
}

function renderMeetingChat(messages, me) {
  const container = document.getElementById('meeting-chat-messages');
  container.innerHTML = '';

  messages.forEach(m => {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${m.isDead ? 'ghost-msg' : ''}`;
    bubble.innerHTML = `
      <div class="chat-bubble-author" style="color: ${m.color};">
        <span>${escapeHtml(m.senderName)} ${m.isDead ? '👻 (Fantasma)' : ''}</span>
        <span class="chat-time">${m.time}</span>
      </div>
      <div>${escapeHtml(m.text)}</div>
    `;
    container.appendChild(bubble);
  });
  container.scrollTop = container.scrollHeight;
}

document.getElementById('btn-send-chat').addEventListener('click', sendChatMessage);
document.getElementById('meeting-chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});

function sendChatMessage() {
  const input = document.getElementById('meeting-chat-input');
  const text = input.value.trim();
  if (text && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'CHAT', text }));
    input.value = '';
  }
}

// --- Screen 5: Game Over Screen (3.2) ---
function renderGameOverUI(tick) {
  const isCrewWin = tick.winner === 'innocent';
  const title = document.getElementById('gameover-title');
  title.innerText = isCrewWin ? 'VICTORIA DE LA TRIPULACIÓN' : 'VICTORIA DE LOS CRIMINALES';
  title.style.color = isCrewWin ? '#10b981' : '#ef4444';

  document.getElementById('gameover-reason').innerText = tick.winReason || 'Partida finalizada';

  const preview = document.getElementById('gameover-roles-list');
  preview.innerHTML = '';

  tick.players.forEach(p => {
    const d = document.createElement('div');
    d.style.textAlign = 'center';
    d.innerHTML = `
      <div class="player-avatar-circle" style="background-color: ${p.color}; margin: 0 auto 6px auto;">🧑‍🚀</div>
      <div style="font-weight:700;">${escapeHtml(p.name)}</div>
      <div style="font-size:0.8rem; color:${p.role === 'criminal' ? '#ef4444' : '#38bdf8'}; font-weight:bold;">
        ${p.role === 'criminal' ? 'CRIMINAL' : 'INOCENTE'}
      </div>
    `;
    preview.appendChild(d);
  });

  const btnPlayAgain = document.getElementById('btn-play-again');
  const btnBackLobby = document.getElementById('btn-back-lobby');
  const waitText = document.getElementById('gameover-wait-text');

  if (isHost) {
    btnPlayAgain.style.display = 'inline-flex';
    btnBackLobby.style.display = 'inline-flex';
    waitText.classList.add('hidden');
  } else {
    btnPlayAgain.style.display = 'none';
    btnBackLobby.style.display = 'none';
    waitText.classList.remove('hidden');
  }
}

document.getElementById('btn-back-lobby').addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'RETURN_TO_LOBBY' }));
  }
});

document.getElementById('btn-play-again').addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'PLAY_AGAIN' }));
  }
});

// --- Canvas 2D Rendering Engine (Tickrate & Interpolation) ---
function renderCanvasLoop() {
  requestAnimationFrame(renderCanvasLoop);

  if (currentScreen !== 'screen-game' || !lastServerTick || !lastServerTick.playerMe) {
    return;
  }

  const me = lastServerTick.playerMe;
  const width = canvas.width;
  const height = canvas.height;

  // Camera smooth follow on local player
  camera.x += (me.x - camera.x) * 0.15;
  camera.y += (me.y - camera.y) * 0.15;

  ctx.clearRect(0, 0, width, height);

  ctx.save();
  // Center camera
  ctx.translate(width / 2 - camera.x, height / 2 - camera.y);

  // 1. Draw Architectural Floor & Corridors Background (Plano de Evacuación Suberri)
  ctx.fillStyle = '#0a0f1d';
  ctx.fillRect(100, 50, 2000, 1200);

  // Pasillo Central longitudinal (conecta todas las aulas y escaleras)
  ctx.fillStyle = '#18243c';
  ctx.fillRect(280, 420, 1600, 280);

  // 2. Draw Rooms floor
  ROOMS.forEach(r => {
    // Differentiation for special rooms
    if (r.id === 'sala_reuniones') {
      ctx.fillStyle = '#1a2942'; // Professors room
    } else if (r.id === 'aula_104') {
      ctx.fillStyle = '#162b3a'; // Safe meeting point
    } else if (r.id === 'aseos') {
      ctx.fillStyle = '#162233'; // Restrooms
    } else if (r.id === 'escalera_central') {
      ctx.fillStyle = '#222f47'; // Staircase
    } else {
      ctx.fillStyle = '#141d33'; // Classrooms / Workshops
    }
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // Grid pattern inside classrooms
    ctx.strokeStyle = '#1b2745';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    // Room Label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.font = 'bold 20px Rajdhani';
    ctx.textAlign = 'center';
    ctx.fillText(r.name.toUpperCase(), r.x + r.w / 2, r.y + r.h / 2);
  });

  // Dibujar flechas de evacuación en el pasillo como en el plano de Somorrostro
  ctx.strokeStyle = 'rgba(16, 185, 129, 0.25)';
  ctx.lineWidth = 3;
  [650, 850, 1050, 1250, 1450].forEach(fx => {
    // Flechas hacia el hall central
    ctx.beginPath();
    ctx.moveTo(fx, 560); ctx.lineTo(fx + (fx < 1040 ? 30 : -30), 560);
    ctx.stroke();
  });

  // Dibujar Escaleras Centrales decorativas (Peldaños)
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  for (let sy = 480; sy <= 620; sy += 18) {
    ctx.beginPath();
    ctx.moveTo(1060, sy); ctx.lineTo(1260, sy);
    ctx.stroke();
  }

  // 3. Draw Emergency Evacuation Point / Meeting Table (Hall Central Suberri)
  ctx.beginPath();
  ctx.arc(EMERGENCY_BTN_POS.x, EMERGENCY_BTN_POS.y, EMERGENCY_BTN_POS.radius, 0, Math.PI * 2);
  ctx.fillStyle = '#1e2d4a';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#10b981'; // Green evacuation circle
  ctx.stroke();

  // Punto azul "USTED ESTÁ AQUÍ" del plano de evacuación
  ctx.beginPath();
  ctx.arc(730, 860, 28, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(30, 58, 138, 0.7)';
  ctx.fill();
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#93c5fd';
  ctx.font = 'bold 10px Rajdhani';
  ctx.textAlign = 'center';
  ctx.fillText('PTO. ENCUENTRO', 730, 863);

  // Emergency Button Icon en Hall
  ctx.beginPath();
  ctx.arc(EMERGENCY_BTN_POS.x, EMERGENCY_BTN_POS.y, 20, 0, Math.PI * 2);
  ctx.fillStyle = lastServerTick.sabotages.critical.active ? '#6b7280' : '#ef4444';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px Orbitron';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ALARMA', EMERGENCY_BTN_POS.x, EMERGENCY_BTN_POS.y);

  // 4. Draw Vents (Visible to Criminals, subtle grate for Innocent)
  VENTS.forEach(v => {
    ctx.fillStyle = me.role === 'criminal' ? '#9333ea' : '#334155';
    ctx.fillRect(v.x - 16, v.y - 16, 32, 32);
    ctx.strokeStyle = me.role === 'criminal' ? '#c084fc' : '#475569';
    ctx.lineWidth = 2;
    ctx.strokeRect(v.x - 16, v.y - 16, 32, 32);

    // Vent lines
    ctx.beginPath();
    ctx.moveTo(v.x - 10, v.y - 8); ctx.lineTo(v.x + 10, v.y - 8);
    ctx.moveTo(v.x - 10, v.y);     ctx.lineTo(v.x + 10, v.y);
    ctx.moveTo(v.x - 10, v.y + 8); ctx.lineTo(v.x + 10, v.y + 8);
    ctx.stroke();
  });

  // 5. Draw Task locations & Sabotage Panels
  me.tasks.forEach(t => {
    if (!t.completed) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#f59e0b';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fef3c7';
      ctx.stroke();

      // Pulsing marker
      ctx.beginPath();
      ctx.arc(t.x, t.y, 18 + Math.sin(Date.now() / 200) * 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
      ctx.stroke();
    }
  });

  // Sabotage active stations
  SABOTAGE_STATIONS.forEach(s => {
    const isStationCritical = s.type === 'critical_o2' && lastServerTick.sabotages.critical.active;
    const isStationLights = s.type === 'lights' && lastServerTick.sabotages.lights.active;
    const isStationComms = s.type === 'comms' && lastServerTick.sabotages.comms.active;

    if (isStationCritical || isStationLights || isStationComms) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 16, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px Rajdhani';
      ctx.textAlign = 'center';
      ctx.fillText('FIX', s.x, s.y - 20);
    }
  });

  // 6. Draw Dead Bodies
  lastServerTick.deadBodies.forEach(b => {
    ctx.save();
    ctx.translate(b.x, b.y);

    // Body bone
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(-4, -18, 8, 14);
    ctx.beginPath();
    ctx.arc(-4, -18, 5, 0, Math.PI * 2);
    ctx.arc(4, -18, 5, 0, Math.PI * 2);
    ctx.fill();

    // Lower half suit
    ctx.beginPath();
    ctx.arc(0, 4, 18, 0, Math.PI);
    ctx.fillStyle = b.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.stroke();

    // Red blood pool
    ctx.beginPath();
    ctx.arc(0, 10, 22, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
    ctx.fill();

    // Name tag
    ctx.fillStyle = '#cbd5e1';
    ctx.font = 'bold 12px Rajdhani';
    ctx.textAlign = 'center';
    ctx.fillText(`${b.victimName} (Cadáver)`, 0, 32);

    ctx.restore();
  });

  // 7. Draw Players (Visible ones from server authority payload with smooth walk animation & facing)
  const now = Date.now();
  lastServerTick.players.forEach(p => {
    if (p.inVent && p.id !== me.id) return; // Hidden in vent

    // Retrieve or initialize animation state
    let anim = playerAnimStates.get(p.id);
    if (!anim) {
      anim = {
        x: p.x,
        y: p.y,
        walkCycle: 0,
        facingRight: true,
        isMoving: false,
        footstepTimer: 0
      };
      playerAnimStates.set(p.id, anim);
    }

    // Determine movement direction and speed for animation
    const dx = p.x - anim.x;
    const dy = p.y - anim.y;
    const movedDist = Math.hypot(dx, dy);

    // Smooth position interpolation (prevents jitter)
    anim.x += dx * 0.4;
    anim.y += dy * 0.4;

    if (movedDist > 0.4) {
      anim.isMoving = true;
      anim.walkCycle += movedDist * 0.18;
      if (Math.abs(dx) > 0.2) {
        anim.facingRight = dx > 0;
      }

      // Audio footstep for local player
      if (p.id === me.id && !p.isDead) {
        anim.footstepTimer += movedDist;
        if (anim.footstepTimer > 38) {
          window.soundEngine.playFootstep();
          anim.footstepTimer = 0;
        }
      }
    } else {
      anim.isMoving = false;
      // Smoothly return legs to neutral stance
      anim.walkCycle *= 0.85;
    }

    ctx.save();
    ctx.translate(anim.x, anim.y);

    // Flip horizontally based on movement direction
    if (!anim.facingRight) {
      ctx.scale(-1, 1);
    }

    // Ghost floating effect or walking bob
    let bobY = 0;
    let tiltAngle = 0;

    if (p.isDead) {
      ctx.globalAlpha = 0.55;
      bobY = Math.sin(now / 250 + (p.id.charCodeAt(p.id.length - 1) || 0)) * 5;
      tiltAngle = Math.sin(now / 400) * 0.08;
    } else if (anim.isMoving) {
      bobY = Math.abs(Math.sin(anim.walkCycle)) * -4;
      tiltAngle = Math.sin(anim.walkCycle) * 0.08;
    }

    ctx.translate(0, bobY);
    ctx.rotate(tiltAngle);

    // 1. Backpack (moves with bob)
    ctx.fillStyle = '#334155';
    ctx.fillRect(-22, -10, 8, 20);

    // 2. Animated Legs (stride cycle)
    if (!p.isDead) {
      const legStride = Math.sin(anim.walkCycle) * 7;
      const legLiftLeft = Math.max(0, -Math.cos(anim.walkCycle)) * 3;
      const legLiftRight = Math.max(0, Math.cos(anim.walkCycle)) * 3;

      ctx.fillStyle = p.color;
      // Left leg
      ctx.fillRect(-14 + legStride * 0.5, 16 - legLiftLeft, 9, 10 + legLiftLeft);
      // Right leg
      ctx.fillRect(5 - legStride * 0.5, 16 - legLiftRight, 9, 10 + legLiftRight);
    } else {
      // Ghost tail
      ctx.beginPath();
      ctx.moveTo(-16, 16);
      ctx.quadraticCurveTo(-8, 24 + Math.sin(now / 150) * 4, 0, 18);
      ctx.quadraticCurveTo(8, 24 - Math.sin(now / 150) * 4, 16, 16);
      ctx.lineTo(16, -6);
      ctx.lineTo(-16, -6);
      ctx.fillStyle = p.color;
      ctx.fill();
    }

    // 3. Body Torso
    ctx.beginPath();
    ctx.arc(0, -6, 16, Math.PI, 0, false);
    ctx.rect(-16, -6, 32, 22);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    // 4. Visor with glass reflection
    ctx.beginPath();
    ctx.ellipse(4, -4, 10, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    // Visor gleam
    ctx.beginPath();
    ctx.ellipse(2, -6, 4, 2, -0.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fill();

    // Restore un-flipped coordinate system for labels/text
    ctx.restore();

    ctx.save();
    ctx.translate(anim.x, anim.y);

    // Name tag (always readable horizontally)
    ctx.fillStyle = p.role === 'criminal' && me.role === 'criminal' ? '#ef4444' : '#ffffff';
    ctx.font = 'bold 14px Rajdhani';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, 0, -28 + bobY);

    if (p.id === me.id) {
      // Pulsing pointer arrow above local player
      const arrowBounce = Math.sin(now / 180) * 3;
      ctx.beginPath();
      ctx.moveTo(-6, -46 + arrowBounce);
      ctx.lineTo(6, -46 + arrowBounce);
      ctx.lineTo(0, -38 + arrowBounce);
      ctx.fillStyle = '#38bdf8';
      ctx.fill();
    }

    ctx.restore();
  });

  // 8. Draw Solid Walls
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  WALLS.forEach(w => {
    ctx.beginPath();
    ctx.moveTo(w[0], w[1]);
    ctx.lineTo(w[2], w[3]);
    ctx.stroke();
  });

  // Draw Closed Doors (RF-06)
  const doors = lastServerTick.sabotages.doors;
  if (doors) {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 10;
    if (doors.sala_reuniones > 0) {
      ctx.beginPath();
      ctx.moveTo(580, 760); ctx.lineTo(580, 820);
      ctx.stroke();
    }
    if (doors.aula_101 > 0) {
      ctx.beginPath();
      ctx.moveTo(840, 420); ctx.lineTo(900, 420);
      ctx.stroke();
    }
    if (doors.laboratorio_norte > 0) {
      ctx.beginPath();
      ctx.moveTo(1720, 480); ctx.lineTo(1780, 480);
      ctx.stroke();
    }
    if (doors.taller_2 > 0) {
      ctx.beginPath();
      ctx.moveTo(1780, 700); ctx.lineTo(1840, 700);
      ctx.stroke();
    }
  }

  // 9. Client Fog of War Overlay con Oclusión Real de Paredes (Raycasting 2D)
  if (!me.isDead) {
    let visionMult = me.role === 'criminal' ? (lastServerTick.settings.impostorVision || 2.2) : (lastServerTick.settings.crewVision || 1.6);
    if (lastServerTick.sabotages.lights.active && me.role === 'innocent') {
      visionMult = 0.35;
    }
    const visionRadius = 500 * visionMult;

    // Recopilar todos los segmentos de pared y puertas cerradas
    const allSegments = [...WALLS];
    const doors = lastServerTick.sabotages.doors;
    if (doors) {
      if (doors.sala_reuniones > 0) allSegments.push([580, 760, 580, 820]);
      if (doors.aula_101 > 0) allSegments.push([840, 420, 900, 420]);
      if (doors.laboratorio_norte > 0) allSegments.push([1720, 480, 1780, 480]);
      if (doors.taller_2 > 0) allSegments.push([1780, 700, 1840, 700]);
    }

    // Algoritmo de Visibilidad 2D: lanzar rayos a los vértices y ángulos circundantes
    const angles = [];
    const stepCount = 90;
    for (let i = 0; i < stepCount; i++) {
      angles.push((i * 2 * Math.PI) / stepCount);
    }

    // Agregar ángulos directos a los vértices de las paredes cercanas
    for (let i = 0; i < allSegments.length; i++) {
      const seg = allSegments[i];
      for (const pt of [{x: seg[0], y: seg[1]}, {x: seg[2], y: seg[3]}]) {
        if (Math.hypot(pt.x - me.x, pt.y - me.y) <= visionRadius + 50) {
          const a = Math.atan2(pt.y - me.y, pt.x - me.x);
          angles.push(a - 0.0008, a, a + 0.0008);
        }
      }
    }

    // Normalizar y ordenar ángulos
    const uniqueAngles = Array.from(new Set(angles)).sort((a, b) => a - b);
    const visPolygon = [];

    for (let i = 0; i < uniqueAngles.length; i++) {
      const ang = uniqueAngles[i];
      const rayDirX = Math.cos(ang);
      const rayDirY = Math.sin(ang);
      const rEndX = me.x + rayDirX * visionRadius;
      const rEndY = me.y + rayDirY * visionRadius;

      let closestDist = visionRadius;
      let hitX = rEndX;
      let hitY = rEndY;

      for (let j = 0; j < allSegments.length; j++) {
        const seg = allSegments[j];
        // Intersección de línea rayo con segmento de pared
        const x1 = me.x, y1 = me.y, x2 = rEndX, y2 = rEndY;
        const x3 = seg[0], y3 = seg[1], x4 = seg[2], y4 = seg[3];

        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(denom) > 0.00001) {
          const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
          const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

          if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
            const hitDist = t * visionRadius;
            if (hitDist < closestDist) {
              closestDist = hitDist;
              hitX = x1 + t * (x2 - x1);
              hitY = y1 + t * (y2 - y1);
            }
          }
        }
      }

      visPolygon.push({ x: hitX, y: hitY });
    }

    // Dibujar la máscara de sombra profunda en el área no visible (totalmente oscura)
    ctx.save();
    ctx.beginPath();
    // Rectángulo exterior gigante
    const viewLeft = camera.x - width;
    const viewTop = camera.y - height;
    const viewW = width * 2;
    const viewH = height * 2;
    ctx.rect(viewLeft, viewTop, viewW, viewH);

    // Restar el polígono de visión iluminado
    if (visPolygon.length > 2) {
      ctx.moveTo(visPolygon[0].x, visPolygon[0].y);
      for (let i = visPolygon.length - 1; i >= 0; i--) {
        ctx.lineTo(visPolygon[i].x, visPolygon[i].y);
      }
      ctx.closePath();
    }

    // Color de oscuridad profunda estilo niebla de guerra
    ctx.fillStyle = 'rgba(3, 6, 12, 0.98)';
    ctx.fill();

    // Degradado sutil en el borde de visión
    const edgeGrad = ctx.createRadialGradient(me.x, me.y, visionRadius * 0.7, me.x, me.y, visionRadius);
    edgeGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    edgeGrad.addColorStop(1, 'rgba(3, 6, 12, 0.55)');
    ctx.fillStyle = edgeGrad;
    ctx.beginPath();
    ctx.arc(me.x, me.y, visionRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  ctx.restore();
}

requestAnimationFrame(renderCanvasLoop);

// --- Helpers ---
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
