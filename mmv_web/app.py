from __future__ import annotations

import logging

from flask import Flask, jsonify, render_template

from .config import settings
from .db import Database
from .mqtt_listener import MQTTIngestor


logging.basicConfig(level=logging.INFO)


def create_app() -> Flask:
    app = Flask(__name__)
    database = Database(settings.database_path)
    ingestor = MQTTIngestor(settings, database)

    @app.get("/")
    def index():
        return render_template("index.html", mqtt_host=settings.mqtt_host, mqtt_topic=settings.mqtt_topic)

    @app.get("/api/graph")
    def graph_data():
        return jsonify(database.graph_data())

    @app.get("/health")
    def health():
        return {"status": "ok"}

    try:
        ingestor.connect()
        ingestor.loop_start()
    except Exception:  # noqa: BLE001
        logging.exception("Unable to connect to MQTT broker at startup; API will still run.")

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
