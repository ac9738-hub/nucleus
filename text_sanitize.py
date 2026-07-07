"""Sanitize text for JSON / HTTP APIs that require valid UTF-8."""


def clean_surrogates(value):
    """Recursively strip lone UTF-16 surrogates from strings."""
    if isinstance(value, str):
        return value.encode("utf-8", "replace").decode("utf-8")
    if isinstance(value, list):
        return [clean_surrogates(item) for item in value]
    if isinstance(value, dict):
        return {
            clean_surrogates(key): clean_surrogates(item)
            for key, item in value.items()
        }
    return value
