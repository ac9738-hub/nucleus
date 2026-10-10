from canvas_parser.parse.lambda_runtime import merge_graph_fragments


def test_merge_graph_fragments_preserves_course_metadata_from_all_fragments():
    first = {
        "learningBlocks": {"course-1": [{"blockId": "block-1", "order": 1}]},
        "moduleOrderHints": {"course-1": {"file-1": {"moduleId": "m1", "position": 1}}},
        "courseModules": {"course-1": {"m1": {"moduleId": "m1", "name": "Week 1"}}},
        "external_platforms": {"course-1": {"gradescope": {"assignments": ["ps1"]}}},
    }
    second = {
        "learningBlocks": {"course-1": [{"blockId": "block-2", "order": 2}]},
        "moduleOrderHints": {"course-1": {"file-2": {"moduleId": "m2", "position": 2}}},
        "courseModules": {"course-1": {"m2": {"moduleId": "m2", "name": "Week 2"}}},
        "external_platforms": {"course-1": {"gradescope": {"assignments": ["ps2"]}}},
    }

    merged = merge_graph_fragments([first, second])

    assert [block["blockId"] for block in merged["learningBlocks"]["course-1"]] == [
        "block-1",
        "block-2",
    ]
    assert set(merged["moduleOrderHints"]["course-1"]) == {"file-1", "file-2"}
    assert set(merged["courseModules"]["course-1"]) == {"m1", "m2"}
    assert merged["external_platforms"]["course-1"]["gradescope"]["assignments"] == [
        "ps1",
        "ps2",
    ]
