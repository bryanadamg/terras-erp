"""Kartu Kerja (print_card) and bag labels (print_label) are separate grants."""


def test_card_and_label_print_are_separate_grants(user_factory, client):
    _, labeller = user_factory(["work_order.print_label"], "labeller")
    _, carder = user_factory(["work_order.print_card"], "carder")
    url = "/api/work-orders/mark-printed-bulk"
    assert client.post(url, json={"ids": [], "kind": "labels"}, headers=labeller).status_code == 200
    assert client.post(url, json={"ids": [], "kind": "card"}, headers=labeller).status_code == 403
    assert client.post(url, json={"ids": [], "kind": "card"}, headers=carder).status_code == 200
    assert client.post(url, json={"ids": [], "kind": "labels"}, headers=carder).status_code == 403
