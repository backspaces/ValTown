// A status page: the latest results, plus a link to check right now.
import { blob } from "https://esm.town/v/std/blob/main.ts";
import { runChecks, statusKey } from "./watch.ts";

const minGapMs = 60_000; // "check now" runs at most once a minute

const escape = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default async function (req) {
  const url = new URL(req.url);
  let status = await blob.getJSON(statusKey);

  if (url.searchParams.has("check")) {
    const age = status ? Date.now() - Date.parse(status.checkedAt) : Infinity;
    if (age > minGapMs) await runChecks();
    // Send the browser back to the plain page, so reloading it doesn't
    // check again.
    return Response.redirect(new URL("/", url), 303);
  }

  // The same results as data, for other vals (e.g. Mcp) to read.
  if (url.searchParams.has("json")) {
    return Response.json(status ?? null);
  }

  const rows = status
    ? Object.entries(status.targets).map(([name, t]) => `
      <tr>
        <td>${escape(name)}</td>
        <td class="${t.up ? "up" : "down"}">${t.up ? "up" : "down"}</td>
        <td><time datetime="${escape(t.since)}">${escape(t.since)}</time></td>
        <td>${escape(t.problem ?? "")}</td>
      </tr>`).join("")
    : "";

  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Watch</title>
<style>
  body { font: 15px system-ui, sans-serif; max-width: 44rem; margin: 2rem auto; padding: 0 1rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #ddd; }
  .up { color: #070; font-weight: bold; }
  .down { color: #b00; font-weight: bold; }
</style>
</head>
<body>
<h1>Watch</h1>
${status
    ? `<p>Last checked <time datetime="${escape(status.checkedAt)}">${escape(status.checkedAt)}</time>.</p>
<table>
  <tr><th>Val</th><th>Status</th><th>Since</th><th>Problem</th></tr>${rows}
</table>`
    : "<p>No checks have run yet.</p>"}
<p><a href="?check">Check now</a> (at most once a minute)</p>
<script>
  // The server only knows UTC; show times in the viewer's own time zone.
  for (const t of document.querySelectorAll("time")) {
    t.textContent = new Date(t.dateTime).toLocaleString();
  }
</script>
</body>
</html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}
