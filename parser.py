"""Canvas graph parser service.

Functionality: consumes Canvas assignment/file records from app/canvas/api.js,
extracts concepts/events/tasks/files, persists canvas_graph.json atomically, and
produces embeddings used by vector_retreival.py.
Dependencies: OpenAI/DeepSeek/Ollama clients, PyMuPDF for PDFs, and newline JSON
messages sent by the Node Canvas API process.
"""
from openai import AsyncOpenAI
from openai import OpenAI
try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*_args, **_kwargs):  # type: ignore[misc]
        return False
from pathlib import Path
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse, urldefrag, parse_qs
import asyncio
import os
import json
import sys
import fitz
import bisect
import re
import requests
import time
import hashlib
import threading
from concurrent.futures import ThreadPoolExecutor

from canvas_parser.graph import GraphEdgeStore, GRAPH_VERSION, make_stable_id, upgrade_graph_state
from canvas_parser.graph.edges import sync_concept_prerequisite_edges, sync_learning_block_next_edges
from canvas_parser.graph.events import (
    backfill_course_modules_from_hints,
    build_syllabus_exam_text,
    canonical_test_event_name,
    classify_study_material_filename,
    event_needs_date,
    extract_prose_exam_hints,
    extract_syllabus_exam_hints,
    finalize_course_events,
    is_schedulable_date,
    link_module_items_to_events,
    normalize_event_type,
)
from canvas_parser.check.event_pipeline import check_event_pipeline, format_report
from canvas_parser.graph.pipeline_log import (
    EVENT_MUTATION_TOOLS,
    format_event_tool_line,
    log_assignment_exam,
    log_finalize_start,
    log_finalize_stats,
    log_finalize_step,
    log_llm_pass,
    log_syllabus_hint,
    print_course_event_audit,
    print_graph_validation_summary,
)
from canvas_parser.graph.parse_activity_log import (
    finish_run as finish_parse_activity_log,
    init_parse_activity_log,
    record_batch_start,
    record_file_parsed,
    record_file_classification,
    record_type_extraction,
    record_parse_cost,
    record_link_action,
    record_tool_call as record_parse_tool_call,
    set_course_display_name,
)
from canvas_parser.graph.persist import build_graph_state
from canvas_parser.graph.humanities_promote import promote_reading_extractions_for_course
from canvas_parser.graph.lecture_slide_promote import promote_lecture_slides_for_file
from canvas_parser.graph.textbook_promote import promote_textbook_extractions_for_file
from canvas_parser.graph.merge import (
    _course_humanities_reading_heavy,
    _course_is_detail_sparse,
    _course_is_lecture_slides_heavy,
    _parse_time_concept_limit,
    apply_concept_id_remap,
    build_file_type_resolver,
    cap_concepts_per_source_file,
    cap_course_concept_budget,
    cap_course_detail_budget,
    dedupe_echo_concept_details,
    merge_duplicate_concepts,
    merge_heading_shadow_concepts,
    prune_excessive_concept_details,
)
from canvas_parser.content.extractors import detect_extractor, extract_text_from_file
from canvas_parser.content.links import (
    extract_canvas_file_ids_from_html,
    extract_canvas_file_id_from_url,
    extract_links_from_html,
    is_canvas_url,
)
from canvas_parser.content.page_blocks import (
    build_raw_document_pages,
    merge_page_records,
    pages_missing_positioned_blocks,
    summarize_page_blocks,
)
from canvas_parser.content.teaching_blocks import (
    extract_teaching_units_from_pages,
    infer_parent_concept_name,
    summarize_teaching_units,
    teaching_labels_match,
)
from canvas_parser.weekly_iteration.match_utils import heading_concepts_match, names_match
from canvas_parser.content.page_blocks import compact_block_text
from canvas_parser.content.chunk_graph import build_file_chunk_graph, persist_text_chunks_on_file_node
from canvas_parser.content.file_retrieval_index import load_weekly_schedule
from canvas_parser.content.type_extraction_retrieval import type_extraction_search_text
from canvas_parser.content.chunk_embeddings import (
    CHUNK_EMBED_MAX,
    apply_chunk_embeddings,
    collect_chunks_needing_embedding,
)
from canvas_parser.content.text_chunks import format_chunks_for_grounding
from canvas_parser.content.ocr import ocr_pdf_page_image_block
from canvas_parser.content.normalize import normalize_external_submission_item
from canvas_parser.extract.orphan_resolver import promote_logged_teaching_for_file, resolve_logged_orphans
from canvas_parser.extract.validate import validate_graph_state
from canvas_parser.schedule.learning_blocks import build_hybrid_learning_blocks
from canvas_parser.schedule.submission_deps import apply_external_submission_mapping, build_external_platform_state
from canvas_parser.graph.sequence_hints import (
    apply_outline_sequence_edges,
    attach_module_hint_from_file,
    build_document_order,
    merge_document_order,
    parse_heading_numbers,
)
from canvas_parser.parse.balance_guard import (
    InsufficientBalanceAbort,
    handle_balance_error,
    is_insufficient_balance_error,
    reset_balance_guard,
)
from canvas_parser.parse.llm_resilience import deepseek_completion_with_retry
from canvas_parser.parse.fast_path import (
    PASS1_LINKED_MAX_PAGES,
    PASS1_MAX_PAGES,
    pass1_max_prompt_chars,
    is_malformed_event_link_name,
    is_non_fatal_llm_error,
    linked_discovered_pass1_only,
    linked_discovered_skip_llm,
    linked_discovered_use_pass1_only,
    linked_file_mode,
    page_is_link_hub,
    pass1_needs_pass2,
    sanitize_event_link_name,
    should_skip_llm_for_image,
    trim_pages_for_pass1,
)
from canvas_parser.parse.academic_compress import normalize_academic_prompt
from canvas_parser.parse.keyword_extract import maybe_compress_prompt_for_pass1
from canvas_parser.parse.pdf_cache import load_cached_pdf_pages, store_cached_pdf_pages
from canvas_parser.parse.file_types import (
    CLASSIFY_COURSE_FILE_TYPE_TOOL,
    FORCE_LLM_CLASSIFY,
    HEURISTIC_CONFIDENCE_THRESHOLD,
    build_classify_system_prompt,
    build_classify_user_message,
    build_classification_snippet,
    build_pass1_system_for_profile,
    get_file_type_profile,
    heuristic_classify,
    pass1_tool_names_for_profile,
    profile_uses_keyword_extract,
    resolve_file_type_profile,
    should_run_llm_classification,
)
from canvas_parser.parse.parse_pass_overrides import apply_pass_plan_to_parse_item, pass_plan_enabled
from canvas_parser.parse.parse_item_log import log_parse_item, log_parse_route, log_worker_item_done, log_worker_item_start
from canvas_parser.parse.type_logs import (
    handle_type_specific_tool,
    is_type_specific_log_tool,
    type_specific_tools_for_type,
)
from canvas_parser.parse.parse_cost import (
    assess_parse_cost,
    format_cost_summary,
    usage_from_chat_completion,
)
from canvas_parser.parse.parse_stats import (
    assess_from_completed_model_calls,
    build_file_parse_record,
    format_file_efficiency_debug,
    format_session_efficiency_report,
    print_session_efficiency_report,
    write_parse_stats_report,
)
from canvas_parser.parse.heuristic_concepts import (
    build_heuristic_type_extractions,
    extract_heuristic_concept_titles,
    heuristic_concepts_enabled,
    merge_type_extractions,
)

try:
    import numpy as np
except ModuleNotFoundError:
    np = None

if hasattr(sys.stdin, 'reconfigure'):
    sys.stdin.reconfigure(encoding='utf-8', errors="replace")
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors="replace")
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors="replace")

load_dotenv()

from canvas_parser.clock import install_clock_shim

_clock_status = install_clock_shim()
if _clock_status.get('active'):
    print(f"NUCLEUS fake clock active: {_clock_status.get('fake_date')}", file=sys.stderr)


def create_openai_client():
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    return OpenAI(
        api_key=api_key,
        timeout=float(os.getenv("OPENAI_EMBEDDING_TIMEOUT_SECONDS", "30"))
    )


def create_deepseek_client():
    api_key = os.getenv("DEEP_SEEK_API_KEY")
    if not api_key:
        return None
    return AsyncOpenAI(
        api_key=api_key,
        base_url="https://api.deepseek.com",
        timeout=float(os.getenv("DEEPSEEK_TIMEOUT_SECONDS", "180")),
    )


openai_client = create_openai_client()
deepseek_client = create_deepseek_client()

if openai_client is None:
    print("parser warning: OPENAI_API_KEY is not set; embedding generation will be skipped", flush=True)
if deepseek_client is None:
    print("parser warning: DEEP_SEEK_API_KEY is not set; DeepSeek file parsing passes will be skipped", flush=True)


def deepseek_thinking_extra(thinking='enabled'):
    mode = str(thinking or 'enabled').strip().lower()
    if mode not in {'enabled', 'disabled'}:
        mode = 'enabled'
    return {'extra_body': {'thinking': {'type': mode}}}


PARSER_ALL_PASSES_COMPLETED = (
    'parser all passes completed__________________________________________________'
)

current_assignment_files_groups = []
current_files_groups = []
_deepseek_pass_context = {'final_pass': False, 'courseid': '', 'fileid': '', 'academicFileType': ''}
_debug_pass1_tool_names: dict[tuple[str, str], list[str]] = {}
allsyllabi = {}


def normalize_courseid(courseid):
    return str(courseid or '').strip()


def get_syllabus_for_course(courseid):
    cid = normalize_courseid(courseid)
    return syllabusNodes.get(cid)


def rekey_course_dict(store):
    normalized = {}
    for courseid, value in list((store or {}).items()):
        cid = normalize_courseid(courseid)
        if cid in normalized and isinstance(normalized[cid], dict) and isinstance(value, dict):
            normalized[cid].update(value)
        else:
            normalized[cid] = value
    store.clear()
    store.update(normalized)
syllabusNodes = {}
fileNodes = {}
conceptNodes = {}
learningBlocks = {}
graphEdges = GraphEdgeStore()
moduleOrderHints = {}
courseModules = {}
externalPlatforms = {}
problems = {}
logged_details = {}
logged_examples = {}
logged_problems = {}
logged_assignments = {}
logged_events = {}
looking_for_files = {}
looking_for_in_canvas = {}
pending_linked_canvas_files = {}
url_to_node = {}
assignmentResourceNodes = {}
external_crawl_state = {}
completed_model_calls = {
    'local_assignment_summaries': [],
    'deepseek_file_passes': [],
    'deepseek_classifications': [],
    'parse_file_stats': [],
    'parse_session_summary': {},
}
parse_file_stats = []
parser_thread_log_lines: list[str] = []
parsed_items = {
    'assignment': [],
    'file': [],
    'external': [],
    'page': [],
    'module_item': [],
    'external_submission': [],
}
parsed_item_keys = {
    'assignment': set(),
    'file': set(),
    'external': set(),
    'page': set(),
    'module_item': set(),
    'external_submission': set(),
}
eventNodes = {}
assignment_description_summary_cache = {}
embedding_cache = {}
course_name_cache = None
assignment_summary_queue = None
json_write_lock = threading.RLock()
PARSE_MAX_CONCURRENT = int(os.getenv("PARSE_MAX_CONCURRENT", "8"))
DEEPSEEK_MAX_CONCURRENT = int(os.getenv("DEEPSEEK_MAX_CONCURRENT", "10"))
DEEPSEEK_MAX_TURNS_PASS = int(os.getenv("DEEPSEEK_MAX_TURNS_PASS", "3"))
DEEPSEEK_MAX_TURNS_FINAL = int(os.getenv("DEEPSEEK_MAX_TURNS_FINAL", "4"))
PARSER_SKIP_PASS2 = os.getenv("PARSER_SKIP_PASS2", "0") == "1"
PARSER_DEFER_FILE_EMBED = os.getenv("PARSER_DEFER_FILE_EMBED", "0") == "1"
PARSER_DEFER_CHECKPOINT = os.getenv("PARSER_DEFER_CHECKPOINT", "0") == "1"
PARSER_BULK_MODE = os.getenv("PARSER_BULK_MODE", "0") == "1"
PARSER_SKIP_ASSIGNMENT_SUMMARY = os.getenv("PARSER_SKIP_ASSIGNMENT_SUMMARY", "1" if PARSER_BULK_MODE else "0") == "1"
PARSER_SKIP_SYLLABUS_FINAL_PASS = os.getenv("PARSER_SKIP_SYLLABUS_FINAL_PASS", "1" if PARSER_BULK_MODE else "0") == "1"
PARSER_SKIP_EXTERNAL = os.getenv("PARSER_SKIP_EXTERNAL", "1" if PARSER_BULK_MODE else "0") == "1"
PARSER_SKIP_PAGE_LLM = os.getenv("PARSER_SKIP_PAGE_LLM", "0") == "1"
PARSER_DEFER_PER_FILE_FINALIZE = os.getenv(
    "PARSER_DEFER_PER_FILE_FINALIZE",
    "1" if PARSER_BULK_MODE else "0",
) == "1"
PARSER_DEFER_FILE_INDEX = os.getenv(
    "PARSER_DEFER_FILE_INDEX",
    "1" if PARSER_BULK_MODE else "0",
) == "1"
PARSER_SKIP_LLM_CLASSIFY = os.getenv("PARSER_SKIP_LLM_CLASSIFY", "0") == "1"
PARSER_DEFER_BATCH_FINALIZE = os.getenv("PARSER_DEFER_BATCH_FINALIZE", "1" if PARSER_BULK_MODE else "0") == "1"
PARSER_SKIP_DOWNLOAD_IF_CACHED = os.getenv("PARSER_SKIP_DOWNLOAD_IF_CACHED", "1" if PARSER_BULK_MODE else "0") == "1"
PARSER_SKIP_PAGE_LINK_HUB = os.getenv("PARSER_SKIP_PAGE_LINK_HUB", "0") == "1"
PARSER_SKIP_PDF_BLOCKS = os.getenv("PARSER_SKIP_PDF_BLOCKS", "0") == "1"
PARSER_HEURISTIC_ONLY = os.getenv("PARSER_HEURISTIC_ONLY", "0") == "1"
PARSER_DOWNLOAD_ONLY = os.getenv("PARSER_DOWNLOAD_ONLY", "0") == "1"
PARSER_INFERENCE_ONLY = os.getenv("PARSER_INFERENCE_ONLY", "0") == "1"
PARSER_TRIAL_SIMPLE_FINALIZE = os.getenv("PARSER_TRIAL_SIMPLE_FINALIZE", "0") == "1"
PARSER_STATS_REPORT_PATH = os.getenv("PARSER_STATS_REPORT_PATH", "").strip()
_deferred_course_finalize: set[str] = set()
EXTERNAL_MAX_CONCURRENT = int(os.getenv("EXTERNAL_MAX_CONCURRENT", "4"))
EMBED_MAX_CONCURRENT = int(os.getenv("EMBED_MAX_CONCURRENT", "3"))
WRITE_DEBOUNCE_SECONDS = float(os.getenv("WRITE_DEBOUNCE_SECONDS", "30"))
parse_semaphore = None
deepseek_semaphore = None
external_semaphore = None
parse_io_executor = None
write_debounce_timer = None
write_pending = False
phase_timings = {
    'pdf_io_ms': 0.0,
    'parse_llm_ms': 0.0,
    'write_state_ms': 0.0,
    'embed_ms': 0.0,
    'external_ms': 0.0,
}
ASSIGNMENT_DESCRIPTION_SUMMARY_LENGTH = int(os.getenv("ASSIGNMENT_DESCRIPTION_SUMMARY_LENGTH", "220"))
OLLAMA_SUMMARY_MODEL = os.getenv("OLLAMA_SUMMARY_MODEL", "llama3.2:3b")
OPENAI_EMBEDDING_BATCH_SIZE = int(os.getenv("OPENAI_EMBEDDING_BATCH_SIZE", "50"))
EXTERNAL_CRAWL_MAX_DEPTH = int(os.getenv("EXTERNAL_CRAWL_MAX_DEPTH", "3"))
EXTERNAL_CRAWL_MAX_PAGES = int(os.getenv("EXTERNAL_CRAWL_MAX_PAGES", "40"))
EXTERNAL_COURSE_WEBSITE_MAX_DEPTH = int(os.getenv("EXTERNAL_COURSE_WEBSITE_MAX_DEPTH", "6"))
EXTERNAL_COURSE_WEBSITE_MAX_PAGES = int(os.getenv("EXTERNAL_COURSE_WEBSITE_MAX_PAGES", "120"))
EXTERNAL_CRAWL_TIMEOUT_SECONDS = float(os.getenv("EXTERNAL_CRAWL_TIMEOUT_SECONDS", "15"))
CANVAS_DOWNLOAD_TIMEOUT_SECONDS = float(os.getenv("CANVAS_DOWNLOAD_TIMEOUT_SECONDS", "120"))
CANVAS_DOWNLOAD_MAX_BYTES = int(os.getenv("CANVAS_DOWNLOAD_MAX_BYTES", str(100 * 1024 * 1024)))
EXTERNAL_COURSE_WEBSITE_TYPES = {
    'course website', 'course site', 'class website', 'course homepage',
    'course home page', 'course portal', 'class site', 'public website', 'course wiki'
}
EXTERNAL_FILE_TYPES = {
    'file', 'pdf', 'document', 'doc', 'docx', 'slides', 'slide deck', 'worksheet',
    'reading', 'handout', 'notebook', 'rubric', 'paper', 'text', 'ppt', 'pptx'
}
EXTERNAL_FILE_EXTENSIONS = {
    '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.csv', '.txt',
    '.md', '.ipynb', '.zip', '.tar', '.gz', '.json', '.xml', '.rtf', '.odt', '.ods', '.html', '.htm'
}
EXTERNAL_TEXT_FILE_EXTENSIONS = {'.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', '.rst'}
SYLLABUS_NAME_PATTERN = re.compile(
    r"\b(syllabus|course\s+outline|course\s+information|class\s+information|course\s+schedule)\b",
    re.IGNORECASE
)


class HtmlTextExtractor(HTMLParser):
    block_tags = {
        'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl',
        'dt', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5',
        'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
        'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'
    }
    skip_tags = {'script', 'style', 'noscript', 'svg', 'canvas'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip_depth = 0

    def append_break(self):
        if self.parts and self.parts[-1] != '\n':
            self.parts.append('\n')

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in self.skip_tags:
            self.skip_depth += 1
            return
        if self.skip_depth:
            return
        if tag in self.block_tags:
            self.append_break()

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in self.skip_tags and self.skip_depth:
            self.skip_depth -= 1
            return
        if self.skip_depth:
            return
        if tag in self.block_tags:
            self.append_break()

    def handle_data(self, data):
        if self.skip_depth:
            return
        if data:
            self.parts.append(data)

    def get_text(self):
        text = unescape(''.join(self.parts))
        lines = []
        for line in text.splitlines():
            cleaned = re.sub(r'[ \t\r\f\v]+', ' ', line).strip()
            if cleaned:
                lines.append(cleaned)
        return '\n'.join(lines)


class HtmlLinkExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        attr_map = {name.lower(): value for name, value in attrs if value}
        if tag in {'a', 'area'} and attr_map.get('href'):
            self.links.append(attr_map['href'])
        elif tag in {'iframe', 'embed'} and attr_map.get('src'):
            self.links.append(attr_map['src'])


def html_to_text(value):
    if value is None:
        return ''
    text = str(value)
    if not text:
        return ''
    parser = HtmlTextExtractor()
    try:
        parser.feed(text)
        parser.close()
        parsed = parser.get_text()
    except Exception:
        parsed = re.sub(r'<[^>]+>', ' ', text)
        parsed = unescape(parsed)
        parsed = re.sub(r'\s+', ' ', parsed).strip()
    return clean_surrogates(parsed)


def cutoff_text(value, max_length):
    text = re.sub(r'\s+', ' ', html_to_text(value)).strip()
    if len(text) <= max_length:
        return text
    return text[:max_length - 3].rstrip() + '...'


async def summarize_assignment_description_async(assignmentid, value, max_length=ASSIGNMENT_DESCRIPTION_SUMMARY_LENGTH):
    text = re.sub(r'\s+', ' ', html_to_text(value)).strip()
    if not text:
        return ''
    if len(text) <= max_length:
        return text

    cache_key = (text, max_length)
    if cache_key in assignment_description_summary_cache:
        return assignment_description_summary_cache[cache_key]

    fallback = cutoff_text(text, max_length)
    try:
        from ollama import AsyncClient

        response = await AsyncClient().chat(
            model=OLLAMA_SUMMARY_MODEL,
            messages=[
                {
                    'role': 'system',
                    'content': (
                        'You summarize Canvas assignment descriptions for compact task cards. '
                        'Preserve the concrete action, deliverable, submission format, and key constraints. '
                        f'Return one plain-text summary under {max_length} characters. No markdown.'
                    )
                },
                {
                    'role': 'user',
                    'content': (
                        f'Assignment ID: {assignmentid}\n\n'
                        f'Full description:\n{text}'
                    )
                }
            ],
            options={
                'temperature': 0,
                'num_predict': 90
            }
        )
        message = getattr(response, 'message', None)
        summary = getattr(message, 'content', '') if message else ''
        if not summary and isinstance(response, dict):
            summary = response.get('message', {}).get('content', '')
        summary = cutoff_text(summary, max_length)
        if summary:
            assignment_description_summary_cache[cache_key] = summary
            return summary
    except Exception as error:
        print(
            f"parser debug assignment: ollama summary failed model={OLLAMA_SUMMARY_MODEL!r} error={error}",
            flush=True
        )

    assignment_description_summary_cache[cache_key] = fallback
    return fallback


def enqueue_assignment_description_summary(courseid, assignmentid, description):
    if PARSER_SKIP_ASSIGNMENT_SUMMARY or not description or not assignment_summary_queue:
        return
    assignment_summary_queue.put_nowait({
        'courseid': courseid,
        'assignmentid': assignmentid,
        'description': description
    })


def on_assignment_summary_finished(courseid, assignmentid, summary):
    result = update_assignment_node(
        courseid,
        assignmentNodeId=assignmentid,
        description=summary
    )
    assignment = find_assignment_node(courseid, assignmentNodeId=assignmentid)
    if assignment and result.get('status') == 'SUCCESS':
        safe_embed_node(
            assignment,
            embed_named_description,
            course_scoped_embedding_name(courseid, assignment.name),
            assignment.description,
            force=True
        )
    completed_model_calls['local_assignment_summaries'].append({
        'courseid': courseid,
        'assignmentid': assignmentid,
        'summary_chars': len(summary or ''),
        'completed_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    })
    write_state(checkpoint=True)


async def assignment_summary_worker(on_summary_finished=on_assignment_summary_finished):
    while True:
        item = await assignment_summary_queue.get()
        try:
            summary = await summarize_assignment_description_async(
                item.get('assignmentid', ''),
                item.get('description', '')
            )
            if summary:
                on_summary_finished(
                    item.get('courseid', ''),
                    item.get('assignmentid', ''),
                    summary
                )
        finally:
            assignment_summary_queue.task_done()


def record_phase_time(phase, started_at):
    phase_timings[phase] = phase_timings.get(phase, 0.0) + (time.perf_counter() - started_at) * 1000


def init_parse_runtime():
    global parse_semaphore, deepseek_semaphore, external_semaphore, parse_io_executor
    parse_semaphore = asyncio.Semaphore(PARSE_MAX_CONCURRENT)
    deepseek_semaphore = asyncio.Semaphore(DEEPSEEK_MAX_CONCURRENT)
    external_semaphore = asyncio.Semaphore(EXTERNAL_MAX_CONCURRENT)
    parse_io_executor = ThreadPoolExecutor(max_workers=PARSE_MAX_CONCURRENT)
    fast_flags = []
    if PARSER_SKIP_PASS2:
        fast_flags.append('skip_pass2')
    if PARSER_DEFER_FILE_EMBED:
        fast_flags.append('defer_file_embed')
    if PARSER_DEFER_CHECKPOINT:
        fast_flags.append('defer_checkpoint')
    if PARSER_SKIP_ASSIGNMENT_SUMMARY:
        fast_flags.append('skip_assignment_summary')
    if PARSER_SKIP_SYLLABUS_FINAL_PASS:
        fast_flags.append('skip_syllabus_final')
    if PARSER_SKIP_EXTERNAL:
        fast_flags.append('skip_external')
    if PARSER_SKIP_PAGE_LLM:
        fast_flags.append('skip_page_llm')
    if PARSER_SKIP_LLM_CLASSIFY:
        fast_flags.append('skip_llm_classify')
    if PARSER_DEFER_BATCH_FINALIZE:
        fast_flags.append('defer_batch_finalize')
    if PARSER_SKIP_DOWNLOAD_IF_CACHED:
        fast_flags.append('skip_download_if_cached')
    if PARSER_SKIP_PAGE_LINK_HUB:
        fast_flags.append('skip_page_link_hub')
    if PARSER_DEFER_PER_FILE_FINALIZE:
        fast_flags.append('defer_per_file_finalize')
    if PARSER_DEFER_FILE_INDEX:
        fast_flags.append('defer_file_index')
    if PARSER_HEURISTIC_ONLY:
        fast_flags.append('heuristic_only')
    if PARSER_DOWNLOAD_ONLY:
        fast_flags.append('download_only')
    if PARSER_INFERENCE_ONLY:
        fast_flags.append('inference_only')
    if PARSER_TRIAL_SIMPLE_FINALIZE:
        fast_flags.append('trial_simple_finalize')
    parse_mode = os.environ.get('PARSER_PARSE_MODE', '').strip()
    if parse_mode:
        print(f"parser mode: {parse_mode}", flush=True)
    print(
        f"parser concurrency: parse={PARSE_MAX_CONCURRENT} deepseek={DEEPSEEK_MAX_CONCURRENT} "
        f"turns_pass={DEEPSEEK_MAX_TURNS_PASS} turns_final={DEEPSEEK_MAX_TURNS_FINAL}"
        + (f" fast=[{','.join(fast_flags)}]" if fast_flags else ''),
        flush=True,
    )


def shutdown_parse_runtime():
    global parse_io_executor
    if parse_io_executor:
        parse_io_executor.shutdown(wait=False, cancel_futures=True)
        parse_io_executor = None


def flush_write_state(force=False, checkpoint=False):
    global write_pending, write_debounce_timer
    if not write_pending and not force:
        return
    write_pending = False
    if write_debounce_timer:
        write_debounce_timer.cancel()
        write_debounce_timer = None
    started = time.perf_counter()
    write_state_impl(log_validation=checkpoint)
    record_phase_time('write_state_ms', started)


def schedule_write_state():
    global write_pending, write_debounce_timer
    write_pending = True
    if WRITE_DEBOUNCE_SECONDS <= 0:
        flush_write_state(force=True)
        return
    if write_debounce_timer:
        write_debounce_timer.cancel()
    write_debounce_timer = threading.Timer(
        WRITE_DEBOUNCE_SECONDS,
        lambda: flush_write_state(force=True, checkpoint=False),
    )
    write_debounce_timer.daemon = True
    write_debounce_timer.start()


async def processfile_async(fileid, url, content_type='', filename=''):
    started = time.perf_counter()
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        parse_io_executor,
        lambda: processfile(fileid, url, content_type=content_type, filename=filename)
    )
    record_phase_time('pdf_io_ms', started)
    return result


async def build_pdf_pages_async(filepath, fileid):
    started = time.perf_counter()
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        parse_io_executor,
        lambda: build_pdf_pages(filepath, fileid)
    )
    record_phase_time('pdf_io_ms', started)
    return result


async def crawl_external_website_async(
    courseid,
    resource,
    max_depth=EXTERNAL_CRAWL_MAX_DEPTH,
    max_pages=EXTERNAL_CRAWL_MAX_PAGES,
    follow_links=True,
    crawl_mode='course_website'
):
    started = time.perf_counter()
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        parse_io_executor,
        lambda: crawl_external_website(
            courseid,
            resource,
            max_depth=max_depth,
            max_pages=max_pages,
            follow_links=follow_links,
            crawl_mode=crawl_mode
        )
    )
    record_phase_time('external_ms', started)
    return result


def clean_surrogates(value):
    if np is not None and isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, str):
        return value.encode('utf-8', 'replace').decode('utf-8')
    if isinstance(value, list):
        return [clean_surrogates(item) for item in value]
    if isinstance(value, dict):
        return {
            clean_surrogates(key): clean_surrogates(item)
            for key, item in value.items()
        }
    return value


def atomic_write_json(path, data):
    temp_path = path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    with json_write_lock:
        try:
            with open(temp_path, 'w', encoding='utf-8') as file:
                json.dump(clean_surrogates(data), file, ensure_ascii=False, indent=2)
                file.flush()
                os.fsync(file.fileno())

            last_error = None
            for attempt in range(5):
                try:
                    os.replace(temp_path, path)
                    return
                except PermissionError as error:
                    last_error = error
                    time.sleep(0.2 * (attempt + 1))
            raise last_error
        finally:
            try:
                if temp_path.exists():
                    temp_path.unlink()
            except OSError:
                pass


def calcvector(content):
    if not content:
        return None
    # implement later !!!!!
    return 0


class conceptNode():
    def __init__(self, courseid='No courseid', name='No name', conceptid=None, description=None):
        self.name = name
        self.conceptid = conceptid or make_stable_id('concept', courseid, name)
        self.description = html_to_text(description)
        self.courseid = courseid
        self.content_vector = calcvector(description)
        self.embedded = {}
        self.details = []
        self.examples = []
        self.problems = []
        self.sourcePages = []
        self.prerequisiteConceptIds = []
        self.aliases = []
        self.moduleOrderHints = []
        self.documentOrder = {}

    def to_dict(self):
        return {
            'name': self.name,
            'conceptid': self.conceptid,
            'description': self.description,
            'courseid': self.courseid,
            'embedded': self.embedded,
            'details': [f.to_dict() for f in self.details],
            'examples': [f.to_dict() for f in self.examples],
            'problems': self.problems,
            'sourcePages': self.sourcePages,
            'prerequisiteConceptIds': self.prerequisiteConceptIds,
            'aliases': self.aliases,
            'moduleOrderHints': self.moduleOrderHints,
            'documentOrder': self.documentOrder,
        }


class detailNode():
    def __init__(self, name='No name', description=None):
        self.name = name
        self.description = description
        self.content_vector = calcvector(description)
        self.embedded = {}
        self.sourcePages = []

    def to_dict(self):
        return {'name': self.name, 'description': self.description, 'embedded': self.embedded, 'sourcePages': self.sourcePages}


class exampleNode():
    def __init__(self, name='No name', description=None):
        self.name = name
        self.description = description
        self.content_vector = calcvector(description)
        self.embedded = {}
        self.sourcePages = []

    def to_dict(self):
        return {'name': self.name, 'description': self.description, 'embedded': self.embedded, 'sourcePages': self.sourcePages}


class problemNode():
    def __init__(self, name='No name', problemid=None, incomingConceptNodeIds=None, outgoingConceptNodeIds=None, steps=None, answer='None', assignmentNodeIds=None):
        self.name = name
        self.problemid = problemid
        self.incomingConceptNodeIds = incomingConceptNodeIds or []
        self.outgoingConceptNodeIds = outgoingConceptNodeIds or []
        self.steps = steps or []
        self.answer = answer
        self.assignmentNodeIds = assignmentNodeIds or []
        self.embedded = {}
        self.sourcePages = []

    def to_dict(self):
        return {
            'name': self.name,
            'problemid': self.problemid,
            'incomingConceptNodeIds': self.incomingConceptNodeIds,
            'outgoingConceptNodeIds': self.outgoingConceptNodeIds,
            'steps': self.steps,
            'answer': self.answer,
            'embedded': self.embedded,
            'assignmentNodeIds': self.assignmentNodeIds,
            'sourcePages': self.sourcePages
        }


class fileNode():
    def __init__(self, fileid='', courseid='No courseid', name='', downloadurl='', canvaspreviewurl='', filetype=''):
        self.fileid = str(fileid)
        self.courseid = courseid
        self.name = name
        self.downloadurl = downloadurl
        self.canvaspreviewurl = canvaspreviewurl
        self.type = str(filetype or '').strip()
        self.academicFileType = ''
        self.typeExtractions = {}
        self.concepts = []
        self.details = []
        self.examples = []
        self.problems = []
        self.embedded = {}
        self.searchtext = ''
        self.pages = []
        self.textChunks = []

    def to_dict(self):
        return {
            'fileid': self.fileid,
            'courseid': self.courseid,
            'name': self.name,
            'type': self.type,
            'academicFileType': self.academicFileType,
            'typeExtractions': self.typeExtractions or {},
            'downloadurl': self.downloadurl,
            'canvaspreviewurl': self.canvaspreviewurl,
            'embedded': self.embedded,
            'concepts': self.concepts,
            'details': self.details,
            'examples': self.examples,
            'problems': self.problems,
            'searchtext': self.searchtext,
            'pages': self.pages,
            'textChunks': self.textChunks,
        }


def append_unique(values, value):
    if value and value not in values:
        values.append(value)


def normalize_registry_url(url):
    text = str(url or '').strip()
    if not text:
        return ''
    try:
        parsed = urlparse(text)
        normalized = parsed._replace(fragment='').geturl()
        return normalized.rstrip('/')
    except ValueError:
        return text


def make_node_ref(node_type, courseid, node_id, name=''):
    return {
        'type': str(node_type or ''),
        'courseid': normalize_courseid(courseid),
        'nodeId': str(node_id or ''),
        'name': str(name or '').strip(),
    }


def register_url_for_node(url, node_ref):
    normalized = normalize_registry_url(url)
    if not normalized or not node_ref:
        return
    url_to_node[normalized] = node_ref


def register_assignment_urls(assignment, courseid):
    if not assignment:
        return
    ref = make_node_ref('assignment', courseid, assignment.assignmentid, assignment.name)
    for url in (assignment.downloadurl, assignment.canvaspreviewurl):
        register_url_for_node(url, ref)


def register_file_urls(file_node):
    if not file_node:
        return
    ref = make_node_ref('file', file_node.courseid, file_node.fileid, file_node.name)
    for url in (file_node.downloadurl, file_node.canvaspreviewurl):
        register_url_for_node(url, ref)


def register_syllabus_urls(syllabus):
    if not syllabus:
        return
    ref = make_node_ref('syllabus', syllabus.courseid, syllabus.courseid, 'syllabus')
    for url in (syllabus.downloadurl, syllabus.canvaspreviewurl):
        register_url_for_node(url, ref)


def add_assignment_resource_node(courseid, url, label='', source_assignment_node_id=''):
    cid = normalize_courseid(courseid)
    normalized = normalize_registry_url(url)
    if not cid or not normalized:
        return None
    assignmentResourceNodes.setdefault(cid, {})
    existing = assignmentResourceNodes[cid].get(normalized)
    if existing:
        if label and not existing.label:
            existing.label = label
        if source_assignment_node_id and not existing.sourceAssignmentNodeId:
            existing.sourceAssignmentNodeId = str(source_assignment_node_id)
        register_url_for_node(normalized, make_node_ref(
            'assignment_resource',
            cid,
            existing.resourceid,
            existing.label,
        ))
        return existing.resourceid
    node = assignmentResourceNode(
        courseid=cid,
        url=normalized,
        label=label or normalized,
        source_assignment_node_id=source_assignment_node_id,
    )
    assignmentResourceNodes[cid][normalized] = node
    register_url_for_node(normalized, make_node_ref(
        'assignment_resource',
        cid,
        node.resourceid,
        node.label,
    ))
    print(
        f"parser debug assignment_resource: created course={cid} resourceid={node.resourceid!r} url={normalized!r}",
        flush=True,
    )
    return node.resourceid


def process_assignment_description_html_links(courseid, assignment, description_html, base_url=''):
    if not assignment or not description_html:
        return
    assignment_ref = make_node_ref('assignment', courseid, assignment.assignmentid, assignment.name)
    skip_urls = {
        normalize_registry_url(url)
        for url in (assignment.downloadurl, assignment.canvaspreviewurl, base_url)
        if url
    }
    for link in extract_links_from_html(description_html, base_url):
        url = normalize_registry_url(link.get('url', ''))
        if not url or url in skip_urls:
            continue
        if is_canvas_url(url):
            file_id = extract_canvas_file_id_from_url(url)
            if file_id:
                enqueue_linked_canvas_file_id(
                    courseid,
                    file_id,
                    name=link.get('label', '') or f'Linked file {file_id}',
                )
            looking_for_in_canvas[url] = assignment_ref
            print(
                f"parser debug looking_for_in_canvas: url={url!r} assignment={assignment.assignmentid!r}",
                flush=True,
            )
            continue
        add_assignment_resource_node(
            courseid,
            url,
            label=link.get('label', '') or url,
            source_assignment_node_id=assignment.assignmentid,
        )


def make_child_node_ref(kind, parentid, name):
    return f"{kind}:{parentid}:{name}"


def normalize_gradepercentage(value):
    if value is None or value == '':
        return None
    if isinstance(value, str):
        cleaned = value.strip().replace('%', '')
        try:
            value = float(cleaned)
        except ValueError:
            return None
    if isinstance(value, (int, float)) and 1 <= value <= 100:
        return int(value) if float(value).is_integer() else value
    return None


_date_normalize_context = {'default_year': None}

COURSE_YEAR_PATTERN = re.compile(
    r'\b(?:fall|spring|summer|winter)\s+((?:19|20)\d{2})\b',
    re.IGNORECASE,
)
COURSE_TERM_CODE_PATTERN = re.compile(r'(?:_|\b)([fsuwx])(\d{2})\b', re.IGNORECASE)


def set_date_normalize_context(default_year=None):
    _date_normalize_context['default_year'] = default_year


def infer_course_academic_year(courseid, syllabus=None, file_nodes=None):
    for assignment in getattr(syllabus, 'assignments', []) or [] if syllabus else []:
        for field in ('duedate', 'unlockdate'):
            value = getattr(assignment, field, '') if not isinstance(assignment, dict) else assignment.get(field, '')
            if is_schedulable_date(value):
                return int(str(value)[0:4])

    texts = []
    if syllabus:
        texts.extend([
            getattr(syllabus, 'classtimes', ''),
            getattr(syllabus, 'other', ''),
        ])
    course_name = get_course_display_name(courseid)
    if course_name:
        texts.append(course_name)
    for node in (file_nodes or {}).values():
        texts.append(getattr(node, 'name', ''))

    combined = ' '.join(str(text) for text in texts if text)
    for match in COURSE_YEAR_PATTERN.finditer(combined):
        year = int(match.group(1))
        if 1990 <= year <= 2100:
            return year
    for match in COURSE_TERM_CODE_PATTERN.finditer(combined):
        year_suffix = int(match.group(2))
        year = 2000 + year_suffix if year_suffix < 70 else 1900 + year_suffix
        if 1990 <= year <= 2100:
            return year
    return None


