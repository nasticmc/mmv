from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Iterable


SCHEMA = """
CREATE TABLE IF NOT EXISTS packets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source_id TEXT,
    destination_id TEXT,
    packet_type TEXT,
    raw_payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS packet_paths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    packet_id INTEGER NOT NULL,
    hop_index INTEGER NOT NULL,
    node_id TEXT NOT NULL,
    FOREIGN KEY(packet_id) REFERENCES packets(id)
);

CREATE TABLE IF NOT EXISTS adverts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL,
    display_name TEXT,
    seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source_packet_id INTEGER,
    FOREIGN KEY(source_packet_id) REFERENCES packets(id)
);

CREATE TABLE IF NOT EXISTS node_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    source TEXT,
    observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_node_id TEXT NOT NULL,
    to_node_id TEXT NOT NULL,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    observations INTEGER NOT NULL DEFAULT 1,
    UNIQUE(from_node_id, to_node_id)
);
"""


class Database:
    def __init__(self, path: str):
        self.path = path
        self.initialize()

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def initialize(self):
        with self.connection() as conn:
            conn.executescript(SCHEMA)

    def insert_packet(self, source_id: str | None, destination_id: str | None, packet_type: str | None, raw_payload: str) -> int:
        with self.connection() as conn:
            cur = conn.execute(
                "INSERT INTO packets(source_id, destination_id, packet_type, raw_payload) VALUES(?, ?, ?, ?)",
                (source_id, destination_id, packet_type, raw_payload),
            )
            return int(cur.lastrowid)

    def insert_path(self, packet_id: int, path_nodes: Iterable[str]):
        nodes = list(path_nodes)
        with self.connection() as conn:
            conn.executemany(
                "INSERT INTO packet_paths(packet_id, hop_index, node_id) VALUES(?, ?, ?)",
                [(packet_id, i, node) for i, node in enumerate(nodes)],
            )
            for a, b in zip(nodes, nodes[1:]):
                conn.execute(
                    """
                    INSERT INTO edges(from_node_id, to_node_id)
                    VALUES(?, ?)
                    ON CONFLICT(from_node_id, to_node_id)
                    DO UPDATE SET
                        last_seen_at = CURRENT_TIMESTAMP,
                        observations = observations + 1
                    """,
                    (a, b),
                )

    def insert_advert(self, node_id: str, display_name: str | None, source_packet_id: int | None):
        with self.connection() as conn:
            conn.execute(
                "INSERT INTO adverts(node_id, display_name, source_packet_id) VALUES(?, ?, ?)",
                (node_id, display_name, source_packet_id),
            )

    def insert_location(self, node_id: str, latitude: float | None, longitude: float | None, source: str | None):
        with self.connection() as conn:
            conn.execute(
                "INSERT INTO node_locations(node_id, latitude, longitude, source) VALUES(?, ?, ?, ?)",
                (node_id, latitude, longitude, source),
            )

    def graph_data(self) -> dict:
        with self.connection() as conn:
            node_rows = conn.execute(
                """
                SELECT e.from_node_id AS node_id FROM edges e
                UNION
                SELECT e.to_node_id AS node_id FROM edges e
                UNION
                SELECT a.node_id AS node_id FROM adverts a
                """
            ).fetchall()
            name_rows = conn.execute(
                """
                SELECT node_id, display_name
                FROM adverts
                WHERE display_name IS NOT NULL
                ORDER BY seen_at DESC
                """
            ).fetchall()
            names = {}
            for row in name_rows:
                names.setdefault(row["node_id"], row["display_name"])
            edge_rows = conn.execute(
                "SELECT from_node_id, to_node_id, observations, last_seen_at FROM edges"
            ).fetchall()

        nodes = [
            {"id": r["node_id"], "name": names.get(r["node_id"])}
            for r in node_rows
        ]
        edges = [
            {
                "from": r["from_node_id"],
                "to": r["to_node_id"],
                "weight": r["observations"],
                "last_seen_at": r["last_seen_at"],
            }
            for r in edge_rows
        ]
        return {"nodes": nodes, "edges": edges}
