from __future__ import annotations

import json
import logging

from paho.mqtt import client as mqtt

from .config import Settings
from .db import Database
from .decoder import MeshPacketDecoder


logger = logging.getLogger(__name__)


class MQTTIngestor:
    def __init__(self, settings: Settings, database: Database):
        self.settings = settings
        self.database = database
        self.decoder = MeshPacketDecoder()
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=settings.mqtt_client_id)
        if settings.mqtt_username:
            self.client.username_pw_set(settings.mqtt_username, settings.mqtt_password)
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message

    def connect(self):
        self.client.connect(self.settings.mqtt_host, self.settings.mqtt_port, 60)

    def loop_start(self):
        self.client.loop_start()

    def on_connect(self, client, userdata, flags, reason_code, properties):
        logger.info("Connected to MQTT broker %s:%s rc=%s", self.settings.mqtt_host, self.settings.mqtt_port, reason_code)
        client.subscribe(self.settings.mqtt_topic)

    def on_message(self, client, userdata, msg):
        try:
            decoded = self.decoder.decode(msg.payload)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to decode message on topic %s", msg.topic)
            return

        packet_id = self.database.insert_packet(
            source_id=decoded.source_id,
            destination_id=decoded.destination_id,
            packet_type=decoded.packet_type,
            raw_payload=msg.payload.decode("utf-8", errors="replace"),
        )

        if decoded.path:
            self.database.insert_path(packet_id, decoded.path)

        advert_node_id = decoded.advert_node_id or decoded.source_id
        if advert_node_id and decoded.advert_name:
            self.database.insert_advert(advert_node_id, decoded.advert_name, packet_id)

        if advert_node_id and (decoded.latitude is not None or decoded.longitude is not None):
            self.database.insert_location(advert_node_id, decoded.latitude, decoded.longitude, source="mqtt-packet")

        logger.debug("Stored packet: %s", json.dumps(decoded.__dict__))
