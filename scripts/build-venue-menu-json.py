#!/usr/bin/env python3
"""
Build data/*-menu.json VenueMenu payloads from PDF text extracts.

Usage:
  /tmp/pymupdf-venv/bin/python scripts/build-venue-menu-json.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

try:
    import pymupdf as fitz
except ImportError:
    import fitz  # type: ignore

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
MENUS = ROOT / "public" / "menus"
EXTRACT_DIR = Path("/tmp/menu-extracts")

PAGE_RE = re.compile(r"^===== PAGE \d+ =====$")
FOOTER_RE = re.compile(
    r"(sales tax|admin fee|table minimum|gratuity|nevada state|"
    r"please inform|consuming raw|artist restrictions|subject to availability|"
    r"^\d{2}\.\d{2}\.\d{2}$|^\d{2}/\d{2}/\d{2}$|"
    r"failure to meet|contracted table|ask your server|"
    r"v-vegetarian|gf - gluten|pure, sugarfree|ginger beer and sparkling|"
    r"elevate\s*$|for other options|inform your server)",
    re.I,
)


def clean_line(s: str) -> str:
    s = s.replace("\xa0", " ").replace("\u200b", "")
    s = re.sub(r"[\u0001-\u0008\u000b\u000c\u000e-\u001f\uf000-\uf8ff]", "", s)
    return s.strip()


def parse_price_token(tok: str):
    tok = tok.replace(",", "").replace("$", "").strip()
    if re.fullmatch(r"\d+(\.\d+)?", tok):
        return float(tok) if "." in tok else int(tok)
    return None


def is_price_only(line: str) -> bool:
    return bool(re.fullmatch(r"\$?\d[\d,]*(?:\.\d+)?(?:\s*/\s*\$?\d[\d,]*(?:\.\d+)?)?", line.strip()))


def unspace_caps(s: str) -> str:
    parts = s.split()
    if len(parts) < 3:
        return s
    letterish = sum(1 for p in parts if re.fullmatch(r"[A-Za-zÀ-ÿ&']{1,2}", p))
    if letterish / len(parts) >= 0.7:
        return "".join(parts)
    return s


HEADER_MAP = {
    "BOTTLESERVICEPACKAGES": "Bottle Service Packages",
    "PREMIUMBEVERAGEPACKAGES": "Premium Beverage Packages",
    "PICKYOURPLEASUREPACKAGES": "Pick Your Pleasure Packages",
    "ARTISTMEET&GREET": "Artist Meet & Greet",
    "WINE&CHAMPAGNE": "Wine & Champagne",
    "TABLESIDESGROPPINOSERVICE": "Tableside Sgropino Service",
    "CHAMPAGNE-A-RITA": "Champagne-A-Rita",
    "PETALS&PEARLS": "Petals & Pearls",
    "WHERETHEWILDTHINGSARE": "Where The Wild Things Are",
    "LITERS": "Liters",
    "MAGNUMS": "Magnums",
    "JEROBOAMS(3L)": "Jeroboams (3L)",
    "MAGNUM-1.5L": "Magnum - 1.5L",
    "MAGNUM-1.5L": "Magnum - 1.5L",
    "JEROBOAM-3L": "Jeroboam - 3L",
    "METHUSELAH-6L": "Methuselah - 6L",
    "SALMANAZAR-9L": "Salmanazar - 9L",
    "BALTHAZAR-12L": "Balthazar - 12L",
    "NEBUCHADNEZZAR-15L": "Nebuchadnezzar - 15L",
    "ROSECHAMPAGNE": "Rosé Champagne",
    "ROSEWINE": "Rosé Wine",
    "CHAMPAGNE&SPARKLING": "Champagne & Sparkling",
    "BRANDY&COGNAC": "Brandy & Cognac",
    "SINGLEMALT&BLENDED": "Single Malt & Blended",
    "VODKAMAGNUMS": "Vodka Magnums",
    "READY-TO-DRINK": "Ready-To-Drink",
    "NON-ALCOHOLIC": "Non-Alcoholic",
    "PLUS-UP": "Plus-Up",
}


def normalize_header(line: str) -> str | None:
    raw = clean_line(line)
    joined = unspace_caps(raw)
    key = re.sub(r"[^A-Z0-9&()\-\.]", "", joined.upper().replace("É", "E").replace("È", "E"))
    if key in HEADER_MAP:
        return HEADER_MAP[key]
    simple = {
        "VODKA": "Vodka",
        "TEQUILA": "Tequila",
        "GIN": "Gin",
        "RUM": "Rum",
        "MEZCAL": "Mezcal",
        "SCOTCH": "Scotch",
        "WHISKEY": "Whiskey",
        "BEER": "Beer",
        "SELTZER": "Seltzer",
        "WINE": "Wine",
        "CHAMPAGNE": "Champagne",
        "ROSE": "Rosé",
        "ROSÉ": "Rosé",
        "CORDIALS": "Cordials",
        "LITERS": "Liters",
        "MAGNUMS": "Magnums",
    }
    up = raw.upper().strip()
    if up in simple:
        return simple[up]
    if key in simple:
        return simple[key]
    # size headers like MAGNUM - 1.5 L
    m = re.match(
        r"^(MAGNUM|JEROBOAM|METHUSELAH|SALMANAZAR|BALTHAZAR|NEBUCHADNEZZAR)\s*[-–]?\s*([\d\.]+)\s*L?$",
        up.replace(" ", ""),
        re.I,
    )
    if m:
        return f"{m.group(1).title()} - {m.group(2)}L"
    m2 = re.match(
        r"^(MAGNUM|JEROBOAM|METHUSELAH|SALMANAZAR|BALTHAZAR|NEBUCHADNEZZAR)\s*[-–]?\s*([\d\.]+)\s*L$",
        up,
        re.I,
    )
    if m2:
        return f"{m2.group(1).title()} - {m2.group(2)}L"
    return None


def make_item(name, description="", price=None, price_label="", sort_order=0):
    name = re.sub(r"\s+", " ", (name or "").strip(" \t*†"))
    name = re.sub(r"(VNF|NFS|NEFS|VGNFS|NFESD|ND|NES|NFES)+$", "", name).strip(" *†")
    return {
        "name": name,
        "description": (description or "").strip(),
        "price": price,
        "priceLabel": price_label or "",
        "sortOrder": sort_order,
        "available": True,
    }


def make_section(name, items, sort_order):
    return {
        "name": name,
        "sortOrder": sort_order,
        "items": [{**it, "sortOrder": i} for i, it in enumerate(items)],
    }


def is_footer(line: str) -> bool:
    if not line or PAGE_RE.match(line):
        return True
    if FOOTER_RE.search(line):
        return True
    if line.lower().startswith("an 8.375%"):
        return True
    return False


def extract_pdf_text(pdf_path: Path) -> str:
    doc = fitz.open(str(pdf_path))
    parts = []
    for i, page in enumerate(doc):
        parts.append(f"===== PAGE {i + 1} =====\n{page.get_text('text')}")
    return "\n".join(parts)


def split_name_price_inline(line: str):
    """Parse NAME.....price or NAME<spaces/tabs>price or NAME 750 / 1350."""
    line = clean_line(line)
    m = re.match(r"^(.+?)[\.\s\t]{2,}(\d[\d,]*(?:\.\d+)?)\s*$", line)
    if m:
        return m.group(1).strip(" .\t"), parse_price_token(m.group(2)), ""
    if "\t" in line:
        parts = [p.strip() for p in line.split("\t") if p.strip()]
        if len(parts) >= 2:
            price = parse_price_token(parts[-1])
            if price is not None:
                return " ".join(parts[:-1]), price, ""
    m = re.match(r"^(.+?)\s+(\d[\d,]*)\s*/\s*(\d[\d,]*)\s*$", line)
    if m:
        return m.group(1).strip(), parse_price_token(m.group(2)), f"{m.group(2)} / {m.group(3)}"
    m = re.match(r"^(.+?)\s+(\d{2,6})\s*$", line)
    if m:
        name, price = m.group(1).strip(), parse_price_token(m.group(2))
        # avoid treating "818 Blanco" style without huge trailing number wrongly —
        # require name not ending mid-number brand codes alone when price < 100? keep >= 9
        if price is not None and price >= 9 and not re.search(r"\d$", name[-1:]):
            # if name has no letters, skip
            if re.search(r"[A-Za-z]", name):
                return name, price, ""
    return line, None, ""


PACKAGE_START_RE = re.compile(
    r"^(ENERGY|GENESIS|FREQUENCY|SPACE|CROWD|BRONZE|COPPER|SILVER|GOLD|PLATINUM|"
    r"POP TRIO|THREE PILLARS|NIRVANA|DIAMOND|COLD AS ICE|HEADLINER|FLOWER POWER|"
    r"A CASE OF ACE|THE BEAUTIFUL ERA|TEN OUT OF TEN|I.?M WITH THE DJ|"
    r"DRIFT|BLOOM|SOL|AURORA|HORIZON|ARTIST MEET|"
    r"ELITE|PRESTIGE|ICON|PLUS-?UP)\b",
    re.I,
)


def parse_tao_style(text: str, title: str, pdf_url: str, notes: str, location_match: dict):
    """Parse Omnia / Marquee style bottle menus."""
    lines = []
    for raw in text.splitlines():
        line = clean_line(raw)
        if not line or is_footer(line):
            continue
        lines.append(line)

    sections = []
    cur = None
    items = []
    sort_sec = 0
    pending_name = None
    pending_desc: list[str] = []
    in_packages = False

    def flush_pending():
        nonlocal pending_name, pending_desc, items
        if not pending_name:
            return
        price = None
        label = ""
        desc = []
        for d in pending_desc:
            if is_footer(d):
                continue
            m = re.search(r"BRUT\s+(\d+).*ROS[EÉ]\s+(\d+)", d, re.I)
            if m and price is None:
                label = f"Brut ${m.group(1)} / Rosé ${m.group(2)}"
                price = int(m.group(1))
                continue
            if price is None and is_price_only(d):
                price = parse_price_token(d.split("/")[0])
                continue
            # upgrade noise
            if "UPGRADE ANY PACKAGE" in d.upper():
                continue
            desc.append(d)
        items.append(make_item(pending_name, "\n".join(desc), price, label, len(items)))
        pending_name, pending_desc = None, []

    def flush_section():
        nonlocal cur, items, sort_sec, in_packages
        flush_pending()
        if cur and items:
            sections.append(make_section(cur, items, sort_sec))
            sort_sec += 1
        cur, items = None, []

    def ensure_section(name: str):
        nonlocal cur, in_packages
        if cur != name:
            flush_section()
            cur = name
            in_packages = "package" in name.lower() or "pleasure" in name.lower()

    i = 0
    while i < len(lines):
        line = lines[i]
        up = line.upper().strip()

        # skip marketing fragments
        if up in {
            "ELEVATE",
            "YOUR",
            "NIGHT",
            "WITH A",
            "SPECIAL",
            "PRESENTATION!",
            "FOR OTHER OPTIONS.",
            "ASK YOUR SERVER",
        }:
            i += 1
            continue

        # spaced package title
        joined = unspace_caps(line)
        jkey = re.sub(r"[^A-Z0-9&]", "", joined.upper())
        pkg_alias = {
            "DRIFT": "Drift",
            "BLOOM": "Bloom",
            "SOL": "Sol",
            "AURORA": "Aurora",
            "HORIZON": "Horizon",
            "ARTISTMEET&GREET": "Artist Meet & Greet",
            "ELITE": "Elite",
            "PRESTIGE": "Prestige",
            "ICON": "Icon",
            "PLUSUP": "Plus-Up",
            "PLUS-UP": "Plus-Up",
        }.get(jkey)

        header = normalize_header(line)
        is_pkg = bool(PACKAGE_START_RE.match(up)) or pkg_alias is not None
        if "PACKAGE" in up and len(up) < 48:
            is_pkg = True
        if "MEET & GREET" in up and len(up) < 48:
            is_pkg = True

        if header and not is_pkg:
            ensure_section(header)
            i += 1
            continue

        if is_pkg:
            if cur is None or (
                "package" not in cur.lower()
                and "premium" not in cur.lower()
                and "bottle service" not in cur.lower()
                and "pleasure" not in cur.lower()
            ):
                ensure_section("Bottle Service Packages")
            flush_pending()
            name = pkg_alias or re.sub(r"\*+", "", line).strip()
            name = re.sub(r"\s+", " ", name)
            if name.isupper() and len(name) > 3:
                name = name.title()
            # Elite/Prestige/Icon often have inline description + price
            m = re.match(r"^(Elite|Prestige|Icon|Plus-Up)\s+(.+?)(?:\.{2,}|\s{2,})(\d+)\s*$", name, re.I)
            if not m:
                m = re.match(
                    r"^(ELITE|PRESTIGE|ICON|PLUS-?UP)\s*[-–]?\s*(.+?)(?:\.{2,}|\s{2,})(\d+)\s*$",
                    line,
                    re.I,
                )
            if m:
                ensure_section("Pick Your Pleasure Packages")
                flush_pending()
                items.append(
                    make_item(
                        m.group(1).title().replace("Plus-Up", "Plus-Up"),
                        m.group(2).strip(" -–."),
                        parse_price_token(m.group(3)),
                        "",
                        len(items),
                    )
                )
                i += 1
                continue
            pending_name = name
            pending_desc = []
            i += 1
            continue

        # pending package / item collecting description or waiting for price
        if pending_name is not None:
            # next package interrupts
            if PACKAGE_START_RE.match(up) or normalize_header(line):
                flush_pending()
                continue  # reprocess
            name2, price2, label2 = split_name_price_inline(line)
            # if this looks like a priced bottle line, close package first
            if price2 is not None and not in_packages:
                flush_pending()
                continue
            pending_desc.append(line)
            i += 1
            continue

        # priced line
        name, price, label = split_name_price_inline(line)
        if price is not None:
            if cur is None:
                ensure_section("Menu")
            items.append(make_item(name, "", price, label, len(items)))
            i += 1
            continue

        # name then price on next line
        if i + 1 < len(lines) and is_price_only(lines[i + 1]) and not normalize_header(line):
            if cur is None:
                ensure_section("Menu")
            price = parse_price_token(lines[i + 1].split("/")[0])
            label = ""
            if "/" in lines[i + 1]:
                parts = [p.strip() for p in lines[i + 1].replace("$", "").split("/")]
                label = " / ".join(parts)
                price = parse_price_token(parts[0])
            items.append(make_item(line, "", price, label, len(items)))
            i += 2
            continue

        # unpriced list item (pick-your-pleasure brand lists)
        if cur:
            items.append(make_item(line, "", None, "", len(items)))
        i += 1

    flush_section()
    return {
        "title": title,
        "status": "active",
        "currency": "USD",
        "sourcePdfUrl": pdf_url,
        "notes": notes,
        "locationMatch": location_match,
        "sections": sections,
    }


def parse_encore(text: str):
    lines = [clean_line(l) for l in text.splitlines()]
    lines = [l for l in lines if l and not PAGE_RE.match(l)]

    SECTION_HEADERS = {
        "VODKA",
        "RUM",
        "COGNAC",
        "GIN",
        "BOURBON/WHISKEY",
        "TEQUILA",
        "MEZCAL",
        "SCOTCH",
        "CORDIALS",
        "BUBBLES",
        "CHAMPAGNE",
        "MAGNUM (1.5L)",
        "ROSÉ",
        "JEROBOAM (3.0L)",
        "METHUSELAH (6.0L)",
        "SALMANAZAR (9.0L)",
        "BALTHAZAR (12.0L)",
        "NEBUCHADNEZZAR (15.0L)",
        "MELCHIZEDEK (30.0L)",
        "BEER AND OTHER",
        "CASES OF BEER",
        "CANNED COCKTAILS / CASE",
        "PREMIUM MIXERS",
        "TEQUILA IN THE SUN",
        "SPRITZ",
        "MOJITOS",
        "SHAKEN AT EBC",
        "ENTRÉES",
        "PARTY PLATTERS",
        "VIP GRILL MENU",
        "SNACKS & SALADS",
        "SIDES & SWEETS",
    }
    cocktailish = {
        "TEQUILA IN THE SUN",
        "SPRITZ",
        "MOJITOS",
        "SHAKEN AT EBC",
        "ENTRÉES",
        "PARTY PLATTERS",
        "VIP GRILL MENU",
        "SNACKS & SALADS",
        "SIDES & SWEETS",
    }

    sections = []
    cur = None
    items = []
    sort_sec = 0
    pending_name = None
    pending_desc: list[str] = []

    def flush_pending():
        nonlocal pending_name, pending_desc, items
        if pending_name:
            items.append(make_item(pending_name, "\n".join(pending_desc), None, "", len(items)))
            pending_name, pending_desc = None, []

    def flush_section():
        nonlocal cur, items, sort_sec
        flush_pending()
        if cur and items:
            sections.append(make_section(cur, items, sort_sec))
            sort_sec += 1
        cur, items = None, []

    i = 0
    while i < len(lines):
        line = lines[i]
        if line.upper() == "BOTTLE OFFERINGS":
            i += 1
            continue
        if is_footer(line) and line.upper() not in SECTION_HEADERS:
            i += 1
            continue

        if re.match(r"^BIG CUP/PITCHER", line, re.I):
            m = re.search(r"(\d+)\s*/\s*(\d+)", line)
            if m and cur in cocktailish:
                items.append(
                    make_item(
                        "Big Cup / Pitcher",
                        "",
                        int(m.group(1)),
                        f"Big Cup ${m.group(1)} / Pitcher ${m.group(2)}",
                        len(items),
                    )
                )
            i += 1
            continue

        if line.upper() in SECTION_HEADERS:
            flush_section()
            cur = line.upper() if line.upper() in SECTION_HEADERS else line
            # prefer canonical casing from set
            for s in SECTION_HEADERS:
                if s == line.upper() or s == line:
                    cur = s
                    break
            i += 1
            continue

        if cur is None:
            i += 1
            continue

        if pending_name and is_price_only(line):
            parts = [p.strip() for p in line.replace("$", "").split("/")]
            price = parse_price_token(parts[0])
            label = " / ".join(parts) if len(parts) > 1 else ""
            items.append(make_item(pending_name, "\n".join(pending_desc), price, label, len(items)))
            pending_name, pending_desc = None, []
            i += 1
            continue

        name, price, label = split_name_price_inline(line)
        if price is not None and name != line:
            flush_pending()
            items.append(make_item(name, "", price, label, len(items)))
            i += 1
            continue

        if cur in cocktailish:
            bare = re.sub(r"(VNF|NFS|NEFS|VGNFS|NFESD|ND|NES|NFES|\*)+$", "", line).strip()
            if bare.isupper() and len(bare) > 2 and not is_price_only(bare):
                flush_pending()
                pending_name = bare
                pending_desc = []
                i += 1
                continue
            if pending_name:
                pending_desc.append(line)
                i += 1
                continue

        flush_pending()
        pending_name = line
        pending_desc = []
        i += 1

    flush_section()
    # drop empty Bubbles if no items — already handled
    cleaned = []
    for s in sections:
        its = [it for it in s["items"] if it["name"] and not it["name"].startswith("V-Vegetarian")]
        if its:
            cleaned.append(make_section(s["name"], its, len(cleaned)))
    return {
        "title": "Encore Beach Club Menu",
        "status": "active",
        "currency": "USD",
        "sourcePdfUrl": "/menus/encore-beach-club-menu.pdf",
        "notes": "Nevada state sales tax, venue fee and gratuity are applicable to all sales. Source menu dated 02/10/26.",
        "locationMatch": {"nameRegex": "Encore Beach Club", "preferType": "day_club"},
        "sections": cleaned,
    }


def write_json(path: Path, data: dict):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    nsec = len(data["sections"])
    nitems = sum(len(s["items"]) for s in data["sections"])
    with_price = sum(1 for s in data["sections"] for it in s["items"] if it.get("price") is not None)
    print(f"{path.name}: sections={nsec} items={nitems} priced={with_price}")


def main():
    EXTRACT_DIR.mkdir(parents=True, exist_ok=True)
    pdfs = {
        "omnia-day": MENUS / "omnia-dayclub-menu.pdf",
        "omnia-night": MENUS / "omnia-nightclub-menu.pdf",
        "marquee-night": MENUS / "marquee-nightclub-menu.pdf",
        "encore-beach": MENUS / "encore-beach-club-menu.pdf",
    }
    texts = {}
    for key, pdf in pdfs.items():
        text = extract_pdf_text(pdf)
        (EXTRACT_DIR / f"{key}.txt").write_text(text)
        texts[key] = text

    encore = parse_encore(texts["encore-beach"])
    omnia_day = parse_tao_style(
        texts["omnia-day"],
        "OMNIA Dayclub Menu",
        "/menus/omnia-dayclub-menu.pdf",
        "An 8.375% sales tax and a 14% admin fee are automatically added to all table service. "
        "Failure to meet contracted table minimums will be assessed as a table fee. Source menu dated 26.07.15.",
        {"nameRegex": "Omnia Day|OMNIA Day", "preferType": "day_club"},
    )
    omnia_night = parse_tao_style(
        texts["omnia-night"],
        "OMNIA Nightclub Menu",
        "/menus/omnia-nightclub-menu.pdf",
        "An 8.375% sales tax and a 14% admin fee are automatically added to all table service. "
        "Failure to meet contracted table minimums will be assessed as a table fee. Source menu dated 26.07.09.",
        {"nameRegex": "Omnia Night|OMNIA Night|^OMNIA$|^Omnia$", "preferType": "night_club"},
    )
    marquee = parse_tao_style(
        texts["marquee-night"],
        "Marquee Nightclub Menu",
        "/menus/marquee-nightclub-menu.pdf",
        "An 8.375% sales tax and 14% admin fee are automatically added to all table service. Source menu dated 26.07.09.",
        {"nameRegex": "Marquee Nightclub", "preferType": "night_club"},
    )

    write_json(DATA / "encore-beach-club-menu.json", encore)
    write_json(DATA / "omnia-dayclub-menu.json", omnia_day)
    write_json(DATA / "omnia-nightclub-menu.json", omnia_night)
    write_json(DATA / "marquee-nightclub-menu.json", marquee)


if __name__ == "__main__":
    main()
