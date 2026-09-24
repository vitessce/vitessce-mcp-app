/**
 * @file MCP App view that renders a Vitessce view config with the Vitessce React component.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Vitessce } from "vitessce";

type VitessceConfig = Record<string, unknown>;

const INLINE_HEIGHT = 640;
const TOOLBAR_HEIGHT = 32;
const MODEL_CONTEXT_DEBOUNCE_MS = 1000;
const MAX_MODEL_CONTEXT_CHARS = 50_000;

function isConfig(value: unknown): value is VitessceConfig {
  return !!value && typeof value === "object" && Array.isArray((value as VitessceConfig).layout);
}

function extractConfig(result: CallToolResult): VitessceConfig | null {
  const config = (result.structuredContent as { config?: unknown } | undefined)?.config;
  return isConfig(config) ? config : null;
}

function extractErrorText(result: CallToolResult): string {
  return result.content
    ?.filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n") || "The tool call failed.";
}

type ViewState =
  | { status: "waiting" }
  | { status: "error"; message: string }
  | { status: "ready"; config: VitessceConfig };

function VitessceApp() {
  const [viewState, setViewState] = useState<ViewState>({ status: "waiting" });
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "Vitessce", version: "1.0.0" },
    capabilities: { availableDisplayModes: ["inline", "fullscreen"] },
    onAppCreated: (app) => {
      app.ontoolinput = (params) => {
        // Render as soon as the full input is available; the result may carry
        // the same config (visualize-vitessce-config) or the only config (examples).
        const config = params.arguments?.config;
        if (isConfig(config)) {
          setViewState((prev) => (prev.status === "ready" ? prev : { status: "ready", config }));
        }
      };
      app.ontoolresult = (result) => {
        if (result.isError) {
          setViewState({ status: "error", message: extractErrorText(result) });
          return;
        }
        const config = extractConfig(result);
        if (config) {
          setViewState((prev) => (
            prev.status === "ready" && JSON.stringify(prev.config) === JSON.stringify(config)
              ? prev
              : { status: "ready", config }
          ));
        }
      };
      app.ontoolcancelled = (params) => {
        setViewState({ status: "error", message: `Cancelled: ${params.reason ?? "no reason given"}` });
      };
      app.onhostcontextchanged = (params) => {
        setHostContext((prev) => ({ ...prev, ...params }));
      };
      app.onteardown = async () => ({});
      app.onerror = console.error;
    },
  });

  useEffect(() => {
    if (app) setHostContext(app.getHostContext());
  }, [app]);

  if (error) return <div className="status"><strong>Error:</strong> {error.message}</div>;
  if (!app) return <div className="status">Connecting…</div>;

  return <VitessceView app={app} viewState={viewState} hostContext={hostContext} />;
}

interface VitessceViewProps {
  app: App;
  viewState: ViewState;
  hostContext?: McpUiHostContext;
}

function VitessceView({ app, viewState, hostContext }: VitessceViewProps) {
  const isFullscreen = hostContext?.displayMode === "fullscreen";
  const canFullscreen = hostContext?.availableDisplayModes?.includes("fullscreen") ?? false;
  const theme = hostContext?.theme === "dark" ? "dark" : "light";
  const totalHeight = useContainerHeight(hostContext, isFullscreen);
  const vitessceHeight = totalHeight - TOOLBAR_HEIGHT;

  const toggleFullscreen = useCallback(async () => {
    const mode = isFullscreen ? "inline" : "fullscreen";
    await app.requestDisplayMode({ mode });
  }, [app, isFullscreen]);

  const config = viewState.status === "ready" ? viewState.config : null;
  const { onConfigChange, onWarn } = useModelContextSync(app, config);
  const title = typeof config?.name === "string" ? config.name : "Vitessce";

  const insets = hostContext?.safeAreaInsets;

  return (
    <main
      className={`app${isFullscreen ? " fullscreen" : ""}`}
      style={{
        height: totalHeight,
        paddingTop: insets?.top,
        paddingRight: insets?.right,
        paddingBottom: insets?.bottom,
        paddingLeft: insets?.left,
      }}
    >
      <div className="toolbar">
        <span className="title">{title}</span>
        {canFullscreen && (
          <button onClick={toggleFullscreen}>{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
        )}
      </div>
      <div style={{ height: vitessceHeight }}>
        {viewState.status === "waiting" && (
          <div className="status">Waiting for a Vitessce view config…</div>
        )}
        {viewState.status === "error" && (
          <div className="status"><pre>{viewState.message}</pre></div>
        )}
        {config && (
          <Vitessce
            config={config}
            height={vitessceHeight}
            theme={theme}
            onConfigChange={onConfigChange}
            onWarn={onWarn}
          />
        )}
      </div>
    </main>
  );
}

/**
 * Height of the app in pixels: fixed in inline mode (bounded by the host's
 * max height, if any), and fills the host container in fullscreen mode.
 */
