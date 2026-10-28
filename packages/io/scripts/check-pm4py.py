"""Checks an event log exported by the tool with pm4py (acceptance A8).

Called by check-pm4py.ts; run it by hand with

    python check-pm4py.py --csv log.csv --xes log.xes --expected-json activities.json --out result.json

It reads the CSV with pandas and the XES file with pm4py, checks the columns, the time stamps and
the number of cases, discovers a Petri net with the inductive miner from the rows with the
lifecycle `complete`, and compares the activities of that net with the expected ones (the names
of the transitions that carry cases). The result goes to --out as JSON; the exit status is 0 if
every check passed and 1 otherwise. Exit status 3 means that pm4py cannot be imported.
"""

import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True)
    parser.add_argument("--xes", required=True)
    parser.add_argument("--expected-json", required=True, help="JSON list of activity names")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    try:
        import pandas as pd
        import pm4py
    except ImportError as error:  # pragma: no cover - reported to the caller
        print(f"pm4py and pandas are required: {error}", file=sys.stderr)
        return 3

    with open(args.expected_json, encoding="utf-8") as handle:
        expected = sorted(json.load(handle))

    checks = []

    def check(name: str, passed: bool, detail: str) -> None:
        checks.append({"name": name, "passed": bool(passed), "detail": detail})

    # CSV with pandas.
    frame = pd.read_csv(args.csv)
    columns = list(frame.columns)
    check(
        "CSV columns",
        columns == ["case_id", "activity", "timestamp", "lifecycle"],
        ", ".join(columns),
    )
    stamps = pd.to_datetime(frame["timestamp"], utc=True, errors="coerce", format="ISO8601")
    check(
        "Time stamps are ISO 8601 (UTC)",
        bool(stamps.notna().all()),
        f"{int(stamps.notna().sum())} of {len(frame)} rows parse",
    )
    check(
        "Lifecycle is start or complete",
        set(frame["lifecycle"].unique()) <= {"start", "complete"},
        ", ".join(sorted(map(str, frame["lifecycle"].unique()))),
    )
    csv_cases = int(frame["case_id"].nunique())
    check("CSV has cases", csv_cases > 0, f"{csv_cases} cases, {len(frame)} rows")

    # Discovery on the completed activities.
    done = frame[frame["lifecycle"] == "complete"].copy()
    done = pm4py.format_dataframe(
        done, case_id="case_id", activity_key="activity", timestamp_key="timestamp"
    )
    net, initial, final = pm4py.discover_petri_net_inductive(done)
    labelled = sorted({t.label for t in net.transitions if t.label is not None})
    check(
        "Discovered net has the activities of the transitions that carry cases",
        labelled == expected,
        f"{len(labelled)} of {len(expected)} activities",
    )
    missing = sorted(set(expected) - set(labelled))
    extra = sorted(set(labelled) - set(expected))
    if missing or extra:
        check("No activity missing or added", False, f"missing: {missing}; extra: {extra}")

    # XES with pm4py.
    log = pm4py.read_xes(args.xes)
    xes_frame = pm4py.convert_to_dataframe(log)
    xes_cases = int(xes_frame["case:concept:name"].nunique())
    check(
        "XES loads with the same number of cases",
        xes_cases == csv_cases,
        f"{xes_cases} cases in XES, {csv_cases} in CSV",
    )
    check(
        "XES has the same number of events",
        len(xes_frame) == len(frame),
        f"{len(xes_frame)} events in XES, {len(frame)} rows in CSV",
    )
    check(
        "XES activities equal the CSV activities",
        sorted(xes_frame["concept:name"].unique()) == sorted(frame["activity"].unique()),
        f"{xes_frame['concept:name'].nunique()} activities",
    )

    result = {
        "pm4py": pm4py.__version__,
        "pandas": pd.__version__,
        "rows": int(len(frame)),
        "cases": csv_cases,
        "completeRows": int(len(done)),
        "activities": labelled,
        "expected": expected,
        "places": len(net.places),
        "transitions": len(net.transitions),
        "arcs": len(net.arcs),
        "checks": checks,
    }
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
    return 0 if all(c["passed"] for c in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
