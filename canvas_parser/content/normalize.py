import json


def parse_batch_content(file_item):
    content = file_item.get('content', {})
    if isinstance(content, str):
        try:
            content = json.loads(content)
        except json.JSONDecodeError:
            content = {'body': content}
    return content if isinstance(content, dict) else {}


def normalize_page_batch_item(file_item):
    content = parse_batch_content(file_item)
    return {
        'documenttype': 'page',
        'title': content.get('title', '') or file_item.get('name', ''),
        'body_html': content.get('body_html') or content.get('body', ''),
        'body_text': content.get('body_text', ''),
        'html_url': content.get('html_url') or file_item.get('url', ''),
    }


def normalize_module_item_batch_item(file_item):
    content = parse_batch_content(file_item)
    return {
        'documenttype': 'module_item',
        'moduleId': content.get('moduleId', ''),
        'position': content.get('position', 0),
        'itemType': content.get('itemType', ''),
        'title': content.get('title', '') or file_item.get('name', ''),
        'html_url': content.get('html_url', ''),
        'external_url': content.get('external_url', ''),
    }


def normalize_external_submission_item(file_item):
    content = parse_batch_content(file_item)
    return {
        'documenttype': 'external_submission',
        'platform': content.get('platform', 'gradescope'),
        'courseId': content.get('courseId', '') or file_item.get('courseid', ''),
        'canvasAssignmentId': content.get('canvasAssignmentId', '') or str(file_item.get('id', '')),
        'canvasAssignmentName': content.get('canvasAssignmentName', '') or file_item.get('name', ''),
        'gradescopeAssignmentId': content.get('gradescopeAssignmentId', ''),
        'gradescopeUrl': content.get('gradescopeUrl', ''),
        'gradescopeAssignmentTitle': content.get('gradescopeAssignmentTitle', ''),
        'submissionStatus': content.get('submissionStatus', 'unknown'),
        'dueText': content.get('dueText', ''),
    }
