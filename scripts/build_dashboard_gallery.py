#!/usr/bin/env python3
"""Package rebuildable dashboard examples; optionally compare builds with the gallery."""
import argparse
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
GALLERY = ROOT / "docs/features/showcase/portable-artifacts"
FIXTURES = ROOT / "plugins/portable-artifacts/eval/fixtures"
SKILL = ROOT / "plugins/portable-artifacts/skills/make-dashboard"
EXAMPLES = {
    "growth-overview": ("growth-dashboard.json", "growth-dashboard.html"),
    **{slug: (f"gallery/{slug}/dashboard.json", f"gallery/{slug}/index.html")
       for slug in ("support-ops", "traffic-deep-dive", "product-performance")},
}
DATA_FILES = {"data/sales.csv", "data/web_traffic.csv", "data/tickets.csv"}


def readme(slug):
    return f"""# make-dashboard: {slug}

The published gallery spec and its original sample CSV data, with their folder
structure intact. These are fictional example numbers, not business measurements.
The files use the repository's MIT license (LICENSE).

Install make-dashboard in your coding agent:

    npx skills add abhijitbansal/claude-skills --skill make-dashboard

Extract this ZIP, open the extracted folder in your agent and ask:

    Use make-dashboard to build dashboard.json with the included CSV files.
    Then change the dashboard to explore the data in a different way.

Or run these commands from the extracted folder. Replace <skill-dir> with the
installed make-dashboard directory (containing SKILL.md and scripts/):

    node "<skill-dir>/scripts/doctor.mjs"
    node "<skill-dir>/scripts/build.mjs" dashboard.json --out dashboard

The doctor reports missing dependencies and their install commands. After the
one-time dependency setup, building needs no network. Open dashboard/index.html
in a browser; the resulting dashboard also works offline. Edit the CSVs to use
your own data, keeping the column names the queries use.

Gallery: https://abhijitbansal.github.io/claude-skills/features/portable-artifacts.html#gallery
"""


def pack_example(slug, out, *, fixtures=FIXTURES):
    spec = (GALLERY / EXAMPLES[slug][0]).read_bytes()
    files = {"dashboard.json": spec, "README.md": readme(slug).encode(),
             "LICENSE": (ROOT / "LICENSE").read_bytes()}
    for source in json.loads(spec)["sources"].values():
        ref = source.get("path")
        if source.get("type") != "csv" or ref not in DATA_FILES:
            raise ValueError(f"{slug}: no gallery fixture for {source}")
        files[ref] = (fixtures / ref).read_bytes()
    target = out / slug / "source.zip"
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    return target


class DashboardData(HTMLParser):
    """Read embedded query results and visible KPI values, without executing JS."""

    def __init__(self):
        super().__init__()
        self.in_data = False
        self.data = ""
        self.kpi = None
        self.kpis = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("id") == "dash-data":
            self.in_data = True
        if tag == "div" and "kpi-value" in attrs.get("class", "").split():
            self.kpi = ""

    def handle_data(self, text):
        if self.in_data:
            self.data += text
        if self.kpi is not None:
            self.kpi += text

    def handle_endtag(self, tag):
        if tag == "script":
            self.in_data = False
        if tag == "div" and self.kpi is not None:
            self.kpis.append(self.kpi)
            self.kpi = None


def dashboard_data(file):
    parser = DashboardData()
    parser.feed(file.read_text())
    if not parser.data:
        raise ValueError(f"{file}: missing dash-data")
    queries = json.loads(parser.data)["queries"]
    return {"kpis": parser.kpis, "queries": {
        name: {key: value for key, value in result.items() if key != "refreshedAt"}
        for name, result in queries.items()
    }}


def validate_pack(slug, archive):
    # Build the visitor's extracted download outside the checkout, through the real CLI.
    with tempfile.TemporaryDirectory(prefix="dashboard-gallery-") as temp:
        directory = Path(temp)
        with zipfile.ZipFile(archive) as source:
            source.extractall(directory)
        result = subprocess.run(["node", str(SKILL / "scripts/build.mjs"),
                                 str(directory / "dashboard.json"), "--out",
                                 str(directory / "dashboard"), "--json"],
                                text=True, capture_output=True)
        if result.returncode:
            raise ValueError(f"{slug}: build failed\n{result.stdout}{result.stderr}")
        actual = dashboard_data(directory / "dashboard/index.html")
        expected = dashboard_data(GALLERY / EXAMPLES[slug][1])
        if actual != expected:
            raise ValueError(f"{slug}: rebuilt query results or KPIs differ from the published dashboard")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path, help="staged gallery directory")
    parser.add_argument("--validate", action="store_true",
                        help="build extracted packs and compare gallery data (requires make-dashboard npm ci)")
    args = parser.parse_args()
    for slug in EXAMPLES:
        archive = pack_example(slug, args.out)
        if args.validate:
            validate_pack(slug, archive)
        print(f"{slug}: {archive.stat().st_size} bytes" + ("; build matches gallery" if args.validate else ""))


if __name__ == "__main__":
    main()
