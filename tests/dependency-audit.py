#!/usr/bin/env python3
"""Map local source dependencies and report possible dead JavaScript candidates.

Explicit broken local JS/CSS dependencies fail the audit. Unreachable files and
unreferenced declarations are reported for human review and are never removed.
Cloudflare Pages Functions are treated as entry points because the platform
routes them by path.
"""
from __future__ import annotations
import argparse
import json
import os
import re
from collections import Counter, defaultdict
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

IGNORED_DIRS = {".git", "node_modules", ".venv", "__pycache__"}
JS_EXTS = {".js", ".mjs", ".cjs"}
CODE_EXTS = JS_EXTS | {".html", ".css"}
IMPORT_RE = re.compile(r"""(?:\b(?:import|export)\s+(?:[^;'"]*?\s+from\s*)?|\bimport\s*\(|\brequire\s*\()\s*['"]([^'"]+)['"]""")
NEW_URL_RE = re.compile(r"""new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url""")
FETCH_RE = re.compile(r"""\bfetch\(\s*['"]([^'"]+)['"]""")
STRING_CONST_RE = re.compile(r"""^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])(.*?)\2""", re.M)
SERVICE_WORKER_REGISTER_RE = re.compile(r"""serviceWorker\s*\.\s*register\s*\(\s*(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*))""")
DECL_RE = re.compile(r"""^\s*(?:export\s+)?(?:(?:async\s+)?function|class)\s+([A-Za-z_$][\w$]*)\b|^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=""")

def ignored(path: Path) -> bool:
    return any(part in IGNORED_DIRS for part in path.parts)

def external(raw: str) -> bool:
    raw = raw.strip()
    parsed = urlsplit(raw)
    return (not raw or raw.startswith("#") or raw.startswith("//") or
            bool(parsed.scheme) or bool(parsed.netloc) or
            parsed.path.startswith(("data:", "blob:")))

def resolve_local(root: Path, source: Path, raw: str) -> Path | None:
    if external(raw):
        return None
    parsed = urlsplit(raw.strip())
    path_text = unquote(parsed.path)
    if not path_text:
        return None
    candidate = root / path_text.lstrip("/") if path_text.startswith("/") else source.parent / path_text
    try:
        target = candidate.resolve()
        target.relative_to(root.resolve())
        return target
    except (OSError, ValueError):
        return None

def resolve_module(root: Path, source: Path, raw: str) -> Path | None:
    target = resolve_local(root, source, raw)
    if target is None:
        return None
    candidates = [target]
    if not target.suffix:
        candidates.extend(target.with_suffix(ext) for ext in (".js", ".mjs", ".cjs", ".json"))
        candidates.extend(target / ("index" + ext) for ext in (".js", ".mjs", ".cjs"))
    return next((candidate for candidate in candidates if candidate.is_file()), target)

class HtmlAssetParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.references = []
    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag.lower() == "script" and values.get("src"):
            self.references.append(values["src"] or "")
        if tag.lower() == "link" and values.get("href"):
            rel = (values.get("rel") or "").lower().split()
            href = values["href"] or ""
            if "stylesheet" in rel or href.lower().split("?")[0].endswith(".css"):
                self.references.append(href)

def discover_files(root: Path) -> list[Path]:
    found = []
    for directory, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name not in IGNORED_DIRS]
        base = Path(directory)
        for filename in filenames:
            path = base / filename
            if path.suffix.lower() not in CODE_EXTS:
                continue
            relative = path.relative_to(root)
            if relative.parts[0] == "tests":
                continue
            found.append(path)
    return sorted(found)

