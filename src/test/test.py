#!/usr/bin/env python3
"""
tree.py — Pretty-print a directory tree, skipping node_modules by default.

Usage:
    python tree.py                         # scans jarvis-ai-suite
    python tree.py C:\\some\\folder        # specific folder
    python tree.py . --include-node        # include node_modules (slow!)
    python tree.py . -a                    # include hidden files
    python tree.py . -s                    # show file sizes
    python tree.py . -d                    # directories only
"""

import os
import sys
import argparse
from pathlib import Path

TEE     = "├──"
ELBOW   = "└──"
BLANK   = "    "
PIPE_SP = "│   "

DEFAULT_PATH = r"H:\Desktop\jarvis-ai-suite"

# Folders to skip by default
SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".venv", "venv", ".next", "dist", ".cache"}


def format_size(size_bytes):
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}" if unit != "B" else f"{size_bytes} B"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"


def print_tree(path, prefix="", show_hidden=False, dirs_only=False,
               show_size=False, skip_dirs=None):
    if skip_dirs is None:
        skip_dirs = set()

    try:
        entries = sorted(path.iterdir(), key=lambda e: (e.is_file(), e.name.lower()))
    except PermissionError:
        print(f"{prefix}  [permission denied]")
        return 0, 0

    if not show_hidden:
        entries = [e for e in entries if not e.name.startswith(".")]

    if dirs_only:
        entries = [e for e in entries if e.is_dir()]

    file_count = 0
    dir_count  = 0

    for index, entry in enumerate(entries):
        is_last   = index == len(entries) - 1
        connector = ELBOW if is_last else TEE
        extension = BLANK if is_last else PIPE_SP

        if entry.is_symlink():
            target = os.readlink(entry)
            print(f"{prefix}{connector} {entry.name} -> {target}")
            file_count += 1

        elif entry.is_dir():
            if entry.name in skip_dirs:
                print(f"{prefix}{connector} [{entry.name}]  ← skipped")
                dir_count += 1
            else:
                print(f"{prefix}{connector} [{entry.name}]")
                dir_count += 1
                sub_files, sub_dirs = print_tree(
                    entry,
                    prefix=prefix + extension,
                    show_hidden=show_hidden,
                    dirs_only=dirs_only,
                    show_size=show_size,
                    skip_dirs=skip_dirs,
                )
                file_count += sub_files
                dir_count  += sub_dirs

        else:
            size_str = ""
            if show_size:
                try:
                    size_str = f"  ({format_size(entry.stat().st_size)})"
                except OSError:
                    size_str = "  (? B)"
            print(f"{prefix}{connector} {entry.name}{size_str}")
            file_count += 1

    return file_count, dir_count


def main():
    parser = argparse.ArgumentParser(description="Pretty-print a directory tree.")
    parser.add_argument("path", nargs="?", default=DEFAULT_PATH)
    parser.add_argument("-a", "--all", action="store_true", dest="show_hidden",
                        help="Include hidden files (.git, etc.)")
    parser.add_argument("-d", "--dirs-only", action="store_true",
                        help="List directories only")
    parser.add_argument("-s", "--size", action="store_true",
                        help="Show file sizes")
    parser.add_argument("--include-node", action="store_true",
                        help="Include node_modules (very slow!)")
    args = parser.parse_args()

    root = Path(args.path).resolve()

    if not root.exists():
        print(f"Error: '{root}' does not exist.", file=sys.stderr)
        sys.exit(1)
    if not root.is_dir():
        print(f"Error: '{root}' is not a directory.", file=sys.stderr)
        sys.exit(1)

    skip = set() if args.include_node else SKIP_DIRS

    print(f"\n{root}")
    print("=" * len(str(root)))

    if skip:
        print(f"  (skipping: {', '.join(sorted(skip))})\n")

    file_count, dir_count = print_tree(
        root,
        show_hidden=args.show_hidden,
        dirs_only=args.dirs_only,
        show_size=args.size,
        skip_dirs=skip,
    )

    parts = []
    if not args.dirs_only:
        parts.append(f"{file_count} file{'s' if file_count != 1 else ''}")
    parts.append(f"{dir_count} director{'ies' if dir_count != 1 else 'y'}")
    print(f"\n  {', '.join(parts)}\n")


if __name__ == "__main__":
    main()