import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  type CallToolResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/server";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { EXAMPLES, EXAMPLE_IDS, type VitessceConfig } from "./examples.js";

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const RESOURCE_URI = "ui://vitessce/mcp-app.html";

/**
 * Origins the Vitessce view is allowed to fetch data from (CSP `connect-src`).
 * The CSP is declared once per UI resource rather than per tool call, so data
 * hosts must be known ahead of time. Extend via VITESSCE_CONNECT_DOMAINS
 * (comma-separated, e.g. "http://localhost:8000,https://my-bucket.s3.amazonaws.com").
 */
const DEFAULT_CONNECT_DOMAINS = [
  "https://*.vitessce.io",
  "https://storage.googleapis.com",
  "https://*.storage.googleapis.com",
  "https://*.s3.amazonaws.com",
  "https://*.embassy.ebi.ac.uk",
  "https://assets.hubmapconsortium.org",
];

export const CONNECT_DOMAINS = [
  ...DEFAULT_CONNECT_DOMAINS,
  ...(process.env.VITESSCE_CONNECT_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean),
];

function isUrlAllowed(url: string, allowedDomains: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return allowedDomains.some((domain) => {
    const [scheme, host] = domain.split("://");
    if (`${scheme}:` !== parsed.protocol || !host) return false;
    if (host.startsWith("*.")) {
      return parsed.host.endsWith(host.slice(1));
    }
    return parsed.host === host;
  });
}

/** Recursively collects absolute http(s) URLs referenced by the config's datasets. */
function collectDataUrls(value: unknown, urls: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    if (/^https?:\/\//.test(value)) urls.add(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectDataUrls(item, urls));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectDataUrls(item, urls));
  }
  return urls;
}

function summarizeConfig(config: VitessceConfig): string {
  const datasets = (config.datasets as { files?: { fileType?: string }[] }[]) ?? [];
  const layout = (config.layout as { component?: string }[]) ?? [];
  const fileTypes = datasets.flatMap((d) => (d.files ?? []).map((f) => f.fileType));
  const components = layout.map((v) => v.component);
  return [
    `Displaying Vitessce view config${config.name ? ` "${config.name}"` : ""}.`,
    `Datasets: ${datasets.length} (file types: ${fileTypes.join(", ") || "none"}).`,
    `Views: ${components.join(", ") || "none"}.`,
  ].join("\n");
}

function renderConfigResult(config: VitessceConfig): CallToolResult {
  const blockedUrls = [...collectDataUrls(config.datasets)].filter(
    (url) => !isUrlAllowed(url, CONNECT_DOMAINS),
  );
  const lines = [summarizeConfig(config)];
  if (blockedUrls.length > 0) {
    lines.push(
      "",
      "WARNING: the following URLs are not in the app's allowed data origins and will likely be blocked by the Content Security Policy:",
      ...blockedUrls.map((url) => `- ${url}`),
      `Allowed origins: ${CONNECT_DOMAINS.join(", ")}.`,
      "The server operator can allow more origins via the VITESSCE_CONNECT_DOMAINS environment variable.",
    );
  }
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: { config },
  };
}

const configSchema = z
  .looseObject({
    version: z
      .string()
      .describe('View config schema version. Use "1.0.18" (the latest).'),
    name: z.string().optional(),
    description: z.string().optional(),
    initStrategy: z
      .enum(["auto", "none"])
      .optional()
      .describe('Use "auto" to fill in unspecified coordination scopes automatically.'),
    datasets: z
      .array(
        z.looseObject({
          uid: z.string(),
          name: z.string().optional(),
          files: z.array(
            z.looseObject({
              fileType: z.string(),
              url: z.string().optional(),
              options: z.unknown().optional(),
              coordinationValues: z.record(z.string(), z.unknown()).optional(),
            }),
          ),
        }),
      )
      .describe("Datasets and the files they contain."),
    coordinationSpace: z
      .record(z.string(), z.record(z.string(), z.unknown()))
      .optional()
      .describe("Map of coordination type -> scope name -> value."),
    layout: z
      .array(
        z.looseObject({
          component: z.string(),
          coordinationScopes: z.record(z.string(), z.unknown()).optional(),
          props: z.record(z.string(), z.unknown()).optional(),
          x: z.number(),
          y: z.number(),
          w: z.number(),
          h: z.number(),
        }),
      )
      .describe("Views placed on a 12-column grid."),
  })
  .describe("A Vitessce view config JSON object.");

