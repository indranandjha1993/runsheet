#!/usr/bin/env python3
"""Writes docs/reference/routes.md and docs/reference/events.md from the published specifications,
so the reference pages say exactly what the code does. Run through: make docs."""
import json, pathlib

root = pathlib.Path(__file__).resolve().parents[2]
out = root / "docs" / "reference"
out.mkdir(parents=True, exist_ok=True)

openapi = json.loads((root / "spec" / "openapi.json").read_text())
events = json.loads((root / "contracts" / "events.json").read_text())

ORDER = ["identity", "network", "address", "orders", "execution", "linehaul", "planning",
         "promise", "exceptions", "money", "policy", "reporting"]

def fields(schema):
    props = schema.get("properties", {})
    required = set(schema.get("required", []))
    rows = []
    for name, spec in props.items():
        kind = spec.get("type", "object" if "properties" in spec else "any")
        if "enum" in spec:
            kind = " \\| ".join(f"`{v}`" for v in spec["enum"])
        elif kind == "array":
            kind = f"array of {spec.get('items', {}).get('type', 'object')}"
        rows.append(f"| `{name}` | {kind} | {'yes' if name in required else 'no'} |")
    return rows

by_service = {}
for path, ops in openapi["paths"].items():
    for method, op in ops.items():
        by_service.setdefault(op["tags"][0], []).append((method.upper(), path, op))

lines = ["# Every route", "",
         "Generated from `spec/openapi.json` by `make docs`. The specification is generated from the",
         "schemas the services validate against, so this page cannot describe a request a service would",
         "refuse. Paths are relative to the gateway, `http://localhost:14000` locally.", ""]
for service in ORDER + sorted(set(by_service) - set(ORDER)):
    if service not in by_service:
        continue
    lines += [f"## {service}", ""]
    for method, path, op in sorted(by_service[service], key=lambda x: (x[1], x[0])):
        scope = next((s[0] for sec in op.get("security", []) for s in sec.values()), None)
        lines += [f"### `{method} {path}`", "", op["summary"] + ".", ""]
        lines.append(f"Scope: `{scope}`" if scope else "No credential needed.")
        lines.append("")
        body = op.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema")
        if body and body.get("properties"):
            lines += ["| Field | Type | Required |", "| --- | --- | --- |"] + fields(body) + [""]
        lines += ["| Status | Meaning |", "| --- | --- |"]
        for status, reply in op["responses"].items():
            lines.append(f"| {status} | {reply['description']} |")
        lines.append("")
(out / "routes.md").write_text("\n".join(lines))

lines = ["# Every event", "",
         "Generated from `contracts/events.json` by `make docs`. A service cannot publish an event that is",
         "not in this catalogue; a test refuses it at the point of publishing.", "",
         "Every event carries the same envelope: `event_id`, `tenant_id`, `aggregate_type`, `aggregate_id`,",
         "`sequence` (the position in that aggregate's stream), `type`, `version`, `occurred_at`,",
         "`recorded_at`, `source`, `correlation_id`, `causation_id`, and `confidence` for events that came",
         "from a device, a connector, or a policy rather than from a person.", ""]
by_topic = {}
for name, channel in events["channels"].items():
    by_topic.setdefault(channel["topic"], []).append((name, channel))
for topic in sorted(by_topic):
    lines += [f"## Topic `{topic}`", "", "| Event | Payload fields |", "| --- | --- |"]
    for name, channel in sorted(by_topic[topic]):
        props = channel.get("payload", {}).get("properties", {})
        shown = ", ".join(f"`{k}`" for k in props) if props else "none beyond the envelope"
        lines.append(f"| `{name}` | {shown} |")
    lines.append("")
(out / "events.md").write_text("\n".join(lines))
print(f"wrote {out/'routes.md'} and {out/'events.md'}")