def audit(root: Path) -> dict:
    root = root.resolve()
    files = discover_files(root)
    contents = {p: p.read_text(encoding="utf-8", errors="replace") for p in files}
    rel = {p: p.relative_to(root).as_posix() for p in files}
    edges = set()
    issues = []
    html_entries = set()
    # Deployment platforms route these handlers by filesystem path; lack of a local
    # import does not make them dead code. Shared helper modules remain dependencies.
    function_entries = {
        p for p in files
        if p.suffix.lower() in JS_EXTS and (
            rel[p].startswith("api/") or
            (rel[p].startswith("functions/") and not rel[p].startswith("functions/_shared/"))
        )
    }

    def add_reference(source: Path, raw: str, mode: str, strict: bool):
        target = resolve_local(root, source, raw)
        if target is None:
            return
        suffix = target.suffix.lower()
        if mode == "html":
            if suffix not in JS_EXTS | {".css"}:
                return
            candidates = [target]
            if not target.suffix:
                candidates.extend([target.with_suffix(".js"), target.with_suffix(".css")])
        elif mode == "css":
            if suffix not in {".js", ".css"}:
                return
            candidates = [target]
        else:
            candidates = [resolve_module(root, source, raw) or target]
        found = next((candidate for candidate in candidates if candidate.is_file()), None)
        if found is None:
            if strict:
                issues.append({"source": rel[source], "reference": raw,
                               "message": "local dependency does not resolve to an existing file"})
            return
        if found in rel:
            edges.add((rel[source], rel[found], raw))

    for source in files:
        text = contents[source]
        if source.suffix.lower() == ".html":
            parser = HtmlAssetParser()
            try:
                parser.feed(text)
                parser.close()
            except Exception as exc:
                issues.append({"source": rel[source], "reference": "", "message": f"HTML parse failed: {exc}"})
            for raw in parser.references:
                add_reference(source, raw, "html", True)
                target = resolve_local(root, source, raw)
                if target and target.suffix.lower() in JS_EXTS and target.is_file():
                    html_entries.add(target)
        elif source.suffix.lower() == ".css":
            imports = re.findall(r"""@import\s+(?:url\(\s*)?['"]?([^'"\s\)]+)""", text, re.I)
            urls = re.findall(r"""url\(\s*['"]?([^'")]+)['"]?\s*\)""", text, re.I)
            for raw in imports + urls:
                if Path(urlsplit(raw).path).suffix.lower() in {".js", ".css"}:
                    add_reference(source, raw, "css", True)
        elif source.suffix.lower() in JS_EXTS:
            refs = [(m.group(1), "module") for m in IMPORT_RE.finditer(text)]
            refs += [(m.group(1), "module") for m in NEW_URL_RE.finditer(text)]
            refs += [(m.group(1), "fetch") for m in FETCH_RE.finditer(text)]
            for raw, kind in refs:
                if raw.startswith("/api/"):
                    route = raw.split("?", 1)[0].rstrip("/")
                    mapped = root / "functions" / (route.lstrip("/") + ".js")
                    if mapped.is_file():
                        edges.add((rel[source], mapped.relative_to(root).as_posix(), raw))
                    continue
                if raw.startswith((".", "/")) and kind == "module":
                    add_reference(source, raw, "module", True)
                elif raw.startswith((".", "/")) and kind == "fetch" and Path(urlsplit(raw).path).suffix.lower() in JS_EXTS | {".css"}:
                    add_reference(source, raw, "module", True)

            # Service workers are loaded by register(), not import(). Recognize both a
            # literal URL and a locally declared string constant, including cache queries.
            string_constants = {
                match.group(1): match.group(3)
                for match in STRING_CONST_RE.finditer(text)
            }
            for match in SERVICE_WORKER_REGISTER_RE.finditer(text):
                raw = match.group(2) if match.group(1) else string_constants.get(match.group(3))
                if not raw:
                    continue
                target = resolve_module(root, source, raw)
                if target is not None and target.is_file() and target in rel:
                    edges.add((rel[source], rel[target], raw))

    adjacency = defaultdict(set)
    for source, target, _ in edges:
        adjacency[source].add(target)
    reachable = set()
    stack = list(html_entries | function_entries)
    while stack:
        current = stack.pop()
        if current in reachable:
            continue
        reachable.add(current)
        for target in adjacency.get(rel.get(current, ""), ()):
            candidate = root / target
            if candidate not in reachable:
                stack.append(candidate)

    js_paths = {p for p in files if p.suffix.lower() in JS_EXTS}
    orphaned = sorted(rel[p] for p in js_paths if p not in reachable)
    scan_text = "\n".join(contents[p] for p in files if p.suffix.lower() in JS_EXTS | {".html"})
    declarations = []
    declaration_counts = Counter()
    for source in files:
        if source.suffix.lower() not in JS_EXTS:
            continue
        for line_no, line in enumerate(contents[source].splitlines(), 1):
            match = DECL_RE.match(line)
            if match:
                name = match.group(1) or match.group(2)
                if name:
                    declarations.append({"name": name, "file": rel[source], "line": line_no})
                    declaration_counts[name] += 1
    identifier_counts = Counter(
        re.findall(r"(?<![\w$])([A-Za-z_$][\w$]*)(?![\w$])", scan_text)
    )
    dead_symbols = []
    for item in declarations:
        name = item["name"]
        file_name = item["file"]
        # Handler names are deployment contracts for filesystem-routed endpoints,
        # not ordinary local calls. Avoid reporting them as dead declarations.
        is_platform_route = (
            file_name.startswith("api/") or
            (file_name.startswith("functions/") and not file_name.startswith("functions/_shared/"))
        )
        if is_platform_route and name in {"handler", "onRequest", "onRequestGet"}:
            continue
        if identifier_counts[name] <= declaration_counts[name]:
            dead_symbols.append(item)

    return {
        "files_scanned": len(files), "js_files_scanned": len(js_paths),
        "edges": [{"source": s, "target": t, "reference": r} for s, t, r in sorted(edges)],
        "issues": issues, "orphaned_js": orphaned, "dead_symbols": dead_symbols,
        "entry_points": sorted(rel[p] for p in html_entries | function_entries if p in rel)
    }

