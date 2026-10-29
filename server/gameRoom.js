// GameRoom class handling authoritative game state, loop, and client syncing
const {
  MAP_WIDTH,
  MAP_HEIGHT,
  ROOMS,
  EMERGENCY_BUTTON,
  WALLS,
  VENTS,
  TASK_DEFINITIONS,
  SABOTAGE_STATIONS
} = require('./map');
const { distance, hasLineOfSight, resolveCollisions } = require('./raycasting');

class GameRoom {
  constructor(code, hostId, isPublic = true) {
    this.code = code;
    this.hostId = hostId;
    this.isPublic = isPublic;

    // Room Settings (RF-02)
    this.settings = {
      maxPlayers: 8,
      impostorCount: 1, // 1 or 2
      moveSpeed: 1.5, // 1.0x to 3.0x
      crewVision: 1.0, // multiplier
      impostorVision: 1.5,
      killCooldown: 25, // seconds
      killDistance: 'medium', // short(60), medium(110), long(160)
      discussionTime: 15, // seconds
      votingTime: 30, // seconds
      tasksCount: 4, // per crewmate
      anonymousVoting: false,
      visualTasks: true,
      confirmEjects: true
    };

    // State machine: 'lobby' | 'playing' | 'discussion' | 'voting' | 'ended'
    this.state = 'lobby';
    this.players = new Map(); // id -> Player
    this.deadBodies = []; // { id, victimId, victimName, color, x, y, killerId }
    this.chatMessages = []; // { id, senderId, senderName, text, isDead, time }

    // Sabotages (RF-06)
    this.sabotages = {
      critical: {
        active: false,
        type: null, // 'o2'
        timeLeft: 30,
        repairedPanels: new Set()
      },
      lights: {
        active: false,
        switches: [false, true, false, true, false] // must all be true
      },
      doors: {
        cafeteria: 0,
        electrical: 0,
        medbay: 0,
        storage: 0
      },
      comms: {
        active: false
      },
      cooldown: 0
    };

    // Voting state (RF-08)
    this.meeting = {
      reporterId: null,
      reason: null, // 'body' or 'button'
      bodyId: null,
      phase: null, // 'discussion' or 'voting'
      timer: 0,
      votes: new Map(), // voterId -> targetId ('skip' or playerId)
      ejectedPlayer: null,
      resultText: ''
    };

    this.emergencyMeetingsUsed = new Map(); // playerId -> count
    this.tasksProgress = {
      completed: 0,
      total: 0
    };

    this.winner = null;
    this.winReason = '';

    // Door wall segments when closed
    this.doorSegments = {
      cafeteria: [ [950, 150, 1050, 150], [920, 450, 1080, 450] ],
      electrical: [ [700, 800, 700, 880] ],
      medbay: [ [750, 520, 750, 580] ],
      storage: [ [850, 850, 950, 850] ]
    };

    this.tickInterval = null;
    this.lastTickTime = Date.now();
  }

  addPlayer(id, name, ws) {
    if (this.players.size >= this.settings.maxPlayers) {
      return { success: false, reason: 'La sala está llena.' };
    }
    if (this.state !== 'lobby') {
      return { success: false, reason: 'La partida ya está en curso.' };
    }

    const availableColors = [
      '#ef4444', // Red
      '#3b82f6', // Blue
      '#10b981', // Green
      '#f59e0b', // Yellow
      '#8b5cf6', // Purple
      '#ec4899', // Pink
      '#06b6d4', // Cyan
      '#f97316'  // Orange
    ];
    const usedColors = Array.from(this.players.values()).map(p => p.color);
    const color = availableColors.find(c => !usedColors.includes(c)) || '#94a3b8';

    const player = {
      id,
      name: name || `Agente ${this.players.size + 1}`,
      color,
      ws,
      x: 1000 + (Math.random() * 80 - 40),
      y: 280 + (Math.random() * 80 - 40),
      role: 'innocent', // 'innocent' | 'criminal'
      isDead: false,
      inVent: null, // ventId or null
      killCooldown: this.settings.killCooldown,
      tasks: [],
      votedFor: null,
      inputs: { up: false, down: false, left: false, right: false }
    };

    this.players.set(id, player);
    return { success: true, player };
  }

