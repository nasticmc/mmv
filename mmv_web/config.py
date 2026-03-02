from __future__ import annotations

from dataclasses import dataclass
import os
import tomllib
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Settings:
    mqtt_host: str = "mqtt.eastmesh.au"
    mqtt_port: int = 1883
    mqtt_topic: str = "#"
    mqtt_client_id: str = "mmv-web"
    mqtt_username: str | None = None
    mqtt_password: str | None = None
    database_path: str = "mmv.sqlite3"



def _load_toml_settings(path: str) -> dict[str, Any]:
    config_path = Path(path)
    if not config_path.exists():
        return {}

    with config_path.open("rb") as f:
        data = tomllib.load(f)

    return data.get("mmv", {}) if isinstance(data, dict) else {}



def load_settings() -> Settings:
    config_file = os.getenv("MMV_CONFIG_FILE", "mmv.toml")
    file_values = _load_toml_settings(config_file)

    return Settings(
        mqtt_host=os.getenv("MMV_MQTT_HOST", str(file_values.get("mqtt_host", "mqtt.eastmesh.au"))),
        mqtt_port=int(os.getenv("MMV_MQTT_PORT", str(file_values.get("mqtt_port", 1883)))),
        mqtt_topic=os.getenv("MMV_MQTT_TOPIC", str(file_values.get("mqtt_topic", "#"))),
        mqtt_client_id=os.getenv("MMV_MQTT_CLIENT_ID", str(file_values.get("mqtt_client_id", "mmv-web"))),
        mqtt_username=os.getenv("MMV_MQTT_USERNAME", file_values.get("mqtt_username")),
        mqtt_password=os.getenv("MMV_MQTT_PASSWORD", file_values.get("mqtt_password")),
        database_path=os.getenv("MMV_DATABASE_PATH", str(file_values.get("database_path", "mmv.sqlite3"))),
    )


settings = load_settings()
