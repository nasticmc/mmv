from __future__ import annotations

import json
from dataclasses import dataclass


@dataclass
class DecodedPacket:
    source_id: str | None
    destination_id: str | None
    packet_type: str | None
    path: list[str]
    advert_name: str | None
    advert_node_id: str | None
    latitude: float | None
    longitude: float | None


class MeshPacketDecoder:
    def __init__(self):
        self._meshcore_decoder = self._load_meshcore_decoder()

    @staticmethod
    def _load_meshcore_decoder():
        try:
            import meshcore_decoder  # type: ignore
            return meshcore_decoder
        except ImportError:
            return None

    def decode(self, payload: bytes) -> DecodedPacket:
        if self._meshcore_decoder is not None:
            decoded = self._meshcore_decoder.decode(payload)
        else:
            decoded = json.loads(payload.decode("utf-8"))

        path = decoded.get("path") or decoded.get("route") or []
        if not isinstance(path, list):
            path = []

        advert = decoded.get("advert") or {}
        location = decoded.get("location") or {}

        return DecodedPacket(
            source_id=decoded.get("source") or decoded.get("from"),
            destination_id=decoded.get("destination") or decoded.get("to"),
            packet_type=decoded.get("type"),
            path=[str(n) for n in path],
            advert_name=advert.get("name") or decoded.get("name"),
            advert_node_id=advert.get("node_id") or decoded.get("node_id"),
            latitude=location.get("lat") if isinstance(location, dict) else None,
            longitude=location.get("lon") if isinstance(location, dict) else None,
        )
