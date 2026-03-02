from mmv_web.db import Database


def test_graph_data_contains_advert_and_edge(tmp_path):
    db = Database(str(tmp_path / "test.sqlite3"))
    packet_id = db.insert_packet("a", "b", "test", "{}")
    db.insert_path(packet_id, ["node-a", "node-b"])
    db.insert_advert("node-a", "Alpha", packet_id)

    graph = db.graph_data()

    nodes = {n["id"]: n for n in graph["nodes"]}
    assert "node-a" in nodes
    assert nodes["node-a"]["name"] == "Alpha"
    assert graph["edges"][0]["from"] == "node-a"
    assert graph["edges"][0]["to"] == "node-b"
