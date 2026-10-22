#!/usr/bin/env python3
"""check_docs.py - deterministic consistency checks for the ten pre-coding docs.

Usage:
  python scripts/check_docs.py [--docs docs] [--agents AGENTS.md]
                               [--draft] [--require-approved] [--json]

Exit code 0 = no errors, 1 = errors found. Warnings never fail the run.
Only the Python standard library is used.

What it checks (all deterministic, nothing is judged by an LLM):
  - all nine docs plus AGENTS.md exist; front matter present and valid
  - no leftover <<FILL: ...>> markers (a warning with --draft)
  - markdown tables are well formed (header and separator column counts match)
  - ID coverage: every feature has acceptance criteria; every AC, NFR and threat
    appears in TESTING.md; every feature appears in the plan
  - no reference to an undefined F-, AC-, NFR-, TH-, J- or R- ID
  - plan task lines: checkbox, verify:, dep:, valid and acyclic dependencies
  - commands listed in AGENTS.md also appear in another doc
  - relative markdown links resolve; unknown NAME.md references are flagged
"""
import argparse
import json
import re
import sys
from pathlib import Path

DOC_NAMES = ["PRD", "ARCHITECTURE", "SECURITY", "DATABASE", "DESIGN_SYSTEM",
             "CODE_STYLE", "TESTING", "IMPLEMENTATION_PLAN", "SETUP_GUIDE"]
KNOWN_MD = set(DOC_NAMES) | {"AGENTS", "CLAUDE", "README", "CHANGELOG", "LICENSE",
                             "CONTRIBUTING", "SKILL", "GEMINI"}

F_ID = r"F-\d+"
AC_ID = r"AC-F\d+-\d+"
NFR_ID = r"NFR-\d+"
TH_ID = r"TH-\d+"
J_ID = r"J-\d+"
R_ID = r"R-[a-z][a-z0-9-]*"
TASK_LINE = re.compile(r"^\s*- \[[ xX]\] \*\*(T\d+\.\d+[a-z]?)\*\*(.*)$")


class Report:
    def __init__(self):
        self.items = []  # (level, file, line, message)

    def add(self, level, file, line, msg):
        self.items.append((level, file, line, msg))

    def count(self, level):
        return sum(1 for i in self.items if i[0] == level)


def read(path):
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


def split_fences(text):
    """Return (lines, in_fence flags) so checks can skip fenced code."""
    lines, flags, fence = text.split("\n"), [], False
    for ln in lines:
        if ln.strip().startswith("```") or ln.strip().startswith("~~~"):
            flags.append(True)
            fence = not fence
        else:
            flags.append(fence)
    return lines, flags


def cells(row):
    return [c for c in re.split(r"(?<!\\)\|", row.strip().strip("|"))]


def check_tables(rep, name, text):
    lines, fenced = split_fences(text)
    i = 0
    while i < len(lines) - 1:
        a, b = lines[i], lines[i + 1]
        if (not fenced[i] and a.lstrip().startswith("|")
                and re.match(r"^\s*\|[\s:|-]+\|\s*$", b) and not fenced[i + 1]):
            want, sep = len(cells(a)), len(cells(b))
            if want != sep:
                rep.add("error", name, i + 1,
                        f"table header has {want} columns but separator has {sep}")
            j = i + 2
            while j < len(lines) and lines[j].lstrip().startswith("|") and not fenced[j]:
                n = len(cells(lines[j]))
                if n != want:
                    rep.add("warning", name, j + 1,
                            f"table row has {n} cells, header has {want}")
                j += 1
            i = j
        else:
            i += 1