function useContainerHeight(hostContext: McpUiHostContext | undefined, isFullscreen: boolean): number {
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);
  useEffect(() => {
    const onResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return useMemo(() => {
    const dims = hostContext?.containerDimensions;
    const fixedHeight = dims && "height" in dims ? dims.height : undefined;
    const maxHeight = dims && "maxHeight" in dims ? dims.maxHeight : undefined;
    if (fixedHeight) return fixedHeight;
    if (isFullscreen) return maxHeight ?? windowHeight;
    return Math.min(INLINE_HEIGHT, maxHeight ?? INLINE_HEIGHT);
  }, [hostContext?.containerDimensions, isFullscreen, windowHeight]);
}

function formatWarning(warning: unknown): string {
  if (typeof warning === "string") return warning;
  if (warning && typeof warning === "object") {
    const { title, unformatted } = warning as { title?: string; unformatted?: string };
    if (title || unformatted) return [title, unformatted].filter(Boolean).join(": ");
  }
  return JSON.stringify(warning);
}

/**
 * Keeps the model informed about the user's interactions (selections, zoom,
 * layout changes) and any Vitessce errors (invalid config, failed data loads)
 * by sending the latest view config and warnings as model context.
 */
function useModelContextSync(app: App, config: VitessceConfig | null) {
  const latestConfigRef = useRef(config);
  const warningsRef = useRef<Set<string>>(new Set());
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    latestConfigRef.current = config;
    warningsRef.current = new Set();
  }, [config]);
  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const scheduleUpdate = useCallback(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      let json = JSON.stringify(latestConfigRef.current);
      if (json.length > MAX_MODEL_CONTEXT_CHARS) {
        json = `${json.slice(0, MAX_MODEL_CONTEXT_CHARS)}… [truncated]`;
      }
      const warnings = [...warningsRef.current];
      const text = [
        "The user is viewing an interactive Vitessce visualization.",
        ...(warnings.length > 0
          ? ["Vitessce reported these errors/warnings:", ...warnings.map((w) => `- ${w}`)]
          : []),
        "Its current view config (reflecting the user's selections, zoom, and layout) is:",
        json,
      ].join("\n");
      app.updateModelContext({ content: [{ type: "text", text }] }).catch((e) => {
        console.warn("updateModelContext failed:", e);
      });
    }, MODEL_CONTEXT_DEBOUNCE_MS);
  }, [app]);

  const onConfigChange = useCallback((nextConfig: VitessceConfig) => {
    latestConfigRef.current = nextConfig;
    scheduleUpdate();
  }, [scheduleUpdate]);

  const onWarn = useCallback((warning: unknown) => {
    warningsRef.current.add(formatWarning(warning));
    scheduleUpdate();
  }, [scheduleUpdate]);

  return { onConfigChange, onWarn };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VitessceApp />
  </StrictMode>,
);
