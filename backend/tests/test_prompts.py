from app.prompts import build_extract_messages, build_judge_messages


def test_extract_messages_shape():
    msgs = build_extract_messages("Elara walked the Salt Road.")
    assert [m["role"] for m in msgs] == ["system", "user"]
    assert "Elara walked the Salt Road." in msgs[1]["content"]
    # The #1 fix must be present in the system prompt.
    assert "RANK" in msgs[0]["content"]


def test_judge_messages_embed_items():
    items = [{"itemIndex": 0, "kind": "fact", "statement": "Voss is a sergeant.", "canon": []}]
    msgs = build_judge_messages(items)
    assert [m["role"] for m in msgs] == ["system", "user"]
    assert "Voss is a sergeant." in msgs[1]["content"]
    # Judge must be told about entailment, not just direct opposites.
    assert "ENTAILMENT" in msgs[0]["content"]
