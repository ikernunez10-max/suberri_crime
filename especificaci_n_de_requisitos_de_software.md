# Documento de Especificación de Requisitos del Sistema (SRS)
## Proyecto: Suberri Crime
**Versión:** 1.0.0  
**Estado:** Documento de Diseño Arquitectónico y Requisitos  
**Ámbito:** Multijugador Online (2 a 8 jugadores)  

---

## 1. Introducción

### 1.1 Propósito
El propósito de este documento es definir formalmente los requisitos técnicos, funcionales, de arquitectura, experiencia de usuario y de gestión de equipo para el desarrollo de **Suberri Crime**, un videojuego multijugador online de deducción social de 2 a 8 jugadores, inspirado en dinámicas estilo *Among Us* pero optimizado con mecánicas avanzadas, arquitectura cliente-servidor dedicada y herramientas integradas de supervisión.

### 1.2 Alcance del Sistema
* **Nombre del Juego:** *Suberri Crime*
* **Plataforma:** PC (Windows / Linux) y Web (WebGL) con capacidad *cross-platform*.
* **Capacidad de Sala:** 2 a 8 jugadores simultáneos.
* **Modelo de Red:** Cliente-Servidor Canónico (Server-Authoritative) para prevenir *cheating* e inyecciones de memoria.
* **Roles Principales:** 
  * **Inocente / Investigador** (Tripulación/Ciudadanos)
  * **Impostor / Criminal** (Saboteadores)
  * **Neutrales** (Opcional según modo de juego: Ej. Detective / Cómplice)

---

## 2. Definición del Equipo de Trabajo y Roles

Para garantizar una ejecución eficiente del ciclo de vida del software (SDLC), se estructuran los siguientes perfiles de trabajo:

```
                                    +-----------------------+
                                    |     Project Manager   |
                                    +-----------+-----------+
                                                |
        +-----------------------+---------------+---------------+-----------------------+
        |                       |                               |                       |
+-------v-------+       +-------v-------+               +-------v-------+       +-------v-------+
|  Game Design  |       | Red & Backend |               | Client & Game |       | QA, Testing & |
|  & Arte / UI  |       | Architecture  |               |  Engine Devs  |       | Documentation |
+---------------+       +---------------+               +---------------+       +---------------+
```

### 2.1 Equipo de Desarrollo (Development Team)
1. **Lead Game Designer:** Encargado del balance visual, diseño de niveles (maps), temporizadores, tareas y psicología de juego.
2. **Backend & Network Engineer:** Responsable de los sockets de red, sincronización de estados (tickrate), matchmaking y lógica de autoría en el servidor.
3. **Gameplay Developer (Client):** Encargado de la lógica en el motor (Unity/Unreal/Godot), control del jugador, niebla de guerra (*FOV/Line of Sight*) y UI local.
4. **UI/UX & Art Designer:** Creación de assets 2D/2D Isométrico, animaciones, HUD contextual y paneles de minijuegos/tareas.

### 2.2 Equipo de Quality Assurance (QA & Testing)
1. **QA Lead & Test Automation Engineer:** Diseño del plan de pruebas, tests de regresión y automatización de pruebas de red (bots simulación de latencia).
2. **Game Physics & Interaction Tester:** Validación de colisiones, *glitches* de mapa, exploits de visión y respuesta del loop de juego.
3. **Multiplayer & Load Tester:** Pruebas de carga del servidor, pérdidas de paquetes (packet loss), reconexiones y estrés de lobbies simultáneos.

### 2.3 Equipo de Documentación y Soporte (Tech Writing & Ops)
1. **Technical Writer:** Mantenimiento de la documentación de arquitectura, APIs del servidor y guías de compilación.
2. **DevOps & SysAdmin:** Despliegue de infraestructura de servidores dedicados, CI/CD pipelines y monitorización del servidor en tiempo real.

---

## 3. Análisis Profundo de Dinámica y Jugabilidad

### 3.1 Loop Principal de Juego (Core Gameplay Loop)

