// Comprehensive Automated Test Suite for Suberri Crime
// Validates SRS requirements:
// - RF-01, RF-02: Lobby & Settings
// - RF-03: Fog of War Raycasting (No Wallhacks)
// - RF-04: Tasks & Global Progress
// - RF-05: Authoritative Kill Mechanics & Cooldown
// - RF-06: Sabotage Timers & Critical Conditions
// - RF-07: Criminal Vent Teleportation
// - RF-08: Voting, Chat filtering, & Ejection
// - CP-NET-01, CP-GAME-02: Anti-Cheat & Race Conditions

const assert = require('assert');
const { GameRoom } = require('../server/gameRoom');
const { hasLineOfSight, resolveCollisions, distance } = require('../server/raycasting');
const { WALLS, VENTS, EMERGENCY_BUTTON } = require('../server/map');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err.message);
  }
}

// Mock WebSocket
class MockWS {
  constructor() {
    this.readyState = 1;
    this.messages = [];
  }
  send(data) {
    this.messages.push(JSON.parse(data));
  }
}

console.log('--- INICIANDO SUITE DE PRUEBAS AUTOMATIZADAS (SUBERRI CRIME SRS 1.0.0) ---');

// 1. Lobby & Room Management (RF-01, RF-02)
runTest('RF-01: Creación de sala y asignación de host', () => {
  const room = new GameRoom('TEST01', 'p_host', true);
  assert.strictEqual(room.code, 'TEST01');
  assert.strictEqual(room.hostId, 'p_host');
  assert.strictEqual(room.state, 'lobby');
});

runTest('RF-02: Modificación autorizada de ajustes de partida', () => {
  const room = new GameRoom('TEST02', 'p_host', true);
  const updated = room.updateSettings({ killCooldown: 15, moveSpeed: 2.0 }, 'p_host');
  assert.strictEqual(updated, true);
  assert.strictEqual(room.settings.killCooldown, 15);
  assert.strictEqual(room.settings.moveSpeed, 2.0);

  // Unauthorized player should fail
  const unauthorized = room.updateSettings({ killCooldown: 10 }, 'p_cheater');
  assert.strictEqual(unauthorized, false);
  assert.strictEqual(room.settings.killCooldown, 15);
});

// 2. Collision & Server-Authoritative Movement (RNF-04, CP-NET-01)
runTest('RNF-04 / CP-NET-01: Detección y resolución de colisión con paredes en servidor', () => {
  const wallSegment = [100, 100, 100, 300];
  // Player tries to walk into wall at (98, 200) from (80, 200)
  const resolved = resolveCollisions(80, 200, 98, 200, 20, [wallSegment], []);
  // Should stop player or push back to valid position
  assert(resolved.x <= 80, `Resolved X (${resolved.x}) should not penetate wall boundary`);
});

// 3. Fog of War Raycasting (RF-03, CP-VIS-03)
runTest('RF-03: Oclusión visual por raycasting (No Wallhacks)', () => {
  // Test straight line of sight through Aula 101 wall [740, 140, 740, 420]
  const p1 = { x: 650, y: 300 }; // Despacho / Pasillo oeste
  const p2 = { x: 850, y: 300 }; // Inside Aula 101

  const visibleThroughWall = hasLineOfSight(p1.x, p1.y, p2.x, p2.y, WALLS, [], 400);
  assert.strictEqual(visibleThroughWall, false, 'Entidades detrás de paredes sólidas no deben ser visibles');

  // Test clear unobstructed line of sight inside the same classroom
  const p3 = { x: 800, y: 300 };
  const p4 = { x: 920, y: 300 };
  const visibleClear = hasLineOfSight(p3.x, p3.y, p4.x, p4.y, WALLS, [], 400);
  assert.strictEqual(visibleClear, true, 'Entidades en la misma sala sin obstáculos deben ser visibles');
});

// 4. Role Assignment & Fake Tasks (RF-04)
runTest('RF-04: Asignación equitativa de roles y tareas falsas a criminales', () => {
  const room = new GameRoom('TEST04', 'p1', true);
  const ws1 = new MockWS();
  const ws2 = new MockWS();
  const ws3 = new MockWS();

  room.addPlayer('p1', 'Agente 1', ws1);
  room.addPlayer('p2', 'Agente 2', ws2);
  room.addPlayer('p3', 'Agente 3', ws3);

  const startRes = room.startGame('p1');
  assert.strictEqual(startRes.success, true);
  assert.strictEqual(room.state, 'playing');

  const criminals = Array.from(room.players.values()).filter(p => p.role === 'criminal');
  const innocents = Array.from(room.players.values()).filter(p => p.role === 'innocent');

  assert.strictEqual(criminals.length, 1);
  assert.strictEqual(innocents.length, 2);
  assert.strictEqual(criminals[0].tasks.every(t => t.isFake === true), true);
  assert.strictEqual(innocents[0].tasks.every(t => !t.isFake), true);
});

