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

// --- Map Constants (Mirror of Server Definition) ---
const ROOMS = [
  { id: 'cafeteria', name: 'Cafetería / Centro de Mando', x: 800, y: 150, w: 400, h: 300, isMeetingRoom: true },
  { id: 'weapons', name: 'Armería', x: 1350, y: 200, w: 300, h: 250 },
  { id: 'navigation', name: 'Navegación', x: 1500, y: 600, w: 350, h: 300 },
  { id: 'shields', name: 'Escudos', x: 1350, y: 1050, w: 300, h: 250 },
  { id: 'o2', name: 'Soporte Vital (O2)', x: 1100, y: 650, w: 250, h: 200 },
  { id: 'admin', name: 'Administración', x: 950, y: 950, w: 300, h: 250 },
  { id: 'communications', name: 'Comunicaciones', x: 1100, y: 1250, w: 250, h: 200 },
  { id: 'storage', name: 'Almacén Central', x: 750, y: 850, w: 350, h: 400 },
  { id: 'electrical', name: 'Electricidad', x: 450, y: 700, w: 250, h: 250 },
  { id: 'medbay', name: 'Enfermería', x: 500, y: 400, w: 250, h: 250 },
  { id: 'security', name: 'Seguridad', x: 350, y: 550, w: 200, h: 200 },
  { id: 'reactor', name: 'Reactor Nuclear', x: 100, y: 500, w: 250, h: 400 },
  { id: 'upper_engine', name: 'Motor Superior', x: 300, y: 200, w: 250, h: 250 },
  { id: 'lower_engine', name: 'Motor Inferior', x: 300, y: 1050, w: 250, h: 250 }
];

const EMERGENCY_BTN_POS = { x: 1000, y: 300, radius: 45 };

const WALLS = [
  [50, 50, 1950, 50], [1950, 50, 1950, 1450], [1950, 1450, 50, 1450], [50, 1450, 50, 50],
  [800, 150, 800, 450], [1200, 150, 1200, 450], [800, 150, 950, 150], [1050, 150, 1200, 150],
  [800, 450, 920, 450], [1080, 450, 1200, 450], [500, 400, 500, 650], [750, 400, 750, 520],
  [750, 580, 750, 650], [500, 400, 750, 400], [500, 650, 750, 650], [450, 700, 450, 950],
  [700, 700, 700, 800], [700, 880, 700, 950], [450, 700, 700, 700], [450, 950, 700, 950],
  [100, 500, 350, 500], [100, 900, 350, 900], [100, 500, 100, 900], [350, 500, 350, 630],
  [350, 770, 350, 900], [950, 950, 1250, 950], [950, 1200, 1250, 1200], [950, 950, 950, 1020],
  [950, 1100, 950, 1200], [1250, 950, 1250, 1200], [1350, 200, 1650, 200], [1650, 200, 1650, 450],
  [1350, 450, 1500, 450], [1500, 600, 1850, 600], [1850, 600, 1850, 900], [1500, 900, 1850, 900],
  [1500, 600, 1500, 700], [1500, 800, 1500, 900], [1350, 1050, 1650, 1050], [1350, 1300, 1650, 1300],
  [1650, 1050, 1650, 1300], [1350, 1050, 1350, 1150], [1350, 1220, 1350, 1300]
];

const VENTS = [
  { id: 'vent_cafeteria', x: 1150, y: 180 },
  { id: 'vent_admin', x: 1200, y: 980 },
  { id: 'vent_hall_e', x: 1400, y: 550 },
  { id: 'vent_reactor_up', x: 150, y: 530 },
  { id: 'vent_upper_engine', x: 480, y: 230 },
  { id: 'vent_reactor_down', x: 150, y: 870 },
  { id: 'vent_lower_engine', x: 480, y: 1100 },
  { id: 'vent_electrical', x: 480, y: 730 },
  { id: 'vent_medbay', x: 530, y: 430 },
  { id: 'vent_security', x: 380, y: 580 },
  { id: 'vent_weapons', x: 1600, y: 230 },
  { id: 'vent_nav', x: 1800, y: 630 },
  { id: 'vent_shields', x: 1600, y: 1250 }
];

