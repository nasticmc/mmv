from mmv_web.config import Settings
from mmv_web.db import Database
from mmv_web.mqtt_listener import MQTTIngestor


class FakeClient:
    def __init__(self, *args, **kwargs):
        self.username = None
        self.password = None
        self.on_connect = None
        self.on_message = None

    def username_pw_set(self, username, password=None):
        self.username = username
        self.password = password


def test_listener_sets_mqtt_auth(tmp_path, monkeypatch):
    import mmv_web.mqtt_listener as mqtt_listener

    monkeypatch.setattr(mqtt_listener.mqtt, "Client", FakeClient)
    settings = Settings(mqtt_username="user1", mqtt_password="pass1", database_path=str(tmp_path / "db.sqlite3"))
    db = Database(settings.database_path)

    ingestor = MQTTIngestor(settings, db)

    assert ingestor.client.username == "user1"
    assert ingestor.client.password == "pass1"
