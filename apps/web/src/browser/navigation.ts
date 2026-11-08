import { useSyncExternalStore, type SetStateAction } from "react";
import { z } from "zod";
import { imageProviders, type ImageProvider } from "../providers";
import { providerQueryMaxLength } from "../config";
import { toast } from "sonner";
import { t } from "../i18n";

const navigationHistoryLimit = 100;

const sourceSchema = z
  .string()
  .refine(
    (value) =>
      value === "imported" ||
      imageProviders.some((provider) => provider.id === value),
  );
const offsetSchema = z.number().int().min(0).max(10000000);
const browsingSchema = z.object({
  query: z.string().max(providerQueryMaxLength),
  selectedTopic: z.string().max(40).nullable(),
  request: z
    .object({
      query: z.string().max(providerQueryMaxLength),
      offset: offsetSchema,
      topic: z.string().max(40).nullable().optional(),
    })
    .nullable(),
  history: z.array(offsetSchema).max(navigationHistoryLimit),
});
const stateSchema = z.object({
  selectedPanel: z.union([z.literal(0), z.literal(2), z.literal(3)]).default(0),
  sidebarOpen: z.boolean().default(true),
  zoom: z.number().min(50).max(200).multipleOf(5).default(100).catch(100),
  librarySource: sourceSchema.default("imported"),
  pickerSource: sourceSchema.default("imported"),
  browsing: z.record(z.string().max(60), browsingSchema).default({}),
});
export type BrowsingState = z.infer<typeof browsingSchema>;
type EditorState = z.infer<typeof stateSchema>;
type HistoryMode = "push" | "replace" | "silent";
const storageKey = "grids-ui-v1";
const parameters = ["panel", "source", "q", "topic", "offset"];
const historySchema = z.object({
  gridsNavigation: z.object({
    selectedPanel: stateSchema.shape.selectedPanel,
    source: sourceSchema,
    browsing: browsingSchema.optional(),
  }),
});

export function defaultBrowsing(provider: ImageProvider): BrowsingState {
  const topic = provider.browse[0];
  return {
    query: "",
    selectedTopic: topic?.id ?? null,
    request: { query: "", offset: 0, topic: topic?.id ?? null },
    history: [],
  };
}

export function parseEditorState(value: unknown): EditorState {
  const result = stateSchema.safeParse(value);
  const parsed = result.success ? result.data : stateSchema.parse({});
  return {
    ...parsed,
    browsing: Object.fromEntries(
      imageProviders.flatMap((provider) =>
        ["library", "picker"].map((scope) => {
          const key = `${scope}:${provider.id}`;
          return [key, parsed.browsing[key] ?? defaultBrowsing(provider)];
        }),
      ),
    ),
  };
}

export function readNavigation(
  state: EditorState,
  url: URL,
  initial = false,
  entry?: unknown,
): EditorState {
  if (!parameters.some((key) => url.searchParams.has(key))) {
    const parsed = historySchema.safeParse(entry);
    if (!parsed.success) return state;
    const visited = parsed.data.gridsNavigation;
    const browse = visited.browsing;
    return {
      ...state,
      selectedPanel: visited.selectedPanel,
      librarySource: visited.source,
      browsing: browse
        ? {
            ...state.browsing,
            [`library:${visited.source}`]: {
              ...browse,
              query: browse.request?.query ?? browse.query,
              selectedTopic:
                browse.request?.topic === undefined
                  ? browse.selectedTopic
                  : browse.request.topic,
            },
          }
        : state.browsing,
    };
  }
  const panel = url.searchParams.get("panel");
  const parsedSource = sourceSchema.safeParse(
    url.searchParams.get("source") ?? "imported",
  );
  const source = parsedSource.success ? parsedSource.data : "imported";
  const next = {
    ...state,
    selectedPanel:
      panel === "reset"
        ? (3 as const)
        : panel === "design" || panel === "themes"
          ? (2 as const)
          : (0 as const),
    librarySource: source,
  };
  const provider = imageProviders.find((item) => item.id === source);
  if (!provider) return next;
  const fallback = defaultBrowsing(provider);
  const topic = provider.browse.find(
    (item) => item.id === url.searchParams.get("topic"),
  );
  const text = url.searchParams
    .get("q")
    ?.trim()
    .slice(0, providerQueryMaxLength);
  const offsetText = url.searchParams.get("offset") ?? "0";
  const parsedOffset = /^\d+$/.test(offsetText)
    ? offsetSchema.safeParse(Number(offsetText))
    : null;
  const offset = parsedOffset?.success ? parsedOffset.data : 0;
  const selectedTopic =
    topic?.id ??
    (text || url.searchParams.get("topic") === "all"
      ? null
      : fallback.selectedTopic);
  const request = { query: text ?? "", offset, topic: selectedTopic };
  const saved = state.browsing[`library:${source}`];
  const parsedEntry = historySchema.safeParse(entry);
  const visited =
    parsedEntry.success && parsedEntry.data.gridsNavigation.source === source
      ? parsedEntry.data.gridsNavigation.browsing
      : null;
  const history =
    visited &&
    visited.request?.query === request?.query &&
    visited?.request?.topic === request.topic &&
    visited?.request?.offset === offset
      ? visited.history
      : saved?.request?.query === request?.query &&
          saved?.request?.topic === request.topic &&
          saved.request?.offset === offset
        ? saved.history
        : offset
          ? [0]
          : [];
  return {
    ...next,
    browsing: {
      ...state.browsing,
      [`library:${source}`]: {
        query: text ?? "",
        selectedTopic,
        request,
        history,
      },
    },
  };
}

