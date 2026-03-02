import mqtt from 'mqtt';
import { extractHex, processPacket } from './processor.js';
import { broadcastNode, broadcastEdge, broadcastStats, broadcastPacket, debugLog } from './ws-broadcast.js';
import { touchNode } from './db.js';
import { hashFromKeyPrefix } from './hash-utils.js';

const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://mqtt.eastmesh.au:1883';
const MQTT_TOPIC = 'meshcore/#';

// Rolling packet counter for stats broadcasts
let packetCount = 0;
let statsTimer: ReturnType<typeof setInterval> | null = null;


function prepopulateObserverNodes(): void {
  const configured = (process.env.MQTT_OBSERVERS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  if (configured.length === 0) return;

  const now = Date.now();
  for (const key of configured) {
    const hash = hashFromKeyPrefix(key);
    if (!hash) {
      debugLog.warn(`[mqtt] skipping invalid observer key in MQTT_OBSERVERS: ${key}`);
      continue;
    }
    const node = touchNode(hash, now);
    broadcastNode(node);
  }

  debugLog.info(`[mqtt] pre-populated ${configured.length} observer node(s) from MQTT_OBSERVERS`);
}

export function startMqtt(): mqtt.MqttClient {
  const options: mqtt.IClientOptions = {
    clientId: process.env.MQTT_CLIENT_ID ?? `mmv-${Math.random().toString(16).slice(2, 8)}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  };

  if (process.env.MQTT_USERNAME) options.username = process.env.MQTT_USERNAME;
  if (process.env.MQTT_PASSWORD) options.password = process.env.MQTT_PASSWORD;

  const client = mqtt.connect(MQTT_URL, options);

  client.on('connect', () => {
    debugLog.info(`[mqtt] connected to ${MQTT_URL}`);
    prepopulateObserverNodes();
    client.subscribe(MQTT_TOPIC, (err) => {
      if (err) {
        debugLog.error(`[mqtt] subscribe error: ${err.message}`);
      } else {
        debugLog.info(`[mqtt] subscribed to ${MQTT_TOPIC}`);
      }
    });
  });

  client.on('reconnect', () => debugLog.info('[mqtt] reconnecting…'));
  client.on('offline', () => debugLog.warn('[mqtt] offline'));
  client.on('error', (err) => debugLog.error(`[mqtt] error: ${err.message}`));

  client.on('message', (topic, payload) => {
    debugLog.info(`[mqtt] message on ${topic} (${payload.length} bytes)`);
    // Extract observer's public key from topic: meshcore/{IATA}/{PUBKEY}/packets
    const parts = topic.split('/');
    const observerKey = parts[2] ?? undefined;

    const observerHash = observerKey ? hashFromKeyPrefix(observerKey) : null;
    if (observerHash) {
      const observerNode = touchNode(observerHash, Date.now());
      broadcastNode(observerNode);
    }

    const hex = extractHex(payload);
    if (!hex) return;

    const result = processPacket(hex, observerKey);
    if (!result) return;

    packetCount++;

    // Broadcast topology updates
    for (const node of result.nodes) broadcastNode(node);
    for (const edge of result.edges) broadcastEdge(edge);
    broadcastPacket(result.packetType, result.hash, result.edges.length);
  });

  // Broadcast stats every 5 seconds
  statsTimer = setInterval(() => {
    broadcastStats();
  }, 5000);

  return client;
}

export function stopMqtt(): void {
  if (statsTimer) clearInterval(statsTimer);
}