```
[ Lobby / Preparación ] 
       │
       ▼
[ Asignación de Roles Ocultos ] ──► (Inocente vs Criminal)
       │
       ├─────────────────────────────────────────┐
       ▼                                         ▼
[ Fase de Acción Libre ]                 [ Fase de Sabotaje / Asesinato ]
  • Ejecución de tareas (Inocentes)        • Asesinatos sigilosos (Cooldown)
  • Monitoreo (Cámaras/Mapas)              • Sabotajes críticos (Oxígeno, Luz, etc.)
  • Reporte de Cadáveres / Botón           • Uso de escotillas/conductos
       │                                         │
       └────────────────────┬────────────────────┘
                            │
                            ▼
               [ Fase de Discusión y Votación ]
                 • Chat de voz / texto por proximidad o sala
                 • Argumentación y acusaciones
                 • Votación de expulsión (o Saltarse Voto)
                            │
                            ▼
               [ Resolución de Votación ]
                 • Revelación de Rol (Configurable)
                 • Verificación de Condiciones de Victoria
                            │
           ┌────────────────┴────────────────┐
           ▼                                 ▼
   [ Continuar Juego ]               [ Fin de Partida ]
```

### 3.2 Condiciones de Victoria
* **Victoria de los Inocentes:**
  1. Completar el 100% de la barra global de tareas de la sala.
  2. Identificar y expulsar mediante votación a todos los Criminales.
* **Victoria de los Criminales:**
  1. Reducir la cantidad de Inocentes hasta igualar el número de Criminales vivos (Ej. 1vs1, 2vs2).
  2. Provocar la detonación/fallo de un **Sabotaje Crítico** sin que los Inocentes lo reparen a tiempo (ej. Fuga de Gas o Destrucción de Red).

---

## 4. Requisitos Funcionales (RF)

### 4.1 Sistema de Gestor de Salas y Matchmaking (Lobby System)
* **RF-01 (Creación de Sala):** El anfitrión (Host) podrá crear salas públicas o privadas protegidas por un código de 6 caracteres alfanuméricos.
* **RF-02 (Configuración de Sala):** El Host podrá modificar los siguientes parámetros antes de iniciar:
  * Número de jugadores (2 a 8).
  * Número de Criminales (1 o 2).
  * Velocidad de movimiento ($1.0x$ a $3.0x$).
  * Visión de los Inocentes vs Visión de los Criminales ($0.25x$ a $5.0x$).
  * Cooldown de Asesinato (10s a 60s).
  * Distancia de Asesinato (Corta, Media, Larga).
  * Tiempo de Discusión y Tiempo de Votación.
  * Cantidad de Tareas (Cortas, Comunes, Largas).
  * Expulsión anónima (On/Off).
  * Indicadores visuales de tareas (On/Off).

### 4.2 Mecánicas del Juego en Vivo
* **RF-03 (Campo de Visión Dinámico - Niebla de Guerra):** El servidor evaluará mediante *raycasting* la línea de visión (*Line of Sight - LOS*) del jugador. Los elementos detrás de paredes o fuera del cono de visión no serán transmitidos al cliente para evitar *wallhacks*.
* **RF-04 (Sistema de Tareas):**
  * Mini-juegos interactivos en 2D (ej. unir cables, descargar archivos, calibrar frecuencias).
  * La barra de progreso global debe actualizarse sincrónicamente cuando un Inocente termina su tarea.
  * Los Criminales dispondrán de una lista de "Tareas Falsas" para simular su ejecución.
* **RF-05 (Mecánica de Asesinato):**
  * El botón "Asesinar" estará activo únicamente para los Criminales cuando estén dentro del rango permitido respecto a un Inocente y el *cooldown* sea igual a 0.
  * Tras el asesinato, se generará un cuerpo inerte interactivo en la posición del impacto.
* **RF-06 (Sistema de Sabotaje):**
  * Los Criminales tendrán un mapa de sabotajes con *cooldowns* independientes.
  * **Sabotajes Críticos (Temporizados):** Requieren la acción de dos personas o resolución interactiva antes de terminar el tiempo (ej. 30 segundos) o la partida acaba instantáneamente.
  * **Sabotajes Secundarios:**
    * Corte de luz (reduce la visión de los Inocentes al mínimo).
    * Bloqueo de puertas (aísla salas durante 10 segundos).
    * Desactivación de cámaras/comunicaciones (oculta mapas de posición y lista de tareas).
* **RF-07 (Conductos de Ventilación / Escotillas):**
  * Exclusivo para Criminales. Permite la teleportación entre nodos interconectados del mapa.
  * El jugador mantendrá un estado "Oculto" mientras esté dentro de la red de ventilación.
* **RF-08 (Fase de Reunión y Votación):**
  * Se activa automáticamente al interactuar con un cadáver ("Reportar") o pulsar el "Botón de Emergencia".
  * Congela el movimiento de todos los personajes y los transporta a la mesa de reuniones.
  * Interfaz con indicadores visuales de quién está vivo, muerto o desconectado.
  * Chat contextual (desactivado para los muertos con respecto a los vivos).

