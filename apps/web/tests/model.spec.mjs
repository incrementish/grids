import { test, expect } from "@playwright/test";
import { build } from "vite";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createInstance } from "i18next";
import ICU from "i18next-icu";

let model;
let providers;
let cache;
let navigation;
let presets;
test("canvas feedback derives minimum contrast without changing readable colors", async () => {
  const theme = await loadModule("../src/canvasTheme.ts");
  for (const background of [
    "#ffffff",
    "#17191b",
    "#808080",
    "#f4ca36",
    "#46215b",
  ]) {
    const surface = theme.contrastingColor(background, background, 1.5);
    expect(theme.colorContrast(surface, background)).toBeGreaterThanOrEqual(
      1.5,
    );
    expect(
      theme.colorContrast(theme.contrastingColor(surface, "#eef1f3"), surface),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      theme.colorContrast(
        theme.contrastingColor(background, "#d8f36a", 3),
        background,
      ),
    ).toBeGreaterThanOrEqual(3);
  }
  expect(theme.contrastingColor("#ffffff", "#202325")).toBe("#202325");
  expect(theme.contrastingColor("#17191b", "#d8f36a", 3)).toBe("#d8f36a");
});
async function loadModule(relativePath) {
  const result = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL(relativePath, import.meta.url)),
        formats: ["es"],
        fileName: "model",
      },
    },
  });
  const output = (Array.isArray(result) ? result[0] : result).output;
  const chunk = output.find((entry) => entry.type === "chunk" && entry.isEntry);
  return import(
    `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`
  );
}
test.beforeAll(async () => {
  [model, providers, cache, navigation, presets] = await Promise.all([
    loadModule("../src/model.ts"),
    loadModule("../src/providers/index.ts"),
    loadModule("../src/providers/cache.ts"),
    loadModule("../src/browser/navigation.ts"),
    loadModule("../src/presets.ts"),
  ]);
});

