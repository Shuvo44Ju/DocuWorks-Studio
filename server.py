"""Local Excel -> JSON Gantt backend.
Run: python server.py [tracker.xlsx]
Then open http://localhost:8000
Export a standalone file: python server.py tracker.xlsx --export gantt.html
"""

import datetime as dt
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))


def to_date(value):
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    if isinstance(value, (int, float)) and 0 < value < 3000000:
        serial = int(value)
        if serial == 60:
            return None
        return dt.date(1899, 12, 30) + dt.timedelta(days=serial)
    if isinstance(value, str):
        text = re.sub(r"^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?[,\s]+", "", value.strip(), flags=re.I)
        m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", text)
        if m:
            a, b, y = map(int, m.groups())
            if y < 100:
                y += 2000 if y < 50 else 1900
            # D/M/Y for normal dates; M/D/Y when the original value has a weekday prefix.
            if a > 12:
                day, month = a, b
            elif b > 12:
                month, day = a, b
            else:
                day, month = a, b
            return dt.date(y, month, day)
        m = re.search(r"(\d{1,2})[\s,./-]+([A-Za-z]{3,})[\s,./-]+(\d{2,4})", text)
        if m:
            months = {x: i for i, x in enumerate(
                ["", "jan", "feb", "mar", "apr", "may", "jun",
                 "jul", "aug", "sep", "oct", "nov", "dec"])}
            day, mon, y = int(m.group(1)), m.group(2).lower()[:3], int(m.group(3))
            if y < 100:
                y += 2000 if y < 50 else 1900
            return dt.date(y, months.get(mon, 0), day) if mon in months else None
    return None


def duration(value):
    text = str(value or "").strip()
    if not text:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", text.replace(",", ""))
    if not match or re.search(r"\b(month|months|year|years|hour|hours|hr|hrs)\b", text, re.I):
        return None
    days = float(match.group())
    if re.search(r"\b(week|weeks|wk|wks)\b", text, re.I):
        days *= 7
    return max(0, int(days))


def load(path):
    wb = openpyxl.load_workbook(path, data_only=False)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=False))

    # The supplied Dhamrai layout uses B:H. The parser still falls back to header detection.
    header_row = 0
    headers = [str(c.value or "").strip() for c in rows[0]] if rows else []

    aliases = {
        "task": ["tasks", "task", "activity", "activity name", "description", "equipment", "item"],
        "vendor": ["vendor", "supplier", "contractor"],
        "duration": ["duration", "days", "period"],
        "start": ["start", "start date", "planned start", "commencement"],
        "finish": ["deadline", "finish", "finish date", "end date", "due date", "delivery date"],
        "status": ["status", "state"],
        "remaining": ["remaining days", "days remaining"],
    }

    def norm(v):
        return re.sub(r"[^a-z0-9]+", " ", str(v or "").lower()).strip()

    mapping = {}
    for key, names in aliases.items():
        best = (-1, 0)
        for i, h in enumerate(headers):
            hn = norm(h)
            for name in names:
                nn = norm(name)
                score = 100 if hn == nn else 75 if nn in hn else 0
                if score > best[1]:
                    best = (i, score)
        if best[1]:
            mapping[key] = best[0]

    if mapping.get("task") is None and len(headers) >= 2:
        mapping["task"] = 1
    if mapping.get("vendor") is None and len(headers) >= 3:
        mapping["vendor"] = 2
    if mapping.get("duration") is None and len(headers) >= 4:
        mapping["duration"] = 3
    if mapping.get("start") is None and len(headers) >= 5:
        mapping["start"] = 4
    if mapping.get("finish") is None and len(headers) >= 6:
        mapping["finish"] = 5
    if mapping.get("remaining") is None and len(headers) >= 7:
        mapping["remaining"] = 6
    if mapping.get("status") is None and len(headers) >= 8:
        mapping["status"] = 7

    tasks = []
    stack = []

    for r in range(header_row + 1, len(rows)):
        values = [cell.value for cell in rows[r]]
        raw_name = str(values[mapping["task"]] or "") if mapping.get("task") is not None else ""
        name = raw_name.strip()
        if not name:
            continue

        vendor = str(values[mapping["vendor"]] or "").strip() if mapping.get("vendor") is not None else ""
        start = to_date(values[mapping["start"]]) if mapping.get("start") is not None else None
        finish = to_date(values[mapping["finish"]]) if mapping.get("finish") is not None else None
        dur = duration(values[mapping["duration"]]) if mapping.get("duration") is not None else None
        status = str(values[mapping["status"]] or "").strip() if mapping.get("status") is not None else ""

        if not status and mapping.get("remaining") is not None:
            candidate = values[mapping["remaining"]]
            if isinstance(candidate, str) and candidate.strip() and not re.search(r"\d", candidate):
                status = candidate.strip()

        has_schedule = start or finish or dur is not None
        indent = len(raw_name) - len(raw_name.lstrip())

        if vendor and not has_schedule and not status:
            while stack and stack[-1]["indent"] >= indent:
                stack.pop()
            stack.append({"indent": indent, "name": name, "vendor": vendor})
            continue

        if not has_schedule and not status and not vendor and indent == 0:
            stack.clear()
            continue

        while stack and stack[-1]["indent"] >= indent:
            stack.pop()

        basis = "given"
        milestone = False

        if start and finish and finish < start:
            start = finish = None

        if start and not finish and dur:
            finish = start + dt.timedelta(days=max(1, dur) - 1)

        if finish and not start and dur:
            start = finish - dt.timedelta(days=max(1, dur) - 1)
            basis = "calculated"

        if finish and not start and not dur:
            start = finish
            dur = 1
            milestone = True
            basis = "milestone"

        if start and not finish and not dur:
            finish = start
            dur = 1
            milestone = True
            basis = "milestone"

        if start and finish and dur is None:
            dur = (finish - start).days + 1

        inherited_vendor = stack[-1]["vendor"] if stack else vendor
        group = " / ".join(x["name"] for x in stack)

        tasks.append({
            "row": r + 1,
            "name": name,
            "vendor": inherited_vendor,
            "group": group,
            "start": start.isoformat() if start else None,
            "end": finish.isoformat() if finish else None,
            "dur": dur,
            "done": status.lower() in {"done", "complete", "completed", "finished", "closed"},
            "active": "progress" in status.lower() or "in progress" in status.lower(),
            "status": status,
            "basis": basis,
            "milestone": milestone,
        })

    title = os.path.splitext(os.path.basename(path))[0]
    return {"title": title, "tasks": tasks}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/tasks"):
            body = json.dumps(payload(XLSX)).encode()
            content_type = "application/json; charset=utf-8"
        else:
            with open(os.path.join(HERE, "projectflow.html"), "rb") as f:
                body = f.read()
            content_type = "text/html; charset=utf-8"

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def payload(path):
    return load(path)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    XLSX = args[0] if args else os.path.join(HERE, "tracker.xlsx")

    if "--export" in sys.argv:
        out = sys.argv[sys.argv.index("--export") + 1]
        html_path = os.path.join(HERE, "projectflow.html")
        with open(html_path, encoding="utf-8") as f:
            html = f.read()
        embedded = json.dumps(payload(XLSX))
        html = html.replace("/*DATA*/null", embedded)
        with open(out, "w", encoding="utf-8") as f:
            f.write(html)
        print("wrote", out)
    else:
        print("http://localhost:8000")
        HTTPServer(("", 8000), Handler).serve_forever()
