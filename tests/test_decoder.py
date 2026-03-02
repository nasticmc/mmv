from mmv_web.decoder import MeshPacketDecoder


def test_decoder_json_fallback():
    decoder = MeshPacketDecoder()

    payload = b'{"source":"n1","destination":"n3","path":["n1","n2","n3"],"advert":{"node_id":"n1","name":"Alice"},"location":{"lat":-34.0,"lon":151.0}}'
    decoded = decoder.decode(payload)

    assert decoded.source_id == "n1"
    assert decoded.destination_id == "n3"
    assert decoded.path == ["n1", "n2", "n3"]
    assert decoded.advert_name == "Alice"
    assert decoded.latitude == -34.0