  removePlayer(id) {
    const player = this.players.get(id);
    this.players.delete(id);

    if (this.players.size === 0) {
      this.stop();
      return;
    }

    // Pass host if needed
    if (this.hostId === id) {
      this.hostId = this.players.keys().next().value;
    }

    // If game in progress, check win conditions
    if (this.state === 'playing' || this.state === 'discussion' || this.state === 'voting') {
      this.recalculateTaskTotal();
      this.checkWinConditions();
    }
  }

  updateSettings(newSettings, requesterId) {
    if (requesterId !== this.hostId || this.state !== 'lobby') return false;
    this.settings = { ...this.settings, ...newSettings };
    return true;
  }

  startGame(requesterId) {
    if (requesterId !== this.hostId) return { success: false, reason: 'Solo el anfitrión puede iniciar la partida.' };
    if (this.players.size < 2) return { success: false, reason: 'Se necesitan mínimo 2 jugadores para iniciar.' };

    this.state = 'playing';
    this.winner = null;
    this.winReason = '';
    this.deadBodies = [];
    this.chatMessages = [];
    this.sabotages.critical.active = false;
    this.sabotages.lights.active = false;
    this.sabotages.comms.active = false;

    // Distribute roles (RF-01, RF-02)
    const playerIds = Array.from(this.players.keys());
    // Shuffle
    for (let i = playerIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]];
    }

    const impCount = Math.min(this.settings.impostorCount, Math.floor(playerIds.length / 2) || 1);
    const criminalIds = new Set(playerIds.slice(0, impCount));

    // Spawn point: around Cafeteria table
    const spawnPoints = [
      { x: 960, y: 240 }, { x: 1040, y: 240 },
      { x: 940, y: 300 }, { x: 1060, y: 300 },
      { x: 960, y: 360 }, { x: 1040, y: 360 },
      { x: 900, y: 300 }, { x: 1100, y: 300 }
    ];

    let pIndex = 0;
    this.tasksProgress.completed = 0;
    this.tasksProgress.total = 0;

    for (const [id, player] of this.players) {
      player.role = criminalIds.has(id) ? 'criminal' : 'innocent';
      player.isDead = false;
      player.inVent = null;
      player.killCooldown = this.settings.killCooldown;
      player.x = spawnPoints[pIndex % spawnPoints.length].x;
      player.y = spawnPoints[pIndex % spawnPoints.length].y;
      player.votedFor = null;
      pIndex++;

      // Assign tasks
      if (player.role === 'innocent') {
        const pool = [...TASK_DEFINITIONS].sort(() => 0.5 - Math.random());
        player.tasks = pool.slice(0, this.settings.tasksCount).map(t => ({
          ...t,
          completed: false
        }));
        this.tasksProgress.total += player.tasks.length;
      } else {
        // Criminals get fake tasks (RF-04)
        const pool = [...TASK_DEFINITIONS].sort(() => 0.5 - Math.random());
        player.tasks = pool.slice(0, this.settings.tasksCount).map(t => ({
          ...t,
          completed: false,
          isFake: true
        }));
      }
    }

    this.startTick();
    return { success: true };
  }

  recalculateTaskTotal() {
    let completed = 0;
    let total = 0;
    for (const player of this.players.values()) {
      if (player.role === 'innocent') {
        for (const t of player.tasks) {
          total++;
          if (t.completed) completed++;
        }
      }
    }
    this.tasksProgress.completed = completed;
    this.tasksProgress.total = total;
  }

  startTick() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    // 30 Hz tickrate (RNF-01)
    const tickMs = 1000 / 30;
    this.lastTickTime = Date.now();
    this.tickInterval = setInterval(() => this.tick(), tickMs);
  }

  stop() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  tick() {
    const now = Date.now();
    const dt = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;

    if (this.state === 'playing') {
      this.updatePlayingState(dt);
    } else if (this.state === 'discussion' || this.state === 'voting') {
      this.updateMeetingState(dt);
    }

    this.broadcastState();
  }

  updatePlayingState(dt) {
    // 1. Update door timers (RF-06)
    for (const roomKey of Object.keys(this.sabotages.doors)) {
      if (this.sabotages.doors[roomKey] > 0) {
        this.sabotages.doors[roomKey] = Math.max(0, this.sabotages.doors[roomKey] - dt);
      }
    }

    // 2. Update critical sabotage timer (RF-06 / 3.2)
    if (this.sabotages.critical.active) {
      this.sabotages.critical.timeLeft -= dt;
      if (this.sabotages.critical.timeLeft <= 0) {
        this.winner = 'criminal';
        this.winReason = 'Sabotaje Crítico letal no reparado a tiempo';
        this.state = 'ended';
        return;
      }
    }

    // 3. Update player positions (Server Authority RNF-04)
    const closedDoorObstacles = [];
    for (const [rName, dur] of Object.entries(this.sabotages.doors)) {
      if (dur > 0 && this.doorSegments[rName]) {
        for (const seg of this.doorSegments[rName]) {
          closedDoorObstacles.push({ closed: true, wallSegment: seg });
        }
      }
    }

    const baseSpeed = 160 * this.settings.moveSpeed; // px per second

    for (const player of this.players.values()) {
      // Cooldown decrement
      if (player.role === 'criminal' && player.killCooldown > 0) {
        player.killCooldown = Math.max(0, player.killCooldown - dt);
      }

      // If inside vent or dead and during playing (ghosts can move through walls), handle movement
      if (player.inVent) {
        continue;
      }

      let dx = 0;
      let dy = 0;
      if (player.inputs.up) dy -= 1;
      if (player.inputs.down) dy += 1;
      if (player.inputs.left) dx -= 1;
      if (player.inputs.right) dx += 1;

      if (dx !== 0 && dy !== 0) {
        const factor = 1 / Math.SQRT2;
        dx *= factor;
        dy *= factor;
      }

      const moveStep = baseSpeed * dt;
      const targetX = player.x + dx * moveStep;
      const targetY = player.y + dy * moveStep;

      if (player.isDead) {
        // Ghost movement: can pass walls within map boundaries
        player.x = Math.max(60, Math.min(MAP_WIDTH - 60, targetX));
        player.y = Math.max(60, Math.min(MAP_HEIGHT - 60, targetY));
      } else {
        // Authoritative collision check
        const resolved = resolveCollisions(
          player.x,
          player.y,
          targetX,
          targetY,
          20, // player radius
          WALLS,
          closedDoorObstacles
        );
        player.x = resolved.x;
        player.y = resolved.y;
      }
    }

    this.checkWinConditions();
  }

  updateMeetingState(dt) {
    this.meeting.timer -= dt;

    if (this.state === 'discussion' && this.meeting.timer <= 0) {
      // Move to voting phase
      this.state = 'voting';
      this.meeting.phase = 'voting';
      this.meeting.timer = this.settings.votingTime;
    } else if (this.state === 'voting') {
      const allVoted = this.checkAllAlivePlayersVoted();
      if (this.meeting.timer <= 0 || allVoted) {
        this.tallyVotesAndConclude();
      }
    }
  }

  checkAllAlivePlayersVoted() {
    let aliveCount = 0;
    let votesCount = 0;
    for (const player of this.players.values()) {
      if (!player.isDead) {
        aliveCount++;
        if (this.meeting.votes.has(player.id)) {
          votesCount++;
        }
      }
    }
    return aliveCount > 0 && votesCount >= aliveCount;
  }

  tallyVotesAndConclude() {
    const voteCounts = new Map(); // targetId -> count
    voteCounts.set('skip', 0);

    for (const [voterId, targetId] of this.meeting.votes) {
      voteCounts.set(targetId, (voteCounts.get(targetId) || 0) + 1);
    }

    let topTarget = null;
    let maxVotes = 0;
    let isTie = false;

    for (const [targetId, count] of voteCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        topTarget = targetId;
        isTie = false;
      } else if (count === maxVotes && maxVotes > 0) {
        isTie = true;
      }
    }

    let ejected = null;
    let message = 'Nadie fue expulsado (Empate o votos insuficientes).';

    if (!isTie && topTarget && topTarget !== 'skip') {
      ejected = this.players.get(topTarget);
      if (ejected) {
        ejected.isDead = true;
        if (this.settings.confirmEjects) {
          message = `${ejected.name} fue expulsado. Era ${ejected.role === 'criminal' ? 'un Criminal' : 'Inocente'}.`;
        } else {
          message = `${ejected.name} fue expulsado.`;
        }
      }
    } else if (topTarget === 'skip') {
      message = 'Nadie fue expulsado (Votación saltada).';
    }

    this.meeting.ejectedPlayer = ejected ? { id: ejected.id, name: ejected.name, role: ejected.role } : null;
    this.meeting.resultText = message;

    // Reset meeting votes
    for (const p of this.players.values()) {
      p.votedFor = null;
    }

    // Check win condition right after ejection
    if (this.checkWinConditions()) {
      return;
    }

    // Pause briefly for showing result before returning to action
    setTimeout(() => {
      if (this.state === 'voting' && !this.winner) {
        this.state = 'playing';
        this.deadBodies = []; // Clear reported bodies
        // Reset player positions to cafeteria table
        for (const p of this.players.values()) {
          p.x = 1000 + (Math.random() * 80 - 40);
          p.y = 280 + (Math.random() * 80 - 40);
          p.inVent = null;
          p.killCooldown = this.settings.killCooldown;
        }
      }
    }, 5000);
  }

  checkWinConditions() {
    let aliveCrew = 0;
    let aliveCriminals = 0;

    for (const player of this.players.values()) {
      if (!player.isDead) {
        if (player.role === 'criminal') aliveCriminals++;
        else aliveCrew++;
      }
    }

    // Condition 1: All Criminals ejected -> Crew wins
    if (aliveCriminals === 0) {
      this.winner = 'innocent';
      this.winReason = 'Todos los criminales fueron eliminados.';
      this.state = 'ended';
      return true;
    }

    // Condition 2: Criminals equal or outnumber crewmates -> Criminals win
    if (aliveCriminals >= aliveCrew) {
      this.winner = 'criminal';
      this.winReason = 'Los criminales han tomado el control de la tripulación.';
      this.state = 'ended';
      return true;
    }

    // Condition 3: All innocent tasks completed 100% -> Crew wins
    if (this.tasksProgress.total > 0 && this.tasksProgress.completed >= this.tasksProgress.total) {
      this.winner = 'innocent';
      this.winReason = 'Todas las tareas fueron completadas satisfactoriamente.';
      this.state = 'ended';
      return true;
    }

    return false;
  }

  // --- ACTIONS (Server Authoritative) ---

  handlePlayerInput(playerId, inputs) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.inputs = inputs;
  }

  handleKill(criminalId, targetId) {
    const criminal = this.players.get(criminalId);
    const target = this.players.get(targetId);

    if (!criminal || !target) return { success: false, reason: 'Jugador no encontrado' };
    if (this.state !== 'playing') return { success: false, reason: 'Acción no permitida en esta fase' };
    if (criminal.role !== 'criminal' || criminal.isDead) return { success: false, reason: 'No autorizado' };
    if (target.isDead || target.role === 'criminal') return { success: false, reason: 'Objetivo inválido' };
    if (criminal.killCooldown > 0) return { success: false, reason: 'Cooldown activo' };

    const killRanges = { short: 70, medium: 120, long: 170 };
    const maxDist = killRanges[this.settings.killDistance] || 120;
    const dist = distance(criminal.x, criminal.y, target.x, target.y);

    if (dist > maxDist) {
      return { success: false, reason: 'Objetivo fuera de rango' };
    }

    // Execute kill (RF-05)
    target.isDead = true;
    criminal.killCooldown = this.settings.killCooldown;

    // Teleport criminal to target for kill snap
    criminal.x = target.x;
    criminal.y = target.y;

    // Spawn dead body
    const body = {
      id: `body_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      victimId: target.id,
      victimName: target.name,
      color: target.color,
      x: target.x,
      y: target.y,
      killerId: criminal.id,
      reported: false
    };
    this.deadBodies.push(body);

    this.checkWinConditions();
    return { success: true, bodyId: body.id };
  }

  handleVent(playerId, ventId) {
    const player = this.players.get(playerId);
    if (!player || player.role !== 'criminal' || player.isDead || this.state !== 'playing') {
      return { success: false };
    }

    const vent = VENTS.find(v => v.id === ventId);
    if (!vent) return { success: false };

    // If not in vent, enter if close
    if (!player.inVent) {
      if (distance(player.x, player.y, vent.x, vent.y) <= 80) {
        player.inVent = vent.id;
        player.x = vent.x;
        player.y = vent.y;
        return { success: true, action: 'entered', ventId: vent.id };
      }
    } else {
      // In vent: either jump to connected vent or exit
      if (player.inVent === ventId) {
        // Exit
        player.inVent = null;
        return { success: true, action: 'exited', ventId };
      } else {
        const currentVent = VENTS.find(v => v.id === player.inVent);
        if (currentVent && currentVent.connected.includes(ventId)) {
          player.inVent = ventId;
          player.x = vent.x;
          player.y = vent.y;
          return { success: true, action: 'moved', ventId };
        }
      }
    }
    return { success: false };
  }

  handleReport(playerId, bodyId) {
    const player = this.players.get(playerId);
    if (!player || player.isDead || this.state !== 'playing') return false;

    let body = null;
    if (bodyId) {
      body = this.deadBodies.find(b => b.id === bodyId && !b.reported);
    } else {
      // Find nearest body
      body = this.deadBodies.find(b => !b.reported && distance(player.x, player.y, b.x, b.y) <= 120);
    }

    if (!body) return false;
    body.reported = true;

    this.triggerMeeting(playerId, 'body', body.id);
    return true;
  }

  handleEmergencyButton(playerId) {
    const player = this.players.get(playerId);
    if (!player || player.isDead || this.state !== 'playing') return false;

    // Check sabotage active: button disabled during critical sabotages
    if (this.sabotages.critical.active) return false;

    const dist = distance(player.x, player.y, EMERGENCY_BUTTON.x, EMERGENCY_BUTTON.y);
    if (dist > EMERGENCY_BUTTON.radius + 40) return false;

    const used = this.emergencyMeetingsUsed.get(playerId) || 0;
    if (used >= 1) return false; // 1 per player

    this.emergencyMeetingsUsed.set(playerId, used + 1);
    this.triggerMeeting(playerId, 'button', null);
    return true;
  }

  triggerMeeting(reporterId, reason, bodyId) {
    this.state = 'discussion';
    this.meeting = {
      reporterId,
      reason,
      bodyId,
      phase: 'discussion',
      timer: this.settings.discussionTime,
      votes: new Map(),
      ejectedPlayer: null,
      resultText: ''
    };

    // Move all players to cafeteria table and reset inputs
    for (const p of this.players.values()) {
      p.inVent = null;
      p.inputs = { up: false, down: false, left: false, right: false };
    }
  }

  handleVote(voterId, targetId) {
    if (this.state !== 'voting') return false;
    const voter = this.players.get(voterId);
    if (!voter || voter.isDead) return false;

    if (targetId !== 'skip' && !this.players.has(targetId)) return false;

    this.meeting.votes.set(voterId, targetId);
    voter.votedFor = targetId;

    if (this.checkAllAlivePlayersVoted()) {
      this.tallyVotesAndConclude();
    }
    return true;
  }

  handleCompleteTask(playerId, taskId) {
    const player = this.players.get(playerId);
    if (!player) return false;

    const task = player.tasks.find(t => t.id === taskId);
    if (!task || task.completed) return false;

    task.completed = true;
    if (player.role === 'innocent') {
      this.recalculateTaskTotal();
      this.checkWinConditions();
    }
    return true;
  }

  handleSabotage(criminalId, type, target) {
    const criminal = this.players.get(criminalId);
    if (!criminal || criminal.role !== 'criminal' || criminal.isDead || this.state !== 'playing') {
      return false;
    }

    if (type === 'critical_o2') {
      if (this.sabotages.critical.active) return false;
      this.sabotages.critical.active = true;
      this.sabotages.critical.type = 'o2';
      this.sabotages.critical.timeLeft = 30; // 30s critical (RF-06)
      this.sabotages.critical.repairedPanels = new Set();
      return true;
    }

    if (type === 'lights') {
      this.sabotages.lights.active = true;
      this.sabotages.lights.switches = [false, false, false, false, false];
      return true;
    }

    if (type === 'doors' && target) {
      if (this.sabotages.doors[target] !== undefined) {
        this.sabotages.doors[target] = 10; // 10s isolation (RF-06)
        return true;
      }
    }

    if (type === 'comms') {
      this.sabotages.comms.active = true;
      return true;
    }

    return false;
  }

  handleRepairSabotage(playerId, type, data) {
    const player = this.players.get(playerId);
    if (!player || player.isDead || this.state !== 'playing') return false;

    if (type === 'critical_o2' && this.sabotages.critical.active) {
      const panelId = data && data.panelId;
      if (panelId) {
        this.sabotages.critical.repairedPanels.add(panelId);
        // Requires both panels to be touched or repaired
        if (this.sabotages.critical.repairedPanels.size >= 2) {
          this.sabotages.critical.active = false;
          this.sabotages.critical.type = null;
        }
        return true;
      }
    }

    if (type === 'lights' && this.sabotages.lights.active) {
      if (data && Array.isArray(data.switches)) {
        this.sabotages.lights.switches = data.switches;
        if (data.switches.every(s => s === true)) {
          this.sabotages.lights.active = false;
        }
        return true;
      }
    }

    if (type === 'comms' && this.sabotages.comms.active) {
      this.sabotages.comms.active = false;
      return true;
    }

    return false;
  }

  handleChatMessage(playerId, text) {
    const player = this.players.get(playerId);
    if (!player || !text || text.trim() === '') return false;

    // Chat is active during meetings (or ghosts can chat anytime)
    const isMeeting = this.state === 'discussion' || this.state === 'voting';
    if (!isMeeting && !player.isDead) {
      return false; // Alive players cannot chat during free gameplay
    }

    const msg = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      senderId: player.id,
      senderName: player.name,
      color: player.color,
      isDead: player.isDead,
      text: text.trim().slice(0, 140),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    this.chatMessages.push(msg);
    if (this.chatMessages.length > 50) this.chatMessages.shift();

    return true;
  }

  // --- Authoritative Sync per Player (RF-03 Fog of War & Anti-Cheat) ---

  broadcastState() {
    const closedDoorObstacles = [];
    for (const [rName, dur] of Object.entries(this.sabotages.doors)) {
      if (dur > 0 && this.doorSegments[rName]) {
        for (const seg of this.doorSegments[rName]) {
          closedDoorObstacles.push({ closed: true, wallSegment: seg });
        }
      }
    }

    for (const player of this.players.values()) {
      if (!player.ws || player.ws.readyState !== 1) continue;

      // Calculate vision radius for this player
      let visionMult = player.role === 'criminal' ? this.settings.impostorVision : this.settings.crewVision;
      if (this.sabotages.lights.active && player.role === 'innocent') {
        visionMult = 0.25; // Lights sabotage drastically reduces crew vision (RF-06)
      }
      const maxVisionRadius = 350 * visionMult;

      // Filter visible players using server raycast (RF-03 Anti-Wallhack)
      const visiblePlayers = [];
      const isMeeting = this.state === 'discussion' || this.state === 'voting';

      for (const other of this.players.values()) {
        if (other.id === player.id) {
          visiblePlayers.push({
            id: other.id,
            name: other.name,
            color: other.color,
            x: other.x,
            y: other.y,
            role: other.role,
            isDead: other.isDead,
            inVent: other.inVent,
            votedFor: this.meeting.votes.has(other.id)
          });
          continue;
        }

        // Dead players (ghosts) see everyone
        if (player.isDead || isMeeting) {
          visiblePlayers.push({
            id: other.id,
            name: other.name,
            color: other.color,
            x: other.x,
            y: other.y,
            role: (player.role === 'criminal' || player.isDead) ? other.role : 'unknown',
            isDead: other.isDead,
            inVent: other.inVent,
            votedFor: this.meeting.votes.has(other.id)
          });
          continue;
        }

        // Alive player cannot see dead ghosts
        if (other.isDead) continue;

        // Player hidden in vent is not visible to crew
        if (other.inVent && player.role !== 'criminal') continue;

        // Authoritative LOS check
        const visible = hasLineOfSight(
          player.x,
          player.y,
          other.x,
          other.y,
          WALLS,
          closedDoorObstacles,
          maxVisionRadius
        );

        if (visible) {
          visiblePlayers.push({
            id: other.id,
            name: other.name,
            color: other.color,
            x: other.x,
            y: other.y,
            // Reveal criminal role only to fellow criminals
            role: player.role === 'criminal' ? other.role : 'unknown',
            isDead: false,
            inVent: other.inVent,
            votedFor: this.meeting.votes.has(other.id)
          });
        }
      }

      // Filter visible dead bodies
      const visibleBodies = [];
      for (const b of this.deadBodies) {
        if (player.isDead || isMeeting) {
          visibleBodies.push(b);
        } else {
          const visible = hasLineOfSight(
            player.x,
            player.y,
            b.x,
            b.y,
            WALLS,
            closedDoorObstacles,
            maxVisionRadius
          );
          if (visible) visibleBodies.push(b);
        }
      }

      // Filter contextual chat (RF-08: dead players cannot talk to living players)
      const filteredChat = this.chatMessages.filter(msg => {
        if (!player.isDead && msg.isDead) return false;
        return true;
      });

      const payload = {
        type: 'GAME_TICK',
        roomCode: this.code,
        hostId: this.hostId,
        state: this.state,
        settings: this.settings,
        playerMe: {
          id: player.id,
          name: player.name,
          color: player.color,
          role: player.role,
          isDead: player.isDead,
          inVent: player.inVent,
          killCooldown: player.killCooldown,
          tasks: player.tasks,
          votedFor: player.votedFor
        },
        players: visiblePlayers,
        deadBodies: visibleBodies,
        tasksProgress: this.tasksProgress,
        sabotages: {
          critical: {
            active: this.sabotages.critical.active,
            timeLeft: Math.ceil(this.sabotages.critical.timeLeft),
            repairedPanels: Array.from(this.sabotages.critical.repairedPanels)
          },
          lights: {
            active: this.sabotages.lights.active,
            switches: this.sabotages.lights.switches
          },
          doors: this.sabotages.doors,
          comms: this.sabotages.comms
        },
        meeting: {
          reporterId: this.meeting.reporterId,
          reason: this.meeting.reason,
          phase: this.meeting.phase,
          timer: Math.ceil(this.meeting.timer),
          ejectedPlayer: this.meeting.ejectedPlayer,
          resultText: this.meeting.resultText
        },
        chat: filteredChat,
        winner: this.winner,
        winReason: this.winReason
      };

      player.ws.send(JSON.stringify(payload));
    }
  }
}

module.exports = { GameRoom };
