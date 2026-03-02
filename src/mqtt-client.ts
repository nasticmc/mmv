import mqtt from 'mqtt';
import { extractHex, processPacket } from './processor.js';
import { broadcastNode, broadcastEdge, broadcastStats, broadcastPacket } from './ws-broadcast.js';

const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://mqtt.eastmesh.au:1883';
const MQTT_TOPIC = 'meshcore/+/+/packets';

// Rolling packet counter for stats broadcasts
let packetCount = 0;
let statsTimer: ReturnType<typeof setInterval> | null = null;

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
    console.log(`[mqtt] connected to ${MQTT_URL}`);
    client.subscribe(MQTT_TOPIC, (err) => {
      if (err) {
        console.error('[mqtt] subscribe error:', err.message);
      } else {
        console.log(`[mqtt] subscribed to ${MQTT_TOPIC}`);
      }
    });
  });

  client.on('reconnect', () => console.log('[mqtt] reconnecting…'));
  client.on('offline', () => console.warn('[mqtt] offline'));
  client.on('error', (err) => console.error('[mqtt] error:', err.message));

  client.on('message', (topic, payload) => {
    // Extract observer's public key from topic: meshcore/{IATA}/{PUBKEY}/packets
    const parts = topic.split('/');
    const observerKey = parts[2] ?? undefined;

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
