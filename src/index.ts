import 'dotenv/config';
import http from 'http';
import path from 'path';
import express from 'express';
import cors from 'cors';
import { getAllNodes, getAllEdges, getStats } from './db.js';
import { initWss, debugLog } from './ws-broadcast.js';
import { startMqtt, stopMqtt } from './mqtt-client.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const app = express();

app.use(cors());
app.use(express.json());

// --- REST API ---

app.get('/api/nodes', (_req, res) => {
  res.json(getAllNodes());
});

app.get('/api/edges', (_req, res) => {
  res.json(getAllEdges());
});

app.get('/api/stats', (_req, res) => {
  res.json(getStats());
});

app.get('/api/graph', (_req, res) => {
  res.json({ nodes: getAllNodes(), edges: getAllEdges(), stats: getStats() });
});

// Serve built frontend (production only — in dev, Vite serves the client)
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// --- Start servers ---

const server = http.createServer(app);
initWss(server);

server.listen(PORT, '0.0.0.0', () => {
  debugLog.info(`[server] listening on http://0.0.0.0:${PORT}`);
  debugLog.info(`[server] WebSocket endpoint: ws://0.0.0.0:${PORT}/ws`);
  debugLog.info(`[server] API: http://0.0.0.0:${PORT}/api/graph`);
});

const mqttClient = startMqtt();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[server] shutting down…');
  stopMqtt();
  mqttClient.end();
  server.close(() => process.exit(0));
});