def normalize_date(value, default_year=None):
    if value is None:
        return ''
    if isinstance(value, (int, float)):
        return ''

    text = str(value).strip()
    if not text:
        return ''

    lowered = text.casefold()
    if lowered in {'none', 'null', 'no due date', 'no due', 'n/a', 'na', 'not found', 'unknown', 'tbd'}:
        return ''

    cleaned = re.sub(r'\s+', ' ', text)
    cleaned = cleaned.replace('\u2013', '-').replace('\u2014', '-')
    cleaned = re.sub(r'(\d)(am|pm)\b', r'\1 \2', cleaned, flags=re.IGNORECASE)

    iso_candidate = cleaned
    if iso_candidate.endswith('Z'):
        iso_candidate = iso_candidate[:-1] + '+00:00'

    try:
        parsed = datetime.fromisoformat(iso_candidate)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    except ValueError:
        pass

    formats = [
        '%Y-%m-%d %H:%M:%S',
        '%Y-%m-%d %H:%M',
        '%Y-%m-%d',
        '%m/%d/%Y %I:%M %p',
        '%m/%d/%y %I:%M %p',
        '%m/%d/%Y %H:%M',
        '%m/%d/%y %H:%M',
        '%m/%d/%Y',
        '%m/%d/%y',
        '%B %d, %Y %I:%M %p',
        '%B %d %Y %I:%M %p',
        '%b %d, %Y %I:%M %p',
        '%b %d %Y %I:%M %p',
        '%B %d, %Y %H:%M',
        '%B %d %Y %H:%M',
        '%b %d, %Y %H:%M',
        '%b %d %Y %H:%M',
        '%B %d, %Y',
        '%B %d %Y',
        '%b %d, %Y',
        '%b %d %Y'
    ]

    for date_format in formats:
        try:
            parsed = datetime.strptime(cleaned, date_format).replace(tzinfo=timezone.utc)
            return parsed.strftime('%Y-%m-%dT%H:%M:%SZ')
        except ValueError:
            continue

    year = default_year if default_year is not None else _date_normalize_context.get('default_year')
    if year:
        base = cleaned.rstrip(',').strip()
        yearless_candidates = [
            (f'{base}, {year}', '%B %d, %Y'),
            (f'{base}, {year}', '%b %d, %Y'),
            (f'{base} {year}', '%B %d %Y'),
            (f'{base} {year}', '%b %d %Y'),
        ]
        for candidate, date_format in yearless_candidates:
            try:
                parsed = datetime.strptime(candidate, date_format).replace(tzinfo=timezone.utc)
                return parsed.strftime('%Y-%m-%dT%H:%M:%SZ')
            except ValueError:
                continue

    return ''


def normalize_event_date(value, default_year=None):
    normalized = normalize_date(value, default_year=default_year)
    if is_schedulable_date(normalized):
        return normalized
    return ''


class assignmentResourceNode():
    def __init__(self, courseid='', url='', label='', source_assignment_node_id=''):
        self.courseid = normalize_courseid(courseid)
        self.url = normalize_registry_url(url)
        self.label = str(label or url or '').strip()
        self.sourceAssignmentNodeId = str(source_assignment_node_id or '')
        self.resourceid = make_stable_id('assignment_resource', self.courseid, self.url)

    def to_dict(self):
        return {
            'resourceid': self.resourceid,
            'courseid': self.courseid,
            'url': self.url,
            'label': self.label,
            'sourceAssignmentNodeId': self.sourceAssignmentNodeId,
        }


class assignmentNode():
    def __init__(self, name='No name', unlockdate='', duedate='', gradepercentage='', description='', problems=None, downloadurl='', canvaspreviewurl='', filechildren=None, lookingfor=None, submission_types=None, submission_links=None, submission_dependencies=None, concept_requirements=None, assignmentid=None, canvasAssignmentId='', courseid=''):
        self.name = name
        self.assignmentid = assignmentid or make_stable_id('assignment', courseid or 'global', name)
        self.canvasAssignmentId = str(canvasAssignmentId or '').strip()
        self.unlockdate = normalize_date(unlockdate)
        self.duedate = normalize_date(duedate)
        self.gradepercentage = normalize_gradepercentage(gradepercentage)
        self.description = html_to_text(description)
        self.problems = problems or []
        self.downloadurl = downloadurl
        self.canvaspreviewurl = canvaspreviewurl
        self.filechildren = filechildren or []
        self.lookingfor = lookingfor or []
        self.submissionTypes = submission_types or []
        self.submissionLinks = submission_links or []
        self.submissionDependencies = submission_dependencies or []
        self.conceptRequirements = concept_requirements or []
        self.embedded = {}

    def update(self, unlockdate=None, duedate=None, gradepercentage=None, description=None, problems=None, downloadurl=None, canvaspreviewurl=None, filechildren=None, lookingfor=None, submission_types=None, submission_links=None, submission_dependencies=None, concept_requirements=None, canvasAssignmentId=None):
        changed_embedding_text = False
        if canvasAssignmentId:
            self.canvasAssignmentId = str(canvasAssignmentId).strip()
        if unlockdate:
            self.unlockdate = normalize_date(unlockdate)
        if duedate:
            self.duedate = normalize_date(duedate)
        normalized_gradepercentage = normalize_gradepercentage(gradepercentage)
        if normalized_gradepercentage is not None:
            self.gradepercentage = normalized_gradepercentage
        if description:
            self.description = html_to_text(description)
            changed_embedding_text = True
        if downloadurl:
            self.downloadurl = downloadurl
        if canvaspreviewurl:
            self.canvaspreviewurl = canvaspreviewurl
        if problems:
            for problemid in problems:
                if problemid not in self.problems:
                    self.problems.append(problemid)
        if filechildren:
            for fileid in filechildren:
                append_unique(self.filechildren, str(fileid))
        if lookingfor:
            for target in lookingfor:
                append_unique(self.lookingfor, str(target))
        if submission_types:
            for entry in submission_types:
                append_unique(self.submissionTypes, str(entry))
        if submission_links:
            for entry in submission_links:
                if isinstance(entry, dict) and entry.get('url') and entry not in self.submissionLinks:
                    self.submissionLinks.append(entry)
        if submission_dependencies:
            for entry in submission_dependencies:
                if isinstance(entry, dict) and entry not in self.submissionDependencies:
                    self.submissionDependencies.append(entry)
        if concept_requirements:
            for concept_id in concept_requirements:
                append_unique(self.conceptRequirements, str(concept_id))
        if changed_embedding_text:
            self.embedded = {}

    def to_dict(self):
        payload = {
            'name': self.name,
            'assignmentid': self.assignmentid,
            'unlockdate': self.unlockdate,
            'duedate': self.duedate,
            'gradepercentage': self.gradepercentage,
            'description': self.description,
            'embedded': self.embedded,
            'problems': self.problems,
            'downloadurl': self.downloadurl,
            'canvaspreviewurl': self.canvaspreviewurl,
            'filechildren': self.filechildren,
            'lookingfor': self.lookingfor,
            'submissionTypes': self.submissionTypes,
            'submissionLinks': self.submissionLinks,
            'submissionDependencies': self.submissionDependencies,
            'conceptRequirements': self.conceptRequirements,
        }
        if self.canvasAssignmentId:
            payload['canvasAssignmentId'] = self.canvasAssignmentId
        return payload


class eventNode():
    def __init__(self, name='No name', startdate='', enddate='', gradepercentage='', description='', eventtype='', dependencies=None):
        self.name = name
        self.eventid = name + 'eventid'
        self.startdate = normalize_event_date(startdate)
        self.enddate = normalize_event_date(enddate)
        self.gradepercentage = normalize_gradepercentage(gradepercentage)
        self.description = html_to_text(description)
        self.type = normalize_event_type(eventtype, name)
        self.dependencies = dependencies or []
        self.coveredConcepts = []
        self.embedded = {}

    def update(self, startdate=None, enddate=None, gradepercentage=None, description=None, eventtype=None, dependencies=None):
        changed_embedding_text = False
        if startdate:
            normalized_start = normalize_event_date(startdate)
            if normalized_start:
                self.startdate = normalized_start
        if enddate:
            normalized_end = normalize_event_date(enddate)
            if normalized_end:
                self.enddate = normalized_end
        normalized_gradepercentage = normalize_gradepercentage(gradepercentage)
        if normalized_gradepercentage is not None:
            self.gradepercentage = normalized_gradepercentage
        if description:
            self.description = html_to_text(description)
            changed_embedding_text = True
        if eventtype:
            self.type = normalize_event_type(eventtype, self.name)
            changed_embedding_text = True
        if dependencies:
            for dependency in dependencies:
                if dependency not in self.dependencies:
                    self.dependencies.append(dependency)
                    changed_embedding_text = True
        if changed_embedding_text:
            self.embedded = {}

    def to_dict(self):
        return {
            'name': self.name,
            'eventid': self.eventid,
            'startdate': self.startdate,
            'enddate': self.enddate,
            'gradepercentage': self.gradepercentage,
            'description': self.description,
            'type': self.type,
            'embedded': self.embedded,
            'dependencies': self.dependencies,
            'coveredConcepts': self.coveredConcepts
        }


class syllabusNode():
    def __init__(self, courseid='No courseid', classtimes='', assignments=None, other='', filechildren=None, downloadurl='', canvaspreviewurl='', participationgrade=None):
        self.courseid = courseid
        self.classtimes = classtimes
        self.assignments = assignments or []
        self.other = other
        self.filechildren = filechildren or []
        self.downloadurl = downloadurl
        self.canvaspreviewurl = canvaspreviewurl
        self.participationgrade = normalize_gradepercentage(participationgrade)
        self.embedded = {}

    def to_dict(self):
        return {
            'courseid': self.courseid,
            'classtimes': self.classtimes,
            'assignments': [assignment.to_dict() for assignment in self.assignments],
            'other': self.other,
            'filechildren': self.filechildren,
            'downloadurl': self.downloadurl,
            'canvaspreviewurl': self.canvaspreviewurl,
            'embedded': self.embedded,
            'participationgrade': self.participationgrade
        }


class learningBlock():
    def __init__(self, block_id='', courseid='', order=0, concept_id='', explanation='', detail_refs=None, examples=None, practice_problems=None, source_refs=None, order_source='merged'):
        self.blockId = block_id
        self.courseid = courseid
        self.order = order
        self.conceptId = concept_id
        self.explanation = explanation
        self.detailRefs = detail_refs or []
        self.examples = examples or []
        self.practiceProblems = practice_problems or []
        self.sourceRefs = source_refs or []
        self.orderSource = order_source

    def to_dict(self):
        return {
            'blockId': self.blockId,
            'courseid': self.courseid,
            'order': self.order,
            'conceptId': self.conceptId,
            'explanation': self.explanation,
            'detailRefs': self.detailRefs,
            'examples': self.examples,
            'practiceProblems': self.practiceProblems,
            'sourceRefs': self.sourceRefs,
            'orderSource': self.orderSource,
        }


DEEPSEEK_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_all_assignment_names",
            "description": "Return all known Canvas assignment names with their assignment IDs, course IDs, and current indicators.",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_assignmentid_by_name",
            "description": "Find Canvas assignment IDs by assignment name. Uses exact case-insensitive matching first, then substring matching.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The assignment name or partial assignment name to search for."
                    }
                },
                "required": ["name"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "change_assignment_indicator",
            "description": "Change an assignment's sortable date indicator. Indicator can be a Canvas UTC date string like 2025-12-06T04:59:00Z or a numeric indicator.",
            "parameters": {
                "type": "object",
                "properties": {
                    "assignmentid": {
                        "type": "integer",
                        "description": "The Canvas assignment ID."
                    },
                    "indicator": {
                        "description": "A Canvas UTC date string or numeric transformed indicator.",
                        "anyOf": [
                            {"type": "string"},
                            {"type": "number"},
                            {"type": "integer"}
                        ]
                    }
                },
                "required": ["assignmentid", "indicator"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_concept_node",
            "description": "Add a top-level teaching concept: section heading, lecture topic, or chapter theme only. "
            "Do NOT use for definitions, mechanisms, bullet explanations, or facts — those belong in log_detail. "
            "The parser will attach the current course ID automatically.",
            "parameters": {
                "type": "object",
                "properties": {
                    "conceptname": {
                        "type": "string",
                        "description": "Short name of the concept, topic, person, place, reading, assignment, exam, resource, or policy."
                    },
                    "description": {
                        "type": "string",
                        "description": "A concise description of why this concept matters in the course."
                    },
                    "pageid": {
                        "type": "string",
                        "description": "Optional page id from the [[PAGE ... | pageid=...]] header where this concept appears."
                    }
                },
                "required": ["conceptname", "description"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_syllabus",
            "description": "Create the syllabus node for the current course. Include class times, syllabus-level assignments, and other important syllabus information. The parser will attach the current course ID automatically.",
            "parameters": {
                "type": "object",
                "properties": {
                    "classtimes": {
                        "type": "string",
                        "description": "Class meeting times, locations, lab/precept times, office hours, or schedule information. Use an empty string if not found."
                    },
                    "assignments": {
                        "type": "array",
                        "description": "Assignments listed in the syllabus. Fields may be blank when not found.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "unlockdate": {"type": "string"},
                                "duedate": {"type": "string"},
                                "gradepercentage": {
                                    "type": "number",
                                    "minimum": 1,
                                    "maximum": 100,
                                    "description": "Numeric grade percentage from 1 to 100. Omit when not found."
                                },
                                "description": {"type": "string"}
                            },
                            "required": ["name"],
                            "additionalProperties": False
                        }
                    },
                    "filechildren": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "File node IDs that belong under this syllabus. Usually leave empty; the current file will be attached automatically."
                    },
                    "other": {
                        "type": "string",
                        "description": "Other syllabus information such as grading policy, course policies, instructor info, materials, exams, or course overview."
                    },
                    "participationgrade": {
                        "type": "number",
                        "minimum": 1,
                        "maximum": 100,
                        "description": "Numeric participation grade percentage from 1 to 100. Omit when not found."
                    }
                },
                "required": ["classtimes", "assignments", "other"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_file_node",
            "description": "Create the file node for the current learning/content file. The parser will attach the current course ID, file ID, download URL, and Canvas preview URL automatically.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "Human-readable file name or title."
                    },
                    "filetype": {
                        "type": "string",
                        "description": "File category: content, study_material, syllabus, or assignment. Use study_material for past exams, review sheets, practice tests, solutions, and exam prep PDFs."
                    }
                },
                "required": ["filename"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_detail_node",
            "description": "Add a supporting detail or subsection under an existing concept node. Use for definitions, mechanisms, bullet explanations, and section notes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "conceptNodeId": {
                        "type": "string",
                        "description": "The ID of the concept node this detail belongs to."
                    },
                    "detailname": {
                        "type": "string",
                        "description": "Short name of the detail."
                    },
                    "description": {
                        "type": "string",
                        "description": "Concise explanation of the detail and how it supports the parent concept."
                    },
                    "pageid": {
                        "type": "string",
                        "description": "Optional page id from the [[PAGE ... | pageid=...]] header where this detail appears."
                    }
                },
                "required": ["conceptNodeId", "detailname", "description"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_example_node",
            "description": "Add an example under an existing concept node. The parser will attach the current course ID automatically.",
            "parameters": {
                "type": "object",
                "properties": {
                    "conceptNodeId": {
                        "type": "string",
                        "description": "The ID of the concept node this example belongs to."
                    },
                    "examplename": {
                        "type": "string",
                        "description": "Short name of the example."
                    },
                    "description": {
                        "type": "string",
                        "description": "Concise explanation of the example and how it illustrates the parent concept."
                    },
                    "pageid": {
                        "type": "string",
                        "description": "Optional page id from the [[PAGE ... | pageid=...]] header where this example appears."
                    }
                },
                "required": ["conceptNodeId", "examplename", "description"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_problem_node",
            "description": "Add a practice or worked problem connected to one or more concepts. The parser will attach the current course ID automatically.",
            "parameters": {
                "type": "object",
                "properties": {
                    "problemname": {
                        "type": "string",
                        "description": "Short name or title of the problem."
                    },
                    "concepts": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Deprecated fallback: concept node IDs that this problem tests."
                    },
                    "incomingConceptNodeIds": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Concept node IDs that should point into this problem because the problem depends on or tests those concepts."
                    },
                    "outgoingConceptNodeIds": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Concept node IDs this problem should point out to, such as concepts explained, reinforced, or reached by solving it."
                    },
                    "steps": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Ordered solution steps or reasoning steps."
                    },
                    "answer": {
                        "type": "string",
                        "description": "Final answer or expected result."
                    },
                    "assignmentNodeIds": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Assignment node IDs this problem belongs to, if known."
                    },
                    "pageid": {
                        "type": "string",
                        "description": "Optional page id from the [[PAGE ... | pageid=...]] header where this problem appears."
                    }
                },
                "required": ["problemname", "steps", "answer"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "log_example",
            "description": "Logs a worked example or illustration for a concept before concept node IDs are known.",
            "parameters": {
                "type": "object",
                "properties": {
                    "conceptname": {
                        "type": "string",
                        "description": "The name of the concept this example belongs to."
                    },
                    "examplename": {
                        "type": "string",
                        "description": "A short title for the example."
                    },
                    "description": {
                        "type": "string",
                        "description": "The example content and how it illustrates the concept."
                    }
                },
                "required": ["conceptname", "examplename", "description"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "log_problem",
            "description": "Logs an exercise, homework problem, or practice question before concept node IDs are known.",
            "parameters": {
                "type": "object",
                "properties": {
                    "problemname": {
                        "type": "string",
                        "description": "Short name or title of the problem."
                    },
                    "incomingConceptNames": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Concept names that should point into this problem because the problem depends on or tests them."
                    },
                    "outgoingConceptNames": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Concept names this problem points out to, such as concepts reinforced or reached by solving it."
                    },
                    "steps": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Ordered solution steps or reasoning steps."
                    },
                    "answer": {
                        "type": "string",
                        "description": "Final answer or expected result."
                    }
                },
                "required": ["problemname", "incomingConceptNames", "outgoingConceptNames", "steps", "answer"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "log_detail",
            "description": "Log a definition, mechanism, process step, or substantive bullet that explains a parent concept (pass 1). "
            "Use a distinct detailname; description must contain actual teaching prose from the file, not repeat the concept title.",
            "parameters": {
            "type": "object",
            "properties": {
                "conceptname": {
                "type": "string",
                "description": "The name of the concept this detail belongs to."
                },
                "detailname": {
                "type": "string",
                "description": "A short title for the detail being logged."
                },
                "description": {
                "type": "string",
                "description": "A detailed explanation or description of the concept detail."
                }
            },
            "required": [
                "conceptname",
                "detailname",
                "description"
            ],
            "additionalProperties": False
        }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_assignment_node",
            "description": "Create or update the real assignment node for the current course. Use this when parsing an assignment document or assignment-specific Canvas assignment page.",
            "parameters": {
                "type": "object",
                "properties": {
                    "assignmentname": {
                        "type": "string",
                        "description": "Assignment name or closest matching syllabus assignment name."
                    },
                    "unlockdate": {
                        "type": "string",
                        "description": "Unlock/open date if found, otherwise blank."
                    },
                    "duedate": {
                        "type": "string",
                        "description": "Due date if found, otherwise blank."
                    },
                    "gradepercentage": {
                        "type": "number",
                        "minimum": 1,
                        "maximum": 100,
                        "description": "Numeric grade percentage from 1 to 100. Omit when not found."
                    },
                    "description": {
                        "type": "string",
                        "description": "Assignment instructions or description."
                    },
                    "problemnames": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Problem names from this assignment file that should attach to the assignment object."
                    },
                    "filechildren": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Known file node IDs this assignment instructs the student to use."
                    },
                    "lookingfor": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "File names, readings, PDFs, slides, prompts, rubrics, or resources the assignment says to use when the file ID is not known."
                    }
                },
                "required": ["assignmentname"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "log_assignment",
            "description": "Fallback scratch log for assignment information when you cannot confidently create a real assignment node. Prefer add_assignment_node for Canvas assignment pages and assignment documents.",
            "parameters": {
                "type": "object",
                "properties": {
                    "assignmentname": {
                        "type": "string",
                        "description": "Assignment name or closest matching syllabus assignment name."
                    },
                    "unlockdate": {
                        "type": "string",
                        "description": "Unlock/open date if found, otherwise blank."
                    },
                    "duedate": {
                        "type": "string",
                        "description": "Due date if found, otherwise blank."
                    },
                    "gradepercentage": {
                        "type": "number",
                        "minimum": 1,
                        "maximum": 100,
                        "description": "Numeric grade percentage from 1 to 100. Omit when not found."
                    },
                    "description": {
                        "type": "string",
                        "description": "Assignment instructions or description."
                    },
                    "problemnames": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Problem names from this assignment file that should attach to the assignment object."
                    },
                    "filechildren": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Known file node IDs this assignment instructs the student to use."
                    },
                    "lookingfor": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "File names, readings, PDFs, slides, prompts, rubrics, or resources the assignment says to use when the file ID is not known."
                    }
                },
                "required": ["assignmentname"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_assignment_node",
            "description": "Update an assignment node created from the syllabus using information from a logged assignment file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "assignmentNodeId": {
                        "type": "string",
                        "description": "The assignment node ID to update."
                    },
                    "assignmentname": {
                        "type": "string",
                        "description": "Fallback assignment name to match if the node ID is not known."
                    },
                    "unlockdate": {"type": "string"},
                    "duedate": {"type": "string"},
                    "gradepercentage": {
                        "type": "number",
                        "minimum": 1,
                        "maximum": 100,
                        "description": "Numeric grade percentage from 1 to 100. Omit when not found."
                    },
                    "description": {"type": "string"},
                    "problemids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Problem IDs to attach to the assignment."
                    },
                    "filechildren": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Known file node IDs this assignment instructs the student to use."
                    },
                    "lookingfor": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "File names, readings, PDFs, slides, prompts, rubrics, or resources the assignment says to use when the file ID is not known."
                    }
                },
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_event_node",
            "description": "Create or update a course event such as an exam, class meeting, review session, deadline window, presentation, office hour, or course milestone.",
            "parameters": {
                "type": "object",
                "properties": {
                    "eventname": {
                        "type": "string",
                        "description": "Short name of the event."
                    },
                    "startdate": {
                        "type": "string",
                        "description": "Start date/time if found, otherwise blank."
                    },
                    "enddate": {
                        "type": "string",
                        "description": "End date/time if found, otherwise blank."
                    },
                    "gradepercentage": {
                        "type": "number",
                        "minimum": 1,
                        "maximum": 100,
                        "description": "Numeric grade percentage from 1 to 100 if this event affects grading. Omit when not found."
                    },
                    "description": {
                        "type": "string",
                        "description": "Event details, instructions, location, or notes."
                    },
                    "type": {
                        "type": "string",
                        "description": "Event category, such as exam, quiz, lecture, office hours, deadline, presentation, lab, review, or other."
                    }
                },
                "required": ["eventname"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_exam_node",
            "description": "Create or update an exam, test, quiz, midterm, or final event. This always creates an event node with type test and a dependencies list of concept node IDs or concept names covered by the test.",
            "parameters": {
                "type": "object",
                "properties": {
                    "examname": {
                        "type": "string",
                        "description": "Short name of the exam."
                    },
                    "startdate": {
                        "type": "string",
                        "description": "Exam start date/time if found, otherwise blank."
                    },
                    "enddate": {
                        "type": "string",
                        "description": "Exam end date/time if found, otherwise blank."
                    },
                    "gradepercentage": {
                        "type": "number",
                        "minimum": 1,
                        "maximum": 100,
                        "description": "Numeric grade percentage from 1 to 100 if found. Omit when not found."
                    },
                    "description": {
                        "type": "string",
                        "description": "Exam details, coverage, format, location, rules, or notes."
                    },
                    "dependencies": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Concept node IDs or concept names that this exam depends on or covers."
                    }
                },
                "required": ["examname", "dependencies"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "log_event",
            "description": "Fallback scratch log for event information when you cannot confidently create a real event node. Prefer add_event_node for clear course events.",
            "parameters": {
                "type": "object",
                "properties": {
                    "eventname": {
                        "type": "string",
                        "description": "Short name of the event."
                    },
                    "startdate": {"type": "string"},
                    "enddate": {"type": "string"},
                    "gradepercentage": {
                        "type": "number",
                        "minimum": 1,
                        "maximum": 100,
                        "description": "Numeric grade percentage from 1 to 100 if this event affects grading. Omit when not found."
                    },
                    "description": {"type": "string"},
                    "type": {
                        "type": "string",
                        "description": "Event category, such as exam, quiz, lecture, office hours, deadline, presentation, lab, review, or other."
                    }
                },
                "required": ["eventname"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_event_node",
            "description": "Update an existing event node using its event ID or event name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "eventNodeId": {
                        "type": "string",
                        "description": "The event node ID to update."
                    },
                    "eventname": {
                        "type": "string",
                        "description": "Fallback event name to match if the node ID is not known."
                    },
                    "startdate": {"type": "string"},
                    "enddate": {"type": "string"},
                    "gradepercentage": {
                        "type": "number",
                        "minimum": 1,
                        "maximum": 100,
                        "description": "Numeric grade percentage from 1 to 100 if this event affects grading. Omit when not found."
                    },
                    "description": {"type": "string"},
                    "type": {"type": "string"},
                    "dependencies": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Concept node IDs or concept names this event depends on or covers."
                    }
                },
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "link_file_to_event",
            "description": "Link a study material file to a course event. Creates a directional edge from the event to the file. Use for past midterms, review sheets, practice exams, and solutions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "eventNodeId": {
                        "type": "string",
                        "description": "The event node ID to link from."
                    },
                    "eventname": {
                        "type": "string",
                        "description": "Fallback event name such as Midterm or Final when the node ID is not known."
                    },
                    "fileid": {
                        "type": "string",
                        "description": "The file node ID to link to."
                    },
                    "filetype": {
                        "type": "string",
                        "description": "Optional file type override, usually study_material."
                    }
                },
                "required": ["fileid"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "log_external_resource",
            "description": "Call this when an assignment, file, or syllabus mentions an outside course resource that is not a Canvas file/node, such as a public course website, textbook, publisher platform, code repository, dataset, class tool, article, video playlist, or third-party link associated with the course.",
            "parameters": {
                "type": "object",
                "properties": {
                    "courseid": {
                        "type": "string",
                        "description": "The unique identifier of the course."
                    },
                    "name": {
                        "type": "string",
                        "description": "The display name of the external resource."
                    },
                    "type": {
                        "type": "string",
                        "description": "The type/category of the external resource. Use 'course website' for a public class site that should be fully crawled. Use 'file' for a direct document/PDF/slides link. Use other types such as 'resource', 'textbook', 'tool', 'repository', 'dataset', 'article', or 'video' for single-page parsing."
                    },
                    "url": {
                        "type": "string",
                        "description": "The URL of the external resource if provided.",
                        "default": ""
                    }
                },
                "required": ["courseid", "name", "type"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "log_concept_prerequisite",
            "description": "Record that one concept should be understood before another concept.",
            "parameters": {
                "type": "object",
                "properties": {
                    "fromConceptId": {"type": "string", "description": "Prerequisite concept ID or name."},
                    "toConceptId": {"type": "string", "description": "Dependent concept ID or name."},
                    "rationale": {"type": "string", "description": "Why this prerequisite exists."}
                },
                "required": ["fromConceptId", "toConceptId"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_concept_prerequisite_edge",
            "description": "Link two existing concept nodes with a prerequisite edge.",
            "parameters": {
                "type": "object",
                "properties": {
                    "fromConceptId": {"type": "string"},
                    "toConceptId": {"type": "string"}
                },
                "required": ["fromConceptId", "toConceptId"],
                "additionalProperties": False
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_learning_block",
            "description": "Create a sequential learning block for a concept with explanation, examples, and practice problems.",
            "parameters": {
                "type": "object",
                "properties": {
                    "conceptNodeId": {"type": "string"},
                    "explanation": {"type": "string"},
                    "detailRefs": {"type": "array", "items": {"type": "string"}},
                    "exampleRefs": {"type": "array", "items": {"type": "string"}},
                    "practiceProblemIds": {"type": "array", "items": {"type": "string"}},
                    "order": {"type": "integer"}
                },
                "required": ["conceptNodeId"],
                "additionalProperties": False
            }
        }
    }
]


DEEPSEEK_TOOLS_BY_NAME = {
    tool["function"]["name"]: tool
    for tool in DEEPSEEK_TOOLS
}

DEEPSEEK_PASS1_TOOL_NAMES = (
    "get_all_assignment_names",
    "get_assignmentid_by_name",
    "add_concept_node",
    "add_syllabus",
    "add_file_node",
    "add_assignment_node",
    "add_event_node",
    "add_exam_node",
    "log_detail",
    "log_example",
    "log_problem",
    "log_assignment",
    "log_event",
    "log_external_resource",
    "log_concept_prerequisite",
)

DEEPSEEK_PASS2_TOOL_NAMES = (
    "get_all_assignment_names",
    "get_assignmentid_by_name",
    "add_event_node",
    "add_exam_node",
    "add_detail_node",
    "add_example_node",
    "add_problem_node",
    "update_assignment_node",
    "update_event_node",
    "link_file_to_event",
    "add_concept_prerequisite_edge",
    "add_learning_block",
)

DEEPSEEK_FINAL_PASS_TOOL_NAMES = (
    "get_all_assignment_names",
    "get_assignmentid_by_name",
    "update_assignment_node",
    "add_event_node",
    "add_exam_node",
    "update_event_node",
    "link_file_to_event",
)


def deepseek_tools_for_pass(pass_index, final_pass=False, profile=None):
    if final_pass:
        names = DEEPSEEK_FINAL_PASS_TOOL_NAMES
    elif pass_index == 0:
        if profile is not None:
            names = pass1_tool_names_for_profile(profile)
        else:
            names = DEEPSEEK_PASS1_TOOL_NAMES
    else:
        names = DEEPSEEK_PASS2_TOOL_NAMES
    tools = [DEEPSEEK_TOOLS_BY_NAME[name] for name in names if name in DEEPSEEK_TOOLS_BY_NAME]
    if pass_index == 0 and profile is not None:
        existing = {tool['function']['name'] for tool in tools}
        for tool in type_specific_tools_for_type(profile.type_id):
            tool_name = tool['function']['name']
            if tool_name not in existing:
                tools.append(tool)
                existing.add(tool_name)
    return tools


PASS2_USER_MESSAGE = (
    "Second pass: link logged details, examples, problems, assignments, and events to concept IDs "
    "using add_detail_node, add_example_node, add_problem_node, update_assignment_node, update_event_node, "
    "add_event_node, add_exam_node, and link_file_to_event. Promote any logged events into real event nodes."
)

FINAL_PASS2_USER_MESSAGE = (
    "Second pass: verify assignment grade percentages, reconcile the exam calendar, merge duplicate test events, "
    "and link study material files to events using update_assignment_node, add_exam_node, add_event_node, "
    "update_event_node, and link_file_to_event."
)

FINAL_PASS_TOOL_NUDGE = (
    "Respond with tool calls only. Date every undated test event from the syllabus text using "
    "update_event_node or add_exam_node. You may chain lookup tools and updates in this session."
)

EVENT_LOGGING_EXAMPLES = (
    "Event logging examples:\n"
    "1) Syllabus says 'Midterm: March 10, 2025, 25%' -> add_exam_node(examname='Midterm', startdate='March 10, 2025', gradepercentage=25, dependencies=[]).\n"
    "2) Syllabus lists 'Final Exam: May 12, 2025' -> add_exam_node(examname='Final', startdate='May 12, 2025', dependencies=[]).\n"
    "3) File Midterm_F2011.pdf -> add_file_node(filename='Midterm_F2011.pdf', filetype='study_material') and link_file_to_event(eventname='Midterm', fileid=<current file id>).\n"
    "4) File MidtermReviewSessionQuestions-Fall2025.pdf -> add_file_node(..., filetype='study_material') and link_file_to_event(eventname='Midterm', fileid=<current file id>).\n"
    "5) Lecture notes mention midterm covers chapters 1-5 with no date -> log_event(eventname='Midterm', type='test').\n"
    "6) Do not use log_event for syllabus exams when a date is present; always use add_exam_node with startdate.\n"
    "7) Never call add_exam_node for a syllabus exam without startdate when the syllabus shows a date.\n"
    "8) Midterm Review Session on March 8, 2025 -> add_event_node(eventname='Midterm Review Session', type='review', startdate='March 8, 2025').\n"
)

TEACHING_BLOCK_INSTRUCTIONS = (
    "Teaching-block extraction rules for learning/content files (lecture slides, handouts, textbook sections, exercise sheets, readings):\n"
    "CONCEPT vs DETAIL (mandatory):\n"
    "- CONCEPT (add_concept_node): one per major section, lecture topic, chapter, or slide-title theme. "
    "Short canonical name only (e.g. '2.3 Matrix Products', 'Retinal Ganglion Cells', 'week 4 lectures'). "
    "Never put mechanism prose, definitions, or bullet lists in add_concept_node.\n"
    "- DETAIL (log_detail in pass 1): every definition, mechanism, pathway step, numbered bullet, or fact that explains a concept. "
    "detailname = short label; description = 1-3 sentences of actual teaching content from the file (not the concept title repeated).\n"
    "- EXAMPLE (log_example): worked demonstrations tied to a parent conceptname.\n"
    "- PROBLEM (log_problem): exercises, questions, drills tied to prerequisite concept names.\n"
    "1) Always call add_file_node first with filetype=content unless this is clearly study_material.\n"
    "2) Map document structure to tools: chapter/section/week/lecture headings -> add_concept_node; "
    "subsections, definitions, mechanisms, key facts -> log_detail; worked examples -> log_example; "
    "exercises/questions/practice problems -> log_problem.\n"
    "3) Extract every visible teaching unit from the file, page by page. Do not stop after the first concept. "
    "Each substantive concept should have at least one log_detail with real content from the file.\n"
    "4) For log_detail and log_example include the parent conceptname and a concise description with the actual teaching content from the file (not just a label).\n"
    "5) For log_problem include incomingConceptNames (prerequisites), outgoingConceptNames (skills reinforced), ordered steps, and the final answer when present in the file.\n"
    "6) Include pageid from the [[PAGE ...]] header on every teaching tool call so nodes stay page-anchored.\n"
    "7) When a structured teaching outline is provided below the file text, treat it as a checklist and ensure each listed section, concept, example, and problem is captured.\n"
    "8) Prefer short canonical names that preserve section numbers (for example '2.3 Matrix Products', 'Problem 4', 'Example: Storage Allocator').\n"
    "9) Preserve document order: extract concepts in the sequence they appear (top-to-bottom, page-by-page). When a later section clearly builds on an earlier one in the same file, call add_concept_prerequisite_edge from the earlier concept to the later concept.\n"
    "10) Use lecture/week/chapter numbers from headings as sequencing hints. Only add prerequisite edges when the dependency is explicit or the numbering is monotonic within the same file.\n"
)

DEEPSEEK_PASS1_STATIC_SYSTEM = (
    "You are a class secretary. You will be given JSON objects, text, and pictures. Your job is to identify object type and due date. First identify if the object is either 1: assignment file 2: learning/content file or 3: the course syllabus. "
    "If the item is a class syllabus, call add_syllabus and create syllabus assignment objects from any assignment list. Also call add_exam_node for exams, tests, quizzes, midterms, and finals; these must be stored as event type test with canonical names such as Midterm or Final. When the syllabus lists an exam date, you must pass it as startdate on add_exam_node or add_event_node; do not rely on add_syllabus alone to carry exam dates. Use add_event_node for lectures, office hours, review sessions, presentations, labs, deadline windows, or other dated course events. Test dependencies should list concept node IDs or concept names covered by the test. If the object is an assignment file, call add_assignment_node to create or update the real assignment tracker and call log_problem for any assignment-level problems. If an assignment instructs the student to use another file, reading, prompt, rubric, worksheet, slide deck, notebook, article, PDF, or document, put known file IDs in filechildren; if the file ID is not known, put the referenced resource names in lookingfor. Also call log_external_resource for every outside course resource that is not a Canvas file/node, including public class websites, textbook titles or textbook sites, publisher homework systems, code repositories, datasets, external APIs, library reserves/articles, online judges, discussion tools, video playlists, and third-party platforms. Log it even when there is no URL; use a short resource type such as website, textbook, tool, repository, dataset, article, video, or publisher. If the item is a learning/content file, first call add_file_node with filetype=content unless the file is a past exam, review sheet, practice test, or solution PDF, in which case use filetype=study_material and link_file_to_event to connect it directionally from the matching event to the file. "
    + TEACHING_BLOCK_INSTRUCTIONS
    + "Then extract concepts, details, examples, and problems using add_concept_node, log_detail, log_example, and log_problem. A second pass will link logged items to concept IDs; use log_* tools for anything that needs IDs later. Problems should have incoming pointers from multiple concepts and outgoing pointers to concepts. The current file URLs are attached automatically to whichever syllabus, file, or assignment object is created. \n"
    + EVENT_LOGGING_EXAMPLES
    + "\nYou will only see this file text on the first pass. Put details, examples, problems, assignments, and events that need concept IDs into log_detail, log_example, log_problem, log_assignment, and log_event tool calls. Do not put extracted content in free text. "
    "Each page is delimited by [[PAGE N | pageid=... | yScroll=... | yScrollRatio=...]] headers. When creating nodes, include that pageid in tool arguments as pageid. "
    "Do not use markdown formatting, utf-8 only. Do not give any text response that is not a tool call."
)

DEEPSEEK_PASS2_STATIC_SYSTEM = (
    "This is the second pass linking pass. The source file text is not included in this conversation. "
    "Use concept IDs from current concepts and the logged sections below to call "
    "add_detail_node, add_example_node, add_problem_node, update_assignment_node, update_event_node, "
    "add_event_node, add_exam_node, and link_file_to_event. Promote logged events into real event nodes. "
    "For teaching blocks, link every logged_detail, logged_example, and logged_problem to the best matching concept ID "
    "using add_detail_node / add_example_node / add_problem_node (do not skip details). "
    "If typeExtractions or log_lecture_slide rows exist but logged_details is empty, create add_detail_node rows "
    "from slide summaries under the matching concept. "
    "Create add_learning_block rows when a concept has explanation plus examples or practice problems from the same file. "
    "Do not use markdown formatting, utf-8 only. "
    "Do not give any text response that is not a tool call."
)


def build_pass1_dynamic_user_prefix(courseid, filemeta):
    cid = normalize_courseid(courseid)
    type_line = ''
    academic_type = str(filemeta.get('academicFileType') or '').strip()
    if academic_type:
        type_line = (
            f"Classified academic file type: {academic_type} "
            f"(confidence {filemeta.get('academicFileTypeConfidence', 0)}). "
            f"Follow the FILE TYPE block in the system prompt.\n"
        )
    return (
        type_line
        + f"Course id: {cid}\n"
        f"Current classified assignments and files ordered by date: "
        f"{json.dumps(current_assignment_files_groups, ensure_ascii=False)}\n"
        f"Current file metadata: {json.dumps(filemeta_for_prompt(filemeta), ensure_ascii=False)}\n"
        f"Class syllabus if found: {allsyllabi.get(cid, 'Not found')}\n"
    )


def logged_items_for_file(courseid, fileid, items):
    fileid = str(fileid or '')
    return [
        item for item in (items or [])
        if str(item.get('sourceFileId') or '') == fileid
    ]


def clear_teaching_logged_items_for_file(courseid, fileid):
    cid = normalize_courseid(courseid)
    fileid = str(fileid or '')
    for store in (logged_details, logged_examples, logged_problems, logged_assignments):
        bucket = store.get(cid)
        if not bucket:
            continue
        store[cid] = [
            item for item in bucket
            if str(item.get('sourceFileId') or '') != fileid
        ]


def clear_logged_events_for_file(courseid, fileid):
    cid = normalize_courseid(courseid)
    fileid = str(fileid or '')
    bucket = logged_events.get(cid)
    if not bucket:
        return
    logged_events[cid] = [
        item for item in bucket
        if str(item.get('sourceFileId') or '') != fileid
    ]


def clear_logged_items_for_file(courseid, fileid):
    clear_teaching_logged_items_for_file(courseid, fileid)
    clear_logged_events_for_file(courseid, fileid)


def get_syllabus_assignments_for_prompt(courseid):
    syllabus = get_syllabus_for_course(courseid)
    if not syllabus:
        return []
    return [
        {
            'name': assignment.name,
            'assignmentid': assignment.assignmentid,
            'assignmentNodeId': assignment.assignmentid,
            'unlockdate': assignment.unlockdate,
            'duedate': assignment.duedate,
            'gradepercentage': assignment.gradepercentage,
        }
        for assignment in syllabus.assignments
    ]


def get_undated_events_for_prompt(courseid):
    return [
        {
            'eventid': event.eventid,
            'name': event.name,
            'type': event.type,
            'description': event.description,
            'gradepercentage': event.gradepercentage,
        }
        for event in eventNodes.get(courseid, [])
        if event_needs_date(event)
    ]


def get_study_material_files_for_prompt(courseid):
    cid = normalize_courseid(courseid)
    files = []
    for file_node in (fileNodes.get(cid, {}) or {}).values():
        classification = classify_study_material_filename(file_node.name, file_node.type)
        if classification or file_node.type == 'study_material':
            files.append({
                'fileid': file_node.fileid,
                'name': file_node.name,
                'type': file_node.type or (classification or {}).get('filetype', ''),
                'target_event': (classification or {}).get('target_event', ''),
            })
    return files


def build_deepseek_system_content(base_systemprompt, courseid, filemeta, final_pass=False, pass_index=0):
    cid = normalize_courseid(courseid)
    fileid = make_fileid(filemeta or {})
    if final_pass:
        return (
            base_systemprompt
            + "\ncurrent syllabus node:"
            + json.dumps(get_syllabus_for_prompt(cid), ensure_ascii=False)
            + "\nsyllabus assignments:"
            + json.dumps(get_syllabus_assignments_for_prompt(cid), ensure_ascii=False)
            + "\ncurrent event nodes:"
            + json.dumps(get_events_for_prompt(cid), ensure_ascii=False)
            + "\nundated event nodes needing dates:"
            + json.dumps(get_undated_events_for_prompt(cid), ensure_ascii=False)
            + "\nlogged events:"
            + json.dumps(logged_events.get(cid, []), ensure_ascii=False)
            + "\nstudy material file candidates:"
            + json.dumps(get_study_material_files_for_prompt(cid), ensure_ascii=False)
            + "\ncurrent file node:"
            + json.dumps(file_node_for_prompt(get_or_create_file_node(cid, filemeta)), ensure_ascii=False)
        )

    concepts = get_concepts_for_prompt(cid)
    current_file_node = get_or_create_file_node(cid, filemeta)
    parts = [
        base_systemprompt,
        "\ncurrent concepts: here is a reference of all current concepts along with their ids ",
        json.dumps(concepts, ensure_ascii=False),
    ]
    if pass_index > 0:
        parts.extend([
            "\nlogged details:",
            json.dumps(logged_items_for_file(cid, fileid, logged_details.get(cid, [])), ensure_ascii=False),
            "\nlogged examples:",
            json.dumps(logged_items_for_file(cid, fileid, logged_examples.get(cid, [])), ensure_ascii=False),
            "\nlogged problems:",
            json.dumps(logged_items_for_file(cid, fileid, logged_problems.get(cid, [])), ensure_ascii=False),
            "\nlogged assignments:",
            json.dumps(logged_items_for_file(cid, fileid, logged_assignments.get(cid, [])), ensure_ascii=False),
            "\nlogged events:",
            json.dumps(logged_items_for_file(cid, fileid, logged_events.get(cid, [])), ensure_ascii=False),
        ])
    parts.extend([
        "\ncurrent event nodes:",
        json.dumps(get_events_for_prompt(cid), ensure_ascii=False),
        "\ncurrent syllabus node:",
        json.dumps(get_syllabus_for_prompt(cid), ensure_ascii=False),
        "\nlooking for file requests:",
        json.dumps(looking_for_files.get(cid, []), ensure_ascii=False),
        "\nlogged external resources:",
        json.dumps(externalResources.get(cid, []), ensure_ascii=False),
        "\ncurrent file node:",
        json.dumps(file_node_for_prompt(current_file_node), ensure_ascii=False),
    ])
    return ''.join(parts)


files = {}
externalResources = {}

def serialize_tool_calls(tool_calls):
    return [
        {
            "id": tool_call.id,
            "type": "function",
            "function": {
                "name": tool_call.function.name,
                "arguments": tool_call.function.arguments or "{}"
            }
        }
        for tool_call in tool_calls or []
    ]


def append_assistant_tool_message(api_messages, message):
    payload = {
        "role": "assistant",
        "content": message.content or None,
        "tool_calls": serialize_tool_calls(message.tool_calls),
    }
    reasoning_content = getattr(message, 'reasoning_content', None)
    if reasoning_content:
        payload['reasoning_content'] = reasoning_content
    api_messages.append(payload)


def append_tool_result_messages(api_messages, tool_results):
    for tool_call, result in tool_results:
        api_messages.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": json.dumps(result, ensure_ascii=False),
        })


def execute_deepseek_tool_calls(message, courseid, fileid, filemeta, *, compact_lookup=False):
    executed = []
    for tool_call in message.tool_calls or []:
        function_call = tool_call.function
        arguments = function_call.arguments or "{}"
        try:
            arguments = json.loads(arguments)
        except json.JSONDecodeError:
            arguments = {}

        result = clean_surrogates(minimal_tool_result(
            function_call.name,
            run_tool_call(function_call.name, courseid, arguments, filemeta),
            compact_lookup=compact_lookup,
        ))
        record_parse_tool_call(
            courseid,
            function_call.name,
            arguments,
            result,
            file_label=str((filemeta or {}).get('name') or fileid or ''),
        )
        if function_call.name in EVENT_MUTATION_TOOLS:
            print(
                format_event_tool_line(courseid, fileid, function_call.name, arguments, result),
                flush=True,
            )
        executed.append((tool_call, result))
    return executed


def build_final_pass_undated_continue_message(courseid):
    undated = get_undated_events_for_prompt(courseid)
    if not undated:
        return ''
    return (
        "Remaining undated test events: "
        + json.dumps(undated, ensure_ascii=False)
        + ". Continue with update_event_node or add_exam_node if syllabus dates are known."
    )


def get_concepts_for_prompt(courseid):
    return [
        {'conceptid': node.conceptid, 'name': node.name}
        for node in conceptNodes.get(courseid, [])
    ]


def get_events_for_prompt(courseid):
    return [
        {
            'eventid': event.eventid,
            'name': event.name,
            'type': event.type,
            'startdate': event.startdate,
            'enddate': event.enddate,
            'gradepercentage': event.gradepercentage,
            'dependencies': event.dependencies,
        }
        for event in eventNodes.get(courseid, [])
    ]


def file_node_for_prompt(node):
    if not node:
        return {}
    return {
        'fileid': node.fileid,
        'courseid': node.courseid,
        'name': node.name,
        'type': node.type,
        'downloadurl': node.downloadurl,
        'canvaspreviewurl': node.canvaspreviewurl,
        'concepts': node.concepts,
        'details': node.details,
        'examples': node.examples,
        'problems': node.problems,
        'pages': [
            {
                'pageid': page.get('pageid', ''),
                'pageNumber': page.get('pageNumber', 0)
            }
            for page in (node.pages or [])
            if isinstance(page, dict)
        ],
    }


def find_syllabus_file_for_course(courseid):
    cid = normalize_courseid(courseid)
    syllabus = get_syllabus_for_course(cid)
    if syllabus:
        for fileid in syllabus.filechildren or []:
            file_node = fileNodes.get(cid, {}).get(str(fileid))
            if file_node and file_node.pages:
                return file_node

    course_files = fileNodes.get(cid, {}) or {}
    syllabus_candidates = []
    for file_node in course_files.values():
        if not file_node or not file_node.pages:
            continue
        searchable = ' '.join(
            str(getattr(file_node, field, '') or '')
            for field in ('name', 'fileid', 'searchtext')
        )
        if SYLLABUS_NAME_PATTERN.search(searchable) or str(getattr(file_node, 'fileid', '')).startswith(f'course-syllabus-{cid}'):
            syllabus_candidates.append(file_node)

    if not syllabus_candidates:
        return None

    syllabus_candidates.sort(key=lambda node: len(node.pages or []), reverse=True)
    return syllabus_candidates[0]


def get_syllabus_for_prompt(courseid):
    syllabus = get_syllabus_for_course(courseid)
    if not syllabus:
        return {}
    return {
        'courseid': syllabus.courseid,
        'classtimes': syllabus.classtimes,
        'other': syllabus.other,
        'participationgrade': syllabus.participationgrade,
        'filechildren': syllabus.filechildren,
        'assignments': [
            {
                'name': assignment.name,
                'assignmentid': assignment.assignmentid,
                'unlockdate': assignment.unlockdate,
                'duedate': assignment.duedate,
                'gradepercentage': assignment.gradepercentage,
            }
            for assignment in syllabus.assignments
        ],
    }

def normalize_external_resource_key(name, resource_type, url=''):
    key_parts = [
        normalize_resource_text(url),
        normalize_resource_text(name),
        normalize_resource_text(resource_type)
    ]
    return '|'.join(key_parts)


def log_external_resource(courseid, name, resource_type, url=''):
    name = str(name or '').strip()
    resource_type = str(resource_type or '').strip()
    url = str(url or '').strip()
    if not name and not url:
        return {'added': False, 'reason': 'missing name and url'}

    resource = {
        'courseid': str(courseid),
        'name': name or url,
        'type': resource_type or 'resource',
        'url': url
    }
    key = normalize_external_resource_key(resource['name'], resource['type'], resource['url'])
    externalResources.setdefault(courseid, [])
    for existing in externalResources[courseid]:
        existing_key = normalize_external_resource_key(
            existing.get('name', ''),
            existing.get('type', ''),
            existing.get('url', '')
        )
        if existing_key == key:
            existing.update({field: value for field, value in resource.items() if value})
            return {'added': False, 'resource': existing}

    externalResources[courseid].append(resource)
    return {'added': True, 'resource': resource}


def make_fileid(filemeta):
    return str(filemeta.get('fileid', ''))


def filemeta_for_prompt(filemeta):
    if not isinstance(filemeta, dict):
        return {}
    slim = {
        'fileid': filemeta.get('fileid', ''),
        'courseid': filemeta.get('courseid', ''),
        'name': filemeta.get('name', ''),
        'downloadurl': filemeta.get('downloadurl', ''),
        'canvaspreviewurl': filemeta.get('canvaspreviewurl', ''),
        'yindex': filemeta.get('yindex', ''),
    }
    pages = filemeta.get('pages') or []
    if pages:
        slim['pages'] = [
            {
                'pageid': page.get('pageid', ''),
                'pageNumber': page.get('pageNumber', 0),
            }
            for page in pages
            if isinstance(page, dict)
        ]
    current_page = filemeta.get('currentPage')
    if isinstance(current_page, dict) and current_page.get('pageid'):
        slim['currentPage'] = {'pageid': current_page.get('pageid', '')}
    return slim


# Normalizes the block-level positional text emitted by build_pdf_page_blocks so it
# survives round-tripping through canvas_graph.json. Each block carries absolute
# scroll-space offsets (y0/y1) plus normalized ratios (yRatio0/yRatio1) so the main
# process can slice a page's text down to exactly what is inside the live viewport.
def normalize_page_blocks(blocks, max_blocks=600):
    normalized = []
    if not isinstance(blocks, list):
        return normalized
    for block in blocks:
        if not isinstance(block, dict):
            continue
        text = compact_file_search_text(block.get('text', ''), 600)
        if not text:
            continue
        normalized.append({
            'text': text,
            'x0': float(block.get('x0', 0) or 0),
            'x1': float(block.get('x1', 0) or 0),
            'y0': float(block.get('y0', 0) or 0),
            'y1': float(block.get('y1', 0) or 0),
            'yRatio0': float(block.get('yRatio0', 0) or 0),
            'yRatio1': float(block.get('yRatio1', 0) or 0)
        })
        if len(normalized) >= max_blocks:
            break
    return normalized


def normalize_file_pages(pages, fileid=''):
    normalized = []
    if not isinstance(pages, list):
        return normalized
    for index, page in enumerate(pages):
        if not isinstance(page, dict):
            continue
        page_number = int(page.get('pageNumber') or page.get('page') or index + 1)
        pageid = str(page.get('pageid') or f"{fileid}:page:{page_number}")
        normalized.append({
            'pageid': pageid,
            'pageNumber': page_number,
            'yScroll': float(page.get('yScroll', page.get('y_scroll', 0)) or 0),
            'yScrollRatio': float(page.get('yScrollRatio', page.get('y_scroll_ratio', 0)) or 0),
            'height': float(page.get('height', 0) or 0),
            'width': float(page.get('width', 0) or 0),
            'text': compact_file_search_text(page.get('text', '')),
            'blocks': normalize_page_blocks(page.get('blocks', [])),
            'nodes': page.get('nodes', []) if isinstance(page.get('nodes', []), list) else []
        })
    return normalized


def build_document_pages_from_text(fileid, text):
    return normalize_file_pages(build_raw_document_pages(fileid, text), fileid)


def build_html_body_pages(fileid, title, body_html_or_text):
    body_text = html_to_text(body_html_or_text or '')
    if title:
        body_text = f"{title}\n\n{body_text}".strip()
    return build_document_pages_from_text(fileid, body_text)


def merge_file_pages(existing_pages, incoming_pages):
    return merge_page_records(existing_pages, incoming_pages, normalize_page_blocks)


def local_pdf_path(fileid):
    return folder / str(fileid)


def backfill_file_pages_from_local_pdf(fileid, existing_pages=None):
    path = local_pdf_path(fileid)
    if not path.exists():
        return None
    try:
        fresh_pages = normalize_file_pages(build_pdf_pages(str(path), str(fileid)), str(fileid))
    except Exception as error:
        print(f"parser debug blocks: backfill failed file={fileid} error={error}", flush=True)
        return None
    if not fresh_pages:
        return None
    return merge_file_pages(existing_pages or [], fresh_pages)


def summarize_file_pages_for_embedding(pages, max_chars=2400):
    return summarize_page_blocks(pages, max_chars=max_chars)


def summarize_file_chunks_for_embedding(file_node, max_chars=1200):
    chunks = getattr(file_node, 'textChunks', []) or []
    if not chunks:
        return ''
    parts = []
    chars = 0
    for chunk in chunks[:16]:
        if not isinstance(chunk, dict):
            continue
        text = str(chunk.get('text') or '').strip()
        if not text:
            continue
        snippet = text[:220]
        if chars + len(snippet) + 1 > max_chars:
            break
        parts.append(snippet)
        chars += len(snippet) + 1
    return ' '.join(parts)


def file_node_embedding_description(file_node):
    type_text = type_extraction_search_text(
        getattr(file_node, 'typeExtractions', None) or {},
        max_chars=2000,
    )
    parts = [
        str(getattr(file_node, 'name', '') or ''),
        str(getattr(file_node, 'type', '') or ''),
        str(getattr(file_node, 'academicFileType', '') or ''),
        compact_file_search_text(getattr(file_node, 'searchtext', ''), 800),
        type_text,
        summarize_file_pages_for_embedding(getattr(file_node, 'pages', [])),
        summarize_file_chunks_for_embedding(file_node),
        str(getattr(file_node, 'downloadurl', '') or ''),
        str(getattr(file_node, 'canvaspreviewurl', '') or ''),
    ]
    return compact_file_search_text(' '.join(part for part in parts if part), 3600)


def ensure_file_node_page_blocks(file_node):
    if not file_node or not getattr(file_node, 'fileid', ''):
        return False
    if not pages_missing_positioned_blocks(getattr(file_node, 'pages', [])):
        return False
    refreshed = backfill_file_pages_from_local_pdf(file_node.fileid, file_node.pages)
    if refreshed:
        file_node.pages = refreshed
        return True
    searchtext = compact_file_search_text(getattr(file_node, 'searchtext', ''), 50000)
    if searchtext:
        synthetic_pages = build_document_pages_from_text(file_node.fileid, searchtext)
        if synthetic_pages:
            file_node.pages = merge_file_pages(file_node.pages, synthetic_pages)
            return True
    return False


def ensure_all_file_page_blocks():
    updated = 0
    for course_files in fileNodes.values():
        for file_node in course_files.values():
            if ensure_file_node_page_blocks(file_node):
                updated += 1
    if updated:
        print(f"parser debug blocks: backfilled positioned blocks for {updated} file(s)", flush=True)
    return updated


def refresh_file_node_embedding(file_node):
    if openai_client is None or not file_node:
        return
    ensure_file_node_page_blocks(file_node)
    safe_embed_node(
        file_node,
        embed_named_description,
        course_scoped_embedding_name(file_node.courseid, file_node.name or file_node.fileid),
        file_node_embedding_description(file_node),
        True,
    )


# Extracts positioned text blocks for one PDF page. Each block's bbox is converted
# into absolute scroll-space offsets (y_offset is the running height of all prior
# pages) plus a normalized ratio against the whole document, matching the yScroll /
# yScrollRatio scheme already used for pages. This lets the render-context pipeline
# return exactly the lines inside the live viewport instead of the whole page.
def build_pdf_page_blocks(page, y_offset, total_height, max_blocks=600):
    blocks = []
    try:
        data = page.get_text("dict")
    except Exception:
        return blocks
    total = total_height if total_height else 1.0
    for block in data.get("blocks", []) or []:
        block_type = block.get("type")
        if block_type not in {0, 1}:
            continue
        bbox = block.get("bbox") or [0, 0, 0, 0]
        text_parts = []
        if block_type == 0:
            for line in block.get("lines", []) or []:
                for span in line.get("spans", []) or []:
                    span_text = span.get("text", "")
                    if span_text:
                        text_parts.append(span_text)
            text = re.sub(r'\s+', ' ', ''.join(text_parts)).strip()
            if not text:
                continue
        else:
            ocr_text = ocr_pdf_page_image_block(page, bbox)
            text = ocr_text or '[Figure/image region]'
        try:
            bx0, by0, bx1, by1 = float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])
        except (TypeError, ValueError, IndexError):
            bx0 = by0 = bx1 = by1 = 0.0
        abs_y0 = y_offset + by0
        abs_y1 = y_offset + by1
        blocks.append({
            'text': text,
            'kind': 'image' if block_type == 1 and text == '[Figure/image region]' else 'text',
            'x0': bx0,
            'x1': bx1,
            'y0': abs_y0,
            'y1': abs_y1,
            'yRatio0': abs_y0 / total,
            'yRatio1': abs_y1 / total
        })
        if len(blocks) >= max_blocks:
            break
    return blocks


