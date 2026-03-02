from mmv_web.config import load_settings


def test_loads_values_from_toml(tmp_path, monkeypatch):
    config_path = tmp_path / "mmv.toml"
    config_path.write_text(
        """
[mmv]
mqtt_host = "example.org"
mqtt_port = 2883
mqtt_topic = "mesh/#"
mqtt_client_id = "client-from-file"
mqtt_username = "alice"
mqtt_password = "secret"
database_path = "data.sqlite3"
""".strip()
    )
    monkeypatch.setenv("MMV_CONFIG_FILE", str(config_path))

    settings = load_settings()

    assert settings.mqtt_host == "example.org"
    assert settings.mqtt_port == 2883
    assert settings.mqtt_username == "alice"
    assert settings.mqtt_password == "secret"
    assert settings.database_path == "data.sqlite3"


def test_env_overrides_toml(tmp_path, monkeypatch):
    config_path = tmp_path / "mmv.toml"
    config_path.write_text('[mmv]\nmqtt_username = "from-file"\n')
    monkeypatch.setenv("MMV_CONFIG_FILE", str(config_path))
    monkeypatch.setenv("MMV_MQTT_USERNAME", "from-env")

    settings = load_settings()

    assert settings.mqtt_username == "from-env"
