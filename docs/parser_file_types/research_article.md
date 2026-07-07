# Research article (`research_article`)

Peer-reviewed journal article or preprint (abstract, methods, results).

## Classification signals

- Filename and snippet heuristics in `canvas_parser/parse/file_types.py`
- LLM snippet pass when heuristic confidence is below threshold
- Env: `PARSER_CLASSIFY_SNIPPET_CHARS` (default 2800), `PARSER_FORCE_LLM_CLASSIFY=1`

## Pass 1 — extract

This is a RESEARCH ARTICLE. add_file_node first. Use log_article_claim, log_article_method, log_article_finding, and log_article_key_term for structured article metadata. Skip bibliographic boilerplate.

## Type-specific log tools

Tools: `log_article_claim`, `log_article_method`, `log_article_finding`, `log_article_key_term`

RESEARCH ARTICLE EXTRACTION:
- log_article_claim for main claims/hypotheses
- log_article_method for methods/design
- log_article_finding for reported results
- log_article_key_term for defined jargon
Skip abstract boilerplate and references. No STEM concept graph.

## Pipeline flags

| Flag | Value |
| --- | --- |
| Concepts | yes |
| Problems | **no** |
| Events | no |
| Link to events | no |
| Pass 2 | yes |
| Teaching outline | no |
| Keyword extract | auto |
| Default `filetype` | `content` |
| Blocked pass-1 tools | log_problem, add_concept_node, log_detail, log_example |

## When to use heuristics vs compression

- **Keyword extract** (`PARSER_KEYWORD_EXTRACT=auto`): applied when profile allows and prompt exceeds min size
- **Linked light mode**: independent; still respects pass-2 skip for non-teaching types
- **Regex/event helpers**: use `classify_study_material_filename` for exam/review filenames before LLM classify

## Agent skill

See `.cursor/skills/parser-file-type-research_article/SKILL.md` when editing parser behavior for this type.