// 5. Authoritative Kill Mechanics (RF-05)
runTest('RF-05: Mecánica de Asesinato autoritaria y cooldown', () => {
  const room = new GameRoom('TEST05', 'p1', true);
  const ws1 = new MockWS();
  const ws2 = new MockWS();

  room.addPlayer('p1', 'Criminal', ws1);
  room.addPlayer('p2', 'Inocente', ws2);
  room.startGame('p1');

  const p1 = room.players.get('p1');
  const p2 = room.players.get('p2');

  p1.role = 'criminal';
  p1.killCooldown = 0;
  p2.role = 'innocent';
  p2.isDead = false;

  // Place nearby
  p1.x = 500; p1.y = 500;
  p2.x = 540; p2.y = 500;

  const killRes = room.handleKill(p1.id, p2.id);
  assert.strictEqual(killRes.success, true);
  assert.strictEqual(p2.isDead, true);
  assert.strictEqual(room.deadBodies.length, 1);
  assert.strictEqual(p1.killCooldown, room.settings.killCooldown);

  // Attempting second kill immediately must fail by cooldown
  const secondKill = room.handleKill(p1.id, p2.id);
  assert.strictEqual(secondKill.success, false);
});

// 6. Sabotage & Critical Timers (RF-06, 3.2)
runTest('RF-06: Sabotaje Crítico O2 y cuenta regresiva letal', () => {
  const room = new GameRoom('TEST06', 'p1', true);
  const ws1 = new MockWS();
  const ws2 = new MockWS();

  room.addPlayer('p1', 'Criminal', ws1);
  room.addPlayer('p2', 'Inocente', ws2);
  room.startGame('p1');

  room.players.get('p1').role = 'criminal';
  room.handleSabotage('p1', 'critical_o2');

  assert.strictEqual(room.sabotages.critical.active, true);
  assert.strictEqual(room.sabotages.critical.timeLeft, 30);

  // Simulate tick down of 31 seconds without repair
  room.updatePlayingState(31);

  assert.strictEqual(room.state, 'ended');
  assert.strictEqual(room.winner, 'criminal');
});

// 7. Vents Navigation (RF-07)
runTest('RF-07: Movimiento por red de ventilación exclusivo para criminales', () => {
  const room = new GameRoom('TEST07', 'p1', true);
  const ws1 = new MockWS();
  const ws2 = new MockWS();

  room.addPlayer('p1', 'Criminal', ws1);
  room.addPlayer('p2', 'Inocente', ws2);
  room.startGame('p1');

  const p1 = room.players.get('p1');
  const p2 = room.players.get('p2');
  p1.role = 'criminal';
  p2.role = 'innocent';

  const vent = VENTS[0]; // vent_cafeteria
  p1.x = vent.x; p1.y = vent.y;
  p2.x = vent.x; p2.y = vent.y;

  // Innocent trying to vent must fail
  const innocentVent = room.handleVent(p2.id, vent.id);
  assert.strictEqual(innocentVent.success, false);

  // Criminal enters vent
  const enterRes = room.handleVent(p1.id, vent.id);
  assert.strictEqual(enterRes.success, true);
  assert.strictEqual(p1.inVent, vent.id);

  // Jump to connected vent
  const nextVentId = vent.connected ? vent.connected[0] : 'vent_admin';
  const jumpRes = room.handleVent(p1.id, nextVentId);
  assert.strictEqual(jumpRes.success, true);
  assert.strictEqual(p1.inVent, nextVentId);
});

// 8. Voting & Race Condition Resilience (CP-GAME-02, RF-08)
runTest('CP-GAME-02 / RF-08: Resistencia a race conditions en reporte de cuerpos y votación', () => {
  const room = new GameRoom('TEST08', 'p1', true);
  const ws1 = new MockWS();
  const ws2 = new MockWS();
  const ws3 = new MockWS();

  room.addPlayer('p1', 'P1', ws1);
  room.addPlayer('p2', 'P2', ws2);
  room.addPlayer('p3', 'P3', ws3);
  room.startGame('p1');

  // Spawn body
  room.deadBodies.push({
    id: 'body_race',
    victimId: 'p3',
    victimName: 'P3',
    x: 1000,
    y: 300,
    reported: false
  });

  room.players.get('p1').x = 1000; room.players.get('p1').y = 300;
  room.players.get('p2').x = 1000; room.players.get('p2').y = 300;

  // Simultaneous report calls
  const rep1 = room.handleReport('p1', 'body_race');
  const rep2 = room.handleReport('p2', 'body_race');

  // One succeeds, second safely rejected without corrupting state
  assert.strictEqual(rep1, true);
  assert.strictEqual(rep2, false);
  assert.strictEqual(room.state, 'discussion');
});

console.log(`\n========================================`);
console.log(`RESULTADO DE PRUEBAS: ${passedTests}/${totalTests} TESTS COMPLETADOS CON ÉXITO.`);
console.log(`========================================\n`);

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
