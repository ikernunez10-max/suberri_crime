// Map definitions, walls, rooms, vents, task locations for Suberri Complex

const MAP_WIDTH = 2000;
const MAP_HEIGHT = 1500;

// Rooms and bounding boxes
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

// Meeting emergency button position in Cafeteria
const EMERGENCY_BUTTON = { x: 1000, y: 300, radius: 45 };

// Walls (Line segments for collision and server raycasting FOV)
// [x1, y1, x2, y2]
const WALLS = [
  // Outer perimeter
  [50, 50, 1950, 50],
  [1950, 50, 1950, 1450],
  [1950, 1450, 50, 1450],
  [50, 1450, 50, 50],

  // Cafeteria walls with doorways
  [800, 150, 800, 450],
  [1200, 150, 1200, 450],
  [800, 150, 950, 150],
  [1050, 150, 1200, 150],
  [800, 450, 920, 450],
  [1080, 450, 1200, 450],

  // Medbay
  [500, 400, 500, 650],
  [750, 400, 750, 520],
  [750, 580, 750, 650],
  [500, 400, 750, 400],
  [500, 650, 750, 650],

  // Electrical
  [450, 700, 450, 950],
  [700, 700, 700, 800],
  [700, 880, 700, 950],
  [450, 700, 700, 700],
  [450, 950, 700, 950],

  // Reactor
  [100, 500, 350, 500],
  [100, 900, 350, 900],
  [100, 500, 100, 900],
  [350, 500, 350, 630],
  [350, 770, 350, 900],

  // Admin
  [950, 950, 1250, 950],
  [950, 1200, 1250, 1200],
  [950, 950, 950, 1020],
  [950, 1100, 950, 1200],
  [1250, 950, 1250, 1200],

  // Weapons & Nav
  [1350, 200, 1650, 200],
  [1650, 200, 1650, 450],
  [1350, 450, 1500, 450],
  [1500, 600, 1850, 600],
  [1850, 600, 1850, 900],
  [1500, 900, 1850, 900],
  [1500, 600, 1500, 700],
  [1500, 800, 1500, 900],

  // Shields & Storage
  [1350, 1050, 1650, 1050],
  [1350, 1300, 1650, 1300],
  [1650, 1050, 1650, 1300],
  [1350, 1050, 1350, 1150],
  [1350, 1220, 1350, 1300]
];

// Vents (Interconnected nodes for criminals RF-07)
const VENTS = [
  { id: 'vent_cafeteria', x: 1150, y: 180, connected: ['vent_admin', 'vent_hall_e'] },
  { id: 'vent_admin', x: 1200, y: 980, connected: ['vent_cafeteria', 'vent_hall_e'] },
  { id: 'vent_hall_e', x: 1400, y: 550, connected: ['vent_cafeteria', 'vent_admin'] },

  { id: 'vent_reactor_up', x: 150, y: 530, connected: ['vent_upper_engine'] },
  { id: 'vent_upper_engine', x: 480, y: 230, connected: ['vent_reactor_up'] },

  { id: 'vent_reactor_down', x: 150, y: 870, connected: ['vent_lower_engine'] },
  { id: 'vent_lower_engine', x: 480, y: 1100, connected: ['vent_reactor_down'] },

  { id: 'vent_electrical', x: 480, y: 730, connected: ['vent_medbay', 'vent_security'] },
  { id: 'vent_medbay', x: 530, y: 430, connected: ['vent_electrical', 'vent_security'] },
  { id: 'vent_security', x: 380, y: 580, connected: ['vent_electrical', 'vent_medbay'] },

  { id: 'vent_weapons', x: 1600, y: 230, connected: ['vent_nav'] },
  { id: 'vent_nav', x: 1800, y: 630, connected: ['vent_weapons', 'vent_shields'] },
  { id: 'vent_shields', x: 1600, y: 1250, connected: ['vent_nav'] }
];

// Tasks pool (Mini-games interactivos RF-04)
const TASK_DEFINITIONS = [
  { id: 'wires_electrical', name: 'Conectar Cables', room: 'electrical', x: 580, y: 720, type: 'wires', length: 'short' },
  { id: 'wires_storage', name: 'Conectar Cables', room: 'storage', x: 880, y: 900, type: 'wires', length: 'short' },
  { id: 'wires_cafeteria', name: 'Conectar Cables', room: 'cafeteria', x: 850, y: 200, type: 'wires', length: 'short' },
  { id: 'wires_admin', name: 'Conectar Cables', room: 'admin', x: 1020, y: 980, type: 'wires', length: 'short' },
  
  { id: 'download_weapons', name: 'Descargar Datos', room: 'weapons', x: 1500, y: 230, type: 'download', length: 'long' },
  { id: 'download_cafeteria', name: 'Descargar Datos', room: 'cafeteria', x: 1100, y: 200, type: 'download', length: 'long' },
  { id: 'download_nav', name: 'Descargar Datos', room: 'navigation', x: 1750, y: 750, type: 'download', length: 'long' },
  
  { id: 'calibrate_reactor', name: 'Calibrar Frecuencia', room: 'reactor', x: 180, y: 680, type: 'calibrate', length: 'common' },
  { id: 'calibrate_o2', name: 'Calibrar Frecuencia', room: 'o2', x: 1220, y: 720, type: 'calibrate', length: 'common' },
  { id: 'calibrate_shields', name: 'Calibrar Frecuencia', room: 'shields', x: 1480, y: 1150, type: 'calibrate', length: 'common' }
];

// Sabotage repair stations (RF-06)
const SABOTAGE_STATIONS = {
  critical_o2: [
    { id: 'o2_panel_1', room: 'o2', x: 1150, y: 680, name: 'Panel O2 #1' },
    { id: 'o2_panel_2', room: 'admin', x: 1120, y: 1120, name: 'Panel O2 #2' }
  ],
  lights: [
    { id: 'lights_panel', room: 'electrical', x: 650, y: 730, name: 'Interruptores de Luz' }
  ],
  doors: [
    { id: 'door_cafeteria', room: 'cafeteria' },
    { id: 'door_electrical', room: 'electrical' },
    { id: 'door_medbay', room: 'medbay' },
    { id: 'door_storage', room: 'storage' }
  ],
  comms: [
    { id: 'comms_panel', room: 'communications', x: 1180, y: 1300, name: 'Antena de Comunicaciones' }
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