const SABOTAGE_STATIONS = [
  { id: 'o2_panel_1', type: 'critical_o2', name: 'Terminal O2', x: 1150, y: 680 },
  { id: 'o2_panel_2', type: 'critical_o2', name: 'Terminal Admin', x: 1120, y: 1120 },
  { id: 'lights_panel', type: 'lights', name: 'Panel de Luces', x: 650, y: 730 },
  { id: 'comms_panel', type: 'comms', name: 'Antena de Señal', x: 1180, y: 1300 }
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
      // Find eligible alive target in range
      const killRanges = { short: 70, medium: 120, long: 170 };
      const maxDist = killRanges[tick.settings.killDistance] || 120;
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

  // Check normal tasks
  if (!useAction) {
    const uncompletedTasks = me.tasks.filter(t => !t.completed);
    const nearTask = uncompletedTasks.find(t => Math.hypot(t.x - me.x, t.y - me.y) <= 80);
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
  ws.send(JSON.stringify({ type: 'SABOTAGE', sabotageType: 'doors', target: 'electrical' }));
  document.getElementById('sabotage-modal').classList.add('hidden');
});
document.getElementById('btn-sab-doors-med').addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'SABOTAGE', sabotageType: 'doors', target: 'medbay' }));
  document.getElementById('sabotage-modal').classList.add('hidden');
});
document.getElementById('btn-sab-doors-cafe').addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'SABOTAGE', sabotageType: 'doors', target: 'cafeteria' }));
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

  // 1. Draw Starry/Void Background
  ctx.fillStyle = '#060911';
  ctx.fillRect(-200, -200, 2400, 1900);

  // 2. Draw Rooms floor
  ROOMS.forEach(r => {
    ctx.fillStyle = '#141d33';
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // Subtle grid pattern
    ctx.strokeStyle = '#1b2745';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    // Room Label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.font = 'bold 24px Rajdhani';
    ctx.textAlign = 'center';
    ctx.fillText(r.name.toUpperCase(), r.x + r.w / 2, r.y + r.h / 2);
  });

  // Corridors floor outline
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 2;

  // 3. Draw Emergency Table in Cafeteria
  ctx.beginPath();
  ctx.arc(EMERGENCY_BTN_POS.x, EMERGENCY_BTN_POS.y, EMERGENCY_BTN_POS.radius, 0, Math.PI * 2);
  ctx.fillStyle = '#1f293d';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#3b82f6';
  ctx.stroke();

  // Emergency Button Icon
  ctx.beginPath();
  ctx.arc(EMERGENCY_BTN_POS.x, EMERGENCY_BTN_POS.y, 18, 0, Math.PI * 2);
  ctx.fillStyle = lastServerTick.sabotages.critical.active ? '#6b7280' : '#ef4444';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px Orbitron';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EMERG', EMERGENCY_BTN_POS.x, EMERGENCY_BTN_POS.y);

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

  // 7. Draw Players (Visible ones from server authority payload)
  lastServerTick.players.forEach(p => {
    if (p.inVent && p.id !== me.id) return; // Hidden in vent

    ctx.save();
    ctx.translate(p.x, p.y);

    // Ghost transparency if dead
    if (p.isDead) {
      ctx.globalAlpha = 0.55;
    }

    // Backpack
    ctx.fillStyle = '#334155';
    ctx.fillRect(-22, -10, 8, 20);

    // Body
    ctx.beginPath();
    ctx.arc(0, -6, 16, Math.PI, 0, false);
    ctx.rect(-16, -6, 32, 22);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    // Legs
    ctx.fillRect(-14, 16, 9, 10);
    ctx.fillRect(5, 16, 9, 10);

    // Visor
    ctx.beginPath();
    ctx.ellipse(4, -4, 10, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();

    // Name tag
    ctx.fillStyle = p.role === 'criminal' && me.role === 'criminal' ? '#ef4444' : '#ffffff';
    ctx.font = 'bold 14px Rajdhani';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, 0, -28);

    if (p.id === me.id) {
      // Small pointer arrow above local player
      ctx.beginPath();
      ctx.moveTo(-6, -46); ctx.lineTo(6, -46); ctx.lineTo(0, -38);
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
    if (doors.cafeteria > 0) {
      ctx.beginPath();
      ctx.moveTo(950, 150); ctx.lineTo(1050, 150);
      ctx.moveTo(920, 450); ctx.lineTo(1080, 450);
      ctx.stroke();
    }
    if (doors.electrical > 0) {
      ctx.beginPath();
      ctx.moveTo(700, 800); ctx.lineTo(700, 880);
      ctx.stroke();
    }
    if (doors.medbay > 0) {
      ctx.beginPath();
      ctx.moveTo(750, 520); ctx.lineTo(750, 580);
      ctx.stroke();
    }
    if (doors.storage > 0) {
      ctx.beginPath();
      ctx.moveTo(850, 850); ctx.lineTo(950, 850);
      ctx.stroke();
    }
  }

  // 9. Client Fog of War Overlay (Visual smoothness)
  if (!me.isDead) {
    let visionMult = me.role === 'criminal' ? lastServerTick.settings.impostorVision : lastServerTick.settings.crewVision;
    if (lastServerTick.sabotages.lights.active && me.role === 'innocent') {
      visionMult = 0.25;
    }
    const visionRadius = 350 * visionMult;

    // Dark mask with transparent circle at player
    const grad = ctx.createRadialGradient(me.x, me.y, visionRadius * 0.4, me.x, me.y, visionRadius);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(0.85, 'rgba(0, 0, 0, 0.4)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.96)');

    ctx.fillStyle = grad;
    ctx.fillRect(camera.x - width, camera.y - height, width * 2, height * 2);
  }

  ctx.restore();
}

requestAnimationFrame(renderCanvasLoop);

// --- Helpers ---
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
