// Plano Real de Evacuación: Suberri - 1. Solairua / Planta 1 (Somorrostro)
// Estructura arquitectónica real con pasillo central longitudinal,
// aulas norte, aulas sur, escaleras centrales, aseos y despachos laterales.

const MAP_WIDTH = 2200;
const MAP_HEIGHT = 1400;

// Habitaciones y Aulas reales del edificio Suberri (Planta 1)
const ROOMS = [
  // Aulas Fila Norte
  { id: 'aula_101', name: 'Aula 101 (Norte)', x: 740, y: 160, w: 260, h: 260 },
  { id: 'aula_102', name: 'Aula 102 (Norte)', x: 1020, y: 160, w: 280, h: 260 },
  { id: 'aula_103', name: 'Aula 103 (Norte)', x: 1320, y: 160, w: 280, h: 260 },
  { id: 'laboratorio_norte', name: 'Laboratorio Norte', x: 1620, y: 160, w: 240, h: 320 },

  // Ala Oeste (Izquierda)
  { id: 'despacho_oeste', name: 'Despacho Orientación', x: 300, y: 460, w: 280, h: 220 },
  { id: 'sala_reuniones', name: 'Sala de Profesores / Reuniones', x: 300, y: 700, w: 280, h: 420, isMeetingRoom: true },

  // Aulas Fila Sur
  { id: 'aula_104', name: 'Aula 104 (Punto Seguro)', x: 600, y: 700, w: 260, h: 420 },
  { id: 'aula_105', name: 'Aula 105 (Sur)', x: 880, y: 700, w: 260, h: 420 },
  { id: 'aula_106', name: 'Aula 106 (Sur)', x: 1160, y: 700, w: 260, h: 420 },
  { id: 'taller_1', name: 'Taller Técnico 1', x: 1440, y: 700, w: 220, h: 420 },
  { id: 'taller_2', name: 'Taller Técnico 2', x: 1680, y: 700, w: 240, h: 420 },

  // Núcleo Central de Servicios
  { id: 'escalera_central', name: 'Escaleras Principales', x: 1040, y: 460, w: 240, h: 180 },
  { id: 'aseos', name: 'Aseos Suberri', x: 860, y: 460, w: 160, h: 180 },

  // Ala Este (Derecha)
  { id: 'despacho_este', name: 'Despacho Dirección', x: 1620, y: 500, w: 240, h: 180 }
];

// Mesa de Reuniones y Botón de Emergencia (Ubicado en el Hall Central / Salida de Evacuación)
const EMERGENCY_BUTTON = { x: 1040, y: 660, radius: 45 };

// Muros físicos con puertas exactas de acceso desde los pasillos
// Formato: [x1, y1, x2, y2]
const WALLS = [
  // --- PERÍMETRO EXTERIOR ---
  [280, 140, 1880, 140],
  [1880, 140, 1880, 1140],
  [1880, 1140, 280, 1140],
  [280, 1140, 280, 140],

  // --- AULAS NORTE (y = 140 a 420) ---
  // Aula 101
  [740, 140, 740, 420],
  [1000, 140, 1000, 420],
  [740, 420, 810, 420], // Puerta amplia en [810, 930] (120px)
  [930, 420, 1000, 420],

  // Aula 102
  [1000, 140, 1000, 420],
  [1300, 140, 1300, 420],
  [1000, 420, 1090, 420], // Puerta amplia en [1090, 1210] (120px)
  [1210, 420, 1300, 420],

  // Aula 103
  [1300, 140, 1300, 420],
  [1600, 140, 1600, 420],
  [1300, 420, 1390, 420], // Puerta amplia en [1390, 1510] (120px)
  [1510, 420, 1600, 420],

  // Laboratorio Norte
  [1600, 140, 1600, 480],
  [1600, 480, 1690, 480], // Puerta amplia en [1690, 1810] (120px)
  [1810, 480, 1880, 480],

  // --- NÚCLEO CENTRAL (Aseos y Escaleras: y = 460 a 640) ---
  // Aseos
  [860, 460, 1020, 460],
  [860, 640, 1020, 640],
  [860, 460, 860, 500], [860, 600, 860, 640], // Puerta Oeste amplia (100px)
  [1020, 460, 1020, 640], // Muro divisorio aseos/escaleras

  // Escaleras Principales
  [1020, 460, 1280, 460],
  [1020, 640, 1280, 640],
  [1280, 460, 1280, 500], [1280, 600, 1280, 640], // Puerta Este amplia (100px)

  // --- ALA OESTE (x = 280 a 580) ---
  [580, 420, 580, 490], // Puerta despacho oeste [490, 610]
  [580, 610, 580, 680],
  [280, 680, 580, 680], // Divisoria entre despacho y profesores
  [580, 680, 580, 730], // Puerta profesores [730, 850]
  [580, 850, 580, 1140],

  // --- ALA ESTE (x = 1600 a 1880) ---
  [1600, 480, 1600, 530], // Puerta despacho este [530, 650]
  [1600, 650, 1600, 700],

  // --- AULAS SUR (y = 700 a 1140) ---
  // Pasillo pared superior sur (y = 700) con puertas amplias (120px cada una)
  [580, 700, 680, 700],   // Puerta Aula 104 en [680, 800]
  [800, 700, 950, 700],   // Puerta Aula 105 en [950, 1070]
  [1070, 700, 1230, 700], // Puerta Aula 106 en [1230, 1350]
  [1350, 700, 1490, 700], // Puerta Taller 1 en [1490, 1610]
  [1610, 700, 1750, 700], // Puerta Taller 2 en [1750, 1870]
  [1870, 700, 1880, 700],

  // Paredes divisorias entre aulas sur
  [870, 700, 870, 1140],  // 104 / 105
  [1150, 700, 1150, 1140], // 105 / 106
  [1430, 700, 1430, 1140], // 106 / Taller 1
  [1670, 700, 1670, 1140]  // Taller 1 / Taller 2
];

