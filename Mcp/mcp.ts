// Make an MCP server from plain objects, one per tool. mcpServer returns
// a val's default export: MCP clients get the server, and browsers get a
// page listing the tools and how to add the server to an AI.
import {
  createMcpHandler,
  McpServer,
} from "npm:@modelcontextprotocol/server@2";
import * as z from "npm:zod@4/v4";

export { z };

const timeoutMs = 10_000;

// Like fetch, but gives up after timeoutMs, and returns null (instead of
// throwing) on a 404, so tools can say "no such ..." themselves.
export async function call(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}: ${await res.text()}`);
  return res;
}

// readOnly and destructive become the MCP hints clients (claude.ai, say)
// use to decide which tools need asking first. Left out, they're not sent.
const hints = ({ readOnly, destructive }) => ({
  ...(readOnly !== undefined && { readOnlyHint: readOnly }),
  ...(destructive !== undefined && { destructiveHint: destructive }),
});

const text = (s) => ({ content: [{ type: "text", text: s }] });

// A tool's run returns a string. Anything it throws becomes a tool result
// the model can read (isError), rather than a protocol error.
const safely = (run) => async (args) => {
  try {
    return text(String(await run(args)));
  } catch (e) {
    return { ...text(e.message ?? String(e)), isError: true };
  }
};

// One tool, for people: name, whether it changes anything, what it does,
// and each argument with its type.
const describe = ({ name, description, inputSchema, annotations }) => {
  const { properties = {}, required = [] } = inputSchema;
  const args = Object.entries(properties).map(([arg, s]) =>
    `\n      ${arg}: ${s.type}` +
    (required.includes(arg) ? ", required" : "") +
    (s.default !== undefined ? `, default ${JSON.stringify(s.default)}` : "") +
    (s.description ? `. ${s.description}` : "")
  );
  const kind = annotations?.readOnlyHint ? "read-only"
    : annotations?.destructiveHint === false ? "adds, never deletes"
    : "can change things";
  return `  ${name} (${kind})\n    ${description}${args.join("")}`;
};

// The server's name, from its address: backspaces-mcp.val.run gives
// "backspaces" (a trailing "-mcp" is dropped). It's the name in
// initialize, and the one the browser page suggests adding it under.
const nameOf = (req) => new URL(req.url).hostname.split(".")[0].replace(/-mcp$/, "");

// tools is { tool_name: { description, args?, readOnly?, destructive?, run } }.
// args is { argName: z.string()... }; run gets the arguments and returns
// a string (or a promise of one).
export function mcpServer(tools) {
  const handlerFor = (name) =>
    createMcpHandler(() => {
      const server = new McpServer({ name, version: "1.0.0" });
      for (const [toolName, tool] of Object.entries(tools)) {
        server.registerTool(toolName, {
          annotations: hints(tool),
          description: tool.description,
          inputSchema: z.object(tool.args ?? {}),
        }, safely(tool.run));
      }
      return server;
    });

  // The tools as clients see them: ask our own handler for tools/list, so
  // the browser page can't drift from what's registered above.
  async function toolList(handler) {
    const res = await handler.fetch(new Request("http://localhost/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }));
    const data = (await res.text()).match(/^data: (.*)$/m)[1];
    return JSON.parse(data).result.tools;
  }

  // A browser visit (a GET that doesn't ask for an event stream) gets a
  // note for people, on what this is and how to use it, instead of the
  // SDK's "Method not allowed".
  const note = (name, url, list) => `${name}: an MCP server

This address is for AI assistants, not for browsers. Add it to Claude
(or another AI that supports MCP), and it can use these tools:

${list.map(describe).join("\n\n")}

(Generated live from this server's tools/list.)

Then ask in plain words, and the AI picks the tool.

In claude.ai (any plan; Free allows one custom connector):
  1. Customize → Connectors → + Add → Custom
  2. Name: ${name}    MCP server URL: ${url}
  3. Continue, leave "No sign-in", then Add
  4. On the connector's page, click Connect
  To find it again later: Customize → Connectors → Yours.

In Claude Code or Codex, paste this into a chat, then start a new chat:
  Add the MCP server at ${url} under the name ${name},
  available in all my projects.
Or run the command yourself:
  claude mcp add --transport http --scope user ${name} ${url}
  codex mcp add ${name} --url ${url}
`;

  return async (req) => {
    const name = nameOf(req);
    const handler = handlerFor(name);
    return req.method === "GET" &&
        !req.headers.get("accept")?.includes("text/event-stream")
      ? new Response(note(name, new URL(req.url).origin + "/", await toolList(handler)))
      : handler.fetch(req);
  };
}
