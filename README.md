# vitessce-mcp-app

An [MCP App](https://github.com/modelcontextprotocol/ext-apps) that embeds the [Vitessce](https://vitessce.io) React component (the `vitessce` NPM package). It lets MCP hosts such as Claude show interactive visualizations of single-cell and spatial omics data.

## Tools

| Tool | UI | Description |
|------|----|-------------|
| `visualize-vitessce-config` | ✅ | Renders any Vitessce [view config](https://vitessce.io/docs/view-config-json/) passed as `config`. |
| `visualize-example-dataset` | ✅ | Renders a built-in demo: `habib-2017-snrnaseq` (snRNA-seq) or `human-lymph-node-visium` (10x Visium). |
| `get-example-vitessce-config` | — | Returns an example config as JSON, for the model to use as a template. |

All UI tools share one resource, `ui://vitessce/mcp-app.html`. It is a single-file bundle of React and Vitessce built with `vite-plugin-singlefile`.

The view:
- follows the host's light/dark theme
- has a fullscreen toggle, if the host supports fullscreen
- sends the current view config (which reflects the user's selections, zoom, and layout) to the model with `updateModelContext`
- forwards Vitessce errors to the model the same way, including invalid configs and failed data loads

## Quick start

```bash
npm install
npm run build          # type-check + bundle dist/mcp-app.html
npm run serve          # Streamable HTTP on http://localhost:3001/mcp (PORT to override)
npm run serve:stdio    # stdio transport
```

Run `npm run build` before starting the server. The server reads `dist/mcp-app.html` when a host requests the UI resource.

### Connecting to a host

Example stdio client configuration (e.g. for Claude Desktop):

```json
{
  "mcpServers": {
    "vitessce": {
      "command": "npx",
      "args": ["tsx", "/path/to/vitessce-mcp-app/main.ts", "--stdio"]
    }
  }
}
```

Hosts that connect over HTTP can use `http://localhost:3001/mcp` after `npm run serve`.

## Data access (CSP)

MCP App views run in a sandboxed iframe. The iframe can only fetch from origins that are declared in the resource's CSP (`_meta.ui.csp.connectDomains`). By default this app allows the Vitessce demo data hosts:

```
https://*.vitessce.io, https://storage.googleapis.com, https://*.storage.googleapis.com,
https://*.s3.amazonaws.com, https://*.embassy.ebi.ac.uk, https://assets.hubmapconsortium.org
```

To add more origins, such as a local data server, set `VITESSCE_CONNECT_DOMAINS` (comma-separated):

```bash
VITESSCE_CONNECT_DOMAINS="http://localhost:8000,https://my-lab-bucket.example.org" npm run serve
```

When a config references a URL outside the allowed origins, the tool result warns the model. Data servers must also send CORS headers (`Access-Control-Allow-Origin`).

## Development

### Prerequisites

- Node.js with npm. Development and testing were done with Node 24.
- Git, to fetch the `references/vitessce` submodule (optional; it is only used as source reference).

### Setup

```bash
git clone --recurse-submodules <repo-url> vitessce-mcp-app
cd vitessce-mcp-app
npm install
npm run build
```

If you already cloned without submodules, run `git submodule update --init`.

### Project layout

| Path | Purpose |
|------|---------|
| `main.ts` | Entry point. Starts the server over Streamable HTTP (default) or stdio (`--stdio`). |
| `server.ts` | Registers the tools and the `ui://vitessce/mcp-app.html` resource, including the CSP allowlist. |
| `examples.ts` | Built-in example view configs used by `visualize-example-dataset` and `get-example-vitessce-config`. |
| `mcp-app.html` | HTML entry point for the view. |
| `src/mcp-app.tsx` | The view: connects to the host with `useApp`, receives tool results, renders `<Vitessce />`. |
| `src/global.css` | View styles, with fallbacks for host style variables. |
| `vite.config.ts` | Bundles the view into a single `dist/mcp-app.html` file. |
| `references/vitessce` | Git submodule of the Vitessce source, for looking up component props, file types, and view types. |

### Scripts

| Script | What it does |
|--------|--------------|
| `npm run build` | Type-checks all TypeScript, then bundles the view into `dist/mcp-app.html`. |
| `npm run watch` | Rebuilds `dist/mcp-app.html` whenever view files change. |
| `npm run serve` | Runs the HTTP server with `tsx` (no compile step for the server). |
| `npm run serve:stdio` | Runs the server over stdio. |
| `npm run start` | `build` followed by `serve`. |
| `npm run dev` | Runs `watch` and a server that restarts on changes, both at once. The bundle is unminified with inline source maps in this mode. |

### Development workflow

1. Run `npm run dev`.
2. Edit files:
   - **Server changes** (`server.ts`, `examples.ts`, `main.ts`): the server restarts automatically. Hosts cache the tool list, so reconnect the host to see new or changed tools.
   - **View changes** (`src/`, `mcp-app.html`): Vite rebuilds `dist/mcp-app.html`. The server reads that file on every resource request, so the next tool call in the host picks up the new view.
3. Run `npx tsc --noEmit` to type-check. `npm run build` also runs it.

To add a built-in example dataset, add a config to `EXAMPLES` in `examples.ts`, update the `visualize-example-dataset` description in `server.ts`, and check that its data URLs are covered by the CSP allowlist.

When debugging the view, open the browser devtools for the host page. The view runs in a nested iframe, so select that iframe as the console context. Vitessce logs data loading details to the console. 403/404 responses for Zarr metadata files (`.zattrs`, `.zarray`, `.zgroup`, `zarr.json`) are expected.

## Testing

### 1. Smoke-test the server

With `npm run serve` running, call the MCP endpoint with curl:

```bash
MCP() {
  curl -s localhost:3001/mcp \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d "$1" | sed -n 's/^data: //p'
}

# List the tools
MCP '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call a tool
MCP '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"visualize-example-dataset","arguments":{"example":"habib-2017-snrnaseq"}}}'

# Read the UI resource, which should report ~23 MB of HTML plus the CSP metadata
MCP '{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"ui://vitessce/mcp-app.html"}}' | head -c 300
```

To check the stdio transport:

```bash
(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'; sleep 3) | npm run --silent serve:stdio
```

### 2. Test the view in basic-host

The ext-apps repo includes `basic-host`, a minimal reference host that renders MCP App views:

```bash
git clone --branch "v$(npm view @modelcontextprotocol/ext-apps version)" --depth 1 \
  https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps
cd /tmp/mcp-ext-apps/examples/basic-host
npm install
npm run build
SERVERS='["http://localhost:3001/mcp"]' npx tsx serve.ts
```

basic-host's own `npm run start` needs Bun. The `npx tsx serve.ts` line above avoids that.

Open http://localhost:8080, then:

1. Pick the **Vitessce MCP App Server**, then choose a tool.
2. Enter the arguments as JSON, for example `{"example": "human-lymph-node-visium"}`, and click **Call Tool**.
3. Check that:
   - the Vitessce views load their data;
   - the **Model Context** panel updates after you interact with the views (for example, select a cell set);
   - the view follows the host theme (toggle it with the sun/moon button).

To test the error path, call `visualize-vitessce-config` with a config that has a `scatterplot` view but no `embeddingType`. The scatterplot should stay empty, and the Model Context panel should list a "Loader not found" error. To test the CSP warning, use a data URL on an origin that isn't allowed, such as `https://example.org/x.zarr`. The tool result should include a warning.

### 3. Test in a real host

Add the server to an MCP Apps-capable host, such as Claude Desktop, using the stdio configuration above. Ask it to "show the Vitessce Visium example" or to visualize your own AnnData Zarr store. The data must be on an allowed origin (see [Data access](#data-access-csp)). basic-host is a reference implementation, so check sizing, fullscreen, and CSP behavior in each real host you target.

## Notes

- The bundled HTML is about 23 MB (about 7 MB gzipped), because the full Vitessce build (deck.gl, three.js, HiGlass, Neuroglancer, etc.) is inlined.
- `references/vitessce` is a git submodule of the Vitessce source, kept for reference.