test("refined dark defaults keep captions readable without restyling saved grids or starter themes", () => {
  const workspace = model.makeWorkspace();
  expect(workspace.grid).toMatchObject({
    rows: 2,
    columns: 2,
    imageAspect: "portrait",
    captionPlacement: "overlay",
    captionAlignment: "bottom",
    captionOverlayOpacity: 75,
    captionOverlayColor: "#111315",
    cornerRadius: 6.25,
    gap: 24,
    canvasPadding: 36,
    background: "#17191b",
    headingBackgroundColor: "#17191b",
    headingTextColor: "#eef1f3",
    cellBackgroundColor: "#23272b",
    cellTextColor: "#eef1f3",
  });
  expect(workspace.grid.cells).toHaveLength(4);
  expect(
    workspace.grid.cells.every(
      (cell) => cell.assetId === null && cell.title === "",
    ),
  ).toBe(true);
  const luminance = (color) => {
    const channels = color.match(/[0-9a-f]{2}/gi).map((part) => {
      const value = parseInt(part, 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const [text, background] of [
    [workspace.grid.cellTextColor, workspace.grid.cellBackgroundColor],
    [workspace.grid.headingTextColor, workspace.grid.headingBackgroundColor],
  ]) {
    expect(
      (luminance(text) + 0.05) / (luminance(background) + 0.05),
    ).toBeGreaterThanOrEqual(7);
  }
  const opacity = workspace.grid.captionOverlayOpacity / 100;
  const overlayOnWhite = `#${workspace.grid.captionOverlayColor
    .slice(1)
    .match(/../g)
    .map((part) =>
      Math.round(parseInt(part, 16) * opacity + 255 * (1 - opacity))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
  expect(
    (luminance(workspace.grid.cellTextColor) + 0.05) /
      (luminance(overlayOnWhite) + 0.05),
  ).toBeGreaterThanOrEqual(4.5);
  const legacy = JSON.parse(JSON.stringify(localWorkspace()));
  expect(model.workspaceSchema.parse(legacy)).toEqual(legacy);
  const reset = model.resetWorkspace(legacy);
  expect(model.getEditorSettings(reset).style).toEqual(
    model.getEditorSettings(workspace).style,
  );
  expect(reset.assets).toBe(legacy.assets);
  expect(
    presets.starterPresets.find((preset) => preset.id === "starter:botanical")
      .settings.style,
  ).toMatchObject({
    imageAspect: "portrait",
    captionPlacement: "overlay",
    cornerRadius: 12.5,
    captionOverlayOpacity: 60,
    captionOverlayColor: "#244b3a",
    background: "#18382b",
  });
});

test("color theme identity roundtrips settings and resets without losing modified colors", () => {
  const workspace = model.makeWorkspace();
  expect(workspace.grid.colorTheme).toBe("Ink");
  workspace.grid.colorTheme = "Forest";
  workspace.grid.background = "#334455";
  const settings = model.getEditorSettings(workspace);
  expect(settings.style.colorTheme).toBe("Forest");
  const restored = model.applyEditorSettings(model.makeWorkspace(), settings);
  expect(restored.grid.colorTheme).toBe("Forest");
  expect(restored.grid.background).toBe("#334455");
  expect(model.workspaceSchema.parse(workspace).grid.colorTheme).toBe("Forest");
  for (const colorTheme of ["Cocoa", "Plum"]) {
    const themed = { ...workspace, grid: { ...workspace.grid, colorTheme } };
    expect(model.workspaceSchema.parse(themed).grid.colorTheme).toBe(
      colorTheme,
    );
    const settings = model.getEditorSettings(themed);
    expect(
      model.applyEditorSettings(model.makeWorkspace(), settings).grid
        .colorTheme,
    ).toBe(colorTheme);
  }
  expect(
    model.editorSettingsSchema.safeParse({
      ...settings,
      style: { ...settings.style, colorTheme: "unknown" },
    }).success,
  ).toBe(false);
  const reset = model.documentReducer(
    workspace,
    model.createResetGridCommand({
      canvas: false,
      theme: false,
      defaultTheme: true,
      images: false,
      placements: false,
    }),
  );
  expect(reset.grid.colorTheme).toBe("Ink");
  expect(reset.grid.background).toBe("#17191b");
});

test("preset starters adapt to current layouts and sample previews stay separate from content", () => {
  expect(presets.starterPresets).toHaveLength(24);
  expect(new Set(presets.starterPresets.map((preset) => preset.id)).size).toBe(
    24,
  );
  const draft = model.makeWorkspace();
  draft.assets = [
    {
      id: crypto.randomUUID(),
      title: "Keep me",
      category: "local",
      src: "blob:local",
    },
  ];
  draft.grid.cells[0] = {
    ...draft.grid.cells[0],
    assetId: draft.assets[0].id,
    title: "My caption",
  };
  draft.grid.cells[8] = {
    ...draft.grid.cells[8],
    assetId: draft.assets[0].id,
    title: "Keep in overflow",
    crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
  };
  const original = structuredClone(draft);
  for (const starter of presets.starterPresets) {
    expect(model.editorSettingsSchema.safeParse(starter.settings).success).toBe(
      true,
    );
    const choice = { ...starter, name: starter.nameKey };
    for (const [rows, columns] of [
      [1, 1],
      [2, 5],
      [5, 2],
      [6, 4],
    ]) {
      const current = model.applyEditorSettings(draft, {
        ...model.getEditorSettings(draft),
        layout: { rows, columns },
      });
      const settings = presets.presetSettingsForLayout(
        starter.settings,
        current.grid,
      );
      expect(settings.layout).toEqual({ rows, columns });
      expect(settings.style).toEqual(starter.settings.style);
      const preview = presets.presetPreviewWorkspace(choice, current.grid);
      expect(preview.grid).toMatchObject({ rows, columns });
      expect(preview.grid.cells).toHaveLength(rows * columns);
      expect(
        preview.grid.cells.every((cell) =>
          preview.assets.some((asset) => asset.id === cell.assetId),
        ),
      ).toBe(true);
      expect(
        preview.assets.every((asset) => asset.category === "preset-preview"),
      ).toBe(true);
      const applied = model.applyEditorSettings(current, settings);
      expect(applied.grid).toMatchObject({ rows, columns });
      expect(applied.assets).toEqual(original.assets);
      expect(applied.grid.cells).toEqual(current.grid.cells);
      expect(applied.grid.overflow).toEqual(current.grid.overflow);
      const retained = [
        ...applied.grid.cells,
        ...applied.grid.overflow.map((item) => item.cell),
      ];
      expect(retained).toContainEqual(original.grid.cells[0]);
      if (rows > 2 && columns > 2) {
        expect(retained).toContainEqual(original.grid.cells[8]);
      } else {
        expect(retained).not.toContainEqual(original.grid.cells[8]);
      }
    }
    expect(draft).toEqual(original);
  }
  expect(
    navigation.readNavigation(
      navigation.parseEditorState({}),
      new URL("https://example.com/?panel=design"),
    ).selectedPanel,
  ).toBe(2);
  expect(
    navigation.readNavigation(
      navigation.parseEditorState({}),
      new URL("https://example.com/?panel=themes"),
    ).selectedPanel,
  ).toBe(2);
});

test("preset palettes theme headings, card surfaces and captions with readable colors", () => {
  for (const palette of model.colorPalettes) {
    const style = model.colorPaletteStyle(palette.name);
    expect(style.cardBorderColor, palette.name).toBe(palette.text);
    expect(style.cardBorderVisible, palette.name).toBeUndefined();
    expect(style.cardBorderWidth, palette.name).toBeUndefined();
  }
  const luminance = (color) =>
    [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
      const channel =
        parseInt(color.slice(1 + index * 2, 3 + index * 2), 16) / 255;
      return (
        sum +
        weight *
          (channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4)
      );
    }, 0);
  const contrast = (a, b) =>
    (Math.max(luminance(a), luminance(b)) + 0.05) /
    (Math.min(luminance(a), luminance(b)) + 0.05);
  for (const {
    id,
    settings: { style },
  } of presets.starterPresets) {
    expect(style.headingBackgroundColor, id).toBe(style.background);
    expect(style.cellBackgroundColor, id).toMatch(/^#[0-9a-f]{6}$/);
    expect(
      contrast(style.headingTextColor, style.headingBackgroundColor),
      `${id}: heading`,
    ).toBeGreaterThanOrEqual(4.5);
    const captionBackground =
      style.captionPlacement === "overlay"
        ? style.captionOverlayColor
        : style.cellBackgroundColor;
    expect(
      contrast(style.cellTextColor, captionBackground),
      `${id}: captions`,
    ).toBeGreaterThanOrEqual(4.5);
    if (luminance(style.background) >= 0.5)
      expect(
        luminance(style.cellBackgroundColor),
        `${id}: light cards`,
      ).toBeGreaterThanOrEqual(0.5);
  }
});

test("editor navigation migrates legacy URLs and restores browser-local history", () => {
  const defaults = navigation.parseEditorState({});
  expect(defaults.zoom).toBe(100);
  expect(navigation.parseEditorState({ zoom: 75 }).zoom).toBe(75);
  for (const zoom of [0, 205, 72, "75", null]) {
    const state = navigation.parseEditorState({ selectedPanel: 3, zoom });
    expect(state.zoom).toBe(100);
    expect(state.selectedPanel).toBe(3);
  }
  expect(navigation.parseEditorState({ selectedPanel: 3 }).selectedPanel).toBe(
    3,
  );
  expect(
    navigation.readNavigation(
      defaults,
      new URL("https://example.com/grids/?panel=reset"),
    ).selectedPanel,
  ).toBe(3);
  expect(
    navigation.readNavigation(
      defaults,
      new URL("https://example.com/grids/"),
      true,
      {
        gridsNavigation: { selectedPanel: 3, source: "imported" },
      },
    ).selectedPanel,
  ).toBe(3);
  expect(
    navigation.readNavigation(
      defaults,
      new URL("https://example.com/grids/?panel=design"),
    ).selectedPanel,
  ).toBe(2);
  expect(defaults.browsing["library:commons"]).toEqual(
    navigation.defaultBrowsing(providers.commons),
  );
  expect(defaults.browsing["picker:met"]).toEqual(
    navigation.defaultBrowsing(providers.met),
  );
  expect(navigation.parseEditorState({ librarySource: "invalid" })).toEqual(
    defaults,
  );
  const restored = navigation.readNavigation(
    defaults,
    new URL(
      "https://example.com/grids/?panel=themes&source=commons&q=earth&offset=27&other=keep#anchor",
    ),
  );
  expect(restored).toMatchObject({
    selectedPanel: 2,
    librarySource: "commons",
    browsing: {
      "library:commons": {
        query: "earth",
        selectedTopic: null,
        request: { query: "earth", offset: 27 },
        history: [0],
      },
    },
  });

  const url = navigation.navigationUrl(
    restored,
    new URL(
      "https://example.com/grids/?panel=themes&source=commons&q=earth&topic=all&offset=27&other=keep#anchor",
    ),
  );
  expect([...url.searchParams.keys()]).toEqual(["other"]);
  expect(url.searchParams.get("other")).toBe("keep");
  expect(url.hash).toBe("#anchor");
  const invalid = navigation.readNavigation(
    defaults,
    new URL("https://example.com/?source=met&offset=-1&topic=invalid"),
  );
  expect(invalid.browsing["library:met"].request.offset).toBe(0);
  expect(invalid.browsing["library:met"].selectedTopic).toBe("paintings");
  expect(
    navigation.readNavigation(restored, new URL("https://example.com/"), true),
  ).toEqual(restored);
  const entry = {
    gridsNavigation: {
      selectedPanel: 2,
      source: "commons",
      browsing: { ...restored.browsing["library:commons"], history: [0, 15] },
    },
  };
  expect(
    navigation.readNavigation(defaults, url, false, entry).browsing[
      "library:commons"
    ].history,
  ).toEqual([0, 15]);
  expect(navigation.readNavigation(defaults, url, false, entry)).toMatchObject({
    selectedPanel: 2,
    librarySource: "commons",
    browsing: {
      "library:commons": { query: "earth", request: { offset: 27 } },
    },
  });
  expect(
    navigation.readNavigation(defaults, url, false, {
      gridsNavigation: { ...entry.gridsNavigation, source: "invalid" },
    }).browsing["library:commons"].history,
  ).toEqual([]);
  const combined = navigation.readNavigation(
    defaults,
    new URL(
      "https://example.com/?source=commons&topic=places&q=bridge&offset=27",
    ),
  );
  expect(combined.browsing["library:commons"]).toMatchObject({
    query: "bridge",
    selectedTopic: "places",
    request: { query: "bridge", topic: "places", offset: 27 },
  });
  const combinedUrl = navigation.navigationUrl(
    combined,
    new URL("https://example.com/"),
  );
  expect(combinedUrl.search).toBe("");
  const all = navigation.readNavigation(
    defaults,
    new URL("https://example.com/?source=met&topic=all"),
  );
  expect(all.browsing["library:met"]).toMatchObject({
    query: "",
    selectedTopic: null,
    request: { query: "", topic: null, offset: 0 },
  });
  expect(
    navigation
      .navigationUrl(all, new URL("https://example.com/"))
      .searchParams.get("topic"),
  ).toBeNull();
});

test("text alignment and card padding validate roundtrip and reset", () => {
  const workspace = model.makeWorkspace();
  const settings = model.getEditorSettings(workspace);
  const customized = {
    ...settings,
    style: {
      ...settings.style,
      headingTextAlignment: "left",
      cellTextAlignment: "right",
      cellPadding: 48,
    },
  };
  const applied = model.applyEditorSettings(workspace, customized);
  expect(model.getEditorSettings(applied)).toEqual(customized);
  expect(model.captionPadding(600, applied.grid.cellPadding)).toEqual({
    horizontal: 48,
    vertical: 40,
  });
  const reset = model.applyEditorSettings(applied, settings);
  expect(reset.grid.headingTextAlignment).toBeUndefined();
  expect(reset.grid.cellTextAlignment).toBeUndefined();
  expect(reset.grid.cellPadding).toBeUndefined();
  for (const patch of [
    { headingTextAlignment: "middle" },
    { cellTextAlignment: "top" },
    { cellPadding: -1 },
    { cellPadding: 121 },
    { cellPadding: Infinity },
  ]) {
    expect(
      model.editorSettingsSchema.safeParse({
        ...settings,
        style: { ...settings.style, ...patch },
      }).success,
    ).toBe(false);
  }
});

test("card borders validate, roundtrip, disable without clearing values and reset", () => {
  const workspace = model.makeWorkspace();
  const settings = model.getEditorSettings(workspace);
  const customized = {
    ...settings,
    style: {
      ...settings.style,
      cardBorderVisible: true,
      cardBorderColor: "#e34567",
      cardBorderWidth: 3,
    },
  };
  const applied = model.applyEditorSettings(workspace, customized);
  expect(model.getEditorSettings(applied)).toEqual(customized);
  expect(model.cellGeometry(applied.grid, 600)).toEqual(
    model.cellGeometry(workspace.grid, 600),
  );
  const disabled = model.applyEditorSettings(applied, {
    ...customized,
    style: { ...customized.style, cardBorderVisible: false },
  });
  expect(disabled.grid).toMatchObject({
    cardBorderVisible: false,
    cardBorderColor: "#e34567",
    cardBorderWidth: 3,
  });
  const reset = model.applyEditorSettings(applied, settings);
  expect(reset.grid.cardBorderVisible).toBeUndefined();
  expect(reset.grid.cardBorderColor).toBeUndefined();
  expect(reset.grid.cardBorderWidth).toBeUndefined();
  for (const patch of [
    { cardBorderWidth: -1 },
    { cardBorderWidth: 6 },
    { cardBorderWidth: Infinity },
    { cardBorderColor: "red" },
    { cardBorderVisible: "yes" },
  ]) {
    expect(
      model.editorSettingsSchema.safeParse({
        ...customized,
        style: { ...customized.style, ...patch },
      }).success,
    ).toBe(false);
  }
});

test("browser navigation stores no selected theme or per-theme customizations", () => {
  const original = presets.starterPresets[0].settings;
  const customized = model.editorSettingsSchema.parse({
    ...original,
    style: { ...original.style, background: "#123456" },
  });
  const state = navigation.parseEditorState({
    presetCustomizations: { "starter:gallery": customized },
  });
  expect(state).not.toHaveProperty("presetCustomizations");
  expect(
    navigation.parseEditorState({
      appliedPreset: { id: "starter:gallery", settings: original },
    }),
  ).not.toHaveProperty("appliedPreset");
  expect(navigation.parseEditorState({ selectedPanel: 1 }).selectedPanel).toBe(
    0,
  );
  expect(
    presets.samePresetSettings(customized, {
      ...customized,
      layout: { rows: 1, columns: 8 },
    }),
  ).toBe(true);
  expect(presets.samePresetSettings(original, customized)).toBe(false);
  expect(
    presets.samePresetSettings(customized, {
      ...customized,
      exportSettings: {
        ...customized.exportSettings,
        resolution: customized.exportSettings.resolution + 1,
      },
    }),
  ).toBe(false);
});

test("provider topic scopes reach every batch and use separate page cache entries", async () => {
  const calls = [];
  const provider = providers.cacheImageProvider(
    providers.fillImagePages({
      ...providers.commons,
      async search(query, signal, offset, limit, topic) {
        calls.push({ query, offset, topic });
        return { images: [], ...(offset === 0 ? { next: 7 } : {}) };
      },
    }),
  );
  const signal = new AbortController().signal;
  await provider.search("scoped", signal, 0, "places");
  await provider.search("scoped", signal, 0, "places");
  await provider.search("scoped", signal, 0, "nature");
  await provider.search("scoped", signal);
  expect(calls).toEqual(
    ["places", "nature", null].flatMap((topic) => [
      { query: "scoped", offset: 0, topic },
      { query: "scoped", offset: 7, topic },
    ]),
  );
});

test("provider progress streams shared results without caching partial pages or leaking consumer edits", async () => {
  let calls = 0;
  let report;
  let release;
  const images = [
    { id: "first", title: "First" },
    { id: "second", title: "Second" },
  ];
  const provider = providers.cacheImageProvider(
    providers.fillImagePages({
      ...providers.commons,
      async search(_query, _signal, _offset, _limit, _topic, onImages) {
        calls++;
        report = onImages;
        onImages(images.slice(0, 1));
        await new Promise((resolve) => {
          release = resolve;
        });
        return { images };
      },
    }),
  );
  const controller = new AbortController();
  const firstUpdates = [];
  const first = provider.search(
    "progressive shared results",
    controller.signal,
    0,
    null,
    2,
    (ready) => firstUpdates.push(ready),
  );
  const cancelled = first.catch((error) => error);
  await expect.poll(() => firstUpdates.length).toBe(1);
  firstUpdates[0][0].title = "Edited locally";
  const secondUpdates = [];
  let settled = false;
  const second = provider
    .search(
      "progressive shared results",
      new AbortController().signal,
      0,
      null,
      2,
      (ready) => secondUpdates.push(ready),
    )
    .then((result) => {
      settled = true;
      return result;
    });
  expect(secondUpdates).toEqual([[images[0]]]);
  controller.abort(new Error("cancelled"));
  expect((await cancelled).message).toBe("cancelled");
  report(images);
  expect(firstUpdates).toHaveLength(1);
  expect(secondUpdates.at(-1)).toEqual(images);
  expect(settled).toBe(false);
  secondUpdates.at(-1)[0].title = "Another local edit";
  release();
  expect((await second).images).toEqual(images);
  expect(
    (
      await provider.search(
        "progressive shared results",
        new AbortController().signal,
        0,
        null,
        2,
      )
    ).images,
  ).toEqual(images);
  expect(calls).toBe(1);
});

test.describe("provider query cache", () => {
  test.afterEach(() => cache.providerQueryClient.clear());

  test("reuses fresh metadata and isolates consumer edits", async () => {
    let calls = 0;
    const load = async () => {
      calls++;
      return { images: [{ title: "Original" }], next: 12 };
    };
    const first = await cache.providerQuery(
      ["page", "commons", "earth", 0],
      load,
      new AbortController().signal,
    );
    first.images[0].title = "Edited locally";
    const second = await cache.providerQuery(
      ["page", "commons", "earth", 0],
      load,
      new AbortController().signal,
    );
    expect(second).toEqual({ images: [{ title: "Original" }], next: 12 });
    expect(calls).toBe(1);
    await cache.providerQuery(
      ["page", "commons", "earth", 12],
      load,
      new AbortController().signal,
    );
    await cache.providerQuery(
      ["page", "met", "earth", 0],
      load,
      new AbortController().signal,
    );
    expect(calls).toBe(3);
  });

  test("deduplicates requests without letting one consumer cancel another", async () => {
    let calls = 0;
    let complete;
    let sharedSignal;
    const load = (signal) => {
      calls++;
      sharedSignal = signal;
      return new Promise((resolve) => {
        complete = resolve;
      });
    };
    const first = new AbortController();
    const cancelled = cache.providerQuery(["shared"], load, first.signal);
    const cancellation = expect(cancelled).rejects.toMatchObject({
      name: "AbortError",
    });
    const surviving = cache.providerQuery(
      ["shared"],
      load,
      new AbortController().signal,
    );
    first.abort();
    await cancellation;
    expect(sharedSignal.aborted).toBe(false);
    complete({ id: 1 });
    expect(await surviving).toEqual({ id: 1 });
    expect(calls).toBe(1);
  });

  test("cancels the underlying request when its last consumer leaves", async () => {
    let sharedSignal;
    const controller = new AbortController();
    const pending = cache.providerQuery(
      ["cancelled"],
      (signal) => {
        sharedSignal = signal;
        return new Promise(() => {});
      },
      controller.signal,
    );
    const cancellation = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await cancellation;
    expect(sharedSignal.aborted).toBe(true);
    expect(
      cache.providerQueryClient.getQueryData(["cancelled"]),
    ).toBeUndefined();
    expect(
      await cache.providerQuery(
        ["cancelled"],
        async () => "replacement",
        new AbortController().signal,
      ),
    ).toBe("replacement");
  });

  test("does not retry or retain failures as usable cache results", async () => {
    let calls = 0;
    const load = async () => {
      calls++;
      throw new Error("Unavailable");
    };
    await expect(
      cache.providerQuery(["failure"], load, new AbortController().signal),
    ).rejects.toThrow("Unavailable");
    expect(calls).toBe(1);
    expect(cache.providerQueryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(
      await cache.providerQuery(
        ["failure"],
        async () => "recovered",
        new AbortController().signal,
      ),
    ).toBe("recovered");
  });

  test("refreshes expired metadata but not fresh cached results", async () => {
    const key = ["expiry"];
    const now = Date.now();
    let calls = 0;
    const load = async () => {
      calls++;
      return "fresh";
    };
    cache.providerQueryClient.setQueryData(key, "cached", {
      updatedAt: now - cache.providerFreshTime + 60000,
    });
    expect(
      await cache.providerQuery(key, load, new AbortController().signal),
    ).toBe("cached");
    expect(calls).toBe(0);
    cache.providerQueryClient.setQueryData(key, "expired", {
      updatedAt: now - cache.providerFreshTime - 1000,
    });
    expect(
      await cache.providerQuery(key, load, new AbortController().signal),
    ).toBe("fresh");
    expect(calls).toBe(1);
  });

  test("bounds inactive metadata entries and configures two-hour retention", async () => {
    expect(cache.providerCacheLimit).toBe(500);
    expect(cache.providerQueryClient.getDefaultOptions().queries).toMatchObject(
      {
        staleTime: 3600000,
        gcTime: 7200000,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    );
    for (let index = 0; index < cache.providerCacheLimit + 5; index++)
      await cache.providerQuery(
        ["bounded", index],
        async () => index,
        new AbortController().signal,
      );
    expect(cache.providerQueryClient.getQueryCache().getAll()).toHaveLength(
      cache.providerCacheLimit,
    );
    expect(
      cache.providerQueryClient.getQueryData(["bounded", 0]),
    ).toBeUndefined();
    expect(
      cache.providerQueryClient.getQueryData([
        "bounded",
        cache.providerCacheLimit + 4,
      ]),
    ).toBe(cache.providerCacheLimit + 4);
  });
});

test("provider page cache does not mark deadline-truncated pages fresh", async () => {
  let calls = 0;
  const provider = providers.cacheImageProvider({
    ...providers.commons,
    search: async () => {
      calls++;
      return calls === 1
        ? { images: [{ id: "first" }], next: 12, incomplete: true }
        : { images: [{ id: "complete" }] };
    },
  });
  expect(
    (await provider.search("partial cache", new AbortController().signal))
      .incomplete,
  ).toBe(true);
  expect(
    (await provider.search("partial cache", new AbortController().signal))
      .images[0].id,
  ).toBe("complete");
  await provider.search("partial cache", new AbortController().signal);
  expect(calls).toBe(2);
});

test("provider page cache keys use the actual trimmed and bounded search text", async () => {
  let calls = 0;
  const provider = providers.cacheImageProvider({
    ...providers.commons,
    search: async (query) => {
      calls++;
      expect(query).toBe("trimmed cache");
      return { images: [] };
    },
  });
  await provider.search("  trimmed cache  ", new AbortController().signal);
  await provider.search("trimmed cache", new AbortController().signal);
  expect(calls).toBe(1);
});

test("provider previews choose bounded cover renditions for every shape and density", () => {
  const image = {
    provider: "commons",
    thumbnail:
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Wide.jpg/330px-Wide.jpg?source=api",
    original: {
      url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Wide.jpg",
      width: 6000,
      height: 3000,
    },
  };
  for (const original of [
    image.original,
    { ...image.original, width: 3000, height: 6000 },
    { ...image.original, width: 6000, height: 6000 },
  ]) {
    for (const cardWidth of [128, 160, 200]) {
      for (const density of [1, 2, 3]) {
        const url = new URL(
          providers.providerPreviewUrl(
            { ...image, original },
            cardWidth,
            density,
          ),
        );
        const width = Number(url.pathname.match(/\/(\d+)px-/)[1]);
        for (const aspect of [3 / 4, 1, 4 / 3]) {
          expect(width).toBeGreaterThanOrEqual(cardWidth * density);
          expect(
            (width * original.height) / original.width,
          ).toBeGreaterThanOrEqual((cardWidth / aspect) * density);
        }
        const buckets = [120, 250, 330, 500, 960, 1280, 1920, 3840];
        const previous = buckets[buckets.indexOf(width) - 1];
        if (previous)
          expect(previous).toBeLessThan(
            Math.max(
              cardWidth * density,
              ((cardWidth / (3 / 4)) * density * original.width) /
                original.height,
            ),
          );
        expect(url.searchParams.get("source")).toBe("api");
      }
    }
  }
  expect(providers.providerPreviewUrl(image, 320)).toContain("/960px-");
  expect(providers.providerPreviewUrl(image, 320)).toBe(
    providers.providerPreviewUrl(image, 200),
  );
  expect(providers.providerPreviewUrl(image, 160)).toContain("/500px-");
  expect(
    providers.providerPreviewUrl(
      { ...image, original: { ...image.original, width: 100, height: 50 } },
      320,
    ),
  ).toBe(image.original.url);
  expect(
    providers.providerPreviewUrl({ ...image, provider: "met" }, 320, 2),
  ).toBe(image.thumbnail);
  expect(
    providers.providerPreviewUrl({ ...image, provider: "met" }, 320, 1, {
      width: 480,
      height: 640,
    }),
  ).toBe(image.thumbnail);
  expect(
    providers.providerPreviewUrl({ ...image, provider: "met" }, 320, 2, {
      width: 240,
      height: 320,
    }),
  ).toBe(image.original.url);
  expect(
    providers.providerPreviewUrl({ ...image, provider: "met" }, 320, 1, {
      width: 1000,
      height: 200,
    }),
  ).toBe(image.original.url);
  expect(
    providers.providerPreviewUrl(
      { ...image, thumbnail: "https://example.com/330px-Wide.jpg" },
      160,
    ),
  ).toBe("https://example.com/330px-Wide.jpg");
});

test("provider pages fill twelve unique eligible images without skipping overflow", async () => {
  const requests = [];
  const image = (id) => ({ id: String(id) });
  const batches = {
    0: { images: [image(1), image(2)], next: 12 },
    12: { images: [image(2), image(3), image(4)], next: 22 },
    22: {
      images: Array.from({ length: 8 }, (_, index) => image(index + 5)),
      next: 30,
    },
    30: { images: [image(13)] },
  };
  const provider = providers.fillImagePages({
    ...providers.commons,
    search: async (_query, _signal, offset, limit) => {
      requests.push({ offset, limit });
      return batches[offset];
    },
  });
  const page = await provider.search("query", new AbortController().signal);
  expect(page.images.map((image) => image.id)).toEqual(
    Array.from({ length: 12 }, (_, index) => String(index + 1)),
  );
  expect(requests).toEqual([
    { offset: 0, limit: 12 },
    { offset: 12, limit: 10 },
    { offset: 22, limit: 8 },
  ]);
  expect(page.next).toBe(30);
  expect(
    await provider.search("query", new AbortController().signal, page.next),
  ).toEqual({ images: [image(13)], next: undefined });
});

test("provider pages cache picker sizes separately and preserve every result across cursors", async () => {
  const requests = [];
  const catalog = Array.from({ length: 24 }, (_, index) => ({
    id: String(index),
  }));
  const provider = providers.cacheImageProvider(
    providers.fillImagePages({
      ...providers.commons,
      async search(_query, _signal, offset, limit) {
        requests.push({ offset, limit });
        const next = offset + limit;
        return {
          images: catalog.slice(offset, next),
          next: next < catalog.length ? next : undefined,
        };
      },
    }),
  );
  const signal = new AbortController().signal;
  const first = await provider.search("picker sizing", signal, 0, null, 10);
  expect(first.images).toEqual(catalog.slice(0, 10));
  expect(first.next).toBe(10);
  expect((await provider.search("picker sizing", signal)).images).toEqual(
    catalog.slice(0, 12),
  );
  expect(
    (await provider.search("picker sizing", signal, 0, null, 10)).images,
  ).toEqual(first.images);
  expect(requests).toEqual([
    { offset: 0, limit: 10 },
    { offset: 0, limit: 12 },
  ]);
  const second = await provider.search(
    "picker sizing",
    signal,
    first.next,
    null,
    10,
  );
  expect([...first.images, ...second.images]).toEqual(catalog.slice(0, 20));
  expect(requests.at(-1)).toEqual({ offset: 10, limit: 10 });
  for (const pageSize of [0, -1, 1.5, 13])
    await expect(
      provider.search("invalid size", signal, 0, null, pageSize),
    ).rejects.toMatchObject({ kind: "invalid" });
});

test("provider pages follow empty eligible batches and stop at API exhaustion", async () => {
  const requests = [];
  const provider = providers.fillImagePages({
    ...providers.commons,
    search: async (_query, _signal, offset) => {
      requests.push(offset);
      return offset === 0
        ? { images: [], next: 12 }
        : { images: [{ id: "last" }] };
    },
  });
  expect(await provider.search("query", new AbortController().signal)).toEqual({
    images: [{ id: "last" }],
    next: undefined,
  });
  expect(requests).toEqual([0, 12]);
  const empty = providers.fillImagePages({
    ...providers.commons,
    search: async () => ({ images: [] }),
  });
  expect(await empty.search("query", new AbortController().signal)).toEqual({
    images: [],
    next: undefined,
  });
});

test("provider pages bound replacement batches and reject looping cursors", async () => {
  const requests = [];
  const provider = providers.fillImagePages({
    ...providers.commons,
    search: async (_query, _signal, offset) => {
      requests.push(offset);
      return { images: [{ id: String(offset) }], next: offset + 12 };
    },
  });
  const page = await provider.search("query", new AbortController().signal);
  expect(page.images).toHaveLength(5);
  expect(page.next).toBe(60);
  expect(page.incomplete).toBe(true);
  expect(requests).toEqual([0, 12, 24, 36, 48]);
  for (const next of [0, -12, NaN, 1.5]) {
    const looping = providers.fillImagePages({
      ...providers.commons,
      search: async () => ({ images: [], next }),
    });
    expect(await looping.search("query", new AbortController().signal)).toEqual(
      { images: [], next: undefined },
    );
  }
});

test("provider page cache refreshes batch-capped short pages instead of retaining them for an hour", async () => {
  let recovered = false;
  let calls = 0;
  const provider = providers.cacheImageProvider(
    providers.fillImagePages({
      ...providers.commons,
      search: async (_query, _signal, offset) => {
        calls++;
        return recovered
          ? {
              images: Array.from({ length: 12 }, (_, index) => ({
                id: String(index),
              })),
            }
          : { images: [{ id: String(offset) }], next: offset + 12 };
      },
    }),
  );
  const signal = new AbortController().signal;
  const short = await provider.search("batch-limit cache", signal);
  expect(short.images).toHaveLength(5);
  expect(short.incomplete).toBe(true);
  expect(calls).toBe(5);
  recovered = true;
  const full = await provider.search("batch-limit cache", signal);
  expect(full.images).toHaveLength(12);
  expect(full.incomplete).toBeUndefined();
  expect(calls).toBe(6);
  await provider.search("batch-limit cache", signal);
  expect(calls).toBe(6);
});

test("provider pages preserve completed results and cursor at the shared deadline", async () => {
  const deadline = new AbortController();
  const timeout = AbortSignal.timeout;
  AbortSignal.timeout = () => deadline.signal;
  try {
    const provider = providers.fillImagePages({
      ...providers.commons,
      search: async (_query, signal, offset) => {
        if (offset === 0) return { images: [{ id: "first" }], next: 12 };
        deadline.abort(new DOMException("Deadline", "TimeoutError"));
        signal.throwIfAborted();
      },
    });
    expect(
      await provider.search("query", new AbortController().signal),
    ).toEqual({ images: [{ id: "first" }], next: 12, incomplete: true });
    const empty = providers.fillImagePages({
      ...providers.commons,
      search: async (_query, signal) => {
        signal.throwIfAborted();
        return { images: [] };
      },
    });
    await expect(
      empty.search("query", new AbortController().signal),
    ).rejects.toMatchObject({ kind: "timeout" });
  } finally {
    AbortSignal.timeout = timeout;
  }
});

test("provider pages discard cancelled work and propagate replacement service failures", async () => {
  const controller = new AbortController();
  const cancelled = providers.fillImagePages({
    ...providers.commons,
    search: async () => {
      controller.abort();
      return { images: [{ id: "stale" }], next: 12 };
    },
  });
  await expect(
    cancelled.search("query", controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  const failed = providers.fillImagePages({
    ...providers.commons,
    search: async (_query, _signal, offset) => {
      if (offset === 0) return { images: [{ id: "first" }], next: 12 };
      throw new providers.ProviderError("quota", 1000);
    },
  });
  await expect(
    failed.search("query", new AbortController().signal),
  ).rejects.toMatchObject({ kind: "quota" });
});

test("provider provenance validates safe source URLs and stays out of settings", () => {
  const workspace = model.makeWorkspace();
  const provenance = {
    provider: "commons",
    entityId: "123",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Earth.jpg",
    originalUrl:
      "https://upload.wikimedia.org/wikipedia/commons/test/Earth.jpg",
    creator: "Creator",
    license: "Public domain",
    licenseUrl: "https://commons.wikimedia.org/wiki/Commons:Public_domain",
  };
  for (const [provider, sourcePage, originalUrl] of [
    [
      "met",
      "https://www.metmuseum.org/art/collection/search/1",
      "https://images.metmuseum.org/CRDImages/ep/original/1.jpg",
    ],
  ]) {
    const candidate = {
      ...provenance,
      provider,
      sourcePage,
      originalUrl,
      license: "CC0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    };
    expect(model.provenanceSchema.safeParse(candidate).success).toBe(true);
    expect(
      model.provenanceSchema.safeParse({ ...candidate, provider: "commons" })
        .success,
    ).toBe(false);
    expect(
      model.provenanceSchema.safeParse({
        ...candidate,
        originalUrl: originalUrl.replace("https://", "https://user:pass@"),
      }).success,
    ).toBe(false);
  }
  workspace.assets.push({
    id: crypto.randomUUID(),
    title: "Earth",
    category: "Imported",
    src: "blob:local",
    provenance,
  });
  expect(model.workspaceSchema.safeParse(workspace).success).toBe(true);
  expect(JSON.stringify(model.getEditorSettings(workspace))).not.toContain(
    "provenance",
  );
  expect(JSON.stringify(model.getEditorSettings(workspace))).not.toContain(
    "wikimedia",
  );
  for (const patch of [
    { sourcePage: "javascript:alert(1)" },
    { sourcePage: "not-a-url" },
    { originalUrl: "not-a-url" },
    { licenseUrl: "not-a-url" },
    { originalUrl: "https://example.com/image.jpg" },
    { license: "CC BY-SA 4.0" },
    { provider: "unsupported" },
    { entityId: "../private" },
  ])
    expect(
      model.provenanceSchema.safeParse({ ...provenance, ...patch }).success,
    ).toBe(false);
});

test("removing legacy credited images preserves other images, captions, crops and settings", () => {
  const workspace = model.makeWorkspace();
  const asset = {
    id: crypto.randomUUID(),
    title: "Original image",
    category: "Imported",
    src: "https://live.staticflickr.com/1/photo.jpg",
    provenance: {
      provider: "openverse",
      entityId: crypto.randomUUID(),
      title: "Original image",
      creator: "Example photographer",
      sourcePage: "https://www.flickr.com/photos/example/123",
      originalUrl: "https://live.staticflickr.com/1/photo.jpg",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    },
  };
  const local = {
    id: crypto.randomUUID(),
    title: "Local",
    category: "Imported",
    src: "blob:local",
  };
  const publicDomain = {
    ...asset,
    id: crypto.randomUUID(),
    provenance: {
      ...asset.provenance,
      license: "CC0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    },
  };
  workspace.assets = [asset, local, publicDomain];
  workspace.grid.cells[0] = {
    ...workspace.grid.cells[0],
    assetId: asset.id,
    title: "Credit",
    crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
  };
  workspace.grid.cells[1] = {
    ...workspace.grid.cells[1],
    assetId: local.id,
    title: "Keep caption",
    crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
  };
  workspace.grid.cells[2].assetId = publicDomain.id;
  workspace.grid.overflow = [
    {
      row: 3,
      column: 0,
      cell: { ...workspace.grid.cells[0], id: crypto.randomUUID() },
    },
  ];
  workspace.grid.gap = 42;
  const clean = model.removeCreditRequiredImages(workspace);
  expect(clean.assets).toEqual([local, publicDomain]);
  expect(clean.grid.cells[0]).toMatchObject({
    assetId: null,
    title: "",
    crop: undefined,
  });
  expect(clean.grid.overflow[0].cell).toMatchObject({
    assetId: null,
    title: "",
    crop: undefined,
  });
  expect(clean.grid.cells[1]).toEqual(workspace.grid.cells[1]);
  expect(clean.grid.cells[2]).toEqual(workspace.grid.cells[2]);
  expect(model.getEditorSettings(clean)).toEqual(
    model.getEditorSettings(workspace),
  );
  expect(model.removeCreditRequiredImages(clean)).toBe(clean);
  expect(model.workspaceSchema.safeParse(clean).success).toBe(true);
  expect(workspace.assets).toHaveLength(3);
  for (const license of [
    "CC BY 1.0",
    "CC BY 2.0",
    "CC BY 2.5",
    "CC BY 3.0",
    "CC BY 4.0",
    "CC BY-SA 4.0",
  ])
    expect(model.imageLicenseSchema.safeParse(license).success).toBe(false);
});

test("keyless catalog cursors retain filtered rows across differently sized pages", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    requests.push(url);
    const offset = Number(url.searchParams.get("offset"));
    return Response.json({
      found: 24,
      items: Array.from({ length: 12 }, (_, index) => {
        const id = offset + index;
        return {
          object_number: `KKS${id}`,
          frontend_url: `https://open.smk.dk/artwork/image/KKS${id}`,
          titles: [{ title: `Artwork ${id}` }],
          artist: ["Artist"],
          public_domain: true,
          rights:
            id === 0
              ? "Restricted"
              : "https://creativecommons.org/publicdomain/mark/1.0/",
          image_iiif_id: `https://iip.smk.dk/iiif/jp2/${id}.jp2`,
          image_width: 8000,
          image_height: 4000,
        };
      }),
    });
  };
  try {
    const query = crypto.randomUUID();
    const first = await providers.smk.search(
      query,
      new AbortController().signal,
      0,
      null,
      2,
    );
    expect(first.images.map((image) => image.id)).toEqual(["KKS1", "KKS2"]);
    expect(first.next).toBe(3);
    const second = await providers.smk.search(
      query,
      new AbortController().signal,
      first.next,
      null,
      10,
    );
    expect(second.images.map((image) => image.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `KKS${index + 3}`),
    );
    expect(second.next).toBe(13);
    expect(requests.map((url) => url.searchParams.get("rows"))).toEqual([
      "12",
      "12",
      "12",
    ]);
    expect(requests.map((url) => url.searchParams.get("offset"))).toEqual([
      "0",
      "0",
      "12",
    ]);
    expect(first.images[0].original).toMatchObject({
      width: 4000,
      height: 2000,
      mime: "image/jpeg",
    });
    expect(first.images[0].original.url).toContain("/full/!4000,4000/");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keyless nature searches combine topics and text and require photo-level CC0 rights", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const photo = {
    id: 123,
    url: "https://inaturalist-open-data.s3.amazonaws.com/photos/123/square.jpg",
    license_code: "cc0",
    attribution: "Photographer",
    original_dimensions: { width: 800, height: 600 },
  };
  globalThis.fetch = async (input) => {
    requests.push(new URL(input));
    return Response.json({
      total_results: 3,
      results: [
        { license_code: "cc0", photos: [{ ...photo, license_code: "cc-by" }] },
        { photos: [{ ...photo, url: "https://evil.example/square.jpg" }] },
        { taxon: { name: "Erithacus rubecula" }, photos: [photo] },
      ],
    });
  };
  try {
    const query = crypto.randomUUID();
    const result = await providers.inaturalist.search(
      query,
      new AbortController().signal,
      0,
      "birds",
    );
    expect(result.images.map((image) => image.id)).toEqual(["123"]);
    expect(requests[0].searchParams.get("taxon_name")).toBe(query);
    expect(requests[0].searchParams.get("taxon_id")).toBe("3");
    await providers.inaturalist.search(
      crypto.randomUUID(),
      new AbortController().signal,
      0,
      null,
    );
    expect(requests[1].searchParams.has("taxon_id")).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keyless catalogs reject unsafe rights and hosts and expose quota and malformed responses", async () => {
  const originalFetch = globalThis.fetch;
  const originalParser = globalThis.DOMParser;
  globalThis.DOMParser = class {
    parseFromString(value) {
      return { body: { textContent: value } };
    }
  };
  const id = crypto.randomUUID();
  const image = {
    id,
    title: "Photo",
    creator: "Photographer",
    url: "https://live.staticflickr.com/1/photo.jpg",
    foreign_landing_url: "https://www.flickr.com/photos/example/123",
    license: "cc0",
    license_version: "1.0",
    license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
    width: 800,
    height: 600,
    filesize: null,
    mature: false,
  };
  try {
    globalThis.fetch = async () =>
      Response.json({
        result_count: 5,
        page_count: 1,
        results: [
          { ...image, id: crypto.randomUUID(), license: "by-sa" },
          {
            ...image,
            id: crypto.randomUUID(),
            license: "by",
            license_version: "4.0",
          },
          {
            ...image,
            id: crypto.randomUUID(),
            url: "https://evil.example/photo.jpg",
          },
          {
            ...image,
            id: crypto.randomUUID(),
            foreign_landing_url: "https://localhost/private",
          },
          image,
        ],
      });
    const result = await providers.openverse.search(
      crypto.randomUUID(),
      new AbortController().signal,
    );
    expect(result.images.map((item) => item.id)).toEqual([id]);
    expect(result.images[0].license).toBe("CC0");
    globalThis.fetch = async () => {
      throw new Error("Unsupported downloads must not reach the network.");
    };
    await expect(
      providers.downloadProviderImage(
        {
          ...result.images[0],
          license: "CC BY 4.0",
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "invalid" });
    globalThis.fetch = async () =>
      new Response("{}", { status: 429, headers: { "Retry-After": "2" } });
    await expect(
      providers.openverse.search(
        crypto.randomUUID(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "quota", retryAfter: 2000 });
    globalThis.fetch = async () => new Response("not JSON");
    await expect(
      providers.smk.search(crypto.randomUUID(), new AbortController().signal),
    ).rejects.toMatchObject({ kind: "invalid" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      providers.inaturalist.search("bird", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.DOMParser = originalParser;
  }
});

test("Wellcome requires image-level public-domain rights and open access before resolving IIIF images", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const location = {
    url: "https://iiif.wellcomecollection.org/image/V1/info.json",
    locationType: { id: "iiif-image" },
    license: {
      id: "pdm",
      url: "https://creativecommons.org/share-your-work/public-domain/pdm/",
    },
    accessConditions: [{ status: { id: "open" } }],
  };
  const work = (id, value) => ({
    id,
    title: "Flowers",
    items: [{ locations: [{ locationType: { id: "closed-stores" } }, value] }],
  });
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    requests.push(url);
    if (url.hostname === "api.wellcomecollection.org")
      return Response.json({
        totalResults: 7,
        results: [
          work("abcd1234", location),
          {
            ...work("bbbb1234", {
              ...location,
              license: {
                id: "cc-by",
                url: "https://creativecommons.org/licenses/by/4.0/",
              },
            }),
            thumbnail: { license: { id: "cc-0" } },
          },
          work("cccc1234", {
            ...location,
            url: "https://evil.example/image/info.json",
          }),
          work("dddd1234", { ...location, license: undefined }),
          work("eeee1234", {
            ...location,
            accessConditions: [{ status: { id: "closed" } }],
          }),
          work("ffff1234", {
            ...location,
            license: { ...location.license, id: "cc-0" },
          }),
          work("abcd5678", {
            ...location,
            url: "https://iiif.wellcomecollection.org/image/V2/info.json",
            license: {
              id: "cc-0",
              url: "https://creativecommons.org/publicdomain/zero/1.0/",
            },
          }),
        ],
      });
    expect(url.hostname).toBe("iiif.wellcomecollection.org");
    expect(["/image/V1/info.json", "/image/V2/info.json"]).toContain(
      url.pathname,
    );
    return Response.json({
      "@id": url.href.replace("/info.json", ""),
      width: 8000,
      height: 4000,
      ...(url.pathname.includes("/V2/")
        ? {
            profile: [
              "http://iiif.io/api/image/2/level2.json",
              { maxWidth: 1000, maxArea: 500000 },
            ],
          }
        : {}),
    });
  };
  try {
    const query = crypto.randomUUID();
    const first = await providers.wellcome.search(
      query,
      new AbortController().signal,
      0,
      null,
      1,
    );
    expect(first.images.map(({ id }) => id)).toEqual(["abcd1234"]);
    expect(first.next).toBe(1);
    expect(first.images[0]).toMatchObject({
      license: "Public domain",
      licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
      sourcePage: "https://wellcomecollection.org/works/abcd1234",
      original: { width: 4000, height: 2000, mime: "image/jpeg" },
    });
    const second = await providers.wellcome.search(
      query,
      new AbortController().signal,
      first.next,
    );
    expect(second.images.map(({ id }) => id)).toEqual(["abcd5678"]);
    expect(second.images[0].license).toBe("CC0");
    expect(second.images[0].original).toMatchObject({
      width: 1000,
      height: 500,
    });
    expect(second.next).toBeUndefined();
    expect(requests[0].searchParams.get("items.locations.license")).toBe(
      "pdm,cc-0",
    );
    expect(requests[0].searchParams.get("include")).toBe("items,contributors");
    expect(requests.every((url) => !url.searchParams.has("api_key"))).toBe(
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Rijksmuseum resolves image rights and opaque search tokens without skipping raw cursor positions", async () => {
  const originalFetch = globalThis.fetch;
  const searches = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/search/collection") {
      searches.push(url);
      const second = url.searchParams.has("pageToken");
      if (second) expect(url.searchParams.get("pageToken")).toBe("opaque-next");
      return Response.json({
        partOf: { totalItems: 113 },
        orderedItems: Array.from({ length: second ? 13 : 100 }, (_, index) => ({
          id: `https://id.rijksmuseum.nl/${index + (second ? 101 : 1)}`,
        })),
        ...(second
          ? {}
          : {
              next: {
                id: "https://data.rijksmuseum.nl/search/collection?pageToken=opaque-next",
              },
            }),
      });
    }
    if (url.hostname === "iiif.micr.io")
      return Response.json({
        id: url.href.replace("/info.json", ""),
        width: 8000,
        height: 4000,
      });
    expect(url.hostname).toBe("data.rijksmuseum.nl");
    const id = url.pathname.slice(1);
    return Response.json({
      id: `https://id.rijksmuseum.nl/${id}`,
      identified_by: [{ type: "Name", content: `Artwork ${id}` }],
      produced_by: {
        carried_out_by: [
          { identified_by: [{ type: "Name", content: "Painter" }] },
        ],
      },
      subject_of: [
        {
          digitally_carried_by: [
            {
              access_point: [
                {
                  id: `https://iiif.micr.io/image${id}/full/max/0/default.jpg`,
                },
              ],
              referred_to_by: [
                {
                  classified_as: [
                    { id: "https://vocab.getty.edu/aat/300460240" },
                  ],
                  content:
                    id === "1"
                      ? "https://creativecommons.org/licenses/by/4.0/"
                      : "https://creativecommons.org/publicdomain/mark/1.0/",
                },
              ],
            },
          ],
          subject_to: [
            {
              classified_as: [
                { id: "https://creativecommons.org/publicdomain/zero/1.0/" },
              ],
            },
          ],
        },
      ],
    });
  };
  try {
    const query = crypto.randomUUID();
    const first = await providers.rijksmuseum.search(
      query,
      new AbortController().signal,
      0,
      null,
      2,
    );
    expect(first.images.map(({ id }) => id)).toEqual(["2", "3"]);
    expect(first.next).toBe(3);
    expect(first.images[0]).toMatchObject({
      creator: "Painter",
      license: "Public domain",
      original: { width: 4000, height: 2000 },
    });
    const second = await providers.rijksmuseum.search(
      query,
      new AbortController().signal,
      first.next,
    );
    expect(second.images.map(({ id }) => id)).toEqual(
      Array.from({ length: 12 }, (_, index) => String(index + 4)),
    );
    const crossing = await providers.rijksmuseum.search(
      query,
      new AbortController().signal,
      98,
      null,
      3,
    );
    expect(crossing.images.map(({ id }) => id)).toEqual(["99", "100", "101"]);
    expect(crossing.next).toBe(101);
    expect(searches).toHaveLength(2);
    expect(searches[0].searchParams.get("title")).toBe(query);
    expect(
      searches.every(
        (url) => url.searchParams.get("imageAvailable") === "true",
      ),
    ).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("museum detail deadlines keep progressive results and resume at the first unprocessed image", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  const deadline = new AbortController();
  let timedOut = false;
  AbortSignal.timeout = () => deadline.signal;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.hostname === "api.wellcomecollection.org")
      return Response.json({
        totalResults: 2,
        results: ["aaaa1234", "bbbb1234"].map((id, index) => ({
          id,
          title: `Image ${index}`,
          items: [
            {
              locations: [
                {
                  url: `https://iiif.wellcomecollection.org/image/deadline${index}/info.json`,
                  locationType: { id: "iiif-image" },
                  license: {
                    id: "pdm",
                    url: "https://creativecommons.org/publicdomain/mark/1.0/",
                  },
                },
              ],
            },
          ],
        })),
      });
    if (url.pathname.includes("deadline1") && !timedOut) {
      timedOut = true;
      deadline.abort(
        new DOMException("Search deadline exceeded", "TimeoutError"),
      );
      throw deadline.signal.reason;
    }
    return Response.json({
      id: url.href.replace("/info.json", ""),
      width: 800,
      height: 600,
    });
  };
  try {
    const query = crypto.randomUUID();
    const first = await providers.wellcome.search(
      query,
      new AbortController().signal,
    );
    expect(first.images.map(({ id }) => id)).toEqual(["aaaa1234"]);
    expect(first).toMatchObject({ next: 1, incomplete: true });
    AbortSignal.timeout = originalTimeout;
    const second = await providers.wellcome.search(
      query,
      new AbortController().signal,
      first.next,
    );
    expect(second.images.map(({ id }) => id)).toEqual(["bbbb1234"]);
    expect(second.next).toBeUndefined();
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
});

test("new museum catalogs report quotas and malformed metadata and respect cancellation", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const provider of [providers.rijksmuseum, providers.wellcome]) {
      globalThis.fetch = async () =>
        new Response("{}", { status: 429, headers: { "Retry-After": "2" } });
      await expect(
        provider.search(crypto.randomUUID(), new AbortController().signal),
      ).rejects.toMatchObject({ kind: "quota", retryAfter: 2000 });
      globalThis.fetch = async () => Response.json({});
      await expect(
        provider.search(crypto.randomUUID(), new AbortController().signal),
      ).rejects.toMatchObject({ kind: "invalid" });
      if (provider.id === "rijksmuseum") {
        globalThis.fetch = async () =>
          Response.json({
            partOf: { totalItems: 101 },
            orderedItems: Array.from({ length: 100 }, (_, index) => ({
              id: `https://id.rijksmuseum.nl/${index + 1}`,
            })),
            next: {
              id: "https://evil.example/search/collection?pageToken=unsafe",
            },
          });
        await expect(
          provider.search(crypto.randomUUID(), new AbortController().signal),
        ).rejects.toMatchObject({ kind: "invalid" });
      }
      const controller = new AbortController();
      controller.abort();
      await expect(
        provider.search(crypto.randomUUID(), controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("translations render valid ICU messages, plurals and interpolated values", async () => {
  const en = JSON.parse(
    await readFile(new URL("../src/locales/en.json", import.meta.url), "utf8"),
  );
  const i18n = createInstance();
  await i18n
    .use(
      new ICU({
        parseErrorHandler: (error) => {
          throw error;
        },
      }),
    )
    .init({
      lng: "en",
      fallbackLng: "en",
      initAsync: false,
      resources: { en: { translation: en } },
    });
  function validate(messages, prefix = "") {
    for (const [key, message] of Object.entries(messages)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (typeof message === "string") {
        expect(
          typeof i18n.t(fullKey, {
            count: 2,
            gap: 12.5,
            padding: 62.5,
            row: 2,
            column: 3,
            value1: "Image {title}",
            value2: "Square",
            value3: 3,
            value4: 4,
          }),
        ).toBe("string");
      } else validate(message, fullKey);
    }
  }
  validate(en);
  for (const count of [0, 1, 2]) {
    expect(i18n.t("common.counts.images", { count })).toBe(
      `${count} ${count === 1 ? "image" : "images"}`,
    );
    expect(i18n.t("common.actions.addImages", { count })).toBe(
      count === 1 ? "Add image" : "Add images",
    );
    expect(i18n.t("common.actions.addOrDropImages", { count })).toBe(
      count === 1 ? "Add or drop an image" : "Add or drop images",
    );
  }
  expect(i18n.t("cell.actions.useImage", { value1: "Image {title}" })).toBe(
    "Use Image {title}",
  );
});

function localWorkspace() {
  const workspace = model.makeWorkspace();
  Object.assign(workspace.grid, {
    imageAspect: "portrait",
    captionPlacement: "overlay",
    captionOverlayOpacity: 60,
    captionOverlayColor: undefined,
    cornerRadius: 12.5,
    gap: 60,
    canvasPadding: 60,
    headingBackgroundColor: undefined,
    headingTextColor: undefined,
    cellBackgroundColor: undefined,
    cellTextColor: undefined,
  });
  const asset = {
    id: crypto.randomUUID(),
    category: "Imported",
    title: "Private photograph",
    src: "data:image/png;base64,private-local-media",
  };
  workspace.assets = [asset];
  workspace.grid = model.resizeBoard(workspace.grid, 4, 4);
  workspace.grid.name = "Private collection";
  workspace.grid.heading = "Private banner";
  workspace.grid.cells[15] = {
    ...workspace.grid.cells[15],
    assetId: asset.id,
    title: "Private caption",
    fit: "cover",
  };
  workspace.exportSettings = {
    format: "image/webp",
    resolution: 300,
    quality: 70,
  };
  return workspace;
}

test("independent typography settings validate, roundtrip and reset without changing content", () => {
  const workspace = localWorkspace();
  Object.assign(workspace.grid, {
    headingFont: "Bebas Neue",
    headingFontSize: 30,
    headingPadding: 54,
    headingTextColor: "#cc4488",
    cellFont: "Boogaloo",
    cellFontSize: 24,
    cellTextColor: "#39a36f",
  });
  const settings = model.getEditorSettings(workspace);
  expect(settings.style).toMatchObject({
    headingFont: "Bebas Neue",
    headingFontSize: 30,
    headingPadding: 54,
    headingTextColor: "#cc4488",
    cellFont: "Boogaloo",
    cellFontSize: 24,
    cellTextColor: "#39a36f",
  });
  expect(JSON.stringify(settings)).not.toContain("Private");
  const restored = model.applyEditorSettings(
    localWorkspace(),
    JSON.parse(JSON.stringify(settings)),
  );
  expect(model.getEditorSettings(restored)).toEqual(settings);
  expect(model.headingGeometry(restored.grid, 150)).toEqual({
    padding: 13.5,
    contentHeight: 63,
    height: 90,
  });
  const multilineHeading = model.headingGeometry(restored.grid, 150, 3);
  expect(multilineHeading.contentHeight).toBeCloseTo(150 * 0.3 * 1.05 * 3);
  expect(multilineHeading.height).toBeCloseTo(
    multilineHeading.contentHeight + 27,
  );
  expect(model.cellGeometry(restored.grid, 150).captionHeight).toBe(55);
  expect(model.cellGeometry(restored.grid, 150, 0)).toMatchObject({
    captionHeight: 0,
    imageTop: 0,
    height: 200,
  });
  for (const patch of [
    { cellFontSize: 0 },
    { headingFontSize: 37 },
    { headingPadding: -1 },
    { headingPadding: 61 },
    { cellTextColor: "red" },
    { headingTextColor: "#fff" },
  ]) {
    expect(
      model.editorSettingsSchema.safeParse({
        ...settings,
        style: { ...settings.style, ...patch },
      }).success,
    ).toBe(false);
  }
  const reset = model.resetWorkspace(workspace);
  expect(reset.grid.headingFontSize).toBe(21);
  expect(reset.grid.headingPadding).toBe(30);
  expect(reset.grid.cellFontSize).toBe(12);
  expect(reset.grid.headingTextColor).toBe("#eef1f3");
  expect(reset.grid.cellTextColor).toBe("#eef1f3");
  expect(reset.assets).toBe(workspace.assets);
  expect(reset.grid.overflow).toEqual([]);
  expect(
    reset.grid.cells.some((cell) => cell.id === workspace.grid.cells[15].id),
  ).toBe(false);
});

test("image captions stay independent across library, placements and overflow without changing crops", () => {
  const workspace = localWorkspace();
  const asset = workspace.assets[0];
  const crop = { x: 0.5, y: 0, width: 0.5, height: 1 };
  workspace.grid.cells[15].crop = crop;
  const legacyCell = workspace.grid.cells[15];
  const overflow = model.resizeBoard(workspace.grid, 3, 3);
  workspace.grid = overflow;
  workspace.grid.overflow = [{ row: 3, column: 3, cell: legacyCell }];
  workspace.grid.cells[0] = {
    ...workspace.grid.cells[0],
    assetId: asset.id,
    title: "Old title",
  };
  workspace.grid.cells[1] = {
    ...workspace.grid.cells[1],
    assetId: asset.id,
    title: "Second card",
    crop: { x: 0, y: 0, width: 0.5, height: 1 },
  };
  const updated = model.documentReducer(workspace, {
    type: "asset/title",
    assetId: asset.id,
    title: "Mixed Case caption",
  });
  expect(updated.assets[0].title).toBe("Mixed Case caption");
  expect(updated.assets[0].src).toBe(asset.src);
  expect(updated.grid).toBe(workspace.grid);
  expect(updated.grid.cells[0].title).toBe("Old title");
  expect(
    updated.grid.overflow.find((entry) => entry.cell.assetId === asset.id).cell,
  ).toMatchObject({ title: "Private caption", crop });
  expect(updated.grid.cells[1]).toBe(workspace.grid.cells[1]);
  const edited = model.documentReducer(updated, {
    type: "cell/patch",
    gridId: updated.grid.id,
    cellId: updated.grid.cells[0].id,
    patch: { title: "First card" },
  });
  expect(edited.grid.cells[0].title).toBe("First card");
  expect(edited.grid.cells[1]).toBe(updated.grid.cells[1]);
  expect(edited.grid.overflow).toBe(updated.grid.overflow);
  expect(edited.assets).toBe(updated.assets);
  const cropped = model.documentReducer(edited, {
    type: "cell/crop",
    gridId: edited.grid.id,
    cellId: edited.grid.cells[0].id,
    assetId: asset.id,
    crop,
  });
  expect(cropped.grid.cells[0]).toMatchObject({ title: "First card", crop });
  expect(cropped.grid.cells[1]).toMatchObject({
    title: "Second card",
    crop: { x: 0, y: 0, width: 0.5, height: 1 },
  });
  expect(cropped.assets).toBe(updated.assets);
  expect(model.workspaceSchema.safeParse(cropped).success).toBe(true);
  expect(model.workspaceSchema.safeParse(updated).success).toBe(true);
  expect(JSON.stringify(model.getEditorSettings(updated))).not.toContain(
    "Mixed Case caption",
  );
  expect(
    model.documentReducer(workspace, {
      type: "asset/title",
      assetId: crypto.randomUUID(),
      title: "Missing",
    }),
  ).toBe(workspace);
  expect(
    model.documentReducer(workspace, {
      type: "asset/title",
      assetId: asset.id,
      title: "x".repeat(121),
    }),
  ).toBe(workspace);
});

test("library crops become placement defaults without changing existing cells or originals", () => {
  const workspace = localWorkspace();
  const asset = workspace.assets[0];
  const existingCrop = { x: 0, y: 0, width: 0.5, height: 1 };
  workspace.grid.cells[0] = {
    ...workspace.grid.cells[0],
    assetId: asset.id,
    crop: existingCrop,
  };
  workspace.grid.cells[15].crop = existingCrop;
  const legacyCell = workspace.grid.cells[15];
  workspace.grid = model.resizeBoard(workspace.grid, 3, 3);
  workspace.grid.overflow = [{ row: 3, column: 3, cell: legacyCell }];
  const crop = { x: 0.5, y: 0, width: 0.5, height: 1 };
  const cropped = model.documentReducer(workspace, {
    type: "asset/crop",
    assetId: asset.id,
    crop,
  });
  expect(cropped.grid).toBe(workspace.grid);
  expect(cropped.assets[0]).toEqual({ ...asset, crop });
  expect(workspace.assets[0].crop).toBeUndefined();
  expect(cropped.grid.cells[0].crop).toEqual(existingCrop);
  expect(
    cropped.grid.overflow.find((entry) => entry.cell.assetId === asset.id).cell
      .crop,
  ).toEqual(existingCrop);
  expect(
    model.workspaceSchema.parse(JSON.parse(JSON.stringify(cropped))).assets[0]
      .crop,
  ).toEqual(crop);
  expect(model.makeCell(cropped.assets[0]).crop).toEqual(crop);
  expect(model.makeBoard("Cropped", cropped.assets).cells[0].crop).toEqual(
    crop,
  );
  const placed = model.documentReducer(cropped, {
    type: "cell/place",
    gridId: cropped.grid.id,
    cellId: cropped.grid.cells[1].id,
    assetId: asset.id,
  });
  expect(placed.grid.cells[1].crop).toEqual(crop);
  const imported = model.documentReducer(placed, {
    type: "assets/import",
    gridId: placed.grid.id,
    cellId: placed.grid.cells[2].id,
    assets: [{ ...cropped.assets[0], id: crypto.randomUUID() }],
  });
  expect(imported.grid.cells[2].crop).toEqual(crop);
  const reset = model.documentReducer(imported, {
    type: "asset/crop",
    assetId: asset.id,
    crop: undefined,
  });
  expect(reset.grid).toBe(imported.grid);
  const replacement = model.documentReducer(reset, {
    type: "cell/place",
    gridId: reset.grid.id,
    cellId: reset.grid.cells[1].id,
    assetId: asset.id,
  });
  expect(replacement.grid.cells[1].crop).toBeUndefined();
  for (const command of [
    { type: "asset/crop", assetId: crypto.randomUUID(), crop },
    { type: "asset/crop", assetId: asset.id, crop: { ...crop, width: 0.8 } },
  ])
    expect(model.documentReducer(cropped, command)).toBe(cropped);
  expect(
    model.workspaceSchema.safeParse({
      ...cropped,
      assets: [{ ...cropped.assets[0], crop: { ...crop, width: 0.8 } }],
    }).success,
  ).toBe(false);
});

test("visual crops preserve originals and share full-box source rectangles", () => {
  const workspace = localWorkspace();
  const cell = workspace.grid.cells[15];
  const crop = { x: 0.5, y: 0, width: 0.5, height: 1 };
  const command = {
    type: "cell/crop",
    gridId: workspace.grid.id,
    cellId: cell.id,
    assetId: cell.assetId,
    crop,
  };
  const cropped = model.documentReducer(workspace, command);
  expect(cropped.grid.cells[15].crop).toEqual(crop);
  expect(cropped.assets).toBe(workspace.assets);
  expect(workspace.grid.cells[15].crop).toBeUndefined();
  expect(model.workspaceSchema.safeParse(cropped).success).toBe(true);
  expect(JSON.stringify(model.getEditorSettings(cropped))).not.toContain(
    '"crop"',
  );
  expect(model.sourceRectangle(undefined, 400, 200, 1)).toEqual({
    x: 100,
    y: 0,
    width: 200,
    height: 200,
  });
  expect(model.sourceRectangle(crop, 400, 200, 1)).toEqual({
    x: 200,
    y: 0,
    width: 200,
    height: 200,
  });
  expect(model.sourceRectangle(crop, 400, 200, 3 / 4)).toEqual({
    x: 225,
    y: 0,
    width: 150,
    height: 200,
  });
  expect(
    model.documentReducer(cropped, {
      ...command,
      assetId: crypto.randomUUID(),
    }),
  ).toBe(cropped);
  expect(
    model.documentReducer(cropped, {
      ...command,
      crop: { ...crop, width: 0.8 },
    }),
  ).toBe(cropped);
  const replaced = model.documentReducer(cropped, {
    type: "cell/place",
    gridId: workspace.grid.id,
    cellId: cell.id,
    assetId: cell.assetId,
  });
  expect(replaced.grid.cells[15].crop).toBeUndefined();
  const uploaded = model.documentReducer(cropped, {
    type: "assets/import",
    gridId: workspace.grid.id,
    cellId: cell.id,
    assets: [{ ...workspace.assets[0], id: crypto.randomUUID() }],
  });
  expect(uploaded.grid.cells[15].crop).toBeUndefined();
  const swapped = model.documentReducer(cropped, {
    type: "cell/swap",
    gridId: workspace.grid.id,
    sourceCellId: cell.id,
    targetCellId: workspace.grid.cells[0].id,
  });
  expect(swapped.grid.cells[0].crop).toEqual(crop);
});

test("multiline caption geometry caps shared bands at three rows without changing image ratios", () => {
  const style = {
    ...model.makeWorkspace().grid,
    imageAspect: "square",
    captionPlacement: "below",
  };
  expect(model.cellGeometry(style, 600, 6)).toMatchObject({
    imageHeight: 600,
    captionHeight: 293,
    height: 893,
  });
  expect(
    model.cellGeometry({ ...style, captionPlacement: "above" }, 600, 6),
  ).toMatchObject({ imageTop: 293, captionTop: 0, height: 893 });
  expect(
    model.cellGeometry(
      {
        ...style,
        imageAspect: "landscape",
        captionPlacement: "overlay",
        captionAlignment: "bottom",
      },
      600,
      6,
    ),
  ).toMatchObject({
    aspectRatio: 4 / 3,
    imageHeight: 450,
    captionHeight: 142,
    imageTop: 0,
    captionTop: 308,
    height: 450,
  });
  for (const imageAspect of ["portrait", "landscape", "square"])
    for (const captionRows of [1, 6, 40]) {
      const geometry = model.cellGeometry(
        { ...style, imageAspect, captionPlacement: "overlay" },
        600,
        captionRows,
      );
      expect(geometry.height).toBe(geometry.imageHeight);
      expect(
        geometry.imageHeight - geometry.captionHeight,
      ).toBeGreaterThanOrEqual(300);
    }
});

test("overlay bands reserve only the caption rows that fit at the selected font size", () => {
  const style = {
    ...model.makeWorkspace().grid,
    captionPlacement: "overlay",
    imageAspect: "portrait",
    cellFontSize: 36,
  };
  for (const width of [150, 300, 600, 1200]) {
    for (const imageAspect of ["portrait", "square", "landscape"]) {
      const settings = { ...style, imageAspect };
      const short = model.cellGeometry(settings, width, 1);
      const long = model.cellGeometry(settings, width, 3);
      expect(long.captionHeight).toBe(short.captionHeight);
      expect(long.imageHeight - long.captionHeight).toBeGreaterThanOrEqual(
        width * 0.5,
      );
      expect(model.cellGeometry(settings, width, 0).captionHeight).toBe(0);
      expect(
        model.cellGeometry({ ...settings, titlesVisible: false }, width, 3)
          .captionHeight,
      ).toBe(0);
    }
    const smaller = { ...style, cellFontSize: 24 };
    expect(model.cellGeometry(smaller, width, 3).captionHeight).toBe(
      model.cellGeometry(smaller, width, 2).captionHeight,
    );
    expect(model.cellGeometry(smaller, width, 2).captionHeight).toBeGreaterThan(
      model.cellGeometry(smaller, width, 1).captionHeight,
    );
  }
});

test("grid appearance settings roundtrip and share cell geometry", () => {
  const workspace = localWorkspace();
  Object.assign(workspace.grid, {
    imageAspect: "portrait",
    captionPlacement: "overlay",
    captionAlignment: "middle",
    captionOverlayColor: "#123456",
    captionOverlayOpacity: 40,
  });
  const settings = model.getEditorSettings(workspace);
  expect(settings.style).toMatchObject({
    imageAspect: "portrait",
    captionPlacement: "overlay",
    captionAlignment: "middle",
    captionOverlayColor: "#123456",
    captionOverlayOpacity: 40,
  });
  const restored = model.applyEditorSettings(model.makeWorkspace(), settings);
  expect(model.getEditorSettings(restored)).toEqual(settings);
  expect(model.workspaceSchema.safeParse(workspace).success).toBe(true);
  expect(model.cellGeometry(workspace.grid, 600)).toMatchObject({
    imageHeight: 800,
    captionHeight: 142,
    captionTop: 329,
    height: 800,
  });
  expect(
    model.cellGeometry(
      {
        ...workspace.grid,
        imageAspect: "landscape",
        captionPlacement: "above",
      },
      600,
    ),
  ).toMatchObject({
    imageHeight: 450,
    imageTop: 142,
    captionTop: 0,
    height: 592,
  });
  expect(
    model.cellGeometry(
      { ...workspace.grid, imageAspect: "square", captionPlacement: "below" },
      600,
    ),
  ).toMatchObject({ imageHeight: 600, captionTop: 600, height: 742 });
  expect(model.captionPadding(600)).toEqual({ horizontal: 36, vertical: 30 });
  expect(
    model.editorSettingsSchema.safeParse({
      ...settings,
      style: { ...settings.style, captionOverlayOpacity: 101 },
    }).success,
  ).toBe(false);
  const defaults = model.getEditorSettings(model.makeWorkspace()).style;
  expect(defaults).toMatchObject({
    imageAspect: "portrait",
    captionPlacement: "overlay",
    captionAlignment: "bottom",
  });
  expect(model.cellGeometry(defaults, 600)).toMatchObject({
    imageHeight: 800,
    captionTop: 658,
    height: 800,
  });
  const reset = model.resetWorkspace(workspace);
  expect(model.getEditorSettings(reset).style).toEqual(defaults);
  expect(reset.assets).toEqual(workspace.assets);
});

test("title visibility roundtrips without removing captions or reserving bands", () => {
  const workspace = localWorkspace();
  workspace.grid.titlesVisible = false;
  const settings = model.getEditorSettings(workspace);
  expect(settings.style.titlesVisible).toBe(false);
  const restored = model.applyEditorSettings(workspace, settings);
  expect(restored.grid.titlesVisible).toBe(false);
  expect(restored.grid.cells).toEqual(workspace.grid.cells);
  expect(restored.assets).toEqual(workspace.assets);
  for (const captionPlacement of ["above", "below", "overlay"])
    expect(
      model.cellGeometry({ ...restored.grid, captionPlacement }, 600, 6),
    ).toMatchObject({ captionHeight: 0, imageTop: 0, height: 800 });
  expect(model.resetWorkspace(restored).grid.titlesVisible).not.toBe(false);
});

test("independent spacing and background settings roundtrip and reset", () => {
  const workspace = localWorkspace();
  const settings = model.getEditorSettings(workspace);
  Object.assign(settings.style, {
    gap: 120,
    canvasPadding: 120,
    canvasBackgroundColor: "#d9e7f0",
    headingBackgroundColor: "#114455",
    cellBackgroundColor: "#335577",
  });
  const restored = model.applyEditorSettings(workspace, settings);
  expect(model.getEditorSettings(restored)).toEqual(settings);
  expect(model.gridSpacing(restored.grid, 150)).toEqual({
    gap: 30,
    headingGap: 30,
    padding: 30,
  });
  expect(model.gridSpacing(restored.grid, 300)).toEqual({
    gap: 60,
    headingGap: 60,
    padding: 60,
  });
  expect(restored.assets).toBe(workspace.assets);
  expect(restored.grid.cells).toEqual(workspace.grid.cells);
  for (const invalid of [
    { gap: 121 },
    { canvasPadding: 121 },
    { headingBackgroundColor: "invalid" },
    { cellBackgroundColor: "invalid" },
  ]) {
    expect(
      model.editorSettingsSchema.safeParse({
        ...settings,
        style: { ...settings.style, ...invalid },
      }).success,
    ).toBe(false);
  }
  const reset = model.resetWorkspace(restored);
  expect(model.gridSpacing(reset.grid, 600)).toEqual({
    gap: 24,
    headingGap: 24,
    padding: 36,
  });
  expect(reset.grid.canvasBackgroundColor).toBeUndefined();
  expect(reset.grid.headingBackgroundColor).toBe("#17191b");
  expect(reset.grid.cellBackgroundColor).toBe("#23272b");
});

test("settings boundary extracts only allowlisted configuration and detached values", () => {
  const workspace = localWorkspace();
  const settings = model.getEditorSettings(workspace);
  expect(settings).toEqual({
    version: 1,
    layout: { rows: 4, columns: 4 },
    style: {
      publisher: "none",
      colorTheme: "Ink",
      headingVisible: true,
      headingFont: "Manrope",
      cellFont: "Manrope",
      headingFontWeight: 500,
      cellFontWeight: 500,
      headingFontSize: 21,
      headingPadding: 30,
      cellFontSize: 12,
      cornerRadius: 12.5,
      captionOverlayOpacity: 60,
      imageAspect: "portrait",
      captionPlacement: "overlay",
      captionAlignment: "bottom",
      gap: 60,
      canvasPadding: 60,
      background: "#17191b",
    },
    exportSettings: { format: "image/webp", resolution: 300, quality: 70 },
  });
  const serialized = JSON.stringify(settings);
  for (const privateValue of [
    workspace.grid.id,
    workspace.assets[0].id,
    workspace.assets[0].src,
    workspace.grid.cells[15].id,
    workspace.grid.name,
    workspace.grid.heading,
    workspace.grid.cells[15].title,
  ]) {
    expect(serialized).not.toContain(privateValue);
  }
  settings.layout.rows = 1;
  settings.style.gap = 40;
  settings.exportSettings.quality = 50;
  expect(workspace.grid.rows).toBe(4);
  expect(workspace.grid.gap).toBe(60);
  expect(workspace.exportSettings.quality).toBe(70);
});

test("settings boundary rejects unknown fields, media and invalid configuration without mutation", () => {
  const workspace = localWorkspace();
  const original = structuredClone(workspace);
  const settings = model.getEditorSettings(workspace);
  const invalid = [
    workspace,
    { ...settings, assets: workspace.assets },
    { ...settings, content: workspace.grid },
    { ...settings, imageUrl: "https://example.com/private.png" },
    { ...settings, fontData: "data:font/woff2;base64,private" },
    { ...settings, version: 99 },
    {
      ...settings,
      layout: { ...settings.layout, cells: workspace.grid.cells },
    },
    { ...settings, layout: { ...settings.layout, rows: 13 } },
    { ...settings, layout: { ...settings.layout, columns: 1.5 } },
    {
      ...settings,
      style: { ...settings.style, heading: workspace.grid.heading },
    },
    {
      ...settings,
      style: { ...settings.style, background: "data:image/png;base64,private" },
    },
    {
      ...settings,
      style: {
        ...settings.style,
        headingFont: "https://example.com/font.woff2",
      },
    },
    {
      ...settings,
      exportSettings: {
        ...settings.exportSettings,
        imagePath: "C:/private/photo.png",
      },
    },
    {
      ...settings,
      exportSettings: { ...settings.exportSettings, resolution: 999 },
    },
    {
      ...settings,
      exportSettings: { ...settings.exportSettings, quality: 101 },
    },
  ];
  for (const input of invalid) {
    expect(model.editorSettingsSchema.safeParse(input).success).toBe(false);
    expect(() => model.applyEditorSettings(workspace, input)).toThrow();
    expect(workspace).toEqual(original);
  }
});

test("font weights roundtrip and reset without theme profiles", () => {
  const workspace = localWorkspace();
  const settings = model.getEditorSettings(workspace);
  Object.assign(settings.style, {
    headingFontWeight: 800,
    cellFontWeight: 700,
  });
  const restored = model.applyEditorSettings(workspace, settings);
  expect(model.getEditorSettings(restored)).toEqual(settings);
  expect(restored.grid.cells).toEqual(workspace.grid.cells);
  expect(restored.assets).toBe(workspace.assets);
  expect(workspace.grid.headingFontWeight).not.toBe(800);
  expect(
    model.fontWeightOptions("Manrope").map((option) => option.value),
  ).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
  for (const font of ["Bangers", "Boogaloo", "Bebas Neue"]) {
    expect(model.fontWeightOptions(font).map((option) => option.value)).toEqual(
      [400, 700],
    );
    expect(model.resolveFontWeight(font, 800)).toBe(700);
    expect(model.resolveFontWeight(font, 300)).toBe(400);
  }
  const reset = model.resetWorkspace(restored);
  expect(model.getEditorSettings(reset).style).toMatchObject({
    headingFontWeight: 500,
    cellFontWeight: 500,
  });
  for (const field of ["headingFontWeight", "cellFontWeight"]) {
    for (const value of [99, 450, 1000]) {
      expect(
        model.editorSettingsSchema.safeParse({
          ...settings,
          style: { ...settings.style, [field]: value },
        }).success,
      ).toBe(false);
    }
  }
  for (const invalid of [
    { ...settings, themeSettings: {} },
    { ...settings, style: { ...settings.style, template: "Clean" } },
  ]) {
    expect(model.editorSettingsSchema.safeParse(invalid).success).toBe(false);
    expect(() => model.applyEditorSettings(workspace, invalid)).toThrow();
  }
});

test("settings boundary applies configuration while preserving retained content and discarding removed coordinates", () => {
  const workspace = localWorkspace();
  const original = structuredClone(workspace);
  const defaults = model.getEditorSettings(model.makeWorkspace());
  const applied = model.applyEditorSettings(workspace, defaults);
  expect(model.getEditorSettings(applied)).toEqual(defaults);
  expect(applied.assets).toBe(workspace.assets);
  expect(applied.grid.id).toBe(workspace.grid.id);
  expect(applied.grid.name).toBe(workspace.grid.name);
  expect(applied.grid.heading).toBe(workspace.grid.heading);
  expect(applied.grid.cells[0].id).toBe(workspace.grid.cells[0].id);
  expect(applied.grid.overflow).toEqual([]);
  expect(applied.grid.cells).not.toContainEqual(workspace.grid.cells[15]);
  expect(model.workspaceSchema.safeParse(applied).success).toBe(true);
  const restored = model.applyEditorSettings(
    applied,
    model.getEditorSettings(workspace),
  );
  for (const [index, cell] of restored.grid.cells.entries()) {
    const row = Math.floor(index / workspace.grid.columns);
    const column = index % workspace.grid.columns;
    if (row < defaults.layout.rows && column < defaults.layout.columns)
      expect(cell).toEqual(workspace.grid.cells[index]);
    else expect(cell).toMatchObject({ title: "", assetId: null });
  }
  expect(restored.grid.overflow).toEqual([]);
  expect(workspace).toEqual(original);
  defaults.style.gap = 40;
  defaults.exportSettings.quality = 50;
  expect(applied.grid.gap).toBe(24);
  expect(applied.exportSettings.quality).toBe(95);
});

test("document commands patch, place, swap and clear content without replacing cell identities", () => {
  const workspace = localWorkspace();
  const original = structuredClone(workspace);
  const [first, second] = workspace.grid.cells;
  let edited = model.documentReducer(workspace, {
    type: "grid/patch",
    gridId: workspace.grid.id,
    patch: { heading: "Edited banner", gap: 20 },
  });
  edited = model.documentReducer(edited, {
    type: "export/patch",
    patch: { quality: 80 },
  });
  edited = model.documentReducer(edited, {
    type: "cell/place",
    gridId: workspace.grid.id,
    cellId: first.id,
    assetId: workspace.assets[0].id,
  });
  edited = model.documentReducer(edited, {
    type: "cell/patch",
    gridId: workspace.grid.id,
    cellId: first.id,
    patch: { title: "Edited caption", fit: "cover" },
  });
  edited = model.documentReducer(edited, {
    type: "cell/swap",
    gridId: workspace.grid.id,
    sourceCellId: first.id,
    targetCellId: second.id,
  });
  expect(edited.grid.cells[1]).toMatchObject({
    id: second.id,
    title: "Edited caption",
    fit: "cover",
    assetId: workspace.assets[0].id,
  });
  expect(edited.grid.cells[0].id).toBe(first.id);
  edited = model.documentReducer(edited, {
    type: "cell/clear",
    gridId: workspace.grid.id,
    cellId: second.id,
  });
  expect(edited.grid.cells[1]).toEqual({
    id: second.id,
    title: "",
    fit: "cover",
    crop: undefined,
    assetId: null,
  });
  expect(edited.grid.heading).toBe("Edited banner");
  expect(edited.exportSettings.quality).toBe(80);
  expect(edited.assets).toBe(workspace.assets);
  expect(model.workspaceSchema.safeParse(edited).success).toBe(true);
  expect(workspace).toEqual(original);
  expect(
    model.documentReducer(edited, {
      type: "cell/place",
      gridId: workspace.grid.id,
      cellId: first.id,
      assetId: crypto.randomUUID(),
    }),
  ).toBe(edited);
});

test("current theme reset retains Rose while default theme reset restores Ink", () => {
  const workspace = localWorkspace();
  workspace.grid = {
    ...workspace.grid,
    ...model.colorPaletteStyle("Rose"),
    background: "#554455",
    gap: 60,
  };
  for (const defaultTheme of [false, true]) {
    const command = model.createResetGridCommand({
      canvas: false,
      theme: !defaultTheme,
      defaultTheme,
      images: false,
      placements: false,
    });
    const reset = model.documentReducer(workspace, command);
    expect(reset.grid).toMatchObject(
      model.colorPaletteStyle(defaultTheme ? "Ink" : "Rose"),
    );
    expect(reset.grid.gap).toBe(command.defaults.grid.gap);
    expect(reset.grid.cells).toBe(workspace.grid.cells);
    expect(reset.grid.heading).toBe(workspace.grid.heading);
    expect(reset.assets).toBe(workspace.assets);
    expect(reset.exportSettings).toBe(workspace.exportSettings);
    expect(model.workspaceSchema.safeParse(reset).success).toBe(true);
  }
});

test("panel and canvas image resets preserve the unselected image location", () => {
  const workspace = localWorkspace();
  const unused = {
    ...workspace.assets[0],
    id: crypto.randomUUID(),
    title: "Unused",
  };
  workspace.assets.push(unused);
  const panel = model.documentReducer(
    workspace,
    model.createResetGridCommand({
      canvas: false,
      theme: false,
      images: true,
      placements: false,
    }),
  );
  expect(panel.grid).toBe(workspace.grid);
  expect(panel.assets).toEqual([
    { ...workspace.assets[0], libraryHidden: true },
  ]);
  const canvas = model.documentReducer(
    workspace,
    model.createResetGridCommand({
      canvas: false,
      theme: false,
      images: false,
      placements: true,
    }),
  );
  expect(canvas.assets).toBe(workspace.assets);
  expect(canvas.grid.cells[15]).toMatchObject({
    title: "",
    assetId: null,
  });
  const both = model.documentReducer(
    workspace,
    model.createResetGridCommand({
      canvas: false,
      theme: false,
      images: true,
      placements: true,
    }),
  );
  expect(both.assets).toEqual([]);
  expect(both.grid.cells[15]).toMatchObject({
    title: "",
    assetId: null,
  });
  expect(model.workspaceSchema.safeParse(panel).success).toBe(true);
  expect(model.workspaceSchema.safeParse(canvas).success).toBe(true);
});

test("removed rows and columns discard cell data while retaining visible cells and library images", () => {
  const workspace = localWorkspace();
  workspace.grid.cells = workspace.grid.cells.map((cell, index) => ({
    ...cell,
    title: `Cell ${index}`,
    assetId: workspace.assets[0].id,
    fit: "contain",
  }));
  const previous = structuredClone(workspace);
  for (const [rows, columns] of [
    [3, 4],
    [4, 3],
    [3, 3],
  ]) {
    const shrink = model.createResizeCommand(workspace.grid.id, rows, columns);
    const smaller = model.documentReducer(workspace, shrink);
    expect(smaller.grid.overflow).toEqual([]);
    expect(smaller.assets).toBe(workspace.assets);
    const grow = model.createResizeCommand(workspace.grid.id, 4, 4);
    const expanded = model.documentReducer(smaller, grow);
    expect(expanded).toEqual(model.documentReducer(smaller, grow));
    expect(expanded.grid.overflow).toEqual([]);
    expanded.grid.cells.forEach((cell, index) => {
      const row = Math.floor(index / 4);
      const column = index % 4;
      if (row < rows && column < columns) {
        expect(cell).toBe(workspace.grid.cells[index]);
      } else {
        expect(cell).toMatchObject({ title: "", assetId: null, fit: "cover" });
        expect(cell.crop).toBeUndefined();
        expect(cell.id).not.toBe(workspace.grid.cells[index].id);
      }
    });
    expect(model.workspaceSchema.safeParse(expanded).success).toBe(true);
  }
  const legacy = {
    ...workspace.grid,
    rows: 3,
    cells: workspace.grid.cells.slice(0, 12),
    overflow: [{ row: 3, column: 3, cell: workspace.grid.cells[15] }],
  };
  expect(model.resizeBoard(legacy, 4, 4).cells[15]).toMatchObject({
    title: "",
    assetId: null,
  });
  expect(workspace).toEqual(previous);
});

test("document resize and reset commands replay stable IDs and preserve newer edits", () => {
  const workspace = model.makeWorkspace();
  const resize = model.createResizeCommand(workspace.grid.id, 4, 4);
  expect(model.documentReducer(workspace, resize)).toEqual(
    model.documentReducer(workspace, resize),
  );
  const grown = model.documentReducer(workspace, resize);
  const cell = grown.grid.cells[10];
  const edited = model.documentReducer(grown, {
    type: "cell/patch",
    gridId: grown.grid.id,
    cellId: cell.id,
    patch: { title: "Newer edit" },
  });
  const reset = model.createResetCommand();
  const resetWorkspace = model.documentReducer(edited, reset);
  expect(resetWorkspace).toEqual(model.documentReducer(edited, reset));
  expect(resetWorkspace.grid.overflow).toEqual([]);
  expect(resetWorkspace.grid.cells[8].title).toBe("Newer edit");
  const restored = model.documentReducer(resetWorkspace, resize);
  expect(restored.grid.cells[10]).toMatchObject({
    id: cell.id,
    title: "Newer edit",
  });
  const small = model.documentReducer(
    workspace,
    model.createResizeCommand(workspace.grid.id, 1, 1),
  );
  expect(model.documentReducer(small, reset)).toEqual(
    model.documentReducer(small, reset),
  );
  expect(model.workspaceSchema.safeParse(restored).success).toBe(true);
});

test("full reset clears content, overflow and all library media with stable defaults", () => {
  const workspace = localWorkspace();
  workspace.grid = model.resizeBoard(workspace.grid, 2, 2);
  const previous = structuredClone(workspace);
  const command = model.createResetGridCommand();
  const reset = model.documentReducer(workspace, command);
  expect(reset.grid).toEqual(command.defaults.grid);
  expect(reset.grid).toMatchObject({ rows: 2, columns: 2 });
  expect(reset.grid.cells).toHaveLength(4);
  expect(reset.grid.id).not.toBe(workspace.grid.id);
  expect(
    reset.grid.cells.every(
      (cell) => !cell.assetId && !cell.title && !cell.crop,
    ),
  ).toBe(true);
  expect(reset.grid.overflow).toEqual([]);
  expect(reset.assets).toEqual([]);
  expect(reset.exportSettings).toEqual(command.defaults.exportSettings);
  expect(model.documentReducer(workspace, command)).toEqual(reset);
  expect(workspace).toEqual(previous);
  expect(model.workspaceSchema.safeParse(reset).success).toBe(true);
  const imported = model.documentReducer(reset, {
    type: "assets/import",
    gridId: workspace.grid.id,
    cellId: workspace.grid.cells[0].id,
    assets: [
      { ...workspace.assets[0], id: crypto.randomUUID(), title: "Late import" },
    ],
  });
  expect(imported.assets).toHaveLength(1);
  expect(imported.grid).toBe(reset.grid);
});

test("selective reset preserves unselected canvas, theme, images and export settings", () => {
  const workspace = localWorkspace();
  workspace.grid.heading = "Keep heading";
  workspace.grid.background = "#123456";
  workspace.grid = model.resizeBoard(workspace.grid, 2, 3);
  workspace.grid.cells[0] = {
    ...workspace.grid.cells[0],
    assetId: workspace.assets[0].id,
    title: "Keep caption",
  };
  const previous = structuredClone(workspace);
  for (const canvas of [false, true]) {
    for (const theme of [false, true]) {
      for (const defaultTheme of [false, true]) {
        for (const images of [false, true]) {
          for (const placements of [false, true]) {
            const command = model.createResetGridCommand({
              canvas,
              theme,
              defaultTheme,
              images,
              placements,
            });
            const reset = model.documentReducer(workspace, command);
            expect(reset).toEqual(model.documentReducer(workspace, command));
            expect(model.workspaceSchema.safeParse(reset).success).toBe(true);
            if (canvas && defaultTheme && images && placements) {
              expect(reset).toEqual(command.defaults);
              continue;
            }
            expect(reset.grid.rows).toBe(
              canvas ? command.defaults.grid.rows : workspace.grid.rows,
            );
            expect(reset.grid.columns).toBe(
              canvas ? command.defaults.grid.columns : workspace.grid.columns,
            );
            expect(reset.grid.heading).toBe(
              canvas || placements ? "" : workspace.grid.heading,
            );
            expect(reset.grid.background).toBe(
              theme || defaultTheme
                ? command.defaults.grid.background
                : workspace.grid.background,
            );
            expect(reset.exportSettings).toBe(workspace.exportSettings);
            expect(reset.assets).toEqual(
              images
                ? canvas || placements
                  ? []
                  : workspace.assets.map((asset) => ({
                      ...asset,
                      libraryHidden: true,
                    }))
                : workspace.assets,
            );
            if (canvas || placements) {
              expect(
                reset.grid.cells.every(
                  (cell) => !cell.assetId && !cell.crop && !cell.title,
                ),
              ).toBe(true);
              expect(
                reset.grid.overflow.every(
                  (entry) =>
                    !entry.cell.assetId &&
                    !entry.cell.crop &&
                    !entry.cell.title,
                ),
              ).toBe(true);
            } else {
              expect(reset.grid.cells).toBe(workspace.grid.cells);
              expect(reset.grid.overflow).toBe(workspace.grid.overflow);
            }
            if (canvas) {
              expect(reset.grid.cells).toEqual(command.defaults.grid.cells);
              expect(reset.grid.cells.every((cell) => !cell.title)).toBe(true);
              expect(reset.grid.overflow).toEqual([]);
            } else if (!placements) {
              expect(reset.grid.cells.map((cell) => cell.title)).toEqual(
                workspace.grid.cells.map((cell) => cell.title),
              );
              expect(
                reset.grid.overflow.map((entry) => entry.cell.title),
              ).toEqual(
                workspace.grid.overflow.map((entry) => entry.cell.title),
              );
            }
          }
        }
      }
    }
  }
  expect(workspace).toEqual(previous);
});

test("document import commands use latest cell IDs and retain media for stale destinations", () => {
  const workspace = model.makeWorkspace();
  const destination = workspace.grid.cells[3];
  const asset = {
    id: crypto.randomUUID(),
    category: "Imported",
    title: "A".repeat(150),
    src: "data:image/png;base64,local",
  };
  const command = {
    type: "assets/import",
    gridId: workspace.grid.id,
    cellId: destination.id,
    assets: [asset],
  };
  const grown = model.documentReducer(
    workspace,
    model.createResizeCommand(workspace.grid.id, 3, 4),
  );
  const placed = model.documentReducer(grown, command);
  expect(placed.grid.cells[4]).toMatchObject({
    id: destination.id,
    assetId: asset.id,
    title: "A".repeat(120),
  });
  expect(placed.grid.cells[3].assetId).toBeNull();
  const removed = model.documentReducer(
    workspace,
    model.createResizeCommand(workspace.grid.id, 1, 1),
  );
  const retained = model.documentReducer(removed, command);
  expect(retained.assets).toEqual([asset]);
  expect(retained.grid).toBe(removed.grid);
  const replaced = { ...workspace, grid: model.makeBoard("Another grid") };
  const stale = model.documentReducer(replaced, command);
  expect(stale.assets).toEqual([asset]);
  expect(stale.grid).toBe(replaced.grid);
  expect(stale.exportSettings).toBe(workspace.exportSettings);
  expect(model.documentReducer(stale, command).assets).toHaveLength(1);
  expect(
    model.documentReducer(stale, {
      type: "cell/patch",
      gridId: workspace.grid.id,
      cellId: destination.id,
      patch: { title: "Stale edit" },
    }),
  ).toBe(stale);
  expect(model.workspaceSchema.safeParse(stale).success).toBe(true);
});

test("document batch imports retain latest media and preferences", () => {
  const workspace = model.makeWorkspace();
  const assets = Array.from({ length: 3 }, (_, index) => ({
    id: crypto.randomUUID(),
    category: "Imported",
    title: `Image ${index}`,
    src: `data:image/png;base64,local-${index}`,
  }));
  const batch = {
    type: "assets/import",
    gridId: workspace.grid.id,
    cellId: workspace.grid.cells[8].id,
    assets,
  };
  const imported = model.documentReducer(workspace, batch);
  expect(imported).toEqual(model.documentReducer(workspace, batch));
  expect(imported.assets).toEqual(assets);
  expect(imported.grid.cells[8]).toMatchObject({
    id: workspace.grid.cells[8].id,
    assetId: assets[0].id,
    title: "Image 0",
  });
  const updated = model.documentReducer(imported, {
    type: "export/patch",
    patch: { quality: 85 },
  });
  expect(updated.assets).toEqual(assets);
  expect(updated.exportSettings.quality).toBe(85);
  expect(model.workspaceSchema.safeParse(updated).success).toBe(true);
  expect(workspace.assets).toEqual([]);
});

test("library deletion retains visible and removed references while deleting unused images", () => {
  const workspace = localWorkspace();
  const unused = {
    ...workspace.assets[0],
    id: crypto.randomUUID(),
    title: "Unused",
  };
  workspace.assets.push(unused);
  workspace.grid.cells[0] = {
    ...workspace.grid.cells[0],
    assetId: workspace.assets[0].id,
    title: "Keep visible caption",
  };
  const reduced = model.documentReducer(
    workspace,
    model.createResizeCommand(workspace.grid.id, 3, 3),
  );
  reduced.grid.overflow = [
    { row: 3, column: 3, cell: workspace.grid.cells[15] },
  ];
  const original = structuredClone(reduced);
  const deleted = model.documentReducer(reduced, {
    type: "assets/delete",
    assetIds: workspace.assets.map((asset) => asset.id),
  });
  expect(deleted.assets).toEqual([
    { ...workspace.assets[0], libraryHidden: true },
  ]);
  expect(deleted.grid).toBe(reduced.grid);
  expect(deleted.grid.cells[0]).toMatchObject({
    assetId: workspace.assets[0].id,
    title: "Keep visible caption",
  });
  expect(
    deleted.grid.overflow.find(
      (entry) => entry.cell.id === workspace.grid.cells[15].id,
    ).cell,
  ).toMatchObject({
    assetId: workspace.assets[0].id,
    title: "Private caption",
  });
  expect(model.workspaceSchema.safeParse(deleted).success).toBe(true);
  expect(reduced).toEqual(original);
  expect(
    model.documentReducer(deleted, {
      type: "assets/delete",
      assetIds: [workspace.assets[0].id],
    }),
  ).toBe(deleted);
});

test("trash cleanup protects live and overflow references and restores image identity", () => {
  const workspace = localWorkspace();
  const unused = {
    ...workspace.assets[0],
    id: crypto.randomUUID(),
    title: "Unused",
  };
  workspace.assets.push(unused);
  const reduced = model.documentReducer(
    workspace,
    model.createResizeCommand(workspace.grid.id, 3, 3),
  );
  reduced.grid.overflow = [
    { row: 3, column: 3, cell: workspace.grid.cells[15] },
  ];
  const original = structuredClone(reduced);
  const trashed = model.documentReducer(reduced, {
    type: "assets/trash-unused",
    assetIds: workspace.assets.map((asset) => asset.id),
    trashedAt: 123,
  });
  expect(trashed.assets[0].trashedAt).toBeUndefined();
  expect(trashed.assets[1]).toEqual({ ...unused, trashedAt: 123 });
  expect(trashed.grid).toBe(reduced.grid);
  expect(
    model.documentReducer(trashed, {
      type: "cell/place",
      gridId: trashed.grid.id,
      cellId: trashed.grid.cells[0].id,
      assetId: unused.id,
    }),
  ).toBe(trashed);
  const restored = model.documentReducer(trashed, {
    type: "assets/restore",
    assetIds: [unused.id],
  });
  expect(restored.assets[1]).toMatchObject(unused);
  expect(restored.assets[1].trashedAt).toBeUndefined();
  const purged = model.documentReducer(trashed, {
    type: "assets/purge",
    assetIds: workspace.assets.map((asset) => asset.id),
  });
  expect(purged.assets).toEqual([workspace.assets[0]]);
  expect(model.workspaceSchema.safeParse(purged).success).toBe(true);
  expect(reduced).toEqual(original);
});

test("trash commands recheck current usage rather than trusting stale cleanup selections", () => {
  const workspace = localWorkspace();
  const unused = { ...workspace.assets[0], id: crypto.randomUUID() };
  workspace.assets.push(unused);
  const pending = {
    type: "assets/trash-unused",
    assetIds: [unused.id],
    trashedAt: 123,
  };
  const placed = model.documentReducer(workspace, {
    type: "cell/place",
    gridId: workspace.grid.id,
    cellId: workspace.grid.cells[0].id,
    assetId: unused.id,
  });
  expect(
    model.documentReducer(placed, pending).assets[1].trashedAt,
  ).toBeUndefined();
  const invalid = structuredClone(placed);
  invalid.assets[1].trashedAt = 123;
  expect(model.workspaceSchema.safeParse(invalid).success).toBe(false);
});