def build_pdf_pages(filepath, fileid):
    path = Path(filepath)
    root = Path(__file__).resolve().parent
    cached = load_cached_pdf_pages(path, fileid, root=root)
    if cached:
        return normalize_file_pages(cached, fileid)
    pages = []
    doc = fitz.open(filepath)
    try:
        page_sizes = []
        page_handles = []
        for index in range(len(doc)):
            page = doc[index]
            rect = page.rect
            page_handles.append(page)
            page_sizes.append((float(rect.width), float(rect.height)))

        total_height = sum(height for _width, height in page_sizes) or 1.0
        y_offset = 0.0
        for index, page in enumerate(page_handles):
            width, height = page_sizes[index]
            page_number = index + 1
            pages.append({
                'pageid': f"{fileid}:page:{page_number}",
                'pageNumber': page_number,
                'yScroll': y_offset,
                'yScrollRatio': y_offset / total_height,
                'height': height,
                'width': width,
                'text': page.get_text(),
                'blocks': [] if PARSER_SKIP_PDF_BLOCKS else build_pdf_page_blocks(page, y_offset, total_height),
                'nodes': []
            })
            y_offset += height
    finally:
        doc.close()
    pages = normalize_file_pages(pages, fileid)
    store_cached_pdf_pages(path, fileid, pages, root=root)
    return pages


def pages_to_prompt_text(pages):
    if not pages:
        return ''
    chunks = []
    for page in pages:
        chunks.append(
            "\n".join([
                f"[[PAGE {page.get('pageNumber')} | pageid={page.get('pageid')} | yScroll={page.get('yScroll')} | yScrollRatio={page.get('yScrollRatio')}]]",
                page.get('text', '')
            ])
        )
    return "\n\n".join(chunks)


def build_teaching_outline_for_prompt(pages):
    units = extract_teaching_units_from_pages(pages or [])
    return summarize_teaching_units(units)


def build_indexed_chunks_for_prompt(courseid, fileid, pages, filename='', max_chars=6000):
    chunks = build_file_chunk_graph(
        pages or [],
        courseid=str(courseid or ''),
        fileid=str(fileid or ''),
        filename=str(filename or ''),
    )
    return format_chunks_for_grounding(
        chunks,
        title='Indexed source chunks (verbatim excerpts from pass 1; use alongside logged items):',
        max_chars=max_chars,
    )


_weekly_schedule_cache = None


def _load_weekly_schedule():
    global _weekly_schedule_cache
    if _weekly_schedule_cache is not None:
        return _weekly_schedule_cache
    canvas_data_path = DIRNAME / 'canvas_data.json'
    _weekly_schedule_cache = load_weekly_schedule(canvas_data_path if canvas_data_path.exists() else None)
    return _weekly_schedule_cache


def _graph_snapshot_for_indexing(courseid=''):
    cid = normalize_courseid(courseid) if courseid else ''
    concepts = []
    problem_nodes = []
    if cid:
        concepts = [node.to_dict() for node in conceptNodes.get(cid, [])]
        problem_nodes = [
            {**problem.to_dict(), 'courseid': cid}
            for problem in problems.get(cid, []) or []
        ]
        logged_slice = {
            'logged_details': {cid: logged_details.get(cid, [])},
            'logged_examples': {cid: logged_examples.get(cid, [])},
            'logged_problems': {cid: logged_problems.get(cid, [])},
        }
    else:
        for course_id, nodes in conceptNodes.items():
            concepts.extend(node.to_dict() for node in nodes or [])
        for course_id, course_problems in problems.items():
            for problem in course_problems or []:
                problem_nodes.append({**problem.to_dict(), 'courseid': course_id})
        logged_slice = {
            'logged_details': logged_details,
            'logged_examples': logged_examples,
            'logged_problems': logged_problems,
        }
    return {
        'concepts': concepts,
        'problems': problem_nodes,
        **logged_slice,
    }


def _merge_type_extractions_into_searchtext(file_node):
    type_store = getattr(file_node, 'typeExtractions', None) or {}
    if not isinstance(type_store, dict) or not type_store:
        return False
    extraction_text = type_extraction_search_text(type_store, max_chars=8000)
    if not extraction_text:
        return False
    base = compact_file_search_text(getattr(file_node, 'searchtext', ''), 50000)
    academic = str(getattr(file_node, 'academicFileType', '') or '').strip()
    merged = compact_file_search_text(
        '\n'.join(part for part in (base, academic, extraction_text) if part),
        50000,
    )
    if merged == base:
        return False
    file_node.searchtext = merged
    file_node.embedded = {}
    return True


def persist_file_node_text_chunks(file_node, *, courseid=None, graph_snapshot=None, weekly_schedule=None):
    if not file_node or pages_missing_positioned_blocks(getattr(file_node, 'pages', [])):
        return file_node
    cid = str(courseid or getattr(file_node, 'courseid', '') or '')
    fid = str(getattr(file_node, 'fileid', '') or '')
    graph = graph_snapshot if graph_snapshot is not None else _graph_snapshot_for_indexing(cid)
    weekly = weekly_schedule if weekly_schedule is not None else _load_weekly_schedule()
    type_store = getattr(file_node, 'typeExtractions', None) or {}
    if not isinstance(type_store, dict):
        type_store = {}
    _merge_type_extractions_into_searchtext(file_node)
    chunks = build_file_chunk_graph(
        file_node.pages,
        courseid=cid,
        fileid=fid,
        filename=str(getattr(file_node, 'name', '') or ''),
        graph=graph,
        weekly_schedule=weekly,
        type_extractions=type_store,
    )
    payload = {'textChunks': []}
    persist_text_chunks_on_file_node(payload, chunks)
    slim_chunks = payload.get('textChunks', []) or []
    for chunk in slim_chunks:
        if isinstance(chunk, dict):
            chunk.pop('embedded', None)
    file_node.textChunks = slim_chunks
    return file_node


def finalize_file_retrieval_index(file_node, *, courseid=None):
    if not file_node:
        return file_node
    if PARSER_DEFER_FILE_INDEX:
        return file_node
    ensure_file_node_page_blocks(file_node)
    persist_file_node_text_chunks(file_node, courseid=courseid)
    if not PARSER_DEFER_FILE_EMBED:
        refresh_file_node_embedding(file_node)
    return file_node


def collect_file_teaching_names(courseid, fileid):
    names = {
        'section': [],
        'concept': [],
        'example': [],
        'problem': [],
        'detail': [],
    }
    fileid = str(fileid or '')
    for concept in conceptNodes.get(courseid, []) or []:
        if fileid:
            linked = any(
                str(source.get('fileid') or '') == fileid
                for source in (getattr(concept, 'sourcePages', None) or [])
            )
            if not linked:
                continue
        if concept.name:
            names['concept'].append(concept.name)
        for detail in concept.details:
            if detail.name:
                names['section'].append(detail.name)
                names['detail'].append(detail.name)
        for example in concept.examples:
            if example.name:
                names['example'].append(example.name)
    for problem in problems.get(courseid, []) or []:
        if problem.name:
            names['problem'].append(problem.name)
    for item in logged_details.get(courseid, []) or []:
        if str(item.get('sourceFileId') or '') != fileid:
            continue
        if item.get('detailname'):
            names['section'].append(item['detailname'])
            names['detail'].append(item['detailname'])
        if item.get('conceptname'):
            names['concept'].append(item['conceptname'])
    for item in logged_examples.get(courseid, []) or []:
        if str(item.get('sourceFileId') or '') != fileid:
            continue
        if item.get('examplename'):
            names['example'].append(item['examplename'])
        if item.get('conceptname'):
            names['concept'].append(item['conceptname'])
    for item in logged_problems.get(courseid, []) or []:
        if str(item.get('sourceFileId') or '') != fileid:
            continue
        if item.get('problemname'):
            names['problem'].append(item['problemname'])
    return names


def teaching_unit_already_extracted(unit, extracted_names):
    buckets = {
        'section': ('section', 'concept', 'detail'),
        'concept': ('concept', 'section', 'detail'),
        'example': ('example',),
        'problem': ('problem',),
    }.get(unit.get('type'), ())
    for bucket in buckets:
        for name in extracted_names.get(bucket, []):
            if teaching_labels_match(unit.get('name', ''), name):
                return True
    return False


def set_concept_document_order(courseid, concept_ref, unit, sequence_index, filemeta):
    concept = find_concept_by_name_or_id(courseid, concept_ref)
    if not concept:
        return
    fileid = make_fileid(filemeta or {})
    incoming = build_document_order(unit or {}, file_id=fileid, sequence_index=sequence_index)
    concept.documentOrder = merge_document_order(getattr(concept, 'documentOrder', {}), incoming)
    attach_module_hint_from_file(
        courseid,
        concept.conceptid,
        fileid,
        moduleOrderHints.get(courseid, {}),
        record_module_order_hint,
    )


def seed_teaching_blocks_from_outline(courseid, filemeta):
    from canvas_parser.parse.heuristic_concepts import deterministic_preseed_enabled

    if not deterministic_preseed_enabled():
        return 0
    pages = filemeta.get('pages') or []
    units = extract_teaching_units_from_pages(pages)
    if not units:
        return 0
    fileid = make_fileid(filemeta)
    extracted_names = collect_file_teaching_names(courseid, fileid)
    outline_rows = []
    seeded = 0
    for index, unit in enumerate(units):
        if teaching_unit_already_extracted(unit, extracted_names):
            continue
        unit_type = unit.get('type')
        name = str(unit.get('name') or '').strip()
        snippet = str(unit.get('snippet') or name).strip()
        if not name:
            continue
        if unit_type in {'section', 'concept'}:
            concept_id = add_concept_node(courseid, name, snippet)
            extracted_names['concept'].append(name)
            extracted_names['section'].append(name)
            extracted_names['detail'].append(name)
            outline_rows.append({
                'conceptId': concept_id,
                'name': name,
                'documentOrder': build_document_order(unit, file_id=fileid, sequence_index=index),
            })
            set_concept_document_order(courseid, concept_id, unit, index, filemeta)
        elif unit_type == 'example':
            parent = infer_parent_concept_name(units, index)
            parent_id = add_concept_node(courseid, parent, '')
            log_example(courseid, parent, name, snippet, filemeta)
            extracted_names['example'].append(name)
            extracted_names['concept'].append(parent)
            outline_rows.append({
                'conceptId': parent_id,
                'name': parent,
                'documentOrder': build_document_order(unit, file_id=fileid, sequence_index=index),
            })
            set_concept_document_order(courseid, parent_id, unit, index, filemeta)
        elif unit_type == 'problem':
            parent = infer_parent_concept_name(units, index)
            parent_id = add_concept_node(courseid, parent, '')
            log_problem(
                courseid,
                name,
                [parent],
                [parent],
                [snippet] if snippet else ['Work the problem using course methods.'],
                'See file for answer.',
                filemeta,
            )
            extracted_names['problem'].append(name)
            extracted_names['concept'].append(parent)
            outline_rows.append({
                'conceptId': parent_id,
                'name': parent,
                'documentOrder': build_document_order(unit, file_id=fileid, sequence_index=index),
            })
            set_concept_document_order(courseid, parent_id, unit, index, filemeta)
        else:
            continue
        seeded += 1
    if outline_rows:
        added = apply_outline_sequence_edges(
            courseid,
            outline_rows,
            find_concept_by_name_or_id,
            add_concept_prerequisite_edge,
        )
        if added:
            print(
                f"parser debug sequence: added {added} document-order edge(s) file={fileid} course={courseid}",
                flush=True,
            )
    return seeded


def seed_heuristic_syllabus_for_file(courseid, filemeta, *, text=''):
    """Deterministic syllabus grade/due-date extraction before LLM syllabus pass."""
    from canvas_parser.parse.heuristic_syllabus import (
        build_syllabus_type_extractions,
        extract_syllabus_heuristic_bundle,
        syllabus_plain_text,
    )

    if not isinstance(filemeta, dict):
        return 0
    pages = filemeta.get('pages') or []
    body = str(text or filemeta.get('searchtext') or '').strip()
    if not body:
        body = syllabus_plain_text(pages=pages)
    if not body.strip():
        return 0

    bundle = extract_syllabus_heuristic_bundle(text=body, pages=pages)
    seeded = 0
    fileid = str(filemeta.get('fileid') or '')

    node = get_or_create_file_node(courseid, filemeta)
    extractions = build_syllabus_type_extractions(bundle)
    if extractions and node:
        node.typeExtractions = merge_type_extractions(
            getattr(node, 'typeExtractions', None) or {},
            extractions,
        )
        filemeta['typeExtractions'] = node.typeExtractions

    if courseid not in syllabusNodes:
        add_syllabus(
            courseid,
            '',
            [],
            compact_block_text(body, 4000),
            filechildren=[fileid] if fileid else [],
            filemeta=filemeta,
            participationgrade=bundle.get('participation_grade'),
        )
        seeded += 1

    for row in bundle.get('assignments') or []:
        name = str(row.get('name') or '').strip()
        if not name or find_assignment_node(courseid, assignmentname=name):
            continue
        add_assignment_node(
            courseid,
            name,
            '',
            normalize_date(row.get('duedate', '')),
            row.get('gradepercentage', ''),
            '',
        )
        seeded += 1

    for row in bundle.get('exams') or []:
        name = str(row.get('name') or '').strip()
        if not name or find_event_node(courseid, eventname=name):
            continue
        add_exam_node(
            courseid,
            name,
            normalize_date(row.get('startdate', '')),
            '',
            row.get('gradepercentage', ''),
            '',
        )
        seeded += 1

    if seeded:
        print(
            f"parser: heuristic syllabus file={fileid} course={courseid} seeded={seeded}",
            flush=True,
        )
    return seeded


def seed_heuristic_concepts_for_file(courseid, filemeta, *, skip_llm_pass1=False):
    """Deterministic concept + type-extraction seed before LLM passes."""
    if not should_seed_heuristic_extraction(skip_llm_pass1=skip_llm_pass1) or not isinstance(filemeta, dict):
        return 0
    pages = filemeta.get('pages') or []
    filename = str(filemeta.get('name') or '')
    file_type = str(filemeta.get('academicFileType') or '')
    fileid = str(filemeta.get('fileid') or '')
    if not pages and not filename:
        return 0
    titles = extract_heuristic_concept_titles(
        filename=filename,
        pages=pages,
        file_type=file_type,
    )
    seeded = 0
    for title in titles:
        concept_id = add_concept_node(courseid, title, '')
        if concept_id:
            seeded += 1
    extractions = build_heuristic_type_extractions(
        filename=filename,
        pages=pages,
        file_type=file_type,
    )
    if extractions:
        node = get_or_create_file_node(courseid, filemeta)
        if node:
            node.typeExtractions = merge_type_extractions(
                getattr(node, 'typeExtractions', None) or {},
                extractions,
            )
            filemeta['typeExtractions'] = node.typeExtractions
    if seeded:
        print(
            f"parser: heuristic seed file={fileid} course={courseid} concepts={seeded}",
            flush=True,
        )
    return seeded


def make_page_source(file_node, page):
    return {
        'fileid': file_node.fileid,
        'filename': file_node.name,
        'pageid': page.get('pageid', ''),
        'pageNumber': page.get('pageNumber', 0),
        'yScroll': page.get('yScroll', 0),
        'yScrollRatio': page.get('yScrollRatio', 0)
    }


def get_current_page(file_node, filemeta):
    if not file_node or not file_node.pages:
        return None
    current_page = filemeta.get('currentPage') if isinstance(filemeta, dict) else None
    current_pageid = ''
    if isinstance(current_page, dict):
        current_pageid = str(current_page.get('pageid') or '')
    if not current_pageid:
        current_pageid = str((filemeta or {}).get('pageid') or '')
    if not current_pageid and len(file_node.pages) == 1:
        return file_node.pages[0]
    for page in file_node.pages:
        if str(page.get('pageid') or '') == current_pageid:
            return page
    page_from_scroll = get_page_from_filemeta_scroll(file_node, filemeta or {})
    if page_from_scroll:
        return page_from_scroll
    return None


def parse_scroll_hint_from_url(url):
    parsed = urlparse(str(url or '').strip())
    candidates = {}

    for key, values in parse_qs(parsed.query or '').items():
        if values:
            candidates[str(key).casefold()] = values[-1]

    fragment = str(parsed.fragment or '').strip()
    if fragment:
        for token in re.split(r'[&;]', fragment):
            if '=' not in token:
                continue
            key, value = token.split('=', 1)
            key = str(key).strip().casefold()
            value = str(value).strip()
            if key and value:
                candidates[key] = value

    absolute_keys = ['yindex', 'y', 'scroll', 'scrolltop', 'offset', 'y_scroll', 'yscroll']
    ratio_keys = ['yscrollratio', 'y_ratio', 'scrollratio', 'ratio']

    for key in absolute_keys:
        if key in candidates:
            try:
                return {'y': float(candidates[key]), 'ratio': None}
            except (TypeError, ValueError):
                pass

    for key in ratio_keys:
        if key in candidates:
            try:
                ratio = float(candidates[key])
                if 0 <= ratio <= 1:
                    return {'y': None, 'ratio': ratio}
            except (TypeError, ValueError):
                pass

    return {'y': None, 'ratio': None}


def page_from_scroll_hint(file_node, y=None, ratio=None):
    pages = [page for page in (file_node.pages or []) if isinstance(page, dict)]
    if not pages:
        return None
    if len(pages) == 1:
        return pages[0]

    sorted_pages = sorted(pages, key=lambda page: float(page.get('yScroll', 0) or 0))
    starts = [float(page.get('yScroll', 0) or 0) for page in sorted_pages]

    if y is not None:
        index = bisect.bisect_right(starts, float(y)) - 1
        if index < 0:
            index = 0
        if index >= len(sorted_pages):
            index = len(sorted_pages) - 1
        return sorted_pages[index]

    if ratio is not None:
        ratios = [float(page.get('yScrollRatio', 0) or 0) for page in sorted_pages]
        index = bisect.bisect_right(ratios, float(ratio)) - 1
        if index < 0:
            index = 0
        if index >= len(sorted_pages):
            index = len(sorted_pages) - 1
        return sorted_pages[index]

    return None


def get_page_from_filemeta_scroll(file_node, filemeta):
    if not isinstance(filemeta, dict):
        return None

    y = filemeta.get('yindex')
    if y is not None:
        try:
            return page_from_scroll_hint(file_node, y=float(y), ratio=None)
        except (TypeError, ValueError):
            pass

    for key in ('canvaspreviewurl', 'downloadurl', 'url'):
        hint = parse_scroll_hint_from_url(filemeta.get(key, ''))
        if hint.get('y') is not None or hint.get('ratio') is not None:
            return page_from_scroll_hint(file_node, y=hint.get('y'), ratio=hint.get('ratio'))

    return None


def attach_node_to_current_page(file_node, filemeta, nodetype, node, nodeid):
    page = get_current_page(file_node, filemeta or {})
    if not page:
        return
    node_ref = {'type': nodetype, 'id': nodeid, 'name': getattr(node, 'name', '')}
    append_unique(page.setdefault('nodes', []), node_ref)
    if hasattr(node, 'sourcePages'):
        append_unique(node.sourcePages, make_page_source(file_node, page))


def get_or_create_file_node(courseid, filemeta):
    fileid = make_fileid(filemeta)
    if not fileid:
        return None
    fileNodes.setdefault(courseid, {})
    if fileid not in fileNodes[courseid]:
        fileNodes[courseid][fileid] = fileNode(
            fileid,
            courseid,
            filemeta.get('name', ''),
            filemeta.get('downloadurl', ''),
            filemeta.get('canvaspreviewurl', '')
        )
    else:
        node = fileNodes[courseid][fileid]
        node.name = node.name or filemeta.get('name', '')
        node.downloadurl = node.downloadurl or filemeta.get('downloadurl', '')
        node.canvaspreviewurl = node.canvaspreviewurl or filemeta.get('canvaspreviewurl', '')
    searchtext = compact_file_search_text(filemeta.get('searchtext', ''))
    if searchtext:
        fileNodes[courseid][fileid].searchtext = searchtext
    pages = normalize_file_pages(filemeta.get('pages', []), fileid)
    if pages:
        fileNodes[courseid][fileid].pages = merge_file_pages(fileNodes[courseid][fileid].pages, pages)
    ensure_file_node_page_blocks(fileNodes[courseid][fileid])
    persist_file_node_text_chunks(fileNodes[courseid][fileid])
    register_file_urls(fileNodes[courseid][fileid])
    if filemeta.get('academicFileType'):
        fileNodes[courseid][fileid].academicFileType = str(filemeta.get('academicFileType') or '')
    return fileNodes[courseid][fileid]