---

## 5. Requisitos No Funcionales (RNF)

### 5.1 Rendimiento y Red
* **RNF-01 (Tickrate del Servidor):** El servidor operará a un *tickrate* mínimo de 30 Hz (actualizaciones por segundo) para garantizar un movimiento fluido y una detección de colisiones precisa.
* **RNF-02 (Latencia / Ping):** El cliente debe compensar la latencia (Lag Compensation / Client-side Prediction) hasta un límite de $150\text{ ms}$.
* **RNF-03 (Capacidad de Servidores):** Cada instancia de servidor debe soportar un mínimo de 100 salas concurrentes (800 jugadores simultáneos por nodo).

### 5.2 Seguridad y Anti-Cheat
* **RNF-04 (Server Authority):** Todas las validaciones de posición, tiempos de habilidad, velocidad de desplazamiento y estado de vida/muerte son calculadas **exclusivamente** por el servidor.
* **RNF-05 (Cifrado de Comunicaciones):** Tráfico de red mediante protocolo seguro sobre WebSocket (WSS) o UDP cifrado (DTLS / WebRTC Data Channels).

### 5.3 Usabilidad e Interfaz
* **RNF-06 (Accesibilidad Visual):** Minitareas y elementos clave con código de colores amigable para personas con daltonismo (símbolos + colores).
* **RNF-07 (Escalabilidad de UI):** Soporte de resoluciones desde 720p hasta 4K con reescalado dinámico.

---

## 6. Arquitectura del Sistema y Tecnologías

```
[ Cliente de Juego ] <--- WebSockets / WebRTC ---> [ Gateway / Server Lobby ]
 (Unity/Godot C#)                                           │
                                                            ▼
                                                [ Dedicated Game Node ]
                                                 (Node.js / Go / C++)
                                                            │
                                                            ▼
                                                [ In-Memory DB: Redis ]
```

* **Motor Gráfico (Client Engine):** Unity o Godot Engine.
* **Backend de Red (Game Server):** C# (Mirror / Photon / Netcode) o Node.js/Go con transporte UDP/WebSockets custom.
* **Base de Datos Temporal:** Redis para la gestión del estado de lobbies en tiempo real y emparejamiento.

---

## 7. Plan de Testing y Aseguramiento de Calidad (QA)

### 7.1 Tipos de Pruebas a Ejecutar

| Tipo de Prueba | Descripción | Herramienta / Método |
| :--- | :--- | :--- |
| **Pruebas Unitarias** | Validación de lógica pura (ej. cálculo de cooldowns, validación de votos). | NUnit / Go Test |
| **Pruebas de Red y Estrés** | Simulación de 500+ bots conectándose e interactuando simultáneamente. | Locust / Headless Clients |
| **Pruebas de Niebla de Visión** | Verificación de leak de paquetes de red sobre entidades fuera del cono visual. | Wireshark / Packet Sniffer |
| **Pruebas de Usabilidad y BUGS** | Evaluación de mecánicas de tareas y colisiones en mapas complex. | Plan de Pruebas Manual / Test Cases |

### 7.2 Casos de Prueba Críticos (Ejemplos de Matriz QA)

1. **CP-NET-01:** Validar que un usuario modificando la memoria local (Cheat Engine) no pueda alterar su velocidad de movimiento real en el servidor.
2. **CP-GAME-02:** Verificar que dos jugadores que intentan reportar un cuerpo al mismo milisegundo no bloqueen el estado de la máquina de estados del servidor (Race Condition).
3. **CP-VIS-03:** Garantizar que un Inocente no pueda escuchar el sonido del ducto si no está en el rango de audio o visión.

---

## 8. Estrategia de Documentación Técnica y Mantenimiento

1. **Documentación del Código (API Interna):** Uso de Doxygen o DocFX para generar el manual de clases y eventos del sistema.
2. **Manual de Infraestructura:** Guía en formato Markdown sobre cómo desplegar contenedores Docker del servidor dedicado en clústeres de Kubernetes (K8s).
3. **Guía de Modding y Mapas:** Documento técnico para el diseñador de niveles indicando cómo integrar los triggers de tareas, nodos de ventila y mallas de navegación (NavMesh).

---
*Fin de la Especificación de Requisitos del Sistema para Suberri Crime.*