export function navigationUrl(_state: EditorState, current: URL): URL {
  const url = new URL(current);
  for (const key of parameters) url.searchParams.delete(key);
  return url;
}

let state: EditorState | undefined;
const listeners = new Set<() => void>();
let listening = false;
function snapshot(): EditorState {
  if (!state) {
    let saved: unknown;
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    } catch {}
    state = readNavigation(
      parseEditorState(saved),
      new URL(window.location.href),
      true,
      window.history.state,
    );
  }
  return state;
}
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(snapshot()));
  } catch {
    toast.error(t("presets.saveError"), { id: "editor-preferences-save" });
  }
}
function update(next: EditorState, mode: HistoryMode) {
  state = next;
  persist();
  if (mode !== "silent") {
    const url = navigationUrl(next, new URL(window.location.href));
    const previous = historySchema.safeParse(window.history.state);
    const before = previous.success
      ? previous.data.gridsNavigation.browsing?.request
      : undefined;
    const after = next.browsing[`library:${next.librarySource}`]?.request;
    const entry = {
      ...window.history.state,
      gridsNavigation: {
        selectedPanel: next.selectedPanel,
        source: next.librarySource,
        browsing: next.browsing[`library:${next.librarySource}`],
      },
    };
    const changed =
      !previous.success ||
      previous.data.gridsNavigation.selectedPanel !== next.selectedPanel ||
      previous.data.gridsNavigation.source !== next.librarySource ||
      before?.query !== after?.query ||
      before?.topic !== after?.topic ||
      before?.offset !== after?.offset;
    window.history[mode === "push" && changed ? "pushState" : "replaceState"](
      entry,
      "",
      url,
    );
  }
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!listening) {
    listening = true;
    window.addEventListener("popstate", (event) =>
      update(
        readNavigation(
          snapshot(),
          new URL(window.location.href),
          false,
          event.state,
        ),
        "silent",
      ),
    );
    update(snapshot(), "replace");
  }
  return () => {
    listeners.delete(listener);
  };
}

export function useEditorState<Key extends keyof Omit<EditorState, "browsing">>(
  key: Key,
) {
  const current = useSyncExternalStore(subscribe, snapshot);
  const set = (value: SetStateAction<EditorState[Key]>) => {
    const previous = snapshot();
    const next = typeof value === "function" ? value(previous[key]) : value;
    update(
      { ...previous, [key]: next },
      key === "pickerSource" || key === "sidebarOpen" || key === "zoom"
        ? "silent"
        : "push",
    );
  };
  return [current[key], set] as const;
}

export function useBrowsingState(provider: ImageProvider, picker: boolean) {
  const current = useSyncExternalStore(subscribe, snapshot);
  const key = `${picker ? "picker" : "library"}:${provider.id}`;
  const browse = current.browsing[key] ?? defaultBrowsing(provider);
  const set = (
    value: SetStateAction<BrowsingState>,
    mode: HistoryMode = "push",
  ) => {
    const previous = snapshot();
    const before = previous.browsing[key] ?? defaultBrowsing(provider);
    const next = typeof value === "function" ? value(before) : value;
    update(
      {
        ...previous,
        browsing: {
          ...previous.browsing,
          [key]: {
            ...next,
            history: next.history.slice(-navigationHistoryLimit),
          },
        },
      },
      picker ? "silent" : mode,
    );
  };
  return [browse, set] as const;
}