const VISUALIZE_DESCRIPTION = `Render an interactive Vitessce visualization of single-cell and/or spatial omics data from a Vitessce view config.

A view config has:
- datasets[].files[]: each file has a fileType, url, optional options, and optional coordinationValues (e.g. {obsType: "cell", featureType: "gene", featureValueType: "expression", embeddingType: "UMAP"}).
  Common fileTypes: "anndata.zarr" (options map data types to zarr paths, e.g. obsFeatureMatrix {path: "X"}, obsEmbedding {path: "obsm/X_umap"}, obsSets [{name, path: "obs/leiden"}], obsLocations {path: "obsm/spatial"}, obsSpots/obsSegmentations), "spatialdata.zarr", "image.ome-zarr", "image.ome-tiff", "obsEmbedding.csv", "obsSets.csv", "obsFeatureMatrix.csv".
- layout[]: views on a 12-column grid with x, y, w, h. Common components: "scatterplot" (embeddings), "spatial" or "spatialBeta" (images, spots, segmentations), "layerController"/"layerControllerBeta", "heatmap", "obsSets", "obsSetSizes", "featureList", "featureValueHistogram", "obsSetFeatureValueDistribution", "dotPlot", "description".
- coordinationSpace: coordination values shared by views via layout[].coordinationScopes (e.g. embeddingType, obsType, featureSelection, obsColorEncoding, spatialZoom).
Set version "1.0.18" and initStrategy "auto" so unspecified coordination is filled in automatically.
Each "scatterplot" view must be given an embeddingType, e.g. coordinationSpace.embeddingType = {UMAP: "UMAP"} with the view's coordinationScopes.embeddingType = "UMAP", matching the embeddingType of an obsEmbedding in the file (via coordinationValues or options.obsEmbedding[].embeddingType).

Data URLs must be publicly accessible over HTTP(S) with CORS enabled. Call get-example-vitessce-config to see complete working configs.
Docs: https://vitessce.io/docs/view-config-json/`;

/**
 * Creates a new MCP server instance with tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "Vitessce MCP App Server",
    version: "1.0.0",
  });

  registerAppTool(server,
    "visualize-vitessce-config",
    {
      title: "Visualize with Vitessce",
      description: VISUALIZE_DESCRIPTION,
      inputSchema: z.object({ config: configSchema }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ config }): Promise<CallToolResult> => renderConfigResult(config),
  );

  registerAppTool(server,
    "visualize-example-dataset",
    {
      title: "Visualize example dataset with Vitessce",
      description:
        "Render one of the built-in Vitessce demo datasets: " +
        '"habib-2017-snrnaseq" (single-nucleus RNA-seq of human brain: UMAP, cell types, heatmap) or ' +
        '"human-lymph-node-visium" (10x Visium spatial transcriptomics with H&E image).',
      inputSchema: z.object({ example: z.enum(EXAMPLE_IDS) }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ example }): Promise<CallToolResult> => renderConfigResult(EXAMPLES[example]),
  );

  // Text-only tool so the model can learn the config format before writing its own.
  server.registerTool(
    "get-example-vitessce-config",
    {
      title: "Get example Vitessce view config",
      description:
        "Return the JSON of a built-in example Vitessce view config, for use as a template when writing configs for visualize-vitessce-config.",
      inputSchema: z.object({ example: z.enum(EXAMPLE_IDS) }),
    },
    async ({ example }): Promise<CallToolResult> => ({
      content: [{ type: "text", text: JSON.stringify(EXAMPLES[example], null, 2) }],
    }),
  );

  registerAppResource(server,
    "Vitessce viewer",
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
      return {
        contents: [{
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: {
            ui: {
              csp: {
                connectDomains: CONNECT_DOMAINS,
                // Image tiles and textures may be loaded as <img>/blob resources.
                resourceDomains: CONNECT_DOMAINS,
              },
            },
          },
        }],
      };
    },
  );

  return server;
}