// Red de conductos / escotillas técnicas Suberri (Criminales RF-07)
const VENTS = [
  { id: 'vent_aula101', x: 800, y: 220, connected: ['vent_aseos', 'vent_profesores'] },
  { id: 'vent_aseos', x: 920, y: 520, connected: ['vent_aula101', 'vent_aula104'] },
  { id: 'vent_aula104', x: 700, y: 800, connected: ['vent_aseos', 'vent_profesores'] },
  { id: 'vent_profesores', x: 380, y: 800, connected: ['vent_aula101', 'vent_aula104'] },

  { id: 'vent_lab_norte', x: 1720, y: 240, connected: ['vent_escalera', 'vent_taller2'] },
  { id: 'vent_escalera', x: 1220, y: 520, connected: ['vent_lab_norte', 'vent_taller1'] },
  { id: 'vent_taller1', x: 1540, y: 820, connected: ['vent_escalera', 'vent_taller2'] },
  { id: 'vent_taller2', x: 1780, y: 820, connected: ['vent_lab_norte', 'vent_taller1'] }
];

// Tareas escolares y de mantenimiento en Suberri (RF-04)
const TASK_DEFINITIONS = [
  { id: 'wires_101', name: 'Reparar Cableado de Red', room: 'aula_101', x: 920, y: 200, type: 'wires', length: 'short' },
  { id: 'wires_profesores', name: 'Conectar Proyector', room: 'sala_reuniones', x: 420, y: 760, type: 'wires', length: 'short' },
  { id: 'wires_taller1', name: 'Revisar Cuadro Eléctrico', room: 'taller_1', x: 1560, y: 760, type: 'wires', length: 'short' },
  { id: 'wires_aseos', name: 'Sensor de Agua Automático', room: 'aseos', x: 940, y: 600, type: 'wires', length: 'short' },

  { id: 'download_profesores', name: 'Subir Calificaciones', room: 'sala_reuniones', x: 360, y: 920, type: 'download', length: 'long' },
  { id: 'download_lab', name: 'Descargar Software Técnico', room: 'laboratorio_norte', x: 1760, y: 220, type: 'download', length: 'long' },
  { id: 'download_despacho', name: 'Actas de Dirección', room: 'despacho_este', x: 1740, y: 580, type: 'download', length: 'long' },

  { id: 'calibrate_104', name: 'Calibrar Frecuencia WiFi', room: 'aula_104', x: 720, y: 780, type: 'calibrate', length: 'common' },
  { id: 'calibrate_106', name: 'Sincronizar Relojes Centrales', room: 'aula_106', x: 1280, y: 780, type: 'calibrate', length: 'common' },
  { id: 'calibrate_taller2', name: 'Osciloscopio Suberri', room: 'taller_2', x: 1800, y: 780, type: 'calibrate', length: 'common' }
];

// Estaciones de Sabotaje (Incendio, Ventilación, Luz, Puertas)
const SABOTAGE_STATIONS = {
  critical_o2: [
    { id: 'o2_panel_1', room: 'laboratorio_norte', x: 1740, y: 380, name: 'Válvula Gas Laboratorio' },
    { id: 'o2_panel_2', room: 'taller_1', x: 1540, y: 1020, name: 'Purga Taller 1' }
  ],
  lights: [
    { id: 'lights_panel', room: 'taller_2', x: 1820, y: 1040, name: 'Cuadro General Suberri' }
  ],
  doors: [
    { id: 'door_profesores', room: 'sala_reuniones' },
    { id: 'door_aula101', room: 'aula_101' },
    { id: 'door_lab_norte', room: 'laboratorio_norte' },
    { id: 'door_taller2', room: 'taller_2' }
  ],
  comms: [
    { id: 'comms_panel', room: 'despacho_oeste', x: 440, y: 520, name: 'Rack Central Servidores' }
  ]
};

module.exports = {
  MAP_WIDTH,
  MAP_HEIGHT,
  ROOMS,
  EMERGENCY_BUTTON,
  WALLS,
  VENTS,
  TASK_DEFINITIONS,
  SABOTAGE_STATIONS
};