async def run_deepseek(prompt, fileid, courseid, downloadurl='', canvaspreviewurl='', filename='', final_pass=False, pages=None, current_page=None, linked_discovered=False, *, pass_start: int = 0, pass_end: int | None = None, skip_classify: bool = False, skip_pass2: bool = False):
    if PARSER_HEURISTIC_ONLY:
        return
    if deepseek_client is None:
        print(
            f"parser warning: skipped DeepSeek pass file={fileid} course={courseid} "
            "(DEEP_SEEK_API_KEY missing)",
            flush=True
        )
        return
    semaphore = deepseek_semaphore or asyncio.Semaphore(DEEPSEEK_MAX_CONCURRENT)
    async with semaphore:
        started = time.perf_counter()
        try:
            await _run_deepseek_passes(
                prompt,
                fileid,
                courseid,
                downloadurl=downloadurl,
                canvaspreviewurl=canvaspreviewurl,
                filename=filename,
                final_pass=final_pass,
                pages=pages,
                current_page=current_page,
                linked_discovered=linked_discovered,
                pass_start=pass_start,
                pass_end=pass_end,
                skip_classify=skip_classify,
                skip_pass2=skip_pass2,
            )
        except Exception as error:
            if is_insufficient_balance_error(error):
                handle_balance_error(error, where='deepseek')
            if is_non_fatal_llm_error(error):
                print(
                    f"parser warning: skipped oversize/context file={fileid} course={courseid} "
                    f"error={error}",
                    flush=True,
                )
                return
            print(
                f"parser debug deepseek: failed file={fileid} course={courseid} "
                f"final_pass={final_pass} error={error}",
                flush=True
            )
            if final_pass:
                print(
                    f"parser debug syllabus pass: failed course={normalize_courseid(courseid)} error={error}",
                    flush=True
                )
            raise
        record_phase_time('parse_llm_ms', started)


async def _run_deepseek_passes(prompt, fileid, courseid, downloadurl='', canvaspreviewurl='', filename='', final_pass=False, pages=None, current_page=None, linked_discovered=False, *, pass_start: int = 0, pass_end: int | None = None, skip_classify: bool = False, skip_pass2: bool = False):
    courseid = normalize_courseid(courseid)
    _deepseek_pass_context['final_pass'] = bool(final_pass)
    _deepseek_pass_context['courseid'] = courseid
    _deepseek_pass_context['fileid'] = str(fileid or '')
    _deepseek_pass_context['academicFileType'] = ''
    syllabus = get_syllabus_for_course(courseid)
    default_year = infer_course_academic_year(courseid, syllabus, fileNodes.get(courseid, {}))
    previous_year = _date_normalize_context.get('default_year')
    set_date_normalize_context(default_year)
    try:
        await _run_deepseek_passes_impl(
            prompt,
            fileid,
            courseid,
            downloadurl=downloadurl,
            canvaspreviewurl=canvaspreviewurl,
            filename=filename,
            final_pass=final_pass,
            pages=pages,
            current_page=current_page,
            linked_discovered=linked_discovered,
            pass_start=pass_start,
            pass_end=pass_end,
            skip_classify=skip_classify,
            skip_pass2=skip_pass2,
        )
    finally:
        _deepseek_pass_context['final_pass'] = False
        _deepseek_pass_context['courseid'] = ''
        _deepseek_pass_context['fileid'] = ''
        _deepseek_pass_context['academicFileType'] = ''
        set_date_normalize_context(previous_year)


async def run_file_type_classification(filename, pages, prompt_text, courseid, fileid, filemeta):
    snippet = build_classification_snippet(pages=pages, prompt_text=prompt_text)
    heuristic_type, heuristic_conf = heuristic_classify(filename=filename, snippet=snippet, pages=pages)
    llm_type_id = ''
    llm_confidence = 0.0
    llm_rationale = ''
    classify_call = None
    classify_started = time.perf_counter()

    if not PARSER_SKIP_LLM_CLASSIFY and should_run_llm_classification(
        heuristic_conf, resolved_type=heuristic_type
    ) and deepseek_client is not None:
        try:
            classify_messages = clean_surrogates([
                {'role': 'system', 'content': build_classify_system_prompt()},
                {
                    'role': 'user',
                    'content': build_classify_user_message(
                        filename=filename,
                        snippet=snippet,
                        heuristic_type=heuristic_type,
                        heuristic_confidence=heuristic_conf,
                    ),
                },
            ])
            from canvas_parser.parse.debug_trace import graph_debug_snapshot, trace_checkpoint

            await trace_checkpoint(
                'classify_request',
                {
                    'phase': 'classify',
                    'course_id': courseid,
                    'file_id': str(fileid),
                    'filename': filename,
                    'heuristic_type': heuristic_type,
                    'heuristic_confidence': heuristic_conf,
                    'system_prompt': build_classify_system_prompt(),
                    'user_prompt': classify_messages[1]['content'],
                    'tools': ['classify_course_file_type'],
                    'graph': graph_debug_snapshot(courseid),
                },
            )
            response = await deepseek_completion_with_retry(
                deepseek_client,
                where='classify',
                model='deepseek-v4-flash',
                messages=classify_messages,
                tools=[CLASSIFY_COURSE_FILE_TYPE_TOOL],
                tool_choice={
                    'type': 'function',
                    'function': {'name': 'classify_course_file_type'},
                },
                stream=False,
                **deepseek_thinking_extra('disabled'),
            )
            classify_usage = usage_from_chat_completion(response)
            classify_call = {
                'purpose': 'classify',
                'model': 'deepseek-v4-flash',
                'usage': classify_usage,
            }
            completed_model_calls.setdefault('deepseek_classifications', []).append({
                'courseid': courseid,
                'fileid': str(fileid),
                'model': 'deepseek-v4-flash',
                'usage': classify_usage,
                'completed_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            })
            message = response.choices[0].message
            if message.tool_calls:
                raw_args = message.tool_calls[0].function.arguments
                args = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})
                llm_type_id = str(args.get('type_id') or '')
                llm_confidence = float(args.get('confidence') or 0.0)
                llm_rationale = str(args.get('rationale') or '')
            from canvas_parser.parse.debug_trace import graph_debug_snapshot, trace_checkpoint

            await trace_checkpoint(
                'classify_done',
                {
                    'phase': 'classify',
                    'course_id': courseid,
                    'file_id': str(fileid),
                    'resolved_type': llm_type_id or heuristic_type,
                    'confidence': llm_confidence or heuristic_conf,
                    'rationale': llm_rationale,
                    'model': 'deepseek-v4-flash',
                    'usage': classify_call.get('usage') if classify_call else {},
                    'graph': graph_debug_snapshot(courseid),
                },
            )
        except Exception as error:
            if is_insufficient_balance_error(error):
                handle_balance_error(error, where='classify')
            print(
                f"parser warning: file type LLM classify failed file={fileid} course={courseid} error={error}",
                flush=True,
            )

    profile, type_id, confidence, source = resolve_file_type_profile(
        filename=filename,
        snippet=snippet,
        pages=pages,
        llm_type_id=llm_type_id,
        llm_confidence=llm_confidence,
    )
    filemeta['academicFileType'] = type_id
    filemeta['academicFileTypeConfidence'] = confidence
    filemeta['academicFileTypeSource'] = source
    if llm_rationale:
        filemeta['academicFileTypeRationale'] = llm_rationale
    node = get_or_create_file_node(courseid, filemeta)
    if node:
        node.academicFileType = type_id
        if profile.node_filetype and not node.type:
            node.type = profile.node_filetype
    print(
        f"parser: classified file={fileid} course={courseid} type={type_id} "
        f"conf={confidence:.2f} source={source} heuristic={heuristic_type}({heuristic_conf:.2f})",
        flush=True,
    )
    record_file_classification(courseid, fileid, type_id, confidence)
    if classify_call is not None:
        classify_call['classify_ms'] = round((time.perf_counter() - classify_started) * 1000, 1)
    return profile, type_id, snippet, classify_call


