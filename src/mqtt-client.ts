import mqtt from 'mqtt';
import { processPacket } from './processor.js';
import { broadcastNode, broadcastEdge, broadcastStats, broadcastPacket, debugLog } from './ws-broadcast.js';
import { touchNode, MIN_EDGE_PACKETS } from './db.js';
import { hashFromKeyPrefix } from './hash-utils.js';

const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://mqtt.example.com:1883';
const MQTT_TOPIC = process.env.MQTT_TOPIC ?? 'meshcore/+/+/packets';

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
        debugLog.error(`[mqtt] subscribe error (${MQTT_TOPIC}): ${err.message}`);
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

    const parts = topic.split('/');
    const streamType = parts[parts.length - 1] ?? '';
    const observerKey = parts.length >= 2 ? parts[parts.length - 2] : undefined;

    const observerHash = observerKey ? hashFromKeyPrefix(observerKey) : null;
    if (observerHash) {
      const observerNode = touchNode(observerHash, Date.now());
      broadcastNode(observerNode);
    }

    let result = null;
    let duration: number | null = null;

    if (streamType === 'packets') {
      let envelope: Record<string, unknown>;
      try {
        envelope = JSON.parse(payload.toString('utf-8')) as Record<string, unknown>;
      } catch {
        debugLog.warn(`[mqtt] failed to parse JSON from ${topic}`);
        return;
      }

      const raw = envelope.raw;
      if (typeof raw !== 'string' || raw.length < 4) {
        debugLog.warn(`[mqtt] missing or invalid "raw" field in packet envelope`);
        return;
      }

      result = processPacket(raw, observerKey);
      const durationRaw = envelope.duration;
      duration = typeof durationRaw === 'string' ? Number(durationRaw) : (typeof durationRaw === 'number' ? durationRaw : null);
      if (duration !== null && !Number.isFinite(duration)) duration = null;
    } else {
      debugLog.info(`[mqtt] skipping unsupported stream: ${topic}`);
      return;
    }

    if (!result) return;

    for (const node of result.nodes) broadcastNode(node);
    for (const edge of result.edges) {
      if (edge.packet_count >= MIN_EDGE_PACKETS) broadcastEdge(edge);
    }
    broadcastPacket(result.packetType, result.hash, result.path.length, result.path, duration);
  });

  statsTimer = setInterval(() => {
    broadcastStats();
  }, 5000);

  return client;
}

export function stopMqtt(): void {
  if (statsTimer) clearInterval(statsTimer);
}