def markdown_report(result: dict) -> str:
    lines = [
        "# Dependency and dead-code candidate audit", "",
        "> Unused-code findings are heuristic candidates for manual review; nothing is deleted automatically.", "",
        f"- Source files scanned: **{result['files_scanned']}**",
        f"- JavaScript files scanned: **{result['js_files_scanned']}**",
        f"- Dependency edges mapped: **{len(result['edges'])}**",
        f"- Broken local references: **{len(result['issues'])}**",
        f"- Unreachable JavaScript candidates: **{len(result['orphaned_js'])}**",
        f"- Potential unused declarations: **{len(result['dead_symbols'])}**", "",
        "## Entry points", ""
    ]
    lines.extend(f"- {name}" for name in result["entry_points"])
    lines.extend(["", "## Dependency map", "", "| Source | Depends on | Reference |", "|---|---|---|"])
    lines.extend(f"| {item['source']} | {item['target']} | {item['reference']} |" for item in result["edges"])
    lines.extend(["", "## Broken local references", ""])
    lines.extend([f"- {i['source']} → {i['reference']}: {i['message']}" for i in result["issues"]] or ["None found."])
    lines.extend(["", "## Unreachable JavaScript candidates", ""])
    lines.extend([f"- {name}" for name in result["orphaned_js"]] or ["None found."])
    lines.extend(["", "## Potentially unused declarations", ""])
    lines.extend([f"- {i['file']}:{i['line']} — {i['name']}" for i in result["dead_symbols"]] or ["None found."])
    lines.extend(["", "## Interpretation", "",
        "Only unresolved explicit local JS/CSS dependencies fail CI. Dynamic loading, reflection, and inline runtime conventions can make a file or symbol appear unused; review candidates before moving or deleting code.", ""])
    return "\n".join(lines)

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--output", type=Path)
    parser.add_argument("--summary", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = audit(args.root)
    report = markdown_report(result)
    if args.output:
        args.output.write_text(report, encoding="utf-8")
    if args.summary:
        args.summary.parent.mkdir(parents=True, exist_ok=True)
        with args.summary.open("a", encoding="utf-8") as stream:
            stream.write("\n".join([
                "## Dependency and dead-code audit", "",
                f"- Files scanned: {result['files_scanned']}",
                f"- Dependency edges mapped: {len(result['edges'])}",
                f"- Broken local references: {len(result['issues'])}",
                f"- Unreachable JavaScript candidates: {len(result['orphaned_js'])}",
                f"- Potential unused declarations: {len(result['dead_symbols'])}", "",
                "The full graph and review candidates are attached as the dependency-audit workflow artifact.", ""
            ]))
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(f"Dependency audit: {result['files_scanned']} files, {len(result['edges'])} edges, "
              f"{len(result['issues'])} broken references; {len(result['orphaned_js'])} unreachable JS "
              f"file(s), {len(result['dead_symbols'])} possible unused declaration(s).")
        if result["orphaned_js"]:
            print("Unreachable JS candidates: " + ", ".join(result["orphaned_js"]))
        if result["dead_symbols"]:
            first = result["dead_symbols"][:30]
            print("Potential dead-code candidates (first 30): " + ", ".join(
                f"{i['name']} ({i['file']}:{i['line']})" for i in first))
        for issue in result["issues"]:
            print(f"ERROR: {issue['source']} -> {issue['reference']}: {issue['message']}")
    return 1 if result["issues"] else 0

if __name__ == "__main__":
    raise SystemExit(main())
