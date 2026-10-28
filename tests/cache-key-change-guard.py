#!/usr/bin/env python3
"""Fail CI when a changed browser asset keeps its old HTML cache key.

This intentionally checks HTML-referenced CSS/JS assets. Server-side functions,
tests, and modules that are not directly referenced by HTML are left to their
own checks. It compares each page's current reference with the same page in the
base revision, so shared files must be cache-busted everywhere they are loaded.
"""
from html.parser import HTMLParser
from pathlib import PurePosixPath
from urllib.parse import parse_qs, unquote, urlsplit
import subprocess
import sys


def git(*args):
    result = subprocess.run(
        ["git", *args], check=True, text=True, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return result.stdout


def tracked_html(ref):
    paths = git("ls-tree", "-r", "--name-only", ref).splitlines()
    return [path for path in paths if path.lower().endswith(".html")]


def read_at(ref, path):
    try:
        return git("show", f"{ref}:{path}")
    except subprocess.CalledProcessError:
        return None


class AssetParser(HTMLParser):
    def __init__(self, page):
        super().__init__(convert_charrefs=True)
        self.page = page
        self.references = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        for attribute in ("src", "href", "poster"):
            raw = attrs.get(attribute)
            if not raw:
                continue
            value = raw.strip()
            parsed = urlsplit(value)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            pathname = unquote(parsed.path)
            if not pathname.lower().endswith((".css", ".js")):
                continue
            if pathname.startswith("/"):
                resolved = PurePosixPath(pathname.lstrip("/"))
            else:
                resolved = PurePosixPath(self.page).parent / pathname
            resolved = PurePosixPath(resolved)
            normalized = str(resolved)
            if normalized == "." or normalized.startswith("../"):
                continue
            version = parse_qs(parsed.query, keep_blank_values=True).get("v", [""])[0]
            self.references.append((normalized, version))


def references_for(ref):
    references = {}
    for page in tracked_html(ref):
        content = read_at(ref, page)
        if content is None:
            continue
        parser = AssetParser(page)
        parser.feed(content)
        parser.close()
        for asset, version in parser.references:
            references.setdefault((page, asset), []).append(version)
    return references


def main():
    if len(sys.argv) != 3:
        print("Usage: cache-key-change-guard.py BASE_SHA HEAD_SHA", file=sys.stderr)
        return 2

    base, head = sys.argv[1:3]
    changed = git(
        "diff", "--name-only", "--diff-filter=ACMRT", base, head, "--",
        "*.css", "*.js",
    ).splitlines()
    base_refs = references_for(base)
    head_refs = references_for(head)
    errors = []
    checked = 0

    for asset in changed:
        old = {page: versions for (page, path), versions in base_refs.items() if path == asset}
        new = {page: versions for (page, path), versions in head_refs.items() if path == asset}
        # A file not referenced from HTML (e.g. a test helper or server function)
        # does not need a browser cache key.
        if not new:
            continue

        for page, new_versions in new.items():
            old_versions = old.get(page)
            if old_versions is None:
                continue  # Newly introduced reference; no previous key to compare.
            for occurrence, new_version in enumerate(new_versions):
                old_version = old_versions[min(occurrence, len(old_versions) - 1)]
                checked += 1
                if not new_version:
                    errors.append(
                        f"{page}: changed asset {asset} is missing ?v= cache key"
                    )
                elif new_version == old_version:
                    errors.append(
                        f"{page}: {asset} changed but cache key stayed at "
                        f"v={new_version!r}; increment the key in every page that loads it"
                    )

    if errors:
        print("Browser asset cache-key regression detected:")
        print("\n".join(f"- {error}" for error in errors))
        return 1

    print(
        f"Cache-key guard passed: {len(changed)} changed CSS/JS file(s), "
        f"{checked} existing HTML asset reference(s) compared."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
