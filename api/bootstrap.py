"""Vercel file-based entry point for /api/bootstrap."""
from pathlib import Path
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Handler


class handler(Handler):
    """Use the same validated HTTP adapter as the local application."""

