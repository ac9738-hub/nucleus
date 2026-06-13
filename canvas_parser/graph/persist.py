from .upgrade import GRAPH_VERSION, upgrade_graph_state


def build_graph_state(
    concepts,
    problem_nodes,
    event_nodes,
    syllabi,
    files,
    edges,
    learning_blocks,
    module_order_hints,
    external_platforms,
    logged_details,
    logged_examples,
    logged_problems,
    logged_assignments,
    logged_events,
    looking_for_files,
    looking_for_in_canvas,
    url_to_node,
    assignment_resource_nodes,
    external_resources,
    external_crawl_state,
    completed_model_calls,
    parsed_items,
):
    return upgrade_graph_state({
        'graph_version': GRAPH_VERSION,
        'concepts': concepts,
        'problems': problem_nodes,
        'events': event_nodes,
        'syllabi': syllabi,
        'files': files,
        'edges': edges,
        'learningBlocks': learning_blocks,
        'moduleOrderHints': module_order_hints,
        'external_platforms': external_platforms,
        'logged_details': logged_details,
        'logged_examples': logged_examples,
        'logged_problems': logged_problems,
        'logged_assignments': logged_assignments,
        'logged_events': logged_events,
        'looking_for_files': looking_for_files,
        'looking_for_in_canvas': looking_for_in_canvas,
        'url_to_node': url_to_node,
        'assignment_resource_nodes': assignment_resource_nodes,
        'external_resources': external_resources,
        'external_crawl_state': external_crawl_state,
        'completed_model_calls': completed_model_calls,
        'parsed_items': parsed_items,
    })


def load_graph_state(raw_state):
    return upgrade_graph_state(raw_state if isinstance(raw_state, dict) else {})