async def _run_deepseek_passes_impl(prompt, fileid, courseid, downloadurl='', canvaspreviewurl='', filename='', final_pass=False, pages=None, current_page=None, linked_discovered=False, *, pass_start: int = 0, pass_end: int | None = None, skip_classify: bool = False, skip_pass2: bool = False):
    file_started = time.perf_counter()
    classify_ms = 0.0
    prompt = clean_surrogates(prompt)
    page_list = list(pages or [])
    pass1_char_cap = pass1_max_prompt_chars()
    if page_list and not final_pass:
        max_pages = PASS1_LINKED_MAX_PAGES if linked_discovered else PASS1_MAX_PAGES
        page_list, truncated = trim_pages_for_pass1(
            page_list,
            max_pages=max_pages,
            max_chars=pass1_char_cap,
            pages_to_text=pages_to_prompt_text,
        )
        if truncated:
            print(
                f"parser: trimmed pass1 pages file={fileid} course={courseid} kept={len(page_list)}",
                flush=True,
            )
            prompt = pages_to_prompt_text(page_list)
    elif not page_list and prompt and not final_pass and len(prompt) > pass1_char_cap:
        prompt = prompt[:pass1_char_cap]
        print(
            f"parser: trimmed pass1 text file={fileid} course={courseid} chars={pass1_char_cap}",
            flush=True,
        )

    if not final_pass and prompt:
        prompt, norm_stats = normalize_academic_prompt(prompt)
        if norm_stats.get('normalized'):
            print(
                f"parser: academic normalize file={fileid} course={courseid} "
                f"removed={norm_stats.get('removed_chars')} chars "
                f"pages={norm_stats.get('pages_processed')}",
                flush=True,
            )

    profile = get_file_type_profile('syllabus' if final_pass else 'generic_content')
    filemeta_preview = {}
    file_api_calls = []
    if not final_pass and prompt and not skip_classify:
        filemeta_preview = {
            'fileid': str(fileid),
            'courseid': courseid,
            'name': filename,
            'pages': page_list or pages or [],
        }
        profile, _type_id, _snippet, classify_call = await run_file_type_classification(
            filename,
            page_list or pages or [],
            prompt,
            courseid,
            fileid,
            filemeta_preview,
        )
        if classify_call:
            file_api_calls.append(classify_call)
            classify_ms = float(classify_call.get('classify_ms') or 0.0)
        if profile_uses_keyword_extract(profile) or PARSER_BULK_MODE:
            prompt, keyword_stats = maybe_compress_prompt_for_pass1(prompt, final_pass=final_pass)
            if keyword_stats.get('compressed'):
                print(
                    f"parser: keyword extract file={fileid} course={courseid} "
                    f"input={keyword_stats.get('input_chars')} "
                    f"output={keyword_stats.get('output_chars')}",
                    flush=True,
                )
        if len(prompt) > pass1_char_cap:
            prompt = prompt[:pass1_char_cap]
            print(
                f"parser: hard cap pass1 text file={fileid} course={courseid} chars={pass1_char_cap}",
                flush=True,
            )
    elif not final_pass and skip_classify:
        existing = fileNodes.get(courseid, {}).get(str(fileid))
        type_id = ''
        if existing and getattr(existing, 'academicFileType', None):
            type_id = str(existing.academicFileType or '')
        if not type_id and existing and getattr(existing, 'type', None):
            type_id = str(existing.type or '')
        if not type_id:
            type_id = str((filemeta_preview or {}).get('academicFileType') or 'generic_content')
        profile = get_file_type_profile(type_id or 'generic_content')
        filemeta_preview = filemeta_preview or {
            'academicFileType': type_id,
            'academicFileTypeConfidence': HEURISTIC_CONFIDENCE_THRESHOLD,
            'academicFileTypeSource': 'preclassified',
        }

    filemeta = {
        'fileid': str(fileid),
        'courseid': courseid,
        'name': filename,
        'downloadurl': downloadurl,
        'canvaspreviewurl': canvaspreviewurl,
        'url': canvaspreviewurl or downloadurl,
        'pages': page_list or pages or [],
        'currentPage': current_page or {},
        'academicFileType': profile.type_id if not final_pass else '',
        'academicFileTypeConfidence': filemeta_preview.get('academicFileTypeConfidence', 0) if not final_pass else 0,
        'academicFileTypeSource': filemeta_preview.get('academicFileTypeSource', '') if not final_pass else '',
    }
    filemeta = clean_surrogates(filemeta)
    systemprompt = DEEPSEEK_PASS1_STATIC_SYSTEM
    if final_pass:
        systemprompt = (
            "This is the final syllabus reconciliation pass. Verify every syllabus assignment grade percentage "
            "with update_assignment_node. Also verify the exam calendar: every midterm, final, quiz, or exam "
            "mentioned in the syllabus must have a dated event node via add_exam_node or update_event_node. "
            "For every undated event in undated event nodes needing dates, call update_event_node or add_exam_node "
            "with the date from the syllabus text. Merge duplicate test events into canonical names Midterm, Final, or Quiz. "
            "Link study material files to their events with link_file_to_event. Promote any remaining logged events into real nodes. "
            "You may chain tool calls across rounds in this pass (for example lookup assignment IDs, then update_event_node). "
            + EVENT_LOGGING_EXAMPLES
            + "\nDo not give any text response that is not a tool call."
        )
    elif not final_pass:
        systemprompt = build_pass1_system_for_profile(DEEPSEEK_PASS1_STATIC_SYSTEM, profile)

    pass2_systemprompt = DEEPSEEK_PASS2_STATIC_SYSTEM
    pass1_dynamic_prefix = build_pass1_dynamic_user_prefix(courseid, filemeta)

    teaching_outline = ''
    if not final_pass and profile.teaching_outline:
        teaching_outline = build_teaching_outline_for_prompt(filemeta.get('pages') or pages or [])

    pass1_tool_names = []
    max_passes = 1 if (final_pass or not profile.pass2 or PARSER_SKIP_PASS2 or skip_pass2) else 2
    effective_pass_end = pass_end if pass_end is not None else max_passes
    _deepseek_pass_context['academicFileType'] = profile.type_id if not final_pass else ''
    if not final_pass and pass_start == 0 and (filemeta.get('pages') or pages or filename):
        if profile.type_id == 'syllabus':
            syllabus_text = prompt if isinstance(prompt, str) else ''
            seeded_syllabus = seed_heuristic_syllabus_for_file(
                courseid,
                filemeta,
                text=syllabus_text,
            )
            if seeded_syllabus:
                print(
                    f"parser debug heuristic: pre-pass seeded {seeded_syllabus} syllabus row(s) "
                    f"file={fileid} course={courseid}",
                    flush=True,
                )
        seeded_heuristic = seed_heuristic_concepts_for_file(courseid, filemeta)
        if seeded_heuristic:
            print(
                f"parser debug heuristic: pre-pass seeded {seeded_heuristic} concept(s) "
                f"file={fileid} course={courseid}",
                flush=True,
            )
    if not final_pass and profile.teaching_outline and (filemeta.get('pages') or pages):
        seeded = seed_teaching_blocks_from_outline(courseid, filemeta)
        if seeded:
            print(
                f"parser debug teaching: pre-pass seeded {seeded} block(s) file={fileid} course={courseid}",
                flush=True,
            )
    for pass_index in range(max_passes):
        if pass_index < pass_start or pass_index >= effective_pass_end:
            continue
        if pass_index == 0:
            base_system = systemprompt
            user_content = f"{pass1_dynamic_prefix}\n{prompt}"
            if teaching_outline:
                user_content = f"{user_content}\n\n{teaching_outline}"
        else:
            base_system = systemprompt if final_pass else pass2_systemprompt
            user_content = FINAL_PASS2_USER_MESSAGE if final_pass else PASS2_USER_MESSAGE
            if not final_pass:
                user_content = f"Course id: {courseid}\n{user_content}"
                chunk_outline = build_indexed_chunks_for_prompt(
                    courseid,
                    fileid,
                    filemeta.get('pages') or pages or [],
                    filename=filename,
                )
                if chunk_outline:
                    user_content = f"{user_content}\n\n{chunk_outline}"

        max_turns = DEEPSEEK_MAX_TURNS_FINAL if final_pass else DEEPSEEK_MAX_TURNS_PASS
        compact_lookup = final_pass or pass_index > 0
        pass_tool_total = 0
        nudge_used = False
        pass_turns = []

        api_messages = clean_surrogates([
            {
                "role": "system",
                "content": build_deepseek_system_content(
                    base_system,
                    courseid,
                    filemeta,
                    final_pass=final_pass,
                    pass_index=pass_index,
                )
            },
            {"role": "user", "content": user_content}
        ])
        tools = deepseek_tools_for_pass(pass_index, final_pass=final_pass, profile=profile if pass_index == 0 else None)

        from canvas_parser.parse.debug_trace import (
            graph_debug_snapshot,
            serialize_messages,
            serialize_tool_results,
            tool_names,
            trace_checkpoint,
        )

        pass_label = 'syllabus_final' if final_pass else f'pass{pass_index + 1}'
        await trace_checkpoint(
            f'{pass_label}_pass_start',
            {
                'phase': pass_label,
                'pass_index': pass_index + 1,
                'final_pass': final_pass,
                'course_id': courseid,
                'file_id': str(fileid),
                'filename': filename,
                'profile_type': profile.type_id if not final_pass else 'syllabus_final',
                'system_prompt': api_messages[0].get('content', ''),
                'user_prompt': user_content,
                'tools': tool_names(tools),
                'graph': graph_debug_snapshot(courseid),
            },
        )

        for turn_index in range(max_turns):
            turn_label = (
                f"final_pass{pass_index + 1}_turn{turn_index + 1}"
                if final_pass
                else f"pass{pass_index + 1}_turn{turn_index + 1}"
            )
            await trace_checkpoint(
                f'{turn_label}_request',
                {
                    'phase': pass_label,
                    'turn': turn_index + 1,
                    'course_id': courseid,
                    'file_id': str(fileid),
                    'messages': serialize_messages(api_messages),
                    'tools': tool_names(tools),
                },
            )
            from canvas_parser.parse.debug_trace import trace_activity

            await trace_activity(
                f'DeepSeek {pass_label} turn {turn_index + 1} '
                f'({filename or fileid})…'
            )
            try:
                response = await deepseek_completion_with_retry(
                    deepseek_client,
                    where=f'pass{pass_index + 1}',
                    model="deepseek-v4-flash",
                    messages=api_messages,
                    tools=tools,
                    tool_choice="auto",
                    stream=False,
                )
            except Exception as error:
                if is_insufficient_balance_error(error):
                    handle_balance_error(error, where=f'pass{pass_index + 1}')
                if is_non_fatal_llm_error(error):
                    print(
                        f"parser warning: skipped oversize/context file={fileid} course={courseid} "
                        f"pass={pass_index + 1} turn={turn_index + 1} error={error}",
                        flush=True,
                    )
                    return
                print(
                    f"parser debug deepseek: api failed file={fileid} course={courseid} "
                    f"pass={pass_index + 1} turn={turn_index + 1} final_pass={final_pass} error={error}",
                    flush=True,
                )
                raise
            message = response.choices[0].message
            turn_usage = usage_from_chat_completion(response)
            turn_record = {
                'turn_index': turn_index + 1,
                'purpose': turn_label,
                'model': 'deepseek-v4-flash',
                'usage': turn_usage,
            }
            pass_turns.append(turn_record)
            file_api_calls.append(turn_record)

            if message.tool_calls and pass_index == 0:
                pass1_tool_names.extend(
                    tc.function.name for tc in message.tool_calls if tc.function.name
                )

            if message.content and not final_pass and turn_index == 0 and pass_index == 0:
                print(f"{fileid}: {message.content}", flush=True)

            log_llm_pass(
                courseid,
                fileid,
                pass_index + 1,
                final_pass,
                message.tool_calls,
                message.content or '',
                turn_index=turn_index + 1,
            )

            if not message.tool_calls:
                if (
                    final_pass
                    and not nudge_used
                    and turn_index + 1 < max_turns
                    and get_undated_events_for_prompt(courseid)
                ):
                    nudge_used = True
                    api_messages.append({"role": "assistant", "content": message.content or ""})
                    api_messages.append({"role": "user", "content": FINAL_PASS_TOOL_NUDGE})
                    continue
                break

            append_assistant_tool_message(api_messages, message)
            tool_results = execute_deepseek_tool_calls(
                message,
                courseid,
                fileid,
                filemeta,
                compact_lookup=compact_lookup and turn_index > 0,
            )
            await trace_checkpoint(
                f'{turn_label}_response',
                {
                    'phase': pass_label,
                    'turn': turn_index + 1,
                    'course_id': courseid,
                    'file_id': str(fileid),
                    'assistant_content': message.content or '',
                    'tool_calls': [
                        {
                            'name': tc.function.name,
                            'arguments': tc.function.arguments,
                        }
                        for tc in (message.tool_calls or [])
                    ],
                    'tool_results': serialize_tool_results(tool_results),
                    'model': 'deepseek-v4-flash',
                    'usage': turn_usage,
                    'graph': graph_debug_snapshot(courseid),
                },
            )
            append_tool_result_messages(api_messages, tool_results)
            pass_tool_total += len(message.tool_calls)

            if turn_index + 1 >= max_turns:
                break

            if final_pass:
                continue_message = build_final_pass_undated_continue_message(courseid)
                if not continue_message:
                    break
                api_messages.append({"role": "user", "content": continue_message})

        pass_cost = assess_parse_cost(pass_turns)
        completed_model_calls['deepseek_file_passes'].append({
            'courseid': courseid,
            'fileid': str(fileid),
            'filename': filename,
            'pass_index': pass_index + 1,
            'final_pass': bool(final_pass),
            'tool_count': pass_tool_total,
            'turn_count': turn_index + 1,
            'turns': pass_turns,
            'usage': pass_cost['usage'],
            'cost_usd': pass_cost['total_cost_usd'],
            'cache_hit_rate': pass_cost['cache_hit_rate'],
            'completed_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        })

        await trace_checkpoint(
            f'{pass_label}_pass_end',
            {
                'phase': pass_label,
                'pass_index': pass_index + 1,
                'final_pass': final_pass,
                'course_id': courseid,
                'file_id': str(fileid),
                'tool_count': pass_tool_total,
                'turn_count': turn_index + 1,
                'model': 'deepseek-v4-flash',
                'usage': pass_cost['usage'],
                'cost': {
                    'rollup': True,
                    'purpose': pass_label,
                    'usage': pass_cost['usage'],
                    'total_cost_usd': pass_cost['total_cost_usd'],
                    'cache_hit_rate': pass_cost['cache_hit_rate'],
                },
                'graph': graph_debug_snapshot(courseid),
            },
        )

        if pass_tool_total == 0:
            break

        if pass_index == 0 and not final_pass:
            _debug_pass1_tool_names[(str(courseid), str(fileid))] = list(pass1_tool_names)
            if linked_discovered and linked_discovered_pass1_only():
                print(
                    f"parser: linked light pass1-only file={fileid} course={courseid}",
                    flush=True,
                )
                break
            if not profile.pass2:
                print(
                    f"parser: skipped pass2 (file type {profile.type_id}) file={fileid} course={courseid}",
                    flush=True,
                )
                break
            if not pass1_needs_pass2(
                pass1_tool_names,
                profile_pass2=profile.pass2,
                profile=profile,
            ):
                print(
                    f"parser: skipped pass2 (no log_* tools) file={fileid} course={courseid}",
                    flush=True,
                )
                break
            pending_logs = logged_items_for_file(
                courseid,
                str(fileid),
                logged_details.get(courseid, []),
            )
            log_tools = [name for name in pass1_tool_names if str(name).startswith('log_')]
            if log_tools and not pending_logs:
                print(
                    f"parser: skipped pass2 (log tools produced no accepted rows) "
                    f"file={fileid} course={courseid}",
                    flush=True,
                )
                break


    file_cost = assess_parse_cost(file_api_calls)
    if file_api_calls:
        file_runtime_ms = (time.perf_counter() - file_started) * 1000
        file_pass_records = [
            item for item in completed_model_calls.get('deepseek_file_passes', [])
            if str(item.get('courseid') or '') == str(courseid)
            and str(item.get('fileid') or '') == str(fileid)
        ]
        pass_count = len(file_pass_records)
        tool_count = sum(int(item.get('tool_count') or 0) for item in file_pass_records)
        turn_count = sum(len(item.get('turns') or []) for item in file_pass_records)
        print(
            f"parser cost: file={fileid} course={courseid} name={filename!r} "
            f"{format_cost_summary(file_cost)}",
            flush=True,
        )
        record_parse_cost(courseid, fileid, filename, file_cost)
        file_record = build_file_parse_record(
            courseid=courseid,
            fileid=str(fileid),
            filename=filename,
            cost_summary=file_cost,
            runtime_ms=file_runtime_ms,
            tool_count=tool_count,
            pass_count=pass_count,
            turn_count=turn_count,
            classify_ms=classify_ms,
        )
        parse_file_stats.append(file_record)
        completed_model_calls.setdefault('parse_file_stats', []).append(file_record)
        print(
            f"parser stats: file={fileid} course={courseid} name={filename!r} "
            f"{format_file_efficiency_debug(file_record)}",
            flush=True,
        )


def isvaliddate(date):
    if not isinstance(date, str):
        return False
    if len(date) != 20:
        return False
    for i in range(4):
        if date[i] > '9' or date[i] < '0':
            return False
    if date[4] != '-':
        return False
    for i in range(5, 7):
        if date[i] > '9' or date[i] < '0':
            return False
    if date[7] != '-':
        return False
    for i in range(8, 10):
        if date[i] > '9' or date[i] < '0':
            return False
    if date[10] != 'T':
        return False
    for i in range(11, 13):
        if date[i] > '9' or date[i] < '0':
            return False
    if date[13] != ':':
        return False
    for i in range(14, 16):
        if date[i] > '9' or date[i] < '0':
            return False
    if date[16] != ':':
        return False
    for i in range(17, 19):
        if date[i] > '9' or date[i] < '0':
            return False
    if date[19] != 'Z':
        return False

    year = int(date[0:4])
    month = int(date[5:7])
    day = int(date[8:10])
    hour = int(date[11:13])
    minute = int(date[14:16])
    second = int(date[17:19])

    if month < 1 or month > 12:
        return False
    if hour < 0 or hour > 23:
        return False
    if minute < 0 or minute > 59:
        return False
    if second < 0 or second > 59:
        return False

    month_lengths = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if month == 2 and isleapyear(year):
        max_day = 29
    else:
        max_day = month_lengths[month]

    if day < 1 or day > max_day:
        return False

    return True


def isleapyear(year):
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


daysbymonth = [0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]


def transform(date):
    year = int(date[0:4])
    month = int(date[5:7])
    day = int(date[8:10])
    hour = int(date[11:13])
    minute = int(date[14:16])
    second = int(date[17:19])

    days_before_year = (
        year * 365
        + (year - 1) // 4
        - (year - 1) // 100
        + (year - 1) // 400
    )

    day_of_year = daysbymonth[month] + day
    if month > 2 and isleapyear(year):
        day_of_year += 1

    return (((days_before_year + day_of_year - 1) * 24 + hour) * 60 + minute) * 60 + second


def get_assignment_indicator(assignment):
    for field in ("due_at", "unlock_at", "created_at", "lock_at"):
        date = normalize_date(assignment.get(field))
        if isvaliddate(date):
            return transform(date)
    return None


def get_file_indicator(file):
    for field in ("created_at", "unlock_at", "lock_at"):
        date = normalize_date(file.get(field))
        if isvaliddate(date):
            return transform(date)
    return None


def load_canvas_files():
    with open("course.json", "r", encoding="utf-8-sig") as file:
        data = json.load(file)
        course_id = data.get("course_id")
        for tfile in data.get("file", []):
            fileid = tfile.get('id')
            indicator = get_file_indicator(tfile)

            if fileid:
                if indicator is not None:
                    current_files_groups.append({
                        "indicator": indicator,
                        "fileid": fileid,
                        "course_id": course_id,
                        "file": tfile
                    })
    current_files_groups.sort(key=lambda item: item["indicator"])


def get_all_assignment_names():
    if _deepseek_pass_context.get('final_pass'):
        return get_syllabus_assignments_for_prompt(_deepseek_pass_context.get('courseid'))

    assignments = []
    for assignment in current_assignment_files_groups:
        assignments.append({
            "name": assignment.get("name"),
            "assignmentid": assignment.get("assignmentid"),
            "courseid": assignment.get("courseid"),
            "indicator": assignment.get("indicator")
        })

    return assignments


def get_assignmentid_by_name(name):
    normalized_name = name.strip().casefold()
    exact_matches = []
    partial_matches = []

    if _deepseek_pass_context.get('final_pass'):
        for assignment in get_syllabus_assignments_for_prompt(_deepseek_pass_context.get('courseid')):
            assignment_name = assignment.get('name') or ''
            normalized_assignment_name = assignment_name.strip().casefold()
            match = {
                'name': assignment_name,
                'assignmentid': assignment.get('assignmentid'),
                'assignmentNodeId': assignment.get('assignmentNodeId'),
                'courseid': normalize_courseid(_deepseek_pass_context.get('courseid')),
                'gradepercentage': assignment.get('gradepercentage'),
            }
            if normalized_assignment_name == normalized_name:
                exact_matches.append(match)
            elif normalized_name and normalized_name in normalized_assignment_name:
                partial_matches.append(match)
        return {
            'matches': exact_matches or partial_matches,
            'match_type': 'exact' if exact_matches else 'partial'
        }

    for assignment in current_assignment_files_groups:
        assignment_name = assignment.get("name") or ""
        normalized_assignment_name = assignment_name.strip().casefold()
        match = {
            "name": assignment_name,
            "assignmentid": assignment.get("assignmentid"),
            "courseid": assignment.get("courseid"),
            "indicator": assignment.get("indicator")
        }

        if normalized_assignment_name == normalized_name:
            exact_matches.append(match)
        elif normalized_name in normalized_assignment_name:
            partial_matches.append(match)

    return {
        "matches": exact_matches or partial_matches,
        "match_type": "exact" if exact_matches else "partial"
    }


def get_assigmentid_by_name(name):
    return get_assignmentid_by_name(name)


def change_assignment_indicator(assignmentid, indicator):
    try:
        assignmentid = int(assignmentid)
    except (TypeError, ValueError):
        return False

    normalized_indicator = normalize_date(indicator)
    if isvaliddate(normalized_indicator):
        indicator = transform(normalized_indicator)
    else:
        try:
            indicator = int(indicator)
        except (TypeError, ValueError):
            return False

    for assignment in current_assignment_files_groups:
        if assignment.get("assignmentid") == assignmentid:
            assignment["indicator"] = indicator
            current_assignment_files_groups.sort(key=lambda item: item["indicator"])
            return True

    return False


def find_assignment_node(courseid, assignmentNodeId=None, assignmentname=None, canvasAssignmentId=None):
    syllabus = get_syllabus_for_course(courseid)
    if not syllabus:
        return None
    normalized_name = str(assignmentname or "").strip().casefold()
    canvas_id = str(canvasAssignmentId or assignmentNodeId or "").strip()
    for assignment in syllabus.assignments:
        if canvas_id and str(getattr(assignment, 'canvasAssignmentId', '') or '').strip() == canvas_id:
            return assignment
        if assignmentNodeId and assignment.assignmentid == assignmentNodeId:
            return assignment
        if normalized_name and assignment.name.strip().casefold() == normalized_name:
            return assignment
    if normalized_name:
        for assignment in syllabus.assignments:
            if normalized_name in assignment.name.strip().casefold() or assignment.name.strip().casefold() in normalized_name:
                return assignment
    return None


LOOKING_FOR_VERBS = (
    r"use|read|review|see|refer to|consult|open|download|watch|complete|submit from|answer from|based on"
)
RESOURCE_WORDS = (
    "file", "pdf", "document", "doc", "slides", "slide", "worksheet", "handout",
    "reading", "article", "chapter", "textbook", "notebook", "guide", "prompt",
    "rubric", "instructions", "questions", "problems", "problem set", "pset"
)
LOOKING_FOR_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "canvas", "class", "course",
    "do", "for", "from", "in", "into", "is", "it", "of", "on", "or", "our", "page",
    "please", "read", "see", "submit", "the", "this", "to", "use", "using", "with",
    "you", "your"
}


def compact_file_search_text(text, max_length=1200):
    cleaned = html_to_text(text or '').replace('\x00', ' ')
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned[:max_length]


def normalize_resource_text(value):
    text = html_to_text(value or '').casefold()
    text = re.sub(r'https?://\S+', ' ', text)
    text = re.sub(r'\.(pdf|docx?|pptx?|xlsx?|html?|txt)\b', ' ', text)
    text = re.sub(r'[^a-z0-9]+', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()


def resource_tokens(value):
    return [
        token for token in normalize_resource_text(value).split()
        if len(token) > 2 and token not in LOOKING_FOR_STOPWORDS
    ]


def cleanup_looking_for_target(value):
    text = html_to_text(value or '')
    text = re.sub(r'\s+', ' ', text).strip(" .,:;()[]{}\"'")
    text = re.sub(r'^(the|a|an|your|this)\s+', '', text, flags=re.I)
    text = re.sub(
        r'\b(before|after|and|then|to|for|on|in order|that|which|where|when)\b.*$',
        '',
        text,
        flags=re.I
    ).strip(" .,:;()[]{}\"'")
    return text[:120]


def extract_looking_for_targets(text):
    text = html_to_text(text or '')
    targets = []
    for match in re.finditer(r'["""]([^"""]{4,120})["""]', text):
        target = cleanup_looking_for_target(match.group(1))
        if target:
            targets.append(target)

    pattern = re.compile(
        rf'\b(?:{LOOKING_FOR_VERBS})\b\s+(?:the\s+|a\s+|an\s+|your\s+)?([^.;\n]{{4,160}})',
        re.I
    )
    for match in pattern.finditer(text):
        target = cleanup_looking_for_target(match.group(1))
        lowered = target.casefold()
        if target and (
            any(word in lowered for word in RESOURCE_WORDS)
            or re.search(r'\b[A-Z]{2,}\b|\d', target)
        ):
            targets.append(target)

    unique = []
    seen = set()
    for target in targets:
        key = normalize_resource_text(target)
        if len(key) < 4 or key in seen:
            continue
        seen.add(key)
        unique.append(target)
    return unique[:8]


def file_matches_target(file_node, target):
    target_norm = normalize_resource_text(target)
    if not target_norm:
        return False

    file_text = ' '.join([
        file_node.name or '',
        getattr(file_node, 'searchtext', '') or '',
        ' '.join(file_node.concepts or [])
    ])
    file_norm = normalize_resource_text(file_text)
    if not file_norm:
        return False
    if target_norm in file_norm or file_norm in target_norm:
        return True

    target_tokens = set(resource_tokens(target))
    file_tokens = set(resource_tokens(file_text))
    if not target_tokens or not file_tokens:
        return False
    overlap = target_tokens & file_tokens
    return len(overlap) >= 2 and len(overlap) / max(1, len(target_tokens)) >= 0.6


def link_assignment_file(assignment, file_node, reason='matched'):
    before = len(assignment.filechildren)
    append_unique(assignment.filechildren, str(file_node.fileid))
    if len(assignment.filechildren) != before:
        print(
            f"parser debug looking_for: linked assignment={assignment.assignmentid!r} file={file_node.fileid!r} reason={reason}",
            flush=True
        )
        record_link_action(
            normalize_courseid(file_node.courseid),
            f"Linked file **{file_node.name}** → assignment **{assignment.name}** ({reason})",
        )
        return True
    return False


def remove_satisfied_looking_request(courseid, assignmentid, target, fileid):
    requests = looking_for_files.get(courseid, [])
    for request in requests:
        if request.get('assignmentid') != assignmentid:
            continue
        if normalize_resource_text(request.get('target')) != normalize_resource_text(target):
            continue
        append_unique(request.setdefault('matchedFileIds', []), str(fileid))
        request['status'] = 'matched'


def add_looking_for_request(courseid, assignment, target):
    looking_for_files.setdefault(courseid, [])
    key = normalize_resource_text(target)
    for request in looking_for_files[courseid]:
        if request.get('assignmentid') == assignment.assignmentid and normalize_resource_text(request.get('target')) == key:
            return
    looking_for_files[courseid].append({
        'assignmentid': assignment.assignmentid,
        'assignmentname': assignment.name,
        'courseid': courseid,
        'target': target,
        'status': 'pending',
        'matchedFileIds': []
    })
    print(
        f"parser debug looking_for: pending assignment={assignment.assignmentid!r} target={target!r}",
        flush=True
    )


def resolve_assignment_looking_for(courseid, assignment):
    targets = extract_looking_for_targets(f"{assignment.name}\n{assignment.description}")
    if targets:
        for target in targets:
            append_unique(assignment.lookingfor, target)

    for dependency in assignment.submissionDependencies or []:
        if dependency.get('type') == 'file' and dependency.get('fileId'):
            file_node = (fileNodes.get(courseid, {}) or {}).get(str(dependency.get('fileId')))
            if file_node:
                link_assignment_file(assignment, file_node, file_node.name or dependency.get('fileId'))

    for target in assignment.lookingfor:
        matched = False
        for file_node in (fileNodes.get(courseid, {}) or {}).values():
            if file_matches_target(file_node, target):
                matched = link_assignment_file(assignment, file_node, target) or matched
                remove_satisfied_looking_request(courseid, assignment.assignmentid, target, file_node.fileid)
        if not matched:
            add_looking_for_request(courseid, assignment, target)


def resolve_file_against_looking_requests(courseid, file_node):
    changed = False
    for request in looking_for_files.get(courseid, []) or []:
        if request.get('status') == 'matched' and request.get('matchedFileIds'):
            continue
        if not file_matches_target(file_node, request.get('target', '')):
            continue
        assignment = find_assignment_node(courseid, assignmentNodeId=request.get('assignmentid'))
        if not assignment:
            continue
        changed = link_assignment_file(assignment, file_node, request.get('target', '')) or changed
        append_unique(request.setdefault('matchedFileIds', []), str(file_node.fileid))
        request['status'] = 'matched'
    changed = resolve_looking_for_in_canvas_urls(courseid, file_node) or changed
    return changed


def infer_canvas_file_download_url(courseid, file_id):
    cid = normalize_courseid(courseid)
    file_id = str(file_id or '').strip()
    if not cid or not file_id:
        return ''
    for node in (fileNodes.get(cid, {}) or {}).values():
        url = str(getattr(node, 'downloadurl', '') or '')
        match = re.match(r'(https?://[^/]+)', url)
        if match:
            return f"{match.group(1)}/courses/{cid}/files/{file_id}/download"
    base = str(os.getenv('CANVAS_BASE_URL', '') or '').rstrip('/')
    if base:
        return f"{base}/courses/{cid}/files/{file_id}/download"
    return ''


def infer_canvas_file_preview_url(courseid, file_id):
    download_url = infer_canvas_file_download_url(courseid, file_id)
    if not download_url:
        return ''
    return download_url.replace(f"/files/{file_id}/download", f"/files?preview={file_id}")


def _linked_canvas_file_already_present(courseid, file_id):
    cid = normalize_courseid(courseid)
    file_id = str(file_id or '').strip()
    return is_item_parsed('file', cid, file_id)


def enqueue_linked_canvas_files(courseid, html, name_hint=''):
    cid = normalize_courseid(courseid)
    for file_id in extract_canvas_file_ids_from_html(html):
        enqueue_linked_canvas_file_id(cid, file_id, name=name_hint)


def enqueue_linked_canvas_file_id(courseid, file_id, name='', download_url=''):
    cid = normalize_courseid(courseid)
    file_id = str(file_id or '').strip()
    if not cid or not file_id or _linked_canvas_file_already_present(cid, file_id):
        return
    pending = pending_linked_canvas_files.setdefault(cid, {})
    current = pending.get(file_id, {})
    pending[file_id] = {
        'name': str(name or current.get('name') or f'Linked file {file_id}'),
        'downloadurl': str(download_url or current.get('downloadurl') or ''),
    }


def resolve_looking_for_in_canvas_urls(courseid, file_node):
    if not file_node or not looking_for_in_canvas:
        return False
    changed = False
    node_urls = {
        normalize_registry_url(getattr(file_node, 'downloadurl', '')),
        normalize_registry_url(getattr(file_node, 'canvaspreviewurl', '')),
    }
    for url, assignment_ref in list(looking_for_in_canvas.items()):
        normalized = normalize_registry_url(url)
        file_id_from_url = extract_canvas_file_id_from_url(url)
        matched = (
            (file_id_from_url and str(file_id_from_url) == str(file_node.fileid))
            or (normalized and normalized in node_urls)
        )
        if not matched:
            continue
        assignment = find_assignment_node(
            courseid,
            assignmentNodeId=(assignment_ref or {}).get('nodeId'),
        )
        if not assignment:
            continue
        changed = link_assignment_file(assignment, file_node, file_node.name or url) or changed
    return changed


async def parse_pending_linked_canvas_files():
    tasks = []
    for courseid, pending in list(pending_linked_canvas_files.items()):
        for file_id, meta in list(pending.items()):
            if _linked_canvas_file_already_present(courseid, file_id):
                continue
            download_url = meta.get('downloadurl') or infer_canvas_file_download_url(courseid, file_id)
            if not download_url:
                print(
                    f"parser debug linked-file: skip file={file_id} course={courseid} (no download URL)",
                    flush=True,
                )
                continue
            tasks.append(process_parse_item({
                'id': file_id,
                'courseid': courseid,
                'url': download_url,
                'previewurl': infer_canvas_file_preview_url(courseid, file_id) or download_url,
                'name': meta.get('name') or f'Linked file {file_id}',
                'content_type': meta.get('content_type', ''),
                'linked_discovered': True,
            }, 'file'))
    if tasks:
        print(f"parser debug linked-file: parsing {len(tasks)} discovered Canvas file(s)", flush=True)
        await asyncio.gather(*tasks)
    pending_linked_canvas_files.clear()


def add_assignment_node(courseid, name, unlockdate='', duedate='', gradepercentage='', description='', problems_arg=None, downloadurl='', canvaspreviewurl='', filechildren=None, lookingfor=None, canvasAssignmentId=''):
    if courseid not in syllabusNodes:
        syllabusNodes[courseid] = syllabusNode(courseid)
    existing = find_assignment_node(
        courseid,
        assignmentname=name,
        canvasAssignmentId=canvasAssignmentId,
    )
    if existing:
        print(
            f"parser debug assignment: updating real assignment course={courseid} assignmentid={existing.assignmentid!r} name={name!r}",
            flush=True
        )
        existing.update(
            unlockdate,
            duedate,
            gradepercentage,
            description,
            problems_arg,
            downloadurl,
            canvaspreviewurl,
            filechildren,
            lookingfor,
            canvasAssignmentId=canvasAssignmentId,
        )
        resolve_assignment_looking_for(courseid, existing)
        register_assignment_urls(existing, courseid)
        return existing.assignmentid
    assignment = assignmentNode(
        name,
        unlockdate,
        duedate,
        gradepercentage,
        description,
        problems_arg,
        downloadurl,
        canvaspreviewurl,
        filechildren,
        lookingfor,
        courseid=courseid,
        canvasAssignmentId=canvasAssignmentId,
    )
    syllabusNodes[courseid].assignments.append(assignment)
    resolve_assignment_looking_for(courseid, assignment)
    register_assignment_urls(assignment, courseid)
    print(
        f"parser debug assignment: created real assignment course={courseid} assignmentid={assignment.assignmentid!r} name={name!r}",
        flush=True
    )
    return assignment.assignmentid


def find_event_node_for_link(courseid, eventNodeId=None, eventname=None):
    if eventNodeId:
        for event in eventNodes.get(courseid, []):
            if event.eventid == eventNodeId:
                return event

    raw_name = str(eventname or '').strip()
    if is_malformed_event_link_name(raw_name):
        raw_name = sanitize_event_link_name(raw_name, canonical_test_event_name)
    candidates = []
    if raw_name:
        candidates.append(raw_name)
    canonical = canonical_test_event_name(raw_name)
    if canonical and canonical not in candidates:
        candidates.append(canonical)
    for name in candidates:
        normalized = name.strip().casefold()
        for event in eventNodes.get(courseid, []):
            if event.name.strip().casefold() == normalized:
                return event
    return None


def find_event_node(courseid, eventNodeId=None, eventname=None):
    normalized_name = str(eventname or "").strip().casefold()
    for event in eventNodes.get(courseid, []):
        if eventNodeId and event.eventid == eventNodeId:
            return event
        if normalized_name and event.name.strip().casefold() == normalized_name:
            return event
    if normalized_name:
        for event in eventNodes.get(courseid, []):
            event_name = event.name.strip().casefold()
            if normalized_name in event_name or event_name in normalized_name:
                return event
    return None


def add_event_node(courseid, name, startdate='', enddate='', gradepercentage='', description='', eventtype='', dependencies=None):
    eventNodes.setdefault(courseid, [])
    eventtype = normalize_event_type(eventtype, name)
    existing = find_event_node(courseid, eventname=name)
    if existing:
        print(
            f"parser debug event: updating event course={courseid} eventid={existing.eventid!r} name={name!r}",
            flush=True
        )
        existing.update(startdate, enddate, gradepercentage, description, eventtype, dependencies or [])
        hydrate_test_event_concepts(courseid, existing)
        return existing.eventid
    event = eventNode(name, startdate, enddate, gradepercentage, description, eventtype, dependencies or [])
    hydrate_test_event_concepts(courseid, event)
    eventNodes[courseid].append(event)
    print(
        f"parser debug event: created event course={courseid} eventid={event.eventid!r} name={name!r}",
        flush=True
    )
    return event.eventid


def add_exam_node(courseid, name, startdate='', enddate='', gradepercentage='', description='', dependencies=None):
    return add_event_node(
        courseid,
        name,
        startdate,
        enddate,
        gradepercentage,
        description,
        'test',
        dependencies or []
    )


def add_syllabus(courseid, classtimes, assignments, other, filechildren=None, filemeta=None, participationgrade=None):
    courseid = normalize_courseid(courseid)
    filemeta = filemeta or {}
    current_file = get_or_create_file_node(courseid, filemeta)
    children = list(filechildren or [])
    if current_file and current_file.fileid not in children:
        children.append(current_file.fileid)
    syllabusNodes[courseid] = syllabusNode(
        courseid,
        classtimes,
        [],
        other,
        children,
        filemeta.get('downloadurl', ''),
        filemeta.get('canvaspreviewurl', ''),
        participationgrade
    )
    for assignment in assignments or []:
        add_assignment_node(
            courseid,
            assignment.get('name', ''),
            assignment.get('unlockdate', ''),
            assignment.get('duedate', ''),
            assignment.get('gradepercentage', ''),
            assignment.get('description', ''),
            None,
            '',
            ''
        )
    allsyllabi[courseid] = syllabusNodes[courseid].to_dict()
    register_syllabus_urls(syllabusNodes[courseid])
    return syllabusNodes[courseid]


def add_file_node(courseid, filemeta, filename='', filetype=''):
    if filename:
        filemeta = {**filemeta, 'name': filename}
    node = get_or_create_file_node(courseid, filemeta)
    if not node:
        return {'status': 'No file metadata found'}
    requested_type = str(filetype or '').strip()
    if requested_type:
        node.type = requested_type
    else:
        classification = classify_study_material_filename(node.name, node.type)
        if classification:
            node.type = classification['filetype']
    resolve_file_against_looking_requests(courseid, node)
    return {'status': 'SUCCESS', 'fileid': node.fileid, 'type': node.type}


def merge_event_pair(courseid, primary, secondary):
    if is_schedulable_date(secondary.startdate) and not is_schedulable_date(primary.startdate):
        primary.startdate = secondary.startdate
    if is_schedulable_date(secondary.enddate) and not is_schedulable_date(primary.enddate):
        primary.enddate = secondary.enddate
    if secondary.gradepercentage and not primary.gradepercentage:
        primary.gradepercentage = secondary.gradepercentage
    if secondary.description:
        if primary.description and secondary.description not in primary.description:
            primary.description = f"{primary.description}\n{secondary.description}".strip()
        elif not primary.description:
            primary.description = secondary.description
    for dependency in secondary.dependencies or []:
        append_unique(primary.dependencies, dependency)
    canonical = canonical_test_event_name(primary.name, primary.type)
    if canonical:
        primary.name = canonical
    primary.type = normalize_event_type(primary.type, primary.name)
    hydrate_test_event_concepts(courseid, primary)


def link_file_to_event(courseid, eventNodeId='', eventname='', fileid='', filetype='study_material'):
    if eventname and is_malformed_event_link_name(eventname):
        sanitized = sanitize_event_link_name(eventname, canonical_test_event_name)
        if sanitized:
            eventname = sanitized
    event = find_event_node_for_link(courseid, eventNodeId=eventNodeId, eventname=eventname)
    if not event:
        return {
            'status': 'No Event Node found',
            'eventNodeId': eventNodeId,
            'eventname': eventname,
        }

    resolved_fileid = str(fileid or '').strip()
    file_node = fileNodes.get(courseid, {}).get(resolved_fileid)
    if not file_node and resolved_fileid:
        for candidate in (fileNodes.get(courseid, {}) or {}).values():
            if str(candidate.fileid) == resolved_fileid or str(candidate.name) == resolved_fileid:
                file_node = candidate
                resolved_fileid = candidate.fileid
                break
    if not file_node:
        return {'status': 'No File Node found', 'fileid': fileid}

    if filetype:
        file_node.type = str(filetype).strip()
    elif not file_node.type:
        classification = classify_study_material_filename(file_node.name)
        if classification:
            file_node.type = classification['filetype']

    linked = graphEdges.add_edge(
        'event',
        event.eventid,
        'file',
        file_node.fileid,
        'requires_reading',
        source='llm',
        metadata={'eventname': event.name, 'filename': file_node.name},
    )
    if linked:
        record_link_action(
            courseid,
            f"Linked file **{file_node.name}** → event **{event.name}** (study material)",
        )
    return {
        'status': 'SUCCESS',
        'eventNodeId': event.eventid,
        'fileid': file_node.fileid,
        'type': file_node.type,
        'linked': linked,
    }


def run_finalize_course_events(courseid):
    cid = normalize_courseid(courseid)
    if not cid:
        return {}

    syllabus = get_syllabus_for_course(cid)
    syllabus_exam_text = build_syllabus_exam_text(
        getattr(syllabus, 'classtimes', '') if syllabus else '',
        getattr(syllabus, 'other', '') if syllabus else '',
        getattr(syllabus, 'assignments', []) if syllabus else [],
    )
    course_logged_events = logged_events.setdefault(cid, [])
    default_year = infer_course_academic_year(cid, syllabus, fileNodes.get(cid, {}))
    previous_year = _date_normalize_context.get('default_year')
    set_date_normalize_context(default_year)

    def merge_pair(primary, secondary):
        merge_event_pair(cid, primary, secondary)
        events = eventNodes.get(cid, [])
        eventNodes[cid] = [event for event in events if event is not secondary]

    def set_file_type(file_node, filetype):
        file_node.type = filetype

    def get_assignments_fn(inner_cid):
        inner_syllabus = get_syllabus_for_course(inner_cid)
        return inner_syllabus.assignments if inner_syllabus else []

    def on_backfill(inner_cid, event_name, startdate, source):
        log_finalize_step(
            inner_cid,
            'backfill',
            event=event_name,
            startdate=startdate,
            source=source,
        )

    undated = [
        event.name
        for event in (eventNodes.get(cid, []) or [])
        if event_needs_date(event)
    ]
    log_finalize_start(
        cid,
        len(syllabus_exam_text or ''),
        default_year,
        undated,
    )

    try:
        stats = finalize_course_events(
            cid,
            event_nodes=eventNodes.get(cid, []),
            file_nodes=fileNodes.get(cid, {}) or {},
            logged_events=course_logged_events,
            graph_edges=graphEdges,
            syllabus_exam_text=syllabus_exam_text,
            add_event_fn=add_event_node,
            add_exam_fn=add_exam_node,
            find_event_fn=find_event_node,
            update_event_fn=merge_pair,
            set_file_type_fn=set_file_type,
            normalize_date_fn=normalize_date,
            get_assignments_fn=get_assignments_fn,
            on_backfill=on_backfill,
            on_syllabus_hint=log_syllabus_hint,
            on_assignment_exam=log_assignment_exam,
        )
    finally:
        set_date_normalize_context(previous_year)

    log_finalize_step(
        cid,
        'promote_logged',
        promoted=stats.get('promoted_logged_events', 0),
        backfilled_logged=stats.get('dates_backfilled_from_logged', 0),
        remaining_logged=len(course_logged_events),
    )
    log_finalize_stats(cid, stats, remaining_logged=len(course_logged_events))
    return stats


def _infer_year_for_event_check(courseid, syllabus_dict, file_nodes):
    class SyllabusObj:
        pass

    syllabus = SyllabusObj()
    syllabus.classtimes = syllabus_dict.get('classtimes', '')
    syllabus.other = syllabus_dict.get('other', '')

    class FakeAssignment:
        def __init__(self, item):
            self.name = item.get('name', '')
            self.duedate = item.get('duedate', '')
            self.unlockdate = item.get('unlockdate', '')

    syllabus.assignments = [FakeAssignment(item) for item in (syllabus_dict.get('assignments') or [])]
    return infer_course_academic_year(courseid, syllabus, file_nodes)


def run_event_pipeline_check():
    if not CANVAS_GRAPH_PATH.exists():
        print('parser event check: skipped (no canvas_graph.json)', flush=True)
        return None
    try:
        canvas_data_path = CANVAS_DATA_PATH if CANVAS_DATA_PATH.exists() else None
        report = check_event_pipeline(
            CANVAS_GRAPH_PATH,
            canvas_data_path=canvas_data_path,
            normalize_date_fn=lambda value, default_year=None: normalize_date(value, default_year=default_year),
            infer_year_fn=_infer_year_for_event_check,
        )
        print(format_report(report), end='')
        return report
    except Exception as error:
        print(f'parser event check failed: {error}', flush=True)
        return None


def run_link_module_items_to_events(courseid):
    cid = normalize_courseid(courseid)
    if not cid:
        return {}

    course_modules = backfill_course_modules_from_hints(
        courseModules.get(cid, {}) or {},
        moduleOrderHints.get(cid, {}) or {},
    )
    courseModules[cid] = course_modules

    stats = link_module_items_to_events(
        cid,
        course_modules,
        moduleOrderHints.get(cid, {}) or {},
        eventNodes.get(cid, []) or [],
        fileNodes.get(cid, {}) or {},
        graphEdges,
        find_assignment_node,
    )
    if any(stats.values()):
        print(
            f"parser debug modules: linked course={cid} stats={json.dumps(stats, ensure_ascii=False)}",
            flush=True,
        )
        record_link_action(cid, f"Module→event linking: {json.dumps(stats, ensure_ascii=False)}")
    return stats


def add_concept_node(courseid, conceptname, description):
    file_id = str(_deepseek_pass_context.get('fileid') or '').strip()
    file_type = str(_deepseek_pass_context.get('academicFileType') or '').strip()
    concept_limit = _parse_time_concept_limit(file_type)
    if file_id:
        same_file = [
            concept for concept in (conceptNodes.get(courseid, []) or [])
            if str((getattr(concept, 'documentOrder', None) or {}).get('fileId') or '') == file_id
        ]
        if len(same_file) >= concept_limit and not parse_heading_numbers(conceptname):
            existing = find_concept_by_name_or_id(courseid, conceptname)
            if existing:
                return existing.conceptid
            if same_file:
                return same_file[0].conceptid
            return ''
    existing = find_concept_by_name_or_id(courseid, conceptname)
    if existing:
        if description and not existing.description:
            existing.description = html_to_text(description)
        heading = parse_heading_numbers(conceptname)
        if heading:
            existing.documentOrder = merge_document_order(
                getattr(existing, 'documentOrder', {}),
                {'heading': heading},
            )
        return existing.conceptid
    nodeid = make_stable_id('concept', courseid, conceptname)
    conceptNodes[courseid] = conceptNodes.get(courseid, [])
    node = conceptNode(courseid, conceptname, nodeid, description)
    heading = parse_heading_numbers(conceptname)
    if heading:
        node.documentOrder = {'heading': heading}
    conceptNodes[courseid].append(node)
    return nodeid


def add_concept_prerequisite_edge(courseid, from_concept_id, to_concept_id, source='llm', confidence=0.85):
    from_concept = find_concept_by_name_or_id(courseid, from_concept_id)
    to_concept = find_concept_by_name_or_id(courseid, to_concept_id)
    if not from_concept or not to_concept:
        return {'status': 'missing concept', 'from': from_concept_id, 'to': to_concept_id}
    append_unique(to_concept.prerequisiteConceptIds, from_concept.conceptid)
    graphEdges.add_edge('concept', from_concept.conceptid, 'concept', to_concept.conceptid, 'prerequisite', confidence=confidence, source=source)
    return {'status': 'SUCCESS', 'from': from_concept.conceptid, 'to': to_concept.conceptid}


def record_module_order_hint(courseid, concept_id, module_id, position):
    hint = {'moduleId': str(module_id), 'position': int(position or 0)}
    concept = find_concept_by_name_or_id(courseid, concept_id)
    if concept:
        if not any(existing.get('moduleId') == hint['moduleId'] for existing in concept.moduleOrderHints):
            concept.moduleOrderHints.append(hint)
    moduleOrderHints.setdefault(courseid, {})
    moduleOrderHints[courseid].setdefault(str(concept_id), []).append(hint)


def embed_text_for_field(label, text):
    if openai_client is None:
        raise RuntimeError("OPENAI_API_KEY is not set")
    start = time.perf_counter()
    print(f"parser debug embedding: request start field={label}", flush=True)
    response = openai_client.embeddings.create(
        input=text,
        model="text-embedding-3-small"
    )
    elapsed = time.perf_counter() - start
    print(f"parser debug embedding: request done field={label} seconds={elapsed:.2f}", flush=True)
    return response.data[0].embedding


def embed_texts_for_fields(batch):
    if not batch:
        return []
    if openai_client is None:
        raise RuntimeError("OPENAI_API_KEY is not set")
    start = time.perf_counter()
    labels = [item['label'] for item in batch]
    print(
        f"parser debug embedding: batch request start count={len(batch)} fields={', '.join(labels[:4])}"
        f"{'...' if len(labels) > 4 else ''}",
        flush=True
    )
    response = openai_client.embeddings.create(
        input=[item['text'] for item in batch],
        model="text-embedding-3-small"
    )
    elapsed = time.perf_counter() - start
    print(
        f"parser debug embedding: batch request done count={len(batch)} seconds={elapsed:.2f}",
        flush=True
    )
    return [
        item.embedding
        for item in sorted(response.data, key=lambda item: item.index)
    ]


def embed_concept_node(name, description):
    embedded_name = embed_text_for_field("concept.name", name)
    embedded_description = embed_text_for_field("concept.description", description)
    return {'name': np.array(embedded_name), 'description': np.array(embedded_description)}


def embed_example_node(name, description):
    embedded_name = embed_text_for_field("example.name", name)
    embedded_description = embed_text_for_field("example.description", description)
    return {'name': embedded_name, 'description': embedded_description}


def embed_problem_node(name, description):
    embedded_name = embed_text_for_field("problem.name", name)
    embedded_description = embed_text_for_field("problem.description", description)
    return {'name': embedded_name, 'description': embedded_description}


def embed_detail_node(name, description):
    embedded_name = embed_text_for_field("detail.name", name)
    embedded_description = embed_text_for_field("detail.description", description)
    return {'name': embedded_name, 'description': embedded_description}


def embed_named_description(name, description):
    cache_key = 'named_description:' + hashlib.sha256(
        json.dumps(
            {'name': str(name or ''), 'description': str(description or '')},
            ensure_ascii=False,
            sort_keys=True
        ).encode('utf-8')
    ).hexdigest()
    if cache_key in embedding_cache:
        return embedding_cache[cache_key]
    embedded = embed_detail_node(str(name or ''), str(description or ''))
    embedding_cache[cache_key] = embedded
    return embedded


def embedding_cache_key(embed_func, name, description):
    payload = json.dumps(
        {
            'helper': embed_func.__name__,
            'name': str(name or ''),
            'description': str(description or '')
        },
        ensure_ascii=False,
        sort_keys=True
    )
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def load_embedding_cache_from_disk():
    if os.getenv('PARSER_SKIP_EMBEDDING_CACHE', '').strip().casefold() in {'1', 'true', 'yes', 'on'}:
        print('parser embedding cache load skipped', flush=True)
        return
    if not EMBEDDING_CACHE_PATH.exists():
        return
    try:
        with open(EMBEDDING_CACHE_PATH, 'r', encoding='utf-8') as file:
            data = json.load(file)
    except (json.JSONDecodeError, OSError) as error:
        print(f"parser debug embedding: could not load embedding cache: {error}", flush=True)
        return
    if not isinstance(data, dict):
        print("parser debug embedding: ignored embedding cache because it is not an object", flush=True)
        return
    embedding_cache.update(data)
    print(f"parser debug embedding: loaded cached embeddings count={len(data)}", flush=True)


def write_embedding_cache_to_disk():
    if os.getenv('PARSER_SKIP_EMBEDDING_CACHE', '').strip().casefold() in {'1', 'true', 'yes', 'on'}:
        return
    try:
        atomic_write_json(EMBEDDING_CACHE_PATH, embedding_cache)
    except OSError as error:
        print(f"parser debug embedding: could not write embedding cache: {error}", flush=True)


def load_course_name_cache():
    global course_name_cache
    if course_name_cache is not None:
        return course_name_cache

    course_name_cache = {}
    try:
        with open(CANVAS_DATA_PATH, 'r', encoding='utf-8') as file:
            data = json.load(file)
    except (NameError, json.JSONDecodeError, OSError) as error:
        print(f"parser debug embedding: could not load course names: {error}", flush=True)
        return course_name_cache

    for course in data.get('courses', []) or []:
        if not isinstance(course, dict):
            continue
        courseid = course.get('id')
        if courseid is None:
            continue
        name = course.get('name') or course.get('course_code') or ''
        if name:
            course_name_cache[str(courseid)] = str(name)
    return course_name_cache


def get_course_display_name(courseid):
    course_names = load_course_name_cache()
    return course_names.get(str(courseid or ''), '')


def course_scoped_embedding_name(courseid, name):
    name = str(name or '').strip()
    course_name = get_course_display_name(courseid)
    if course_name:
        return f"{course_name}: {name}" if name else course_name
    if courseid:
        return f"Course {courseid}: {name}" if name else f"Course {courseid}"
    return name


def has_complete_embedding(node):
    embedded = getattr(node, 'embedded', None)
    if not isinstance(embedded, dict):
        return False
    name_embedding = embedded.get('name')
    description_embedding = embedded.get('description')
    try:
        return len(name_embedding) > 0 and len(description_embedding) > 0
    except TypeError:
        return False


def embedding_labels_for_helper(embed_func):
    helper_name = getattr(embed_func, '__name__', '')
    if helper_name == 'embed_concept_node':
        return 'concept.name', 'concept.description'
    if helper_name == 'embed_example_node':
        return 'example.name', 'example.description'
    if helper_name == 'embed_problem_node':
        return 'problem.name', 'problem.description'
    if helper_name == 'embed_detail_node':
        return 'detail.name', 'detail.description'
    return 'named_description.name', 'named_description.description'


def make_embedding_task(node, embed_func, name, description, force=False):
    if not force and has_complete_embedding(node):
        return None
    name = html_to_text(name)
    description = html_to_text(description)
    cache_key = embedding_cache_key(embed_func, name, description)
    if cache_key in embedding_cache:
        node.embedded = embedding_cache[cache_key]
        print(
            f"parser debug embedding: cache hit helper={embed_func.__name__} node={getattr(node, 'name', '')!r}",
            flush=True
        )
        return None
    return {
        'node': node,
        'embed_func': embed_func,
        'name': name,
        'description': description,
        'cache_key': cache_key,
        'embedded': {},
        'complete': False
    }


def chunks(items, size):
    size = max(1, int(size or 1))
    for index in range(0, len(items), size):
        yield items[index:index + size]


def finish_completed_embedding_tasks(tasks):
    wrote_cache = False
    for task in tasks:
        if task['complete']:
            continue
        embedded = task['embedded']
        if 'name' not in embedded or 'description' not in embedded:
            continue
        result = {
            'name': embedded['name'],
            'description': embedded['description']
        }
        embedding_cache[task['cache_key']] = result
        nodes = task.get('nodes') or [task['node']]
        for node in nodes:
            node.embedded = result
        task['complete'] = True
        wrote_cache = True
        label = getattr(task['node'], 'name', '')
        suffix = f" copies={len(nodes)}" if len(nodes) > 1 else ''
        print(
            f"parser debug embedding: embedded helper={task['embed_func'].__name__} node={label!r}{suffix}",
            flush=True
        )
    if wrote_cache:
        write_embedding_cache_to_disk()


def _build_embedding_requests(items, batch_size=OPENAI_EMBEDDING_BATCH_SIZE):
    tasks = []
    task_by_cache_key = {}
    for item in items:
        node, embed_func, name, description, *rest = item
        force = bool(rest[0]) if rest else False
        if not force and has_complete_embedding(node):
            continue
        name = html_to_text(name)
        description = html_to_text(description)
        cache_key = embedding_cache_key(embed_func, name, description)
        if cache_key in embedding_cache:
            node.embedded = embedding_cache[cache_key]
            print(
                f"parser debug embedding: cache hit helper={embed_func.__name__} node={getattr(node, 'name', '')!r}",
                flush=True
            )
            continue
        if cache_key in task_by_cache_key:
            task_by_cache_key[cache_key]['nodes'].append(node)
            continue
        task = {
            'node': node,
            'nodes': [node],
            'embed_func': embed_func,
            'name': name,
            'description': description,
            'cache_key': cache_key,
            'embedded': {},
            'complete': False,
        }
        task_by_cache_key[cache_key] = task
        tasks.append(task)
        print(
            f"parser debug embedding: queued helper={embed_func.__name__} node={getattr(node, 'name', '')!r}",
            flush=True
        )
    if not tasks:
        return tasks, []

    requests = []
    for task in tasks:
        name_label, description_label = embedding_labels_for_helper(task['embed_func'])
        requests.append({
            'task': task,
            'field': 'name',
            'label': name_label,
            'text': task['name']
        })
        requests.append({
            'task': task,
            'field': 'description',
            'label': description_label,
            'text': task['description']
        })
    return tasks, list(chunks(requests, batch_size))


async def safe_embed_nodes_async(items, batch_size=OPENAI_EMBEDDING_BATCH_SIZE):
    tasks, request_batches = _build_embedding_requests(items, batch_size)
    if not tasks:
        return

    embed_semaphore = asyncio.Semaphore(EMBED_MAX_CONCURRENT)

    async def run_request_batch(request_batch):
        async with embed_semaphore:
            started = time.perf_counter()
            loop = asyncio.get_running_loop()
            try:
                embeddings = await loop.run_in_executor(
                    parse_io_executor,
                    lambda: embed_texts_for_fields(request_batch)
                )
                for request, embedding in zip(request_batch, embeddings):
                    request['task']['embedded'][request['field']] = embedding
                finish_completed_embedding_tasks(tasks)
            except Exception as error:
                for request in request_batch:
                    node = request['task']['node']
                    print(
                        f"parser debug embedding: failed node={getattr(node, 'name', '')!r} "
                        f"helper={request['task']['embed_func'].__name__} error={error}",
                        flush=True
                    )
                    if not hasattr(node, 'embedded'):
                        node.embedded = {}
            finally:
                record_phase_time('embed_ms', started)

    await asyncio.gather(*[run_request_batch(request_batch) for request_batch in request_batches])


def safe_embed_nodes(items, batch_size=OPENAI_EMBEDDING_BATCH_SIZE):
    tasks, request_batches = _build_embedding_requests(items, batch_size)
    if not tasks:
        return

    for request_batch in request_batches:
        try:
            embeddings = embed_texts_for_fields(request_batch)
            for request, embedding in zip(request_batch, embeddings):
                request['task']['embedded'][request['field']] = embedding
            finish_completed_embedding_tasks(tasks)
        except Exception as error:
            for request in request_batch:
                node = request['task']['node']
                print(
                    f"parser debug embedding: failed node={getattr(node, 'name', '')!r} "
                    f"helper={request['task']['embed_func'].__name__} error={error}",
                    flush=True
                )
                if not hasattr(node, 'embedded'):
                    node.embedded = {}


def safe_embed_node(node, embed_func, name, description, force=False):
    task = make_embedding_task(node, embed_func, name, description, force)
    if not task:
        return
    try:
        print(
            f"parser debug embedding: embedding helper={embed_func.__name__} node={getattr(node, 'name', '')!r}",
            flush=True
        )
        name_label, description_label = embedding_labels_for_helper(embed_func)
        embeddings = embed_texts_for_fields([
            {'label': name_label, 'text': task['name']},
            {'label': description_label, 'text': task['description']}
        ])
        embedded = {
            'name': embeddings[0],
            'description': embeddings[1]
        }
        embedding_cache[task['cache_key']] = embedded
        node.embedded = embedded
        write_embedding_cache_to_disk()
        print(
            f"parser debug embedding: embedded helper={embed_func.__name__} node={getattr(node, 'name', '')!r}",
            flush=True
        )
    except Exception as error:
        print(
            f"parser debug embedding: failed node={getattr(node, 'name', '')!r} helper={embed_func.__name__} error={error}",
            flush=True
        )
        if not hasattr(node, 'embedded'):
            node.embedded = {}


def _collect_file_embedding_tasks():
    if openai_client is None:
        return None

    concept_count = sum(len(course_nodes) for course_nodes in conceptNodes.values())
    detail_count = sum(len(concept.details) for course_nodes in conceptNodes.values() for concept in course_nodes)
    example_count = sum(len(concept.examples) for course_nodes in conceptNodes.values() for concept in course_nodes)
    problem_count = sum(len(course_problems) for course_problems in problems.values())
    syllabus_count = len(syllabusNodes)
    file_count = sum(len(course_files) for course_files in fileNodes.values())
    event_count = sum(len(course_events) for course_events in eventNodes.values())
    print(
        "parser debug embedding: files/concepts pass start "
        f"concepts={concept_count} details={detail_count} examples={example_count} "
        f"problems={problem_count} syllabi={syllabus_count} files={file_count} events={event_count}",
        flush=True
    )

    concept_tasks = []
    for course_nodes in conceptNodes.values():
        for concept in course_nodes:
            concept_tasks.append((concept, embed_concept_node, concept.name, concept.description))
            for detail in concept.details:
                concept_tasks.append((detail, embed_detail_node, detail.name, detail.description))
            for example in concept.examples:
                concept_tasks.append((example, embed_example_node, example.name, example.description))

    problem_tasks = []
    for course_problems in problems.values():
        for problem in course_problems:
            description = ' '.join([*(problem.steps or []), str(problem.answer or '')])
            problem_tasks.append((problem, embed_problem_node, problem.name, description))

    syllabus_tasks = [
        (syllabus, embed_named_description, syllabus.courseid, syllabus.other)
        for syllabus in syllabusNodes.values()
    ]

    ensure_all_file_page_blocks()

    file_tasks = []
    for course_files in fileNodes.values():
        for file_node in course_files.values():
            file_tasks.append((
                file_node,
                embed_named_description,
                course_scoped_embedding_name(file_node.courseid, file_node.name or file_node.fileid),
                file_node_embedding_description(file_node),
                True
            ))

    event_tasks = []
    for course_events in eventNodes.values():
        for event in course_events:
            description = ' '.join([
                str(event.description or ''),
                str(event.type or ''),
                ' '.join(event.dependencies or [])
            ])
            event_tasks.append((event, embed_named_description, event.name, description))

    return concept_tasks, problem_tasks, syllabus_tasks, file_tasks, event_tasks


async def embed_all_file_text_chunks_async(force=False):
    if openai_client is None:
        print("parser debug embedding: skipped chunk embeddings (OPENAI_API_KEY missing)", flush=True)
        return 0
    pending = []
    for course_files in fileNodes.values():
        for file_node in course_files.values():
            persist_file_node_text_chunks(file_node)
            pending.extend(collect_chunks_needing_embedding(file_node, max_chunks=CHUNK_EMBED_MAX))
    if not pending:
        return 0
    print(f"parser debug embedding: chunk pass start count={len(pending)}", flush=True)
    embedded_count = 0
    loop = asyncio.get_running_loop()
    embed_semaphore = asyncio.Semaphore(EMBED_MAX_CONCURRENT)

    async def run_batch(batch):
        nonlocal embedded_count
        async with embed_semaphore:
            started = time.perf_counter()
            try:
                vectors = await loop.run_in_executor(
                    parse_io_executor,
                    lambda: embed_texts_for_fields([
                        {'label': 'chunk.text', 'text': payload}
                        for _chunk, payload in batch
                    ]),
                )
                apply_chunk_embeddings(batch, vectors)
                embedded_count += len(batch)
            except Exception as error:
                print(f"parser debug embedding: chunk batch failed error={error}", flush=True)
            finally:
                record_phase_time('embed_ms', started)

    await asyncio.gather(*[
        run_batch(batch)
        for batch in chunks(pending, OPENAI_EMBEDDING_BATCH_SIZE)
    ])
    print(f"parser debug embedding: chunk pass complete count={embedded_count}", flush=True)
    return embedded_count


def embed_all_file_text_chunks_sync(force=False):
    if openai_client is None:
        print("parser debug embedding: skipped chunk embeddings (OPENAI_API_KEY missing)", flush=True)
        return 0
    pending = []
    for course_files in fileNodes.values():
        for file_node in course_files.values():
            persist_file_node_text_chunks(file_node)
            pending.extend(collect_chunks_needing_embedding(file_node, max_chunks=CHUNK_EMBED_MAX))
    if not pending:
        return 0
    print(f"parser debug embedding: chunk pass start count={len(pending)}", flush=True)
    embedded_count = 0
    for batch in chunks(pending, OPENAI_EMBEDDING_BATCH_SIZE):
        try:
            vectors = embed_texts_for_fields([
                {'label': 'chunk.text', 'text': payload}
                for _chunk, payload in batch
            ])
            apply_chunk_embeddings(batch, vectors)
            embedded_count += len(batch)
        except Exception as error:
            print(f"parser debug embedding: chunk batch failed error={error}", flush=True)
    print(f"parser debug embedding: chunk pass complete count={embedded_count}", flush=True)
    return embedded_count


async def _run_file_embedding_tasks_async():
    tasks = _collect_file_embedding_tasks()
    if tasks is None:
        print("parser debug embedding: skipped file/concept embeddings (OPENAI_API_KEY missing)", flush=True)
        return
    concept_tasks, problem_tasks, syllabus_tasks, file_tasks, event_tasks = tasks

    print("parser debug embedding: concepts start", flush=True)
    await safe_embed_nodes_async(concept_tasks)
    print("parser debug embedding: problems start", flush=True)
    await safe_embed_nodes_async(problem_tasks)
    print("parser debug embedding: syllabi start", flush=True)
    await safe_embed_nodes_async(syllabus_tasks)
    print("parser debug embedding: files start", flush=True)
    await safe_embed_nodes_async(file_tasks)
    print("parser debug embedding: file text chunks start", flush=True)
    await embed_all_file_text_chunks_async()
    print("parser debug embedding: events start", flush=True)
    await safe_embed_nodes_async(event_tasks)
    print("parser debug embedding: files/concepts pass complete", flush=True)


def _run_file_embedding_tasks_sync():
    tasks = _collect_file_embedding_tasks()
    if tasks is None:
        print("parser debug embedding: skipped file/concept embeddings (OPENAI_API_KEY missing)", flush=True)
        return
    concept_tasks, problem_tasks, syllabus_tasks, file_tasks, event_tasks = tasks

    print("parser debug embedding: concepts start", flush=True)
    safe_embed_nodes(concept_tasks)
    print("parser debug embedding: problems start", flush=True)
    safe_embed_nodes(problem_tasks)
    print("parser debug embedding: syllabi start", flush=True)
    safe_embed_nodes(syllabus_tasks)
    print("parser debug embedding: files start", flush=True)
    safe_embed_nodes(file_tasks)
    print("parser debug embedding: file text chunks start", flush=True)
    embed_all_file_text_chunks_sync()
    print("parser debug embedding: events start", flush=True)
    safe_embed_nodes(event_tasks)
    print("parser debug embedding: files/concepts pass complete", flush=True)


async def update_file_embedded_fields_async():
    await _run_file_embedding_tasks_async()


def update_file_embedded_fields():
    _run_file_embedding_tasks_sync()


def update_assignment_embedded_fields(force=False):
    if openai_client is None:
        assignment_count = sum(len(syllabus.assignments) for syllabus in syllabusNodes.values())
        print(
            f"parser debug embedding: skipped assignment embeddings count={assignment_count} "
            "(OPENAI_API_KEY missing)",
            flush=True
        )
        return

    assignment_tasks = []
    for courseid, syllabus in syllabusNodes.items():
        for assignment in syllabus.assignments:
            assignment_tasks.append((
                assignment,
                embed_named_description,
                course_scoped_embedding_name(courseid, assignment.name),
                html_to_text(assignment.description or ''),
                force,
            ))
    print(
        f"parser debug embedding: assignments start count={len(assignment_tasks)} force={force}",
        flush=True
    )
    safe_embed_nodes(assignment_tasks)
    print("parser debug embedding: assignments complete", flush=True)


async def update_embedded_fields_async():
    print("parser debug embedding: start", flush=True)
    await update_file_embedded_fields_async()
    update_assignment_embedded_fields()
    print("parser debug embedding: complete", flush=True)


def update_embedded_fields():
    print("parser debug embedding: start", flush=True)
    update_file_embedded_fields()
    update_assignment_embedded_fields()
    print("parser debug embedding: complete", flush=True)


def on_file_parsing_finished():
    update_file_embedded_fields()
    write_state()


def on_assignment_summaries_finished():
    update_assignment_embedded_fields()
    write_state()


def log_detail(courseid, conceptname, detailname, description, filemeta=None):
    if courseid not in logged_details:
        logged_details[courseid] = []
    detail_name = str(detailname or '').strip()
    concept_name = str(conceptname or '').strip()
    detail_text = str(description or '').strip()
    if not detail_name or detail_name.casefold() == concept_name.casefold():
        return
    if len(detail_text) < 24:
        return
    file_id = make_fileid(filemeta or {})
    concept_key = concept_name.casefold()
    same_file = [
        item for item in logged_details[courseid]
        if str(item.get('conceptname') or '').strip().casefold() == concept_key
        and str(item.get('sourceFileId') or '') == file_id
    ]
    if len(same_file) >= 2:
        return
    if any(str(item.get('detailname') or '').strip().casefold() == detail_name.casefold() for item in same_file):
        return
    logged_details[courseid].append({
        'conceptname': conceptname,
        'detailname': detailname,
        "description": description,
        'sourceFileId': file_id
    })


def log_example(courseid, conceptname, examplename, description, filemeta=None):
    if courseid not in logged_examples:
        logged_examples[courseid] = []
    logged_examples[courseid].append({
        'conceptname': conceptname,
        'examplename': examplename,
        "description": description,
        'sourceFileId': make_fileid(filemeta or {})
    })


def log_problem(courseid, problemname, incomingConceptNames, outgoingConceptNames, steps, answer, filemeta=None):
    if courseid not in logged_problems:
        logged_problems[courseid] = []
    logged_problems[courseid].append({
        'problemname': problemname,
        'incomingConceptNames': incomingConceptNames,
        'outgoingConceptNames': outgoingConceptNames,
        'steps': steps,
        'answer': answer,
        'sourceFileId': make_fileid(filemeta or {})
    })


def log_assignment(courseid, assignmentname, unlockdate='', duedate='', gradepercentage='', description='', problemnames=None, filemeta=None, filechildren=None, lookingfor=None):
    print(
        f"parser debug assignment: log_assignment course={courseid} name={assignmentname!r} due={duedate!r}",
        flush=True
    )
    if courseid not in logged_assignments:
        logged_assignments[courseid] = []
    logged_assignments[courseid].append({
        'assignmentname': assignmentname,
        'unlockdate': normalize_date(unlockdate),
        'duedate': normalize_date(duedate),
        'gradepercentage': gradepercentage,
        'description': html_to_text(description),
        'problemnames': problemnames or [],
        'filechildren': filechildren or [],
        'lookingfor': lookingfor or [],
        'downloadurl': (filemeta or {}).get('downloadurl', ''),
        'canvaspreviewurl': (filemeta or {}).get('canvaspreviewurl', ''),
        'sourceFileId': make_fileid(filemeta or {}),
    })
    add_assignment_node(
        courseid,
        assignmentname,
        unlockdate,
        duedate,
        gradepercentage,
        description,
        [],
        (filemeta or {}).get('downloadurl', ''),
        (filemeta or {}).get('canvaspreviewurl', ''),
        filechildren or [],
        lookingfor or []
    )


def log_event(courseid, eventname, startdate='', enddate='', gradepercentage='', description='', eventtype='', dependencies=None, filemeta=None):
    print(
        f"parser debug event: log_event course={courseid} name={eventname!r} start={startdate!r} end={enddate!r}",
        flush=True
    )
    if courseid not in logged_events:
        logged_events[courseid] = []
    logged_events[courseid].append({
        'eventname': eventname,
        'startdate': normalize_event_date(startdate),
        'enddate': normalize_event_date(enddate),
        'gradepercentage': normalize_gradepercentage(gradepercentage),
        'description': html_to_text(description),
        'type': normalize_event_type(eventtype, eventname),
        'dependencies': dependencies or [],
        'sourceFileId': make_fileid(filemeta or {}),
    })


def remove_log_detail(courseid, detailname):
    bucket = logged_details.get(courseid) or []
    for i in range(len(bucket)):
        if bucket[i]['detailname'] == detailname:
            del bucket[i]
            logged_details[courseid] = bucket
            return f"succesfully deleted detail with name {detailname} from log"
    return f"did not find detail with name {detailname} in log"


def add_detail_node(courseid, conceptNodeId, detailname, description):
    conceptNode = None
    for node in conceptNodes.get(courseid, []):
        if node.conceptid == conceptNodeId:
            conceptNode = node
            break
    if conceptNode:
        detailname = str(detailname or '').strip()
        if any(existing.name == detailname for existing in conceptNode.details):
            return {
                'status': 'SUCCESS',
                'detailid': make_child_node_ref('detail', conceptNodeId, detailname),
                'duplicate': True,
            }
        conceptNode.details.append(detailNode(detailname, description))
        return {
            'status': 'SUCCESS',
            'detailid': make_child_node_ref('detail', conceptNodeId, detailname)
        }
    return {'status': 'No Concept Node found'}


def add_example_node(courseid, conceptNodeId, examplename, description):
    conceptNode = None
    for node in conceptNodes.get(courseid, []):
        if node.conceptid == conceptNodeId:
            conceptNode = node
            break
    if conceptNode:
        conceptNode.examples.append(exampleNode(examplename, description))
        return {
            'status': 'SUCCESS',
            'exampleid': make_child_node_ref('example', conceptNodeId, examplename)
        }
    return {'status': 'No Concept Node found'}


def get_concept_list(courseid):
    concepts = []
    for node in conceptNodes.get(courseid, []):
        concepts.append([node.name, node.conceptid, node.description])
    return concepts


def find_concept_by_name_or_id(courseid, value):
    value = str(value or '').strip()
    if not value:
        return None
    for node in conceptNodes.get(courseid, []):
        if str(node.conceptid) == value or node.name == value:
            return node
    lowered = value.casefold()
    for node in conceptNodes.get(courseid, []):
        if str(node.name or '').casefold() == lowered:
            return node
    for node in conceptNodes.get(courseid, []):
        if heading_concepts_match(value, node.name) or names_match(value, node.name, threshold=0.88):
            return node
    return None


def find_problem_by_id(courseid, problemid):
    problemid = str(problemid or '').strip()
    if not problemid:
        return None
    for problem in problems.get(courseid, []) or []:
        if str(problem.problemid) == problemid:
            return problem
    return None


def compact_example_snapshot(example):
    return {
        'name': example.name,
        'description': example.description
    }


def compact_problem_snapshot(problem):
    return {
        'name': problem.name,
        'problemid': problem.problemid,
        'steps': problem.steps,
        'answer': problem.answer,
        'incomingConceptNodeIds': problem.incomingConceptNodeIds,
        'outgoingConceptNodeIds': problem.outgoingConceptNodeIds
    }


def concept_test_snapshot(courseid, concept):
    return {
        'name': concept.name,
        'conceptid': concept.conceptid,
        'description': concept.description,
        'examples': [compact_example_snapshot(example) for example in concept.examples],
        'problems': [
            compact_problem_snapshot(problem)
            for problemid in concept.problems
            for problem in [find_problem_by_id(courseid, problemid)]
            if problem
        ]
    }


def resolve_event_dependency_concepts(courseid, dependencies):
    resolved = []
    seen = set()
    for dependency in dependencies or []:
        concept = find_concept_by_name_or_id(courseid, dependency)
        if not concept or concept.conceptid in seen:
            continue
        seen.add(concept.conceptid)
        resolved.append(concept_test_snapshot(courseid, concept))
    return resolved


def hydrate_test_event_concepts(courseid, event):
    if normalize_event_type(getattr(event, 'type', ''), getattr(event, 'name', '')) != 'test':
        event.coveredConcepts = []
        return
    event.type = 'test'
    event.coveredConcepts = resolve_event_dependency_concepts(courseid, event.dependencies)


def attach_logged_nodes_to_file(courseid, filemeta):
    current_file = get_or_create_file_node(courseid, filemeta)
    fileid = make_fileid(filemeta)
    if not current_file or not fileid:
        return

    for item in logged_items_for_file(courseid, fileid, logged_details.get(courseid, [])):
        concept = find_concept_by_name_or_id(courseid, item.get('conceptname', ''))
        if not concept:
            continue
        for detail in concept.details:
            if detail.name == item.get('detailname', ''):
                append_unique(current_file.details, make_child_node_ref('detail', concept.conceptid, detail.name))

    for item in logged_items_for_file(courseid, fileid, logged_examples.get(courseid, [])):
        concept = find_concept_by_name_or_id(courseid, item.get('conceptname', ''))
        if not concept:
            continue
        for example in concept.examples:
            if example.name == item.get('examplename', ''):
                append_unique(current_file.examples, make_child_node_ref('example', concept.conceptid, example.name))

    for item in logged_items_for_file(courseid, fileid, logged_problems.get(courseid, [])):
        for problem in problems.get(courseid, []) or []:
            if problem.name == item.get('problemname', ''):
                append_unique(current_file.problems, problem.problemid)

    for concept in conceptNodes.get(courseid, []) or []:
        if concept.conceptid in current_file.concepts:
            for detail in concept.details:
                append_unique(current_file.details, make_child_node_ref('detail', concept.conceptid, detail.name))
            for example in concept.examples:
                append_unique(current_file.examples, make_child_node_ref('example', concept.conceptid, example.name))
            for problemid in concept.problems:
                append_unique(current_file.problems, problemid)


def finalize_file_logged_nodes(courseid, filemeta):
    attach_logged_nodes_to_file(courseid, filemeta)
    current_file = get_or_create_file_node(courseid, filemeta)
    fileid = make_fileid(filemeta)
    if current_file and fileid:
        file_type = str(getattr(current_file, 'academicFileType', None) or filemeta.get('academicFileType') or '')
        if file_type in {'lecture_slides', 'lecture_notes'}:
            promoted = promote_lecture_slides_for_file(
                courseid,
                fileid,
                current_file,
                add_concept_node=add_concept_node,
                find_concept=find_concept_by_name_or_id,
                add_detail_node=add_detail_node,
            )
            if promoted:
                print(
                    f"parser: promoted {promoted} lecture section concept(s) file={fileid} course={courseid}",
                    flush=True,
                )
        elif file_type == 'textbook_chapter':
            promoted = promote_textbook_extractions_for_file(
                courseid,
                fileid,
                current_file,
                add_concept_node=add_concept_node,
                find_concept=find_concept_by_name_or_id,
                add_detail_node=add_detail_node,
            )
            if promoted:
                print(
                    f"parser: promoted {promoted} textbook concept(s) file={fileid} course={courseid}",
                    flush=True,
                )
        course_concepts = conceptNodes.get(courseid, []) or []
        promoted_logs = promote_logged_teaching_for_file(
            courseid,
            fileid,
            course_concepts,
            logged_details,
            logged_examples,
            logged_problems,
            add_detail_node=add_detail_node,
            add_example_node=add_example_node,
            add_problem_node=add_problem_node,
        )
        if any(promoted_logs.values()):
            print(
                f"parser: promoted logged teaching file={fileid} course={courseid} "
                f"details={promoted_logs.get('details', 0)} "
                f"examples={promoted_logs.get('examples', 0)} "
                f"problems={promoted_logs.get('problems', 0)}",
                flush=True,
            )
        attach_logged_nodes_to_file(courseid, filemeta)
    clear_teaching_logged_items_for_file(courseid, fileid)


def finalize_file_events(courseid, filemeta):
    cid = normalize_courseid(courseid)
    if PARSER_DEFER_PER_FILE_FINALIZE:
        if cid:
            _deferred_course_finalize.add(cid)
    else:
        run_finalize_course_events(courseid)
    clear_logged_events_for_file(courseid, make_fileid(filemeta))


def defer_course_module_link(courseid):
    cid = normalize_courseid(courseid)
    if not cid:
        return
    if PARSER_DEFER_PER_FILE_FINALIZE:
        _deferred_course_finalize.add(cid)
    else:
        run_link_module_items_to_events(courseid)


def flush_deferred_course_finalize(course_ids=None):
    if not PARSER_DEFER_PER_FILE_FINALIZE or not _deferred_course_finalize:
        return
    allowed = None
    if course_ids:
        allowed = {
            normalize_courseid(course_id)
            for course_id in course_ids
            if normalize_courseid(course_id)
        }
    targets = sorted(
        _deferred_course_finalize if allowed is None else _deferred_course_finalize & allowed
    )
    for cid in targets:
        run_finalize_course_events(cid)
        run_link_module_items_to_events(cid)
        _deferred_course_finalize.discard(cid)


def run_post_file_course_hooks(courseid, filemeta):
    finalize_file_events(courseid, filemeta)
    defer_course_module_link(courseid)


def find_detail_by_ref(courseid, ref):
    parts = str(ref or '').split(':', 2)
    if len(parts) == 3 and parts[0] == 'detail':
        concept = find_concept_by_name_or_id(courseid, parts[1])
        if concept:
            for detail in concept.details:
                if detail.name == parts[2]:
                    return detail
    return None


def find_example_by_ref(courseid, ref):
    parts = str(ref or '').split(':', 2)
    if len(parts) == 3 and parts[0] == 'example':
        concept = find_concept_by_name_or_id(courseid, parts[1])
        if concept:
            for example in concept.examples:
                if example.name == parts[2]:
                    return example
    return None


def normalize_file_node_links(courseid, file_node):
    detail_refs = []
    example_refs = []
    for concept in conceptNodes.get(courseid, []) or []:
        for detail in concept.details:
            detail_ref = make_child_node_ref('detail', concept.conceptid, detail.name)
            if detail_ref in file_node.details or detail.name in file_node.details:
                append_unique(detail_refs, detail_ref)
        for example in concept.examples:
            example_ref = make_child_node_ref('example', concept.conceptid, example.name)
            if example_ref in file_node.examples or example.name in file_node.examples:
                append_unique(example_refs, example_ref)
    file_node.details = detail_refs
    file_node.examples = example_refs


def add_problem_node(courseid, problemname, incomingConceptNodeIds, outgoingConceptNodeIds, steps, answer, assignmentNodeIds=None):
    problems.setdefault(courseid, [])
    incomingConceptNodeIds = incomingConceptNodeIds or []
    outgoingConceptNodeIds = outgoingConceptNodeIds or []
    assignmentNodeIds = assignmentNodeIds or []
    problemid = problemname + 'id'
    problems[courseid].append(problemNode(problemname, problemid, incomingConceptNodeIds, outgoingConceptNodeIds, steps, answer, assignmentNodeIds))
    for node in conceptNodes.get(courseid, []):
        if node.conceptid in incomingConceptNodeIds and problemid not in node.problems:
            node.problems.append(problemid)
    for assignmentNodeId in assignmentNodeIds:
        assignment = find_assignment_node(courseid, assignmentNodeId=assignmentNodeId)
        if assignment and problemid not in assignment.problems:
            assignment.problems.append(problemid)
    return {'status': 'SUCCESS', 'problemid': problemid}


def update_assignment_node(courseid, assignmentNodeId='', assignmentname='', unlockdate='', duedate='', gradepercentage='', description='', problemids=None, filemeta=None, filechildren=None, lookingfor=None):
    assignment = find_assignment_node(courseid, assignmentNodeId=assignmentNodeId, assignmentname=assignmentname)
    if not assignment:
        return {'status': 'No Assignment Node found', 'assignmentNodeId': assignmentNodeId, 'assignmentname': assignmentname}
    assignment.update(
        unlockdate,
        duedate,
        gradepercentage,
        description,
        problemids or [],
        (filemeta or {}).get('downloadurl', ''),
        (filemeta or {}).get('canvaspreviewurl', ''),
        filechildren or [],
        lookingfor or []
    )
    resolve_assignment_looking_for(courseid, assignment)
    return {'status': 'SUCCESS', 'assignmentNodeId': assignment.assignmentid}


def update_event_node(courseid, eventNodeId='', eventname='', startdate='', enddate='', gradepercentage='', description='', eventtype='', dependencies=None):
    event = find_event_node(courseid, eventNodeId=eventNodeId, eventname=eventname)
    if not event:
        return {'status': 'No Event Node found', 'eventNodeId': eventNodeId, 'eventname': eventname}
    event.update(startdate, enddate, gradepercentage, description, eventtype, dependencies or [])
    hydrate_test_event_concepts(courseid, event)
    return {'status': 'SUCCESS', 'eventNodeId': event.eventid}


def add_learning_block(courseid, concept_id, explanation='', detail_refs=None, example_refs=None, practice_problem_ids=None, source_refs=None, order=None):
    concept = find_concept_by_name_or_id(courseid, concept_id)
    if not concept:
        return {'status': 'missing concept', 'conceptId': concept_id}
    block_order = order or (len(learningBlocks.get(courseid, [])) + 1)
    block = learningBlock(
        block_id=f"{courseid}-{concept.conceptid}-block-{block_order}",
        courseid=courseid,
        order=block_order,
        concept_id=concept.conceptid,
        explanation=explanation or concept.description,
        detail_refs=detail_refs or [make_child_node_ref('detail', concept.conceptid, detail.name) for detail in concept.details],
        examples=example_refs or [make_child_node_ref('example', concept.conceptid, example.name) for example in concept.examples],
        practice_problems=practice_problem_ids or list(concept.problems),
        source_refs=source_refs or concept.sourcePages,
    )
    learningBlocks.setdefault(courseid, []).append(block)
    if block_order > 1:
        prior = learningBlocks[courseid][-2]
        graphEdges.add_edge('learningBlock', prior.blockId, 'learningBlock', block.blockId, 'next', source='llm')
    return {'status': 'SUCCESS', 'blockId': block.blockId}


def minimal_tool_result(name, result, *, compact_lookup=False):
    """Shrink tool return payloads to IDs/status for logging and model round-trips."""
    if name == "get_all_assignment_names":
        if compact_lookup and isinstance(result, list):
            return {"status": "SUCCESS", "count": len(result)}
        return result

    if name == "get_assignmentid_by_name":
        if compact_lookup and isinstance(result, dict):
            return {
                key: result[key]
                for key in ("status", "assignmentid", "assignmentNodeId", "name", "reason")
                if key in result
            }
        return result

    if isinstance(result, str):
        return {"status": "SUCCESS", "message": result}

    if not isinstance(result, dict):
        return {"status": "SUCCESS"}

    if name == "add_syllabus":
        return {
            "status": "SUCCESS",
            "added": bool(result.get("added")),
            "courseid": result.get("courseid", ""),
        }

    if name == "log_external_resource":
        slim = {"added": bool(result.get("added"))}
        if result.get("reason"):
            slim["status"] = "SKIPPED"
            slim["reason"] = result["reason"]
        else:
            slim["status"] = "SUCCESS"
        return slim

    if name.startswith("log_"):
        return {"status": "SUCCESS", "logged": name[4:]}

    keep_keys = (
        "status", "added", "changed", "conceptNodeId", "assignmentNodeId",
        "eventNodeId", "problemid", "detailid", "exampleid", "fileid", "type",
        "error", "reason", "assignmentname", "eventname",
    )
    slim = {key: result[key] for key in keep_keys if key in result}
    if slim:
        return slim
    return {"status": result.get("status", "SUCCESS")}


def run_tool_call(name, courseid, arguments, filemeta=None):
    filemeta = filemeta or {}
    call_filemeta = dict(filemeta)
    pageid_from_args = str(arguments.get('pageid') or '').strip() if isinstance(arguments, dict) else ''
    if pageid_from_args:
        call_filemeta['pageid'] = pageid_from_args
        call_filemeta['currentPage'] = {'pageid': pageid_from_args}
    current_file = get_or_create_file_node(courseid, filemeta)
    if is_type_specific_log_tool(name):
        result = handle_type_specific_tool(name, arguments, call_filemeta, current_file)
        print(
            f"parser debug type-log: {name} course={courseid} file={make_fileid(filemeta)} "
            f"category={result.get('category')} label={result.get('label')!r}",
            flush=True,
        )
        record_type_extraction(
            courseid,
            make_fileid(filemeta),
            name,
            str(result.get('category') or ''),
            str(result.get('label') or ''),
        )
        return result
    if name == "get_all_assignment_names":
        return get_all_assignment_names()
    if name == "get_assignmentid_by_name":
        return get_assignmentid_by_name(arguments.get("name", ""))
    if name == "change_assignment_indicator":
        return {
            "changed": change_assignment_indicator(
                arguments.get("assignmentid"),
                arguments.get("indicator")
            )
        }
    if name == "add_concept_node":
        nodeid = add_concept_node(
            courseid,
            arguments.get("conceptname", ""),
            arguments.get("description", "")
        )
        if current_file:
            append_unique(current_file.concepts, nodeid)
            concept = find_concept_by_name_or_id(courseid, nodeid)
            if concept:
                attach_node_to_current_page(current_file, call_filemeta, 'concept', concept, nodeid)
        return {"added": True, "courseid": courseid, "conceptNodeId": nodeid}
    if name == "add_syllabus":
        syllabus = add_syllabus(
            courseid,
            arguments.get("classtimes", ""),
            arguments.get("assignments", []),
            arguments.get("other", ""),
            arguments.get("filechildren", []),
            filemeta,
            arguments.get("participationgrade")
        )
        return {"added": True, "courseid": courseid, "syllabus": syllabus.to_dict()}

    if name == "add_file_node":
        return add_file_node(
            courseid,
            filemeta,
            arguments.get("filename", ""),
            arguments.get("filetype", ""),
        )

    if name == "add_example_node":
        result = add_example_node(courseid, arguments.get('conceptNodeId', ''), arguments.get('examplename', ''), arguments.get('description', ""))
        if current_file and isinstance(result, dict):
            append_unique(current_file.examples, result.get('exampleid'))
            example = find_example_by_ref(courseid, result.get('exampleid'))
            if example:
                attach_node_to_current_page(current_file, call_filemeta, 'example', example, result.get('exampleid'))
        return result

    if name == "add_detail_node":
        result = add_detail_node(courseid, arguments.get('conceptNodeId', ''), arguments.get('detailname', ''), arguments.get('description', ''))
        if current_file and isinstance(result, dict):
            append_unique(current_file.details, result.get('detailid'))
            detail = find_detail_by_ref(courseid, result.get('detailid'))
            if detail:
                attach_node_to_current_page(current_file, call_filemeta, 'detail', detail, result.get('detailid'))
        return result

    if name == 'add_problem_node':
        incomingConceptNodeIds = arguments.get('incomingConceptNodeIds', arguments.get('concepts', []))
        outgoingConceptNodeIds = arguments.get('outgoingConceptNodeIds', arguments.get('concepts', []))
        result = add_problem_node(
            courseid,
            arguments.get('problemname', ''),
            incomingConceptNodeIds,
            outgoingConceptNodeIds,
            arguments.get('steps', []),
            arguments.get('answer', ''),
            arguments.get('assignmentNodeIds', [])
        )
        if current_file:
            append_unique(current_file.problems, result.get('problemid'))
            problem = find_problem_by_id(courseid, result.get('problemid'))
            if problem:
                attach_node_to_current_page(current_file, call_filemeta, 'problem', problem, result.get('problemid'))
        return result

    if name == 'log_detail':
        log_detail(courseid, arguments.get('conceptname', ''), arguments.get('detailname', ''), arguments.get('description', ''), filemeta)
        return f"detail with name {arguments.get('detailname', '')} logged successfully"

    if name == 'log_example':
        log_example(courseid, arguments.get('conceptname', ''), arguments.get('examplename', ''), arguments.get('description', ''), filemeta)
        return f"example with name {arguments.get('examplename', '')} logged successfully"

    if name == 'log_problem':
        log_problem(
            courseid,
            arguments.get('problemname', ''),
            arguments.get('incomingConceptNames', []),
            arguments.get('outgoingConceptNames', []),
            arguments.get('steps', []),
            arguments.get('answer', ''),
            filemeta
        )
        return f"problem with name {arguments.get('problemname', '')} logged successfully"

    if name == 'log_external_resource':
        result = log_external_resource(
            courseid,
            arguments.get('name', ''),
            arguments.get('type', ''),
            arguments.get('url', '')
        )
        return result

    if name == 'add_assignment_node':
        print(
            f"parser debug assignment: tool add_assignment_node course={courseid} args={json.dumps(arguments, ensure_ascii=False)}",
            flush=True
        )
        assignmentid = add_assignment_node(
            courseid,
            arguments.get('assignmentname', ''),
            arguments.get('unlockdate', ''),
            arguments.get('duedate', ''),
            arguments.get('gradepercentage', ''),
            arguments.get('description', ''),
            arguments.get('problemnames', []),
            (filemeta or {}).get('downloadurl', ''),
            (filemeta or {}).get('canvaspreviewurl', ''),
            arguments.get('filechildren', []),
            arguments.get('lookingfor', [])
        )
        return {
            'status': 'SUCCESS',
            'assignmentNodeId': assignmentid,
            'courseid': courseid
        }

    if name == 'log_assignment':
        print(
            f"parser debug assignment: tool log_assignment course={courseid} args={json.dumps(arguments, ensure_ascii=False)}",
            flush=True
        )
        log_assignment(
            courseid,
            arguments.get('assignmentname', ''),
            arguments.get('unlockdate', ''),
            arguments.get('duedate', ''),
            arguments.get('gradepercentage', ''),
            arguments.get('description', ''),
            arguments.get('problemnames', []),
            filemeta,
            arguments.get('filechildren', []),
            arguments.get('lookingfor', [])
        )
        return f"assignment with name {arguments.get('assignmentname', '')} logged successfully"

    if name == 'add_event_node':
        print(
            f"parser debug event: tool add_event_node course={courseid} args={json.dumps(arguments, ensure_ascii=False)}",
            flush=True
        )
        eventid = add_event_node(
            courseid,
            arguments.get('eventname', ''),
            arguments.get('startdate', ''),
            arguments.get('enddate', ''),
            arguments.get('gradepercentage', ''),
            arguments.get('description', ''),
            arguments.get('type', ''),
            arguments.get('dependencies', [])
        )
        return {
            'status': 'SUCCESS',
            'eventNodeId': eventid,
            'courseid': courseid
        }

    if name == 'add_exam_node':
        print(
            f"parser debug event: tool add_exam_node course={courseid} args={json.dumps(arguments, ensure_ascii=False)}",
            flush=True
        )
        eventid = add_exam_node(
            courseid,
            arguments.get('examname', ''),
            arguments.get('startdate', ''),
            arguments.get('enddate', ''),
            arguments.get('gradepercentage', ''),
            arguments.get('description', ''),
            arguments.get('dependencies', [])
        )
        return {
            'status': 'SUCCESS',
            'eventNodeId': eventid,
            'courseid': courseid,
            'type': 'test'
        }

    if name == 'log_event':
        print(
            f"parser debug event: tool log_event course={courseid} args={json.dumps(arguments, ensure_ascii=False)}",
            flush=True
        )
        log_event(
            courseid,
            arguments.get('eventname', ''),
            arguments.get('startdate', ''),
            arguments.get('enddate', ''),
            arguments.get('gradepercentage', ''),
            arguments.get('description', ''),
            arguments.get('type', ''),
            arguments.get('dependencies', []),
            filemeta,
        )
        return f"event with name {arguments.get('eventname', '')} logged successfully"

    if name == 'update_assignment_node':
        return update_assignment_node(
            courseid,
            arguments.get('assignmentNodeId', ''),
            arguments.get('assignmentname', ''),
            arguments.get('unlockdate', ''),
            arguments.get('duedate', ''),
            arguments.get('gradepercentage', ''),
            arguments.get('description', ''),
            arguments.get('problemids', []),
            filemeta,
            arguments.get('filechildren', []),
            arguments.get('lookingfor', [])
        )

    if name == 'update_event_node':
        return update_event_node(
            courseid,
            arguments.get('eventNodeId', ''),
            arguments.get('eventname', ''),
            arguments.get('startdate', ''),
            arguments.get('enddate', ''),
            arguments.get('gradepercentage', ''),
            arguments.get('description', ''),
            arguments.get('type', ''),
            arguments.get('dependencies', [])
        )

    if name == 'link_file_to_event':
        return link_file_to_event(
            courseid,
            arguments.get('eventNodeId', ''),
            arguments.get('eventname', ''),
            arguments.get('fileid', ''),
            arguments.get('filetype', 'study_material'),
        )

    if name == 'log_concept_prerequisite':
        return add_concept_prerequisite_edge(
            courseid,
            arguments.get('fromConceptId', ''),
            arguments.get('toConceptId', ''),
            source='llm-log',
        )

    if name == 'add_concept_prerequisite_edge':
        return add_concept_prerequisite_edge(
            courseid,
            arguments.get('fromConceptId', ''),
            arguments.get('toConceptId', ''),
            source='llm',
        )

    if name == 'add_learning_block':
        return add_learning_block(
            courseid,
            arguments.get('conceptNodeId', ''),
            arguments.get('explanation', ''),
            arguments.get('detailRefs', []),
            arguments.get('exampleRefs', []),
            arguments.get('practiceProblemIds', []),
            None,
            arguments.get('order'),
        )

    return {"error": f"Unknown tool: {name}"}


def load_canvas_assignments():
    with open("course.json", "r", encoding="utf-8-sig") as file:
        data = json.load(file)

    course_id = data.get("course_id")
    for assignment in data.get("assignments", []):
        assignment_id = assignment.get("id")
        name = assignment.get("name")
        indicator = get_assignment_indicator(assignment)

        if assignment_id and indicator is not None:
            current_assignment_files_groups.append({
                "indicator": indicator,
                "assignmentid": assignment_id,
                "courseid": course_id,
                "name": name
            })

    current_assignment_files_groups.sort(key=lambda item: item["indicator"])


def _trace_parser_line(message: str) -> None:
    parser_thread_log_lines.append(str(message))


def downloadtopath(path, url):
    target_path = Path(path)
    if PARSER_SKIP_DOWNLOAD_IF_CACHED and target_path.is_file():
        try:
            if target_path.stat().st_size > 0:
                return target_path
        except OSError:
            pass
    headers = {}
    canvas_auth_cookie = os.getenv("CANVAS_AUTH_COOKIE")
    canvas_auth_csrf = os.getenv("CANVAS_AUTH_CSRF")
    canvas_base_url = str(os.getenv("CANVAS_BASE_URL") or "").strip().rstrip("/")
    if canvas_auth_cookie:
        headers["Cookie"] = canvas_auth_cookie
    if canvas_auth_csrf:
        headers["X-CSRF-Token"] = canvas_auth_csrf
    if canvas_base_url:
        headers["Referer"] = canvas_base_url + "/"

    session = requests.Session()
    session.headers.update(headers)

    try:
        response = session.get(
            url,
            stream=True,
            allow_redirects=True,
            timeout=CANVAS_DOWNLOAD_TIMEOUT_SECONDS,
        )
    except requests.RequestException as error:
        msg = f"parser: skipped canvas download request failed url={url} error={error}"
        print(msg, flush=True)
        _trace_parser_line(msg)
        return None

    final_url = str(response.url or url)
    if response.status_code in {401, 403}:
        msg = (
            f"parser: skipped forbidden canvas download status={response.status_code} "
            f"url={url} final={final_url}"
        )
        print(msg, flush=True)
        _trace_parser_line(msg)
        return None

    try:
        response.raise_for_status()
    except requests.HTTPError as error:
        msg = (
            f"parser: skipped canvas download status={response.status_code} "
            f"url={url} final={final_url} error={error}"
        )
        print(msg, flush=True)
        _trace_parser_line(msg)
        return None

    content_type = str(response.headers.get("content-type") or "").lower()
    if "text/html" in content_type and final_url != url:
        msg = (
            f"parser: skipped canvas download html response "
            f"url={url} final={final_url} content_type={content_type}"
        )
        print(msg, flush=True)
        _trace_parser_line(msg)
        return None

    downloaded_bytes = 0
    with target_path.open('wb') as file:
        for chunk in response.iter_content(chunk_size=8192):
            if not chunk:
                continue
            downloaded_bytes += len(chunk)
            if downloaded_bytes > CANVAS_DOWNLOAD_MAX_BYTES:
                msg = (
                    f"parser: skipped canvas download too large "
                    f"bytes={downloaded_bytes} max={CANVAS_DOWNLOAD_MAX_BYTES} url={url}"
                )
                print(msg, flush=True)
                _trace_parser_line(msg)
                target_path.unlink(missing_ok=True)
                return None
            file.write(chunk)

    return target_path


def extract_pdf_text(filepath):
    return pages_to_prompt_text(build_pdf_pages(filepath, Path(filepath).name))


def processfile(fileid, url, content_type='', filename=''):
    filepath = folder / str(fileid)
    if not downloadtopath(filepath, url):
        return None
    from canvas_parser.content.extractors import resolve_extractor_kind

    extractor_kind = resolve_extractor_kind(
        content_type,
        filename or str(fileid),
        path=filepath,
    )
    if not extractor_kind:
        msg = (
            f"parser: skipped unsupported file type file={fileid} name={filename!r} "
            f"content_type={content_type!r}"
        )
        print(msg, flush=True)
        _trace_parser_line(msg)
        return None
    try:
        extracted = extract_text_from_file(
            filepath,
            extractor_kind,
            build_pdf_pages=build_pdf_pages,
            fileid=fileid,
        )
    except Exception as error:
        msg = (
            f"parser: extract failed file={fileid} name={filename!r} kind={extractor_kind} error={error}"
        )
        print(msg, flush=True)
        _trace_parser_line(msg)
        return None
    pages = extracted.get('pages', []) or []
    text = extracted.get('text', '') or ''
    if not pages and text:
        pages = build_document_pages_from_text(str(fileid), text)
    if pages:
        text = pages_to_prompt_text(pages)
    return {
        'text': text,
        'pages': pages
    }


def safe_path_part(value, fallback='outside-source'):
    cleaned = re.sub(r'[^a-zA-Z0-9._-]+', '-', str(value or '').strip()).strip('-._')
    return cleaned[:80] or fallback


def external_hash(*parts):
    joined = '|'.join(str(part or '') for part in parts)
    return hashlib.sha1(joined.encode('utf-8', errors='ignore')).hexdigest()[:16]


def is_public_http_url(url):
    parsed = urlparse(str(url or '').strip())
    return parsed.scheme in {'http', 'https'} and bool(parsed.netloc)


def normalize_crawl_url(url, base_url=''):
    if not url:
        return ''
    raw = str(url).strip()
    if raw.lower().startswith(('mailto:', 'tel:', 'javascript:', 'data:')):
        return ''
    joined = urljoin(base_url, raw) if base_url else raw
    joined, _fragment = urldefrag(joined)
    parsed = urlparse(joined)
    if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
        return ''
    path = parsed.path or '/'
    return parsed._replace(path=path).geturl()


def same_crawl_host(root_url, candidate_url):
    root = urlparse(root_url)
    candidate = urlparse(candidate_url)
    return root.netloc.lower() == candidate.netloc.lower()


def is_probably_pdf_url(url):
    return urlparse(url).path.lower().endswith('.pdf')


def normalize_external_resource_type(value):
    return re.sub(r'\s+', ' ', str(value or '').strip().lower())


def is_external_file_url(url):
    path = urlparse(str(url or '')).path.lower()
    return any(path.endswith(ext) for ext in EXTERNAL_FILE_EXTENSIONS)


def classify_external_resource(resource, url=''):
    url = normalize_crawl_url(url or resource.get('url', ''))
    resource_type = normalize_external_resource_type(resource.get('type', ''))
    resource_name = normalize_external_resource_type(resource.get('name', ''))
    combined = f"{resource_name} {resource_type}".strip()

    if url and (is_probably_pdf_url(url) or is_external_file_url(url)):
        return 'file'

    if resource_type in EXTERNAL_COURSE_WEBSITE_TYPES:
        return 'course_website'

    if resource_type in EXTERNAL_FILE_TYPES:
        return 'file'

    if any(hint in resource_type for hint in ('pdf', 'document', 'slides', 'worksheet', 'handout', 'file', 'reading')):
        return 'file'

    if any(hint in resource_type for hint in ('homepage', 'portal', 'wiki')):
        if 'course' in combined or 'class' in combined:
            return 'course_website'

    if any(hint in combined for hint in ('course website', 'class website', 'course home', 'course site', 'class site')):
        return 'course_website'

    return 'resource'


def extract_page_links(html, base_url):
    parser = HtmlLinkExtractor()
    try:
        parser.feed(html or '')
        parser.close()
    except Exception:
        return []
    links = []
    for href in parser.links:
        normalized = normalize_crawl_url(href, base_url)
        if normalized and normalized not in links:
            links.append(normalized)
    return links


def extract_html_title(html):
    match = re.search(r'<title[^>]*>(.*?)</title>', html or '', re.IGNORECASE | re.DOTALL)
    if not match:
        return ''
    return re.sub(r'\s+', ' ', unescape(match.group(1))).strip()


def page_to_markdown(url, depth, html, links):
    title = extract_html_title(html) or url
    text = html_to_text(html)
    link_lines = [
        f"- {link}"
        for link in links[:40]
        if link
    ]
    return "\n".join([
        f"## {title}",
        "",
        f"- Source URL: {url}",
        f"- Crawl depth: {depth}",
        "",
        text,
        "",
        "### Links",
        "\n".join(link_lines) if link_lines else "No crawlable links found.",
        ""
    ]).strip()


def external_resource_state_key(courseid, resource):
    return external_hash(courseid, resource.get('url', ''), resource.get('name', ''), resource.get('type', ''))


def download_external_bytes(courseid, url, resource_name='', subfolder='downloads', default_name='external-file'):
    download_dir = OUTSIDE_SOURCES_FOLDER / safe_path_part(courseid, 'course') / subfolder
    download_dir.mkdir(parents=True, exist_ok=True)
    path_name = Path(urlparse(url).path).name or default_name
    filename = safe_path_part(resource_name or path_name or default_name, default_name)
    suffix = Path(path_name).suffix.lower()
    if suffix and not filename.lower().endswith(suffix):
        filename = f"{filename}{suffix}"
    filepath = download_dir / f"{external_hash(courseid, url)}-{filename}"
    if filepath.exists():
        return filepath

    response = requests.get(
        url,
        stream=True,
        timeout=EXTERNAL_CRAWL_TIMEOUT_SECONDS,
        headers={'User-Agent': 'NucleusCourseCrawler/1.0'},
        allow_redirects=True
    )
    if response.status_code in {401, 403}:
        raise PermissionError(f"outside source locked or forbidden: {url}")
    response.raise_for_status()
    with filepath.open('wb') as file:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                file.write(chunk)
    return filepath


def download_external_pdf(courseid, url, resource_name=''):
    pdf_dir = OUTSIDE_SOURCES_FOLDER / safe_path_part(courseid, 'course') / 'pdfs'
    pdf_dir.mkdir(parents=True, exist_ok=True)
    filename = safe_path_part(resource_name or Path(urlparse(url).path).name or 'external-pdf', 'external-pdf')
    if not filename.lower().endswith('.pdf'):
        filename = f"{filename}.pdf"
    filepath = pdf_dir / f"{external_hash(courseid, url)}-{filename}"
    if filepath.exists():
        return filepath
    return download_external_bytes(courseid, url, filename, subfolder='pdfs', default_name='external-pdf')


def save_external_page_markdown(courseid, resource, root_url, markdown_sections, state_key, crawl_mode, max_depth):
    if not markdown_sections:
        return ''

    course_dir = OUTSIDE_SOURCES_FOLDER / safe_path_part(courseid, 'course')
    course_dir.mkdir(parents=True, exist_ok=True)
    markdown_path_obj = course_dir / f"{safe_path_part(resource.get('name') or urlparse(root_url).netloc)}-{state_key}.md"
    markdown_header = "\n".join([
        f"# {resource.get('name') or root_url}",
        f"- Root URL: {root_url}",
        f"- Course ID: {courseid}",
        f"- Crawl mode: {crawl_mode}",
        f"- Max link depth: {max_depth}",
        f"- Crawled at: {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
        ""
    ])
    markdown_path_obj.write_text(
        markdown_header + "\n\n---\n\n" + "\n\n---\n\n".join(markdown_sections),
        encoding='utf-8'
    )
    return str(markdown_path_obj)


def fetch_external_file_resource(courseid, resource):
    root_url = normalize_crawl_url(resource.get('url', ''))
    if not is_public_http_url(root_url):
        return {'ok': False, 'reason': 'missing public http url', 'pdfs': []}

    state_key = external_resource_state_key(courseid, resource)
    state = external_crawl_state.setdefault(str(courseid), {}).setdefault(state_key, {
        'resource': resource,
        'visited_urls': [],
        'downloaded_pdfs': [],
        'errors': [],
        'crawl_mode': 'file'
    })
    state['crawl_mode'] = 'file'
    path_lower = urlparse(root_url).path.lower()
    pdfs = []

    try:
        if is_probably_pdf_url(root_url) or path_lower.endswith('.pdf'):
            pdf_path = download_external_pdf(courseid, root_url, resource.get('name', ''))
            item = {'url': root_url, 'path': str(pdf_path), 'name': Path(pdf_path).name}
            state.setdefault('downloaded_pdfs', []).append(item)
            pdfs.append(item)
            state['visited_urls'] = [root_url]
            state['parsed_at'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
            return {
                'ok': True,
                'state_key': state_key,
                'markdown_path': '',
                'pdfs': pdfs,
                'visited_urls': state['visited_urls'],
                'errors': state.get('errors', [])
            }

        if any(path_lower.endswith(ext) for ext in EXTERNAL_TEXT_FILE_EXTENSIONS):
            text_path = download_external_bytes(
                courseid,
                root_url,
                resource.get('name', ''),
                subfolder='text',
                default_name='external-text'
            )
            text_content = text_path.read_text(encoding='utf-8', errors='replace')
            if path_lower.endswith(('.html', '.htm')):
                markdown_sections = [page_to_markdown(root_url, 0, text_content, [])]
            else:
                markdown_sections = [
                    "\n".join([
                        f"## {resource.get('name') or root_url}",
                        "",
                        f"- Source URL: {root_url}",
                        f"- Crawl depth: 0",
                        "",
                        text_content,
                        ""
                    ]).strip()
                ]
            markdown_path = save_external_page_markdown(
                courseid,
                resource,
                root_url,
                markdown_sections,
                state_key,
                'file',
                0
            )
            state['visited_urls'] = [root_url]
            state['markdown_file'] = markdown_path
            state['parsed_at'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
            return {
                'ok': bool(markdown_path),
                'state_key': state_key,
                'markdown_path': markdown_path,
                'pdfs': [],
                'visited_urls': state['visited_urls'],
                'errors': state.get('errors', [])
            }

        response = requests.get(
            root_url,
            timeout=EXTERNAL_CRAWL_TIMEOUT_SECONDS,
            headers={'User-Agent': 'NucleusCourseCrawler/1.0'},
            allow_redirects=True
        )
        final_url = normalize_crawl_url(response.url or root_url)
        if response.status_code in {401, 403}:
            state.setdefault('errors', []).append({'url': root_url, 'error': f'locked status {response.status_code}'})
            return {'ok': False, 'reason': f'locked status {response.status_code}', 'pdfs': []}
        response.raise_for_status()

        content_type = response.headers.get('content-type', '').lower()
        if 'application/pdf' in content_type:
            pdf_path = download_external_pdf(courseid, final_url or root_url, resource.get('name', ''))
            item = {'url': final_url or root_url, 'path': str(pdf_path), 'name': Path(pdf_path).name}
            state.setdefault('downloaded_pdfs', []).append(item)
            pdfs.append(item)
            state['visited_urls'] = [final_url or root_url]
            state['parsed_at'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
            return {
                'ok': True,
                'state_key': state_key,
                'markdown_path': '',
                'pdfs': pdfs,
                'visited_urls': state['visited_urls'],
                'errors': state.get('errors', [])
            }
    except Exception as error:
        state.setdefault('errors', []).append({'url': root_url, 'error': str(error)})
        return {'ok': False, 'reason': str(error), 'pdfs': []}

    return crawl_external_website(
        courseid,
        resource,
        max_depth=0,
        max_pages=1,
        follow_links=False,
        crawl_mode='file'
    )


def crawl_external_website(
    courseid,
    resource,
    max_depth=EXTERNAL_CRAWL_MAX_DEPTH,
    max_pages=EXTERNAL_CRAWL_MAX_PAGES,
    follow_links=True,
    crawl_mode='course_website'
):
    root_url = normalize_crawl_url(resource.get('url', ''))
    if not is_public_http_url(root_url):
        return {'ok': False, 'reason': 'missing public http url', 'pdfs': []}

    state_key = external_resource_state_key(courseid, resource)
    state = external_crawl_state.setdefault(str(courseid), {}).setdefault(state_key, {
        'resource': resource,
        'visited_urls': [],
        'downloaded_pdfs': [],
        'errors': [],
        'crawl_mode': crawl_mode
    })
    state['crawl_mode'] = crawl_mode
    visited = set(state.get('visited_urls', []) or [])
    pdf_urls = set(item.get('url', '') for item in state.get('downloaded_pdfs', []) or [])
    queue = [(root_url, 0)]
    markdown_sections = []
    pdfs = []

    while queue and len(visited) < max_pages:
        url, depth = queue.pop(0)
        url = normalize_crawl_url(url)
        if not url or url in visited or depth > max_depth or not same_crawl_host(root_url, url):
            continue

        visited.add(url)
        try:
            if is_probably_pdf_url(url):
                pdf_path = download_external_pdf(courseid, url, resource.get('name', ''))
                item = {'url': url, 'path': str(pdf_path), 'name': Path(pdf_path).name}
                if url not in pdf_urls:
                    pdfs.append(item)
                    state.setdefault('downloaded_pdfs', []).append(item)
                    pdf_urls.add(url)
                continue

            response = requests.get(
                url,
                timeout=EXTERNAL_CRAWL_TIMEOUT_SECONDS,
                headers={'User-Agent': 'NucleusCourseCrawler/1.0'},
                allow_redirects=True
            )
            final_url = normalize_crawl_url(response.url or url)
            if final_url and final_url != url:
                visited.add(final_url)
            if response.status_code in {401, 403}:
                state.setdefault('errors', []).append({'url': url, 'error': f'locked status {response.status_code}'})
                continue
            response.raise_for_status()

            content_type = response.headers.get('content-type', '').lower()
            if 'application/pdf' in content_type:
                pdf_path = download_external_pdf(courseid, final_url or url, resource.get('name', ''))
                item = {'url': final_url or url, 'path': str(pdf_path), 'name': Path(pdf_path).name}
                if item['url'] not in pdf_urls:
                    pdfs.append(item)
                    state.setdefault('downloaded_pdfs', []).append(item)
                    pdf_urls.add(item['url'])
                continue

            if 'text/html' not in content_type and '<html' not in response.text[:500].lower():
                continue

            links = [
                link for link in extract_page_links(response.text, final_url or url)
                if same_crawl_host(root_url, link)
            ]
            markdown_sections.append(page_to_markdown(final_url or url, depth, response.text, links))
            if follow_links and depth < max_depth:
                for link in links:
                    if link not in visited:
                        queue.append((link, depth + 1))
        except Exception as error:
            state.setdefault('errors', []).append({'url': url, 'error': str(error)})

    state['visited_urls'] = sorted(visited)
    markdown_path = save_external_page_markdown(
        courseid,
        resource,
        root_url,
        markdown_sections,
        state_key,
        crawl_mode,
        max_depth
    )
    if markdown_path:
        state['markdown_file'] = markdown_path

    state['parsed_at'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    return {
        'ok': bool(markdown_path or pdfs or state.get('downloaded_pdfs')),
        'state_key': state_key,
        'markdown_path': markdown_path,
        'pdfs': pdfs or state.get('downloaded_pdfs', []),
        'visited_urls': state['visited_urls'],
        'errors': state.get('errors', [])
    }


async def parse_external_file_text(courseid, fileid, name, url, text, markdown_path='', pages=None):
    if not text or is_item_parsed('external', courseid, fileid):
        return
    pages = normalize_file_pages(pages or [], fileid)
    filemeta = {
        'fileid': str(fileid),
        'courseid': courseid,
        'name': name,
        'downloadurl': url,
        'canvaspreviewurl': url,
        'url': url,
        'searchtext': text,
        'pages': pages
    }
    current_file = get_or_create_file_node(courseid, filemeta)

    # ── CHANGED: send all pages in one call instead of one call per page ──
    if pages:
        full_prompt = pages_to_prompt_text(pages)
        await run_deepseek(full_prompt, fileid, courseid, url, url, name, pages=pages)
    else:
        await run_deepseek(text, fileid, courseid, url, url, name, pages=pages)

    finalize_file_logged_nodes(courseid, filemeta)

    if current_file:
        resolve_file_against_looking_requests(courseid, current_file)
    run_post_file_course_hooks(courseid, filemeta)
    mark_item_parsed('external', courseid, fileid, name)


async def fetch_external_file_resource_async(courseid, resource):
    loop = asyncio.get_running_loop()
    started = time.perf_counter()
    result = await loop.run_in_executor(
        parse_io_executor,
        lambda: fetch_external_file_resource(courseid, resource)
    )
    record_phase_time('external_ms', started)
    return result


async def process_external_resource(courseid, resource):
    semaphore = external_semaphore or asyncio.Semaphore(EXTERNAL_MAX_CONCURRENT)
    async with semaphore:
        url = normalize_crawl_url(resource.get('url', ''))
        if not url:
            return
        state_key = external_resource_state_key(courseid, resource)
        website_fileid = f"external-site-{state_key}"
        if is_item_parsed('external', courseid, website_fileid):
            saved_state = external_crawl_state.get(str(courseid), {}).get(state_key, {})
            crawl_result = {
                'ok': bool(saved_state),
                'state_key': state_key,
                'markdown_path': saved_state.get('markdown_file', ''),
                'pdfs': saved_state.get('downloaded_pdfs', []),
                'visited_urls': saved_state.get('visited_urls', []),
                'errors': saved_state.get('errors', [])
            }
        else:
            crawl_mode = classify_external_resource(resource, url)
            print(
                f"parser debug external: mode={crawl_mode} course={courseid} url={url}",
                flush=True
            )
            if crawl_mode == 'course_website':
                crawl_result = await crawl_external_website_async(
                    courseid,
                    resource,
                    max_depth=EXTERNAL_COURSE_WEBSITE_MAX_DEPTH,
                    max_pages=EXTERNAL_COURSE_WEBSITE_MAX_PAGES,
                    follow_links=True,
                    crawl_mode='course_website'
                )
            elif crawl_mode == 'file':
                crawl_result = await fetch_external_file_resource_async(courseid, resource)
            else:
                crawl_result = await crawl_external_website_async(
                    courseid,
                    resource,
                    max_depth=0,
                    max_pages=1,
                    follow_links=False,
                    crawl_mode='resource'
                )
        if not crawl_result.get('ok'):
            print(
                f"parser debug external: skipped course={courseid} url={url} reason={crawl_result.get('reason', 'no public content')}",
                flush=True
            )
            return

        markdown_path = crawl_result.get('markdown_path', '')
        if markdown_path:
            markdown_text = Path(markdown_path).read_text(encoding='utf-8')
            await parse_external_file_text(
                courseid,
                website_fileid,
                f"Outside source: {resource.get('name') or urlparse(url).netloc}",
                url,
                markdown_text,
                markdown_path
            )
        elif not is_item_parsed('external', courseid, website_fileid):
            mark_item_parsed('external', courseid, website_fileid, resource.get('name') or url)

        for pdf in crawl_result.get('pdfs', []) or []:
            pdf_url = pdf.get('url', '')
            pdf_path = pdf.get('path', '')
            if not pdf_path:
                continue
            pdf_fileid = f"external-pdf-{external_hash(courseid, pdf_url, pdf_path)}"
            if is_item_parsed('external', courseid, pdf_fileid):
                continue
            try:
                pdf_pages = await build_pdf_pages_async(pdf_path, pdf_fileid)
                pdf_text = pages_to_prompt_text(pdf_pages)
            except Exception as error:
                external_crawl_state.setdefault(str(courseid), {}).setdefault(state_key, {}).setdefault('errors', []).append({
                    'url': pdf_url,
                    'error': f'pdf parse failed: {error}'
                })
                continue
            await parse_external_file_text(
                courseid,
                pdf_fileid,
                f"Outside PDF: {pdf.get('name') or Path(pdf_path).name}",
                pdf_url,
                pdf_text,
                pdf_path,
                pages=pdf_pages
            )
        write_state(checkpoint=True)


async def parse_external_resources_after_canvas():
    external_tasks = []
    for courseid, resources in list(externalResources.items()):
        for resource in list(resources or []):
            external_tasks.append(process_external_resource(courseid, resource))
    if external_tasks:
        await asyncio.gather(*external_tasks)


def parse_assignment_payload(file):
    content = file.get('content', {})
    if isinstance(content, str):
        try:
            content = json.loads(content)
        except json.JSONDecodeError:
            content = {}
    if not isinstance(content, dict):
        content = {}

    description_html = content.get('description_html') or content.get('description', '')
    description_text = content.get('description_text') or html_to_text(description_html)
    html_url = content.get('html_url') or file.get('url', '')
    submission_links = extract_links_from_html(description_html, html_url)
    submission_dependencies = []
    for file_id in extract_canvas_file_ids_from_html(description_html):
        submission_dependencies.append({'type': 'file', 'fileId': file_id})
    for link in submission_links:
        if link.get('platform') == 'gradescope':
            submission_dependencies.append({
                'type': 'external_platform',
                'platform': 'gradescope',
                'url': link.get('url', ''),
                'label': link.get('label', ''),
            })

    return {
        'assignmentname': content.get('assignmentname') or file.get('name') or str(file.get('id', '')),
        'description': description_text,
        'description_html': description_html,
        'duedate': content.get('duedate', ''),
        'unlockdate': content.get('unlockdate', ''),
        'gradepercentage': content.get('gradepercentage', ''),
        'points_possible': content.get('points_possible', ''),
        'html_url': html_url,
        'previewurl': file.get('previewurl', ''),
        'url': file.get('url', ''),
        'submission_types': content.get('submission_types', []) or [],
        'submission_links': submission_links,
        'submission_dependencies': submission_dependencies,
    }


def parsed_item_key(batch_type, courseid, fileid):
    return f"{batch_type}:{courseid}:{fileid}"


def is_item_parsed(batch_type, courseid, fileid):
    return parsed_item_key(batch_type, courseid, fileid) in parsed_item_keys.get(batch_type, set())


def mark_item_parsed(batch_type, courseid, fileid, name=''):
    if batch_type not in parsed_items:
        parsed_items[batch_type] = []
    if batch_type not in parsed_item_keys:
        parsed_item_keys[batch_type] = set()
    key = parsed_item_key(batch_type, courseid, fileid)
    if key in parsed_item_keys[batch_type]:
        return
    parsed_item_keys[batch_type].add(key)
    parsed_items[batch_type].append({
        'key': key,
        'courseid': str(courseid),
        'fileid': str(fileid),
        'name': name,
        'parsed_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    })
    record_file_parsed(str(courseid), batch_type, str(fileid), name)


def record_module_item_metadata(courseid, fileid, file, content):
    if isinstance(content, str):
        try:
            content = json.loads(content)
        except json.JSONDecodeError:
            content = {}
    module_id = content.get('moduleId')
    module_name = str(content.get('moduleName') or '').strip()
    position = content.get('position', 0)
    item_type = str(content.get('itemType', '')).casefold()
    content_id = str(content.get('content_id') or '').strip()
    if module_id:
        courseModules.setdefault(courseid, {})
        existing_module = courseModules[courseid].get(str(module_id), {})
        courseModules[courseid][str(module_id)] = {
            'moduleId': str(module_id),
            'name': module_name or existing_module.get('name', ''),
            'position': int(existing_module.get('position', position or 0)),
        }
    if module_id and item_type in {'page', 'assignment', 'file', 'externalurl', 'externaltool'}:
        moduleOrderHints.setdefault(courseid, {})
        moduleOrderHints[courseid][str(fileid)] = {
            'moduleId': str(module_id),
            'position': int(position or 0),
            'itemType': item_type,
            'contentId': content_id,
            'moduleName': module_name,
        }
    if item_type == 'file' and content_id:
        enqueue_linked_canvas_file_id(
            courseid,
            content_id,
            name=str(content.get('title') or file.get('name') or ''),
        )
    if item_type in {'externalurl', 'externaltool'} and content.get('external_url'):
        log_external_resource(courseid, file.get('name', '') or content.get('title', ''), item_type, content.get('external_url'))


def ensure_assignment_canvas_id(courseid, canvas_id, file):
    payload = parse_assignment_payload(file)
    assignment = find_assignment_node(courseid, assignmentname=payload['assignmentname'])
    if not assignment:
        assignment = find_assignment_node(courseid, canvasAssignmentId=canvas_id)
    if assignment and not getattr(assignment, 'canvasAssignmentId', ''):
        assignment.canvasAssignmentId = str(canvas_id)
        return assignment.assignmentid
    return None


def process_canvas_assignment(fileid, courseid, file):
    payload = parse_assignment_payload(file)
    assignmentid = add_assignment_node(
        courseid,
        payload['assignmentname'],
        payload['unlockdate'],
        payload['duedate'],
        payload['gradepercentage'],
        payload['description'],
        [],
        payload['url'],
        payload['previewurl'] or payload['html_url'],
        filechildren=extract_canvas_file_ids_from_html(payload.get('description_html', '')),
        lookingfor=[],
        canvasAssignmentId=fileid,
    )
    assignment = find_assignment_node(courseid, assignmentNodeId=assignmentid)
    if assignment:
        process_assignment_description_html_links(
            courseid,
            assignment,
            payload.get('description_html', ''),
            base_url=payload.get('html_url', '') or payload.get('url', ''),
        )
        assignment.update(
            submission_types=payload.get('submission_types'),
            submission_links=payload.get('submission_links'),
            submission_dependencies=payload.get('submission_dependencies'),
        )
        for dependency in payload.get('submission_dependencies', []) or []:
            if dependency.get('type') == 'external_platform' and dependency.get('platform') == 'gradescope':
                graphEdges.add_edge(
                    'assignment',
                    assignment.assignmentid,
                    'external_platform',
                    dependency.get('url', ''),
                    'requires_submission',
                    source='canvas-html',
                    metadata=dependency,
                )
    enqueue_assignment_description_summary(courseid, assignmentid, payload['description'])
    indicator = transform(normalize_date(payload['duedate'])) if isvaliddate(normalize_date(payload['duedate'])) else float('inf')
    existing_index = next(
        (
            index for index, assignment in enumerate(current_assignment_files_groups)
            if str(assignment.get("assignmentid")) == str(fileid) and str(assignment.get("courseid")) == str(courseid)
        ),
        None
    )
    assignment_item = {
        "indicator": indicator,
        "assignmentid": fileid,
        "courseid": courseid,
        "name": payload['assignmentname']
    }
    if existing_index is None:
        current_assignment_files_groups.append(assignment_item)
    else:
        current_assignment_files_groups[existing_index] = assignment_item
    current_assignment_files_groups.sort(key=lambda item: item["indicator"])
    mark_item_parsed('assignment', courseid, fileid, payload['assignmentname'])
    print(
        f"parser task update assignment course={courseid} canvasid={fileid} assignmentNodeId={assignmentid!r} name={payload['assignmentname']!r}",
        flush=True
    )
    enqueue_linked_canvas_files(
        courseid,
        payload.get('description_html', ''),
        name_hint=payload.get('assignmentname', ''),
    )
    return assignmentid


def is_likely_syllabus_item(item):
    if not isinstance(item, dict):
        return False
    if str(item.get('documenttype', '')).lower() == 'syllabus':
        return True
    searchable = " ".join(
        str(item.get(key, '') or '')
        for key in ('name', 'display_name', 'filename', 'url', 'previewurl', 'content')
    )
    return bool(SYLLABUS_NAME_PATTERN.search(searchable))


def order_canvas_parse_items(items, batch_type):
    if batch_type not in {'file', 'syllabus'} or not isinstance(items, list):
        return items
    return sorted(items, key=lambda item: 0 if is_likely_syllabus_item(item) else 1)


def parse_batch_item_payload(raw_content):
    if isinstance(raw_content, dict):
        return raw_content
    text = str(raw_content or '').strip()
    if not text.startswith('{'):
        return {}
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def batch_item_search_text(raw_content, fallback=''):
    payload = parse_batch_item_payload(raw_content)
    if not payload:
        return str(raw_content or fallback or '')
    for key in ('syllabus', 'body_text', 'description_text', 'description', 'body_html'):
        value = payload.get(key)
        if value:
            return html_to_text(str(value)) if key.endswith('_html') else str(value)
    return str(raw_content or fallback or '')


def seed_heuristic_exam_events_from_text(courseid, text):
    if not text or not str(text).strip():
        return 0
    seeded = 0
    hints = extract_prose_exam_hints(text) + extract_syllabus_exam_hints(text)
    seen: set[tuple[str, str]] = set()
    for hint in hints:
        name = canonical_test_event_name(str(hint.get('name') or ''))
        date_text = str(hint.get('date_text') or '').strip()
        if not name or not date_text:
            continue
        key = (name.casefold(), date_text.casefold())
        if key in seen:
            continue
        seen.add(key)
        if find_event_node(courseid, eventname=name):
            continue
        add_exam_node(courseid, name, startdate=date_text)
        seeded += 1
    return seeded


def apply_heuristic_file_metadata(courseid, filemeta, *, pages=None, filename='', preserve_existing_type=False):
    pages = pages or filemeta.get('pages') or []
    existing = str(filemeta.get('academicFileType') or '').strip()
    existing_conf = float(filemeta.get('academicFileTypeConfidence') or 0.0)
    if (
        preserve_existing_type
        and existing
        and existing_conf >= HEURISTIC_CONFIDENCE_THRESHOLD
    ):
        heuristic_type = existing
        heuristic_conf = existing_conf
    else:
        snippet = build_classification_snippet(pages=pages, prompt_text=filemeta.get('searchtext') or '')
        heuristic_type, heuristic_conf = heuristic_classify(
            filename=filename or filemeta.get('name', ''),
            snippet=snippet,
        )
    filemeta['academicFileType'] = heuristic_type
    filemeta['academicFileTypeConfidence'] = heuristic_conf
    filemeta['academicFileTypeSource'] = filemeta.get('academicFileTypeSource') or 'heuristic'
    filemeta['pages'] = pages
    _deepseek_pass_context['fileid'] = str(filemeta.get('fileid') or '')
    _deepseek_pass_context['academicFileType'] = heuristic_type
    classification = classify_study_material_filename(filename or filemeta.get('name', ''))
    current_file = fileNodes.get(courseid, {}).get(str(filemeta.get('fileid') or ''))
    if classification and current_file:
        current_file.type = classification['filetype']
    if current_file and heuristic_type:
        current_file.academicFileType = heuristic_type
    seed_heuristic_concepts_for_file(courseid, filemeta)
    return heuristic_type


def finish_download_only_item(courseid, fileid, file, filemeta, *, pages=None, current_file=None, batch_type='file'):
    """Prefetch: cache file text locally and create a file node; defer LLM to inference phase."""
    filename = file.get('name', '') if isinstance(file, dict) else ''
    if pages:
        filemeta['pages'] = pages
    get_or_create_file_node(courseid, filemeta)
    if current_file and pages:
        ensure_file_node_page_blocks(current_file)
    print(
        f"parser: download-only cached course={courseid} id={fileid} "
        f"type={batch_type} name={filename!r}",
        flush=True,
    )


def finish_heuristic_parse_item(courseid, fileid, file, filemeta, *, pages=None, current_file=None, raw_content=None):
    filename = file.get('name', '') if isinstance(file, dict) else ''
    search_text = batch_item_search_text(raw_content, filemeta.get('searchtext') or '')
    if search_text and not filemeta.get('searchtext'):
        filemeta['searchtext'] = search_text
    if filemeta.get('academicFileType'):
        seed_heuristic_concepts_for_file(courseid, filemeta, skip_llm_pass1=True)
    else:
        apply_heuristic_file_metadata(courseid, filemeta, pages=pages, filename=filename)
    payload = parse_batch_item_payload(raw_content)
    is_syllabus = (
        str(filemeta.get('academicFileType') or '').casefold() == 'syllabus'
        or str(payload.get('documenttype') or '').casefold() == 'syllabus'
        or is_likely_syllabus_item(file)
    )
    if is_syllabus:
        seed_heuristic_syllabus_for_file(courseid, filemeta, text=search_text)
    elif search_text:
        seed_heuristic_exam_events_from_text(courseid, search_text)
    finalize_file_logged_nodes(courseid, filemeta)
    if current_file:
        finalize_file_retrieval_index(current_file, courseid=courseid)
        resolve_file_against_looking_requests(courseid, current_file)
    run_post_file_course_hooks(courseid, filemeta)
    parsed_kind = 'file'
    if isinstance(file, dict) and str(file.get('documenttype') or '').casefold() == 'syllabus':
        parsed_kind = 'file'
    mark_item_parsed(parsed_kind, courseid, fileid, filename)
    print(
        f"parser: heuristic-only item course={courseid} id={fileid} name={filename!r}",
        flush=True,
    )


async def debug_prepare_canvas_file(file: dict, batch_type: str) -> dict | None:
    """Download and set up a Canvas file for batched debug pass parsing (no LLM passes)."""
    if batch_type != 'file' or not isinstance(file, dict):
        return None
    fileid = file.get('id')
    courseid = normalize_courseid(file.get('courseid'))
    if not fileid or not courseid:
        return None
    if is_item_parsed('file', courseid, fileid):
        return None

    totaldoc = file.get('content')
    if not totaldoc:
        url = file.get('url')
        if not url:
            return None
        processed = await processfile_async(
            fileid,
            url,
            content_type=file.get('content_type', ''),
            filename=file.get('name', ''),
        )
        if not processed:
            return None
        totaldoc = processed.get('text', '')
        file['pages'] = processed.get('pages', [])

    pages = normalize_file_pages(file.get('pages', []), str(fileid))
    linked_discovered = bool(file.get('linked_discovered'))
    filemeta = {
        'fileid': str(fileid),
        'courseid': courseid,
        'name': file.get('name', ''),
        'downloadurl': file.get('url', ''),
        'canvaspreviewurl': file.get('previewurl', ''),
        'url': file.get('previewurl', '') or file.get('url', ''),
        'searchtext': clean_surrogates(totaldoc or ''),
        'pages': pages,
    }
    current_file = get_or_create_file_node(courseid, filemeta)

    if PARSER_HEURISTIC_ONLY:
        finish_heuristic_parse_item(
            courseid,
            fileid,
            file,
            filemeta,
            pages=pages,
            current_file=current_file,
            raw_content=totaldoc,
        )
        return None

    if linked_discovered and linked_file_mode() == 'off':
        mark_item_parsed('file', courseid, fileid, file.get('name', ''))
        return None

    linked_pass1_only = linked_discovered and linked_discovered_use_pass1_only(
        filename=file.get('name', ''),
        content_type=file.get('content_type', ''),
        file_size=int(file.get('file_size') or file.get('size') or 0),
        is_study_material=bool(classify_study_material_filename(file.get('name', ''))),
    )

    prompt = pages_to_prompt_text(pages) if pages else clean_surrogates(totaldoc or '')
    if not prompt:
        return None

    return {
        'fileid': str(fileid),
        'courseid': courseid,
        'filename': file.get('name', ''),
        'downloadurl': file.get('url', ''),
        'canvaspreviewurl': file.get('previewurl', ''),
        'pages': pages,
        'prompt': prompt,
        'linked_discovered': linked_discovered,
        'linked_pass1_only': linked_pass1_only,
        'filemeta': filemeta,
        'item': file,
        'current_file': current_file,
    }


async def debug_finalize_canvas_file(ctx: dict) -> None:
    courseid = normalize_courseid(ctx.get('courseid'))
    fileid = ctx.get('fileid')
    filemeta = ctx.get('filemeta') or {}
    file = ctx.get('item') or {}
    current_file = ctx.get('current_file') or fileNodes.get(courseid, {}).get(str(fileid))
    finalize_file_logged_nodes(courseid, filemeta)
    if current_file:
        finalize_file_retrieval_index(current_file, courseid=courseid)
        resolve_file_against_looking_requests(courseid, current_file)
    run_post_file_course_hooks(courseid, filemeta)
    mark_item_parsed('file', courseid, fileid, file.get('name', ''))


def debug_file_pass2_eligible(
    courseid: str,
    fileid: str,
    profile,
    *,
    linked_pass1_only: bool = False,
) -> bool:
    if linked_pass1_only or PARSER_SKIP_PASS2 or not profile or not profile.pass2:
        return False
    tool_names = _debug_pass1_tool_names.get((str(courseid), str(fileid))) or []
    return pass1_needs_pass2(
        tool_names,
        profile_pass2=profile.pass2,
        profile=profile,
    )


async def process_parse_item(file, batch_type):
    timeout_sec = float(os.getenv('PARSER_FILE_TIMEOUT_SEC', '0') or 0)

    async def _run():
        semaphore = parse_semaphore or asyncio.Semaphore(PARSE_MAX_CONCURRENT)
        async with semaphore:
            await _process_parse_item_impl(file, batch_type)

    if timeout_sec > 0:
        try:
            await asyncio.wait_for(_run(), timeout=timeout_sec)
        except asyncio.TimeoutError:
            fileid = file.get('id') if isinstance(file, dict) else ''
            courseid = file.get('courseid') if isinstance(file, dict) else ''
            print(
                f"parser warning: file timeout after {timeout_sec}s "
                f"file={fileid} course={courseid}",
                flush=True,
            )
            return
    else:
        await _run()


async def _process_parse_item_impl(file, batch_type):
        if not isinstance(file, dict):
            print(f"parser debug assignment: skipped non-dict item in batch type={batch_type}", flush=True)
            return
        fileid = file.get('id')
        courseid = normalize_courseid(file.get('courseid'))
        if not fileid or not courseid:
            print(
                f"parser debug assignment: skipped item missing id/courseid type={batch_type} id={fileid!r} courseid={courseid!r}",
                flush=True
            )
            return
        totaldoc = file.get('content')
        if batch_type == 'page':
            if is_item_parsed('page', courseid, fileid):
                return
            content = file.get('content', {})
            if isinstance(content, str):
                try:
                    content = json.loads(content)
                except json.JSONDecodeError:
                    content = {'body_html': content}
            body_html = content.get('body_html') or content.get('body') or ''
            body_text = content.get('body_text') or html_to_text(body_html)
            enqueue_linked_canvas_files(courseid, body_html, name_hint=file.get('name', ''))
            page_title = file.get('name', '') or content.get('title', '')
            html_pages = build_html_body_pages(str(fileid), page_title, body_html or body_text)
            filemeta = {
                'fileid': str(fileid),
                'courseid': courseid,
                'name': page_title,
                'downloadurl': file.get('url', ''),
                'canvaspreviewurl': file.get('previewurl', '') or file.get('url', ''),
                'url': file.get('previewurl', '') or file.get('url', ''),
                'searchtext': body_text,
                'pages': html_pages,
            }
            get_or_create_file_node(courseid, filemeta)
            if PARSER_DOWNLOAD_ONLY:
                finish_download_only_item(
                    courseid,
                    fileid,
                    file,
                    filemeta,
                    pages=html_pages,
                    current_file=fileNodes.get(courseid, {}).get(str(fileid)),
                    batch_type='page',
                )
                return
            skip_page_llm = PARSER_HEURISTIC_ONLY or PARSER_SKIP_PAGE_LLM or (
                PARSER_SKIP_PAGE_LINK_HUB and page_is_link_hub(body_html, body_text)
            )
            if body_text and not skip_page_llm:
                await run_deepseek(
                    body_text,
                    fileid,
                    courseid,
                    file.get('url', ''),
                    file.get('previewurl', ''),
                    file.get('name', ''),
                    pages=html_pages,
                )
            elif body_text and skip_page_llm:
                reason = 'heuristic mode' if PARSER_HEURISTIC_ONLY else (
                    'link hub' if page_is_link_hub(body_html, body_text) else 'bulk mode'
                )
                print(
                    f"parser: skipped page LLM ({reason}) course={courseid} page={fileid}",
                    flush=True,
                )
                if PARSER_HEURISTIC_ONLY:
                    current_page_file = fileNodes.get(courseid, {}).get(str(fileid))
                    finish_heuristic_parse_item(
                        courseid,
                        fileid,
                        file,
                        filemeta,
                        pages=html_pages,
                        current_file=current_page_file,
                        raw_content=content,
                    )
                    return
            finalize_file_logged_nodes(courseid, filemeta)
            run_post_file_course_hooks(courseid, filemeta)
            mark_item_parsed('page', courseid, fileid, file.get('name', ''))
            return

        if batch_type == 'external_submission':
            if is_item_parsed('external_submission', courseid, fileid):
                return
            process_external_submission(fileid, courseid, file)
            return

        if batch_type == 'module_item':
            record_module_item_metadata(courseid, fileid, file, file.get('content', {}))
            if not is_item_parsed('module_item', courseid, fileid):
                mark_item_parsed('module_item', courseid, fileid, file.get('name', ''))
            return

        if batch_type == 'assignment':
            if is_item_parsed('assignment', courseid, fileid):
                ensure_assignment_canvas_id(courseid, fileid, file)
                print(
                    f"parser debug resume: skipped parsed assignment course={courseid} id={fileid}",
                    flush=True
                )
                return
            process_canvas_assignment(fileid, courseid, file)
            return

        if is_item_parsed('file', courseid, fileid):
            current_file = fileNodes.get(courseid, {}).get(str(fileid))
            if current_file and ensure_file_node_page_blocks(current_file):
                print(
                    f"parser debug blocks: backfilled positioned blocks course={courseid} id={fileid}",
                    flush=True,
                )
                finalize_file_retrieval_index(current_file, courseid=courseid)
                if not PARSER_DEFER_CHECKPOINT:
                    flush_write_state()
            else:
                log_parse_item(
                    'skip cached',
                    course_id=courseid,
                    file_id=str(fileid),
                    filename=str(file.get('name') or ''),
                    batch_type=str(batch_type),
                    reason='already_parsed',
                )
            return
        log_parse_item(
            'start',
            course_id=courseid,
            file_id=str(fileid),
            filename=str(file.get('name') or ''),
            batch_type=str(batch_type),
            pass_plan='yes' if pass_plan_enabled() else 'no',
        )
        if not totaldoc:
            url = file.get('url')
            if not url:
                print(
                    f"parser debug assignment: skipped item missing url type={batch_type} course={courseid} id={fileid}",
                    flush=True
                )
                return
            processed = await processfile_async(
                fileid,
                url,
                content_type=file.get('content_type', ''),
                filename=file.get('name', ''),
            )
            if not processed:
                print(
                    f"parser: skipped file after download/extract failure type={batch_type} "
                    f"course={courseid} id={fileid} url={url}",
                    flush=True,
                )
                return
            from canvas_parser.parse.debug_trace import graph_debug_snapshot, trace_checkpoint

            await trace_checkpoint(
                'download_done',
                {
                    'phase': 'download',
                    'course_id': courseid,
                    'file_id': str(fileid),
                    'filename': file.get('name', ''),
                    'page_count': len(processed.get('pages') or []),
                    'text_chars': len(processed.get('text') or ''),
                    'graph': graph_debug_snapshot(courseid),
                },
            )
            totaldoc = processed.get('text', '')
            file['pages'] = processed.get('pages', [])
            log_parse_item(
                'extracted',
                course_id=courseid,
                file_id=str(fileid),
                filename=str(file.get('name') or ''),
                pages=len(file.get('pages') or []),
                chars=len(totaldoc or ''),
            )
        totaldoc = clean_surrogates(totaldoc)
        pages = normalize_file_pages(file.get('pages', []), str(fileid))
        linked_discovered = bool(file.get('linked_discovered'))
        filemeta = {
            'fileid': str(fileid),
            'courseid': courseid,
            'name': file.get('name', ''),
            'downloadurl': file.get('url', ''),
            'canvaspreviewurl': file.get('previewurl', ''),
            'url': file.get('previewurl', '') or file.get('url', ''),
            'searchtext': totaldoc,
            'pages': pages
        }
        current_file = get_or_create_file_node(courseid, filemeta)

        if PARSER_DOWNLOAD_ONLY:
            finish_download_only_item(
                courseid,
                fileid,
                file,
                filemeta,
                pages=pages,
                current_file=current_file,
                batch_type='file',
            )
            return

        if linked_discovered and linked_file_mode() == 'off':
            print(
                f"parser: skipped linked file (mode=off) course={courseid} id={fileid}",
                flush=True,
            )
            mark_item_parsed('file', courseid, fileid, file.get('name', ''))
            return

        if linked_discovered and linked_discovered_skip_llm(
            filename=file.get('name', ''),
            content_type=file.get('content_type', ''),
            file_size=int(file.get('file_size') or file.get('size') or 0),
        ):
            classification = classify_study_material_filename(file.get('name', ''))
            if classification and current_file:
                current_file.type = classification['filetype']
            snippet = build_classification_snippet(pages=pages) if pages else ''
            heuristic_type, _heuristic_conf = heuristic_classify(
                filename=file.get('name', ''),
                snippet=snippet,
            )
            filemeta['academicFileType'] = heuristic_type
            filemeta['pages'] = pages
            _deepseek_pass_context['fileid'] = str(fileid)
            _deepseek_pass_context['academicFileType'] = heuristic_type
            seed_heuristic_concepts_for_file(courseid, filemeta)
            print(
                f"parser: linked heuristic-only file={fileid} course={courseid}",
                flush=True,
            )
            if current_file:
                resolve_file_against_looking_requests(courseid, current_file)
            run_post_file_course_hooks(courseid, filemeta)
            mark_item_parsed('file', courseid, fileid, file.get('name', ''))
            return

        if PARSER_HEURISTIC_ONLY:
            finish_heuristic_parse_item(
                courseid,
                fileid,
                file,
                filemeta,
                pages=pages,
                current_file=current_file,
                raw_content=totaldoc,
            )
            return

        if should_skip_llm_for_image(file.get('name', ''), file.get('content_type', '')):
            apply_heuristic_file_metadata(
                courseid,
                filemeta,
                pages=pages,
                filename=file.get('name', ''),
            )
            if current_file:
                current_file.academicFileType = filemeta.get('academicFileType')
            seed_heuristic_concepts_for_file(courseid, filemeta)
            finalize_file_logged_nodes(courseid, filemeta)
            if current_file:
                resolve_file_against_looking_requests(courseid, current_file)
            run_post_file_course_hooks(courseid, filemeta)
            mark_item_parsed('file', courseid, fileid, file.get('name', ''))
            print(
                f"parser: skipped LLM for image file={fileid} course={courseid}",
                flush=True,
            )
            return

        apply_pass_plan_to_parse_item(
            file,
            pages=pages,
            syllabus_seed_present=None,
        )

        study_material = classify_study_material_filename(file.get('name', '')) if linked_discovered else None
        linked_pass1_only = linked_discovered and linked_discovered_use_pass1_only(
            filename=file.get('name', ''),
            content_type=file.get('content_type', ''),
            file_size=int(file.get('file_size') or file.get('size') or 0),
            is_study_material=bool(study_material),
        )
        known_type = str(file.get('knownFileType') or file.get('known_file_type') or '').strip()
        known_conf = float(file.get('knownFileTypeConfidence') or file.get('known_file_type_confidence') or 0.0)
        known_source = str(file.get('knownFileTypeSource') or file.get('known_file_type_source') or 'heuristic').strip()
        if known_type:
            filemeta['academicFileType'] = known_type
            filemeta['academicFileTypeConfidence'] = known_conf or HEURISTIC_CONFIDENCE_THRESHOLD
            filemeta['academicFileTypeSource'] = known_source or 'heuristic'
            if current_file:
                current_file.academicFileType = known_type
        skip_llm_classify = bool(
            file.get('skipLlmClassify')
            or file.get('skip_llm_classify')
            or PARSER_SKIP_LLM_CLASSIFY
            or (
                known_type
                and (
                    file.get('passPlan')
                    or known_conf >= HEURISTIC_CONFIDENCE_THRESHOLD
                )
                and not FORCE_LLM_CLASSIFY
            )
        )
        skip_pass2 = bool(
            file.get('skipPass2')
            or file.get('skip_pass2')
        )
        skip_llm_pass1 = bool(
            file.get('skipLlmPass1')
            or file.get('skip_llm_pass1')
        )
        log_parse_route(
            course_id=courseid,
            file_id=str(fileid),
            filename=str(file.get('name') or ''),
            resolved_type=known_type or str(filemeta.get('academicFileType') or ''),
            skip_classify=skip_llm_classify,
            skip_pass1=skip_llm_pass1,
            skip_pass2=skip_pass2,
        )
        if skip_llm_pass1:
            if known_type:
                filemeta['academicFileType'] = known_type
                filemeta['academicFileTypeConfidence'] = known_conf or HEURISTIC_CONFIDENCE_THRESHOLD
                filemeta['academicFileTypeSource'] = known_source or 'pass_plan'
                if current_file:
                    current_file.academicFileType = known_type
            finish_heuristic_parse_item(
                courseid,
                fileid,
                file,
                filemeta,
                pages=pages,
                current_file=current_file,
                raw_content=totaldoc,
            )
            return
        if pages:
            full_prompt = pages_to_prompt_text(pages)
            await run_deepseek(
                full_prompt,
                fileid,
                courseid,
                file.get('url', ''),
                file.get('previewurl', ''),
                file.get('name', ''),
                pages=pages,
                linked_discovered=linked_pass1_only,
                skip_classify=skip_llm_classify,
                skip_pass2=skip_pass2,
            )
        else:
            await run_deepseek(
                totaldoc,
                fileid,
                courseid,
                file.get('url', ''),
                file.get('previewurl', ''),
                file.get('name', ''),
                pages=pages,
                linked_discovered=linked_pass1_only,
                skip_classify=skip_llm_classify,
                skip_pass2=skip_pass2,
            )

        finalize_file_logged_nodes(courseid, filemeta)

        if current_file:
            finalize_file_retrieval_index(current_file, courseid=courseid)
            resolve_file_against_looking_requests(courseid, current_file)
        run_post_file_course_hooks(courseid, filemeta)
        mark_item_parsed('file', courseid, fileid, file.get('name', ''))
        log_parse_item(
            'done',
            course_id=courseid,
            file_id=str(fileid),
            filename=str(file.get('name') or ''),
            batch_type='file',
            path='llm',
            type=str(filemeta.get('academicFileType') or ''),
        )


async def parseclass(course):
    items = course.get('content', course) if isinstance(course, dict) else course
    batch_type = course.get('type', 'unknown') if isinstance(course, dict) else 'raw-list'
    if not isinstance(items, list):
        print(f"parser debug assignment: skipped non-list batch type={batch_type}", flush=True)
        return
    items = order_canvas_parse_items(items, batch_type)
    print(f"parser debug assignment: parseclass batch type={batch_type} count={len(items)}", flush=True)
    course_ids = sorted({
        str(item.get('courseid') or '')
        for item in items
        if isinstance(item, dict) and item.get('courseid')
    })
    for cid in course_ids:
        count = sum(1 for item in items if isinstance(item, dict) and str(item.get('courseid') or '') == cid)
        record_batch_start(cid, batch_type, count)
        display_name = get_course_display_name(cid)
        if display_name:
            set_course_display_name(cid, display_name)
    item_tasks = [process_parse_item(file, batch_type) for file in items]
    if item_tasks:
        await asyncio.gather(*item_tasks)
    if not PARSER_DEFER_BATCH_FINALIZE and _deferred_course_finalize:
        flush_deferred_course_finalize(course_ids)
    if not PARSER_DEFER_CHECKPOINT:
        write_state(checkpoint=True)


DIRNAME = Path(__file__).resolve().parent


def _default_canvasfiles_dir() -> Path:
    override = os.getenv('PARSER_CANVASFILES_DIR', '').strip()
    if override:
        return Path(override)
    if str(DIRNAME).startswith('/var/task'):
        return Path('/tmp/canvasfiles')
    return DIRNAME / 'canvasfiles'


def _default_outside_sources_dir() -> Path:
    override = os.getenv('PARSER_OUTSIDE_SOURCES_DIR', '').strip()
    if override:
        return Path(override)
    if str(DIRNAME).startswith('/var/task'):
        return Path('/tmp/nucleus-outside-sources')
    return DIRNAME / 'outside_sources'


folder = _default_canvasfiles_dir()
try:
    folder.mkdir(parents=True, exist_ok=True)
except OSError:
    folder = Path('/tmp/canvasfiles')
    folder.mkdir(parents=True, exist_ok=True)
OUTSIDE_SOURCES_FOLDER = _default_outside_sources_dir()
try:
    OUTSIDE_SOURCES_FOLDER.mkdir(parents=True, exist_ok=True)
except OSError:
    OUTSIDE_SOURCES_FOLDER = Path('/tmp/nucleus-outside-sources')
    OUTSIDE_SOURCES_FOLDER.mkdir(parents=True, exist_ok=True)
CANVAS_DATA_PATH = DIRNAME / 'canvas_data.json'
if str(DIRNAME).startswith('/var/task'):
    CANVAS_GRAPH_PATH = Path('/tmp/canvas_graph.json')
    EMBEDDING_CACHE_PATH = Path('/tmp/canvas_embedding_cache.json')
else:
    CANVAS_GRAPH_PATH = DIRNAME / 'canvas_graph.json'
    EMBEDDING_CACHE_PATH = DIRNAME / 'canvas_embedding_cache.json'


def reconstruct_detail_node(data):
    node = detailNode(data.get('name', 'No name'), data.get('description', ''))
    node.embedded = data.get('embedded', {}) or {}
    node.sourcePages = data.get('sourcePages', []) or []
    return node


def reconstruct_example_node(data):
    node = exampleNode(data.get('name', 'No name'), data.get('description', ''))
    node.embedded = data.get('embedded', {}) or {}
    node.sourcePages = data.get('sourcePages', []) or []
    return node


def reconstruct_concept_node(data):
    node = conceptNode(
        data.get('courseid', 'No courseid'),
        data.get('name', 'No name'),
        data.get('conceptid'),
        data.get('description', '')
    )
    node.embedded = data.get('embedded', {}) or {}
    node.details = [reconstruct_detail_node(detail) for detail in data.get('details', []) or []]
    node.examples = [reconstruct_example_node(example) for example in data.get('examples', []) or []]
    node.problems = data.get('problems', []) or []
    node.sourcePages = data.get('sourcePages', []) or []
    node.prerequisiteConceptIds = data.get('prerequisiteConceptIds', []) or []
    node.aliases = data.get('aliases', []) or []
    node.moduleOrderHints = data.get('moduleOrderHints', []) or []
    node.documentOrder = data.get('documentOrder', {}) or {}
    return node


def reconstruct_problem_node(data):
    node = problemNode(
        data.get('name', 'No name'),
        data.get('problemid'),
        data.get('incomingConceptNodeIds', []) or [],
        data.get('outgoingConceptNodeIds', []) or [],
        data.get('steps', []) or [],
        data.get('answer', 'None'),
        data.get('assignmentNodeIds', []) or []
    )
    node.embedded = data.get('embedded', {}) or {}
    node.sourcePages = data.get('sourcePages', []) or []
    return node


def reconstruct_assignment_node(data):
    node = assignmentNode(
        data.get('name', 'No name'),
        data.get('unlockdate', ''),
        data.get('duedate', ''),
        data.get('gradepercentage', ''),
        data.get('description', ''),
        data.get('problems', []) or [],
        data.get('downloadurl', ''),
        data.get('canvaspreviewurl', ''),
        data.get('filechildren', []) or [],
        data.get('lookingfor', []) or [],
        data.get('submissionTypes', []) or [],
        data.get('submissionLinks', []) or [],
        data.get('submissionDependencies', []) or [],
        data.get('conceptRequirements', []) or [],
        assignmentid=data.get('assignmentid'),
        canvasAssignmentId=data.get('canvasAssignmentId', ''),
    )
    node.assignmentid = data.get('assignmentid', node.assignmentid)
    node.canvasAssignmentId = str(data.get('canvasAssignmentId', node.canvasAssignmentId) or '').strip()
    node.embedded = data.get('embedded', {}) or {}
    return node


def reconstruct_learning_block(data):
    return learningBlock(
        block_id=data.get('blockId', ''),
        courseid=data.get('courseid', ''),
        order=int(data.get('order', 0) or 0),
        concept_id=data.get('conceptId', ''),
        explanation=data.get('explanation', ''),
        detail_refs=data.get('detailRefs', []) or [],
        examples=data.get('examples', []) or [],
        practice_problems=data.get('practiceProblems', []) or [],
        source_refs=data.get('sourceRefs', []) or [],
        order_source=data.get('orderSource', 'merged'),
    )


def reconstruct_syllabus_node(data):
    node = syllabusNode(
        data.get('courseid', 'No courseid'),
        data.get('classtimes', ''),
        [],
        data.get('other', ''),
        data.get('filechildren', []) or [],
        data.get('downloadurl', ''),
        data.get('canvaspreviewurl', ''),
        data.get('participationgrade')
    )
    node.assignments = [reconstruct_assignment_node(assignment) for assignment in data.get('assignments', []) or []]
    node.embedded = data.get('embedded', {}) or {}
    return node


def reconstruct_file_node(data):
    node = fileNode(
        data.get('fileid', ''),
        data.get('courseid', 'No courseid'),
        data.get('name', ''),
        data.get('downloadurl', ''),
        data.get('canvaspreviewurl', ''),
        data.get('type', ''),
    )
    node.concepts = data.get('concepts', []) or []
    node.details = data.get('details', []) or []
    node.examples = data.get('examples', []) or []
    node.problems = data.get('problems', []) or []
    node.embedded = data.get('embedded', {}) or {}
    node.searchtext = data.get('searchtext', '') or ''
    node.pages = normalize_file_pages(data.get('pages', []) or [], node.fileid)
    node.textChunks = data.get('textChunks', []) or []
    return node


def reconstruct_event_node(data):
    node = eventNode(
        data.get('name', 'No name'),
        data.get('startdate', ''),
        data.get('enddate', ''),
        data.get('gradepercentage', ''),
        data.get('description', ''),
        data.get('type', ''),
        data.get('dependencies', []) or []
    )
    node.eventid = data.get('eventid', node.eventid)
    node.type = normalize_event_type(node.type, node.name)
    node.coveredConcepts = data.get('coveredConcepts', []) or []
    node.embedded = data.get('embedded', {}) or {}
    return node


def load_state_from_disk():
    global logged_details, logged_examples, logged_problems, logged_assignments, logged_events, looking_for_files, looking_for_in_canvas, url_to_node, assignmentResourceNodes, externalResources, external_crawl_state
    global completed_model_calls, parsed_items, parsed_item_keys, graphEdges, learningBlocks, moduleOrderHints, courseModules, externalPlatforms
    global parse_file_stats
    if os.getenv('PARSER_SKIP_DISK_RESUME', '').strip().casefold() in {'1', 'true', 'yes', 'on'}:
        print('parser disk resume skipped (fresh sync)', flush=True)
        return
    if not CANVAS_GRAPH_PATH.exists():
        return
    try:
        with open(CANVAS_GRAPH_PATH, 'r', encoding='utf-8') as file:
            state = upgrade_graph_state(json.load(file))
    except (json.JSONDecodeError, OSError) as error:
        print(f"parser debug resume: could not load canvas_graph.json: {error}", flush=True)
        return

    graphEdges = GraphEdgeStore(state.get('edges', []) or [])
    learningBlocks.clear()
    for courseid, blocks in (state.get('learningBlocks', {}) or {}).items():
        learningBlocks[normalize_courseid(courseid)] = [
            reconstruct_learning_block(block) for block in blocks or []
        ]
    moduleOrderHints.clear()
    normalized_hints = {
        normalize_courseid(courseid): hints
        for courseid, hints in (state.get('moduleOrderHints', {}) or {}).items()
    }
    moduleOrderHints.update(normalized_hints)
    courseModules.clear()
    courseModules.update({
        normalize_courseid(courseid): modules or {}
        for courseid, modules in (state.get('courseModules', {}) or {}).items()
    })
    for cid in list(moduleOrderHints.keys()):
        courseModules[cid] = backfill_course_modules_from_hints(
            courseModules.get(cid, {}) or {},
            moduleOrderHints.get(cid, {}) or {},
        )
    externalPlatforms.clear()
    externalPlatforms.update(state.get('external_platforms', {}) or {})

    conceptNodes.clear()
    for item in state.get('concepts', []) or []:
        node = reconstruct_concept_node(item)
        node.courseid = normalize_courseid(node.courseid)
        conceptNodes.setdefault(node.courseid, []).append(node)

    problems.clear()
    for item in state.get('problems', []) or []:
        courseid = normalize_courseid(item.get('courseid', 'No courseid'))
        problems.setdefault(courseid, []).append(reconstruct_problem_node(item))

    eventNodes.clear()
    for item in state.get('events', []) or []:
        courseid = normalize_courseid(item.get('courseid', 'No courseid'))
        event = reconstruct_event_node(item)
        hydrate_test_event_concepts(courseid, event)
        eventNodes.setdefault(courseid, []).append(event)

    syllabusNodes.clear()
    allsyllabi.clear()
    for courseid, item in (state.get('syllabi', {}) or {}).items():
        syllabus = reconstruct_syllabus_node(item)
        cid = normalize_courseid(courseid)
        syllabus.courseid = cid
        syllabusNodes[cid] = syllabus
        allsyllabi[cid] = syllabus.to_dict()

    fileNodes.clear()
    for courseid, course_files in (state.get('files', {}) or {}).items():
        cid = normalize_courseid(courseid)
        fileNodes[cid] = {}
        for fileid, item in (course_files or {}).items():
            node = reconstruct_file_node(item)
            node.courseid = normalize_courseid(node.courseid or cid)
            normalize_file_node_links(cid, node)
            fileNodes[cid][fileid] = node

    logged_details = state.get('logged_details', {}) or {}
    logged_examples = state.get('logged_examples', {}) or {}
    logged_problems = state.get('logged_problems', {}) or {}
    logged_assignments = state.get('logged_assignments', {}) or {}
    logged_events = state.get('logged_events', {}) or {}
    looking_for_files = state.get('looking_for_files', {}) or {}
    looking_for_in_canvas = state.get('looking_for_in_canvas', {}) or {}
    url_to_node = state.get('url_to_node', {}) or {}
    assignmentResourceNodes.clear()
    for courseid, resources in (state.get('assignment_resource_nodes', {}) or {}).items():
        cid = normalize_courseid(courseid)
        assignmentResourceNodes[cid] = {}
        for item in resources or []:
            if not isinstance(item, dict):
                continue
            node = assignmentResourceNode(
                courseid=cid,
                url=item.get('url', ''),
                label=item.get('label', ''),
                source_assignment_node_id=item.get('sourceAssignmentNodeId', ''),
            )
            if item.get('resourceid'):
                node.resourceid = str(item.get('resourceid'))
            normalized = normalize_registry_url(node.url)
            if normalized:
                assignmentResourceNodes[cid][normalized] = node
    externalResources = state.get('external_resources', {}) or {}
    external_crawl_state = state.get('external_crawl_state', {}) or {}
    for courseid, syllabus in syllabusNodes.items():
        register_syllabus_urls(syllabus)
        for assignment in syllabus.assignments:
            resolve_assignment_looking_for(courseid, assignment)
            register_assignment_urls(assignment, courseid)
    for courseid, course_files in fileNodes.items():
        for file_node in (course_files or {}).values():
            register_file_urls(file_node)
    for courseid, resources in assignmentResourceNodes.items():
        for resource in (resources or {}).values():
            register_url_for_node(resource.url, make_node_ref(
                'assignment_resource',
                courseid,
                resource.resourceid,
                resource.label,
            ))
    completed_model_calls = state.get('completed_model_calls', completed_model_calls) or completed_model_calls
    completed_model_calls.setdefault('parse_file_stats', [])
    completed_model_calls.setdefault('parse_session_summary', {})
    parse_file_stats = list(completed_model_calls.get('parse_file_stats') or [])
    parsed_items = state.get('parsed_items', parsed_items) or parsed_items
    parsed_items.setdefault('assignment', [])
    parsed_items.setdefault('file', [])
    parsed_items.setdefault('external', [])
    parsed_items.setdefault('page', [])
    parsed_items.setdefault('module_item', [])
    parsed_items.setdefault('external_submission', [])
    for item in completed_model_calls.get('deepseek_file_passes', []) or []:
        courseid = item.get('courseid')
        fileid = item.get('fileid')
        if courseid and fileid:
            key = parsed_item_key('file', courseid, fileid)
            if not any(existing.get('key') == key for existing in parsed_items['file']):
                parsed_items['file'].append({
                    'key': key,
                    'courseid': str(courseid),
                    'fileid': str(fileid),
                    'name': item.get('filename', ''),
                    'parsed_at': item.get('completed_at', '')
                })
    parsed_item_keys = {
        batch_type: set(item.get('key') for item in items if item.get('key'))
        for batch_type, items in parsed_items.items()
    }
    parsed_item_keys.setdefault('assignment', set())
    parsed_item_keys.setdefault('file', set())
    parsed_item_keys.setdefault('external', set())
    parsed_item_keys.setdefault('page', set())
    parsed_item_keys.setdefault('module_item', set())
    parsed_item_keys.setdefault('external_submission', set())

    for item in parsed_items.get('assignment', []) or []:
        cid = normalize_courseid(item.get('courseid'))
        canvas_id = str(item.get('fileid') or '').strip()
        name = str(item.get('name') or '').strip()
        if not cid or not canvas_id:
            continue
        assignment = find_assignment_node(cid, assignmentname=name) if name else None
        if assignment and not getattr(assignment, 'canvasAssignmentId', ''):
            assignment.canvasAssignmentId = canvas_id

    print(
        f"parser debug resume: loaded {sum(len(nodes) for nodes in conceptNodes.values())} concepts, "
        f"{sum(len(nodes) for nodes in problems.values())} problems, "
        f"{sum(len(nodes) for nodes in eventNodes.values())} events, "
        f"{sum(len(files) for files in fileNodes.values())} files",
        flush=True
    )


def queue_pending_assignment_summaries():
    completed_ids = {
        item.get('assignmentid')
        for item in completed_model_calls.get('local_assignment_summaries', [])
    }
    for courseid, syllabus in syllabusNodes.items():
        for assignment in syllabus.assignments:
            if assignment.assignmentid not in completed_ids:
                enqueue_assignment_description_summary(courseid, assignment.assignmentid, assignment.description)


def build_learning_blocks_for_course(courseid):
    concepts = [node.to_dict() for node in conceptNodes.get(courseid, [])]
    prerequisite_map = {
        concept.get('conceptid'): concept.get('prerequisiteConceptIds', [])
        for concept in concepts
        if concept.get('conceptid')
    }
    problems_by_concept = {}
    for problem in problems.get(courseid, []) or []:
        for concept_id in problem.incomingConceptNodeIds + problem.outgoingConceptNodeIds:
            problems_by_concept.setdefault(concept_id, [])
            if problem.problemid not in problems_by_concept[concept_id]:
                problems_by_concept[concept_id].append(problem.problemid)
    return build_hybrid_learning_blocks(
        courseid,
        concepts,
        moduleOrderHints.get(courseid, {}),
        prerequisite_map,
        problems_by_concept,
    )


def _prune_stale_learning_block_edges(graph_edges, blocks):
    """Remove learningBlock edges that no longer match regenerated block IDs."""
    block_ids = set()
    for block in blocks or []:
        if isinstance(block, dict):
            block_id = block.get('blockId')
        else:
            block_id = getattr(block, 'blockId', None)
        if block_id:
            block_ids.add(str(block_id))
    if not block_ids:
        return 0
    kept = []
    removed = 0
    for edge in graph_edges.edges:
        if edge.get('fromType') != 'learningBlock' and edge.get('toType') != 'learningBlock':
            kept.append(edge)
            continue
        from_id = str(edge.get('fromId') or '')
        to_id = str(edge.get('toId') or '')
        if from_id in block_ids and to_id in block_ids:
            kept.append(edge)
        else:
            removed += 1
    graph_edges.edges = kept
    return removed


def infer_confident_concept_sequence(courseid):
    """Backfill document-order prerequisite edges from stored concept metadata."""
    concepts = conceptNodes.get(courseid, []) or []
    by_file = {}
    for concept in concepts:
        order = getattr(concept, 'documentOrder', {}) or {}
        file_id = str(order.get('fileId') or '')
        if not file_id and concept.sourcePages:
            file_id = str(concept.sourcePages[0].get('fileid') or '')
        if not file_id:
            continue
        if not (order.get('heading') if isinstance(order.get('heading'), dict) else None):
            order = merge_document_order(
                order,
                build_document_order({'name': concept.name}, file_id=file_id),
            )
            concept.documentOrder = order
        by_file.setdefault(file_id, []).append({
            'conceptId': concept.conceptid,
            'name': concept.name,
            'documentOrder': order,
        })
    added = 0
    for rows in by_file.values():
        added += apply_outline_sequence_edges(
            courseid,
            rows,
            find_concept_by_name_or_id,
            add_concept_prerequisite_edge,
        )
    if added:
        print(
            f"parser debug sequence: finalize added {added} document-order edge(s) course={courseid}",
            flush=True,
        )


def finalize_graph_processing_trial():
    """Trial reconcile: course events + concept dedupe without volume caps or block synthesis."""
    course_ids = {
        normalize_courseid(courseid)
        for courseid in list(conceptNodes.keys()) + list(syllabusNodes.keys()) + list(eventNodes.keys()) + list(fileNodes.keys())
        if normalize_courseid(courseid)
    }
    for cid in course_ids:
        resolve_logged_orphans(
            cid,
            logged_details,
            logged_examples,
            logged_problems,
            conceptNodes.get(cid, []),
            add_detail_node,
            add_example_node,
            add_problem_node,
        )
        run_finalize_course_events(cid)
        run_link_module_items_to_events(cid)
        course_concepts = conceptNodes.get(cid, [])
        shadowed, shadow_remap = merge_heading_shadow_concepts(course_concepts)
        if shadow_remap:
            course_concepts = shadowed
            apply_concept_id_remap(cid, conceptNodes, problems, graphEdges, shadow_remap)
        merged, id_remap = merge_duplicate_concepts(course_concepts)
        if merged:
            conceptNodes[cid] = merged
            apply_concept_id_remap(cid, conceptNodes, problems, graphEdges, id_remap)
        elif shadow_remap:
            conceptNodes[cid] = course_concepts
        pruned = dedupe_echo_concept_details(conceptNodes.get(cid, []))
        if pruned:
            print(
                f"parser debug trial finalize: removed {pruned} echo detail(s) course={cid}",
                flush=True,
            )
    print("parser trial simple finalize completed", flush=True)


def finalize_graph_processing():
    if PARSER_TRIAL_SIMPLE_FINALIZE:
        finalize_graph_processing_trial()
        return
    course_ids = {
        normalize_courseid(courseid)
        for courseid in list(conceptNodes.keys()) + list(syllabusNodes.keys()) + list(eventNodes.keys()) + list(fileNodes.keys())
        if normalize_courseid(courseid)
    }
    for cid in course_ids:
        resolve_logged_orphans(
            cid,
            logged_details,
            logged_examples,
            logged_problems,
            conceptNodes.get(cid, []),
            add_detail_node,
            add_example_node,
            add_problem_node,
        )
        run_finalize_course_events(cid)
        run_link_module_items_to_events(cid)
        course_concepts = conceptNodes.get(cid, [])
        shadowed, shadow_remap = merge_heading_shadow_concepts(course_concepts)
        if shadow_remap:
            course_concepts = shadowed
            apply_concept_id_remap(cid, conceptNodes, problems, graphEdges, shadow_remap)
        merged, id_remap = merge_duplicate_concepts(course_concepts)
        if merged:
            conceptNodes[cid] = merged
            apply_concept_id_remap(cid, conceptNodes, problems, graphEdges, id_remap)
        elif shadow_remap:
            conceptNodes[cid] = course_concepts
        promoted = promote_reading_extractions_for_course(
            cid,
            conceptNodes.get(cid, []),
            fileNodes.get(cid, {}),
            add_concept_node=add_concept_node,
            find_concept=find_concept_by_name_or_id,
        )
        if promoted:
            print(
                f"parser debug merge: promoted {promoted} reading section(s) to concepts course={cid}",
                flush=True,
            )
        pruned = dedupe_echo_concept_details(conceptNodes.get(cid, []))
        if pruned:
            print(
                f"parser debug merge: removed {pruned} echo detail(s) course={cid}",
                flush=True,
            )
        pruned = prune_excessive_concept_details(conceptNodes.get(cid, []))
        if pruned:
            print(
                f"parser debug merge: pruned {pruned} duplicate/excess detail(s) course={cid}",
                flush=True,
            )
        course_concepts = conceptNodes.get(cid, [])
        course_files = fileNodes.get(cid, {}) or {}
        file_resolver = build_file_type_resolver(course_files)
        file_ids = {
            str((getattr(concept, 'documentOrder', None) or {}).get('fileId') or '').strip()
            for concept in course_concepts
        }
        file_ids.discard('')
        humanities_heavy = _course_humanities_reading_heavy(file_ids, file_resolver)
        lecture_heavy = _course_is_lecture_slides_heavy(course_files, file_resolver)
        bulk_linked = len(course_files) > 40
        sparse_signal = (
            (bulk_linked and not lecture_heavy)
            or humanities_heavy
            or _course_is_detail_sparse(course_concepts)
        )
        pruned = cap_concepts_per_source_file(
            course_concepts,
            file_type_resolver=file_resolver,
        )
        if pruned:
            print(
                f"parser debug merge: capped {pruned} excess concept(s) per source file course={cid}",
                flush=True,
            )
        pruned = cap_course_concept_budget(
            course_concepts,
            force_detail_sparse=sparse_signal,
            file_type_resolver=file_resolver,
            course_files=course_files,
            bulk_linked=bulk_linked and not lecture_heavy,
        )
        if pruned:
            print(
                f"parser debug merge: capped {pruned} excess concept(s) to course budget course={cid}",
                flush=True,
            )
        pruned = cap_course_detail_budget(
            course_concepts,
            force_detail_sparse=sparse_signal,
            humanities_heavy=humanities_heavy,
        )
        if pruned:
            print(
                f"parser debug merge: capped {pruned} detail(s) to course budget course={cid}",
                flush=True,
            )
        infer_confident_concept_sequence(cid)
        generated_blocks = build_learning_blocks_for_course(cid)
        if generated_blocks:
            blocks = [reconstruct_learning_block(block) for block in generated_blocks]
            learningBlocks[cid] = blocks
            _prune_stale_learning_block_edges(graphEdges, blocks)
            sync_learning_block_next_edges(graphEdges, blocks)
        sync_concept_prerequisite_edges(graphEdges, conceptNodes.get(cid, []) or [])

    weekly = _load_weekly_schedule()
    for courseid, course_files in fileNodes.items():
        graph_snapshot = _graph_snapshot_for_indexing(courseid)
        for file_node in course_files.values():
            persist_file_node_text_chunks(
                file_node,
                courseid=courseid,
                graph_snapshot=graph_snapshot,
                weekly_schedule=weekly,
            )


def process_external_submission(fileid, courseid, file_item):
    payload = normalize_external_submission_item(file_item)
    assignment = find_assignment_node(
        courseid,
        assignmentname=payload.get('canvasAssignmentName') or payload.get('gradescopeAssignmentTitle')
    )
    if not assignment:
        for syllabus in syllabusNodes.values():
            for candidate in syllabus.assignments:
                if str(payload.get('canvasAssignmentId', '')) in candidate.name:
                    assignment = candidate
                    break
            if assignment:
                break
    if not assignment:
        print(
            f"parser debug external_submission: no assignment match course={courseid} canvasId={payload.get('canvasAssignmentId')}",
            flush=True
        )
        return None

    dependency = apply_external_submission_mapping(assignment, payload)
    graphEdges.add_edge(
        'assignment',
        assignment.assignmentid,
        'external_platform',
        payload.get('gradescopeUrl', ''),
        'requires_submission',
        source='gradescope-sync',
        metadata=dependency,
    )
    externalPlatforms.update(build_external_platform_state({
        'synced_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'mappings': [payload],
        'courses': [],
    }))
    mark_item_parsed('external_submission', courseid, fileid, assignment.name)
    return assignment.assignmentid


def write_state(embed=False, checkpoint=False):
    if embed:
        update_embedded_fields()
    if checkpoint or embed:
        flush_write_state(force=True, checkpoint=checkpoint)
        return
    schedule_write_state()


def write_state_impl(log_validation=False):
    concepts = []
    problem_nodes = []
    event_nodes = []
    syllabi = {}
    files = {}
    serialized_learning_blocks = {}
    for course_nodes in conceptNodes.values():
        for node in course_nodes:
            concepts.append(node.to_dict())
    for courseid, course_problems in problems.items():
        for problem in course_problems:
            item = problem.to_dict()
            item['courseid'] = courseid
            problem_nodes.append(item)
    for courseid, syllabus in syllabusNodes.items():
        for assignment in syllabus.assignments:
            resolve_assignment_looking_for(courseid, assignment)
        syllabi[courseid] = syllabus.to_dict()
    for courseid, course_events in eventNodes.items():
        for event in course_events:
            hydrate_test_event_concepts(courseid, event)
            item = event.to_dict()
            item['courseid'] = courseid
            event_nodes.append(item)
    for courseid, course_files in fileNodes.items():
        files[courseid] = {}
        for fileid, file_node in course_files.items():
            normalize_file_node_links(courseid, file_node)
            files[courseid][fileid] = file_node.to_dict()

    for courseid, blocks in learningBlocks.items():
        serialized_learning_blocks[courseid] = [block.to_dict() for block in blocks]

    serialized_assignment_resources = {}
    for courseid, resources in assignmentResourceNodes.items():
        serialized_assignment_resources[courseid] = [
            resource.to_dict()
            for resource in (resources or {}).values()
        ]

    state = build_graph_state(
        concepts,
        problem_nodes,
        event_nodes,
        syllabi,
        files,
        graphEdges.to_list(),
        serialized_learning_blocks,
        moduleOrderHints,
        externalPlatforms,
        logged_details,
        logged_examples,
        logged_problems,
        logged_assignments,
        logged_events,
        looking_for_files,
        looking_for_in_canvas,
        url_to_node,
        serialized_assignment_resources,
        externalResources,
        external_crawl_state,
        completed_model_calls,
        parsed_items,
    )
    warnings = validate_graph_state(state, graphEdges)
    if log_validation:
        print_graph_validation_summary(warnings, reason='checkpoint')

    state['courseModules'] = {
        normalize_courseid(courseid): modules
        for courseid, modules in (courseModules or {}).items()
    }

    atomic_write_json(CANVAS_GRAPH_PATH, state)


def print_phase_timings(total_started_at):
    total_ms = (time.perf_counter() - total_started_at) * 1000
    print(
        "parser phase timings ms: "
        f"pdf_io={phase_timings.get('pdf_io_ms', 0):.0f} "
        f"parse_llm={phase_timings.get('parse_llm_ms', 0):.0f} "
        f"write_state={phase_timings.get('write_state_ms', 0):.0f} "
        f"embed={phase_timings.get('embed_ms', 0):.0f} "
        f"external={phase_timings.get('external_ms', 0):.0f} "
        f"total={total_ms:.0f}",
        flush=True
    )


async def main():
    global assignment_summary_queue
    reset_balance_guard()
    total_started_at = time.perf_counter()
    print("parser.py main is running ...................", flush=True)

    activity_log_path = init_parse_activity_log(Path(__file__).resolve().parent)
    if activity_log_path:
        print(f"parser activity log: {activity_log_path}", flush=True)
        for cid, name in (load_course_name_cache() or {}).items():
            set_course_display_name(cid, name)

    init_parse_runtime()
    loop = asyncio.get_running_loop()
    assignment_summary_queue = asyncio.Queue()
    summary_worker_task = asyncio.create_task(assignment_summary_worker())
    inflight_tasks = set()

    load_embedding_cache_from_disk()
    load_state_from_disk()
    queue_pending_assignment_summaries()

    async def run_parse_batch(line):
        try:
            await parseclass(line)
        except InsufficientBalanceAbort:
            raise
        except Exception as error:
            print(f"parser batch failed: {error}", flush=True)

    def track_task(task):
        inflight_tasks.add(task)
        task.add_done_callback(inflight_tasks.discard)

    try:
        while True:
            rawline = await loop.run_in_executor(None, sys.stdin.readline)

            if rawline == "":
                if inflight_tasks:
                    await asyncio.sleep(0.1)
                    continue
                break

            rawline = rawline.strip()
            if not rawline:
                continue

            if rawline == 'None':
                break

            print("parser.py: run line", flush=True)
            line = json.loads(rawline)
            batch_type = line.get('type', 'unknown') if isinstance(line, dict) else 'raw-list'
            track_task(asyncio.create_task(run_parse_batch(line)))

        if inflight_tasks:
            await asyncio.gather(*inflight_tasks)

        await parse_pending_linked_canvas_files()
        flush_write_state(force=True)
        if PARSER_DOWNLOAD_ONLY:
            print_phase_timings(total_started_at)
            print("parser download-only prefetch completed", flush=True)
            print(PARSER_ALL_PASSES_COMPLETED, flush=True)
            return
        if not PARSER_SKIP_EXTERNAL:
            await parse_external_resources_after_canvas()
        flush_deferred_course_finalize()
        finalize_graph_processing()
        flush_write_state(force=True)

        if PARSER_DEFER_FILE_EMBED:
            print(
                "parser embedding deferred (bulk mode) — run: python scripts/reembed_graph.py",
                flush=True,
            )
        else:
            await update_embedded_fields_async()
            flush_write_state(force=True)
        print_phase_timings(total_started_at)
        print("parser completed__________________________________________________", flush=True)

        if not PARSER_SKIP_ASSIGNMENT_SUMMARY:
            await assignment_summary_queue.join()
            summary_worker_task.cancel()
            try:
                await summary_worker_task
            except asyncio.CancelledError:
                pass
            flush_write_state(force=True)
            print("parser local summaries completed__________________________________________________", flush=True)
        else:
            summary_worker_task.cancel()
            try:
                await summary_worker_task
            except asyncio.CancelledError:
                pass

        if PARSER_SKIP_SYLLABUS_FINAL_PASS:
            print("parser syllabus final pass skipped (bulk mode)", flush=True)
        else:
            syllabus_tasks = []
            seen_syllabus_courses = set()
            for courseid, syllabus in list(syllabusNodes.items()):
                cid = normalize_courseid(courseid)
                if cid in seen_syllabus_courses:
                    continue
                seen_syllabus_courses.add(cid)

                syllabus_file = find_syllabus_file_for_course(cid)
                if not syllabus_file:
                    print(f"parser debug syllabus pass: no file found for course={cid}", flush=True)
                    continue

                full_prompt = pages_to_prompt_text(syllabus_file.pages)
                if not full_prompt:
                    continue

                print(f"parser debug syllabus pass: grade check course={cid} file={syllabus_file.fileid}", flush=True)
                syllabus_tasks.append(
                    run_deepseek(
                        full_prompt,
                        syllabus_file.fileid,
                        cid,
                        syllabus_file.downloadurl,
                        syllabus_file.canvaspreviewurl,
                        syllabus_file.name,
                        pages=syllabus_file.pages,
                        final_pass=True,
                    )
                )
            print("parser syllabus final pass completed__________________________________________________", flush=True)

            if syllabus_tasks:
                syllabus_results = await asyncio.gather(*syllabus_tasks, return_exceptions=True)
                for result in syllabus_results:
                    if isinstance(result, Exception):
                        print(f"parser debug syllabus pass: task failed error={result}", flush=True)
            for courseid in seen_syllabus_courses:
                run_finalize_course_events(courseid)
                run_link_module_items_to_events(courseid)
            flush_write_state(force=True, checkpoint=True)

        for courseid in eventNodes:
            events = [event.to_dict() for event in eventNodes.get(courseid, [])]
            print_course_event_audit(normalize_courseid(courseid), events)
        flush_write_state(force=True, checkpoint=True)
        run_event_pipeline_check()
        wall_ms = (time.perf_counter() - total_started_at) * 1000
        session_summary = assess_from_completed_model_calls(
            completed_model_calls,
            parse_file_stats=parse_file_stats,
            phase_timings=phase_timings,
            wall_ms=wall_ms,
        )
        completed_model_calls['parse_session_summary'] = {
            'wall_ms': round(wall_ms, 1),
            'phase_timings_ms': dict(phase_timings),
            'finished_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        }
        print_session_efficiency_report(session_summary)
        stats_report_path = write_parse_stats_report(
            session_summary,
            Path(PARSER_STATS_REPORT_PATH) if PARSER_STATS_REPORT_PATH else (
                Path(__file__).resolve().parent / '.cache' / 'parse_stats' / 'report.json'
            ),
        )
        print(f"parser stats report: {stats_report_path}", flush=True)
        finish_parse_activity_log([
            f"Graph: `{CANVAS_GRAPH_PATH}`",
            format_session_efficiency_report(session_summary),
            f"Phase timings: pdf_io={phase_timings.get('pdf_io_ms', 0):.0f}ms "
            f"parse_llm={phase_timings.get('parse_llm_ms', 0):.0f}ms "
            f"embed={phase_timings.get('embed_ms', 0):.0f}ms",
        ])
        flush_write_state(force=True, checkpoint=True)
        print(PARSER_ALL_PASSES_COMPLETED, flush=True)
    finally:
        shutdown_parse_runtime()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except InsufficientBalanceAbort as error:
        print(f"parser aborted: {error}", flush=True)
        raise SystemExit(2) from error