def front_matter(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return None
    out = {}
    for ln in m.group(1).split("\n"):
        if ":" in ln:
            k, v = ln.split(":", 1)
            out[k.strip()] = v.split("#")[0].strip()
    return out


def first_cell_ids(text, pattern):
    """IDs that are defined as the first cell of a table row."""
    found = set()
    for ln in text.split("\n"):
        m = re.match(r"^\|\s*(" + pattern + r")\s*\|", ln)
        if m:
            found.add(m.group(1))
    return found


def all_ids(text, pattern):
    return set(re.findall(r"\b(" + pattern + r")\b", text))


def check_plan(rep, name, text):
    tasks, deps = {}, {}
    gates = 0
    for n, ln in enumerate(text.split("\n"), 1):
        if "**GATE-" in ln:
            gates += 1
        m = TASK_LINE.match(ln)
        if not m:
            continue
        tid, rest = m.group(1), m.group(2)
        tasks[tid] = n
        if not re.search(r"verify:\s*\S", rest, re.I):
            rep.add("error", name, n, f"{tid} has no 'verify:' command")
        d = re.search(r"dep:\s*([^·\n]*)", rest, re.I)
        if not d:
            rep.add("error", name, n, f"{tid} has no 'dep:' field (use 'dep: -')")
            deps[tid] = []
        else:
            deps[tid] = re.findall(r"T\d+\.\d+[a-z]?", d.group(1))
        if not re.search(r"files:\s*\S", rest, re.I):
            rep.add("warning", name, n, f"{tid} has no 'files:' scope")
        if not re.search(r"\b(F-\d+|NFR-\d+|TH-\d+|AC-F\d+-\d+)\b", rest) \
                and not re.search(r"\[(OPS|OWNER|QA)\]", rest):
            rep.add("warning", name, n, f"{tid} cites no F-, AC-, NFR- or TH- ID")
    if not tasks:
        rep.add("error", name, 0, "no task lines found (expected '- [ ] **T1.01** ...')")
    if gates == 0:
        rep.add("warning", name, 0, "no **GATE-n** lines found")
    for tid, ds in deps.items():
        for d in ds:
            if d not in tasks:
                rep.add("error", name, tasks[tid], f"{tid} depends on unknown task {d}")
    # cycle detection
    state = {}

    def visit(t, path):
        if state.get(t) == 1:
            rep.add("error", name, tasks.get(t, 0), "dependency cycle: " + " -> ".join(path + [t]))
            return
        if state.get(t) == 2 or t not in deps:
            return
        state[t] = 1
        for d in deps[t]:
            visit(d, path + [t])
        state[t] = 2

    for t in deps:
        visit(t, [])
    done = sum(1 for ln in text.split("\n") if re.match(r"^\s*- \[[xX]\] \*\*T", ln))
    return len(tasks), done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs", default="docs")
    ap.add_argument("--agents", default="AGENTS.md")
    ap.add_argument("--draft", action="store_true", help="leftover FILL markers are warnings")
    ap.add_argument("--require-approved", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    rep = Report()
    docs_dir = Path(args.docs)
    texts, paths = {}, {}
    for n in DOC_NAMES:
        p = docs_dir / f"{n}.md"
        paths[n] = p
        if p.exists():
            texts[n] = read(p)
        else:
            rep.add("error", str(p), 0, "file is missing")
    ap_path = Path(args.agents)
    paths["AGENTS"] = ap_path
    if ap_path.exists():
        texts["AGENTS"] = read(ap_path)
    else:
        rep.add("error", str(ap_path), 0, "file is missing")

    # per-file generic checks
    for n, t in texts.items():
        label = str(paths[n])
        if n != "AGENTS":
            fm = front_matter(t)
            if not fm:
                rep.add("error", label, 1, "missing front matter (doc, version, status)")
            else:
                if fm.get("doc") != n:
                    rep.add("error", label, 1, f"front matter doc is '{fm.get('doc')}', expected '{n}'")
                if fm.get("status") not in ("Draft", "Approved"):
                    rep.add("error", label, 1, "status must be Draft or Approved")
                elif args.require_approved and fm.get("status") != "Approved":
                    rep.add("error", label, 1, "status is not Approved")
        for ln_no, ln in enumerate(t.split("\n"), 1):
            if "<<FILL" in ln:
                rep.add("warning" if args.draft else "error", label, ln_no, "unfilled <<FILL>> marker")
            elif re.search(r"\b(TBD|TODO|FIXME|lorem ipsum)\b", ln, re.I):
                rep.add("warning", label, ln_no, "TBD/TODO text left in document")
        check_tables(rep, label, t)
        for m in re.finditer(r"\]\(([^)#\s]+)(?:#[^)]*)?\)", t):
            target = m.group(1)
            if re.match(r"^[a-z]+://", target) or target.startswith("mailto:"):
                continue
            if not (paths[n].parent / target).exists():
                rep.add("error", label, 0, f"broken relative link: {target}")
        for m in re.finditer(r"\b([A-Z][A-Z_]{2,})\.md\b", t):
            if m.group(1) not in KNOWN_MD:
                rep.add("warning", label, 0, f"reference to unknown document {m.group(0)}")

    prd = texts.get("PRD", "")
    sec = texts.get("SECURITY", "")
    test = texts.get("TESTING", "")
    plan = texts.get("IMPLEMENTATION_PLAN", "")
    agents = texts.get("AGENTS", "")
    everything = "\n".join(texts.values())

    # ID definitions
    feats = first_cell_ids(prd, F_ID)
    acs = first_cell_ids(prd, AC_ID)
    nfrs = first_cell_ids(prd, NFR_ID)
    journeys = first_cell_ids(prd, J_ID)
    roles = first_cell_ids(prd, R_ID)
    threats = first_cell_ids(sec, TH_ID)

    if prd:
        if not feats:
            rep.add("error", str(paths["PRD"]), 0, "no features defined (table rows starting 'F-01')")
        for f in sorted(feats):
            mine = [a for a in acs if a.startswith("AC-" + f.replace("-", "") + "-")]
            if not mine:
                rep.add("error", str(paths["PRD"]), 0, f"{f} has no acceptance criteria")
                continue
            kinds = " ".join(ln.lower() for ln in prd.split("\n")
                             if any(ln.lstrip().startswith("| " + a) for a in mine))
            if "happy" not in kinds:
                rep.add("warning", str(paths["PRD"]), 0, f"{f} has no 'happy' acceptance criterion")
            if "invalid" not in kinds:
                rep.add("warning", str(paths["PRD"]), 0, f"{f} has no 'invalid' acceptance criterion")
        if acs and not any("unauthorized" in ln.lower() for ln in prd.split("\n")
                           if re.match(r"^\|\s*" + AC_ID, ln)):
            rep.add("warning", str(paths["PRD"]), 0, "no 'unauthorized' acceptance criterion anywhere")

    # coverage in TESTING and plan
    if test:
        for a in sorted(acs):
            if a not in test:
                rep.add("error", str(paths["TESTING"]), 0, f"{a} is not in the acceptance test matrix")
        for x in sorted(nfrs | threats):
            if x not in test:
                rep.add("error", str(paths["TESTING"]), 0, f"{x} has no test row")
    if plan:
        for f in sorted(feats):
            if f not in plan:
                rep.add("error", str(paths["IMPLEMENTATION_PLAN"]), 0, f"{f} is not covered by any task")
        for a in sorted(acs):
            if a not in plan and not re.search(re.escape(a.rsplit("-", 1)[0]) + r"-[\d,]*" + a.rsplit("-", 1)[1], plan):
                rep.add("warning", str(paths["IMPLEMENTATION_PLAN"]), 0, f"{a} is not cited by any task")

    # references to undefined IDs
    for pat, defined, label in ((F_ID, feats, "feature"), (AC_ID, acs, "acceptance criterion"),
                                (NFR_ID, nfrs, "NFR"), (J_ID, journeys, "journey"),
                                (R_ID, roles, "role")):
        if not defined and not prd:
            continue
        for n, t in texts.items():
            for ref in sorted(all_ids(t, pat) - defined):
                if "<<FILL" in ref:
                    continue
                rep.add("error", str(paths[n]), 0, f"{ref} is referenced but no {label} with that ID is defined in the PRD")
    if sec:
        for n, t in texts.items():
            for ref in sorted(all_ids(t, TH_ID) - threats):
                rep.add("error", str(paths[n]), 0, f"{ref} is referenced but not defined in SECURITY.md")

    # plan structure
    total = done = 0
    if plan:
        total, done = check_plan(rep, str(paths["IMPLEMENTATION_PLAN"]), plan)

    # AGENTS.md
    if agents:
        n_lines = agents.count("\n") + 1
        if n_lines > 200:
            rep.add("warning", str(ap_path), 0, f"AGENTS.md is {n_lines} lines; keep it under 200 to save context")
        for n in DOC_NAMES:
            if n not in agents:
                rep.add("error", str(ap_path), 0, f"AGENTS.md does not reference {n}")
        m = re.search(r"## 2\. Verified commands\n(.*?)\n## ", agents, re.S)
        if m:
            others = "\n".join(t for k, t in texts.items() if k != "AGENTS")
            for cmd in re.findall(r"`([^`]+)`", m.group(1)):
                if cmd not in others and "<<FILL" not in cmd:
                    rep.add("warning", str(ap_path), 0, f"command `{cmd}` is not documented in any other doc")

    score = max(0, 100 - 10 * rep.count("error") - 2 * rep.count("warning"))
    if args.json:
        print(json.dumps({"errors": rep.count("error"), "warnings": rep.count("warning"),
                          "readiness_score": score, "tasks": total, "tasks_done": done,
                          "items": [dict(zip(("level", "file", "line", "message"), i)) for i in rep.items]},
                         indent=2))
    else:
        for level, file, line, msg in sorted(rep.items, key=lambda i: (i[1], i[2])):
            loc = f"{file}:{line}" if line else file
            print(f"{level.upper():7} {loc}  {msg}")
        print(f"\n{rep.count('error')} error(s), {rep.count('warning')} warning(s). "
              f"Doc readiness score: {score}/100. Plan tasks: {done}/{total} done.")
    sys.exit(1 if rep.count("error") else 0)


if __name__ == "__main__":
    main()
