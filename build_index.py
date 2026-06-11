#!/usr/bin/env python3
"""Scan all guide .html files in the repo root and write guides.json for index.html."""
import glob, html, json, re, subprocess

guides = []
for f in sorted(glob.glob("*.html")):
    if f == "index.html":
        continue
    try:
        head = open(f, encoding="utf-8", errors="ignore").read(200_000)
    except OSError:
        continue
    # "Unlisted" guides stay live at their URL but are kept off the homepage.
    if re.search(r'<meta name="stepsnap-unlisted" content="1"', head):
        continue
    t = re.search(r"<title>(.*?)</title>", head, re.S)
    d = re.search(r'<meta name="description" content="(.*?)"', head)
    n = re.search(r'<meta name="stepsnap-steps" content="(\d+)"', head)
    # Optional cover thumbnail (a small embedded data: URL) for the tile grid.
    thumb = re.search(r'<meta name="stepsnap-thumb" content="(data:[^"]*)"', head)
    # Optional author ("Made by") for multi-contributor setups.
    author = re.search(r'<meta name="stepsnap-author" content="(.*?)"', head)
    date = subprocess.run(
        ["git", "log", "-1", "--format=%cI", "--", f],
        capture_output=True, text=True
    ).stdout.strip()
    title = html.unescape(t.group(1).strip()) if t else f[:-5].replace("-", " ").replace("_", " ").title()

    # Extract readable step text for full-text search:
    # drop styles/scripts and base64 images, then strip tags.
    body = re.sub(r"<(style|script)[\s\S]*?</\1>", " ", head, flags=re.I)
    body = re.sub(r'src="data:[^"]*"', " ", body)
    body = re.sub(r"<[^>]+>", " ", body)
    body = html.unescape(re.sub(r"\s+", " ", body)).strip()
    if body.lower().startswith(title.lower()):
        body = body[len(title):].strip()

    guides.append({
        "file": f,
        "title": title,
        "desc": html.unescape(d.group(1)) if d else "",
        "steps": int(n.group(1)) if n else None,
        "updated": date or None,
        "thumb": thumb.group(1) if thumb else None,
        "author": html.unescape(author.group(1)) if author else None,
        "text": body[:6000],
    })

guides.sort(key=lambda g: g["updated"] or "", reverse=True)
with open("guides.json", "w", encoding="utf-8") as out:
    json.dump(guides, out, indent=1, ensure_ascii=False)
print(f"Indexed {len(guides)} guide(s).")
