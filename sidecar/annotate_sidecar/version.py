"""Use the product version without tying project schemas to release numbers."""
import json
import os
from pathlib import Path


def product_version():
    if os.environ.get('ANNOTATE_APP_VERSION'):
        return os.environ['ANNOTATE_APP_VERSION']
    try:
        return json.loads((Path(__file__).resolve().parents[2] / 'package.json').read_text())['version']
    except (OSError, ValueError, KeyError):
        return 'development'
