# Suberri Crime - Manual de Arquitectura, Despliegue y Operaciones
**Versión:** 1.0.0  
**Basado en:** Documento de Especificación de Requisitos del Sistema (SRS)

---

## 1. Arquitectura del Sistema

El juego está diseñado con una arquitectura **Cliente-Servidor Canónica (Server-Authoritative)** que elimina trampas de memoria (*speedhacks*, *wallhacks*, o teletransportaciones no autorizadas).

```
[ Cliente HTML5 / WebGL / Canvas 2D ] 
         │  (WSS / WebSocket JSON Protocol)
         ▼
[ Game Server Dedicado (Node.js Tickrate 30Hz) ]
   ├── Loop Central de Simulación (33.3ms)
   ├── Módulo de Raycasting (Niebla de guerra & LOS en Servidor)
   ├── Motor de Físicas y Resolución de Colisiones
   ├── Gestor de Salas (Lobbies Públicos y Privados de 6 caracteres)
   ├── Máquina de Estados (Lobby -> Playing -> Discussion -> Voting -> Ended)
   └── Sistema de Sabotajes (Críticos con temporizador, Luces, Puertas, Comms)
```

### 1.1 Prevención de Trampas (Anti-Cheat Server-Side)
- **RF-03 (Anti-Wallhack):** El servidor calcula qué jugadores son visibles mediante *raycasting* contra los segmentos del mapa antes de emitir el paquete `GAME_TICK`. Si un inocente está detrás de una pared o fuera de su radio de visión, el servidor **nunca** envía sus coordenadas a clientes ajenos.
- **RNF-04 (Server Authority):** Los clientes solo envían vectores de intención `inputs: { up, down, left, right }`. El cálculo de velocidad multiplicada por delta de tiempo ($dt$) y la colisión contra paredes se procesan de forma estricta en el servidor.
- **CP-GAME-02 (Anti-Race Conditions):** Si dos jugadores reportan un cadáver en el mismo milisegundo, un cerrojo lógico marca la propiedad `reported = true` de forma atómica en el primer evento recibido, descartando colisiones subsecuentes de estado.

---

## 2. Instrucciones de Ejecución Local

### Prerrequisitos
- Node.js versión 18+ (instalado).
- Navegador moderno compatible con WebSockets y HTML5 Canvas (Chrome, Firefox, Edge, Safari).

### Pasos para Arrancar
1. En la raíz del proyecto, instalar dependencias:
   ```bash
   npm install
   ```
2. Ejecutar la suite de pruebas unitarias y de integración de requisitos:
   ```bash
   npm test
   ```
3. Iniciar el servidor de juego dedicado:
   ```bash
   npm start
   ```
4. Abrir en el navegador:
   `http://localhost:3000`

---

## 3. Despliegue con Docker y Contenedores

Se provee un archivo `Dockerfile` optimizado en la raíz para despliegues en contenedores e integración en clústeres de Kubernetes (K8s) o servicios PaaS:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

Comandos para construir y ejecutar la imagen:
```bash
docker build -t suberri-crime:latest .
docker run -d -p 3000:3000 --name suberri-game-node suberri-crime:latest
```

---

## 4. Guía de Controles del Juego

| Acción | Teclado / Control | Descripción |
| :--- | :--- | :--- |
| **Moverse** | `W, A, S, D` o `Flechas` | Desplaza al tripulante por la nave. |
| **Usar / Tarea** | Tecla `E` o Botón USAR | Abre minijuegos de tareas, paneles de sabotaje o botón de emergencia. |
| **Matar** | Tecla `Q` o Botón MATAR | Exclusivo para Criminales en rango y sin cooldown. |
| **Ventilación** | Tecla `ESPACIO` o Botón VENT | Permite a los criminales ocultarse o saltar entre conductos. |
| **Reportar** | Tecla `R` o Botón REPORTAR | Convoca a reunión inmediata al estar cerca de un cadáver. |
| **Sabotaje** | Botón SABOTAJE | Abre el mapa de sabotajes tácticos para criminales. |
