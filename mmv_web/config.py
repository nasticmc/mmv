from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    mqtt_host: str = os.getenv("MMV_MQTT_HOST", "mqtt.eastmesh.au")
    mqtt_port: int = int(os.getenv("MMV_MQTT_PORT", "1883"))
    mqtt_topic: str = os.getenv("MMV_MQTT_TOPIC", "#")
    mqtt_client_id: str = os.getenv("MMV_MQTT_CLIENT_ID", "mmv-web")
    database_path: str = os.getenv("MMV_DATABASE_PATH", "mmv.sqlite3")


settings = Settings()
