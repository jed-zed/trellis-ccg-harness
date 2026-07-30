#!/usr/bin/env python3
"""
Initialize developer for workflow.

Usage:
    python init_developer.py <developer-name>

This creates:
    - .trellis/.developer file with developer info
    - .trellis/workspace/<name>/ directory structure
"""

from __future__ import annotations

import argparse
import sys

from common.paths import (
    DIR_WORKFLOW,
    FILE_DEVELOPER,
    get_developer,
)
from common.developer import init_developer


def build_parser() -> argparse.ArgumentParser:
    """Build the command-line parser."""
    parser = argparse.ArgumentParser(
        description="Initialize the Trellis developer workspace.",
    )
    parser.add_argument(
        "developer_name",
        metavar="developer-name",
        help="portable name used for the developer workspace directory",
    )
    return parser


def main() -> None:
    """CLI entry point."""
    args = build_parser().parse_args()
    name = args.developer_name

    # Check if already initialized
    existing = get_developer()
    if existing:
        print(f"Developer already initialized: {existing}")
        print()
        print(f"To reinitialize, remove {DIR_WORKFLOW}/{FILE_DEVELOPER} first")
        sys.exit(0)

    if init_developer(name):
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
