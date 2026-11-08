import { test, expect } from "@playwright/test";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { generateSW, getManifest } from "workbox-build";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const touchTest = test.extend({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const scrollbarTest = test.extend({
  launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
});
const nativeTouchTest = scrollbarTest.extend({
  isMobile: true,
  hasTouch: true,
});

async function selectEveryResetOption(dialog) {
  for (const checkbox of await dialog.getByRole("checkbox").all())
    await checkbox.check();
  const defaults = dialog.locator('#reset-theme-target [data-value="default"]');
  if ((await defaults.getAttribute("aria-checked")) !== "true")
    await defaults.click();
}

async function expectResetReview(
  dialog,
  selectedOptions,
  themeTarget = "current",
) {
  await expect(dialog.getByRole("heading")).toHaveText(["Reset"]);
  const review = dialog.locator("[data-reset-review]");
  await expect(review).toBeVisible();
  await expect(review.getByRole("listitem")).toHaveText([
    "Clear board content",
    "New empty 2x2 grid",
    `Restore appearance: ${themeTarget === "default" ? "Ink defaults" : "Current palette"}`,
    "Clear library",
  ]);
  for (const [index, option] of [
    "placements",
    "canvas",
    "theme",
    "images",
  ].entries()) {
    await expect(review.getByRole("listitem").nth(index)).toHaveClass(
      selectedOptions.includes(option) ? "text-ui-text" : "text-ui-muted",
    );
  }
  await expect(dialog.locator("p, [data-reset-impact]")).toHaveCount(0);
}

async function reviewReset(dialog, selectedOptions, themeTarget = "current") {
  await dialog
    .getByRole("button", { name: "Reset selected", exact: true })
    .click();
  await expect(dialog.locator("[data-reset-review]")).toBeVisible();
  await expectResetReview(dialog, selectedOptions, themeTarget);
}

async function confirmSelectedReset(dialog) {
  await dialog
    .getByRole("button", { name: "Confirm reset", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

async function resetEverything(page) {
  await page.getByRole("tab", { name: "Reset", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Reset", exact: true });
  await selectEveryResetOption(dialog);
  await reviewReset(
    dialog,
    ["placements", "canvas", "theme", "images"],
    "default",
  );
  await dialog
    .getByRole("button", {
      name: "Delete images and reset everything",
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
}

function overlayScrollbar(viewport, axis) {
  return viewport
    .locator("xpath=following-sibling::*[1][@data-overlay-scroll-frame]")
    .locator(`.os-scrollbar-${axis}`);
}

async function expectStationaryScrollbars(viewport) {
  const metrics = await viewport.evaluate((target) => {
    const rails = [
      ...target.nextElementSibling.querySelectorAll(".os-scrollbar"),
    ];
    const measure = () =>
      rails.map((rail) => {
        const bounds = rail.getBoundingClientRect();
        return [bounds.x, bounds.y];
      });
    const before = measure();
    const left = target.scrollLeft;
    const top = target.scrollTop;
    target.scrollTo(target.scrollWidth, target.scrollHeight);
    const after = measure();
    target.scrollTo(left, top);
    return { before, after };
  });
  expect(metrics.after).toEqual(metrics.before);
}

async function expectEditorTabBorders(tabs, vertical) {
  const borders = await tabs.getByRole("tab").evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return ["Top", "Right", "Bottom", "Left"].map((edge) =>
        parseFloat(style[`border${edge}Width`]),
      );
    }),
  );
  expect(borders).toEqual(
    vertical
      ? [
          [0, 1, 1, 0],
          [1, 1, 1, 0],
          [1, 1, 0, 0],
        ]
      : [
          [0, 1, 1, 0],
          [0, 1, 1, 1],
          [0, 0, 1, 1],
        ],
  );
}

function sidebarToggle(page, expanded = false) {
  return page
    .getByRole("group", { name: "Editor panels", exact: true })
    .getByRole("button", { name: /^(Show sidebar|Close sidebar)$/, expanded });
}

async function setEditorViewport(page, size) {
  await page.setViewportSize(size);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .querySelector(".app-layout")
            ?.getAnimations()
            .filter((animation) => animation.playState === "running").length ??
          0,
      ),
    )
    .toBe(0);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

async function tabThroughTo(page, target, maximum = 40) {
  for (let step = 0; step < maximum; step++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    expect(
      await page.evaluate(() => document.activeElement?.disabled),
    ).not.toBe(true);
  }
  await expect(target).toBeFocused();
}
let comicFixtureModule;
async function storageModuleUrl() {
  const result = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL("../src/storage.ts", import.meta.url)),
        formats: ["es"],
        fileName: "storage",
      },
    },
  });
  const output = (Array.isArray(result) ? result[0] : result).output;
  const chunk = output.find((entry) => entry.type === "chunk" && entry.isEntry);
  return `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`;
}
async function localDatabase(page, operation = "read", document = null) {
  return page.evaluate(
    ({ operation, document }) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("grids-client-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(
            ["documents", "images"],
            operation === "read" ? "readonly" : "readwrite",
          );
          const documents = transaction.objectStore("documents");
          const images = transaction.objectStore("images");
          const result = {};
          if (operation === "read") {
            const saved = documents.get("guest");
            saved.onsuccess = () => {
              result.document = saved.result;
            };
            const media = images.getAll();
            media.onsuccess = () => {
              result.images = media.result.map(({ id, blob }) => ({
                id,
                isBlob: blob instanceof Blob,
                size: blob.size,
                type: blob.type,
              }));
            };
          } else if (operation === "seed") {
            documents.put(document.workspace);
            for (const image of document.images)
              images.put({
                id: image.id,
                blob: new Blob([new Uint8Array(image.bytes)], {
                  type: "image/jpeg",
                }),
              });
          } else if (operation === "write") documents.put(document);
          else if (operation === "delete") documents.delete("guest");
          else if (operation === "delete-image") images.delete(document.id);
          else if (operation === "clear") {
            documents.clear();
            images.clear();
          }
          transaction.oncomplete = () => {
            database.close();
            resolve(result);
          };
          transaction.onabort = transaction.onerror = () => {
            database.close();
            reject(
              transaction.error ?? new Error("Local database request failed."),
            );
          };
        };
      }),
    { operation, document },
  );
}

async function savedWorkspace(page) {
  await expect(page.locator("#save-status")).toHaveText(
    "Saved in this browser",
  );
  return (await localDatabase(page)).document;
}

async function openSidebarPanel(page, name) {
  await expect(page.locator("#board-grid")).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Editor panels", exact: true }),
  ).toBeVisible();
  const sidebar = page.locator("[data-editor-sidebar]");
  if (await sidebarToggle(page, false).count()) {
    await expect(sidebar).toHaveCount(0);
    await sidebarToggle(page, false).click();
  }
  await expect(sidebar).toHaveCount(1);
  await expect(sidebar).toBeVisible();
  const tab = sidebar.getByRole("tab", { name, exact: true });
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect
    .poll(() =>
      sidebar.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return Math.max(0, -bounds.left, bounds.right - innerWidth);
      }),
    )
    .toBeLessThan(1);
  return sidebar;
}

async function closeSidebarPanel(page) {
  if (!(await sidebarToggle(page, true).count())) return;
  await page
    .getByRole("button", { name: "Close sidebar", exact: true })
    .click();
  await expect(page.locator("[data-editor-sidebar]")).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Show sidebar", exact: true }),
  ).toBeFocused();
}

async function showSidebar(page) {
  if (await sidebarToggle(page, false).count())
    await sidebarToggle(page, false).click();
  await expect(page.locator("[data-editor-sidebar]")).toBeVisible();
}

async function selectedSidebarPanel(page) {
  const sidebar = page.locator("[data-editor-sidebar]");
  await expect.poll(() => sidebar.count()).toBeLessThan(2);
  const selected = sidebar.getByRole("tab", { selected: true });
  return (await selected.count())
    ? await selected.getAttribute("aria-label")
    : null;
}

async function reloadWorkspace(page) {
  const panel = await selectedSidebarPanel(page);
  await expect(page.locator("#save-status")).toHaveText(
    "Saved in this browser",
  );
  await page.reload();
  await expect(page.locator("#board-grid")).toBeVisible();
  if (panel) await openSidebarPanel(page, panel);
}

async function downloadBoard(page) {
  const dialog = page.getByRole("dialog", { name: "Export grid", exact: true });
  if (!(await dialog.isVisible()))
    await page.locator("#export-grid-header").click();
  const promise = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download image", exact: true })
    .click();
  const download = await promise;
  await expect(dialog).toHaveCount(0);
  return download;
}

async function useComicExample(page, publisher = "dc") {
  if (!comicFixtureModule) {
    const result = await build({
      configFile: false,
      logLevel: "error",
      build: {
        write: false,
        minify: false,
        lib: {
          entry: path.join(projectRoot, "tests/fixtures/comics.ts"),
          formats: ["es"],
          fileName: "fixtures",
        },
      },
    });
    const output = (Array.isArray(result) ? result[0] : result).output;
    const chunk = output.find(
      (entry) => entry.type === "chunk" && entry.isEntry,
    );
    comicFixtureModule = await import(
      `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`
    );
  }
  const panel = await selectedSidebarPanel(page);
  const original = await savedWorkspace(page);
  const workspace = comicFixtureModule.makeComicFixture(original, publisher);
  const images = await Promise.all(
    workspace.assets
      .filter(
        (asset) =>
          !original.assets.some((existing) => existing.id === asset.id),
      )
      .map(async (asset) => ({
        id: asset.id,
        bytes: [
          ...(await readFile(
            path.join(projectRoot, "tests/fixtures/assets", asset.source),
          )),
        ],
      })),
  );
  workspace.assets = workspace.assets.map(({ src, ...asset }) => asset);
  workspace.revision = crypto.randomUUID();
  await localDatabase(page, "seed", { workspace, images });
  await page.reload();
  await expect(page.locator("#board-grid")).toBeVisible();
  if (panel) await openSidebarPanel(page, panel);
}

function hoverColorOf(control, base = "--bg") {
  return control.evaluate((element, baseToken) => {
    const style = getComputedStyle(element);
    const probe = document.createElement("span");
    probe.style.backgroundColor = `color-mix(in srgb, ${style.getPropertyValue("--control-hover-tint") || style.getPropertyValue("--line")} 25%, ${style.getPropertyValue(baseToken)})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, base);
}

async function openDesignSection(page, title, customize = false) {
  const builder = page.locator("[data-theme-builder]");
  const toggle = builder.getByRole("button", {
    name: new RegExp(`^\\d ${title}`),
  });
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(builder.locator("fieldset[id^=theme-step-]")).toHaveCount(1);
  const panelId = await toggle.getAttribute("aria-controls");
  await expect(page.locator(`[id="${panelId}"]`)).toHaveCSS("opacity", "1");
  if (customize) {
    const details = builder.getByRole("button", {
      name: `Customize ${title}`,
      exact: true,
    });
    if ((await details.getAttribute("aria-expanded")) !== "true")
      await details.click();
    await expect(details).toHaveAttribute("aria-expanded", "true");
    await expect(details).toHaveAttribute("aria-controls", /.+/);
    const detailsId = await details.getAttribute("aria-controls");
    await expect(page.locator(`[id="${detailsId}"]`)).toHaveCSS("opacity", "1");
  }
}

async function openDesignControls(page, id) {
  const field = id.replace(/-value$/, "");
  const title =
    field === "background" || field.endsWith("-color")
      ? "Colors"
      : field.startsWith("heading-")
        ? "Canvas heading"
        : field.startsWith("cell-") || field.startsWith("caption-")
          ? "Card headings"
          : "Layout";
  await openSidebarPanel(page, "Design");
  await openDesignSection(
    page,
    title,
    !["heading-font", "cell-font", "image-shape", "caption-position"].includes(
      field,
    ),
  );
}

async function selectField(page, id, value) {
  if (id === "reset-theme-target") {
    const choice = page.locator(`#${id} [role="radio"][data-value="${value}"]`);
    if (!(await choice.isChecked())) await choice.click();
    await expect(choice).toBeChecked();
    return;
  }
  if (["image-shape", "caption-position"].includes(id)) {
    await expect(page.locator("#board-grid")).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Editor panels", exact: true }),
    ).toBeVisible();
    const panel = await selectedSidebarPanel(page);
    const openedTools = !panel && !!(await sidebarToggle(page, false).count());
    await openSidebarPanel(page, "Design");
    await openDesignSection(
      page,
      id === "image-shape" ? "Layout" : "Card headings",
    );
    const radio = page
      .locator(`#${id}`)
      .locator(`[role="radio"][data-value="${value}"]`);
    if (!(await radio.isChecked())) await radio.click();
    await expect(radio).toBeChecked();
    if (panel) await openSidebarPanel(page, panel);
    if (openedTools) {
      await closeSidebarPanel(page);
    }
    return;
  }
  if (["heading-font", "cell-font"].includes(id)) {
    await openSidebarPanel(page, "Design");
    await openDesignSection(
      page,
      id === "heading-font" ? "Canvas heading" : "Card headings",
    );
  }
  await page.locator(`#${id}`).click();
  const option = page.getByRole("listbox").locator(`[data-value="${value}"]`);
  if ((await option.getAttribute("aria-selected")) === "true")
    await page.keyboard.press("Escape");
  else await option.click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.locator(`#${id}`)).toBeFocused();
}

async function editHeading(page, value) {
  await page.getByRole("button", { name: /^Edit grid heading: / }).click();
  const heading = page.getByRole("textbox", {
    name: "Grid heading",
    exact: true,
  });
  await heading.fill(value);
  await heading.press("Enter");
}

async function chooseImage(page, name, index = 0) {
  await page.locator(".cell-image-button").nth(index).click();
  if (await page.locator(".grid-cell").nth(index).locator("img").count())
    await page
      .locator(".grid-cell")
      .nth(index)
      .getByRole("button", { name: "Replace image", exact: true })
      .click();
  const dialog = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  if (
    !(await dialog
      .getByRole("button", { name: `Use ${name}`, exact: true })
      .isVisible())
  )
    await dialog
      .getByRole("button", { name: `Image options: ${name}`, exact: true })
      .click();
  await dialog
    .getByRole("button", { name: `Use ${name}`, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

async function selectExportField(page, id, value) {
  if (
    !(await page
      .getByRole("dialog", { name: "Export grid", exact: true })
      .isVisible())
  )
    await page.locator("#export-grid-header").click();
  await selectField(page, id, value);
}

async function beginCellUpload(page, index) {
  const image = page.locator(".cell-image-button").nth(index);
  const bounds = await image.boundingBox();
  const position = { x: bounds.width / 2, y: Math.min(20, bounds.height / 2) };
  if (await page.locator(".grid-cell").nth(index).locator("img").count()) {
    await image.click({ position });
    await page
      .getByRole("button", { name: "Replace image", exact: true })
      .click();
  } else await image.click({ position });
  const dialog = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  if (await dialog.isVisible()) {
    return dialog.locator("#picker-cell-upload");
  }
  return page.locator("#replace-upload");
}

async function uploadCellImage(page, index = 0) {
  const input = await beginCellUpload(page, index);
  await input.setInputFiles({
    name: "Fixture.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"></svg>',
    ),
  });
  await expect(
    page.getByRole("dialog", { name: "Choose image", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(".grid-cell").nth(index).locator("img"),
  ).toBeVisible();
}

for (const [mode, resizeTest] of [
  ["overlay", touchTest],
  ["native", scrollbarTest],
]) {
  resizeTest(
    `changing dimensions scrolls to the new ${mode} canvas edge`,
    async ({ page }) => {
      await page.goto("./");
      await useComicExample(page);
      await setEditorViewport(page, { width: 260, height: 560 });
      const initial = await savedWorkspace(page);
      const scroller = page.locator("[data-workspace-scroll]");
      let rows = initial.grid.rows;
      let columns = initial.grid.columns;
      for (const action of ["Add", "Remove"]) {
        for (const dimension of ["row", "column"]) {
          const button = page.getByRole("button", {
            name: `${action} ${dimension}`,
            exact: true,
          });
          await button.focus();
          await scroller.evaluate(
            (element, isRow) =>
              element.scrollTo(isRow ? 30 : 0, isRow ? 0 : 40),
            dimension === "row",
          );
          const otherAxis = dimension === "row" ? "scrollLeft" : "scrollTop";
          const originalPosition = await scroller.evaluate(
            (element, axis) => element[axis],
            otherAxis,
          );
          expect(originalPosition).toBeGreaterThan(0);
          await button.press("Enter");
          const change = action === "Add" ? 1 : -1;
          if (dimension === "row") rows += change;
          else columns += change;
          await expect(page.locator(".grid-cell")).toHaveCount(rows * columns);
          if (dimension === "row") {
            await expect
              .poll(() =>
                scroller.evaluate(
                  (element) =>
                    Math.abs(
                      element.scrollHeight -
                        element.clientHeight -
                        element.scrollTop,
                    ) <= 1,
                ),
              )
              .toBe(true);
          } else {
            await expect
              .poll(() =>
                scroller.evaluate((element) => {
                  const viewport = element
                    .querySelector("[data-canvas-viewport]")
                    .getBoundingClientRect();
                  const cells = element.querySelectorAll(".grid-cell");
                  const last = cells[cells.length - 1].getBoundingClientRect();
                  return (
                    element.scrollLeft > 0 && last.right <= viewport.right + 1
                  );
                }),
              )
              .toBe(true);
            await expect(button).toBeInViewport({ ratio: 1 });
          }
          expect(
            await scroller.evaluate(
              (element, axis) => element[axis],
              otherAxis,
            ),
          ).toBe(originalPosition);
        }
      }
    },
  );
}

for (const [mode, controlsTest] of [
  ["overlay", touchTest],
  ["native", nativeTouchTest],
  ["desktop", scrollbarTest],
]) {
  controlsTest(
    `${mode} canvas controls remain reachable by scrolling`,
    async ({ page }) => {
      await page.goto("./");
      await useComicExample(page);
      const viewports =
        mode === "desktop"
          ? [
              { width: 1440, height: 1000 },
              { width: 960, height: 600 },
              { width: 1440, height: 360 },
            ]
          : [
              { width: 526, height: 662 },
              { width: 390, height: 360 },
              { width: 320, height: 568 },
            ];
      for (const viewport of viewports) {
        await setEditorViewport(page, viewport);
        await openSidebarPanel(page, "Design");
        for (const shape of ["portrait", "landscape", "square"]) {
          await selectField(page, "image-shape", shape);
          const scroller = page.locator("[data-workspace-scroll]");
          await scroller.evaluate((element) => element.scrollTo(0, 0));
          await expect
            .poll(() =>
              page.evaluate(() => {
                const cells = document.querySelectorAll(".grid-cell");
                const last = cells[cells.length - 1].getBoundingClientRect();
                const rows = document
                  .querySelector('[aria-label="Row controls"]')
                  .getBoundingClientRect();
                return rows.top >= last.bottom;
              }),
            )
            .toBe(true);
          if (viewport.height === 360) {
            await expect
              .poll(() =>
                scroller.evaluate(
                  (element) =>
                    element
                      .querySelector('[aria-label="Row controls"]')
                      .getBoundingClientRect().bottom >
                    element.getBoundingClientRect().bottom,
                ),
              )
              .toBe(true);
          }
          await scroller.evaluate((element) =>
            element.scrollTo(0, element.scrollHeight),
          );
          await expect
            .poll(() =>
              page.evaluate(() => {
                const workspace = document
                  .querySelector("[data-workspace-scroll]")
                  .getBoundingClientRect();
                const rows = document
                  .querySelector('[aria-label="Row controls"]')
                  .getBoundingClientRect();
                const frame = document
                  .querySelector("[data-resize-frame]")
                  .getBoundingClientRect();
                const content = document
                  .querySelector("[data-preview-content]")
                  .getBoundingClientRect();
                const balanced = document
                  .querySelector("[data-resize-frame]")
                  .hasAttribute("data-balanced-controls");
                return {
                  controlsReachable:
                    rows.top >= workspace.top &&
                    rows.bottom <= workspace.bottom + 1,
                  controlsAboveTabs: rows.bottom <= workspace.bottom,
                  balancedControlSpace:
                    Math.abs(content.left - frame.left - (balanced ? 52 : 0)) <=
                      1 &&
                    (!balanced || frame.width <= workspace.width - 24 + 1),
                };
              }),
            )
            .toEqual({
              controlsReachable: true,
              controlsAboveTabs: true,
              balancedControlSpace: true,
            });
          await expect(
            page.getByRole("button", { name: "Add row", exact: true }),
          ).toBeInViewport({ ratio: 1 });
          await expect(
            page.getByRole("button", { name: "Remove row", exact: true }),
          ).toBeInViewport({ ratio: 1 });
        }
      }
    },
  );
}

test("overlay scrollbars keep compact panels and modals gutter-free", async ({
  page,
}) => {
  await page.goto("./");
  await useComicExample(page);
  await setEditorViewport(page, { width: 390, height: 720 });
  const shelfHeight = () =>
    page
      .locator("[data-editor-sidebar]")
      .evaluate((element) => element.getBoundingClientRect().height);
  const checkRow = async (row, cardSelector) => {
    await expect(row).toBeVisible();
    await expect
      .poll(() =>
        row.evaluate((element, selector) => {
          const style = getComputedStyle(element);
          const bounds = element.getBoundingClientRect();
          const card = element.querySelector(selector).getBoundingClientRect();
          return {
            top: parseFloat(style.paddingTop),
            bottom: parseFloat(style.paddingBottom),
            scrollbar: style.scrollbarWidth,
            scrollbarTakesSpace: element.offsetHeight > element.clientHeight,
            cardFills:
              Math.abs(card.top - bounds.top - 12) <= 1 &&
              Math.abs(card.bottom - bounds.top - element.clientHeight + 12) <=
                1,
          };
        }, cardSelector),
      )
      .toEqual({
        top: 12,
        bottom: 12,
        scrollbar: "none",
        scrollbarTakesSpace: false,
        cardFills: true,
      });
  };
  for (const shape of ["portrait", "landscape", "square"]) {
    await selectField(page, "image-shape", shape);
    await openSidebarPanel(page, "Images");
    await expect.poll(shelfHeight).toBeCloseTo(150, 0);
    await checkRow(page.locator("#asset-library"), "[data-library-image]");
  }
  await openSidebarPanel(page, "Design");
  await expect.poll(shelfHeight).toBeCloseTo(150, 0);
  await openDesignSection(page, "Colors");
  await page
    .getByRole("button", { name: "Customize Colors", exact: true })
    .click();
  await expect
    .poll(() =>
      page.locator("[data-editor-sidebar]").evaluate((element) => ({
        padding: getComputedStyle(element).paddingRight,
        scrollbar: getComputedStyle(element).scrollbarWidth,
        scrollable: element.scrollHeight > element.clientHeight,
        scrollbarTakesSpace: element.offsetWidth > element.clientWidth,
      })),
    )
    .toEqual({
      padding: "0px",
      scrollbar: "none",
      scrollable: true,
      scrollbarTakesSpace: false,
    });
  await setEditorViewport(page, { width: 390, height: 360 });
  await expect.poll(shelfHeight).toBeCloseTo(108, 0);
  const measureShelf = () =>
    page.locator("[data-sidebar-panels]").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const builder = element
        .querySelector('[role="tabpanel"]:not([hidden])')
        .firstElementChild.getBoundingClientRect();
      return {
        left: bounds.left,
        width: bounds.width,
        clientWidth: element.clientWidth,
        contentLeft: builder.left,
        contentRight: builder.right,
        contentWidth: builder.width,
        verticalOverflow: element.scrollHeight > element.clientHeight + 1,
        tabPadding: getComputedStyle(
          element.querySelector('[role="tabpanel"]:not([hidden])'),
        ).paddingRight,
      };
    });
  const beforeDialog = await measureShelf();
  await page.locator("#export-grid-header").click();
  const dialog = page.getByRole("dialog", {
    name: "Export grid",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect.poll(measureShelf).toEqual(beforeDialog);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(measureShelf).toEqual(beforeDialog);
  await openSidebarPanel(page, "Images");
  await expect
    .poll(() =>
      page
        .locator("[data-editor-sidebar]")
        .evaluate((element) => element.scrollHeight > element.clientHeight + 1),
    )
    .toBe(true);
  const beforeImagesDialog = await measureShelf();
  await page.locator("#export-grid-header").click();
  await expect(dialog).toBeVisible();
  await expect.poll(measureShelf).toEqual(beforeImagesDialog);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(measureShelf).toEqual(beforeImagesDialog);
});

test("overlay scrollbars cover sidebar, tab rail, modal and dropdown overflow", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 306 });
  await page.goto("./");
  await openSidebarPanel(page, "Design");
  const aside = page.locator("[data-editor-sidebar]");
  const panels = aside.locator("[data-sidebar-panels]");
  const panelControls = aside.locator("[data-panel-controls]");
  const tabs = panelControls.getByRole("tablist");
  await expect(panelControls).toHaveCSS("padding", "0px");
  await expect(panelControls).toHaveCSS("height", "44px");
  await expect(tabs).toHaveCSS("border-radius", "0px");
  await expectEditorTabBorders(tabs, false);
  expect(await tabs.boundingBox()).toEqual(await panelControls.boundingBox());
  await expect(overlayScrollbar(panels, "vertical")).toHaveCSS("opacity", "1");
  await expect(panels).toHaveCSS("scrollbar-width", "none");
  await expectStationaryScrollbars(panels);
  const sidebarHandle = overlayScrollbar(panels, "vertical").locator(
    ".os-scrollbar-handle",
  );
  const stickyBounds = await aside
    .locator("[data-sidebar-sticky]")
    .boundingBox();
  const sidebarHandleBounds = await sidebarHandle.boundingBox();
  expect(sidebarHandleBounds.y).toBeGreaterThanOrEqual(
    stickyBounds.y + stickyBounds.height,
  );
  expect(
    await sidebarHandle.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        ),
      );
    }),
  ).toBe(true);
  await sidebarHandle.hover();
  await page.mouse.move(
    sidebarHandleBounds.x + sidebarHandleBounds.width / 2,
    sidebarHandleBounds.y + sidebarHandleBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    sidebarHandleBounds.x + sidebarHandleBounds.width / 2,
    sidebarHandleBounds.y + sidebarHandleBounds.height / 2 + 30,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect
    .poll(() => panels.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await aside.locator("[data-sidebar-sticky]").boundingBox()).toEqual(
    stickyBounds,
  );
  await page.setViewportSize({ width: 1440, height: 180 });
  const headerBounds = await page.locator("[data-canvas-header]").boundingBox();
  await page.locator("#export-grid-header").click();
  const modal = page.locator("[data-modal-scroll]");
  await expect(overlayScrollbar(modal, "vertical")).toHaveCSS("opacity", "1");
  expect(
    await modal.evaluate(
      (element) => element.offsetWidth - element.clientWidth,
    ),
  ).toBe(0);
  expect(await page.locator("[data-canvas-header]").boundingBox()).toEqual(
    headerBounds,
  );
  await expectStationaryScrollbars(modal);
  const handle = overlayScrollbar(modal, "vertical").locator(
    ".os-scrollbar-handle",
  );
  await handle.hover();
  const handleBounds = await handle.boundingBox();
  await page.mouse.move(
    handleBounds.x + handleBounds.width / 2,
    handleBounds.y + handleBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBounds.x + handleBounds.width / 2,
    handleBounds.y + handleBounds.height / 2 + 50,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect
    .poll(() => modal.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("overlay-modal.png") });
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 360 });
  await openSidebarPanel(page, "Design");
  await selectField(page, "heading-font", "Bangers");
  await page.setViewportSize({ width: 1440, height: 240 });
  await page.locator("#heading-font").click();
  const listbox = page.getByRole("listbox");
  await expect
    .poll(() =>
      listbox.evaluate((node) => node.scrollHeight > node.clientHeight),
    )
    .toBe(true);
  await expect(overlayScrollbar(listbox, "vertical")).toHaveCSS("opacity", "1");
  await expectStationaryScrollbars(listbox);
  const listboxHandle = overlayScrollbar(listbox, "vertical").locator(
    ".os-scrollbar-handle",
  );
  await listboxHandle.hover();
  const listboxHandleBounds = await listboxHandle.boundingBox();
  await page.mouse.move(
    listboxHandleBounds.x + listboxHandleBounds.width / 2,
    listboxHandleBounds.y + listboxHandleBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    listboxHandleBounds.x + listboxHandleBounds.width / 2,
    listboxHandleBounds.y + listboxHandleBounds.height / 2 + 15,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect(listbox).toBeVisible();
  await expect
    .poll(() => listbox.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page.mouse.click(12, 85);
  await expect(listbox).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const targets = [
          ...document.querySelectorAll("[data-overlay-scroll]"),
        ].filter((target) =>
          ["x", "y", "both"].includes(target.dataset.overlayScroll),
        );
        return (
          document.querySelectorAll("[data-overlay-scroll-frame]").length ===
          targets.length
        );
      }),
    )
    .toBe(true);
  await page.setViewportSize({ width: 390, height: 180 });
  await expect(page.locator("[data-editor-sidebar]")).toHaveCount(1);
  const rail = page.locator("[data-panel-controls]");
  await expect(rail.locator(".os-scrollbar")).toHaveCount(0);
  await expect(
    aside.locator("[data-sidebar-panels] > .os-scrollbar"),
  ).toHaveCount(0);
  await expect(overlayScrollbar(aside, "vertical")).toHaveCSS("opacity", "1");
  await aside.evaluate((element) => element.scrollTo(0, 0));
  await expectStationaryScrollbars(aside);
  const railTop = (await rail.boundingBox()).y;
  const contentTop = (
    await aside.locator("[data-sidebar-panels]").boundingBox()
  ).y;
  const shelfBounds = await aside.boundingBox();
  await page.mouse.move(
    shelfBounds.x + shelfBounds.width / 2,
    shelfBounds.y + shelfBounds.height / 2,
  );
  await page.mouse.wheel(0, 100);
  await expect
    .poll(() => aside.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const shelfScroll = await aside.evaluate((element) => element.scrollTop);
  expect((await rail.boundingBox()).y + shelfScroll).toBeCloseTo(railTop, 1);
  expect(
    (await aside.locator("[data-sidebar-panels]").boundingBox()).y +
      shelfScroll,
  ).toBeCloseTo(contentTop, 1);
  expect(
    await rail.evaluate((element) => element.offsetWidth - element.clientWidth),
  ).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("overlay-tab-rail.png") });
  const missing = await page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .filter((element) => {
        if (
          element.closest(".os-scrollbar") ||
          element.matches("textarea, input")
        )
          return false;
        const style = getComputedStyle(element);
        return (
          ((/auto|scroll/.test(style.overflowX) &&
            element.scrollWidth > element.clientWidth + 1) ||
            (/auto|scroll/.test(style.overflowY) &&
              element.scrollHeight > element.clientHeight + 1)) &&
          !element.hasAttribute("data-overlay-scroll")
        );
      })
      .map((element) => element.id || element.className),
  );
  expect(missing).toEqual([]);
});

test("empty canvas cards identify their row and column without changing artwork", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  const addColumn = page.getByRole("button", {
    name: "Add column",
    exact: true,
  });
  while (await addColumn.isEnabled()) await addColumn.click();
  const original = await savedWorkspace(page);
  const positions = page.locator("#board-grid [data-cell-position]");
  const expected = original.grid.cells.map(
    (_, index) =>
      `${Math.floor(index / original.grid.columns) + 1}x${(index % original.grid.columns) + 1}`,
  );
  await expect(positions.locator('[aria-hidden="true"]')).toHaveText(expected);
  await expect(
    page.getByRole("button", { name: "Add image to cell 1", exact: true }),
  ).toHaveAccessibleDescription("Row 1, column 1");
  for (const shape of ["portrait", "square", "landscape"]) {
    await selectField(page, "image-shape", shape);
    for (const zoom of [50, 100, 200]) {
      await page.locator("#canvas-zoom").fill(String(zoom));
      await expect(positions.locator('[aria-hidden="true"]')).toHaveText(
        expected,
      );
      expect(
        await positions.evaluateAll((elements) =>
          elements.flatMap((element) => {
            const label = element.getBoundingClientRect();
            const card = element.closest("button").getBoundingClientRect();
            const prompt = element.parentElement
              .querySelector(".empty-cell svg")
              .getBoundingClientRect();
            const fits =
              label.left >= card.left &&
              label.top >= card.top &&
              label.right <= card.right + 1 &&
              label.bottom <= card.bottom + 1 &&
              label.top >= prompt.bottom &&
              card.right - label.right <= card.width * 0.061 &&
              card.bottom - label.bottom <= card.width * 0.031 &&
              parseFloat(getComputedStyle(element).fontSize) >= 8 &&
              getComputedStyle(element).fontWeight === "400" &&
              getComputedStyle(element).color !==
                getComputedStyle(
                  element.parentElement.querySelector(".empty-cell"),
                ).color;
            return fits
              ? []
              : [
                  {
                    text: element.textContent,
                    label: label.toJSON(),
                    card: card.toJSON(),
                    prompt: prompt.toJSON(),
                    fontSize: getComputedStyle(element).fontSize,
                  },
                ];
          }),
        ),
        `${shape} at ${zoom}%`,
      ).toEqual([]);
    }
  }
  await page.locator("#canvas-zoom").fill("100");
  await selectField(page, "image-shape", "portrait");
  await uploadCellImage(page, 0);
  await expect(positions).toHaveCount(expected.length - 1);
  await expect(page.locator("#asset-library [data-cell-position]")).toHaveCount(
    0,
  );
  await page
    .locator(".grid-cell")
    .first()
    .getByRole("button", { name: /^Cell options/ })
    .press("Enter");
  await page.getByRole("button", { name: "Clear cell", exact: true }).click();
  await expect(positions.locator('[aria-hidden="true"]')).toHaveText(expected);
  await page
    .getByRole("button", { name: "Remove column", exact: true })
    .click();
  const resized = await savedWorkspace(page);
  await expect(positions.locator('[aria-hidden="true"]')).toHaveText(
    resized.grid.cells.map(
      (_, index) =>
        `${Math.floor(index / resized.grid.columns) + 1}x${(index % resized.grid.columns) + 1}`,
    ),
  );
  await page.reload();
  for (const width of [1440, 390, 260]) {
    await setEditorViewport(page, { width, height: 844 });
    await page.locator(".grid-cell").first().scrollIntoViewIfNeeded();
    expect(
      await positions.first().evaluate((element) => {
        const label = element.getBoundingClientRect();
        const prompt = element.parentElement
          .querySelector(".empty-cell svg")
          .getBoundingClientRect();
        return label.top >= prompt.bottom;
      }),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`empty-card-coordinates-${width}.png`),
    });
  }
  expect(
    (await savedWorkspace(page)).grid.cells.every((cell) => !cell.title),
  ).toBe(true);
});

test("panel placement uses available width and height without losing selection", async ({
  page,
}) => {
  await page.goto("./");
  await openSidebarPanel(page, "Design");
  for (const [width, height, layout] of [
    [780, 720, "bottom"],
    [780, 400, "right"],
    [620, 300, "bottom"],
    [900, 720, "bottom"],
    [900, 500, "right"],
    [901, 900, "right"],
    [780, 720, "bottom"],
  ]) {
    await setEditorViewport(page, { width, height });
    await expect(page.locator("[data-sidebar-track]")).toHaveAttribute(
      "data-editor-layout",
      layout,
    );
    await expect(page.locator("[data-editor-sidebar]")).toHaveCount(1);
    await expect(
      page.getByRole("tablist", { name: "Editor panels", exact: true }),
    ).toHaveAttribute(
      "aria-orientation",
      layout === "bottom" ? "vertical" : "horizontal",
    );
    await expect(
      page.getByRole("tab", { name: "Design", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    const bounds = await page.locator("[data-editor-sidebar]").boundingBox();
    if (layout === "right") {
      expect(bounds.width).toBeCloseTo(350, 1);
      expect(bounds.x).toBeCloseTo(width - 350, 1);
      expect(bounds.y + bounds.height).toBeCloseTo(height, 1);
    } else {
      expect(bounds.width).toBeCloseTo(width, 1);
      expect(bounds.height).toBeCloseTo(Math.min(150, height * 0.3), 1);
    }
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight + 1,
      ),
    ).toBe(true);
  }
  await openSidebarPanel(page, "Images");
  for (const [height, ratio] of [
    [720, 1],
    [400, 3 / 4],
  ]) {
    await setEditorViewport(page, { width: 780, height });
    await expect(page.locator("[data-editor-sidebar]")).toHaveCount(1);
    const bounds = await page
      .locator("#asset-library [data-upload-tile]")
      .boundingBox();
    expect(bounds.width / bounds.height).toBeCloseTo(ratio, 2);
  }
});

touchTest(
  "compact shelf keeps vertical tabs reachable beside images, design and reset",
  async ({ page }) => {
    await page.goto("./");
    await useComicExample(page);
    const sidebar = page.locator("[data-editor-sidebar]");
    const tabs = sidebar.getByRole("tablist", {
      name: "Editor panels",
      exact: true,
    });
    const themes = tabs.getByRole("tab", { name: "Design", exact: true });
    const images = tabs.getByRole("tab", { name: "Images", exact: true });
    const reset = tabs.getByRole("tab", { name: "Reset", exact: true });
    await expect(tabs.getByRole("tab")).toHaveCount(3);
    for (const width of [260, 390, 780, 900]) {
      await setEditorViewport(page, { width, height: 720 });
      await expect(tabs).toHaveAttribute("aria-orientation", "vertical");
      await expectEditorTabBorders(tabs, true);
      const railBounds = await sidebar
        .locator("[data-sidebar-sticky]")
        .boundingBox();
      const tabBounds = await tabs.boundingBox();
      expect(tabBounds.y).toBeCloseTo(railBounds.y, 1);
      expect(tabBounds.height).toBeCloseTo(149, 1);
      expect(tabBounds.height).toBeCloseTo(railBounds.height, 1);
      const lastTab = await reset.boundingBox();
      expect(lastTab.y + lastTab.height).toBeCloseTo(
        tabBounds.y + tabBounds.height,
        1,
      );
      await expect(tabs.getByRole("tab").first()).toHaveAccessibleName(
        "Images",
      );
      for (const tab of [themes, images, reset]) {
        await expect(tab).toBeInViewport({ ratio: 1 });
        const bounds = await tab.boundingBox();
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
      }
      await themes.focus();
      await themes.press("ArrowUp");
      await expect(reset).toBeFocused();
      await reset.press("End");
      await expect(reset).toBeFocused();
      await reset.press("Home");
      await expect(themes).toBeFocused();
      await themes.press("Enter");
      await expect(themes).toBeDisabled();
      await expect(
        sidebar.getByRole("tabpanel", { name: "Design", exact: true }),
      ).toBeVisible();
      await expect
        .poll(() =>
          sidebar.evaluate((element) => {
            const tabs = element
              .querySelector("[role=tablist]")
              .getBoundingClientRect();
            const panels = element
              .querySelector("[data-sidebar-panels]")
              .getBoundingClientRect();
            return (
              panels.left >= tabs.right && Math.abs(panels.top - tabs.top) < 1
            );
          }),
        )
        .toBe(true);
      const builder = sidebar.locator("[data-theme-builder]");
      await openDesignSection(page, "Colors");
      const customizeColors = builder.getByRole("button", {
        name: "Customize Colors",
        exact: true,
      });
      if ((await customizeColors.getAttribute("aria-expanded")) !== "true")
        await customizeColors.click();
      await page.locator("#background-value").fill("#112233");
      await page.locator("#background-value").press("Enter");
      await openDesignSection(page, "Card headings");
      const showTitles = builder.getByRole("switch", {
        name: "Show titles",
        exact: true,
      });
      await showTitles.scrollIntoViewIfNeeded();
      await expect(showTitles).toBeInViewport();
      await images.scrollIntoViewIfNeeded();
      await expect(images).toBeInViewport({ ratio: 1 });
      await images.click();
      await expect(page.locator("#asset-library")).toBeVisible();
      expect(
        (await page.locator("#asset-library").boundingBox()).height,
      ).toBeGreaterThan(112);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await setEditorViewport(page, { width: 901, height: 900 });
    await expect(sidebar).toHaveCount(1);
    await expect(tabs).toHaveAttribute("aria-orientation", "horizontal");
    await expect(tabs.getByRole("tab").first()).toHaveAccessibleName("Images");
    await expect(images).toBeDisabled();
    await themes.focus();
    await themes.press("ArrowLeft");
    await expect(reset).toBeFocused();
    await reset.press("ArrowRight");
    await expect(themes).toBeFocused();
    await themes.press("Enter");
    await openDesignSection(page, "Colors");
    const customizeColors = page.getByRole("button", {
      name: "Customize Colors",
      exact: true,
    });
    if ((await customizeColors.getAttribute("aria-expanded")) !== "true")
      await customizeColors.click();
    await expect(page.locator("#background-value")).toHaveValue("#112233");
  },
);

touchTest(
  "compact image shelf keeps square uploads readable without changing placements",
  async ({ page }) => {
    await page.goto("./");
    await page.locator("#upload").setInputFiles(
      ["keep.svg", "unused.svg"].map((name) => ({
        name,
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#40b4aa"/></svg>',
        ),
      })),
    );
    await expect(page.locator(".asset")).toHaveCount(2);
    await chooseImage(page, "keep");
    await page.locator(".cell-heading").first().fill("Keep my caption");
    const library = page.locator("#asset-library");
    const add = library.getByRole("button", {
      name: "Add images",
      exact: true,
    });
    for (const [width, shape, ratio, height] of [
      [260, "portrait", 3 / 4, 720],
      [390, "landscape", 4 / 3, 720],
      [780, "square", 1, 720],
      [900, "portrait", 3 / 4, 720],
      [390, "portrait", 3 / 4, 240],
    ]) {
      await setEditorViewport(page, { width, height: 720 });
      await selectField(page, "image-shape", shape);
      if (height !== 720) await setEditorViewport(page, { width, height });
      await library.evaluate((element) => {
        element.scrollLeft = 0;
      });
      expect(
        (await page.locator("[data-editor-sidebar]").boundingBox()).height,
      ).toBeCloseTo(Math.min(150, height * 0.3), 1);
      if (height * 0.3 < 150) {
        const panels = page.locator("[data-editor-sidebar]");
        await expect(library).toHaveCSS("height", "149px");
        await expect
          .poll(() =>
            panels.evaluate(
              (element) => element.scrollHeight > element.clientHeight,
            ),
          )
          .toBe(true);
        const panelBounds = await panels.boundingBox();
        await page.mouse.move(
          panelBounds.x + panelBounds.width / 2,
          panelBounds.y + panelBounds.height / 2,
        );
        await page.mouse.wheel(0, 100);
        await expect
          .poll(() => panels.evaluate((element) => element.scrollTop))
          .toBeGreaterThan(0);
        await expect(overlayScrollbar(panels, "vertical")).toHaveCSS(
          "opacity",
          "1",
        );
        await expect(add).toBeInViewport();
      } else {
        await expect(add).toBeInViewport({ ratio: 1 });
      }
      const uploadBounds = await add.boundingBox();
      expect(uploadBounds.height).toBeCloseTo(125, 1);
      expect(uploadBounds.width).toBeCloseTo(uploadBounds.height, 1);
      for (const [index, label] of (
        await add.locator("[data-upload-label]").all()
      ).entries()) {
        expect(
          await label.evaluate((element) =>
            parseFloat(getComputedStyle(element).fontSize),
          ),
        ).toBeCloseTo(uploadBounds.width * [0.085, 0.07][index], 1);
        const labelBounds = await label.boundingBox();
        expect(labelBounds.x).toBeGreaterThanOrEqual(uploadBounds.x);
        expect(labelBounds.y).toBeGreaterThanOrEqual(uploadBounds.y);
        expect(labelBounds.x + labelBounds.width).toBeLessThanOrEqual(
          uploadBounds.x + uploadBounds.width,
        );
        expect(labelBounds.y + labelBounds.height).toBeLessThanOrEqual(
          uploadBounds.y + uploadBounds.height,
        );
      }
      const imageBounds = await page
        .locator(".grid-cell")
        .first()
        .locator("[data-card-image]")
        .boundingBox();
      expect(
        Math.abs(imageBounds.width - imageBounds.height * ratio),
      ).toBeLessThan(1);
      const tabs = await page
        .getByRole("tablist", { name: "Editor panels", exact: true })
        .boundingBox();
      const shelf = await library.boundingBox();
      expect(shelf.x - (tabs.x + tabs.width)).toBeLessThan(16);
      expect(shelf.width).toBeGreaterThanOrEqual(width - tabs.width - 16);
      await expect(
        library.getByRole("button", { name: /Reset|Clear images/ }),
      ).toHaveCount(0);
      await expect(
        page
          .locator("[data-editor-sidebar]")
          .getByRole("heading", { name: "My images", exact: true }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await setEditorViewport(page, { width: 901, height: 900 });
    await expect(library).toHaveCount(1);
    await expect(
      library
        .locator(":scope > :first-child")
        .getByRole("button", { name: "Add images", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".grid-cell img")).toHaveCount(1);
    await expect(page.locator(".cell-heading").first()).toHaveValue(
      "Keep my caption",
    );
    await reloadWorkspace(page);
    await expect(page.locator(".asset")).toHaveCount(2);
    await expect(page.locator(".grid-cell img")).toHaveCount(1);
    await expect(page.locator(".cell-heading").first()).toHaveValue(
      "Keep my caption",
    );
  },
);

for (const failure of ["malformed", "blocked"]) {
  test(`editor navigation tolerates ${failure} preference storage`, async ({
    page,
  }) => {
    await page.addInitScript((failure) => {
      if (failure === "malformed")
        localStorage.setItem("grids-ui-v1", "{broken");
      else {
        const getItem = Storage.prototype.getItem;
        const setItem = Storage.prototype.setItem;
        Storage.prototype.getItem = function (key) {
          if (key === "grids-ui-v1")
            throw new DOMException("Unavailable", "SecurityError");
          return getItem.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
          if (key === "grids-ui-v1")
            throw new DOMException("Unavailable", "QuotaExceededError");
          return setItem.call(this, key, value);
        };
      }
    }, failure);
    await page.goto("./?source=invalid&panel=invalid&offset=-1");
    await expect(page.locator("#board-grid")).toBeVisible();
    await expect(page.locator("#asset-library")).toBeVisible();
    await openSidebarPanel(page, "Design");
    await page.reload();
    await expect(
      page.getByRole("tab", { name: "Design", exact: true }),
    ).toBeDisabled();
    await expect(page.locator("#board-grid")).toBeVisible();
  });
}

test("canvas zoom keeps fixed card sizes across shapes and viewports", async ({
  page,
}, testInfo) => {
  await setEditorViewport(page, { width: 1440, height: 900 });
  await page.goto("./");
  const zoom = page.getByRole("slider", { name: "Zoom", exact: true });
  const card = page.locator("#board-grid > .grid-cell").first();
  const checkZoomLayout = async () => {
    const field = zoom.locator("..");
    await expect(field).toHaveClass(/flex-col/);
    await expect(field).toHaveCSS("row-gap", "0px");
    await expect(zoom).toHaveCSS("height", "32px");
    await expect(field.locator("label")).toHaveClass(/field-label/);
    const bare =
      (await page
        .locator("[data-canvas-header]")
        .getAttribute("data-bare-zoom")) === "true";
    await expect(field.locator("label")).toHaveCSS(
      "padding-left",
      bare ? "0px" : "8px",
    );
    await expect(field.locator("label")).toHaveCSS(
      "padding-right",
      bare ? "0px" : "8px",
    );
    if (bare)
      await expect(field.locator("label")).toHaveCSS("position", "absolute");
    await expect
      .poll(() =>
        field.evaluate((element) => {
          const label = element.querySelector("label").getBoundingClientRect();
          const slider = element.querySelector("input").getBoundingClientRect();
          const output = element
            .querySelector("output")
            .getBoundingClientRect();
          const field = element.getBoundingClientRect();
          const header = element.closest("header").getBoundingClientRect();
          const action = element
            .closest("header")
            .querySelector("#export-grid-header")
            .getBoundingClientRect();
          return (
            (element.closest("header").hasAttribute("data-bare-zoom")
              ? Math.abs(
                  slider.y + slider.height / 2 - header.y - header.height / 2,
                ) < 1
              : label.bottom <= slider.top &&
                Math.abs(output.right - field.right + 8) < 1) &&
            Math.abs(
              field.y + field.height / 2 - header.y - header.height / 2,
            ) < 1 &&
            Math.abs(
              action.y + action.height / 2 - header.y - header.height / 2,
            ) < 1
          );
        }),
      )
      .toBe(true);
  };
  const checkWidth = async (width) => {
    await expect
      .poll(async () => (await card.boundingBox()).width)
      .toBeCloseTo(width, 1);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const workspace = document.querySelector("[data-workspace-scroll]");
          const area = workspace.querySelector(".canvas-area");
          const frame = area.querySelector("[data-resize-frame]");
          const boardWidth = parseFloat(
            frame.style.getPropertyValue("--preview-board-width"),
          );
          const balanced = boardWidth + 104 <= area.clientWidth - 24;
          const canvas = frame
            .querySelector("[data-preview-content]")
            .getBoundingClientRect();
          const bounds = workspace.getBoundingClientRect();
          return (
            frame.hasAttribute("data-balanced-controls") === balanced &&
            (!balanced ||
              Math.abs(
                canvas.x + canvas.width / 2 - bounds.x - bounds.width / 2,
              ) < 1)
          );
        }),
      )
      .toBe(true);
  };
  await expect(zoom).toHaveValue("100");
  await expect(zoom).toHaveAttribute("min", "50");
  await expect(zoom).toHaveAttribute("max", "200");
  await checkZoomLayout();
  for (const [shape, width] of [
    ["portrait", 100],
    ["landscape", 100 * (16 / 9)],
    ["square", 100 * (4 / 3)],
  ]) {
    await selectField(page, "image-shape", shape);
    await checkWidth(width);
    await zoom.fill("50");
    await checkWidth(width / 2);
    await zoom.fill("200");
    await checkWidth(width * 2);
    await page.locator("#export-grid-header").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const exportSummary = await dialog.innerText();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await zoom.fill("50");
    await page.locator("#export-grid-header").click();
    await expect(dialog).toBeVisible();
    expect(await dialog.innerText()).toBe(exportSummary);
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await zoom.fill("100");
    await zoom.fill("100");
  }
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await checkWidth(100 * (4 / 3));
  await page.screenshot({
    path: testInfo.outputPath("canvas-zoom-desktop.png"),
  });
  for (const viewport of [
    { width: 960, height: 360 },
    { width: 390, height: 844 },
    { width: 260, height: 560 },
  ]) {
    await setEditorViewport(page, viewport);
    await checkWidth(100 * (4 / 3));
    await expect(zoom).toBeInViewport({ ratio: 1 });
    await expect(page.locator("#export-grid-header")).toBeInViewport({
      ratio: 1,
    });
    await checkZoomLayout();
    await zoom.fill("50");
    await checkWidth(100 * (2 / 3));
    await zoom.fill("200");
    await checkWidth(100 * (8 / 3));
    await zoom.fill("100");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  const headerSizes = [
    [1440, 160, false],
    [560, 160, false],
    [500, 160, false],
    [450, 160, true],
    [449, 160, true],
    [400, 160, true],
    [390, 160, true],
    [320, null, true],
    [310, null, true],
    [300, null, true],
    [280, null, true],
    [270, null, true],
    [260, null, true],
    [250, null, true],
    [240, null, true],
    [220, null, true],
  ];
  for (const [width, zoomWidth, compactExport] of [
    ...headerSizes,
    ...[...headerSizes].reverse(),
  ]) {
    await setEditorViewport(page, { width, height: 844 });
    if (zoomWidth === null) {
      const sizing = await zoom.evaluate((element) => {
        const header = element.closest("header");
        const brand = header.querySelector(".brand").getBoundingClientRect();
        const actions = header
          .querySelector('[role="group"]')
          .getBoundingClientRect();
        const controls = header.querySelector("[data-canvas-controls]");
        const gap = parseFloat(getComputedStyle(controls).columnGap);
        return {
          actual: element.parentElement.getBoundingClientRect().width,
          expected: Math.min(
            160,
            Math.max(32, actions.left - brand.right - gap * 2),
          ),
        };
      });
      expect(sizing.actual).toBeCloseTo(sizing.expected, 1);
      expect(sizing.actual).toBeGreaterThan(32);
      expect(sizing.actual).toBeLessThan(160);
      await expect(page.locator("[data-canvas-header]")).toHaveAttribute(
        "data-header-layout",
        sizing.expected < 80 ? "bare" : "shifted",
      );
    } else {
      await expect(zoom.locator("..")).toHaveCSS("width", `${zoomWidth}px`);
    }
    const bare =
      (await page
        .locator("[data-canvas-header]")
        .getAttribute("data-bare-zoom")) === "true";
    await expect(zoom.locator("..")).toHaveCSS(
      "min-width",
      bare ? "32px" : "80px",
    );
    await expect(zoom.locator("..")).toHaveCSS("max-width", "160px");
    await expect
      .poll(() =>
        page
          .locator("[data-canvas-header]")
          .getAttribute("data-compact-export"),
      )
      .toBe(compactExport ? "true" : null);
    await expect(
      page.locator("[data-header-brand] [data-brand-label]"),
    ).toHaveCSS("position", compactExport ? "absolute" : "static");
    await expect(page.locator("#export-grid-header > span")).toHaveCSS(
      "position",
      compactExport ? "absolute" : "static",
    );
    await expect(page.locator("[data-header-brand]")).toHaveAttribute(
      "aria-hidden",
      "false",
    );
    await expect(
      page.getByRole("link", { name: "Gridz", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(sidebarToggle(page, true)).toBeInViewport({ ratio: 1 });
    expect(
      await zoom.evaluate((element) => {
        const header = element.closest("header");
        const brand = header.querySelector(".brand");
        const brandBounds = brand.getBoundingClientRect();
        const controls = header.querySelector("[data-canvas-controls]");
        const controlsBounds = element.parentElement.getBoundingClientRect();
        const actionsBounds = header
          .querySelector('[role="group"]')
          .getBoundingClientRect();
        const gap = parseFloat(getComputedStyle(controls).columnGap);
        return {
          logoHit:
            document
              .elementFromPoint(
                brandBounds.x + brandBounds.width / 2,
                brandBounds.y + brandBounds.height / 2,
              )
              ?.closest(".brand") === brand,
          separated: controlsBounds.left + 0.1 >= brandBounds.right + gap,
          besideExport:
            Math.abs(actionsBounds.left - controlsBounds.right - gap) < 1,
          noScroll:
            controls.scrollWidth <= controls.clientWidth &&
            header.scrollWidth <= header.clientWidth,
          transparentControls:
            getComputedStyle(controls).backgroundColor === "rgba(0, 0, 0, 0)",
        };
      }),
    ).toEqual({
      logoHit: true,
      separated: true,
      besideExport: true,
      noScroll: true,
      transparentControls: true,
    });
    await checkZoomLayout();
    const frameStates = await zoom.evaluate(async (element) => {
      const header = element.closest("header");
      const states = [];
      for (let frame = 0; frame < 8; frame++) {
        await new Promise(requestAnimationFrame);
        states.push(
          [
            getComputedStyle(element.parentElement).width,
            header.dataset.compactExport ?? "false",
            header.dataset.headerLayout,
          ].join("/"),
        );
      }
      return [...new Set(states)];
    });
    expect(frameStates).toHaveLength(1);
  }
  await setEditorViewport(page, { width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("canvas-zoom-mobile.png"),
  });
  const historyLength = await page.evaluate(() => history.length);
  await zoom.fill("75");
  await checkWidth(100);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await reloadWorkspace(page);
  await expect(zoom).toHaveValue("75");
  await checkWidth(100);
});

test("canvas padding keeps overflow inside its viewport on short and narrow screens", async ({
  page,
}, testInfo) => {
  await setEditorViewport(page, { width: 1440, height: 1000 });
  await page.goto("./");
  await openSidebarPanel(page, "Design");
  await selectField(page, "image-shape", "square");
  for (const [id, initial] of [
    ["canvas-padding", "30"],
    ["gap", "20"],
  ]) {
    await openDesignControls(page, id);
    await expect(page.locator(`#${id}`)).toHaveValue(initial);
    await expect(page.locator(`#${id}`)).toHaveAttribute("max", "100");
    await page.locator(`#${id}`).fill("100");
  }
  for (const size of [
    { width: 1440, height: 360 },
    { width: 960, height: 360 },
    { width: 390, height: 560 },
    { width: 260, height: 560 },
  ]) {
    await setEditorViewport(page, size);
    await expect
      .poll(
        async () =>
          (await page.locator("#board-grid > .grid-cell").first().boundingBox())
            .width,
      )
      .toBeCloseTo(100 / (3 / 4), 1);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const workspace = document.querySelector(".workspace");
          const canvas = document.querySelector(".canvas-area");
          const frame = document
            .querySelector("[data-resize-frame]")
            .getBoundingClientRect();
          const bounds = canvas.getBoundingClientRect();
          const scroller = document.querySelector("[data-workspace-scroll]");
          return {
            workspaceHeight:
              workspace.scrollHeight <= workspace.clientHeight + 1,
            workspaceWidth: workspace.scrollWidth <= workspace.clientWidth + 1,
            pageWidth: document.documentElement.scrollWidth <= innerWidth,
            pageHeight:
              document.documentElement.scrollHeight <= innerHeight + 1,
            frameReachable:
              frame.bottom <=
              bounds.bottom -
                parseFloat(getComputedStyle(canvas).paddingBottom) +
                scroller.scrollHeight -
                scroller.clientHeight +
                1,
          };
        }),
      )
      .toEqual({
        workspaceHeight: true,
        workspaceWidth: true,
        pageWidth: true,
        pageHeight: true,
        frameReachable: true,
      });
    const workspace = page.getByRole("region", {
      name: "Grid editor",
      exact: true,
    });

    const scroller = page.locator("[data-workspace-scroll]");
    await expect
      .poll(() =>
        scroller.evaluate(
          (element) => element.scrollHeight > element.clientHeight,
        ),
      )
      .toBe(true);
    const initialScrollTop = await scroller.evaluate(
      (element) => element.scrollTop,
    );
    const heading = await page.locator(".board-export-heading").boundingBox();
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    const scrollTop = await scroller.evaluate((element) => element.scrollTop);
    await expect
      .poll(
        async () =>
          (await page.locator(".board-export-heading").boundingBox()).y,
      )
      .toBeCloseTo(heading.y - (scrollTop - initialScrollTop), 0);
    expect(
      await workspace.evaluate((element) => ({
        top: element.scrollTop,
        left: element.scrollLeft,
      })),
    ).toEqual({ top: 0, left: 0 });
  }
  await page.screenshot({
    path: testInfo.outputPath("canvas-only-scroll-narrow.png"),
  });
  await expect
    .poll(async () => {
      const { grid } = (await localDatabase(page)).document;
      return { gap: grid.gap, padding: grid.canvasPadding };
    })
    .toEqual({ gap: 120, padding: 120 });
  await page.reload();
  await openSidebarPanel(page, "Design");
  await openDesignControls(page, "canvas-padding");
  await expect(page.locator("#canvas-padding")).toHaveValue("100");
  await openDesignControls(page, "gap");
  await expect(page.locator("#gap")).toHaveValue("100");
});

test("brand keyboard focus rings only the rounded icon", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  for (const width of [1440, 260, 220, 390]) {
    await setEditorViewport(page, { width, height: 844 });
    const brand = page.getByRole("link", { name: "Gridz", exact: true });
    await expect(brand.locator(".brand-mark")).toHaveCSS("width", "44px");
    await expect(brand.locator(".brand-mark")).toHaveCSS("height", "44px");
    await expect(sidebarToggle(page, true)).toHaveCSS("width", "44px");
    await expect(sidebarToggle(page, true)).toHaveCSS("height", "44px");
    await tabThroughTo(page, brand);
    await expect(brand).toHaveAttribute("href", "./");
    expect(
      await brand.evaluate((element) => {
        const icon = element.querySelector(".brand-mark");
        const style = getComputedStyle(icon);
        const bounds = icon.getBoundingClientRect();
        return {
          keyboardFocus: element.matches(":focus-visible"),
          linkOutline: getComputedStyle(element).outlineStyle,
          iconOutline: style.outlineStyle,
          iconOutlineWidth: style.outlineWidth,
          iconOutlineOffset: style.outlineOffset,
          iconRadius: style.borderRadius,
          textOutline: getComputedStyle(
            element.querySelector("[data-brand-label]"),
          ).outlineStyle,
          contained:
            bounds.left >= 4 &&
            bounds.top >= 4 &&
            bounds.right + 4 <= innerWidth,
        };
      }),
    ).toEqual({
      keyboardFocus: true,
      linkOutline: "none",
      iconOutline: "solid",
      iconOutlineWidth: "2px",
      iconOutlineOffset: "2px",
      iconRadius: "4px",
      textOutline: "none",
      contained: true,
    });
    await page.screenshot({
      path: testInfo.outputPath(`brand-focus-${width}.png`),
    });
  }
  await Promise.all([
    page.waitForEvent("framenavigated"),
    page.getByRole("link", { name: "Gridz", exact: true }).press("Enter"),
  ]);
  await expect(page.locator("#board-grid")).toBeVisible();
});

test("slider keyboard focus rings the thumb without clipping", async ({
  page,
}, testInfo) => {
  const thumbRing = async (slider) =>
    slider.evaluate(
      async (element, image) => {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${image}`)).blob(),
        );
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        const reference = document.createElement("canvas").getContext("2d");
        reference.fillStyle =
          getComputedStyle(element).getPropertyValue("--accent");
        reference.fillRect(0, 0, 1, 1);
        const accent = reference.getImageData(0, 0, 1, 1).data;
        reference.fillStyle =
          getComputedStyle(element).getPropertyValue("--line");
        reference.fillRect(0, 0, 1, 1);
        const line = reference.getImageData(0, 0, 1, 1).data;
        reference.fillStyle = getComputedStyle(
          element.closest("header") ?? element.closest("[data-editor-sidebar]"),
        ).backgroundColor;
        reference.fillRect(0, 0, 1, 1);
        const surface = reference.getImageData(0, 0, 1, 1).data;
        const hasColor = (pixelX, pixelY, color, tolerance = 10) => {
          for (let offsetY = -1; offsetY <= 1; offsetY++) {
            for (let offsetX = -1; offsetX <= 1; offsetX++) {
              const sampleX = Math.max(
                0,
                Math.min(canvas.width - 1, Math.round(pixelX + offsetX)),
              );
              const sampleY = Math.max(
                0,
                Math.min(canvas.height - 1, Math.round(pixelY + offsetY)),
              );
              const pixel = context.getImageData(sampleX, sampleY, 1, 1).data;
              if (
                [0, 1, 2].every(
                  (channel) =>
                    Math.abs(pixel[channel] - color[channel]) < tolerance,
                )
              )
                return true;
            }
          }
          return false;
        };
        const hasAccent = (pixelX, pixelY) => hasColor(pixelX, pixelY, accent);
        const bounds = element.getBoundingClientRect();
        const ratio =
          (Number(element.value) - Number(element.min)) /
          (Number(element.max) - Number(element.min));
        const centerX =
          ((13 + (bounds.width - 26) * ratio) * canvas.width) / bounds.width;
        const centerY = canvas.height / 2;
        const ringRadius = (11 * canvas.height) / bounds.height;
        const gapRadius = (9 * canvas.width) / bounds.width;
        const handleColor = context.getImageData(
          Math.round(centerX),
          Math.floor(centerY),
          1,
          1,
        ).data;
        const trackX =
          ((4 + ((bounds.width - 8) * ratio) / 3) * canvas.width) /
          bounds.width;
        const trackColor = context.getImageData(
          Math.round(trackX),
          Math.floor(centerY),
          1,
          1,
        ).data;
        return {
          leftGap: hasColor(centerX - gapRadius, centerY, surface),
          rightGap: hasColor(centerX + gapRadius, centerY, surface),
          filledTrackMatchesHandle:
            ratio > 0
              ? [0, 1, 2].every(
                  (channel) =>
                    Math.abs(handleColor[channel] - trackColor[channel]) < 3,
                )
              : null,
          handleBorder: hasColor(
            centerX,
            centerY - (8 * canvas.height) / bounds.height,
            line,
            25,
          ),
          top: hasAccent(centerX, centerY - ringRadius),
          bottom: hasAccent(centerX, centerY + ringRadius),
          endpoint:
            ratio === 0
              ? hasAccent(1, centerY)
              : ratio === 1
                ? hasAccent(canvas.width - 2, centerY)
                : true,
          corner: hasAccent(0, 0),
        };
      },
      (await slider.screenshot()).toString("base64"),
    );
  await page.goto("./");
  for (const width of [1440, 390, 260]) {
    await setEditorViewport(page, { width, height: 1000 });
    await expect(page.locator("[data-editor-sidebar]")).toHaveCount(1);
    for (const id of ["canvas-zoom", "cell-font-weight", "cell-font-size"]) {
      if (id !== "canvas-zoom") await openDesignControls(page, id);
      const slider = page.locator(`#${id}`);
      await slider.scrollIntoViewIfNeeded();
      await tabThroughTo(page, slider, 60);
      await expect(slider).toBeFocused();
      await expect(slider).toBeInViewport({ ratio: 1 });
      const focus = await slider.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          visible: element.matches(":focus-visible"),
          outline: style.outlineStyle,
          padding: parseFloat(style.paddingLeft),
          height: element.getBoundingClientRect().height,
        };
      });
      expect(focus).toMatchObject({
        visible: true,
        outline: "none",
        padding: 4,
        height: 32,
      });
      const minimum = Number(await slider.getAttribute("min"));
      const maximum = Number(await slider.getAttribute("max"));
      for (const value of [minimum, (minimum + maximum) / 2, maximum]) {
        await slider.fill(String(value));
        await slider.press(value === minimum ? "ArrowLeft" : "ArrowRight");
        if (value !== minimum && value !== maximum)
          await slider.press("ArrowLeft");
        const painted = await thumbRing(slider);
        expect(painted).toMatchObject({
          leftGap: true,
          rightGap: true,
          handleBorder: true,
          top: true,
          bottom: true,
          endpoint: true,
          corner: false,
        });
        if (value > minimum)
          expect(painted.filledTrackMatchesHandle).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`slider-thumb-${id}-${width}-${value}.png`),
        });
      }
      await page.keyboard.press("Tab");
      await slider.click();
      await expect(slider).toBeFocused();
      expect(
        await slider.evaluate((element) => element.matches(":focus-visible")),
      ).toBe(false);
      expect(await thumbRing(slider)).toMatchObject({
        handleBorder: true,
        top: false,
        bottom: false,
      });
    }
  }
});

test("settings sliders use normalized percentages and refined dark defaults", async ({
  page,
}) => {
  await page.goto("./");
  const sliderIds = [
    "canvas-padding",
    "gap",
    "corner-rounding",
    "heading-font-size",
    "heading-padding",
    "heading-font-weight",
    "cell-font-size",
    "cell-font-weight",
    "caption-opacity",
  ];
  expect(sliderIds).toHaveLength(9);
  for (const id of sliderIds) {
    await openDesignControls(page, id);
    const slider = page.locator(`#${id}`);
    const value =
      {
        "cell-font-size": "20",
        "caption-opacity": "75",
        "corner-rounding": "25",
        "canvas-padding": "30",
        gap: "20",
      }[id] ?? "50";
    await expect(slider).toHaveAttribute("min", "0");
    await expect(slider).toHaveAttribute("max", "100");
    await expect(slider).toHaveValue(value);
    await expect(slider.locator("..").locator("output")).toHaveText(
      id.endsWith("font-weight") ? "500" : `${value}%`,
    );
  }
  await openDesignControls(page, "canvas-padding");
  const padding = page.locator("#canvas-padding");
  await padding.click();
  await expect(padding).toBeFocused();

  const bounds = await padding.boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.7,
    bounds.y + bounds.height / 2,
    { steps: 4 },
  );

  await page.mouse.up();

  await padding.press("Tab");
  const gap = page.locator("#gap");
  await expect(gap).toBeFocused();

  await gap.press("ArrowRight");

  await openDesignControls(page, "cell-font-size");
  await page.locator("#cell-font-size").fill("100");
  expect((await savedWorkspace(page)).grid.cellFontSize).toBe(36);
  for (const [id, percent] of [
    ["canvas-padding", 100],
    ["gap", 0],
    ["corner-rounding", 100],
    ["heading-font-size", 100],
    ["heading-padding", 100],
    ["cell-font-size", 0],
    ["heading-font-weight", 0],
    ["cell-font-weight", 100],
    ["caption-opacity", 0],
  ]) {
    await openDesignControls(page, id);
    await page.locator(`#${id}`).fill(String(percent));
    const output =
      id === "heading-font-weight"
        ? "100"
        : id === "cell-font-weight"
          ? "900"
          : `${percent}%`;
    await expect(
      page.locator(`#${id}`).locator("..").locator("output"),
    ).toHaveText(output);
  }
  expect((await savedWorkspace(page)).grid).toMatchObject({
    canvasPadding: 120,
    gap: 0,
    cornerRadius: 25,
    headingFontSize: 36,
    headingPadding: 60,
    cellFontSize: 6,
    headingFontWeight: 100,
    cellFontWeight: 900,
    captionOverlayOpacity: 0,
  });
  await reloadWorkspace(page);
  await openDesignControls(page, "canvas-padding");
  await expect(page.locator("#canvas-padding")).toHaveValue("100");
  await openDesignControls(page, "cell-font-size");
  await expect(page.locator("#cell-font-size")).toHaveValue("0");
  await openDesignControls(page, "heading-padding");
  await expect(page.locator("#heading-padding")).toHaveValue("100");
  await page.locator("#export-grid-header").click();
  await selectField(page, "format", "image/jpeg");
  const quality = page.locator("#quality");
  await expect(quality).toHaveAttribute("min", "0");
  await expect(quality).toHaveAttribute("max", "100");
  await expect(quality).toHaveValue("90");
  await expect(page.locator("#quality-value")).toHaveText("90%");
  expect((await savedWorkspace(page)).exportSettings.quality).toBe(95);
  await quality.fill("0");
  expect((await savedWorkspace(page)).exportSettings.quality).toBe(50);
  await quality.fill("100");
  expect((await savedWorkspace(page)).exportSettings.quality).toBe(100);
});

test("corner rounding is shared by headings, cards, pickers and exports", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("./");
  await uploadCellImage(page);
  await editHeading(page, "Rounded heading");
  await openDesignControls(page, "corner-rounding");
  const canvasStyle = page.getByRole("group", {
    name: "Canvas style",
    exact: true,
  });
  const rounding = canvasStyle.getByRole("slider", {
    name: /^Corner rounding/,
  });
  await expect(rounding).toHaveValue("25");
  async function checkRounding(cards, percent) {
    await expect(cards.first()).toBeVisible();
    for (const card of await cards.all()) {
      expect(
        await card.evaluate((element, percent) => {
          const bounds = element.getBoundingClientRect();
          const radii =
            getComputedStyle(element).borderTopLeftRadius.split(" ");
          const horizontal = radii[0].endsWith("%")
            ? (parseFloat(radii[0]) * bounds.width) / 100
            : parseFloat(radii[0]);
          const verticalValue = radii[1] ?? radii[0];
          const vertical = verticalValue.endsWith("%")
            ? (parseFloat(verticalValue) * bounds.height) / 100
            : parseFloat(verticalValue);
          const expected = (bounds.width * percent) / 100;
          return Math.max(
            Math.abs(horizontal - expected),
            Math.abs(vertical - expected),
          );
        }, percent),
      ).toBeLessThan(1);
    }
  }
  await expect(
    page
      .getByRole("group", { name: "Card style", exact: true })
      .locator("#corner-rounding"),
  ).toHaveCount(0);
  for (const [id, value] of [
    ["background-value", "#17191b"],
    ["heading-background-color-value", "#ed1d24"],
    ["cell-background-color-value", "#0085c7"],
  ]) {
    await openDesignControls(page, id);
    await page.locator(`#${id}`).fill(value);
    await page.locator(`#${id}`).press("Tab");
  }
  for (const radius of [12, 0]) {
    await openDesignControls(page, "corner-rounding");
    await rounding.fill(String(radius * 4));
    await reloadWorkspace(page);
    await openDesignControls(page, "corner-rounding");
    await expect(rounding).toHaveValue(String(radius * 4));
    await expect(
      canvasStyle.locator('label[for="corner-rounding"] output'),
    ).toHaveText(`${radius * 4}%`);
    await checkRounding(page.locator(".grid-cell"), radius);
    const headingRadius = await page
      .locator(".board-export-heading")
      .evaluate((heading) =>
        parseFloat(getComputedStyle(heading).borderTopLeftRadius),
      );
    const cardWidth = await page
      .locator(".grid-cell")
      .first()
      .evaluate((card) => card.getBoundingClientRect().width);
    expect(headingRadius).toBeCloseTo((cardWidth * radius) / 100, 0);
    const grid = (await savedWorkspace(page)).grid;
    expect(grid.cornerRadius).toBe(radius);
    for (const size of [150, 300]) {
      await selectExportField(page, "resolution", String(size));
      const download = await downloadBoard(page);
      const bytes = [...(await readFile(await download.path()))];
      const pixels = await page.evaluate(
        async ({ bytes, grid, size }) => {
          const bitmap = await createImageBitmap(
            new Blob([new Uint8Array(bytes)]),
          );
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext("2d");
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          const padding = Math.round(((grid.canvasPadding ?? 12) * size) / 600);
          const gap = Math.round((grid.gap * size) / 600);
          const top =
            padding +
            Math.round(
              size *
                (Math.max(0.28, (grid.headingFontSize ?? 21) * 0.014) +
                  (grid.headingPadding ?? 30) / 300),
            ) +
            gap;
          return [
            [padding, padding],
            [canvas.width / 2, padding + 1],
            [padding, top],
            [padding + size / 2, top + 1],
          ].map(([left, top]) => [
            ...context.getImageData(left, top, 1, 1).data,
          ]);
        },
        { bytes, grid, size },
      );
      expect(pixels).toEqual([
        radius ? [23, 25, 27, 255] : [237, 29, 36, 255],
        [237, 29, 36, 255],
        radius ? [23, 25, 27, 255] : [0, 133, 199, 255],
        [0, 133, 199, 255],
      ]);
    }
  }
  await openDesignControls(page, "corner-rounding");
  await rounding.fill("48");
  for (const width of [1440, 390]) {
    await setEditorViewport(page, { width, height: 1000 });
    if (width > 900) {
      await openSidebarPanel(page, "Images");
      await checkRounding(page.locator("#asset-library .image-card"), 12);
    }
    await page.locator(".cell-image-button").nth(1).click();
    const picker = page.getByRole("dialog", {
      name: "Choose image",
      exact: true,
    });
    await checkRounding(picker.locator("[data-library-image] .image-card"), 12);
    await page.screenshot({
      path: testInfo.outputPath(`shared-rounding-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
  }
  await openSidebarPanel(page, "Design");
  await openDesignSection(page, "Canvas heading");
  await page.getByRole("switch", { name: "Show heading", exact: true }).click();
  await openDesignSection(page, "Card headings");
  await page.getByRole("switch", { name: "Show titles", exact: true }).click();
  await openDesignControls(page, "corner-rounding");
  await expect(rounding).toBeVisible();
});

test("appearance choices support keyboard selection on narrow and desktop screens", async ({
  page,
}, testInfo) => {
  for (const width of [1440, 390, 260]) {
    await setEditorViewport(page, { width, height: 1000 });
    await page.goto("./");
    await openSidebarPanel(page, "Design");
    await openDesignSection(page, "Layout");
    const shapes = page.getByRole("radiogroup", {
      name: "Shape",
      exact: true,
    });
    const headings = page.getByRole("radiogroup", {
      name: "Card heading",
      exact: true,
    });
    await expect(shapes.getByRole("radio")).toHaveCount(3);
    await expect(page.locator("#theme-step-1 #image-shape")).toHaveCount(1);
    await expect(
      page
        .getByRole("group", { name: "Canvas style", exact: true })
        .locator("#image-shape"),
    ).toHaveCount(0);
    await openDesignSection(page, "Card headings");
    await expect(headings.getByRole("radio")).toHaveCount(4);
    await openDesignSection(page, "Layout");
    await expect(
      page.getByRole("toolbar", { name: "Grid appearance" }),
    ).toHaveCount(0);
    for (const name of ["Canvas style", "Canvas heading style", "Card style"]) {
    }
    const portrait = shapes.getByRole("radio", {
      name: "Portrait",
      exact: true,
    });
    if (!(await portrait.isChecked())) await portrait.click();
    await expect(portrait).toBeDisabled();
    await expect(portrait).toHaveJSProperty("disabled", true);

    await expect(portrait).toHaveAttribute("tabindex", "-1");
    const landscape = shapes.getByRole("radio", {
      name: "Landscape",
      exact: true,
    });
    await expect(landscape).toBeEnabled();
    await tabThroughTo(page, landscape);
    const square = shapes.getByRole("radio", { name: "Square", exact: true });
    await page.keyboard.press("Tab");
    await expect(square).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(landscape).toBeFocused();
    await landscape.press("ArrowRight");
    await expect(square).toBeChecked();
    await expect(square).toBeDisabled();
    await tabThroughTo(page, landscape);
    await landscape.press(" ");
    await expect(
      shapes.getByRole("radio", { name: "Landscape", exact: true }),
    ).toBeChecked();
    await expect(landscape).toBeDisabled();
    await expect(landscape).toHaveJSProperty("disabled", true);

    await expect(portrait).toBeEnabled();
    await openDesignSection(page, "Card headings");
    const overlayTop = headings.getByRole("radio", {
      name: "Overlay top",
      exact: true,
    });
    if (!(await overlayTop.isChecked())) await overlayTop.click();
    await expect(overlayTop).toHaveJSProperty("disabled", true);

    await expect(
      headings.getByRole("radio", { name: "Overlay top", exact: true }),
    ).toBeChecked();
    await expect(
      headings.getByRole("radio", { name: "Overlay top", exact: true }),
    ).toBeDisabled();
    expect((await savedWorkspace(page)).grid).toMatchObject({
      imageAspect: "landscape",
      captionPlacement: "overlay",
      captionAlignment: "top",
    });
    await reloadWorkspace(page);
    await openDesignSection(page, "Layout");
    await expect(
      shapes.getByRole("radio", { name: "Landscape", exact: true }),
    ).toBeChecked();
    await openDesignSection(page, "Card headings");
    await expect(
      headings.getByRole("radio", { name: "Overlay top", exact: true }),
    ).toBeChecked();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("header actions open export and restore sidebar settings and focus", async ({
  page,
}, testInfo) => {
  await setEditorViewport(page, { width: 1440, height: 900 });
  await page.goto("./");
  const header = page.locator("[data-canvas-header]");
  const sidebar = page.locator("[data-editor-sidebar]");
  await expect(
    header.getByRole("button", { name: "Menu", exact: true }),
  ).toHaveCount(0);
  await openSidebarPanel(page, "Design");
  await openDesignControls(page, "background-value");
  await page.locator("#background-value").fill("#112233");
  await openDesignControls(page, "background-value");
  await page.locator("#background-value").press("Enter");
  const exportButton = header.getByRole("button", {
    name: "Export grid",
    exact: true,
  });
  for (const width of [1440, 390, 260, 1440]) {
    await setEditorViewport(page, { width, height: 844 });
    await expect(sidebar).toHaveCount(1);
    await expect(
      sidebar.getByRole("tab", { name: "Design", exact: true }),
    ).toBeDisabled();
    const close = sidebarToggle(page, true);
    await expect(close).toBeVisible();
    await expect(close).toHaveAttribute(
      "aria-controls",
      await sidebar.getAttribute("id"),
    );
    await expect(close.locator("svg")).toHaveCSS(
      "rotate",
      width < 640 ? "90deg" : "none",
    );
    const workspace = page.locator("[data-workspace-scroll]");
    const openHeight = (await workspace.boundingBox()).height;
    const panelHeight = (await sidebar.boundingBox()).height;
    await exportButton.focus();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await close.press("Enter");
    await expect(sidebar).toHaveCount(0);
    const show = sidebarToggle(page, false);
    await expect(show).toBeFocused();
    await expect(show.locator("svg")).toHaveCSS(
      "rotate",
      width < 640 ? "90deg" : "none",
    );
    if (width < 640) {
      await expect(page.locator("[data-sidebar-track]")).toHaveCSS(
        "height",
        "0px",
      );
      expect((await workspace.boundingBox()).height).toBeCloseTo(
        openHeight + panelHeight,
        0,
      );
      await expect(page.locator("[data-sidebar-track]")).not.toHaveAttribute(
        "data-sidebar-open",
      );
    }
    await page.screenshot({
      path: testInfo.outputPath(`panel-closed-${width}.png`),
    });
    if (width === 390) {
      await setEditorViewport(page, { width: 1440, height: 844 });
      await expect(sidebar).toHaveCount(0);
      await expect(show.locator("svg")).toHaveCSS("rotate", "none");
      await setEditorViewport(page, { width, height: 844 });
      await expect(sidebar).toHaveCount(0);
      await expect(show.locator("svg")).toHaveCSS("rotate", "90deg");
    }
    await page.reload();
    await expect(sidebar).toHaveCount(0);
    await expect(show).toBeVisible();
    await tabThroughTo(page, show);
    await show.press("Space");
    await expect(sidebar).toBeVisible();
    await expect(
      sidebar.getByRole("tab", { name: "Design", exact: true }),
    ).toBeDisabled();
    await openDesignControls(page, "background-value");
    await expect(page.locator("#background-value")).toHaveValue("#112233");
    await page.screenshot({
      path: testInfo.outputPath(`panel-open-${width}.png`),
    });
    await exportButton.click();
    const dialog = page.getByRole("dialog", {
      name: "Export grid",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(exportButton).toBeFocused();
  }
});

test("sidebar keyboard navigation skips selected tabs and preserves settings across toggles", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  const sidebar = page.locator("[data-editor-sidebar]");
  const header = page.locator("[data-canvas-header]");
  const commands = sidebar.getByRole("tablist", {
    name: "Editor panels",
    exact: true,
  });
  await expect(sidebar.getByRole("tablist")).toHaveCount(1);
  await expect(header.getByRole("tab")).toHaveCount(0);
  await expect(sidebar.locator("[data-sidebar-brand]")).toHaveCount(0);
  await expect(
    header.getByRole("link", { name: "Gridz", exact: true }),
  ).toBeVisible();

  await expect(commands.locator(":scope > button")).toHaveCount(3);
  const images = commands.getByRole("tab", { name: "Images", exact: true });
  const settings = commands.getByRole("tab", { name: "Design", exact: true });
  const exportButton = page
    .locator("[data-canvas-header]")
    .getByRole("button", {
      name: "Export grid",
      exact: true,
    });
  await expect(images).toHaveAttribute("aria-selected", "true");
  await expect(images).toBeDisabled();
  await expect(images).toHaveJSProperty("disabled", true);

  await expect(images).toHaveAttribute("tabindex", "-1");
  const closeSidebar = page
    .locator("[data-canvas-header]")
    .getByRole("button", {
      name: "Close sidebar",
      exact: true,
    });
  await closeSidebar.focus();
  await tabThroughTo(page, settings);
  await expect(settings).toBeFocused();
  await settings.press("Enter");
  await expect(settings).toHaveAttribute("aria-selected", "true");
  await expect(settings).toBeDisabled();
  await expect(settings).toHaveJSProperty("disabled", true);

  await expect(images).toBeEnabled();
  await openDesignControls(page, "canvas-padding");
  await expect(
    sidebar.getByRole("group", { name: "Canvas style", exact: true }),
  ).toBeVisible();
  await closeSidebar.focus();
  await tabThroughTo(page, images);
  await expect(images).toBeFocused();
  await images.press("Enter");
  await expect(images).toHaveAttribute("aria-selected", "true");
  await exportButton.click();
  const dialog = page.getByRole("dialog", { name: "Export grid", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(exportButton).toBeFocused();
  await commands.screenshot({
    path: testInfo.outputPath("sidebar-command-tiles.png"),
  });
  await settings.click();
  await openDesignControls(page, "background-value");
  await page.locator("#background-value").fill("#112233");
  await openDesignControls(page, "background-value");
  await page.locator("#background-value").press("Enter");
  await closeSidebar.click();
  await expect(sidebar).toHaveCount(0);
  const canvasHeader = page.locator("[data-canvas-header]");
  const canvasSettings = canvasHeader.getByRole("button", {
    name: "Show sidebar",
    exact: true,
  });
  await expect(canvasSettings).toBeFocused();

  await expect(exportButton).toBeEnabled();
  await expect(canvasSettings).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("desktop-sidebar-closed.png"),
  });
  await canvasSettings.click();
  await expect(sidebar).toBeVisible();
  await expect(canvasHeader).toBeVisible();
  await expect(settings).toHaveJSProperty("disabled", true);
  await openDesignControls(page, "background-value");
  await expect(page.locator("#background-value")).toHaveValue("#112233");
  await closeSidebar.click();
});

test("sidebar controls remain reachable while scrolling images", async ({
  page,
}, testInfo) => {
  await setEditorViewport(page, { width: 1440, height: 600 });
  await page.goto("./");
  await useComicExample(page, "dc");
  const sidebar = page.locator("[data-editor-sidebar]");
  const sticky = sidebar.locator("[data-sidebar-sticky]");
  const controls = sidebar.locator("[data-panel-controls]");
  await expect(
    page
      .locator("[data-canvas-header]")
      .getByRole("link", { name: "Gridz", exact: true }),
  ).toBeVisible();
  await expect(sidebar.locator("[data-sidebar-brand]")).toHaveCount(0);

  const scroller = sidebar.locator("[data-sidebar-panels]");
  expect(
    await scroller.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  for (const scrollTop of [100, 200, 300, 400, 500, 600]) {
    await scroller.evaluate((element, top) => {
      element.scrollTop = top;
    }, scrollTop);
    await expect(sticky).toBeInViewport();
    expect(
      await sticky.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        for (let offset = 4; offset < bounds.height; offset += 8) {
          const foreground = document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + offset,
          );
          if (!element.contains(foreground)) return false;
        }
        return true;
      }),
    ).toBe(true);
  }
  await sidebar.screenshot({
    path: testInfo.outputPath("sticky-sidebar-scrolled.png"),
  });
});

test("right sidebar switches local images and settings without a provider picker", async ({
  page,
}) => {
  await page.goto("./");
  const sidebar = page.locator("[data-editor-sidebar]");
  const images = sidebar.getByRole("tab", { name: "Images", exact: true });
  const settings = sidebar.getByRole("tab", { name: "Design", exact: true });
  await expect(sidebar).toHaveCount(1);
  await expect(images).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#sidebar-image-source")).toHaveCount(0);
  await expect(page.locator("#asset-library")).toBeVisible();
  await expect(page.locator("#background-value")).toBeHidden();

  await page.locator("#upload").setInputFiles({
    name: "panel-image.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#ff0000"/></svg>',
    ),
  });
  await expect(sidebar.locator(".asset")).toHaveCount(1);

  await expect(
    sidebar.locator("button[aria-haspopup='listbox']:visible"),
  ).toHaveCount(0);
  await expect(sidebar.locator(".asset")).toBeVisible();
  await settings.click();
  await expect(page.locator("#asset-library")).toBeHidden();
  await openDesignControls(page, "background-value");
  await page.locator("#background-value").fill("#112233");
  await openDesignControls(page, "background-value");
  await page.locator("#background-value").press("Enter");
  await images.click();
  await expect(sidebar.locator(".asset")).toBeVisible();
  await settings.press("Enter");
  await expect(settings).toHaveAttribute("aria-selected", "true");
  await openDesignControls(page, "background-value");
  await expect(page.locator("#background-value")).toHaveValue("#112233");
  await openDesignSection(page, "Card headings", true);
  const content = sidebar.locator("[data-sidebar-panels]");
  await content.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(
    page.getByRole("group", { name: "Card style", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await images.click();
  await page
    .getByRole("button", { name: "Add image to cell 1", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  await expect(picker.locator("#picker-image-source")).toHaveCount(0);
  await expect(
    picker.getByRole("region", { name: "My images", exact: true }),
  ).toBeVisible();
  await expect(picker.getByRole("tablist")).toHaveCount(0);
  await picker
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(picker).toHaveCount(0);
  await setEditorViewport(page, { width: 390, height: 844 });
  await expect(sidebar).toHaveCount(1);
  await settings.click();
  await openDesignControls(page, "background-value");
  await expect(page.locator("#background-value")).toHaveValue("#112233");
});

test("window resizing reuses card content and canvas measurement contexts", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator("#board-grid .grid-cell")).toHaveCount(9);
  await savedWorkspace(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    window.__resizeCanvasCreations = 0;
    const createElement = document.createElement.bind(document);
    document.createElement = (name, options) => {
      if (name === "canvas") window.__resizeCanvasCreations++;
      return createElement(name, options);
    };
    window.__originalResizeCards = [
      ...document.querySelectorAll("#board-grid .grid-cell"),
    ];
  });
  for (const viewport of [
    { width: 1200, height: 900 },
    { width: 960, height: 600 },
    { width: 390, height: 720 },
    { width: 1440, height: 1000 },
  ]) {
    await setEditorViewport(page, viewport);
    expect(await page.evaluate(() => window.__resizeCanvasCreations)).toBe(0);
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll("#board-grid .grid-cell")].every(
          (card, index) => card === window.__originalResizeCards[index],
        ),
      ),
    ).toBe(true);
    expect(
      await page
        .locator("#board-grid")
        .evaluate((grid) => grid.getBoundingClientRect().width),
    ).toBeGreaterThan(0);
  }
});

test("editor chrome uses Tailwind palette tokens independently of saved artwork colors", async ({
  page,
}) => {
  await page.goto("./");
  await savedWorkspace(page);
  const chrome = () =>
    page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        [
          ["--bg", "--color-zinc-900"],
          ["--panel", "--color-zinc-800"],
          ["--text", "--color-zinc-100"],
          ["--muted", "--color-zinc-400"],
          ["--accent", "--color-lime-300"],
          ["--mint", "--color-emerald-300"],
        ].map(([role, palette]) => [
          role,
          [
            styles.getPropertyValue(role).trim(),
            styles.getPropertyValue(palette).trim(),
          ],
        ]),
      );
    });
  const initialChrome = await chrome();
  for (const [actual, palette] of Object.values(initialChrome)) {
    expect(actual).not.toBe("");
    expect(actual).toBe(palette);
  }
  await openSidebarPanel(page, "Design");
  await openDesignSection(page, "Colors");
  await page
    .locator("[data-theme-builder]")
    .getByRole("radio", { name: "Snow", exact: true })
    .click();
  const artwork = (await savedWorkspace(page)).grid;
  for (const property of ["cellTextColor", "headingTextColor"])
    expect(artwork[property]).toMatch(/^#[0-9a-f]{6}$/i);
  expect(await chrome()).toEqual(initialChrome);
  await page.reload();
  expect((await savedWorkspace(page)).grid).toEqual(artwork);
  expect(await chrome()).toEqual(initialChrome);
});

test("controls share quarter-strength background hover without changing borders", async ({
  page,
}) => {
  await page.goto("./");
  await savedWorkspace(page);
  const geometryOf = (button) =>
    button.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const parent = element.parentElement.getBoundingClientRect();
      return {
        x: bounds.left - parent.left,
        y: bounds.top - parent.top,
        width: bounds.width,
        height: bounds.height,
      };
    });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 720 },
  ]) {
    await setEditorViewport(page, viewport);
    for (const name of [
      "Add row",
      "Remove row",
      "Add column",
      "Remove column",
      "Export grid",
      ...(viewport.width > 900 ? [/^(Show sidebar|Close sidebar)$/] : []),
    ]) {
      await page.mouse.move(0, 0);
      const button = page.getByRole("button", { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeEnabled();
      const borderColor = await button.evaluate(
        (element) => getComputedStyle(element).borderTopColor,
      );
      const bounds = await geometryOf(button);
      const hoverColor = await hoverColorOf(button);
      await button.hover();
      await expect(button).toHaveCSS("background-color", hoverColor);
      for (const edge of ["top", "right", "bottom", "left"])
        await expect(button).toHaveCSS(`border-${edge}-color`, borderColor);
      expect(await geometryOf(button)).toEqual(bounds);
    }
  }
  const remove = page.getByRole("button", {
    name: "Remove column",
    exact: true,
  });
  for (
    let attempts = 0;
    attempts < 12 && (await remove.isEnabled());
    attempts++
  )
    await remove.click();
  await expect(remove).toBeDisabled();
  await page.mouse.move(0, 0);
  const disabledBackground = await remove.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await remove.hover();
  await expect(remove).toHaveCSS("background-color", disabledBackground);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 720 },
  ]) {
    await setEditorViewport(page, viewport);
    await openSidebarPanel(page, "Design");
    const inactiveTab = page.getByRole("tab", { name: "Images", exact: true });
    const activeTab = page.getByRole("tab", { name: "Design", exact: true });
    await page.mouse.move(0, 0);
    const tabBorder = await inactiveTab.evaluate(
      (element) => getComputedStyle(element).borderTopColor,
    );
    const selectedBackground = await activeTab.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await inactiveTab.hover();
    await expect(inactiveTab).toHaveCSS(
      "background-color",
      await hoverColorOf(inactiveTab),
    );
    await expect(inactiveTab).toHaveCSS("border-top-color", tabBorder);
    const resetTab = page.getByRole("tab", { name: "Reset", exact: true });
    await resetTab.hover();
    await expect(resetTab).toHaveCSS(
      "background-color",
      await hoverColorOf(resetTab),
    );
    await expect(resetTab).toHaveCSS("border-top-color", tabBorder);
    await activeTab.hover();
    await expect(activeTab).toHaveCSS("background-color", selectedBackground);
    if (viewport.width > 900) {
      const tabs = page.locator("[data-panel-controls]");
      await expect(tabs).toHaveCSS("padding-top", "0px");
      await expect(tabs).toHaveCSS("padding-bottom", "0px");
    }
    await openDesignSection(page, "Layout");
    const layout = page
      .locator("[data-theme-builder]")
      .getByRole("button", { name: /^\d Layout/ });
    await layout.hover();
    await expect(layout).toHaveCSS(
      "background-color",
      await hoverColorOf(layout, "--panel"),
    );
    const shape = page
      .locator('#image-shape [role="radio"][aria-checked="false"]')
      .first();
    const selectedShape = page.locator(
      '#image-shape [role="radio"][aria-checked="true"]',
    );
    const selectedShapeBackground = await selectedShape.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    const shapeBorder = await shape.evaluate(
      (element) => getComputedStyle(element).borderTopColor,
    );
    const shapeGeometry = await geometryOf(shape);
    await shape.hover();
    await expect(shape).toHaveCSS(
      "background-color",
      await hoverColorOf(shape),
    );
    await expect(shape).toHaveCSS("border-top-color", shapeBorder);
    expect(await geometryOf(shape)).toEqual(shapeGeometry);
    await selectedShape.hover();
    await expect(selectedShape).toHaveCSS(
      "background-color",
      selectedShapeBackground,
    );
    const spacing = page.locator("#builder-spacing");
    const borderColor = await spacing.evaluate(
      (element) => getComputedStyle(element).borderTopColor,
    );
    await spacing.hover();
    const hoverColor = await hoverColorOf(spacing);
    await expect(spacing).toHaveCSS("background-color", hoverColor);
    await expect(spacing).toHaveCSS("border-top-color", borderColor);
    await spacing.click();
    await expect(spacing).toHaveAttribute("aria-expanded", "true");
    const spacingOption = page
      .getByRole("listbox")
      .locator('[role="option"]:not(:disabled)')
      .first();
    await spacingOption.hover();
    await expect(spacingOption).toHaveCSS(
      "background-color",
      await hoverColorOf(spacingOption, "--panel"),
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    const toggle = page.getByRole("switch", {
      name: "Show borders",
      exact: true,
    });
    if (await toggle.isChecked()) await toggle.click();
    const toggleGeometry = await geometryOf(toggle);
    await toggle.hover();
    await expect(toggle).toHaveCSS(
      "background-color",
      await hoverColorOf(toggle, "--selected"),
    );
    const hoverDifference = await toggle.evaluate((element) => {
      const style = getComputedStyle(element);
      const context = document.createElement("canvas").getContext("2d");
      context.fillStyle = style.getPropertyValue("--selected");
      context.fillRect(0, 0, 1, 1);
      const normal = [...context.getImageData(0, 0, 1, 1).data];
      context.fillStyle = style.backgroundColor;
      context.fillRect(0, 0, 1, 1);
      const hovered = context.getImageData(0, 0, 1, 1).data;
      return Math.max(
        ...normal
          .slice(0, 3)
          .map((value, index) => Math.abs(hovered[index] - value)),
      );
    });
    expect(hoverDifference).toBeGreaterThan(25);
    await expect(toggle).toHaveCSS("filter", "none");
    await expect(toggle).toHaveCSS("box-shadow", "none");
    await toggle.click();
    await expect(toggle).toBeChecked();
    await page.mouse.move(0, 0);
    await expect(toggle.locator("span")).toHaveCSS(
      "transform",
      "matrix(1, 0, 0, 1, 20, 0)",
    );
    await toggle.hover();
    await expect(toggle).toHaveCSS(
      "background-color",
      await hoverColorOf(toggle, "--accent"),
    );
    await expect(toggle).not.toHaveCSS("background-color", borderColor);
    await expect(toggle).toHaveCSS("filter", "none");
    await expect(toggle).toHaveCSS("box-shadow", "none");
    expect(await geometryOf(toggle)).toEqual(toggleGeometry);
    await toggle.click();
    const customize = page.locator("#theme-step-1 [data-customize-toggle]");
    const customizeGeometry = await geometryOf(customize);
    await expect(customize).toHaveCSS("border-top-style", "solid");
    await expect(customize).toHaveCSS(
      "border-top-width",
      await spacing.evaluate(
        (element) => getComputedStyle(element).borderTopWidth,
      ),
    );
    await expect(customize).toHaveCSS("border-top-color", borderColor);
    await customize.hover();
    await expect(customize).toHaveCSS("background-color", hoverColor);
    await expect(customize).toHaveCSS("border-top-color", borderColor);
    expect(await geometryOf(customize)).toEqual(customizeGeometry);
    await openDesignSection(page, "Colors");
    const palette = page
      .locator('[data-theme-builder] [role="radio"][aria-checked="false"]')
      .first();
    const paletteBorder = await palette.evaluate(
      (element) => getComputedStyle(element).borderTopColor,
    );
    await palette.hover();
    await expect(palette).toHaveCSS(
      "background-color",
      await hoverColorOf(palette, "--panel"),
    );
    await expect(palette).toHaveCSS("border-top-color", paletteBorder);
    await page.locator("[data-theme-builder] [data-customize-toggle]").click();
    for (const selector of ['input[type="color"]', 'input[type="text"]']) {
      const input = page.locator(`[data-theme-builder] ${selector}`).first();
      await page.mouse.move(0, 0);
      const colorBorder = await input
        .locator("..")
        .evaluate((element) => getComputedStyle(element).borderTopColor);
      await input.hover();
      await expect(input).toHaveCSS(
        "background-color",
        await hoverColorOf(input),
      );
      await expect(input.locator("..")).toHaveCSS(
        "border-top-color",
        colorBorder,
      );
    }
  }
});

test("responsive grid resizing keeps controls reachable and preserves cell contents", async ({
  page,
}) => {
  await page.goto("./");
  await uploadCellImage(page);
  await page.locator(".cell-heading").first().fill("Keep caption");
  const original = await savedWorkspace(page);
  for (const viewport of [
    { width: 1900, height: 1000 },
    { width: 1440, height: 1000 },
    { width: 390, height: 720 },
    { width: 1440, height: 360 },
  ]) {
    await setEditorViewport(page, viewport);
    for (const dimension of ["row", "column"]) {
      await page
        .getByRole("button", { name: `Add ${dimension}`, exact: true })
        .click();
      await expect(page.locator(".grid-cell")).toHaveCount(12);
      await expect(page.locator(".cell-heading").first()).toHaveValue(
        "Keep caption",
      );
      for (const name of [
        "Add row",
        "Remove row",
        "Add column",
        "Remove column",
        "Reset",
      ]) {
        const button = page.getByRole(name === "Reset" ? "tab" : "button", {
          name,
          exact: true,
        });
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeInViewport();
        await button.click({ trial: true });
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("button", { name: `Remove ${dimension}`, exact: true })
        .click();
      await expect(page.locator(".grid-cell")).toHaveCount(9);
      expect((await savedWorkspace(page)).grid.cells).toEqual(
        original.grid.cells,
      );
    }
  }
  await setEditorViewport(page, { width: 390, height: 720 });
  for (let count = 0; count < 2; count++)
    await page.getByRole("button", { name: "Add row", exact: true }).click();
  const scroller = page.locator("[data-workspace-scroll]");
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.scrollLeft = element.scrollWidth;
  });
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(page.locator("[data-canvas-header]")).toBeInViewport();
});

scrollbarTest(
  "horizontal-only grid overflow shows a usable workspace scrollbar",
  async ({ page }, testInfo) => {
    await page.goto("./");
    for (let count = 0; count < 2; count++)
      await page
        .getByRole("button", { name: "Remove row", exact: true })
        .click();
    await selectField(page, "caption-position", "overlay-bottom");
    await closeSidebarPanel(page);
    const scroller = page.locator("[data-workspace-scroll]");
    const viewport = page.locator("[data-canvas-viewport]");
    await setEditorViewport(page, { width: 320, height: 727 });
    await expect
      .poll(() =>
        viewport.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      )
      .toBeGreaterThan(8);
    const narrowOverflowWidth =
      320 +
      (await viewport.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      )) -
      8;
    for (const width of [narrowOverflowWidth, 320]) {
      await setEditorViewport(page, { width, height: 727 });
      await scroller.evaluate((element) => element.scrollTo(0, 0));
      await expect
        .poll(() =>
          viewport.evaluate(
            (element) => element.scrollWidth - element.clientWidth,
          ),
        )
        .toBeGreaterThan(0);
      const overflow = await viewport.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      );
      if (width === narrowOverflowWidth) expect(overflow).toBeLessThan(12);
      await expect
        .poll(() =>
          scroller.evaluate(
            (element) => element.offsetHeight - element.clientHeight,
          ),
        )
        .toBe(0);
      expect(
        await viewport.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        ),
      ).toBe(0);
      const heading = page.locator(".board-export-heading");
      const before = await heading.boundingBox();
      const bounds = await scroller.boundingBox();
      await page.mouse.move(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      await page.mouse.wheel(1000, 0);
      await expect
        .poll(() => viewport.evaluate((element) => element.scrollLeft))
        .toBe(overflow);
      expect(
        await scroller.evaluate((element) => element.scrollLeft),
      ).toBeGreaterThanOrEqual(overflow);
      expect((await heading.boundingBox()).y).toBe(before.y);
      await expect(
        page.getByRole("button", { name: "Add column", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      const last = await page.locator(".grid-cell").last().boundingBox();
      const visible = await viewport.boundingBox();
      expect(last.x + last.width).toBeLessThanOrEqual(
        visible.x + visible.width + 1,
      );
      await page.screenshot({
        path: testInfo.outputPath(`horizontal-only-${width}.png`),
      });
    }
  },
);

nativeTouchTest(
  "workspace-edge scrolling moves canvas heading rows and row controls while column controls stay fixed",
  async ({ page }, testInfo) => {
    await setEditorViewport(page, { width: 960, height: 600 });
    await page.goto("./");
    await useComicExample(page);
    for (const dimension of ["column", "row"])
      for (let count = 0; count < 6; count++)
        await page
          .getByRole("button", { name: `Add ${dimension}`, exact: true })
          .click();
    const scroller = page.locator("[data-workspace-scroll]");
    const gridViewport = page.locator("[data-canvas-viewport]");
    const fixed = [
      page.locator("[data-canvas-header]"),
      page.getByRole("group", { name: "Column controls", exact: true }),
      page.getByRole("tab", { name: "Reset", exact: true }),
    ];
    for (const width of [960, 390]) {
      await setEditorViewport(page, { width, height: 600 });
      await scroller.evaluate((element) => element.scrollTo(0, 0));
      await expect
        .poll(() =>
          gridViewport.evaluate((element) => [
            element.scrollLeft,
            element.scrollTop,
          ]),
        )
        .toEqual([0, 0]);

      expect(
        await scroller.evaluate((element) => [
          element.scrollWidth > element.clientWidth,
          element.scrollHeight > element.clientHeight,
        ]),
      ).toEqual([true, true]);
      const verticalRail = overlayScrollbar(scroller, "vertical");
      await expect(verticalRail).toBeVisible();
      const railBefore = await verticalRail.boundingBox();
      const horizontalJumpMetrics = await scroller.evaluate((outer) => {
        const rail = outer.nextElementSibling.querySelector(
          ".os-scrollbar-vertical",
        );
        const handle = rail.querySelector(".os-scrollbar-handle");
        const measure = () => {
          const bounds = rail.getBoundingClientRect();
          return [bounds.x, bounds.y, handle.getBoundingClientRect().y];
        };
        const before = measure();
        const samples = [];
        const originalLeft = outer.scrollLeft;
        const maximum = outer.scrollWidth - outer.clientWidth;
        try {
          for (const fraction of [0, 1, 0.25, 0.9, 0, 1]) {
            outer.scrollLeft = maximum * fraction;
            samples.push(measure());
          }
        } finally {
          outer.scrollLeft = originalLeft;
        }
        return { before, samples };
      });
      for (const sample of horizontalJumpMetrics.samples)
        expect(sample).toEqual(horizontalJumpMetrics.before);
      const bounds = await scroller.boundingBox();
      const region = await page.locator(".workspace").boundingBox();
      expect(bounds.x + bounds.width).toBe(region.x + region.width);
      expect(bounds.y + bounds.height).toBe(region.y + region.height);
      const before = await Promise.all(
        fixed.map((locator) => locator.boundingBox()),
      );
      const heading = page.locator(".board-export-heading");
      const headingBefore = await heading.boundingBox();
      const cardBefore = await page.locator(".grid-cell").first().boundingBox();
      const rows = page.getByRole("group", {
        name: "Row controls",
        exact: true,
      });
      const rowsBefore = await rows.boundingBox();
      const lastBefore = await page.locator(".grid-cell").last().boundingBox();
      expect(rowsBefore.y).toBeGreaterThanOrEqual(
        lastBefore.y + lastBefore.height,
      );
      expect(rowsBefore.y).toBeGreaterThan(bounds.y + bounds.height);
      if (width === 960) {
        expect(
          await scroller.evaluate(async (outer) => {
            const inner = outer.querySelector("[data-canvas-viewport]");
            let advanced = false;
            const advanceScroll = () => {
              if (!advanced && outer.scrollTop === 100) {
                advanced = true;
                outer.scrollTo(200, 200);
              }
            };
            outer.addEventListener("scroll", advanceScroll);
            try {
              outer.scrollTo(100, 100);
              for (let frame = 0; frame < 6; frame++)
                await new Promise(requestAnimationFrame);
              return [
                outer.scrollLeft,
                outer.scrollTop,
                inner.scrollLeft,
                inner.scrollTop,
              ];
            } finally {
              outer.removeEventListener("scroll", advanceScroll);
            }
          }),
        ).toEqual([200, 200, 200, 0]);
        await scroller.evaluate((element) => element.scrollTo(0, 0));
        await expect
          .poll(() =>
            gridViewport.evaluate((element) => [
              element.scrollLeft,
              element.scrollTop,
            ]),
          )
          .toEqual([0, 0]);
        await page.mouse.move(bounds.x + 4, bounds.y + 120);
        await page.mouse.wheel(160, 180);
        await expect
          .poll(() =>
            scroller.evaluate((element) => [
              element.scrollLeft,
              element.scrollTop,
            ]),
          )
          .toEqual([160, 180]);
      } else {
        const session = await page.context().newCDPSession(page);
        const swipe = async (start, end) => {
          await session.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ ...start, id: 1 }],
          });
          for (let step = 1; step <= 8; step++)
            await session.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [
                {
                  x: start.x + ((end.x - start.x) * step) / 8,
                  y: start.y + ((end.y - start.y) * step) / 8,
                  id: 1,
                },
              ],
            });
          await session.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
        };
        await swipe(
          { x: bounds.x + 4, y: bounds.y + bounds.height * 0.8 },
          { x: bounds.x + 4, y: bounds.y + bounds.height * 0.35 },
        );
        const area = await scroller.evaluate((element) => ({
          width: element.clientWidth,
          height: element.clientHeight,
        }));
        await swipe(
          { x: bounds.x + area.width * 0.8, y: bounds.y + 4 },
          { x: bounds.x + area.width * 0.3, y: bounds.y + 4 },
        );
        await session.detach();
      }
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
      await expect
        .poll(async () => {
          const outer = await scroller.evaluate((element) => [
            element.scrollLeft,
            element.scrollTop,
          ]);
          const inner = await gridViewport.evaluate((element) => [
            element.scrollLeft,
            element.scrollTop,
          ]);
          return Math.abs(outer[0] - inner[0]);
        })
        .toBeLessThan(1);
      const cardAfter = await page.locator(".grid-cell").first().boundingBox();
      expect(cardAfter.x).toBeLessThan(cardBefore.x);
      expect(cardAfter.y).toBeLessThan(cardBefore.y);
      const scrolled = await scroller.evaluate((element) => element.scrollTop);
      expect(
        Math.abs((await heading.boundingBox()).y - headingBefore.y + scrolled),
      ).toBeLessThan(1);
      expect(
        Math.abs((await rows.boundingBox()).y - rowsBefore.y + scrolled),
      ).toBeLessThan(1);
      expect(
        await Promise.all(fixed.map((locator) => locator.boundingBox())),
      ).toEqual(before);
      expect(await verticalRail.boundingBox()).toEqual(railBefore);
      expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
      await scroller.evaluate((element) =>
        element.scrollTo(0, element.scrollHeight),
      );
      await expect(rows).toBeInViewport({ ratio: 1 });
      const lastAfter = await page.locator(".grid-cell").last().boundingBox();
      expect((await rows.boundingBox()).y).toBeGreaterThanOrEqual(
        lastAfter.y + lastAfter.height,
      );
      await page.screenshot({
        path: testInfo.outputPath(`workspace-scroll-${width}.png`),
      });
    }
  },
);

test("card border controls preserve geometry and export matching enabled and disabled edges", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await uploadCellImage(page);
  const original = await savedWorkspace(page);
  await openSidebarPanel(page, "Design");
  const builder = page.locator("[data-theme-builder]");
  const step = (label) => openDesignSection(page, label);
  await step("Canvas heading");
  const heading = builder.getByRole("switch", {
    name: "Show heading",
    exact: true,
  });
  if (await heading.isChecked()) await heading.click();
  await step("Card headings");
  const titles = builder.getByRole("switch", {
    name: "Show titles",
    exact: true,
  });
  if (await titles.isChecked()) await titles.click();
  await step("Layout");
  const square = builder.getByRole("radio", { name: "Square", exact: true });
  if (!(await square.isChecked())) await square.click();
  const rounding = builder.getByRole("switch", {
    name: "Rounded corners",
    exact: true,
  });
  if (await rounding.isChecked()) await rounding.click();
  const borders = builder.getByRole("switch", {
    name: "Show borders",
    exact: true,
  });
  await expect(borders).not.toBeChecked();
  await expect(page.locator("[data-card-border]")).toHaveCount(0);
  const first = page.locator(".grid-cell").first();
  const geometry = await first.boundingBox();
  const content = await first.locator("[data-card-content]").boundingBox();
  await borders.click();
  await page.locator("#card-border-color-value").fill("#e34567");
  await page.locator("#card-border-color-value").press("Tab");
  await page.locator("#card-border-width").fill("80");
  await expect
    .poll(async () => (await localDatabase(page)).document.grid)
    .toMatchObject({
      cardBorderVisible: true,
      cardBorderColor: "#e34567",
      cardBorderWidth: 4,
    });
  expect(await first.boundingBox()).toEqual(geometry);
  expect(await first.locator("[data-card-content]").boundingBox()).toEqual(
    content,
  );
  for (const selector of [".grid-cell", ".asset", "[data-upload-tile]"]) {
    await openSidebarPanel(
      page,
      selector === ".grid-cell" ? "Design" : "Images",
    );
    const border = page.locator(selector).first().locator("[data-card-border]");
    await expect(border).toBeVisible();
    await expect(border).toHaveCSS("border-top-color", "rgb(227, 69, 103)");
    const measured = await border.evaluate((element) => ({
      width: element.parentElement.getBoundingClientRect().width,
      stroke: parseFloat(getComputedStyle(element).borderTopWidth),
    }));
    expect(Math.abs(measured.stroke - measured.width * 0.04)).toBeLessThan(1);
  }
  await openSidebarPanel(page, "Design");
  await page.screenshot({
    path: testInfo.outputPath("card-borders-desktop.png"),
  });
  await selectExportField(page, "resolution", "150");
  const exportPixels = async () => {
    const grid = (await savedWorkspace(page)).grid;
    const download = await downloadBoard(page);
    const bytes = (await readFile(await download.path())).toString("base64");
    return page.evaluate(
      async ({ bytes, grid }) => {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${bytes}`)).blob(),
        );
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        const padding = Math.round(((grid.canvasPadding ?? 12) * 150) / 600);
        return [
          [padding + 1, padding + 75],
          [padding + 148, padding + 75],
          [padding + 75, padding + 1],
          [padding + 75, padding + 148],
        ].map(([left, top]) => [...context.getImageData(left, top, 1, 1).data]);
      },
      { bytes, grid },
    );
  };
  expect(await exportPixels()).toEqual(Array(4).fill([227, 69, 103, 255]));
  await step("Layout");
  await borders.click();
  await expect(
    page.locator("#card-border-width, #card-border-color"),
  ).toHaveCount(0);
  await expect(page.locator("[data-card-border]")).toHaveCount(0);
  expect(await first.boundingBox()).toEqual(geometry);
  await first.locator("[data-card-image]").hover();
  await expect(first).toHaveAttribute("data-image-hovered", "");
  const hoverFrame = first.locator("[data-cell-image-frame]");
  await expect(hoverFrame).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(hoverFrame).toHaveCSS("outline-style", "solid");
  await expect(hoverFrame).toHaveCSS("outline-width", "1px");
  await expect
    .poll(() =>
      hoverFrame.evaluate((element) => getComputedStyle(element).outlineColor),
    )
    .not.toBe("rgba(0, 0, 0, 0)");
  for (const pixel of await exportPixels())
    expect(pixel).not.toEqual([227, 69, 103, 255]);
  await expect
    .poll(
      async () => (await localDatabase(page)).document.grid.cardBorderVisible,
    )
    .toBe(false);
  await reloadWorkspace(page);
  await step("Layout");
  await expect(borders).not.toBeChecked();
  await borders.click();
  await expect(page.locator("#card-border-color-value")).toHaveValue("#E34567");
  await expect(page.locator("#card-border-width")).toHaveValue("80");
  await expect
    .poll(
      async () => (await localDatabase(page)).document.grid.cardBorderVisible,
    )
    .toBe(true);
  await step("Card headings");
  await builder
    .getByRole("switch", { name: "Show titles", exact: true })
    .click();
  expect(await exportPixels()).toEqual(Array(4).fill([227, 69, 103, 255]));
  const saved = await savedWorkspace(page);
  expect(saved.grid.cells).toEqual(original.grid.cells);
  expect(saved.grid.overflow).toEqual(original.grid.overflow);
  expect(saved.assets).toEqual(original.assets);
});

touchTest(
  "card border controls fit narrow screens and can be disabled completely",
  async ({ page }, testInfo) => {
    await page.goto("./");
    await openSidebarPanel(page, "Design");
    const builder = page.locator("[data-theme-builder]");
    await builder.getByRole("button", { name: /2 Layout/ }).click();
    const borders = builder.getByRole("switch", {
      name: "Show borders",
      exact: true,
    });
    for (const width of [390, 260]) {
      await setEditorViewport(page, { width, height: 844 });
      await borders.click();
      await page.locator("#card-border-width").fill("100");
      await expect(page.locator("#card-border-color-value")).toBeVisible();
      await page.locator("#card-border-width").scrollIntoViewIfNeeded();
      await expect(page.locator("#card-border-width")).toBeInViewport({
        ratio: 1,
      });
      expect(
        await builder.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`card-borders-mobile-${width}.png`),
      });
      await borders.click();
      await expect(page.locator("[data-card-border]")).toHaveCount(0);
      await expect(
        page.locator('input:not([type="range"]):focus, textarea:focus'),
      ).toHaveCount(0);
    }
  },
);

test("theme feedback follows palette colors on cards headings and drop zones", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await setEditorViewport(page, { width: 1440, height: 1080 });
  await uploadCellImage(page);
  await page.locator(".grid-cell .cell-heading").first().fill("Theme caption");
  await editHeading(page, "Theme heading");
  const original = await savedWorkspace(page);
  const dropColors = new Set();
  const geometryOf = (card) =>
    card.evaluate((element) => {
      const bounds = (target) => {
        const rectangle = target.getBoundingClientRect();
        return {
          x: rectangle.x,
          y: rectangle.y,
          width: rectangle.width,
          height: rectangle.height,
        };
      };
      return {
        card: bounds(element),
        image: bounds(
          element.querySelector("[data-card-image]") ??
            element.querySelector("[data-card-content]"),
        ),
        caption: element.querySelector(".cell-heading")
          ? bounds(element.querySelector(".cell-heading"))
          : null,
      };
    });
  const checkCaptionInset = async (card) => {
    const gaps = await card
      .locator("[data-caption-feedback]")
      .evaluate((element) => {
        const border = element.getBoundingClientRect();
        const caption = element
          .closest(".image-card")
          .querySelector(".cell-heading, .library-heading")
          .getBoundingClientRect();
        return [
          border.left - caption.left,
          border.top - caption.top,
          caption.right - border.right,
          caption.bottom - border.bottom,
        ];
      });
    for (const [index, gap] of gaps.entries())
      expect(gap).toBeCloseTo(index === 1 ? -1 : -3, 1);
    expect(
      await card
        .locator("[data-caption-feedback]")
        .evaluate((element) => element.parentElement.matches(".image-card")),
    ).toBe(true);
  };
  const checkOverlay = async (card, dotted = false, tinted = false) => {
    const frame = card.locator("[data-cell-image-frame]");
    await expect(frame).toHaveCSS("outline-style", dotted ? "none" : "solid");
    await expect(frame).toHaveCSS("outline-offset", "2px");
    await expect(frame).toHaveCSS("border-top-width", "0px");
    const dots = frame.locator("[data-feedback-dots]");
    if (dotted) {
      await expect(dots).toBeVisible();
      await expect(dots.locator("rect")).toHaveAttribute(
        "stroke-dasharray",
        "2 6",
      );
      await expect(dots.locator("rect")).not.toHaveCSS(
        "stroke",
        "rgba(0, 0, 0, 0)",
      );
      const bounds = await frame.boundingBox();
      const dottedBounds = await dots.boundingBox();
      expect(bounds.x - dottedBounds.x).toBeCloseTo(3, 1);
      expect(dottedBounds.width - bounds.width).toBeCloseTo(6, 1);
    } else {
      await expect(dots).toBeHidden();
    }
    let metrics;
    await expect
      .poll(async () => {
        metrics = await frame.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const cardBounds = element
            .closest(".image-card")
            .getBoundingClientRect();
          const context = document.createElement("canvas").getContext("2d");
          const style = getComputedStyle(element);
          context.fillStyle = style.backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return {
            aligned: ["left", "top", "right", "bottom"].every(
              (edge) => Math.abs(bounds[edge] - cardBounds[edge]) < 0.5,
            ),
            tint: context.getImageData(0, 0, 1, 1).data[3],
          };
        });
        return tinted
          ? metrics.tint
          : Number(metrics.aligned && metrics.tint === 0);
      })
      .toBeGreaterThan(0);
    expect(metrics.aligned).toBe(true);
    if (tinted) expect(metrics.tint).toBeGreaterThan(0);
  };
  for (const name of ["Rose", "Forest", "Snow", "Sun"]) {
    await openSidebarPanel(page, "Design");
    await page
      .locator("[data-theme-builder]")
      .getByRole("radio", { name, exact: true })
      .click();
    const palette = (await savedWorkspace(page)).grid;
    const filled = page.locator(".grid-cell").first();
    const empty = page.locator("[data-drop-placeholder]").first();
    const heading = page.locator(".board-export-heading");
    await expect(filled).toHaveCSS(
      "--card-frame-hover-color",
      palette.cellTextColor,
    );
    const emptyFeedback = await empty.evaluate((element) =>
      getComputedStyle(element)
        .getPropertyValue("--card-frame-hover-color")
        .trim(),
    );
    await expect(heading).toHaveCSS(
      "--heading-feedback-color",
      palette.headingTextColor,
    );
    const hoverColor = await filled
      .locator(".cell-heading")
      .evaluate((element) => getComputedStyle(element).color);
    await page.mouse.move(0, 0);
    const beforeHover = await geometryOf(filled);
    await filled.locator(".cell-image-button").hover();
    await checkOverlay(filled);
    expect(await geometryOf(filled)).toEqual(beforeHover);
    await filled.locator(".cell-heading").hover();
    await expect(filled.locator("[data-caption-feedback]")).toHaveCSS(
      "border-top-color",
      hoverColor,
    );
    await checkCaptionInset(filled);
    expect(await geometryOf(filled)).toEqual(beforeHover);
    await filled.locator(".cell-heading").focus();
    await expect(filled.locator("[data-caption-feedback]")).toHaveCSS(
      "border-top-color",
      hoverColor,
    );
    await checkCaptionInset(filled);
    await filled.locator(".cell-heading").blur();
    await heading.hover();
    await expect
      .poll(() =>
        heading.evaluate(
          (element) => getComputedStyle(element, "::after").borderTopColor,
        ),
      )
      .toBe(hoverColor);
    const transfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(
        new File(["preview"], "preview.png", { type: "image/png" }),
      );
      return data;
    });
    const emptyContent = empty.locator("[data-card-content]");
    const emptyBackground = await emptyContent.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    const beforeEmptyHover = await geometryOf(empty);
    await empty.locator(".cell-image-button").hover();
    await expect(emptyContent).not.toHaveCSS(
      "background-color",
      emptyBackground,
    );
    const emptyHoveredBackground = await emptyContent.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await checkOverlay(empty, true, false);
    expect(await geometryOf(empty)).toEqual(beforeEmptyHover);
    await empty.dispatchEvent("dragover", { dataTransfer: transfer });
    await expect(empty).toHaveClass(/drag-over/);
    const dropColor = await empty.evaluate((element) =>
      getComputedStyle(element).getPropertyValue("--card-drop-color").trim(),
    );
    expect(dropColor).not.toBe("#80cab1");
    expect(dropColor).toBe(emptyFeedback);
    dropColors.add(dropColor);
    await expect(emptyContent).not.toHaveCSS(
      "background-color",
      emptyBackground,
    );
    await checkOverlay(empty, true, true);
    expect(await geometryOf(empty)).toEqual(beforeEmptyHover);
    await filled.dispatchEvent("dragover", { dataTransfer: transfer });
    await checkOverlay(filled, true, true);
    expect(await geometryOf(filled)).toEqual(beforeHover);
    await filled.dispatchEvent("dragleave", { dataTransfer: transfer });
    await empty.dispatchEvent("dragleave", { dataTransfer: transfer });
    await transfer.dispose();
    await openSidebarPanel(page, "Images");
    const library = page.locator(".asset").first();
    const canvasFeedback = await filled.evaluate((element) => {
      const context = document.createElement("canvas").getContext("2d");
      const style = getComputedStyle(element);
      const sample = (color) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        return `rgb(${channels.join(", ")})`;
      };
      const imageToken = style
        .getPropertyValue("--card-frame-hover-color")
        .trim();
      const captionToken = style
        .getPropertyValue("--card-caption-hover-color")
        .trim();
      return {
        imageToken,
        captionToken,
        image: sample(imageToken),
        caption: sample(captionToken),
      };
    });
    await expect(library).toHaveCSS(
      "--card-frame-hover-color",
      canvasFeedback.imageToken,
    );
    await expect(library).toHaveCSS(
      "--card-caption-hover-color",
      canvasFeedback.captionToken,
    );
    const beforeLibraryHover = await geometryOf(library);
    await library.locator(".library-image-button").hover();
    await checkOverlay(library);
    await expect(library.locator("[data-cell-image-frame]")).toHaveCSS(
      "outline-color",
      canvasFeedback.image,
    );
    await expect
      .poll(() =>
        library.locator("[data-cell-image-frame]").evaluate((element) => {
          const context = document.createElement("canvas").getContext("2d");
          context.fillStyle = getComputedStyle(element).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return context.getImageData(0, 0, 1, 1).data[3] / 255;
        }),
      )
      .toBe(0);
    const clippedFrameEdges = await library.evaluate((element) => {
      const frame = element.getBoundingClientRect();
      const clipped = [];
      for (
        let ancestor = element.parentElement;
        ancestor;
        ancestor = ancestor.parentElement
      ) {
        const style = getComputedStyle(ancestor);
        const bounds = ancestor.getBoundingClientRect();
        const edges = [
          ["left", frame.left - bounds.left, style.overflowX],
          ["right", bounds.right - frame.right, style.overflowX],
          ["top", frame.top - bounds.top, style.overflowY],
          ["bottom", bounds.bottom - frame.bottom, style.overflowY],
        ];
        for (const [edge, inset, overflow] of edges) {
          if (overflow !== "visible" && inset < 2.9)
            clipped.push({ ancestor: ancestor.id, edge, inset });
        }
      }
      return clipped;
    });
    expect(clippedFrameEdges).toEqual([]);
    expect(await geometryOf(library)).toEqual(beforeLibraryHover);
    await library.locator(".library-heading").hover();
    await expect(library.locator("[data-cell-image-frame]")).toHaveCSS(
      "outline-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(library.locator("[data-caption-feedback]")).toHaveCSS(
      "border-top-color",
      canvasFeedback.caption,
    );
    await checkCaptionInset(library);
    await checkOverlay(library);
    await library.locator(".library-heading").focus();
    await expect(library.locator("[data-cell-image-frame]")).toHaveCSS(
      "outline-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(library.locator("[data-caption-feedback]")).toHaveCSS(
      "border-top-color",
      canvasFeedback.caption,
    );
    await checkCaptionInset(library);
    expect(await geometryOf(library)).toEqual(beforeLibraryHover);
    if (name === "Rose")
      await library.screenshot({
        path: testInfo.outputPath("caption-feedback-Rose.png"),
      });
    const upload = page.locator("[data-upload-tile]").first();
    const beforeUploadHover = await geometryOf(upload);
    const uploadContent = upload.locator("[data-card-content]");
    await expect(upload).toHaveCSS("--card-frame-hover-color", emptyFeedback);
    await expect(uploadContent).toHaveCSS("background-color", emptyBackground);
    const uploadBackground = await uploadContent.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await upload.hover();
    await expect(uploadContent).not.toHaveCSS(
      "background-color",
      uploadBackground,
    );
    await expect(uploadContent).toHaveCSS(
      "background-color",
      emptyHoveredBackground,
    );
    await checkOverlay(upload, true, false);
    expect(await geometryOf(upload)).toEqual(beforeUploadHover);
    if (name === "Rose" || name === "Snow") {
      await page.screenshot({
        path: testInfo.outputPath(`theme-feedback-${name}.png`),
        fullPage: true,
      });
    }
  }
  expect(dropColors.size).toBeGreaterThan(1);
  const changed = await savedWorkspace(page);
  expect(changed.grid.cells).toEqual(original.grid.cells);
  expect(changed.grid.heading).toBe(original.grid.heading);
  expect(changed.assets).toEqual(original.assets);
  expect(changed.exportSettings).toEqual(original.exportSettings);
});

test("design identifies reset and modified color themes across navigation and reload", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await openSidebarPanel(page, "Design");
  const builder = page.locator("[data-theme-builder]");
  const colors = builder.getByRole("button", { name: /^1 Colors/ });
  const ink = builder.getByRole("radio", { name: "Ink", exact: true });
  await expect(colors).toHaveText("1ColorsInk");
  await expect(ink).toBeChecked();
  await expect(ink).toBeDisabled();
  const selectedBackground = await page
    .getByRole("tab", { name: "Design", exact: true })
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await expect(ink).toHaveCSS("background-color", selectedBackground);
  const normalBorder = await builder
    .getByRole("radio", { name: "Forest", exact: true })
    .evaluate((element) => getComputedStyle(element).borderTopColor);
  await expect(ink).toHaveCSS("border-top-color", normalBorder);
  await ink.hover();
  await expect(ink).toHaveCSS("border-top-color", normalBorder);
  const checkHeadingPlaceholder = async () => {
    const placeholder = page.locator("[data-heading-placeholder]");
    await expect(placeholder).toHaveCSS("text-transform", "none");
    const placeholderColor = await placeholder.evaluate(
      (element) => getComputedStyle(element).color,
    );
    const headingColor = await placeholder.evaluate(
      (element) => getComputedStyle(element.closest("h2")).color,
    );
    expect(placeholderColor).not.toBe(headingColor);
    await placeholder.click();
    const field = page.locator("textarea.board-heading-text");
    await expect(field).toBeVisible();
    expect(
      await field.evaluate((element) => {
        const style = getComputedStyle(element, "::placeholder");
        return {
          color: style.color,
          transform: style.textTransform,
          opacity: style.opacity,
        };
      }),
    ).toEqual({ color: placeholderColor, transform: "none", opacity: "1" });
    await field.fill("Actual heading");
    await expect(field).toHaveCSS("color", headingColor);
    await field.fill("");
    await field.press("Escape");
    await expect(placeholder).toHaveCSS("color", placeholderColor);
  };
  await checkHeadingPlaceholder();
  const paletteOrder = [
    "Ink",
    "Forest",
    "Ocean",
    "Plum",
    "Rose",
    "Cocoa",
    "Sun",
    "Snow",
  ];
  for (const [index, name] of paletteOrder.entries()) {
    await expect(builder.getByRole("radio").nth(index)).toHaveAccessibleName(
      name,
    );
  }
  for (const name of ["Cocoa", "Plum", "Snow", "Rose"]) {
    await builder.getByRole("radio", { name, exact: true }).click();
    await expect(colors).toHaveText(`1Colors${name}`);
    await expect
      .poll(async () => (await savedWorkspace(page)).grid.colorTheme)
      .toBe(name);
    await reloadWorkspace(page);
    await openSidebarPanel(page, "Design");
    await expect(
      builder.getByRole("radio", { name, exact: true }),
    ).toBeChecked();
    await expect(builder.getByRole("radio", { name, exact: true })).toHaveCSS(
      "background-color",
      selectedBackground,
    );
    await expect(builder.getByRole("radio", { name, exact: true })).toHaveCSS(
      "border-top-color",
      normalBorder,
    );
    await expect(colors).toHaveText(`1Colors${name}`);
    if (name === "Rose") {
      await builder
        .getByRole("button", { name: "Customize Colors", exact: true })
        .click();
      const field = page.getByRole("textbox", {
        name: "Background hex value",
        exact: true,
      });
      await field.click();
      await field.fill("#554455");
      await field.press("Tab");
      const rose = builder.getByRole("radio", { name: "Rose", exact: true });
      await expect(colors).toHaveText("1ColorsRose · Modified");
      await expect(rose).toBeChecked();
      await expect(rose).toBeEnabled();
      await expect(rose).toHaveCSS("background-color", selectedBackground);
      await reloadWorkspace(page);
      await openSidebarPanel(page, "Design");
      await expect(rose).toBeChecked();
      await expect(colors).toHaveText("1ColorsRose · Modified");
      await rose.click();
      await expect(colors).toHaveText("1ColorsRose");
      await expect(rose).toBeDisabled();
    }
    if (name === "Snow") {
      expect((await savedWorkspace(page)).grid).toMatchObject({
        background: "#ffffff",
        cellBackgroundColor: "#d9dfdd",
      });
      const contrast = await page
        .locator("[data-drop-placeholder]")
        .first()
        .evaluate((element) => {
          const context = document.createElement("canvas").getContext("2d");
          const luminance = (color) => {
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            const channels = [...context.getImageData(0, 0, 1, 1).data]
              .slice(0, 3)
              .map((channel) => {
                const value = channel / 255;
                return value <= 0.04045
                  ? value / 12.92
                  : ((value + 0.055) / 1.055) ** 2.4;
              });
            return (
              channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
            );
          };
          const ratio = (foreground, background) => {
            const foregroundLuminance = luminance(foreground);
            const backgroundLuminance = luminance(background);
            return (
              (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
              (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
            );
          };
          const cardStyle = getComputedStyle(element);
          const canvasColor = getComputedStyle(
            element.closest("#board-grid"),
          ).backgroundColor;
          const heading = document.querySelector("[data-heading-placeholder]");
          return {
            surface: ratio(cardStyle.backgroundColor, canvasColor),
            text: ratio(
              getComputedStyle(element.querySelector(".empty-cell")).color,
              cardStyle.backgroundColor,
            ),
            hover: ratio(
              cardStyle.getPropertyValue("--card-frame-hover-color"),
              canvasColor,
            ),
            heading: ratio(
              getComputedStyle(heading).color,
              getComputedStyle(heading.closest("h2")).backgroundColor,
            ),
          };
        });
      expect(contrast.surface).toBeGreaterThanOrEqual(1.5);
      expect(contrast.text).toBeGreaterThanOrEqual(4.5);
      expect(contrast.hover).toBeGreaterThanOrEqual(3);
      expect(contrast.heading).toBeGreaterThanOrEqual(4.5);
      await checkHeadingPlaceholder();
      await page.screenshot({
        path: testInfo.outputPath("snow-placeholder-contrast.png"),
        fullPage: true,
      });
    }
  }
  await builder.getByRole("radio", { name: "Forest", exact: true }).click();
  await expect(colors).toHaveText("1ColorsForest");
  await resetEverything(page);
  await openSidebarPanel(page, "Design");
  await expect(colors).toHaveText("1ColorsInk");
  await expect(ink).toBeChecked();
  const customize = builder.locator("[data-customize-toggle]");
  await expect(customize).toHaveText("Customize Colors");
  const hierarchy = await customize.evaluate((element) => {
    const parent = element.closest("fieldset");
    const details = element.closest("[data-design-customize]");
    return {
      inset:
        element.getBoundingClientRect().left -
        parent.getBoundingClientRect().left,
      rail: parseFloat(getComputedStyle(details).borderLeftWidth),
      background: getComputedStyle(element).backgroundColor,
    };
  });
  expect(hierarchy.inset).toBeGreaterThanOrEqual(14);
  expect(hierarchy.rail).toBe(2);
  expect(hierarchy.background).not.toBe("rgba(0, 0, 0, 0)");
  await customize.click();
  const background = page.getByRole("textbox", {
    name: "Background hex value",
    exact: true,
  });
  await background.click();
  await background.fill("#334455");
  await background.press("Tab");
  await expect(colors).toHaveText("1ColorsInk · Modified");
  await expect(ink).toBeChecked();
  await expect(ink).toBeEnabled();
  await expect(ink).toHaveCSS("background-color", selectedBackground);
  await openSidebarPanel(page, "Images");
  await openSidebarPanel(page, "Design");
  await expect(colors).toHaveText("1ColorsInk · Modified");
  await reloadWorkspace(page);
  await expect(colors).toHaveText("1ColorsInk · Modified");
  await expect(ink).toBeChecked();
  expect((await savedWorkspace(page)).grid.colorTheme).toBe("Ink");
  await ink.press("Enter");
  await expect(colors).toHaveText("1ColorsInk");
  await expect(ink).toBeChecked();
  for (const [width, columns] of [
    [1440, 3],
    [835, 4],
    [390, 3],
    [320, 2],
    [260, 1],
    [220, 1],
  ]) {
    await setEditorViewport(page, { width, height: 844 });
    await openSidebarPanel(page, "Design");
    await expect(colors).toHaveText("1ColorsInk");
    const palettes = builder.getByRole("radiogroup", {
      name: "Colors",
      exact: true,
    });
    await expect(palettes.getByRole("radio")).toHaveCount(8);
    await expect
      .poll(() =>
        palettes.evaluate(
          (element) =>
            getComputedStyle(element).gridTemplateColumns.split(" ").length,
        ),
      )
      .toBe(columns);
    expect(
      await palettes.getByRole("radio").evaluateAll((elements) =>
        elements.every((element) => {
          const bounds = element.getBoundingClientRect();
          const label = element.lastElementChild.getBoundingClientRect();
          return label.left >= bounds.left && label.right <= bounds.right;
        }),
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`design-applied-${width}.png`),
      fullPage: true,
    });
  }
});

test("theme builder composes independent choices and detailed values without replacing content", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await useComicExample(page);
  await page.getByRole("button", { name: "Remove row", exact: true }).click();
  await expect
    .poll(async () => (await localDatabase(page)).document.grid.rows)
    .toBe(1);
  const original = await savedWorkspace(page);
  expect(original.grid.overflow).toEqual([]);
  await openSidebarPanel(page, "Design");
  const builder = page.locator("[data-theme-builder]");
  await expect(
    page.getByRole("tab", { name: "Settings", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator("[data-theme-tile], [data-preset-preview]"),
  ).toHaveCount(0);
  await builder.getByRole("radio", { name: "Snow", exact: true }).focus();
  await builder
    .getByRole("radio", { name: "Snow", exact: true })
    .press("ArrowRight");
  await expect(
    builder.getByRole("radio", { name: "Ink", exact: true }),
  ).toBeChecked();
  await expect(
    builder.getByRole("radio", { name: "Ink", exact: true }),
  ).toBeEnabled();
  await builder.getByRole("radio", { name: "Ink", exact: true }).click();
  await expect(
    builder.getByRole("radio", { name: "Ink", exact: true }),
  ).toBeDisabled();
  await builder.getByRole("radio", { name: "Forest", exact: true }).click();
  await expect(
    builder.getByRole("radio", { name: "Forest", exact: true }),
  ).toBeChecked();
  await expect
    .poll(async () => (await localDatabase(page)).document.grid.background)
    .toBe("#18382b");
  expect((await savedWorkspace(page)).grid.imageAspect).toBe(
    original.grid.imageAspect,
  );
  await expect(
    builder.getByRole("button", { name: "Next", exact: true }),
  ).toHaveCount(0);
  await builder.getByRole("button", { name: /2 Layout/ }).click();
  await expect(builder.getByRole("button", { name: /2 Layout/ })).toBeFocused();
  await builder.getByRole("radio", { name: "Landscape", exact: true }).click();
  await selectField(page, "builder-spacing", "compact");
  await builder.locator("[data-customize-toggle]").click();
  await page.locator("#gap").fill("25");
  const spacing = page.locator("#builder-spacing");
  for (const width of [1440, 390, 260]) {
    await setEditorViewport(page, { width, height: 1000 });
    await expect(page.locator("[data-editor-sidebar]")).toHaveCount(1);
    await openDesignControls(page, "gap");
    await expect(spacing).toHaveText("Gap 5% / Padding 6%");
    const customized = await savedWorkspace(page);
    await spacing.click();
    const menu = page.getByRole("listbox");
    await expect(menu.getByRole("option")).toHaveText([
      "Seamless",
      "Compact",
      "Spacious",
    ]);
    await expect(
      menu.getByRole("option", { name: "Custom", exact: true }),
    ).toHaveCount(0);
    await expect(menu.locator("[role=option]:disabled")).toHaveCount(0);
    await expect(menu).toHaveCSS("opacity", "1");
    await page.screenshot({
      path: testInfo.outputPath(`spacing-presets-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    expect((await savedWorkspace(page)).grid).toEqual(customized.grid);
    await spacing.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(spacing).toHaveText("Spacious");
    expect((await savedWorkspace(page)).grid).toMatchObject({
      gap: 60,
      canvasPadding: 60,
    });
    await selectField(page, "builder-spacing", "compact");
    await openDesignControls(page, "gap");
    await page.locator("#gap").fill("33");
    await expect(spacing).toHaveText("Gap 6.6% / Padding 6%");
    await page.locator("#gap").fill("25");
  }
  await setEditorViewport(page, { width: 1440, height: 1000 });
  await expect(page.locator("[data-editor-sidebar]")).toHaveCount(1);
  await builder.getByRole("button", { name: /3 Canvas heading/ }).click();
  await selectField(page, "heading-font", "Bangers");
  await builder
    .getByRole("switch", { name: "Show heading", exact: true })
    .click();
  await expect(page.locator(".board-export-heading")).toHaveCount(0);
  await builder
    .getByRole("switch", { name: "Show heading", exact: true })
    .click();
  await expect(page.locator(".board-export-heading")).toBeVisible();
  await builder.getByRole("button", { name: /4 Card headings/ }).click();
  await builder
    .getByRole("radio", { name: "Below image", exact: true })
    .click();
  await builder
    .getByRole("switch", { name: "Show titles", exact: true })
    .click();
  await expect(page.locator("#caption-position")).toHaveCount(0);
  await builder
    .getByRole("switch", { name: "Show titles", exact: true })
    .click();
  await expect(
    builder.getByRole("radio", { name: "Below image", exact: true }),
  ).toBeChecked();
  await openDesignSection(page, "Colors");
  await builder.getByRole("radio", { name: "Rose", exact: true }).click();
  await builder.locator("[data-customize-toggle]").click();
  await page
    .getByRole("textbox", { name: "Background hex value", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Background hex value", exact: true })
    .fill("#334455");
  await page
    .getByRole("textbox", { name: "Background hex value", exact: true })
    .press("Tab");
  await expect(
    builder.getByRole("button", { name: /1 Colors Rose · Modified/ }),
  ).toBeVisible();
  await expect
    .poll(async () => (await localDatabase(page)).document.grid)
    .toMatchObject({
      background: "#334455",
      imageAspect: "landscape",
      gap: 30,
      canvasPadding: 36,
      headingFont: "Bangers",
      headingVisible: true,
      titlesVisible: true,
      captionPlacement: "below",
    });
  const composed = await savedWorkspace(page);
  expect(composed.grid.cells).toEqual(original.grid.cells);
  expect(composed.grid.heading).toBe(original.grid.heading);
  expect(composed.grid.overflow).toEqual(original.grid.overflow);
  expect(composed.grid.rows).toBe(original.grid.rows);
  expect(composed.grid.columns).toBe(original.grid.columns);
  expect(composed.assets).toEqual(original.assets);
  expect(composed.exportSettings).toEqual(original.exportSettings);
  await reloadWorkspace(page);
  expect((await savedWorkspace(page)).grid).toEqual(composed.grid);
  await openDesignSection(page, "Layout");
  await expect(spacing).toHaveText("Gap 5% / Padding 6%");
  await openDesignSection(page, "Colors");
  await expect(
    builder.getByRole("button", { name: /1 Colors Rose · Modified/ }),
  ).toBeVisible();
  const preferences = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("grids-ui-v1")),
  );
  expect(preferences).not.toHaveProperty("appliedPreset");
  expect(preferences).not.toHaveProperty("presetCustomizations");
  await page.screenshot({
    path: testInfo.outputPath("theme-builder-desktop.png"),
  });
});

touchTest(
  "theme builder steps and detailed controls remain reachable on narrow touch screens",
  async ({ page }, testInfo) => {
    await page.goto("./");
    for (const width of [390, 260]) {
      await setEditorViewport(page, { width, height: 844 });
      await openSidebarPanel(page, "Design");
      const builder = page.locator("[data-theme-builder]");
      for (const title of [
        "Colors",
        "Layout",
        "Canvas heading",
        "Card headings",
      ]) {
        await openDesignSection(page, title);
        await expect(builder.locator("fieldset[id^=theme-step-]")).toHaveCount(
          1,
        );
        const customize = builder.locator("[data-customize-toggle]");
        if (await customize.count()) {
          await openDesignSection(page, title, true);
          const inputs = builder.locator(
            "[data-design-customize] input:visible",
          );
          if (await inputs.count()) {
            await inputs.last().scrollIntoViewIfNeeded();
            await expect(inputs.last()).toBeInViewport({ ratio: 1 });
          }
        }
        expect(
          await builder.evaluate(
            (element) => element.scrollWidth - element.clientWidth,
          ),
        ).toBeLessThanOrEqual(1);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        ).toBeLessThanOrEqual(1);
        await expect(
          page.locator('input:not([type="range"]):focus, textarea:focus'),
        ).toHaveCount(0);
      }
      await openDesignSection(page, "Colors");
      await page.screenshot({
        path: testInfo.outputPath(`theme-builder-mobile-${width}.png`),
      });
    }
  },
);

test("Design disclosures provide linked panels, keyboard toggles and reduced-motion-aware animation", async ({
  page,
}) => {
  await page.goto("./");
  await openSidebarPanel(page, "Design");
  const builder = page.locator("[data-theme-builder]");
  const colors = builder.getByRole("button", { name: /^1 Colors/ });
  const customize = builder.getByRole("button", {
    name: "Customize Colors",
    exact: true,
  });
  for (const reducedMotion of ["no-preference", "reduce"]) {
    await page.emulateMedia({ reducedMotion });
    await customize.evaluate((element) => {
      window.designAnimationFrames = [];
      let frames = 0;
      const sample = () => {
        const panelId = element.getAttribute("aria-controls");
        const panel = panelId ? document.getElementById(panelId) : null;
        if (panel) {
          window.designAnimationFrames.push({
            height: panel.getBoundingClientRect().height,
            opacity: Number(getComputedStyle(panel).opacity),
          });
        }
        frames += 1;
        if (frames < 40) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await customize.press("Enter");
    await expect(customize).toHaveAttribute("aria-expanded", "true");
    await expect(customize).toHaveAttribute("aria-controls", /.+/);
    const panelId = await customize.getAttribute("aria-controls");
    const panel = page.locator(`[id="${panelId}"]`);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveCSS("opacity", "1");
    if (reducedMotion === "no-preference") {
      await expect
        .poll(() =>
          page.evaluate(() =>
            window.designAnimationFrames.some(
              (frame) =>
                frame.height > 0 && frame.opacity > 0 && frame.opacity < 1,
            ),
          ),
        )
        .toBe(true);
    }
    await customize.press("Space");
    await expect(customize).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toHaveCount(0);
    await expect(customize).toBeFocused();
  }
  await colors.press("Space");
  await expect(colors).toHaveAttribute("aria-expanded", "false");
  await expect(builder.locator("fieldset[id^=theme-step-]")).toHaveCount(0);
  await colors.press("Enter");
  await expect(colors).toHaveAttribute("aria-expanded", "true");
  await expect(colors).toHaveAttribute("aria-controls", /.+/);
  const panelId = await colors.getAttribute("aria-controls");
  await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
});

test("opening Design accordions reveals their toggles and maximum content in the owning scroller", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  const builder = page.locator("[data-theme-builder]");
  for (const viewport of [
    { width: 1440, height: 1080 },
    { width: 1440, height: 480 },
    { width: 390, height: 640 },
    { width: 260, height: 560 },
  ]) {
    await setEditorViewport(page, viewport);
    for (const tab of ["Images", "Design"]) {
      await openSidebarPanel(page, tab);
      await expect(page.locator("[data-sidebar-panels]")).toHaveCSS(
        "padding",
        tab === "Design" ? "0px" : "12px",
      );
      const insets = await page
        .locator("[data-sidebar-panels]")
        .evaluate((element) => {
          const content = element.querySelector(
            '[role="tabpanel"]:not([hidden])',
          );
          const bounds = element.getBoundingClientRect();
          const inner = content.getBoundingClientRect();
          return {
            left: inner.left - bounds.left,
            right: bounds.left + element.clientWidth - inner.right,
          };
        });
      expect(insets.left).toBeCloseTo(tab === "Design" ? 0 : 12, 0);
      expect(insets.right).toBeCloseTo(tab === "Design" ? 0 : 12, 0);
      if (tab === "Design") {
        const trigger = builder.getByRole("button", { name: /^1 Colors/ });
        await page.mouse.move(0, 0);
        const idle = await trigger.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        );
        await expect(trigger).toHaveCSS("padding", "12px 48px 12px 12px");
        await trigger.hover();
        await expect
          .poll(() =>
            trigger.evaluate(
              (element) => getComputedStyle(element).backgroundColor,
            ),
          )
          .not.toBe(idle);
        const edges = await trigger.evaluate((element) => {
          const row = element.getBoundingClientRect();
          const arrow = element.querySelector("svg").getBoundingClientRect();
          const panel = element
            .closest('[role="tabpanel"]')
            .getBoundingClientRect();
          return {
            left: row.left - panel.left,
            right: panel.right - row.right,
            arrowRight: row.right - arrow.right,
            arrowTop: arrow.top - row.top,
            arrowBottom: row.bottom - arrow.bottom,
          };
        });
        expect(edges.left).toBeCloseTo(0, 0);
        expect(edges.right).toBeCloseTo(0, 0);
        expect(edges.arrowRight).toBeCloseTo(edges.arrowTop, 0);
        expect(edges.arrowRight).toBeCloseTo(edges.arrowBottom, 0);
        await page.screenshot({
          path: testInfo.outputPath(
            `design-trigger-hover-${viewport.width}-${viewport.height}.png`,
          ),
        });
      }
      if (tab === "Images" && viewport.width < 901) {
        const upload = page.locator("[data-upload-tile]");
        await upload.hover();
        await expect(upload).toHaveAttribute("data-image-hovered", "");
        const frameVisible = await upload.evaluate((element) => {
          const library = element.closest("#asset-library");
          const bounds = library.getBoundingClientRect();
          const frame = element
            .querySelector("[data-card-content]")
            .getBoundingClientRect();
          return (
            frame.left >= bounds.left &&
            frame.top >= bounds.top &&
            frame.right <= bounds.left + library.clientWidth &&
            frame.bottom <= bounds.top + library.clientHeight
          );
        });
        expect(frameVisible).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`images-hover-${viewport.width}.png`),
        });
      }
    }
    const workspace = page.locator("[data-workspace-scroll]");
    const before = await workspace.evaluate((element) => ({
      top: element.scrollTop,
      left: element.scrollLeft,
      pageTop: window.scrollY,
    }));
    const checkReveal = async (target) => {
      await expect(target).toHaveAttribute("aria-controls", /.+/);
      const panelId = await target.getAttribute("aria-controls");
      await expect(page.locator(`[id="${panelId}"]`)).toHaveCSS("opacity", "1");
      await expect
        .poll(() =>
          target.evaluate((element) => {
            const compact = innerWidth < 901;
            const scroller = compact
              ? element.closest("[data-sidebar-panels]")
              : element.closest("[data-editor-sidebar]");
            const viewport = scroller.getBoundingClientRect();
            const sticky = compact
              ? null
              : scroller.querySelector("[data-sidebar-sticky]");
            const padding = getComputedStyle(
              element.closest("[data-sidebar-panels]"),
            );
            const top =
              Math.max(
                viewport.top + scroller.clientTop,
                sticky?.getBoundingClientRect().bottom ?? viewport.top,
              ) + parseFloat(padding.paddingTop);
            const bottom =
              viewport.top +
              scroller.clientTop +
              scroller.clientHeight -
              parseFloat(padding.paddingBottom);
            const toggle = element.getBoundingClientRect();
            const accordion = element
              .closest("[data-design-accordion]")
              .getBoundingClientRect();
            const visible = Math.max(
              0,
              Math.min(accordion.bottom, bottom) - Math.max(accordion.top, top),
            );
            return (
              toggle.top >= top - 1 &&
              toggle.bottom <= bottom + 1 &&
              visible >= Math.min(accordion.height, bottom - top) - 1
            );
          }),
        )
        .toBe(true);
    };
    for (const title of [
      "Layout",
      "Card headings",
      "Colors",
      "Canvas heading",
    ]) {
      const toggle = builder.getByRole("button", {
        name: new RegExp(`^\\d ${title}`),
      });
      const chevronAngle = () =>
        toggle.locator("svg").evaluate((chevron) => {
          const transform = new DOMMatrix(
            getComputedStyle(chevron.parentElement).transform,
          );
          return Math.round(
            Math.abs((Math.atan2(transform.b, transform.a) * 180) / Math.PI),
          );
        });
      await expect.poll(chevronAngle).toBe(0);
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect.poll(chevronAngle).toBe(180);
      await expect(builder.locator("fieldset[id^=theme-step-]")).toHaveCount(1);
      await checkReveal(toggle);
      const customize = builder.locator("[data-customize-toggle]");
      if (await customize.count()) {
        if ((await customize.getAttribute("aria-expanded")) === "true") {
          await customize.click();
        }
        await customize.focus();
        await customize.press("Enter");
        await expect(
          builder.locator('[data-customize-toggle][aria-expanded="true"]'),
        ).toHaveCount(1);
        await checkReveal(customize);
      }
    }
    expect(
      await workspace.evaluate((element) => ({
        top: element.scrollTop,
        left: element.scrollLeft,
        pageTop: window.scrollY,
      })),
    ).toEqual(before);
    await expect(
      page.locator('input:not([type="range"]):focus, textarea:focus'),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(
        `accordion-reveal-${viewport.width}-${viewport.height}.png`,
      ),
      fullPage: true,
    });
  }
});

test("reset tab confirms clearing the grid and all images at every screen size", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await useComicExample(page);
  const firstTitle = await page
    .locator(".library-heading")
    .first()
    .inputValue();
  await page
    .getByRole("button", { name: `Image options: ${firstTitle}`, exact: true })
    .hover();
  await page.getByRole("button", { name: "Delete image", exact: true }).click();
  await editHeading(page, "Reset this heading");
  await openSidebarPanel(page, "Design");
  await openDesignSection(page, "Layout");
  await page.locator("#theme-step-1 [data-customize-toggle]").click();
  await page.locator("#gap").fill("20");
  await page.getByRole("button", { name: "Remove row", exact: true }).click();
  const before = await savedWorkspace(page);
  const blobs = (await localDatabase(page)).images;
  expect(before.assets.some((asset) => asset.libraryHidden)).toBe(true);
  expect(before.grid.overflow).toEqual([]);
  const sources = await page
    .locator(".grid-cell img")
    .evaluateAll((images) => images.map((image) => image.src));
  const trigger = page.getByRole("tab", {
    name: "Reset",
    exact: true,
  });
  const dialog = page.getByRole("dialog", {
    name: "Reset",
    exact: true,
  });
  for (const width of [260, 390, 900, 901, 1440]) {
    await setEditorViewport(page, { width, height: 900 });
    await openSidebarPanel(page, "Design");
    await expect(
      page.getByRole("button", {
        name: "Reset grid settings",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(trigger).toHaveCount(1);
    await expect(trigger).toBeInViewport({ ratio: 1 });
    await expect(trigger).toHaveAttribute(
      "title",
      "Reset grid, canvas, theme or library",
    );
    const header = page.locator("[data-canvas-header]");
    await expect(
      header.getByRole("button", {
        name: "Reset",
        exact: true,
      }),
    ).toHaveCount(0);
    const bounds = await trigger.boundingBox();
    const designBounds = await page
      .getByRole("tab", { name: "Design", exact: true })
      .boundingBox();
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    if (width < 901) {
      expect(bounds.y).toBeGreaterThanOrEqual(
        designBounds.y + designBounds.height - 1,
      );
      expect(bounds.x).toBe(designBounds.x);
    } else {
      expect(bounds.x).toBeGreaterThanOrEqual(
        designBounds.x + designBounds.width - 1,
      );
      expect(bounds.y).toBe(designBounds.y);
      expect(bounds.width).toBeLessThanOrEqual(45);
    }
    await expect(
      page.getByRole("button", { name: "Clear images", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`reset-tab-${width}.png`),
    });
    await trigger.click();
    await expect(dialog.getByRole("checkbox", { checked: true })).toHaveCount(
      0,
    );
    await expect(
      dialog.getByRole("button", { name: "Reset selected", exact: true }),
    ).toBeDisabled();
    await selectEveryResetOption(dialog);
    await reviewReset(
      dialog,
      ["placements", "canvas", "theme", "images"],
      "default",
    );
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await expect(dialog.locator("[data-reset-review]")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(
      page.getByRole("tab", { name: "Design", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    expect((await localDatabase(page)).document).toEqual(before);
    expect((await localDatabase(page)).images).toEqual(blobs);
  }
  await resetEverything(page);
  await expect
    .poll(async () => (await localDatabase(page)).document?.grid.id)
    .not.toBe(before.grid.id);
  const reset = await savedWorkspace(page);
  expect(reset.grid).toMatchObject({
    rows: 2,
    columns: 2,
    heading: "",
    gap: 24,
    imageAspect: "portrait",
    captionPlacement: "overlay",
    captionAlignment: "bottom",
    overflow: [],
  });
  expect(
    reset.grid.cells.every(
      (cell) => !cell.assetId && !cell.title && !cell.crop,
    ),
  ).toBe(true);
  expect(reset.assets).toEqual([]);
  expect((await localDatabase(page)).images).toEqual([]);
  for (const src of sources) {
    expect(
      await page.evaluate(async (src) => {
        try {
          await fetch(src);
          return false;
        } catch {
          return true;
        }
      }, src),
    ).toBe(true);
  }
  await reloadWorkspace(page);
  expect((await savedWorkspace(page)).grid).toEqual(reset.grid);
  await openSidebarPanel(page, "Images");
  await expect(page.locator(".asset")).toHaveCount(0);
  await expect(page.locator(".grid-cell img")).toHaveCount(0);
});

test("sidebar scrolling stays independent of page scrolling and export dialogs remain usable", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await openSidebarPanel(page, "Design");
  await page.locator("#upload").setInputFiles(
    ["One", "Two", "Three"].map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  await expect(page.locator(".asset")).toHaveCount(3);
  await savedWorkspace(page);
  for (const width of [1440, 960]) {
    await setEditorViewport(page, { width, height: 3000 });
    await openSidebarPanel(page, "Images");
    for (const selector of ["#asset-library", "[data-theme-builder]"]) {
      const sidebar = page.locator("[data-editor-sidebar]");
      await openSidebarPanel(
        page,
        selector === "#asset-library" ? "Images" : "Design",
      );
      const aside = page.locator(selector);

      const body = sidebar.locator("[data-sidebar-panels]");

      const header = sidebar.locator("[data-sidebar-sticky]");
      const before = await body.evaluate((element) => {
        element.scrollTop = 0;
        const child = element
          .querySelector('[role="tabpanel"]:not([hidden])')
          .getBoundingClientRect();
        return {
          x: child.x,
          width: child.width,
          height: element.getBoundingClientRect().height,
          overflowing: element.scrollHeight > element.clientHeight,
        };
      });
      expect(before.height).toBeGreaterThan(0);
      expect(before.height).toBeLessThan(3000);
      expect(before.overflowing).toBe(false);
      await body.evaluate((element) => {
        const spacer = document.createElement("div");
        spacer.dataset.scrollProbe = "";
        spacer.style.height = "6000px";
        spacer.style.flexShrink = "0";
        element.append(spacer);
      });
      await expect
        .poll(() =>
          body.evaluate(
            (element) => element.scrollHeight > element.clientHeight,
          ),
        )
        .toBe(true);
      const pageScroll = await page.evaluate(() => scrollY);
      await body.hover();
      await page.mouse.wheel(0, 160);
      await expect
        .poll(() => body.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      expect(await page.evaluate(() => scrollY)).toBe(pageScroll);
      await expect(header).toBeInViewport();
      await body.evaluate((element) => {
        element.querySelector("[data-scroll-probe]").remove();
        element.scrollTop = 0;
      });
      expect(
        await body.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await aside.screenshot({
        path: testInfo.outputPath(`aside-${selector.slice(1)}-${width}.png`),
      });
    }
  }
  const settings = page.locator("[data-theme-builder]");
  await page.locator("#export-grid-header").click();
  const dialog = page.getByRole("dialog", { name: "Export grid", exact: true });
  await expect(dialog).toBeVisible();

  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);

  await setEditorViewport(page, { width: 390, height: 844 });
  await showSidebar(page);
});

test("font previews and independent weights persist and match exports without themes", async ({
  page,
}, testInfo) => {
  await setEditorViewport(page, { width: 1440, height: 1000 });
  await page.addInitScript(() => {
    window.fontWeightDraws = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.fontWeightDraws.push({ text, font: this.font });
      return fillText.call(this, text, ...args);
    };
  });
  await page.goto("./");
  await uploadCellImage(page);
  await openSidebarPanel(page, "Design");
  await expect(page.locator("#theme-selector")).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Superhero sub-theme", exact: true }),
  ).toHaveCount(0);
  for (const id of ["heading-font", "cell-font"]) {
    await openDesignControls(page, id);
    await page.locator(`#${id}`).click();
    await expect(page.getByRole("listbox").getByRole("option")).toHaveText([
      "Bangers",
      "Bebas Neue",
      "Boogaloo",
      "Manrope",
    ]);
    const selected = page
      .getByRole("listbox")
      .locator('[aria-selected="true"]');
    await expect(selected).toHaveJSProperty("disabled", true);

    await page.getByRole("listbox").press("Home");
    await expect(
      page.getByRole("option", { name: "Bangers", exact: true }),
    ).toHaveAttribute("data-focus", "");
    await expect(selected).not.toHaveAttribute("data-focus", "");

    for (const font of ["Manrope", "Bangers", "Boogaloo", "Bebas Neue"]) {
      const option = page
        .getByRole("listbox")
        .locator(`[data-value="${font}"]`);

      await expect
        .poll(() =>
          option.evaluate((element) =>
            getComputedStyle(element).fontFamily.replaceAll('"', ""),
          ),
        )
        .toBe(font);
    }
    await page.keyboard.press("Escape");
    for (const font of ["Bangers", "Boogaloo", "Bebas Neue", "Manrope"]) {
      await selectField(page, id, font);

      await expect
        .poll(() =>
          page
            .locator(`#${id} span`)
            .evaluate((element) =>
              getComputedStyle(element).fontFamily.replaceAll('"', ""),
            ),
        )
        .toBe(font);
      await openDesignControls(page, `${id}-weight`);
      const weight = page.locator(`#${id}-weight`);
      await expect(weight).toHaveAttribute("type", "range");
      await expect(weight).toHaveAttribute("min", "0");
      await expect(weight).toHaveAttribute("max", "100");
      await expect(weight).toHaveAttribute(
        "step",
        font === "Manrope" ? "12.5" : "100",
      );
      await weight.fill(font === "Manrope" ? "37.5" : "0");
      await expect(weight).toHaveValue(font === "Manrope" ? "37.5" : "0");
      await weight.press("ArrowRight");
      await expect(weight).toHaveValue(font === "Manrope" ? "50" : "100");
      await weight.press("ArrowLeft");
      await expect(weight).toHaveValue(font === "Manrope" ? "37.5" : "0");
      await expect(page.getByRole("listbox")).toHaveCount(0);
    }
  }
  await openDesignControls(page, "heading-font-weight");
  await page.locator("#heading-font-weight").press("End");
  await openDesignControls(page, "heading-font-weight");
  await page.locator("#heading-font-weight").press("ArrowLeft");
  await selectField(page, "heading-font", "Bangers");
  await openDesignControls(page, "heading-font-weight");
  await expect(page.locator("#heading-font-weight")).toHaveValue("100");
  await openDesignControls(page, "heading-font-weight");
  await expect(page.locator("#heading-font-weight")).toHaveAttribute(
    "aria-valuetext",
    "Bold",
  );
  await selectField(page, "heading-font", "Manrope");
  await openDesignControls(page, "heading-font-weight");
  await expect(page.locator("#heading-font-weight")).toHaveAttribute(
    "max",
    "100",
  );
  await openDesignControls(page, "heading-font-weight");
  await page.locator("#heading-font-weight").press("End");
  await openDesignControls(page, "heading-font-weight");
  await page.locator("#heading-font-weight").press("ArrowLeft");
  await openDesignControls(page, "heading-font-weight");
  await expect(page.locator("#heading-font-weight")).toHaveValue("87.5");
  await openDesignControls(page, "cell-font-weight");
  await page.locator("#cell-font-weight").fill("75");
  await openDesignControls(page, "cell-font-size");
  await page.locator("#cell-font-size").fill("20");
  await page.getByRole("button", { name: /^Edit grid heading: / }).click();
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .fill("Weight check");
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .press("Enter");
  await page
    .locator("#board-grid .cell-heading")
    .first()
    .fill("Weighted caption");
  await expect(page.locator(".board-export-heading")).toHaveCSS(
    "font-weight",
    "800",
  );
  await expect(page.locator("#board-grid .cell-heading").first()).toHaveCSS(
    "font-weight",
    "700",
  );
  await openDesignControls(page, "heading-font");
  await expect(page.locator("#heading-font span")).toHaveCSS(
    "font-weight",
    "800",
  );
  await openDesignControls(page, "cell-font");
  await expect(page.locator("#cell-font span")).toHaveCSS("font-weight", "700");
  await openDesignControls(page, "heading-font");
  await page.locator("#heading-font").click();
  await page.screenshot({
    path: testInfo.outputPath("font-previews-desktop.png"),
  });
  await page.keyboard.press("Escape");
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  await downloadBoard(page);
  const draws = await page.evaluate(() => window.fontWeightDraws);
  expect(draws.find((entry) => entry.text === "WEIGHT CHECK")?.font).toMatch(
    /^800 .*Manrope/,
  );
  const captions = draws.filter((entry) =>
    ["Weighted", "caption", "Weighted caption"].includes(entry.text),
  );
  expect(captions.map((entry) => entry.text).join(" ")).toBe(
    "Weighted caption",
  );
  for (const caption of captions)
    expect(caption.font).toMatch(/^(700|bold) .*Manrope/);
  const saved = await savedWorkspace(page);
  expect(saved.grid).toMatchObject({
    headingFontWeight: 800,
    cellFontWeight: 700,
  });
  expect(saved.grid).not.toHaveProperty("template");
  expect(saved).not.toHaveProperty("themeSettings");
  await reloadWorkspace(page);
  await openDesignControls(page, "heading-font-weight");
  await expect(page.locator("#heading-font-weight")).toHaveValue("87.5");
  await openDesignControls(page, "heading-font-weight");
  await expect(page.locator("#heading-font-weight")).toHaveAttribute(
    "aria-valuetext",
    "Extra bold",
  );
  await openDesignControls(page, "cell-font-weight");
  await expect(page.locator("#cell-font-weight")).toHaveValue("75");
  await expect(page.locator(".board-export-heading")).toHaveCSS(
    "font-weight",
    "800",
  );
  const settings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("grids-settings-v1")),
  );
  expect(settings.style).toMatchObject({
    headingFontWeight: 800,
    cellFontWeight: 700,
  });
  expect(settings).not.toHaveProperty("themeSettings");
  await setEditorViewport(page, { width: 390, height: 844 });
  await showSidebar(page);
  await openDesignControls(page, "cell-font-weight");
  await page.locator("#cell-font-weight").fill("62.5");
  await expect(page.locator("#board-grid .cell-heading").first()).toHaveCSS(
    "font-weight",
    "600",
  );
  await openDesignControls(page, "cell-font-weight");
  await page.locator("#cell-font-weight").fill("75");
  await openDesignControls(page, "heading-font");
  await page.locator("#heading-font").click();
  await expect(
    page.getByRole("listbox").locator('[data-value="Manrope"]'),
  ).toHaveCSS("font-weight", "800");
  await expect
    .poll(() =>
      page.getByRole("listbox").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left >= 0 &&
          rect.right <= innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= innerHeight
        );
      }),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("font-previews-mobile.png"),
  });
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("heading and card typography controls are independent across previews, exports and saved settings", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await openSidebarPanel(page, "Design");
  await page.getByRole("button", { name: /^Edit grid heading: / }).click();
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .fill("Team");
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .press("Enter");
  await page.locator("#upload").setInputFiles({
    name: "Caption.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
    ),
  });
  await openSidebarPanel(page, "Images");
  await page
    .locator("[data-library-thumbnail]")
    .first()
    .dragTo(page.locator(".cell-image-button").first());
  await openSidebarPanel(page, "Design");
  await openDesignControls(page, "heading-font-size");
  await expect(
    page.getByRole("group", { name: "Canvas heading style", exact: true }),
  ).toContainText("Font");
  await openDesignControls(page, "cell-font-size");
  await expect(
    page.getByRole("group", { name: "Card style", exact: true }),
  ).toContainText("Font");
  await selectField(page, "heading-font", "Bebas Neue");
  await openDesignControls(page, "heading-font-size");
  await page.locator("#heading-font-size").fill("80");
  await openDesignControls(page, "heading-text-color-value");
  const headingHex = page.locator("#heading-text-color-value");
  await headingHex.fill("#cc4488");
  await headingHex.press("Tab");
  await expect(page.locator(".cell-heading").first()).toHaveCSS(
    "color",
    "rgb(238, 241, 243)",
  );
  await selectField(page, "cell-font", "Boogaloo");
  await openDesignControls(page, "cell-font-size");
  await page.locator("#cell-font-size").fill("60");
  await openDesignControls(page, "cell-text-color-value");
  const cardHex = page.locator("#cell-text-color-value");
  await cardHex.fill("#39a36f");
  await cardHex.press("Tab");
  const verify = async () => {
    await expect(
      page.getByRole("button", { name: /^Edit grid heading: / }),
    ).toHaveCSS("color", "rgb(204, 68, 136)");
    await expect(
      page.getByRole("button", { name: /^Edit grid heading: / }),
    ).toHaveCSS("font-family", /Bebas Neue/);
    await expect(page.locator(".cell-heading").first()).toHaveCSS(
      "color",
      "rgb(57, 163, 111)",
    );
    if (page.viewportSize().width > 900)
      await expect(page.locator(".asset-name").first()).toHaveCSS(
        "color",
        "rgb(57, 163, 111)",
      );
    await expect(page.locator(".cell-heading").first()).toHaveCSS(
      "font-family",
      /Boogaloo/,
    );
    for (const selector of page.viewportSize().width > 900
      ? [".cell-heading", ".asset-name"]
      : [".cell-heading"]) {
      await expect
        .poll(() =>
          page
            .locator(selector)
            .first()
            .evaluate((field) => {
              const style = getComputedStyle(field);
              return (
                Math.abs(
                  parseFloat(style.fontSize) -
                    field.getBoundingClientRect().width * 0.24,
                ) < 0.2 && field.scrollHeight <= field.clientHeight + 1
              );
            }),
        )
        .toBe(true);
    }
  };
  for (const width of [1440, 390]) {
    await setEditorViewport(page, { width, height: 1000 });
    await openSidebarPanel(page, "Images");
    await verify();
    if (width <= 900) await showSidebar(page);
    for (const name of ["Canvas style", "Canvas heading style", "Card style"]) {
      const section = page.getByRole("group", { name, exact: true });
    }
    for (const name of ["Canvas heading style", "Card style"]) {
      await openDesignControls(
        page,
        name === "Card style" ? "cell-font-size" : "heading-font-size",
      );
      const section = page.getByRole("group", { name, exact: true });
      await section.scrollIntoViewIfNeeded();
      await section.screenshot({
        path: testInfo.outputPath(`${name.replaceAll(" ", "-")}-${width}.png`),
      });
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  const configured = await savedWorkspace(page);
  await openDesignControls(page, "cell-font-size");
  await expect(page.locator("#cell-font-size")).toHaveValue("60");
  await reloadWorkspace(page);
  await openSidebarPanel(page, "Images");
  await verify();
  expect((await savedWorkspace(page)).grid.cells).toEqual(
    configured.grid.cells,
  );
  const settings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("grids-settings-v1")),
  );
  expect(settings.style).toMatchObject({
    headingFontSize: 30,
    cellFontSize: 24,
    headingTextColor: "#cc4488",
    cellTextColor: "#39a36f",
  });
  expect(JSON.stringify(settings)).not.toContain("Caption.svg");
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    window.typographyDrawing = [];
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      ...parameters
    ) {
      window.typographyDrawing.push({
        text,
        font: this.font,
        color: this.fillStyle,
      });
      return original.call(this, text, ...parameters);
    };
  });
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  const download = await downloadBoard(page);
  const bytes = await readFile(await download.path());
  expect(bytes.length).toBeGreaterThan(100);
  const drawing = await page.evaluate(() => window.typographyDrawing);
  expect(
    drawing.some(
      (entry) =>
        entry.text === "TEAM" &&
        entry.font.includes("Bebas Neue") &&
        parseFloat(entry.font.match(/([\d.]+)px/)?.[1]) === 45 &&
        entry.color === "#cc4488",
    ),
  ).toBe(true);
  expect(
    drawing.some(
      (entry) =>
        entry.text === "Caption" &&
        entry.font.includes("Boogaloo") &&
        parseFloat(entry.font.match(/([\d.]+)px/)?.[1]) === 36 &&
        entry.color === "#39a36f",
    ),
  ).toBe(true);
});

test("empty headings use accessible inline placeholders and reserve no export bands", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await openSidebarPanel(page, "Design");
  await openDesignControls(page, "gap");
  await page.locator("#gap").fill("10");
  await openDesignControls(page, "canvas-padding");
  await page.locator("#canvas-padding").fill("10");
  await selectField(page, "image-shape", "square");
  await openDesignControls(page, "cell-text-color-value");
  await page.locator("#cell-text-color-value").fill("#a6d8ff");
  await openDesignControls(page, "cell-text-color-value");
  await page.locator("#cell-text-color-value").press("Tab");
  await page.locator("#upload").setInputFiles({
    name: "Original.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
    ),
  });
  await openSidebarPanel(page, "Images");
  await page
    .locator("[data-library-thumbnail]")
    .first()
    .dragTo(page.locator(".cell-image-button").first());
  await page.locator(".cell-heading").first().fill("");
  await expect(
    page.getByRole("switch", { name: "Show heading", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add heading", exact: true }),
  ).toHaveCount(0);
  for (const width of [1440, 390]) {
    await setEditorViewport(page, { width, height: 1000 });
    await page.locator("#export-grid-header").focus();
    await page.mouse.move(1, 1);
    const trigger = page.getByRole("button", {
      name: /^Edit grid heading: /,
    });
    const placeholder = trigger.locator("[data-heading-placeholder]");
    await expect(placeholder).toHaveText("Add heading");
    await expect(trigger).toHaveAccessibleName(
      "Edit grid heading: Add heading",
    );

    const contrast = await placeholder.evaluate((element) => {
      const context = document.createElement("canvas").getContext("2d");
      const luminance = (color) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const channels = [...context.getImageData(0, 0, 1, 1).data]
          .slice(0, 3)
          .map((channel) => {
            const value = channel / 255;
            return value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4;
          });
        return (
          channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
        );
      };
      const foreground = luminance(getComputedStyle(element).color);
      const background = luminance(
        getComputedStyle(element.closest("h2")).backgroundColor,
      );
      return (
        (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05)
      );
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await trigger.hover();

    for (const selector of width > 900
      ? [".cell-heading", ".asset-name"]
      : [".cell-heading"]) {
      const field = page.locator(selector).first();
      await expect(field).toHaveAttribute("placeholder", "Add heading");
      const textColor = await field.evaluate(
        (element) => getComputedStyle(element).color,
      );
      expect(textColor).toBe("rgb(166, 216, 255)");
      await page.mouse.move(1, 1);

      expect(
        await field.evaluate(
          (element) => getComputedStyle(element, "::placeholder").color,
        ),
      ).toBe(textColor);
      await field.hover();

      if (selector === ".cell-heading") {
        const preview = field.locator("..").locator("[data-caption-preview]");

        await expect(preview).toHaveCSS("color", textColor);

        await page.mouse.move(1, 1);

        await field.focus();
        await expect(preview).toBeHidden();

        await field.fill("Written title");

        await expect(field).toHaveCSS("color", textColor);
        await page.locator("#export-grid-header").focus();
        await expect(preview).toBeVisible();
        await expect(preview).toHaveText("Written title");
        await expect(preview).toHaveCSS("color", textColor);

        await field.fill("");
        await page.locator("#export-grid-header").focus();
      }
    }
    await trigger.click();
    const heading = page.getByRole("textbox", {
      name: "Grid heading",
      exact: true,
    });
    await expect(heading).toHaveAttribute("placeholder", "Add heading");
    await heading.fill("Temporary");
    await heading.press("Enter");
    await expect(trigger).toHaveText("Temporary");
    await expect(trigger).toHaveAccessibleName("Edit grid heading: Temporary");
    await trigger.click();
    await heading.fill("");
    await heading.press("Enter");
    await expect(placeholder).toHaveText("Add heading");
    await page.locator("#board-grid").screenshot({
      path: testInfo.outputPath(`empty-heading-placeholders-${width}.png`),
    });
  }
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    window.emptyHeadingDrawing = [];
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      ...parameters
    ) {
      window.emptyHeadingDrawing.push(text);
      return original.call(this, text, ...parameters);
    };
  });
  const exportSize = async () => {
    await page.locator("#export-grid-header").click();
    await selectField(page, "resolution", "150");
    const download = await downloadBoard(page);
    const bytes = await readFile(await download.path());
    return page.evaluate(
      async (bytes) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const dimensions = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return dimensions;
      },
      [...bytes],
    );
  };
  for (const mode of ["above", "below", "overlay-bottom"]) {
    await selectField(page, "caption-position", mode);
    expect(await exportSize()).toEqual({ width: 462, height: 462 });
  }
  expect(await page.evaluate(() => window.emptyHeadingDrawing)).toEqual([]);
  await selectField(page, "caption-position", "below");
  await page.locator(".cell-heading").first().fill("Filled");
  expect(await exportSize()).toEqual({ width: 462, height: 498 });
  await page.locator(".cell-heading").first().fill("");
  await page.getByRole("button", { name: /^Edit grid heading: / }).click();
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .fill("Team");
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .press("Enter");
  expect(await exportSize()).toEqual({ width: 462, height: 524 });
  await page.locator(".cell-heading").first().fill("Filled");
  expect(await exportSize()).toEqual({ width: 462, height: 560 });
});

test("grid headings support mouse and keyboard editing across viewport sizes", async ({
  page,
}) => {
  await page.goto("./");
  for (const viewport of [
    { width: 1440, height: 844 },
    { width: 960, height: 844 },
    { width: 390, height: 844 },
    { width: 1440, height: 360 },
  ]) {
    await setEditorViewport(page, viewport);
    const trigger = page.getByRole("button", { name: /^Edit grid heading: / });
    await trigger.click();
    const field = page.getByRole("textbox", {
      name: "Grid heading",
      exact: true,
    });
    await expect(field).toBeFocused();
    await field.fill("Team DC edited");
    await field.press("Escape");
    await expect(trigger).toHaveText("Team DC edited");
    await trigger.focus();
    await trigger.press("Enter");
    await expect(field).toBeFocused();
    await field.fill("");
    await field.press("Enter");
    await expect(trigger).toHaveAccessibleName(
      "Edit grid heading: Add heading",
    );
    await trigger.click();
    await field.fill("Team DC");
    await field.press("Enter");
    await expect(trigger).toHaveText("Team DC");
  }
  await reloadWorkspace(page);
  await expect(
    page.getByRole("button", {
      name: "Edit grid heading: Team DC",
      exact: true,
    }),
  ).toBeVisible();
});

for (const [platform, headingTest] of [
  ["desktop", test],
  ["touch", touchTest],
]) {
  headingTest(
    `${platform} grid headings keep their font size, clamp to three lines and scroll outside while editing`,
    async ({ page }) => {
      await page.goto("./");
      const title =
        "Line one\nLine two\nLine three\nLine four\nLine five\nLine six";
      await editHeading(page, title);
      const preview = page.locator("[data-heading-preview]");
      await expect(preview).toHaveText(title);
      await expect
        .poll(() =>
          preview.evaluate((text) => {
            const heading = text.closest("h2");
            const style = getComputedStyle(heading);
            const fontSize = parseFloat(style.fontSize);
            return {
              chosenSize:
                Math.abs(
                  fontSize -
                    parseFloat(style.getPropertyValue("--preview-cell-width")) *
                      0.21,
                ) < 0.1,
              clamp: getComputedStyle(text).webkitLineClamp,
              bounded: text.clientHeight <= fontSize * (3 * 1.05 + 0.15) + 1,
              overflow: text.scrollHeight > text.clientHeight,
            };
          }),
        )
        .toEqual({
          chosenSize: true,
          clamp: "3",
          bounded: true,
          overflow: true,
        });

      const trigger = page.getByRole("button", {
        name: /^Edit grid heading: /,
      });
      const bounds = await trigger.boundingBox();
      await trigger.click();
      const field = page.getByRole("textbox", {
        name: "Grid heading",
        exact: true,
      });
      await expect(field).toBeFocused();
      await expect(field).toHaveValue(title);
      expect(await field.boundingBox()).toEqual(bounds);
      const scrollbar = page.locator("[data-heading-scrollbar]");
      await expect(scrollbar).toBeVisible();
      const track = await scrollbar.boundingBox();
      expect(
        track.x >= bounds.x + bounds.width || track.x + track.width <= bounds.x,
      ).toBe(true);
      expect(track.x).toBeGreaterThanOrEqual(0);
      await field.evaluate((element) => {
        element.scrollTop = 0;
      });
      await expect
        .poll(() => field.evaluate((element) => element.scrollTop))
        .toBe(0);
      expect(track.x + track.width).toBeLessThanOrEqual(
        page.viewportSize().width,
      );
      await page.mouse.move(track.x + track.width / 2, track.y + 3);
      await page.mouse.down();
      await page.mouse.move(
        track.x + track.width / 2,
        track.y + track.height - 2,
        { steps: 5 },
      );
      await page.mouse.up();
      await expect(field).toBeFocused();
      await expect
        .poll(() => field.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      await field.press("Escape");
      await expect(scrollbar).toHaveCount(0);
      await expect(preview).toBeVisible();
      await reloadWorkspace(page);
      await expect(preview).toHaveText(title);

      await selectExportField(page, "resolution", "150");
      await page.evaluate(() => {
        const original = CanvasRenderingContext2D.prototype.fillText;
        window.headingDrawing = [];
        window.restoreHeadingDrawing = () => {
          CanvasRenderingContext2D.prototype.fillText = original;
        };
        CanvasRenderingContext2D.prototype.fillText = function (
          text,
          ...parameters
        ) {
          window.headingDrawing.push({ text, font: this.font });
          return original.call(this, text, ...parameters);
        };
      });
      const download = await downloadBoard(page);
      expect((await readFile(await download.path())).length).toBeGreaterThan(
        100,
      );
      const drawing = await page.evaluate(() => {
        window.restoreHeadingDrawing();
        return window.headingDrawing;
      });
      expect(drawing.map((entry) => entry.text)).toEqual([
        "LINE ONE",
        "LINE TWO",
        "LINE THREE\u2026",
      ]);
      expect(drawing.every((entry) => entry.font.includes("31.5px"))).toBe(
        true,
      );

      await trigger.click();
      await field.fill("First");
      await field.press("End");
      await field.press("Shift+Enter");
      await field.pressSequentially("Second");
      await expect(field).toHaveValue("First\nSecond");
      await field.press("Enter");
      await expect(preview).toHaveText("First\nSecond");
      await expect(scrollbar).toHaveCount(0);
    },
  );
}

test("canvas has no appearance toolbar and the sidebar header stays fixed", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await useComicExample(page);
  for (const width of [1440, 960, 780, 390, 320]) {
    await setEditorViewport(page, { width, height: 600 });
    await expect(
      page.getByRole("toolbar", { name: "Grid appearance" }),
    ).toHaveCount(0);
    const frame = page.locator("[data-resize-frame]");
    const trigger = page.getByRole("button", {
      name: "Export grid",
      exact: true,
    });
    await expect(page.locator(".app-header")).toHaveCount(0);
    await expect(trigger).toHaveCount(1);
    await expect(frame).toBeInViewport();
    await expect(page.locator(".board-export-heading")).toBeInViewport({
      ratio: 1,
    });
    if (width > 900) {
      const sidebar = page.locator("[data-editor-sidebar]");
      const header = page.locator("[data-canvas-header]");
      const headerBounds = await header.boundingBox();
      expect((await sidebar.boundingBox()).y).toBe(
        headerBounds.y + headerBounds.height,
      );
      expect((await sidebar.boundingBox()).height).toBe(
        (await page.evaluate(() => innerHeight)) - headerBounds.height,
      );
      for (const [panel, selector] of [
        ["Images", "#asset-library"],
        ["Design", "[data-theme-builder]"],
      ]) {
        await openSidebarPanel(page, panel);
        if (panel === "Design")
          await openDesignControls(page, "background-value");
        const before = await header.boundingBox();
        const scroller = sidebar.locator("[data-sidebar-panels]");
        expect(
          await scroller.evaluate(
            (element) => element.scrollHeight > element.clientHeight,
          ),
        ).toBe(true);
        await scroller.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        expect(
          await scroller.evaluate((element) => element.scrollTop),
        ).toBeGreaterThan(0);
        expect(await header.boundingBox()).toEqual(before);
      }
      await expect(trigger).toBeInViewport({ ratio: 1 });
    } else {
      await selectField(page, "caption-position", "overlay-bottom");
      const workspace = await page
        .getByRole("region", { name: "Grid editor", exact: true })
        .boundingBox();
      const button = await trigger.boundingBox();
      const headerBounds = await page
        .locator("[data-canvas-header]")
        .boundingBox();
      expect(button.width).toBeGreaterThanOrEqual(44);

      expect(workspace.y).toBe(headerBounds.y + headerBounds.height);
      expect(button.y).toBeGreaterThanOrEqual(headerBounds.y);
      expect(button.y + button.height).toBeLessThanOrEqual(workspace.y);
      expect(button.x + button.width).toBeLessThanOrEqual(
        workspace.x + workspace.width,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.screenshot({
      path: testInfo.outputPath(`fixed-sidebar-aligned-canvas-${width}.png`),
    });
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: "Export grid",
      exact: true,
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

test("export combines settings and downloads on desktop and mobile", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await openSidebarPanel(page, "Design");
  await expect(
    page.getByRole("tab", { name: "Export", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^2 Layout/ })).toBeVisible();
  const trigger = page.getByRole("button", {
    name: "Export grid",
    exact: true,
  });
  const dialog = page.getByRole("dialog", { name: "Export grid", exact: true });
  for (const [format, extension, signature] of [
    ["image/png", "png", [137, 80, 78, 71]],
    ["image/jpeg", "jpg", [255, 216]],
    ["image/webp", "webp", [82, 73, 70, 70]],
  ]) {
    await trigger.click();
    await expect(dialog).toBeVisible();
    await selectField(page, "format", format);
    await selectField(page, "resolution", "150");
    if (format === "image/png") {
      await expect(dialog.locator("#quality")).toHaveCount(0);
      await expect(dialog.locator('label[for="quality"]')).toHaveCount(0);
      await expect(dialog.locator("#quality-value")).toHaveCount(0);
    } else {
      await expect(dialog.locator("#quality")).toBeEnabled();
      await dialog.locator("#quality").fill("60");
    }
    if (format === "image/png")
      await page.screenshot({
        path: testInfo.outputPath("export-dialog-desktop.png"),
      });
    const download = await downloadBoard(page);
    expect(download.suggestedFilename()).toBe(`grid.${extension}`);
    const bytes = await readFile(await download.path());
    expect([...bytes.subarray(0, signature.length)]).toEqual(signature);
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  await reloadWorkspace(page);
  await setEditorViewport(page, { width: 390, height: 844 });
  await trigger.click();
  await expect(dialog.locator("#format")).toHaveText("WebP");
  await expect(dialog.locator("#resolution")).toHaveText("150 px / image");
  await expect(dialog.locator("#quality")).toHaveValue("60");
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await selectField(page, "format", "image/png");
  await expect(dialog.locator("#quality")).toHaveCount(0);
  await expect(dialog.locator('label[for="quality"]')).toHaveCount(0);
  await expect(dialog.locator("#quality-value")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("export-dialog-mobile.png"),
  });
  await selectField(page, "format", "image/jpeg");
  await expect(dialog.locator("#quality")).toBeEnabled();
  await expect(dialog.locator("#quality")).toHaveValue("60");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const [mode, cropTest] of [
  ["desktop", test],
  ["touch", touchTest],
]) {
  cropTest(
    `library crop defaults persist without changing existing placements on ${mode}`,
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("./");
      const original = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="200" height="200" fill="#ff0000"/><rect x="200" width="200" height="200" fill="#00ff00"/><rect x="400" width="200" height="200" fill="#0000ff"/></svg>',
      );
      await page.locator("#upload").setInputFiles({
        name: "Library crop.svg",
        mimeType: "image/svg+xml",
        buffer: original,
      });
      await expect(page.locator("#asset-library .asset")).toHaveCount(1);
      await chooseImage(page, "Library crop");
      const before = await savedWorkspace(page);
      const card = page.locator("#asset-library .asset").first();
      const thumbnail = card.locator("[data-library-thumbnail]");
      async function centerPixel(locator) {
        await page.mouse.move(0, 0);
        const bytes = [...(await locator.screenshot())];
        return page.evaluate(async (bytes) => {
          const bitmap = await createImageBitmap(
            new Blob([new Uint8Array(bytes)], { type: "image/png" }),
          );
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext("2d");
          context.drawImage(bitmap, 0, 0);
          const pixel = [
            ...context.getImageData(
              Math.floor(bitmap.width / 2),
              Math.floor(bitmap.height / 2),
              1,
              1,
            ).data,
          ];
          bitmap.close();
          return pixel;
        }, bytes);
      }
      const cropDialog = page.getByRole("dialog", {
        name: "Crop image",
        exact: true,
      });
      async function openCrop() {
        if (mode === "touch") await thumbnail.tap();
        else await thumbnail.hover();
        await card
          .getByRole("button", { name: "Crop image", exact: true })
          .click();
        await expect(
          cropDialog.getByRole("button", { name: "Apply crop", exact: true }),
        ).toBeEnabled();
      }
      await openCrop();
      await cropDialog.locator("#crop-zoom").fill("2");
      await cropDialog
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(cropDialog).toHaveCount(0);
      await expect(thumbnail).toBeFocused();
      expect((await savedWorkspace(page)).assets[0].crop).toBeUndefined();
      await openCrop();
      await expect(cropDialog.locator("#crop-zoom")).toHaveValue("1");
      await cropDialog.locator("#crop-zoom").fill("2");
      const bounds = await cropDialog.locator(".crop-window").boundingBox();
      const y = bounds.y + bounds.height / 2;
      for (let pan = 0; pan < 4; pan++) {
        await page.mouse.move(bounds.x + bounds.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(8, y, { steps: 12 });
        await page.mouse.up();
      }
      await cropDialog
        .getByRole("button", { name: "Apply crop", exact: true })
        .click();
      await expect(cropDialog).toHaveCount(0);
      const cropped = await savedWorkspace(page);
      const crop = cropped.assets[0].crop;
      expect(crop.x).toBeGreaterThan(0.6);
      expect(cropped.grid).toEqual(before.grid);
      await reloadWorkspace(page);
      expect((await savedWorkspace(page)).assets[0].crop).toEqual(crop);
      expect(await centerPixel(thumbnail)).toEqual([0, 0, 255, 255]);
      expect(
        await centerPixel(page.locator(".cell-image-button").first()),
      ).toEqual([0, 255, 0, 255]);
      await openCrop();
      await expect
        .poll(async () =>
          Number(await cropDialog.locator("#crop-zoom").inputValue()),
        )
        .toBeCloseTo(2, 1);
      await cropDialog
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(cropDialog).toHaveCount(0);
      if (mode === "desktop") {
        await thumbnail.dragTo(page.locator(".cell-image-button").nth(1));
      } else {
        await chooseImage(page, "Library crop", 1);
      }
      expect((await savedWorkspace(page)).grid.cells[1].crop).toEqual(crop);
      await expect
        .poll(() => centerPixel(page.locator(".cell-image-button").nth(1)))
        .toEqual([0, 0, 255, 255]);
      await page.locator(".cell-image-button").nth(2).click();
      const picker = page.getByRole("dialog", {
        name: "Choose image",
        exact: true,
      });
      const pickerCard = picker.locator(".asset").first();
      if (mode === "desktop")
        await pickerCard.locator("[data-library-thumbnail]").hover();
      await pickerCard
        .getByRole("button", { name: "Crop image", exact: true })
        .click();
      await expect(
        cropDialog.getByRole("button", { name: "Apply crop", exact: true }),
      ).toBeEnabled();
      await cropDialog.locator("#crop-zoom").fill("3");
      await cropDialog
        .getByRole("button", { name: "Apply crop", exact: true })
        .click();
      await expect(cropDialog).toHaveCount(0);
      await expect(picker).toBeVisible();
      const changed = await savedWorkspace(page);
      expect(changed.assets[0].crop.width).toBeLessThan(crop.width);
      expect(changed.grid.cells[0].crop).toBeUndefined();
      expect(changed.grid.cells[1].crop).toEqual(crop);
      expect(changed.grid.cells[2].assetId).toBeNull();
      await pickerCard.locator("[data-library-thumbnail]").click();
      await expect(picker).toHaveCount(0);
      expect((await savedWorkspace(page)).grid.cells[2].crop).toEqual(
        changed.assets[0].crop,
      );
      expect(
        await page.evaluate(async () => {
          const request = indexedDB.open("grids-client-v1");
          const db = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            const record = db
              .transaction("images", "readonly")
              .objectStore("images")
              .getAll();
            const images = await new Promise((resolve, reject) => {
              record.onsuccess = () => resolve(record.result);
              record.onerror = () => reject(record.error);
            });
            return [...new Uint8Array(await images[0].blob.arrayBuffer())];
          } finally {
            db.close();
          }
        }),
      ).toEqual([...original]);
    },
  );
}

test("fullscreen visual cropping preserves originals and matches preview and export", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  test.setTimeout(60000);
  await page.goto("./");
  await selectField(page, "image-shape", "square");
  const original = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="200" height="200" fill="#ff0000"/><rect x="200" width="200" height="200" fill="#00ff00"/><rect x="400" width="200" height="200" fill="#0000ff"/></svg>',
  );
  await page.locator("#upload").setInputFiles({
    name: "wide.svg",
    mimeType: "image/svg+xml",
    buffer: original,
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  const image = page.locator(".cell-image-button").first();
  await chooseImage(page, "wide");
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await page.locator(".cell-heading").first().fill("Keep this caption");
  const identity = (await savedWorkspace(page)).grid.cells[0];
  async function sample(bytes, x = 0.5, y = 0.5) {
    return page.evaluate(
      async ({ bytes, x, y }) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        const color = [
          ...context.getImageData(
            Math.floor(bitmap.width * x),
            Math.floor(bitmap.height * y),
            1,
            1,
          ).data,
        ];
        bitmap.close();
        return color;
      },
      { bytes: [...bytes], x, y },
    );
  }
  await page.mouse.move(0, 0);
  expect(await sample(await image.screenshot())).toEqual([0, 255, 0, 255]);
  await expect(
    page.getByRole("button", { name: /^(Fit|Fill) image$/ }),
  ).toHaveCount(0);
  const dialog = page.getByRole("dialog", { name: "Crop image", exact: true });
  async function openCrop() {
    await image.hover();
    await page.getByRole("button", { name: "Crop image", exact: true }).click();
    await expect(dialog).toBeVisible();

    await expect(
      dialog.getByRole("button", { name: "Apply crop", exact: true }),
    ).toBeEnabled();
    const bounds = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds.x).toBeCloseTo(0, 0);
    expect(bounds.y).toBeCloseTo(0, 0);
    expect(bounds.width).toBeGreaterThan(viewport.width - 20);
    expect(bounds.height).toBeGreaterThan(viewport.height - 2);
    expect(
      await page.evaluate(() =>
        document.activeElement?.matches("input,textarea"),
      ),
    ).toBe(false);
  }
  await openCrop();
  const cropWindow = dialog.locator(".crop-window");
  const initialWindow = await cropWindow.boundingBox();
  expect(initialWindow.width / initialWindow.height).toBeCloseTo(1, 2);
  await dialog.getByRole("button", { name: "Toggle crop guides" }).click();
  await dialog.locator("#crop-zoom").fill("2");
  const preview = dialog.getByLabel("Crop preview", { exact: true });
  const windowBounds = await cropWindow.boundingBox();
  const centerY = windowBounds.y + windowBounds.height / 2;
  await page.mouse.move(windowBounds.x + windowBounds.width / 2, centerY);
  await page.mouse.down();
  await page.mouse.move(16, centerY, { steps: 12 });
  await page.mouse.up();
  await preview.press("ArrowRight");
  expect(await sample(await cropWindow.screenshot())).toEqual([0, 0, 255, 255]);
  await page.screenshot({
    path: testInfo.outputPath("crop-editor-desktop.png"),
  });
  await dialog.getByRole("button", { name: "Apply crop", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(image).toBeFocused();
  await expect
    .poll(
      async () => (await localDatabase(page)).document?.grid.cells[0].crop?.x,
    )
    .toBeGreaterThan(0.6);
  const saved = await savedWorkspace(page);
  const applied = saved.grid.cells[0].crop;
  expect(saved.grid.cells[0]).toMatchObject({
    id: identity.id,
    assetId: identity.assetId,
    title: "Keep this caption",
  });
  expect(await sample(await image.screenshot())).toEqual([0, 0, 255, 255]);
  const readOriginal = () =>
    page.evaluate(
      (assetId) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("grids-client-v1");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const database = request.result;
            const transaction = database.transaction("images", "readonly");
            const record = transaction.objectStore("images").get(assetId);
            record.onsuccess = async () =>
              resolve([
                ...new Uint8Array(await record.result.blob.arrayBuffer()),
              ]);
            record.onerror = () => reject(record.error);
            transaction.oncomplete = () => database.close();
          };
        }),
      identity.assetId,
    );
  expect(await readOriginal()).toEqual([...original]);
  await openCrop();
  await expect
    .poll(async () => Number(await dialog.locator("#crop-zoom").inputValue()))
    .toBeCloseTo(2, 1);
  expect(await sample(await cropWindow.screenshot())).toEqual([0, 0, 255, 255]);
  await dialog.locator("#crop-zoom").fill("3");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(image).toBeFocused();
  expect((await savedWorkspace(page)).grid.cells[0].crop).toEqual(applied);
  await reloadWorkspace(page);
  expect((await savedWorkspace(page)).grid.cells[0].crop).toEqual(applied);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Keep this caption",
  );
  expect(await sample(await image.screenshot())).toEqual([0, 0, 255, 255]);
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  const download = await downloadBoard(page);
  const exported = await readFile(await download.path());
  expect(await sample(exported, 78 / 462, 78 / 567)).toEqual([0, 0, 255, 255]);
  await chooseImage(page, "wide", 1);
  await expect(page.locator(".grid-cell img")).toHaveCount(2);
  await expect(page.locator(".cell-heading").nth(1)).toHaveValue("wide");
  await page.locator(".cell-heading").nth(1).fill("Second caption");
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Keep this caption",
  );
  await expect(page.locator(".library-heading").first()).toHaveValue("wide");
  const copies = (await savedWorkspace(page)).grid.cells.slice(0, 2);
  expect(copies[0].crop).toEqual(applied);
  expect(copies[1].crop).toBeUndefined();
  expect(
    await sample(await page.locator(".cell-image-button").nth(1).screenshot()),
  ).toEqual([0, 255, 0, 255]);
  await selectField(page, "image-shape", "landscape");
  await openCrop();
  await dialog.getByRole("button", { name: "Apply crop", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const landscapeCrop = (await savedWorkspace(page)).grid.cells[0].crop;
  expect(landscapeCrop.width).toBeCloseTo(applied.width, 6);
  expect(landscapeCrop.height).toBeCloseTo((applied.height * 3) / 4, 6);
  await selectField(page, "image-shape", "square");
  await openCrop();
  await dialog.getByRole("button", { name: "Reset crop" }).click();
  await expect(dialog.locator("#crop-zoom")).toHaveValue("1");
  expect(await sample(await cropWindow.screenshot())).toEqual([0, 255, 0, 255]);
  await dialog.getByRole("button", { name: "Apply crop", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await sample(await image.screenshot())).toEqual([0, 255, 0, 255]);
  expect(await readOriginal()).toEqual([...original]);
  expect(
    JSON.stringify(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("grids-settings-v1")),
      ),
    ),
  ).not.toContain('"crop"');
});

test("imported captions preserve library capitalization in the canvas and export", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles({
    name: "  DC -  Color__Kid  .svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  const title = await page.locator(".asset-name").first().inputValue();
  expect(title).toBe("DC Color Kid");
  await page
    .locator(".asset")
    .first()
    .locator("[data-library-thumbnail]")
    .dragTo(page.locator(".cell-image-button").first());
  await expect(page.locator(".cell-heading").first()).toHaveValue(title);
  await expect(page.locator(".cell-heading").first()).toHaveCSS(
    "text-transform",
    "none",
  );
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    window.exportedCaptionText = [];
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      ...parameters
    ) {
      window.exportedCaptionText.push(text);
      return original.call(this, text, ...parameters);
    };
  });
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  await downloadBoard(page);
  const rendered = await page.evaluate(() => window.exportedCaptionText);
  expect(rendered.join(" ")).toContain(title);
  expect(rendered.join(" ")).not.toContain(title.toUpperCase());
  await setEditorViewport(page, { width: 960, height: 1080 });
  await selectField(page, "caption-position", "above");
  await page.locator(".cell-heading").first().fill("DC   Friendly Fire");
  await expect
    .poll(() =>
      page
        .locator(".cell-heading")
        .first()
        .evaluate((field) => field.scrollHeight <= field.clientHeight),
    )
    .toBe(true);
  await page
    .locator(".grid-cell")
    .first()
    .screenshot({ path: testInfo.outputPath("padded-caption-narrow.png") });
});

test("legacy credited images are removed persistently without losing local images or settings", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles({
    name: "Keep.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
    ),
  });
  await expect(page.locator(".asset-name")).toHaveValue("Keep");
  const original = await savedWorkspace(page);
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("grids-client-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("documents", "readwrite");
          const documents = transaction.objectStore("documents");
          const get = documents.get("guest");
          get.onsuccess = () => {
            const document = get.result;
            const id = crypto.randomUUID();
            document.assets.push({
              id,
              title: "Legacy credit",
              category: "Imported",
              provenance: {
                provider: "openverse",
                entityId: crypto.randomUUID(),
                title: "Legacy credit",
                creator: "Photographer",
                sourcePage: "https://www.flickr.com/photos/example/123",
                originalUrl: "https://live.staticflickr.com/1/photo.jpg",
                license: "CC BY 4.0",
                licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
              },
            });
            document.grid.cells[0] = {
              ...document.grid.cells[0],
              assetId: id,
              title: "Legacy credit",
            };
            document.grid.cells[1] = {
              ...document.grid.cells[1],
              assetId: document.assets[0].id,
              title: "Keep caption",
              crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
            };
            document.grid.gap = 42;
            documents.put(document);
          };
          transaction.onerror = () => {
            db.close();
            reject(transaction.error);
          };
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
  );
  await page.reload();
  await expect(
    page.getByText(
      "Images requiring attribution were removed. Other images and settings were kept.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator(".grid-cell").nth(1).locator("img")).toBeVisible();
  const migrated = await savedWorkspace(page);
  expect(migrated.assets).toEqual(original.assets);
  expect(migrated.grid.cells[0]).toMatchObject({ assetId: null, title: "" });
  expect(migrated.grid.cells[1]).toMatchObject({
    assetId: original.assets[0].id,
    title: "Keep caption",
    crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
  });
  expect(migrated.grid.gap).toBe(42);
  expect((await localDatabase(page)).images).toHaveLength(1);
  await reloadWorkspace(page);
  expect((await savedWorkspace(page)).assets).toEqual(original.assets);
  await expect(page.locator("[data-image-credits]")).toHaveCount(0);
});

test("hovering images preserves caption focus and keyboard actions remain available", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles(
    ["Eye Boy", "Kite Man"].map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  for (const index of [0, 1])
    await page
      .locator("[data-library-thumbnail]")
      .nth(index)
      .dragTo(page.locator(".cell-image-button").nth(index));
  for (const [width, expanded] of [
    [960, false],
    [780, false],
    [780, true],
  ]) {
    await setEditorViewport(page, { width, height: 1080 });
    if (expanded) await openSidebarPanel(page, "Design");
    await selectField(page, "caption-position", "above");
    if (expanded) await closeSidebarPanel(page);
    for (const selector of width > 900
      ? [".grid-cell", ".asset"]
      : [".grid-cell"]) {
      const cards = page.locator(selector);
      const image = cards.nth(0).locator("[data-card-image] > button");
      const header = cards.nth(1).locator("textarea");
      await header.click();
      await image.hover();

      await expect(header).toBeFocused();
      await expect(image).not.toBeFocused();
      await header.hover();

      await expect(header).toBeFocused();
      await image.focus();
      await image.press("Enter");
      await expect(
        cards.nth(0).getByRole("group", { name: "Cell tools", exact: true }),
      ).toBeVisible();

      await image.press("Escape");
      await header.click();
    }
  }
});

test("empty cells hide captions and dropped replacements use the incoming image title", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles(
    ["First", "Second"].map((title) => ({
      name: `${title}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/></svg>',
      ),
    })),
  );
  const cell = page.locator(".grid-cell").first();
  const caption = cell.locator(".cell-heading");
  await expect(caption).toBeHidden();
  await expect(cell.locator("[data-caption-feedback]")).toBeHidden();
  await page
    .locator("[data-library-thumbnail]")
    .nth(0)
    .dragTo(cell.locator(".cell-image-button"));
  await expect(caption).toBeVisible();
  await expect(caption).toHaveValue("First");
  await caption.fill("Custom caption");
  await page
    .locator("[data-library-thumbnail]")
    .nth(1)
    .dragTo(cell.locator(".cell-image-button"));
  await expect(caption).toHaveValue("Second");
  await reloadWorkspace(page);
  await expect(caption).toBeVisible();
  await expect(caption).toHaveValue("Second");
  await cell.locator(".cell-image-button").hover();
  await cell.getByRole("button", { name: "Clear cell", exact: true }).click();
  await expect(caption).toBeHidden();
  await expect(cell.locator("[data-caption-feedback]")).toBeHidden();
  await reloadWorkspace(page);
  await expect(caption).toBeHidden();
  await page
    .locator("[data-library-thumbnail]")
    .nth(0)
    .dragTo(cell.locator(".cell-image-button"));
  await expect(caption).toBeVisible();
  await expect(caption).toHaveValue("First");
});

test("large-font overlays with one visible line have matching bands in preview and export", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles(
    ["Hi", "Long"].map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  for (const index of [0, 1])
    await page
      .locator("[data-library-thumbnail]")
      .nth(index)
      .dragTo(page.locator(".cell-image-button").nth(index));
  const captions = page.locator(".cell-heading");
  const multiline = "Line One\nLine Two\nLine Three";
  await captions.nth(1).fill(multiline);
  await openSidebarPanel(page, "Design");
  await selectField(page, "image-shape", "portrait");
  await selectField(page, "caption-position", "overlay-bottom");
  await openDesignControls(page, "cell-font-size");
  await page.locator("#cell-font-size").fill("100");
  await expect
    .poll(() =>
      captions.evaluateAll((fields) => {
        const [short, long] = fields;
        return (
          Math.abs(
            short.getBoundingClientRect().height -
              long.getBoundingClientRect().height,
          ) < 0.1 &&
          [short, long].every(
            (field) =>
              field.parentElement.style.getPropertyValue(
                "--library-caption-lines",
              ) === "1",
          )
        );
      }),
    )
    .toBe(true);
  await page.evaluate(() => {
    const fillRect = CanvasRenderingContext2D.prototype.fillRect;
    window.overlayBands = [];
    CanvasRenderingContext2D.prototype.fillRect = function (
      x,
      y,
      width,
      height,
    ) {
      if (this.globalAlpha > 0 && this.globalAlpha < 1)
        window.overlayBands.push({ width, height });
      return fillRect.call(this, x, y, width, height);
    };
  });
  for (const resolution of [150, 300]) {
    await page.evaluate(() => {
      window.overlayBands = [];
    });
    await page.locator("#export-grid-header").click();
    await selectField(page, "resolution", String(resolution));
    const download = await downloadBoard(page);
    const bytes = await readFile(await download.path());
    expect(bytes.readUInt32BE(16)).toBeGreaterThan(resolution);
    const bands = await page.evaluate(() => window.overlayBands);
    expect(bands).toHaveLength(2);
    expect(bands[0].width).toBe(resolution);
    expect(bands[0].height).toBe(bands[1].height);
  }
  await expect(captions.nth(1)).toHaveValue(multiline);
});

test("captions share external bands and fit individual overlays across canvas, library and export", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await openSidebarPanel(page, "Design");
  await page
    .locator("[data-theme-builder]")
    .getByRole("button", { name: /2 Layout/ })
    .click();
  await page.locator("#theme-step-1 [data-customize-toggle]").click();
  await page.locator("#gap").fill("10");
  await page.locator("#canvas-padding").fill("10");
  await selectField(page, "image-shape", "square");
  await page.locator("#upload").setInputFiles(
    ["Short", "Lines", "Word"].map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  await openSidebarPanel(page, "Images");
  const multiline =
    "Line One\nLine Two\nLine Three\nLine Four\nLine Five\nLine Six";
  await page.locator(".library-heading").nth(1).fill(multiline);
  await page
    .locator(".library-heading")
    .nth(2)
    .fill("LongUnbrokenWordWithoutSpaces");
  for (const index of [0, 1, 2])
    await page
      .locator("[data-library-thumbnail]")
      .nth(index)
      .dragTo(page.locator(".cell-image-button").nth(index));
  for (const width of [960]) {
    await setEditorViewport(page, { width, height: 1080 });
    for (const placement of ["above", "below"]) {
      await selectField(page, "caption-position", placement);
      await expect
        .poll(() =>
          page.locator(".image-card:has(textarea:visible)").evaluateAll(
            (cards) =>
              cards.length > 0 &&
              cards.every((card) => {
                const field = card.querySelector("textarea");
                const width = field.getBoundingClientRect().width;
                const fontSize = parseFloat(getComputedStyle(field).fontSize);
                return width > 0 && Math.abs(fontSize - width * 0.12) < 0.05;
              }),
          ),
        )
        .toBe(true);
      const metrics = await page
        .locator(".image-card:has(textarea:visible)")
        .evaluateAll((cards) =>
          cards.map((card) => {
            const field = card.querySelector("textarea");
            const bounds = card.getBoundingClientRect();
            const caption = field.getBoundingClientRect();
            return {
              library: card.classList.contains("asset"),
              width: caption.width,
              height: bounds.height,
              captionHeight: caption.height,
              fontSize: parseFloat(getComputedStyle(field).fontSize),
              scrollHeight: field.scrollHeight,
              clientHeight: field.clientHeight,
            };
          }),
        );
      for (const library of [false, true]) {
        const group = metrics.filter((item) => item.library === library);
        expect(group).toHaveLength(3);
        expect(
          Math.max(...group.map((item) => item.height)) -
            Math.min(...group.map((item) => item.height)),
        ).toBeLessThan(0.1);
        expect(
          Math.max(...group.map((item) => item.captionHeight)) -
            Math.min(...group.map((item) => item.captionHeight)),
        ).toBeLessThan(0.1);
        for (const item of group) {
          expect(item.fontSize).toBeCloseTo(item.width * 0.12, 1);
          expect(item.captionHeight).toBeGreaterThan(item.fontSize * 3 * 1.05);
        }
      }
      await expect(page.locator(".cell-heading").nth(1)).toHaveValue(multiline);
    }
    for (const shape of ["portrait", "landscape", "square"]) {
      await selectField(page, "image-shape", shape);
      for (const position of ["overlay-top", "overlay-bottom"]) {
        await selectField(page, "caption-position", position);
        const captions = page.locator(".cell-heading");
        await expect
          .poll(() =>
            page
              .locator(".grid-cell [data-caption-preview] span")
              .nth(1)
              .evaluate((text) => {
                const style = getComputedStyle(text);
                return (
                  Number(style.webkitLineClamp) <= 3 &&
                  text.getBoundingClientRect().height <=
                    parseFloat(style.lineHeight) * 3 +
                      parseFloat(style.paddingTop) +
                      parseFloat(style.paddingBottom) +
                      0.1
                );
              }),
          )
          .toBe(true);
        const short = await captions.first().boundingBox();
        const long = await captions.nth(1).boundingBox();
        if (shape === "landscape")
          expect(Math.abs(short.height - long.height)).toBeLessThan(0.1);
        else expect(short.height).toBeLessThan(long.height);
        const card = await page.locator(".grid-cell").nth(1).boundingBox();
        expect(card.height - long.height).toBeGreaterThanOrEqual(
          card.width * 0.5 - 1,
        );
        if (shape === "landscape") {
          const font = await captions
            .nth(1)
            .evaluate((field) => parseFloat(getComputedStyle(field).fontSize));
          expect(font).toBeCloseTo(long.width * 0.12, 1);
        }
      }
    }
    await selectField(page, "image-shape", "square");
    await selectField(page, "caption-position", "above");
    await page.screenshot({
      path: testInfo.outputPath(`multiline-cards-${width}.png`),
    });
  }
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    window.captionDrawing = [];
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      ...parameters
    ) {
      window.captionDrawing.push({ text, font: this.font });
      return original.call(this, text, ...parameters);
    };
  });
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  const download = await downloadBoard(page);
  const bytes = await readFile(await download.path());
  const dimensions = await page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const result = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return result;
    },
    [...bytes],
  );
  expect(dimensions).toEqual({ width: 462, height: 536 });
  const drawing = await page.evaluate(() => window.captionDrawing);
  for (const line of multiline.split("\n").slice(0, 2))
    expect(
      drawing.some(
        (entry) =>
          entry.text === line &&
          Number(entry.font.match(/([\d.]+)px/)[1]) === 18,
      ),
    ).toBe(true);
  expect(drawing.some((entry) => entry.text === "Line Three\u2026")).toBe(true);
  expect(drawing.some((entry) => entry.text === "Line Six")).toBe(false);
  expect(
    drawing.some(
      (entry) =>
        entry.text === "Short" &&
        Number(entry.font.match(/([\d.]+)px/)[1]) === 18,
    ),
  ).toBe(true);
  await selectField(page, "image-shape", "landscape");
  for (const position of ["overlay-top", "overlay-bottom"]) {
    await selectField(page, "caption-position", position);
    const expectedFont = await page
      .locator(".cell-heading")
      .nth(1)
      .evaluate(
        (field) =>
          (parseFloat(getComputedStyle(field).fontSize) /
            field.getBoundingClientRect().width) *
          150,
      );
    await page.evaluate(() => {
      window.captionDrawing = [];
    });
    await downloadBoard(page);
    const overlayDrawing = await page.evaluate(() => window.captionDrawing);
    const entry = overlayDrawing.find(
      (entry) => entry.text === "Line One\u2026",
    );
    expect(entry).toBeTruthy();
    expect(
      Math.abs(Number(entry.font.match(/([\d.]+)px/)[1]) - expectedFont),
    ).toBeLessThan(0.1);
    expect(overlayDrawing.some((entry) => entry.text === "Line Six")).toBe(
      false,
    );
    expect(
      overlayDrawing.some(
        (entry) =>
          entry.text === "Short" &&
          Number(entry.font.match(/([\d.]+)px/)[1]) === 18,
      ),
    ).toBe(true);
  }
});

test("small library caption clicks retain caret focus after image hover", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles(
    ["One", "Two"].map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  for (const width of [960, 1440]) {
    await setEditorViewport(page, { width, height: 1080 });
    await selectField(page, "image-shape", "landscape");
    for (const placement of [
      "above",
      "below",
      "overlay-top",
      "overlay-bottom",
    ]) {
      await selectField(page, "caption-position", placement);
      await page.locator(".library-heading").nth(0).fill("One");
      await page.locator(".library-heading").nth(1).fill("Two");
      for (const index of [0, 1, 0, 1]) {
        const asset = page.locator(".asset").nth(index);
        const image = asset.locator("[data-library-thumbnail]");
        const caption = asset.locator(".library-heading");
        await expect(image).toBeInViewport({ ratio: 1 });
        await expect(caption).toBeInViewport({ ratio: 1 });

        const captionBounds = await caption.boundingBox();
        await image.hover();
        await expect(caption).not.toBeFocused();
        const previous = await caption.inputValue();
        await caption.click({
          position: { x: 5, y: captionBounds.height / 2 },
        });
        await page.keyboard.press("Control+End");
        await page.keyboard.insertText("x");
        await expect(caption).toHaveValue(`${previous}x`);
        await expect(caption).toBeFocused();
        expect(await caption.evaluate((field) => field.selectionStart)).toBe(
          previous.length + 1,
        );
      }
    }
  }
});

for (const viewportWidth of [1440, 780]) {
  test(`canvas dragging moves into empty cells and swaps occupied cells with crops at ${viewportWidth}px`, async ({
    page,
  }) => {
    await setEditorViewport(page, { width: 1440, height: 1080 });
    await page.goto("./");
    await page.locator("#upload").setInputFiles([
      {
        name: "first.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#ff0000"/></svg>',
        ),
      },
      {
        name: "second.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#0000ff"/></svg>',
        ),
      },
    ]);
    await expect(page.locator(".asset")).toHaveCount(2);
    const images = page.locator(".cell-image-button");
    const headings = page.locator(".cell-heading");
    await selectField(page, "image-shape", "portrait");
    await selectField(page, "caption-position", "overlay-bottom");
    await page
      .locator(".asset")
      .nth(0)
      .dragTo(images.nth(0), { sourcePosition: { x: 5, y: 50 } });
    await page
      .locator(".asset")
      .nth(1)
      .dragTo(images.nth(1), { sourcePosition: { x: 5, y: 50 } });
    await headings.nth(0).fill("First item");
    await headings.nth(1).fill("Second item");
    await setEditorViewport(page, { width: viewportWidth, height: 1080 });
    await images.nth(0).hover();
    await page.getByRole("button", { name: "Crop image", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Crop image",
      exact: true,
    });
    await expect(
      dialog.getByRole("button", { name: "Apply crop", exact: true }),
    ).toBeEnabled();
    await dialog.locator("#crop-zoom").fill("4");
    await dialog
      .getByRole("button", { name: "Apply crop", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const before = await savedWorkspace(page);
    expect(before.grid.cells[0].crop).toBeDefined();

    const picture = await images.nth(0).boundingBox();
    const headingBounds = await page
      .locator(".cell-heading")
      .first()
      .boundingBox();
    const bottomY = Math.floor(headingBounds.y - picture.y - 5);
    const bottomX = picture.width / 2;
    await images.nth(0).hover({ position: { x: bottomX, y: bottomY } });
    expect(
      await images.nth(0).evaluate(
        (button, { x, y }) => {
          const bounds = button.getBoundingClientRect();
          return (
            document.elementFromPoint(bounds.x + x, bounds.y + y) === button
          );
        },
        { x: bottomX, y: bottomY },
      ),
    ).toBe(true);

    const source = await images.nth(0).locator("img").boundingBox();
    expect(source.width).toBeGreaterThan(picture.width * 3);
    expect(
      await images.nth(0).evaluate((button) => {
        const bounds = button.getBoundingClientRect();
        return [8, bounds.width - 8].every(
          (x) =>
            document.elementFromPoint(
              bounds.x + x,
              bounds.y + bounds.height / 2,
            ) === button,
        );
      }),
    ).toBe(true);
    await page.evaluate(() => {
      const original = DataTransfer.prototype.setDragImage;
      window.canvasDragPreviews = [];
      DataTransfer.prototype.setDragImage = function (element, x, y) {
        window.canvasDragPreviews.push({
          tag: element.tagName,
          width: element.width,
          height: element.height,
          x,
          y,
          color: [
            ...element
              .getContext("2d")
              .getImageData(
                Math.floor(element.width / 2),
                Math.floor(element.height / 2),
                1,
                1,
              ).data,
          ],
        });
        return original.call(this, element, x, y);
      };
    });
    await images.nth(0).dragTo(images.nth(2), {
      sourcePosition: { x: bottomX, y: bottomY },
    });
    await expect(page.locator(".grid-cell").nth(0).locator("img")).toHaveCount(
      0,
    );
    await expect(headings.nth(0)).toHaveValue("");
    await expect(headings.nth(2)).toHaveValue("First item");

    await expect(
      page
        .locator(".grid-cell")
        .nth(0)
        .getByRole("group", { name: "Cell tools" }),
    ).toHaveCount(0);
    const previews = await page.evaluate(() => window.canvasDragPreviews);
    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({
      tag: "CANVAS",
      width: 1,
      height: 1,
      color: [0, 0, 0, 0],
    });
    expect(previews[0].x).toBe(0);
    expect(previews[0].y).toBe(0);
    await expect(page.locator("body > canvas")).toHaveCount(0);
    let current = await savedWorkspace(page);
    expect(current.grid.cells[2]).toEqual({
      ...before.grid.cells[0],
      id: before.grid.cells[2].id,
    });
    await images.nth(2).dragTo(images.nth(1));
    await expect(headings.nth(1)).toHaveValue("First item");
    await expect(headings.nth(2)).toHaveValue("Second item");

    await expect(
      page
        .locator(".grid-cell")
        .nth(2)
        .getByRole("group", { name: "Cell tools" }),
    ).toHaveCount(0);
    await expect(page.locator("body > canvas")).toHaveCount(0);
    current = await savedWorkspace(page);
    expect(current.grid.cells[1]).toEqual({
      ...before.grid.cells[0],
      id: before.grid.cells[1].id,
    });
    expect(current.grid.cells[2]).toEqual({
      ...before.grid.cells[1],
      id: before.grid.cells[2].id,
    });
    expect(current.assets).toEqual(before.assets);
    await reloadWorkspace(page);
    await expect(headings.nth(1)).toHaveValue("First item");
    await expect(headings.nth(2)).toHaveValue("Second item");
    expect((await savedWorkspace(page)).grid.cells).toEqual(current.grid.cells);
  });
}

test("touch crop editor fills the viewport and keeps portrait controls usable", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("./");
  await selectField(page, "image-shape", "portrait");
  const image = page.locator(".cell-image-button").first();
  await image.tap({ position: { x: 5, y: 5 } });
  await page
    .getByRole("dialog", { name: "Choose image", exact: true })
    .locator("#picker-cell-upload")
    .setInputFiles({
      name: "touch crop.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="200" height="200" fill="#ff0000"/><rect x="200" width="200" height="200" fill="#00ff00"/><rect x="400" width="200" height="200" fill="#0000ff"/></svg>',
      ),
    });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await image.tap();
  await page.getByRole("button", { name: "Crop image", exact: true }).tap();
  const dialog = page.getByRole("dialog", { name: "Crop image", exact: true });

  await expect(
    dialog.getByRole("button", { name: "Apply crop", exact: true }),
  ).toBeEnabled();
  const bounds = await dialog.boundingBox();
  expect(bounds).toMatchObject({ x: 0, y: 0, height: 844 });
  expect(bounds.width).toBeGreaterThanOrEqual(370);
  const cropWindow = dialog.locator(".crop-window");
  const cropBounds = await cropWindow.boundingBox();
  expect(cropBounds.width / cropBounds.height).toBeCloseTo(3 / 4, 2);
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input,textarea"),
    ),
  ).toBe(false);
  for (const name of [
    "Toggle crop guides",
    "Reset crop",
    "Cancel",
    "Apply crop",
  ]) {
    const button = dialog.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const rectangle = await button.boundingBox();
    expect(rectangle.height).toBeGreaterThanOrEqual(44);
    expect(rectangle.width).toBeGreaterThanOrEqual(44);
    expect(rectangle.x).toBeGreaterThanOrEqual(0);
    expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(390);
    expect(rectangle.y + rectangle.height).toBeLessThanOrEqual(844);
  }
  await dialog.getByRole("button", { name: "Toggle crop guides" }).tap();
  await dialog.locator("#crop-zoom").fill("2");
  const session = await context.newCDPSession(page);
  const y = cropBounds.y + cropBounds.height / 2;
  const x = cropBounds.x + cropBounds.width / 2;
  const before = await dialog
    .locator("img")
    .evaluate((element) => element.style.transform);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let step = 1; step <= 12; step++)
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + ((4 - x) * step) / 12, y }],
    });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() =>
      dialog.locator("img").evaluate((element) => element.style.transform),
    )
    .not.toBe(before);
  await page.screenshot({
    path: testInfo.outputPath("crop-editor-mobile.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Apply crop", exact: true }).tap();
  await expect(dialog).toHaveCount(0);
  await expect(image).toBeFocused();
  await expect
    .poll(
      async () => (await localDatabase(page)).document?.grid.cells[0].crop?.x,
    )
    .toBeGreaterThan(0.6);
  await image.tap();
  await page.getByRole("button", { name: "Crop image", exact: true }).tap();
  await expect(dialog.locator("#crop-zoom")).toHaveValue("2");
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).tap();
  await expect(dialog).toHaveCount(0);
  await expect(image).toBeFocused();
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input,textarea"),
    ),
  ).toBe(false);
  await session.detach();
  await context.close();
});

test("resizing across large and narrow screens preserves removed images and captions", async ({
  page,
}, testInfo) => {
  await setEditorViewport(page, { width: 3840, height: 2160 });
  await page.goto("./");
  for (const dimension of ["row", "column"]) {
    for (let count = 0; count < 2; count++)
      await page
        .getByRole("button", { name: `Remove ${dimension}`, exact: true })
        .click();
  }
  await expect(page.locator(".grid-cell")).toHaveCount(1);
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(page.locator(".grid-cell")).toHaveCount(2);
  await page.locator("#upload").setInputFiles({
    name: "Removed.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/></svg>',
    ),
  });
  await page
    .locator("[data-library-thumbnail]")
    .first()
    .dragTo(page.locator(".cell-image-button").nth(1));
  await setEditorViewport(page, { width: 260, height: 844 });
  await expect
    .poll(() =>
      page
        .locator("[data-canvas-viewport]")
        .evaluate((viewport) => viewport.scrollWidth > viewport.clientWidth),
    )
    .toBe(false);
  await page.getByRole("slider", { name: "Zoom", exact: true }).fill("150");
  await expect
    .poll(() =>
      page
        .locator("[data-canvas-viewport]")
        .evaluate((viewport) => viewport.scrollWidth > viewport.clientWidth),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator(".cell-heading").nth(1).fill("Removed caption");
  await page
    .getByRole("button", { name: "Remove column", exact: true })
    .click();
  await expect(page.locator(".grid-cell")).toHaveCount(1);
  expect(
    (await savedWorkspace(page)).grid.overflow.some(
      (entry) => entry.cell.title === "Removed caption",
    ),
  ).toBe(false);
  await expect(
    page.getByRole("region", { name: "Removed cells", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Restore cell:/ }),
  ).toHaveCount(0);
  await reloadWorkspace(page);
  await expect(
    page.getByRole("region", { name: "Removed cells", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Restore cell:/ }),
  ).toHaveCount(0);
});

test("failures show readable, dismissible notifications without success noise", async ({
  page,
}, testInfo) => {
  await setEditorViewport(page, { width: 1440, height: 1000 });
  await page.goto("./");
  await openSidebarPanel(page, "Design");
  const notices = page.locator("[data-sonner-toast]");
  await expect(notices).toHaveCount(0);
  await resetEverything(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(notices).toHaveCount(0);
  await openSidebarPanel(page, "Images");
  await downloadBoard(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(notices).toHaveCount(0);
  for (const width of [1440, 390]) {
    await setEditorViewport(page, { width, height: 1000 });
    const uploadInput =
      width > 900 ? page.locator("#upload") : await beginCellUpload(page, 0);
    await expect
      .poll(() =>
        uploadInput.evaluate(async (element) => {
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          return element.isConnected;
        }),
      )
      .toBe(true);
    const names = ["first", "second", "third"].map(
      (name) => `${name}-${width}`,
    );
    const files = names.map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from("not an image"),
    }));
    if ((await uploadInput.getAttribute("multiple")) !== null)
      await uploadInput.setInputFiles(files);
    else for (const file of files) await uploadInput.setInputFiles(file);
    await expect(notices).toHaveCount(3);
    for (const name of names)
      await expect(
        notices.filter({ hasText: `Could not load ${name}.svg` }),
      ).toHaveCount(1);

    await expect
      .poll(async () =>
        notices.evaluateAll((elements) => {
          const bounds = elements
            .map((element) => element.getBoundingClientRect())
            .sort((first, second) => first.top - second.top);
          return bounds.every(
            (rect, index) =>
              rect.left >= 0 &&
              rect.right <= innerWidth &&
              rect.top >= 0 &&
              rect.bottom <= innerHeight &&
              (index === 0 || rect.top >= bounds[index - 1].bottom),
          );
        }),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`error-notifications-${width}.png`),
    });
    for (const name of names)
      await notices
        .filter({ hasText: `Could not load ${name}.svg` })
        .getByRole("button", { name: "Close toast", exact: true })
        .click();
    await expect(notices).toHaveCount(0);
  }
});

test("independent spacing and canvas backgrounds match preview and export", async ({
  page,
}, testInfo) => {
  await setEditorViewport(page, { width: 1440, height: 1000 });
  await page.goto("./");
  await openSidebarPanel(page, "Design");
  await openDesignControls(page, "corner-rounding");
  await page.locator("#corner-rounding").fill("0");
  await openDesignControls(page, "heading-font-size");
  await page.locator("#heading-font-size").fill("40");
  await openDesignControls(page, "heading-padding");
  await page.locator("#heading-padding").fill("0");
  await openDesignControls(page, "cell-font-size");
  await page.locator("#cell-font-size").fill("17");
  const canvasStyle = page.getByRole("group", {
    name: "Canvas style",
    exact: true,
  });
  await expect(
    page.getByRole("group", { name: "Grid style", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#theme-selector")).toHaveCount(0);
  await openDesignControls(page, "gap");
  await expect(
    canvasStyle.getByRole("slider", { name: "Gap", exact: true }),
  ).toHaveCount(1);
  await expect(page.locator("#heading-gap")).toHaveCount(0);
  await openDesignControls(page, "background-value");
  await expect(page.locator("#background-value")).toHaveValue(/^#17191b$/i);
  await expect(page.locator("[data-image-canvas-background]")).toHaveCSS(
    "background-color",
    "rgb(23, 25, 27)",
  );
  await expect(page.locator("#board-grid")).toHaveCSS(
    "background-color",
    "rgb(23, 25, 27)",
  );

  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  const initialDownload = await downloadBoard(page);
  const initialBytes = await readFile(await initialDownload.path());
  const initialBackground = await page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const color = [...context.getImageData(0, 0, 1, 1).data];
      bitmap.close();
      return color;
    },
    [...initialBytes],
  );
  expect(initialBackground).toEqual([23, 25, 27, 255]);
  await uploadCellImage(page);
  await selectField(page, "image-shape", "square");
  await selectField(page, "caption-position", "below");
  await page.locator(".cell-heading").first().fill("Blue");
  await page.getByRole("button", { name: /^Edit grid heading: / }).click();
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .fill("Title");
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .press("Enter");
  async function ratios() {
    return page.evaluate(() => {
      const grid = document.querySelector("#board-grid");
      const style = getComputedStyle(grid);
      const cell = grid.firstElementChild.getBoundingClientRect();
      const viewport = document
        .querySelector("[data-canvas-viewport]")
        .getBoundingClientRect();
      const heading = document
        .querySelector(".board-export-heading")
        .getBoundingClientRect();
      return {
        gap: Math.round((parseFloat(style.columnGap) / cell.width) * 1000) / 10,
        padding:
          Math.round((parseFloat(style.paddingLeft) / cell.width) * 1000) / 10,
        heading:
          Math.round(
            ((grid.getBoundingClientRect().top - heading.bottom) / cell.width) *
              1000,
          ) / 10,
      };
    });
  }
  async function checkCanvasPadding() {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const canvas = document
            .querySelector("[data-image-canvas-background]")
            .getBoundingClientRect();
          const grid = document.querySelector("#board-grid");
          const heading = document
            .querySelector(".board-export-heading")
            .getBoundingClientRect();
          const first = grid.firstElementChild.getBoundingClientRect();
          const last = grid.lastElementChild.getBoundingClientRect();
          const viewport = document.querySelector("[data-canvas-viewport]");
          const padding = parseFloat(getComputedStyle(grid).paddingLeft);
          return Math.max(
            Math.abs(heading.top - canvas.top - padding),
            Math.abs(heading.left - canvas.left - padding),
            Math.abs(canvas.right - heading.right - padding),
            Math.abs(first.left - canvas.left - padding),
            Math.abs(canvas.right - last.right - padding),
            Math.abs(canvas.bottom - last.bottom - padding),
            Math.abs(
              canvas.width -
                (viewport.clientWidth -
                  2 * parseFloat(getComputedStyle(viewport).paddingLeft)),
            ),
          );
        }),
      )
      .toBeLessThan(1);
  }
  const expected = { gap: 4, padding: 6, heading: 4 };
  await expect.poll(ratios).toEqual(expected);
  await checkCanvasPadding();
  for (const [id, key, value] of [
    ["canvas-padding", "padding", 5],
    ["gap", "gap", 10],
  ]) {
    await openDesignControls(page, id);
    await page.locator(`#${id}`).fill(String(value * 5));
    expected[key] = value;
    if (id === "gap") expected.heading = value;
    await expect.poll(ratios).toEqual(expected);
    await expect(page.locator(`#${id}-value`)).toHaveText(`${value * 5}%`);
    await checkCanvasPadding();
  }
  await openDesignControls(page, "background-value");
  await page.locator("#background-value").fill("#d9e7f0");
  await openDesignControls(page, "canvas-padding");
  await page.locator("#canvas-padding").fill("20");
  expected.padding = 4;
  await expect(page.locator("#canvas-padding-value")).toHaveText("20%");
  await checkCanvasPadding();
  await expect
    .poll(() =>
      page.locator("#board-grid").evaluate((grid) => {
        const cell = grid.firstElementChild.getBoundingClientRect();
        return (
          (parseFloat(getComputedStyle(grid).paddingLeft) / cell.width) * 100
        );
      }),
    )
    .toBeCloseTo(4, 1);
  await openDesignControls(page, "heading-background-color-value");
  await page.locator("#heading-background-color-value").fill("#114455");
  await openDesignControls(page, "cell-background-color-value");
  await page.locator("#cell-background-color-value").fill("#335577");
  const cardStyle = page.getByRole("group", {
    name: "Card style",
    exact: true,
  });
  await openDesignControls(page, "caption-overlay-value");
  await expect(cardStyle.locator("#caption-overlay-value")).toBeVisible();
  await expect(cardStyle.locator("#caption-opacity")).toBeEnabled();
  await cardStyle.locator("#caption-overlay-value").fill("#7700bb");
  await cardStyle.locator("#caption-opacity").fill("35");
  await page.mouse.move(0, 0);

  await expect(page.locator("[data-image-canvas-background]")).toHaveCSS(
    "background-color",
    "rgb(217, 231, 240)",
  );
  await expect(page.locator("#board-grid")).toHaveCSS(
    "background-color",
    "rgb(217, 231, 240)",
  );

  await expect(page.locator(".board-export-heading")).toHaveCSS(
    "background-color",
    "rgb(17, 68, 85)",
  );
  await expect(page.locator(".grid-cell").first()).toHaveCSS(
    "background-color",
    "rgb(51, 85, 119)",
  );
  await expect(page.locator(".cell-heading").first()).toHaveCSS(
    "background-color",
    "rgb(51, 85, 119)",
  );
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const download = await downloadBoard(page);
  const bytes = await readFile(await download.path());
  const pixels = await page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const sample = (left, top) => [
        ...context.getImageData(left, top, 1, 1).data,
      ];
      const result = {
        width: bitmap.width,
        height: bitmap.height,
        heading: sample(11, 11),
        card: sample(11, 63),
        caption: sample(11, 213),
        padding: sample(1, 53),
        gap: sample(161, 63),
        edges: [
          sample(11, 5),
          sample(5, 11),
          sample(bitmap.width - 6, 11),
          sample(11, bitmap.height - 6),
        ],
      };
      bitmap.close();
      return result;
    },
    [...bytes],
  );
  expect(pixels).toEqual({
    width: 492,
    height: 584,
    heading: [17, 68, 85, 255],
    card: [51, 85, 119, 255],
    caption: [51, 85, 119, 255],
    padding: [217, 231, 240, 255],
    gap: [217, 231, 240, 255],
    edges: Array.from({ length: 4 }, () => [217, 231, 240, 255]),
  });
  await openDesignControls(page, "canvas-padding");
  await page.locator("#canvas-padding").fill("40");
  expected.padding = 8;
  await expect(page.locator("#canvas-padding-value")).toHaveText("40%");
  await checkCanvasPadding();

  await expect
    .poll(() =>
      page.locator("#board-grid").evaluate((grid) => {
        const cell = grid.firstElementChild.getBoundingClientRect();
        return (
          (parseFloat(getComputedStyle(grid).paddingLeft) / cell.width) * 100
        );
      }),
    )
    .toBeCloseTo(8, 1);
  const padded = await downloadBoard(page);
  const paddedBytes = await readFile(await padded.path());
  expect(paddedBytes).not.toEqual(bytes);
  expect(
    await page.evaluate(
      async (bytes) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return size;
      },
      [...paddedBytes],
    ),
  ).toEqual({ width: 504, height: 596 });
  await reloadWorkspace(page);
  expect((await savedWorkspace(page)).grid).toMatchObject({
    gap: 60,
    canvasPadding: 48,
    background: "#d9e7f0",
    headingBackgroundColor: "#114455",
    cellBackgroundColor: "#335577",
    captionOverlayColor: "#7700bb",
    captionOverlayOpacity: 35,
  });
  await openDesignControls(page, "background-value");
  await expect(page.locator("#background-value")).toHaveValue(/^#d9e7f0$/i);
  await expect(page.locator("[data-image-canvas-background]")).toHaveCSS(
    "background-color",
    "rgb(217, 231, 240)",
  );

  await expect.poll(ratios).toEqual(expected);
  await page
    .getByRole("region", { name: "Grid editor", exact: true })
    .screenshot({
      path: testInfo.outputPath("image-canvas-background-desktop.png"),
    });
  await openDesignControls(page, "canvas-padding");
  await page
    .getByRole("group", { name: "Canvas style", exact: true })
    .screenshot({ path: testInfo.outputPath("canvas-style-desktop.png") });
  await openDesignControls(page, "caption-opacity");
  await cardStyle.screenshot({
    path: testInfo.outputPath("card-style-desktop.png"),
  });
  await setEditorViewport(page, { width: 390, height: 844 });
  await expect.poll(ratios).toEqual(expected);
  await openSidebarPanel(page, "Design");
  await openDesignControls(page, "canvas-padding");
  await expect(page.locator("#canvas-padding")).toHaveValue("40");
  await expect
    .poll(() =>
      page.locator("[data-canvas-viewport]").evaluate((viewport) => {
        const cell = viewport
          .querySelector(".grid-cell")
          .getBoundingClientRect();
        const bounds = viewport.getBoundingClientRect();
        return (
          viewport.clientHeight > 128 &&
          cell.top < bounds.bottom &&
          cell.bottom > bounds.top &&
          cell.left < bounds.right
        );
      }),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await openDesignControls(page, "caption-opacity");
  await expect(cardStyle.locator("#caption-overlay-value")).toBeVisible();
  await expect(cardStyle.locator("#caption-opacity")).toBeEnabled();
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input,textarea"),
    ),
  ).toBe(false);
  await cardStyle.locator("#caption-overlay-value").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("canvas-card-style-mobile.png"),
  });
});

test("appearance settings preserve content and match exported ratios and captions", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await page.goto("./");
  await openSidebarPanel(page, "Design");
  await openDesignControls(page, "gap");
  await page.locator("#gap").fill("10");
  await openDesignControls(page, "canvas-padding");
  await page.locator("#canvas-padding").fill("10");
  await expect(page.locator('#image-shape [aria-checked="true"]')).toHaveText(
    "Portrait",
  );
  await openDesignSection(page, "Card headings");
  await expect(
    page.locator('#caption-position [aria-checked="true"]'),
  ).toHaveText("Overlay bottom");
  await expect(
    page.locator("#caption-position").getByRole("radio"),
  ).toHaveCount(4);
  await expect(
    page
      .locator("#caption-position")
      .getByRole("radio", { name: /middle|center/i }),
  ).toHaveCount(0);
  await openDesignSection(page, "Layout");
  await page
    .locator("#image-shape")
    .getByRole("radio", { name: "Landscape", exact: true })
    .press("Enter");
  await expect(page.locator('#image-shape [aria-checked="true"]')).toHaveText(
    "Landscape",
  );
  await selectField(page, "image-shape", "portrait");
  await page.locator("#upload").setInputFiles({
    name: "solid.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#4064c8"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  const image = page.locator(".cell-image-button").first();
  const caption = page.locator(".cell-heading").first();
  await openSidebarPanel(page, "Images");
  await page.locator(".asset").dragTo(image);
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await openSidebarPanel(page, "Design");
  await image.hover();
  await caption.fill("Blue");
  const identity = (await savedWorkspace(page)).grid.cells[0];
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  async function pixels(imageHeight, placement, alignment = "bottom") {
    const captionHeight = 36;
    const captionTop =
      placement === "above"
        ? 0
        : placement === "below"
          ? imageHeight
          : alignment === "top"
            ? 0
            : alignment === "middle"
              ? Math.round((imageHeight - captionHeight) / 2)
              : imageHeight - captionHeight;
    const imageTop = placement === "above" ? captionHeight : 0;
    const download = await downloadBoard(page);
    const bytes = await readFile(await download.path());
    const result = await page.evaluate(
      async ({ bytes, captionTop, imageTop, imageHeight, alignment }) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        const color = (y) => [...context.getImageData(13, y, 1, 1).data];
        const result = {
          width: bitmap.width,
          height: bitmap.height,
          caption: color(3 + captionTop + 3),
          image: color(
            3 +
              imageTop +
              Math.round(imageHeight * (alignment === "middle" ? 0.3 : 0.5)),
          ),
        };
        bitmap.close();
        return result;
      },
      { bytes: [...bytes], captionTop, imageTop, imageHeight, alignment },
    );
    expect(result.width).toBe(462);
    expect(result.height).toBe(
      3 * imageHeight + (placement === "overlay" ? 0 : captionHeight) + 12,
    );
    expect(result.image).toEqual([64, 100, 200, 255]);
    return result.caption;
  }
  for (const [aspect, ratio, imageHeight] of [
    ["Portrait", 3 / 4, 200],
    ["Landscape", 4 / 3, 113],
    ["Square", 1, 150],
  ]) {
    await selectField(page, "image-shape", aspect.toLowerCase());
    await expect(page.locator('#image-shape [aria-checked="true"]')).toHaveText(
      aspect,
    );
    for (const placement of ["above", "below", "overlay"]) {
      await selectField(
        page,
        "caption-position",
        placement === "overlay" ? "overlay-bottom" : placement,
      );
      const bounds = await image.boundingBox();
      expect(Math.abs(bounds.width / bounds.height - ratio)).toBeLessThan(
        0.015,
      );
      const field = await caption.boundingBox();
      if (placement === "above")
        expect(field.y + field.height).toBeCloseTo(bounds.y, 0);
      if (placement === "below")
        expect(field.y).toBeCloseTo(bounds.y + bounds.height, 0);
      if (placement !== "overlay") {
        await expect(
          page.getByRole("button", { name: "Text overlay settings" }),
        ).toHaveCount(0);
        expect(await pixels(imageHeight, placement)).toEqual([35, 39, 43, 255]);
        continue;
      }
      await openDesignControls(page, "caption-overlay-value");
      await expect(
        page.getByRole("textbox", {
          name: "Overlay color hex value",
          exact: true,
        }),
      ).not.toBeFocused();
      await page
        .getByRole("textbox", { name: "Overlay color hex value", exact: true })
        .fill("#00ff00");
      await openDesignControls(page, "caption-opacity");
      await page.locator("#caption-opacity").fill("50");
      for (const alignment of ["top", "bottom"]) {
        await selectField(page, "caption-position", `overlay-${alignment}`);

        const imageBounds = await image.boundingBox();
        const captionBounds = await caption.boundingBox();
        const expected =
          alignment === "top"
            ? imageBounds.y
            : alignment === "middle"
              ? imageBounds.y + (imageBounds.height - captionBounds.height) / 2
              : imageBounds.y + imageBounds.height - captionBounds.height;
        expect(captionBounds.y).toBeCloseTo(expected, 0);
        await image.hover();
        const toolBounds = await page
          .getByRole("group", { name: "Cell tools", exact: true })
          .locator("button")
          .evaluateAll((buttons) =>
            buttons.map((button) => {
              const rect = button.getBoundingClientRect();
              return { top: rect.top, bottom: rect.bottom };
            }),
          );
        expect(toolBounds).toHaveLength(3);
        for (const rect of toolBounds)
          expect(
            rect.bottom <= captionBounds.y + 1 ||
              rect.top >= captionBounds.y + captionBounds.height - 1,
          ).toBe(true);
        await page.mouse.move(0, 0);
        const pixel = await pixels(imageHeight, "overlay", alignment);
        expect(Math.abs(pixel[0] - 32)).toBeLessThanOrEqual(1);
        expect(Math.abs(pixel[1] - 178)).toBeLessThanOrEqual(1);
        expect(Math.abs(pixel[2] - 100)).toBeLessThanOrEqual(1);
        expect(pixel[3]).toBe(255);
      }
    }
  }
  for (const [opacity, expected] of [
    [0, [64, 100, 200, 255]],
    [100, [0, 255, 0, 255]],
  ]) {
    await openDesignControls(page, "caption-opacity");
    await page.locator("#caption-opacity").fill(String(opacity));
    expect(await pixels(150, "overlay")).toEqual(expected);
  }
  await caption.fill("A surprisingly long caption that remains editable");
  await expect(caption).toHaveValue(
    "A surprisingly long caption that remains editable",
  );
  await caption.press("Tab");
  const longCaptionPreview = page
    .locator(".grid-cell")
    .first()
    .locator("[data-caption-preview] span");
  await expect(longCaptionPreview).toBeVisible();
  await expect
    .poll(() =>
      longCaptionPreview.evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          Number(style.webkitLineClamp) <= 3 &&
          element.getBoundingClientRect().height <=
            parseFloat(style.lineHeight) * 3 +
              parseFloat(style.paddingTop) +
              parseFloat(style.paddingBottom) +
              0.1
        );
      }),
    )
    .toBe(true);
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: testInfo.outputPath("appearance-desktop.png"),
  });
  await reloadWorkspace(page);
  await expect(caption).toHaveValue(
    "A surprisingly long caption that remains editable",
  );
  const saved = await savedWorkspace(page);
  expect(saved.grid.cells[0]).toMatchObject({
    id: identity.id,
    assetId: identity.assetId,
    fit: "cover",
  });
  expect(saved.grid).toMatchObject({
    imageAspect: "square",
    captionPlacement: "overlay",
    captionAlignment: "bottom",
    captionOverlayColor: "#00ff00",
    captionOverlayOpacity: 100,
  });
  await setEditorViewport(page, { width: 390, height: 844 });
  for (const width of [390, 320]) {
    await setEditorViewport(page, { width, height: 844 });
    await showSidebar(page);
    await openDesignControls(page, "image-shape");
    await expect(page.locator("#image-shape")).toHaveAccessibleName("Shape");
    await openDesignControls(page, "caption-position");
    await expect(page.locator("#caption-position")).toHaveAccessibleName(
      "Card heading",
    );
    const positions = page.locator("#caption-position");
    await expect(positions.getByRole("radio")).toHaveCount(4);
    await positions.scrollIntoViewIfNeeded();
    expect(
      await positions.getByRole("radio").evaluateAll((buttons) =>
        buttons.every((button) => {
          const rect = button.getBoundingClientRect();
          return (
            rect.x >= 0 &&
            rect.right <= innerWidth &&
            rect.width >= 44 &&
            rect.height >= 44
          );
        }),
      ),
    ).toBe(true);
    await openDesignControls(page, "caption-overlay-value");
  }
  await setEditorViewport(page, { width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await showSidebar(page);
  const color = page.getByRole("textbox", {
    name: "Overlay color hex value",
    exact: true,
  });
  await expect(color).toBeVisible();
  await expect(color).not.toBeFocused();
  await openSidebarPanel(page, "Design");
  const colorBounds = await color.boundingBox();
  expect(colorBounds.x).toBeGreaterThanOrEqual(0);
  expect(colorBounds.x + colorBounds.width).toBeLessThanOrEqual(390);
  await closeSidebarPanel(page);
  await selectField(page, "image-shape", "landscape");
  await selectField(page, "caption-position", "overlay-bottom");
  await caption.fill("Blue");
  await image.hover();
  await expect(
    page.getByRole("group", { name: "Cell tools", exact: true }),
  ).toBeVisible();
  const mobileCaption = await caption.boundingBox();
  const mobileTools = await page
    .getByRole("group", { name: "Cell tools", exact: true })
    .locator("button")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      }),
    );
  expect(mobileTools).toHaveLength(3);
  for (const rect of mobileTools)
    expect(
      rect.bottom <= mobileCaption.y + 1 ||
        rect.top >= mobileCaption.y + mobileCaption.height - 1,
    ).toBe(true);
  await caption.click();
  await page.screenshot({ path: testInfo.outputPath("appearance-mobile.png") });
});

test("editable hex color and Headless UI settings dropdowns synchronize and persist", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await openSidebarPanel(page, "Design");
  await openDesignSection(page, "Canvas heading");
  await expect(
    page.getByRole("switch", { name: "Show heading", exact: true }),
  ).toBeChecked();
  await expect(page.locator("[data-theme-builder] select")).toHaveCount(0);
  const canvasStyle = page.getByRole("group", {
    name: "Canvas style",
    exact: true,
  });
  const hex = page.getByRole("textbox", {
    name: "Background hex value",
    exact: true,
  });
  const picker = page.getByLabel("Background color picker", {
    exact: true,
  });
  for (const id of ["heading-font", "cell-font"]) {
    await openDesignControls(page, id);
    await page.locator(`label[for="${id}"]`).hover();

    await page.locator(`#${id}`).hover();

    await page.locator(`label[for="${id}"]`).click();
    await expect(page.locator(`#${id}`)).toBeFocused();
    await page.locator(`#${id}`).press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(`#${id}`)).toBeFocused();

    await page.locator(`#${id}`).screenshot({
      path: testInfo.outputPath(`focus-${id}.png`),
    });
    await page.locator(`#${id}`).press("ArrowDown");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.getByRole("listbox").press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  }
  await openDesignControls(page, "background-value");
  await page.locator('label[for="background-value"]').hover();

  await page.locator('label[for="background-value"]').click();
  await expect(hex).toBeFocused();
  await hex.blur();
  for (const field of [picker, hex]) {
    await page.mouse.move(0, 0);

    const value = await field.inputValue();
    const before = await field.boundingBox();
    await field.hover();

    await expect(field).toHaveValue(value);
    expect(await field.boundingBox()).toEqual(before);
  }
  const pickerBox = await picker.boundingBox();
  expect(pickerBox.width).toBeGreaterThanOrEqual(64);
  expect(pickerBox.height).toBeGreaterThanOrEqual(44);
  expect((await hex.boundingBox()).height).toBeGreaterThanOrEqual(44);

  await hex.click();
  await expect(hex).toBeFocused();
  await hex.fill("112233");
  await hex.press("Enter");
  await expect(hex).toHaveValue("#112233");
  await expect(picker).toHaveValue("#112233");
  await hex.fill("#zzzzzz");
  await expect(picker).toHaveValue("#112233");
  await hex.press("Tab");
  await expect(hex).toHaveValue("#112233");
  await hex.fill("#12");
  await hex.press("Escape");
  await expect(hex).toHaveValue("#112233");
  await picker.fill("#aabbcc");
  await expect(hex).toHaveValue("#AABBCC");
  await openDesignControls(page, "heading-font");
  await page.locator("#heading-font").click();
  for (const option of await page.getByRole("option").all()) {
    const spacing = await option.evaluate((element) => {
      const row = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      return {
        height: row.height,
        top: text.top - row.top,
        bottom: row.bottom - text.bottom,
      };
    });
    expect(spacing.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(spacing.top - spacing.bottom)).toBeLessThanOrEqual(2);
  }
  await expect(
    page.getByRole("option", { name: "Manrope", exact: true }),
  ).toBeDisabled();
  await page.getByRole("listbox").press("End");
  await expect(
    page.getByRole("option", { name: "Boogaloo", exact: true }),
  ).toHaveAttribute("data-focus", "");
  await page.getByRole("listbox").press("Enter");
  await openDesignControls(page, "heading-font");
  await expect(page.locator("#heading-font")).toHaveText("Boogaloo");
  await selectField(page, "heading-font", "Manrope");
  await openDesignControls(page, "heading-font");
  await expect(page.locator("#heading-font")).toHaveText("Manrope");
  await selectField(page, "cell-font", "Boogaloo");
  await openDesignControls(page, "cell-font");
  await expect(page.locator("#cell-font")).toHaveText("Boogaloo");
  await openDesignControls(page, "heading-font");
  await page.locator("#heading-font").click();
  await page.screenshot({
    path: testInfo.outputPath("color-dropdowns-desktop.png"),
  });
  await page.getByRole("listbox").press("Escape");
  await page.locator("#export-grid-header").click();
  await expect(page.locator("[data-theme-builder] select")).toHaveCount(0);
  await selectField(page, "format", "image/webp");
  await selectField(page, "resolution", "300");
  await expect
    .poll(async () => (await localDatabase(page)).document?.exportSettings)
    .toMatchObject({ format: "image/webp", resolution: 300 });
  await reloadWorkspace(page);
  await openDesignControls(page, "background-value");
  await expect(hex).toHaveValue("#AABBCC");
  await openDesignControls(page, "heading-font");
  await expect(page.locator("#heading-font")).toHaveText("Manrope");
  await openDesignControls(page, "cell-font");
  await expect(page.locator("#cell-font")).toHaveText("Boogaloo");
  await setEditorViewport(page, { width: 390, height: 844 });
  await showSidebar(page);
  await openDesignControls(page, "heading-font");
  await page.locator("#heading-font").click();
  await expect(async () => {
    const menuBox = await page.getByRole("listbox").boundingBox();
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(
      page.viewportSize().width,
    );
  }).toPass({ timeout: 5000 });
  await page.screenshot({
    path: testInfo.outputPath("color-dropdowns-mobile.png"),
  });
  await page.getByRole("listbox").press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("cell toolbar overlays the image and never selects a cell", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles({
    name: "overlay.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="96"><rect width="192" height="96" fill="#40b4aa"/><rect width="96" height="96" fill="#e74264"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await page.locator(".asset").hover();
  const libraryDelete = page.getByRole("button", {
    name: "Delete image",
    exact: true,
  });
  await libraryDelete.hover();

  await page.mouse.move(3, 3);
  const image = page.locator(".cell-image-button").first();
  await page.locator(".asset").dragTo(image);
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await page.mouse.move(3, 3);
  await image.hover();
  const tools = page.getByRole("group", { name: "Cell tools", exact: true });
  await expect(tools).toBeVisible();
  for (const name of ["Replace image", "Crop image", "Clear cell"]) {
    const button = tools.getByRole("button", { name, exact: true });
    const before = await button.boundingBox();
    await button.hover();

    expect(await button.boundingBox()).toEqual(before);
  }
  await image.hover();
  const picture = await image.boundingBox();
  const toolbar = await tools.boundingBox();
  expect(toolbar.x).toBeGreaterThanOrEqual(picture.x - 1);
  expect(toolbar.y).toBeGreaterThanOrEqual(picture.y - 1);
  expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(
    picture.x + picture.width + 1,
  );
  expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(
    picture.y + picture.height + 1,
  );
  await expect(
    tools.getByRole("button", { name: "Edit heading", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(
      ".grid-cell.selected, .cell-badge, #asset-count, #board-summary, .canvas-heading",
    ),
  ).toHaveCount(0);
  await tools.getByRole("button", { name: "Crop image", exact: true }).click();
  const cropDialog = page.getByRole("dialog", {
    name: "Crop image",
    exact: true,
  });
  await expect(cropDialog).toBeVisible();
  await cropDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(cropDialog).toHaveCount(0);
  await expect(image).toBeFocused();
  await expect(
    page.getByRole("button", { name: /^(Fit|Fill) image$/ }),
  ).toHaveCount(0);
  await image.hover();
  await expect(tools.locator("button:disabled")).toHaveCount(0);

  const clear = await tools
    .getByRole("button", { name: "Clear cell", exact: true })
    .boundingBox();
  expect(clear.x).toBeGreaterThanOrEqual(picture.x);
  expect(clear.y).toBeGreaterThanOrEqual(picture.y);
  expect(clear.x + clear.width).toBeLessThanOrEqual(picture.x + picture.width);
  expect(clear.y + clear.height).toBeLessThanOrEqual(
    picture.y + picture.height,
  );
  await expect(page.locator(".grid-cell img")).toHaveCSS("object-fit", "cover");
  await page.screenshot({
    path: testInfo.outputPath("cell-overlay-desktop.png"),
  });
  await page.locator(".cell-heading").first().fill("Inline caption");
  await expect(tools).toHaveCount(0);
  await expect
    .poll(async () => (await localDatabase(page)).document?.grid.cells[0].title)
    .toBe("Inline caption");
});

test("touch cell overlays target the tapped image without autofocus", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("./");
  const image = page.locator(".cell-image-button").nth(2);
  await image.tap({ position: { x: 5, y: 5 } });
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input, textarea"),
    ),
  ).toBe(false);
  const picker = page.getByRole("dialog", { name: "Choose image" });
  await picker.locator("#picker-cell-upload").setInputFiles({
    name: "touch.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#40b4aa"/></svg>',
    ),
  });
  const tools = page.getByRole("group", { name: "Cell tools", exact: true });
  await expect(tools).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input, textarea"),
    ),
  ).toBe(false);
  await expect(picker).toHaveCount(0);
  await expect(page.locator(".grid-cell").nth(2).locator("img")).toHaveCount(1);
  await expect(page.locator(".grid-cell").first().locator("img")).toHaveCount(
    0,
  );
  await image.tap();
  await expect(tools).toBeVisible();
  const picture = await image.boundingBox();
  const toolbar = await tools.boundingBox();
  expect(toolbar.x).toBeGreaterThanOrEqual(picture.x - 1);
  expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(
    picture.x + picture.width + 1,
  );
  expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(
    picture.y + picture.height + 1,
  );
  const clear = await tools
    .getByRole("button", { name: "Clear cell", exact: true })
    .boundingBox();
  const drag = await tools
    .getByRole("button", { name: "Drag image", exact: true })
    .boundingBox();
  const inset = picture.x + picture.width - clear.x - clear.width;
  expect(drag.x - picture.x).toBeCloseTo(inset, 0);
  expect(drag.y - picture.y).toBeCloseTo(clear.y - picture.y, 0);
  const heading = await page
    .locator(".grid-cell")
    .nth(2)
    .locator(".cell-heading")
    .boundingBox();
  expect(toolbar.y + toolbar.height).toBeCloseTo(heading.y, 0);
  for (const name of ["Replace image", "Crop image"]) {
    const control = tools.getByRole("button", { name, exact: true });
    const button = await control.boundingBox();
    expect(toolbar.y + toolbar.height - button.y - button.height).toBeCloseTo(
      inset,
      0,
    );
    const sideGap =
      name === "Replace image"
        ? button.x - picture.x
        : picture.x + picture.width - button.x - button.width;
    expect(sideGap).toBeCloseTo(inset, 0);
    expect(button.y + button.height).toBeLessThan(heading.y);
    expect(
      await control.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
          ),
        );
      }),
    ).toBe(true);
  }
  await page.screenshot({
    path: testInfo.outputPath("cell-overlay-mobile.png"),
  });
  await selectField(page, "caption-position", "overlay-top");
  await image.tap();
  await expect(tools).toBeVisible();
  const topRegion = await tools.boundingBox();
  const topHeading = await page
    .locator(".grid-cell")
    .nth(2)
    .locator(".cell-heading")
    .boundingBox();
  expect(topRegion.y).toBeCloseTo(topHeading.y + topHeading.height, 0);
  const topPicture = await image.boundingBox();
  expect(topRegion.y + topRegion.height).toBeCloseTo(
    topPicture.y + topPicture.height,
    0,
  );
  for (const [name, side, edge] of [
    ["Drag image", "left", "top"],
    ["Clear cell", "right", "top"],
    ["Replace image", "left", "bottom"],
    ["Crop image", "right", "bottom"],
  ]) {
    const control = tools.getByRole("button", { name, exact: true });
    const button = await control.boundingBox();
    const sideGap =
      side === "left"
        ? button.x - topRegion.x
        : topRegion.x + topRegion.width - button.x - button.width;
    const edgeGap =
      edge === "top"
        ? button.y - topRegion.y
        : topRegion.y + topRegion.height - button.y - button.height;
    expect(edgeGap).toBeCloseTo(sideGap, 0);
    expect(button.y).toBeGreaterThan(topHeading.y + topHeading.height);
    expect(
      await control.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
          ),
        );
      }),
    ).toBe(true);
  }
  await page.screenshot({
    path: testInfo.outputPath("cell-overlay-top-mobile.png"),
  });
  for (const position of ["overlay-bottom", "overlay-top"]) {
    await selectField(page, "caption-position", position);
    await image.tap();
    await expect(tools).toBeVisible();
    await image.hover();
    await expect(page.locator(".grid-cell").nth(2)).toHaveAttribute(
      "data-image-hovered",
      "",
    );
    const paintInset = await tools.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.cssText =
        "position:absolute;width:var(--card-paint-inset,0px);height:0;pointer-events:none";
      element.append(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return width;
    });
    expect(paintInset).toBe(0);
    const region = await tools.boundingBox();
    for (const [name, side, edge] of [
      ["Drag image", "left", "top"],
      ["Clear cell", "right", "top"],
      ["Replace image", "left", "bottom"],
      ["Crop image", "right", "bottom"],
    ]) {
      const button = await tools
        .getByRole("button", { name, exact: true })
        .boundingBox();
      const visibleSideGap =
        (side === "left"
          ? button.x - region.x
          : region.x + region.width - button.x - button.width) - paintInset;
      const headingEdge = position === `overlay-${edge}`;
      const visibleEdgeGap =
        (edge === "top"
          ? button.y - region.y
          : region.y + region.height - button.y - button.height) -
        (headingEdge ? 0 : paintInset);
      expect(visibleSideGap).toBeGreaterThan(0);
      expect(visibleEdgeGap).toBeCloseTo(visibleSideGap, 0);
    }
    await page.screenshot({
      path: testInfo.outputPath(`cell-${position}-hover.png`),
    });
  }
  const caption = page.locator(".grid-cell").nth(2).locator(".cell-heading");
  await caption.fill("One\nTwo\nThree\nFour\nFive\nSix");
  for (const shape of ["portrait", "landscape", "square"]) {
    await selectField(page, "image-shape", shape);
    for (const position of ["overlay-top", "overlay-bottom"]) {
      await selectField(page, "caption-position", position);
      const bounds = await image.boundingBox();
      await image.tap({
        position: {
          x: 5,
          y: position === "overlay-top" ? bounds.height - 5 : 5,
        },
      });
      await expect(tools).toBeVisible();
      const buttons = await tools.locator("button").evaluateAll((buttons) =>
        buttons.map((button) => {
          const { x, y, width, height } = button.getBoundingClientRect();
          return { x, y, width, height };
        }),
      );
      expect(buttons).toHaveLength(4);
      const heading = await caption.boundingBox();
      for (const [index, button] of buttons.entries()) {
        expect(button.width).toBeGreaterThan(bounds.width * 0.15);
        if (position === "overlay-top")
          expect(button.y - heading.y - heading.height).toBeGreaterThan(
            bounds.width * 0.04 - 1,
          );
        else
          expect(heading.y - button.y - button.height).toBeGreaterThan(
            bounds.width * 0.04 - 1,
          );
        for (const other of buttons.slice(index + 1)) {
          const horizontal = Math.max(
            0,
            button.x - other.x - other.width,
            other.x - button.x - button.width,
          );
          const vertical = Math.max(
            0,
            button.y - other.y - other.height,
            other.y - button.y - button.height,
          );
          expect(Math.hypot(horizontal, vertical)).toBeGreaterThan(
            bounds.width * 0.04 - 1,
          );
        }
      }
      await expect
        .poll(() =>
          page
            .locator(".grid-cell")
            .nth(2)
            .locator("[data-caption-preview] > span")
            .evaluate((preview) => {
              const style = getComputedStyle(preview);
              const lines = Number(style.webkitLineClamp);
              return (
                lines > 0 &&
                lines <= 3 &&
                preview.getBoundingClientRect().height <=
                  parseFloat(style.lineHeight) * 3 +
                    parseFloat(style.paddingTop) +
                    parseFloat(style.paddingBottom) +
                    1
              );
            }),
        )
        .toBe(true);
      await expect(caption).toHaveValue("One\nTwo\nThree\nFour\nFive\nSix");
    }
  }
  await page.screenshot({
    path: testInfo.outputPath("capped-caption-tools-mobile.png"),
  });
  await context.close();
});

test("image library has no demo header or loader on any host", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "Load example", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#asset-library .section-heading")).toHaveCount(0);
  const exampleRequests = [];
  await page.route("https://grids.example/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("comics")) exampleRequests.push(url.pathname);
    const response = await route.fetch({
      url: `http://localhost:5840${url.pathname}${url.search}`,
    });
    await route.fulfill({ response });
  });
  await page.goto("https://grids.example/grids/");
  await expect(page.locator("#board-grid")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load example", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Load example", exact: true }),
  ).toHaveCount(0);
  expect(exampleRequests).toEqual([]);
});

touchTest(
  "image imports show progress and keep the editor responsive through failed files",
  async ({ page }, testInfo) => {
    await setEditorViewport(page, { width: 1440, height: 1080 });
    await page.addInitScript(() => {
      const decode = HTMLImageElement.prototype.decode;
      window.pendingImageDecodes = [];
      HTMLImageElement.prototype.decode = function () {
        if (!this.src.startsWith("blob:")) return decode.call(this);
        return new Promise((resolve, reject) => {
          window.pendingImageDecodes.push(() =>
            decode.call(this).then(resolve, reject),
          );
        });
      };
    });
    await page.goto("./");
    await page.locator("#upload").setInputFiles([
      {
        name: "first.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#40b4aa"/></svg>',
        ),
      },
      {
        name: "broken.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from("not an image"),
      },
      {
        name: "second.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#e74264"/></svg>',
        ),
      },
      {
        name: "third.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="white"/></svg>',
        ),
      },
      {
        name: "fourth.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="white"/></svg>',
        ),
      },
    ]);
    const add = page.getByRole("button", { name: "Add images", exact: true });
    const progress = add.getByRole("status");
    const library = page.getByRole("complementary", {
      name: "Image library drop zone",
      exact: true,
    });
    await expect(progress).toContainText("0 / 5");
    const loading = page.locator(
      '[data-image-placeholder][data-loading="true"]:visible',
    );
    await expect(loading).toHaveCount(5);

    const transfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(
        new File(
          [
            '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="white"/></svg>',
          ],
          "overlap.svg",
          { type: "image/svg+xml" },
        ),
      );
      return data;
    });
    await library.dispatchEvent("drop", { dataTransfer: transfer });
    await transfer.dispose();
    await expect(progress).toContainText("0 / 6");
    await expect(loading).toHaveCount(6);
    await expect(add).toBeDisabled();
    const reset = page.getByRole("tab", {
      name: "Reset",
      exact: true,
      includeHidden: true,
    });
    await expect(reset).toBeDisabled();

    await expect(library).toHaveAttribute("aria-busy", "true");
    await openDesignControls(page, "gap");
    await page.locator("#gap").fill("30");
    await expect(page.locator("#gap")).toHaveValue("30");
    await openSidebarPanel(page, "Images");
    await page.screenshot({
      path: testInfo.outputPath("import-progress-desktop.png"),
    });
    for (const completed of [0, 1, 2, 3, 4, 5]) {
      await expect(reset).toBeDisabled();
      await expect(progress).toContainText(`${completed} / 6`);
      await expect(loading).toHaveCount(6 - completed);
      await expect(
        (completed > 1
          ? page.getByRole("dialog", { name: "Choose image", exact: true })
          : page
        ).locator(".asset:visible"),
      ).toHaveCount(completed - (completed >= 3 ? 1 : 0));
      await expect
        .poll(() => page.evaluate(() => window.pendingImageDecodes.length))
        .toBeGreaterThan(0);
      if (completed === 1) {
        await setEditorViewport(page, { width: 390, height: 844 });
        await page
          .locator(".cell-image-button")
          .first()
          .tap({ position: { x: 5, y: 5 } });
        await expect(progress).toBeVisible();

        const local = page.getByRole("region", {
          name: "My images",
          exact: true,
        });

        await expect(
          local.getByText("No images yet.", { exact: true }),
        ).toHaveCount(0);
        await expect
          .poll(async () => {
            const bounds = await progress.boundingBox();
            return bounds ? bounds.y + bounds.height : Infinity;
          })
          .toBeLessThanOrEqual(836);
        await page.screenshot({
          path: testInfo.outputPath("import-progress-mobile.png"),
        });
      }
      await page.evaluate(() => {
        window.pendingImageDecodes.shift()();
      });
    }
    await expect(progress).toHaveCount(0);

    await expect(add).toBeEnabled();
    await expect(reset).toBeEnabled();
    await page
      .getByRole("dialog", { name: "Choose image", exact: true })
      .getByRole("button", { name: "Close dialog", exact: true })
      .tap();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await setEditorViewport(page, { width: 1440, height: 1080 });
    await openSidebarPanel(page, "Images");
    await expect(library).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(".asset")).toHaveCount(5);
    await expect(page.locator("[data-sonner-toast]")).toContainText(
      "Could not load broken.svg",
    );
    await expect
      .poll(async () => (await localDatabase(page)).document?.assets.length)
      .toBe(5);
    expect((await localDatabase(page)).images).toHaveLength(5);
    expect((await savedWorkspace(page)).grid.gap).toBe(36);
  },
);

test("My images has no filler cards and rejects GIF uploads and drops", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator("#asset-library")).toBeVisible();

  await expect(page.locator("#asset-library [data-upload-tile]")).toHaveCount(
    1,
  );
  const gif = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
  );
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="white"/></svg>',
  );
  for (const file of [
    { name: "ordinary.gif", mimeType: "image/gif", buffer: gif },
    { name: "disguised.png", mimeType: "image/png", buffer: gif },
    {
      name: "legacy.png",
      mimeType: "image/png",
      buffer: Buffer.concat([Buffer.from("GIF87a"), gif.subarray(6)]),
    },
    { name: "extension.GIF", mimeType: "image/svg+xml", buffer: svg },
    { name: "mime.png", mimeType: "image/gif", buffer: svg },
  ]) {
    await page.locator("#upload").setInputFiles(file);
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: file.name }),
    ).toContainText("GIF uploads are not supported.");
    await expect(page.locator(".asset")).toHaveCount(0);
    expect((await localDatabase(page)).images).toHaveLength(0);
  }
  await page.locator("#replace-upload").setInputFiles({
    name: "replacement.gif",
    mimeType: "image/gif",
    buffer: gif,
  });
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "replacement.gif" }),
  ).toContainText("GIF uploads are not supported.");
  await page.locator("#upload").setInputFiles([
    { name: "mixed.gif", mimeType: "image/gif", buffer: gif },
    { name: "Allowed.svg", mimeType: "image/svg+xml", buffer: svg },
  ]);
  await expect(page.locator(".asset")).toHaveCount(1);
  await page.locator(".cell-image-button").first().press("Enter");
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  const local = picker.getByRole("region", { name: "My images", exact: true });

  await expect(local.locator("[data-library-image]")).toHaveCount(1);
  const accepts = await page
    .locator('input[type="file"]')
    .evaluateAll((inputs) => inputs.map((input) => input.accept));
  expect(accepts).toHaveLength(3);
  for (const accept of accepts) {
    expect(accept).not.toContain("image/*");
    expect(accept).not.toContain("image/gif");
    expect(accept).toContain("image/png");
  }
  await picker
    .locator("#picker-cell-upload")
    .setInputFiles({ name: "picker.gif", mimeType: "image/gif", buffer: gif });
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "picker.gif" }),
  ).toContainText("GIF uploads are not supported.");
  await expect(picker).toHaveCount(0);
  const transfer = await page.evaluateHandle(
    (bytes) => {
      const data = new DataTransfer();
      data.items.add(
        new File([new Uint8Array(bytes)], "dropped.gif", { type: "image/gif" }),
      );
      return data;
    },
    [...gif],
  );
  await page
    .locator("#asset-library")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "dropped.gif" })
      .last(),
  ).toContainText("GIF uploads are not supported.");
  await page
    .locator(".grid-cell")
    .first()
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "dropped.gif" }),
  ).toHaveCount(2);
  await expect(page.locator(".grid-cell img")).toHaveCount(0);
  await expect
    .poll(async () => (await localDatabase(page)).images.length)
    .toBe(1);
  await expect(page.locator("#asset-library .asset")).toHaveCount(1);
  await transfer.dispose();
});

test("empty cells and image library accept direct uploads and file drops", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  const placeholder = page.getByRole("button", {
    name: "Add image to cell 5",
    exact: true,
  });
  await placeholder.hover();
  await expect(
    page.getByRole("group", { name: "Cell tools", exact: true }),
  ).toHaveCount(0);
  const chooser = page.waitForEvent("filechooser");
  await placeholder.click();
  await (
    await chooser
  ).setFiles({
    name: "direct.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#40b4aa"/></svg>',
    ),
  });
  await expect(page.locator(".grid-cell").nth(4).locator("img")).toHaveCount(1);
  await expect(page.locator(".grid-cell").first().locator("img")).toHaveCount(
    0,
  );
  const transfer = await page.evaluateHandle(() => {
    const files = new DataTransfer();
    files.items.add(
      new File(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#e74264"/></svg>',
        ],
        "dropped.svg",
        { type: "image/svg+xml" },
      ),
    );
    return files;
  });
  const library = page.getByRole("complementary", {
    name: "Image library drop zone",
    exact: true,
  });
  await expect(
    library.getByRole("button", { name: "Add images", exact: true }),
  ).toBeVisible();
  await library.dispatchEvent("dragover", { dataTransfer: transfer });

  await library.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.locator(".asset")).toHaveCount(2);
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  const cell = page.locator(".grid-cell").nth(1);
  await cell.dispatchEvent("dragover", { dataTransfer: transfer });

  await cell.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(cell.locator("img")).toHaveCount(1);

  await expect(page.locator(".asset")).toHaveCount(3);
  await expect
    .poll(async () => (await localDatabase(page)).document?.assets.length)
    .toBe(3);
  await page.screenshot({
    path: testInfo.outputPath("direct-upload-drop-zones.png"),
  });
});

test("individual library deletion retains canvas images without confirmation", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  const addImages = page.getByRole("button", {
    name: "Add images",
    exact: true,
  });
  expect((await addImages.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await expect(
    page.locator("#asset-library > :first-child").getByRole("button"),
  ).toHaveAttribute("aria-label", "Add images");
  await expect(
    page.getByRole("group", { name: "Image category", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Grid actions", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Rename grid", exact: true }),
  ).toHaveCount(0);
  await page.locator("#upload").setInputFiles(
    ["used.svg", "unused.svg"].map((name) => ({
      name,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  await expect(page.locator(".asset")).toHaveCount(2);
  await expect(
    page.getByRole("group", { name: "Image category", exact: true }),
  ).toHaveCount(0);
  await chooseImage(page, "used");
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await page.locator(".cell-heading").first().fill("Keep this caption");
  await expect(page.locator(".library-heading").first()).toHaveValue("used");
  await openSidebarPanel(page, "Design");
  await openDesignControls(page, "gap");
  await page.locator("#gap").fill("40");
  await openDesignControls(page, "gap");
  await expect(page.locator("#gap")).toHaveValue("40");
  await expect(page.locator(".asset")).toHaveCount(2);
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Keep this caption",
  );
  await expect
    .poll(async () => (await localDatabase(page)).document?.grid.cells[0].title)
    .toBe("Keep this caption");
  await savedWorkspace(page);
  await openSidebarPanel(page, "Images");
  const tileBox = await addImages.boundingBox();
  const cardBox = await page.locator(".asset").first().boundingBox();
  expect(tileBox.width).toBeCloseTo(cardBox.width, 1);
  expect(tileBox.height).toBeCloseTo(cardBox.height, 1);
  await page
    .getByRole("button", {
      name: "Image options: used",
      exact: true,
    })
    .hover();
  await page.screenshot({
    path: testInfo.outputPath("library-delete-hover-desktop.png"),
  });
  await page.getByRole("button", { name: "Delete image", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await localDatabase(page)).document?.assets.find(
          (asset) => asset.title === "used",
        )?.libraryHidden,
    )
    .toBe(true);
  expect((await localDatabase(page)).images).toHaveLength(2);
  await expect(page.locator(".asset")).toHaveCount(1);
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Keep this caption",
  );
  await page
    .getByRole("button", { name: "Add image to cell 2", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  await expect(
    picker.getByRole("button", { name: "Use used", exact: true }),
  ).toHaveCount(0);
  await picker.getByRole("button", { name: "Use unused", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await page.locator("#upload").setInputFiles({
    name: "spare.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#40b4aa"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(2);
  for (const title of ["unused", "spare"]) {
    await page
      .getByRole("button", { name: `Image options: ${title}`, exact: true })
      .hover();
    await page
      .getByRole("button", { name: "Delete image", exact: true })
      .click();
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await localDatabase(page)).document?.assets.filter(
          (asset) => !asset.libraryHidden,
        ).length,
    )
    .toBe(0);
  expect((await localDatabase(page)).images).toHaveLength(2);
  await expect(page.locator(".grid-cell img")).toHaveCount(2);
  await expect(addImages).toBeFocused();
  await expect(page.locator(".asset")).toHaveCount(0);
  expect((await addImages.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await reloadWorkspace(page);
  await expect(page.locator(".asset")).toHaveCount(0);
  await expect(page.locator(".grid-cell img")).toHaveCount(2);
  await expect(
    page.locator(".grid-cell").nth(0).locator("img"),
  ).toHaveAttribute("alt", "Keep this caption");
  await expect(
    page.locator(".grid-cell").nth(1).locator("img"),
  ).toHaveAttribute("alt", "unused");
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Keep this caption",
  );
  const retained = await savedWorkspace(page);
  expect(retained.grid.cells[0].assetId).toBe(
    retained.assets.find((asset) => asset.title === "used").id,
  );
  await page.screenshot({
    path: testInfo.outputPath("clear-reset-library-cleanup-desktop.png"),
  });
  await setEditorViewport(page, { width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("clear-reset-library-cleanup-mobile.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("touch library taps reveal delete and upload remains the first tile", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(testInfo.project.use.baseURL);
  const add = page.getByRole("button", { name: "Add images", exact: true });
  expect((await add.boundingBox()).height).toBeGreaterThanOrEqual(44);
  const chooser = page.waitForEvent("filechooser");
  await add.tap();
  await (
    await chooser
  ).setFiles(
    ["first.svg", "second.svg"].map((name) => ({
      name,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  await expect(page.locator(".asset")).toHaveCount(2);
  await expect(
    page.locator("#asset-library > :first-child").getByRole("button"),
  ).toHaveAttribute("aria-label", "Add images");
  const addBox = await add.boundingBox();
  const imageBox = await page.locator(".asset").first().boundingBox();
  expect(addBox.width).toBeCloseTo(imageBox.width, 1);
  expect(addBox.height).toBeCloseTo(imageBox.height, 1);
  await expect(
    page.getByRole("button", { name: "Delete image", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Image options: first", exact: true })
    .tap();
  await expect(
    page.getByRole("button", { name: "Delete image", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete image", exact: true }),
  ).toHaveAttribute("title", "Delete image");
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input,textarea"),
    ),
  ).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath("library-delete-tap-mobile.png"),
  });
  await page.getByRole("button", { name: "Delete image", exact: true }).tap();
  await expect(page.locator(".asset")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Image options: second", exact: true })
    .tap();
  await page.getByRole("button", { name: "Delete image", exact: true }).tap();
  await expect(page.locator(".asset")).toHaveCount(0);
  await expect
    .poll(async () => (await localDatabase(page)).document?.assets.length)
    .toBe(0);
  expect((await localDatabase(page)).images).toHaveLength(0);
  await page.screenshot({
    path: testInfo.outputPath("library-empty-placeholder-mobile.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.close();
});

test("multi-tab notifications preserve local edits and require confirmed reload", async ({
  page,
  context,
}, testInfo) => {
  await context.addInitScript(() => {
    window.workspaceNotifications = [];
    const NativeChannel = window.BroadcastChannel;
    window.BroadcastChannel = class extends NativeChannel {
      constructor(name) {
        super(name);
        this.workspaceChannel = name === "grids-workspace-v1";
      }
      postMessage(data) {
        if (this.workspaceChannel)
          window.workspaceNotifications.push(structuredClone(data));
        return super.postMessage(data);
      }
    };
  });
  await page.goto("./");
  await page.locator("#upload").setInputFiles({
    name: "shared.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await chooseImage(page, "shared");
  await expect
    .poll(async () => (await localDatabase(page)).document?.grid.cells[0].title)
    .toBe("shared");
  const original = await savedWorkspace(page);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.locator(".asset")).toHaveCount(1);
  await other.clock.install();
  await other.clock.pauseAt(new Date());
  await other.clock.runFor(400);
  expect((await localDatabase(page)).document.revision).toBe(original.revision);
  await expect(page.locator("#save-status")).toHaveText(
    "Saved in this browser",
  );
  await expect(other.locator("#save-status")).toHaveText(
    "Saved in this browser",
  );
  await page.evaluate(() => {
    const channel = new BroadcastChannel("grids-workspace-v1");
    channel.postMessage({ id: "guest", revision: crypto.randomUUID() });
    channel.postMessage({ id: "guest", revision: "invalid" });
    channel.close();
  });
  await other.clock.runFor(400);
  await expect(other.getByRole("alert")).toHaveCount(0);
  await other.locator(".cell-heading").first().fill("Unsaved second tab");
  await expect(other.locator(".cell-heading").first()).toHaveValue(
    "Unsaved second tab",
  );
  await page.locator(".cell-heading").first().fill("Saved elsewhere");
  await editHeading(page, "First tab saved");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(async () => (await localDatabase(page)).document.grid.heading)
    .toBe("First tab saved");
  const latest = await savedWorkspace(page);
  await expect(other.locator("#save-status")).toHaveText(
    "Changed in another tab",
  );
  await expect(other.getByRole("alert")).toContainText(
    "This tab is not saving.",
  );
  await other.clock.runFor(500);
  expect((await localDatabase(page)).document).toEqual(latest);
  expect(
    await other.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  const notifications = await page.evaluate(() =>
    window.workspaceNotifications.filter(
      (message) => message.revision !== "invalid",
    ),
  );
  expect(notifications.length).toBeGreaterThan(1);
  for (const message of notifications) {
    expect(Object.keys(message).sort()).toEqual(["id", "revision"]);
    expect(message.id).toBe("guest");
    expect(message.revision).toMatch(/^[0-9a-f-]{36}$/);
  }
  await other.screenshot({ path: testInfo.outputPath("conflict-desktop.png") });
  await other.setViewportSize({ width: 390, height: 844 });
  await other.screenshot({ path: testInfo.outputPath("conflict-mobile.png") });
  expect(
    await other.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await other
    .getByRole("button", { name: "Reload saved grid", exact: true })
    .click();
  const dialog = other.getByRole("dialog", { name: "Reload saved grid" });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await other.clock.runFor(300);
  await expect(dialog).toHaveCount(0);
  await expect(other.locator(".cell-heading").first()).toHaveValue(
    "Unsaved second tab",
  );
  await other.locator("#export-grid-header").click();
  await selectField(other, "resolution", "150");
  expect((await downloadBoard(other)).suggestedFilename()).toBe("grid.png");
  expect((await localDatabase(page)).document).toEqual(latest);
  const unexpectedDialogs = [];
  other.on("dialog", async (dialog) => {
    unexpectedDialogs.push(dialog.type());
    await dialog.dismiss();
  });
  await other
    .getByRole("button", { name: "Reload saved grid", exact: true })
    .click();
  const navigation = other.waitForEvent("load");
  await dialog
    .getByRole("button", { name: "Reload saved grid", exact: true })
    .click();
  await navigation;
  await expect(
    other.getByRole("button", { name: /^Edit grid heading: / }),
  ).toHaveText("First tab saved");
  await expect(other.locator(".cell-heading").first()).toHaveValue(
    "Saved elsewhere",
  );
  await expect(other.getByRole("alert")).toHaveCount(0);
  await expect(other.locator(".grid-cell img")).toHaveCount(1);
  expect(unexpectedDialogs).toEqual([]);
  expect((await localDatabase(page)).document.revision).toBe(latest.revision);
  await other.close();
});

test("multi-tab focus and visibility checks work without BroadcastChannel", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    window.BroadcastChannel = undefined;
  });
  await page.goto("./");
  await savedWorkspace(page);
  for (const event of ["focus", "visibilitychange"]) {
    const other = await context.newPage();
    await other.goto(page.url());
    await expect(other.locator("#board-grid")).toBeVisible();
    await editHeading(page, `Saved before ${event}`);
    await expect
      .poll(async () => (await localDatabase(page)).document.grid.heading)
      .toBe(`Saved before ${event}`);
    await other.evaluate((event) => {
      if (event === "focus") window.dispatchEvent(new Event("focus"));
      else {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      }
    }, event);
    await expect(other.locator("#save-status")).toHaveText(
      "Changed in another tab",
    );
    await expect(other.getByRole("alert")).toBeVisible();
    expect((await localDatabase(page)).document.grid.heading).toBe(
      `Saved before ${event}`,
    );
    await other.close();
  }
});

test("unused-image deletion releases removed placements and protects visible media", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles(
    ["used", "archived", "unused"].map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>',
      ),
    })),
  );
  await expect(page.locator(".asset")).toHaveCount(3);
  await chooseImage(page, "used");
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await chooseImage(page, "archived", 15);
  await page.getByRole("button", { name: "Remove row", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove column", exact: true })
    .click();
  const original = await savedWorkspace(page);
  const unusedId = original.assets[2].id;
  const source = await page
    .locator(".asset")
    .nth(2)
    .locator("img")
    .getAttribute("src");
  for (const title of ["used", "archived", "unused"]) {
    await page
      .getByRole("button", { name: `Image options: ${title}`, exact: true })
      .hover();
    await page
      .getByRole("button", { name: "Delete image", exact: true })
      .click();
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".asset")).toHaveCount(0);
  await expect
    .poll(async () => (await localDatabase(page)).document.assets.length)
    .toBe(1);
  const purged = await savedWorkspace(page);
  expect(purged.grid).toEqual(original.grid);
  expect(purged.assets.every((asset) => asset.libraryHidden)).toBe(true);
  expect(purged.assets.some((asset) => asset.id === unusedId)).toBe(false);
  expect(purged.assets.map((asset) => asset.id)).toEqual(
    original.assets.slice(0, 1).map((asset) => asset.id),
  );
  expect(
    (await localDatabase(page)).images.map((image) => image.id).sort(),
  ).toEqual(purged.assets.map((asset) => asset.id).sort());
  expect(
    await page.evaluate(async (src) => {
      try {
        await fetch(src);
        return false;
      } catch {
        return true;
      }
    }, source),
  ).toBe(true);
  await reloadWorkspace(page);
  await expect(page.locator(".asset")).toHaveCount(0);
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(page.locator(".cell-heading").nth(15)).toHaveValue("");
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("discarded-placement-media.png"),
  });
});

test("failed full reset preserves stored metadata and blobs until the retry commits", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.failPurgeSave = false;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "grids-settings-v1" && window.failPurgeSave)
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.goto("./");
  await page.locator("#upload").setInputFiles({
    name: "purge.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  const source = await page.locator(".asset img").getAttribute("src");
  const original = await savedWorkspace(page);
  await page.evaluate(() => {
    window.failPurgeSave = true;
  });
  await resetEverything(page);
  await expect(page.locator("#save-status")).toHaveText("Save failed");
  const failed = await localDatabase(page);
  expect(failed.document).toEqual(original);
  expect(failed.images).toHaveLength(1);
  expect(
    await page.evaluate(async (src) => (await fetch(src)).ok, source),
  ).toBe(true);
  await page.evaluate(() => {
    window.failPurgeSave = false;
  });
  await editHeading(page, "Retry deletion");
  expect((await savedWorkspace(page)).assets).toEqual([]);
  expect((await localDatabase(page)).images).toEqual([]);
  expect(
    await page.evaluate(async (src) => {
      try {
        await fetch(src);
        return false;
      } catch {
        return true;
      }
    }, source),
  ).toBe(true);
});

test("debounced saves coalesce edits and flush on hide while guarding unsaved navigation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.settingsWrites = 0;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "grids-settings-v1") window.settingsWrites++;
      return setItem.call(this, key, value);
    };
  });
  await page.goto("./");
  await uploadCellImage(page);
  await savedWorkspace(page);
  await expect(page.locator("#save-status")).toBeHidden();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.evaluate(() => {
    window.settingsWrites = 0;
  });
  await page.locator(".cell-heading").first().fill("First edit");
  await page.clock.runFor(150);
  await page.locator(".cell-heading").first().fill("Latest edit");
  await expect(page.locator("#save-status")).toHaveText("Saving changes...");
  await expect(page.locator("#save-status")).toBeHidden();
  await page.clock.runFor(299);
  expect(await page.evaluate(() => window.settingsWrites)).toBe(0);
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await page.clock.runFor(1);
  expect((await savedWorkspace(page)).grid.cells[0].title).toBe("Latest edit");
  await expect(page.locator("#save-status")).toBeHidden();
  expect(await page.evaluate(() => window.settingsWrites)).toBe(1);
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
  await page.locator(".cell-heading").first().fill("Hide flush");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect((await savedWorkspace(page)).grid.cells[0].title).toBe("Hide flush");
  expect(await page.evaluate(() => window.settingsWrites)).toBe(2);
  await page.clock.runFor(300);
  expect(await page.evaluate(() => window.settingsWrites)).toBe(2);
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "grids-settings-v1")
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.locator(".cell-heading").first().fill("Unsaved edit");
  await expect(page.locator("#save-status")).toHaveText("Save failed");
  await expect(page.locator("#save-status")).toBeHidden();
  await page.clock.runFor(50);
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Local save failed",
  );
});

test("automatic browser saves need no storage controls or persistence request", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.persistenceRequests = 0;
    window.grantPersistence = false;
    window.persistedStorage = false;
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: async () => ({ usage: 2048, quota: 65536 }),
        persisted: async () => window.persistedStorage,
        persist: async () => {
          window.persistenceRequests++;
          window.persistedStorage = window.grantPersistence;
          return window.persistedStorage;
        },
      },
    });
  });
  await page.goto("./");
  const image = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
  );
  await page.locator("#replace-upload").setInputFiles({
    name: "storage.svg",
    mimeType: "image/svg+xml",
    buffer: image,
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await savedWorkspace(page);
  await expect(
    page.getByRole("button", {
      name: "Local storage",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.persistenceRequests)).toBe(0);
  await expect(
    page.getByRole("button", {
      name: "Request persistent storage",
      exact: true,
    }),
  ).toHaveCount(0);
  expect((await localDatabase(page)).images[0].size).toBe(image.length);
  await reloadWorkspace(page);
  await expect(page.locator(".asset")).toHaveCount(1);
  await setEditorViewport(page, { width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Local storage", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("automatic saves work without browser estimates or persistence APIs", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: async () => {
          throw new Error("Estimate unavailable");
        },
      },
    });
  });
  await page.goto("./");
  await openSidebarPanel(page, "Design");
  await openDesignControls(page, "gap");
  await page.locator("#gap").fill("25");
  await expect
    .poll(async () => (await localDatabase(page)).document?.grid.gap)
    .toBe(30);
  await reloadWorkspace(page);
  await openDesignControls(page, "gap");
  await expect(page.locator("#gap")).toHaveValue("25");
});

test("IndexedDB stores image blobs and private grid content while localStorage holds settings only", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "grids-settings-v1" && value.length > 2048)
        throw new DOMException("Settings too large", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.goto("./");
  const image = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#12a874"/>${" ".repeat(100_000)}</svg>`,
  );
  await page.locator("#replace-upload").setInputFiles({
    name: "private-photo.svg",
    mimeType: "image/svg+xml",
    buffer: image,
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await chooseImage(page, "private photo");
  await editHeading(page, "Private banner");
  await page.locator(".cell-heading").first().fill("Private caption");
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  await page
    .getByRole("dialog", { name: "Export grid", exact: true })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const document = await savedWorkspace(page);
  const stored = await localDatabase(page);
  expect(stored.images).toEqual([
    {
      id: document.assets[0].id,
      isBlob: true,
      size: image.length,
      type: "image/svg+xml",
    },
  ]);
  expect(JSON.stringify(document)).not.toMatch(/blob:|data:/);
  const settings = await page.evaluate(() =>
    localStorage.getItem("grids-settings-v1"),
  );
  expect(settings.length).toBeLessThan(2048);
  const configuration = JSON.parse(settings);
  expect(Object.keys(configuration).sort()).toEqual([
    "exportSettings",
    "layout",
    "style",
    "version",
  ]);
  for (const privateValue of [
    document.grid.id,
    document.assets[0].id,
    "Private collection",
    "Private banner",
    "Private caption",
    "private photo",
    "blob:",
    "data:",
  ])
    expect(settings).not.toContain(privateValue);
  const originalUrl = await page.locator(".asset img").getAttribute("src");
  expect(originalUrl).toMatch(/^blob:/);
  await reloadWorkspace(page);
  await expect(
    page.getByRole("button", { name: /^Edit grid heading: / }),
  ).toHaveText("Private banner");
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Private caption",
  );
  await expect
    .poll(() =>
      page
        .locator(".asset img")
        .evaluate((image) => image.complete && image.naturalWidth === 48),
    )
    .toBe(true);
  expect(await page.locator(".asset img").getAttribute("src")).not.toBe(
    originalUrl,
  );
  await page.locator(".cell-heading").first().fill("First edit");
  await page.locator(".cell-heading").first().fill("Second edit");
  await page.locator(".cell-heading").first().fill("Latest edit");
  expect((await savedWorkspace(page)).grid.cells[0].title).toBe("Latest edit");
  await reloadWorkspace(page);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Latest edit",
  );
});

test("missing IndexedDB image data cannot overwrite the stored grid with blank defaults", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator("#replace-upload").setInputFiles({
    name: "retained.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await editHeading(page, "Keep stored grid");
  const original = await savedWorkspace(page);
  await localDatabase(page, "delete-image", { id: original.assets[0].id });
  await reloadWorkspace(page);
  await expect(page.locator("#save-status")).toHaveText("Session only");
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "stored grid has not been replaced",
  );
  await editHeading(page, "Session edit");
  const stored = await localDatabase(page);
  expect(stored.document).toEqual(original);
  expect(stored.images).toEqual([]);
});

test("revision notifications are emitted only after successful commits", async ({
  page,
}) => {
  const moduleUrl = await storageModuleUrl();
  await page.goto("./");
  const original = await savedWorkspace(page);
  const result = await page.evaluate(async (moduleUrl) => {
    const { LocalWorkspaceStore } = await import(moduleUrl);
    const nativeChannel = window.BroadcastChannel;
    const notifications = [];
    let closed = false;
    window.BroadcastChannel = class {
      postMessage(message) {
        notifications.push(message);
      }
      close() {
        closed = true;
      }
    };
    const store = new LocalWorkspaceStore();
    const workspace = await store.load();
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
    let failed = false;
    try {
      await store.save({
        ...workspace,
        grid: { ...workspace.grid, name: "Rejected commit" },
      });
    } catch {
      failed = true;
    }
    Storage.prototype.setItem = setItem;
    const before = notifications.length;
    await store.save({
      ...workspace,
      grid: { ...workspace.grid, name: "Committed retry" },
    });
    store.dispose();
    window.BroadcastChannel = nativeChannel;
    return { failed, before, notifications, closed };
  }, moduleUrl);
  expect(result.failed).toBe(true);
  expect(result.before).toBe(0);
  expect(result.closed).toBe(true);
  const stored = (await localDatabase(page)).document;
  expect(stored.grid.name).toBe("Committed retry");
  expect(stored.revision).not.toBe(original.revision);
  expect(result.notifications).toEqual([
    { id: "guest", revision: stored.revision },
  ]);
});

test("revision guard rejects stale writes and simultaneous writers without notifications", async ({
  page,
}) => {
  const moduleUrl = await storageModuleUrl();
  await page.goto("./");
  await savedWorkspace(page);
  const result = await page.evaluate(async (moduleUrl) => {
    const { LocalWorkspaceStore, LocalWorkspaceConflictError } = await import(
      moduleUrl
    );
    const broadcast = window.BroadcastChannel;
    window.BroadcastChannel = class {
      constructor() {
        throw new Error("Unavailable");
      }
    };
    const writer = new LocalWorkspaceStore();
    let conflicts = 0;
    const stale = new LocalWorkspaceStore(() => {
      conflicts += 1;
    });
    const latest = await writer.load();
    const older = await stale.load();
    const image = writer.createAsset(new Blob(["Saved bytes"]), "Saved image");
    const unsaved = stale.createAsset(
      new Blob(["Unsaved bytes"]),
      "Unsaved image",
    );
    await writer.save({
      ...latest,
      assets: [image],
      grid: { ...latest.grid, name: "Newer grid" },
    });
    stale.scheduleImageDeletion([image.id]);
    let rejected = false;
    try {
      await stale.save({
        ...older,
        assets: [unsaved],
        grid: { ...older.grid, name: "Stale grid" },
      });
    } catch (error) {
      rejected = error instanceof LocalWorkspaceConflictError;
    }
    const changed = await stale.checkForChanges();
    const intact = await (await fetch(image.src)).text();
    const retained = await (await fetch(unsaved.src)).text();
    writer.dispose();
    stale.dispose();
    const first = new LocalWorkspaceStore();
    const second = new LocalWorkspaceStore();
    const firstGrid = await first.load();
    const secondGrid = await second.load();
    const firstImage = first.createAsset(new Blob(["First"]), "First");
    const secondImage = second.createAsset(new Blob(["Second"]), "Second");
    const attempts = await Promise.allSettled([
      first.save({
        ...firstGrid,
        assets: [...firstGrid.assets, firstImage],
        grid: { ...firstGrid.grid, name: "First writer", gap: 15 },
      }),
      second.save({
        ...secondGrid,
        assets: [...secondGrid.assets, secondImage],
        grid: { ...secondGrid.grid, name: "Second writer", gap: 22 },
      }),
    ]);
    const winner =
      attempts[0].status === "fulfilled" ? firstImage.id : secondImage.id;
    const statuses = attempts.map((attempt) => attempt.status);
    const loserConflict =
      attempts.find((attempt) => attempt.status === "rejected")
        ?.reason instanceof LocalWorkspaceConflictError;
    first.dispose();
    second.dispose();
    window.BroadcastChannel = broadcast;
    return {
      rejected,
      changed,
      conflicts,
      intact,
      retained,
      statuses,
      loserConflict,
      winner,
      protectedId: image.id,
    };
  }, moduleUrl);
  expect(result.rejected).toBe(true);
  expect(result.changed).toBe(true);
  expect(result.conflicts).toBe(1);
  expect(result.intact).toBe("Saved bytes");
  expect(result.retained).toBe("Unsaved bytes");
  expect(result.statuses.sort()).toEqual(["fulfilled", "rejected"]);
  expect(result.loserConflict).toBe(true);
  const stored = await localDatabase(page);
  expect(stored.document.revision).toMatch(/^[0-9a-f-]{36}$/);
  expect(stored.document.assets.map((asset) => asset.id).sort()).toEqual(
    [result.protectedId, result.winner].sort(),
  );
  expect(stored.images.map((image) => image.id).sort()).toEqual(
    [result.protectedId, result.winner].sort(),
  );
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("grids-settings-v1")).style.gap,
    ),
  ).toBe(stored.document.grid.gap);
});

test("local media ownership revokes object URLs and rejects writes after disposal", async ({
  page,
}) => {
  const moduleUrl = await storageModuleUrl();
  await page.goto("./");
  const original = await savedWorkspace(page);
  const lifecycle = await page.evaluate(async (moduleUrl) => {
    const { LocalWorkspaceStore } = await import(moduleUrl);
    const store = new LocalWorkspaceStore();
    const workspace = await store.load();
    const asset = store.createAsset(
      new Blob(["local bytes"], { type: "image/png" }),
      "Lifetime test",
    );
    const before = await (await fetch(asset.src)).text();
    store.dispose();
    let revoked = false;
    let closedWrite = false;
    let closedCreate = false;
    try {
      await fetch(asset.src);
    } catch {
      revoked = true;
    }
    try {
      await store.save(workspace);
    } catch {
      closedWrite = true;
    }
    try {
      store.createAsset(new Blob(["other bytes"]), "Closed");
    } catch {
      closedCreate = true;
    }
    return { before, revoked, closedWrite, closedCreate };
  }, moduleUrl);
  expect(lifecycle).toEqual({
    before: "local bytes",
    revoked: true,
    closedWrite: true,
    closedCreate: true,
  });
  expect((await localDatabase(page)).document).toEqual(original);
});

test("single grid starts with refined dark defaults and uploaded content persists", async ({
  page,
}, testInfo) => {
  const requests = [];
  const errors = [];
  page.on("request", (request) =>
    requests.push({ type: request.resourceType(), url: request.url() }),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(page).toHaveTitle("Gridz");
  await expect(
    page.getByRole("link", { name: "Gridz", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#asset-library")).toBeVisible();
  await expect(
    page.locator("#add-board, #board-tabs, #export-all"),
  ).toHaveCount(0);
  await expect(page.locator(".grid-cell")).toHaveCount(9);
  await expect(page.locator(".asset")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Edit grid heading: / }),
  ).toHaveText("Add heading");
  expect((await savedWorkspace(page)).grid.publisher).toBe("none");
  await openDesignControls(page, "heading-font");
  await expect(page.locator("#heading-font")).toHaveText("Manrope");
  await openDesignControls(page, "cell-font");
  await expect(page.locator("#cell-font")).toHaveText("Manrope");
  await expect(page.locator('[data-filter="DC"]')).toHaveCount(0);
  await expect(page.locator('[data-filter="Marvel"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  expect(requests.filter((request) => request.type === "image")).toEqual([]);
  expect(
    requests.some((request) => /\/comics-[^/]+\.js/.test(request.url)),
  ).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath("neutral-desktop.png"),
    fullPage: true,
  });
  await setEditorViewport(page, { width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("neutral-mobile.png"),
    fullPage: true,
  });
  await setEditorViewport(page, { width: 1440, height: 1080 });
  await selectExportField(page, "resolution", "150");
  const download = await downloadBoard(page);
  const bytes = [...(await readFile(await download.path()))];
  expect(download.suggestedFilename()).toBe("grid.png");
  expect(
    await page.evaluate(async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    }, bytes),
  ).toEqual({ width: 480, height: 630 });
  await page.locator("#replace-upload").setInputFiles({
    name: "personal.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#12a874"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await chooseImage(page, "personal");
  await page.locator(".cell-heading").first().fill("Keep my own caption");
  const snapshot = await savedWorkspace(page);
  await reloadWorkspace(page);
  expect(await savedWorkspace(page)).toEqual(snapshot);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Keep my own caption",
  );
  expect(errors).toEqual([]);
});

test("image placement, title editing, grid sizing, and image exports", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await useComicExample(page);
  await expect
    .poll(() =>
      page
        .locator(".asset img")
        .evaluateAll((images) =>
          images.every((image) => image.complete && image.naturalWidth > 0),
        ),
    )
    .toBe(true);
  expect(new URL(page.url()).pathname).toBe("/grids/");
  await expect(page.locator(".grid-cell")).toHaveCount(4);
  await expect(page.locator(".board-export-heading")).toHaveText("Team DC");
  await expect(page.locator(".board-export-heading img")).toHaveCount(0);

  await expect(page.locator(".board-export-heading")).toHaveCSS(
    "font-family",
    "Bangers, sans-serif",
  );
  await expect(page.locator(".cell-heading").first()).toHaveCSS(
    "font-family",
    "Boogaloo, sans-serif",
  );
  await expect(page.locator(".cell-heading").first()).toHaveCSS(
    "text-transform",
    "none",
  );

  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: testInfo.outputPath("desktop.png"),
    fullPage: true,
  });

  await page
    .locator(".asset")
    .last()
    .dragTo(page.locator(".cell-image-button").first());
  await expect(page.locator(".cell-heading").first()).toHaveValue("Soft Serve");
  await page
    .locator(".cell-image-button")
    .first()
    .dragTo(page.locator(".cell-image-button").nth(1));
  await expect(page.locator(".cell-heading").nth(1)).toHaveValue("Soft Serve");
  await page.locator(".cell-heading").nth(1).fill("A larger heading");
  await expect(page.locator(".cell-heading").nth(1)).toHaveValue(
    "A larger heading",
  );
  await reloadWorkspace(page);
  await expect(page.locator(".cell-heading").nth(1)).toHaveValue(
    "A larger heading",
  );

  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await expect(page.locator(".grid-cell")).toHaveCount(6);
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(page.locator(".grid-cell")).toHaveCount(9);
  await (
    await beginCellUpload(page, 8)
  ).setInputFiles(
    path.join(projectRoot, "tests/fixtures/assets/DC - Kite Man.jpg"),
  );
  await expect(page.locator(".cell-heading").nth(8)).toHaveValue("DC Kite Man");

  await savedWorkspace(page);
  await localDatabase(page, "clear");
  await page.evaluate(() => localStorage.clear());
  await reloadWorkspace(page);
  await useComicExample(page);

  const exports = [];
  for (const publisher of ["dc", "marvel"]) {
    await useComicExample(page, publisher);
    for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
      await selectExportField(page, "resolution", "600");
      await selectField(page, "format", mime);
      const download = await downloadBoard(page);
      const bytes = await readFile(await download.path());
      const expectedExtension = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
      }[mime];
      expect(download.suggestedFilename()).toBe(
        `${publisher}-characters${expectedExtension}`,
      );
      if (mime === "image/png")
        expect([...bytes.slice(0, 8)]).toEqual([
          137, 80, 78, 71, 13, 10, 26, 10,
        ]);
      if (mime === "image/jpeg")
        expect([...bytes.slice(0, 3)]).toEqual([255, 216, 255]);
      if (mime === "image/webp")
        expect(String.fromCharCode(...bytes.slice(8, 12))).toBe("WEBP");
      const result = await page.evaluate(
        async ({ base64, mime, publisher }) => {
          const blob = await (
            await fetch(`data:${mime};base64,${base64}`)
          ).blob();
          const image = await createImageBitmap(blob);
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0);
          const title = context.getImageData(60, 950, 600, 138).data;
          const heading = context.getImageData(60, 60, 1260, 168).data;
          let brightTitlePixels = 0;
          let headingPixels = 0;
          for (let index = 0; index < title.length; index += 4) {
            if (
              title[index] > 180 &&
              title[index + 1] > 180 &&
              title[index + 2] > 180
            )
              brightTitlePixels++;
          }
          for (let index = 0; index < heading.length; index += 4) {
            if (
              heading[index] > 180 &&
              heading[index + 1] > 180 &&
              heading[index + 2] > 180
            )
              headingPixels++;
          }
          const headerColor = [
            ...context.getImageData(canvas.width / 2, 84, 1, 1).data,
          ].slice(0, 3);
          const headerMargin = context.getImageData(84, 84, 120, 120).data;
          let headerMarginPixels = 0;
          for (let index = 0; index < headerMargin.length; index += 4) {
            if (
              headerMargin[index] > 200 &&
              headerMargin[index + 1] > 200 &&
              headerMargin[index + 2] > 200
            )
              headerMarginPixels++;
          }
          const result = {
            publisher,
            mime: blob.type,
            width: image.width,
            height: image.height,
            brightTitlePixels,
            headingPixels,
            headerColor,
            headerMarginPixels,
          };
          image.close();
          return result;
        },
        { base64: bytes.toString("base64"), mime, publisher },
      );
      exports.push(result);
    }
  }
  expect(exports.map((result) => result.mime)).toEqual([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/png",
    "image/jpeg",
    "image/webp",
  ]);
  for (const result of exports) {
    expect(result.width).toBe(1380);
    expect(result.height).toBe(2076);
    expect(result.brightTitlePixels).toBeGreaterThan(1000);
    expect(result.headingPixels).toBeGreaterThan(1000);
    expect(result.headerMarginPixels).toBe(0);
    const expectedColor =
      result.publisher === "dc" ? [0, 133, 199] : [237, 29, 36];
    result.headerColor.forEach((channel, index) =>
      expect(Math.abs(channel - expectedColor[index])).toBeLessThan(5),
    );
  }

  for (const publisher of ["dc", "marvel"]) {
    await useComicExample(page, publisher);
    await selectExportField(page, "resolution", "1200");
    await selectField(page, "format", "image/png");
    const download = await downloadBoard(page);
    await download.saveAs(testInfo.outputPath(download.suggestedFilename()));
  }

  await setEditorViewport(page, { width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".cell-heading")
      .evaluateAll((headings) =>
        headings.every((heading) => heading.scrollWidth <= heading.clientWidth),
      ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("grid headings and font choices persist and export correctly", async ({
  page,
}) => {
  await page.goto("./");
  await useComicExample(page);
  await page.locator(".cell-heading").first().fill("My custom character");
  await reloadWorkspace(page);
  await expect(page.locator(".board-export-heading")).toHaveText("Team DC");
  expect((await savedWorkspace(page)).grid.publisher).toBe("dc");
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "My custom character",
  );
  await editHeading(page, "Team Superheroes");
  await selectField(page, "heading-font", "Boogaloo");
  await selectField(page, "cell-font", "Bangers");
  await openDesignControls(page, "heading-background-color-value");
  await page.locator("#heading-background-color-value").fill("#ed1d24");

  await expect(page.locator(".board-export-heading img")).toHaveCount(0);
  await expect(page.locator(".board-export-heading")).toHaveText(
    "Team Superheroes",
  );
  await expect(page.locator(".cell-heading").first()).toHaveCSS(
    "font-family",
    "Bangers, sans-serif",
  );
  await reloadWorkspace(page);
  await expect(page.locator(".board-export-heading")).toHaveText(
    "Team Superheroes",
  );
  await openDesignControls(page, "heading-font");
  await expect(page.locator("#heading-font")).toHaveText("Boogaloo");
  await openDesignControls(page, "cell-font");
  await expect(page.locator("#cell-font")).toHaveText("Bangers");
  expect((await savedWorkspace(page)).grid.headingBackgroundColor).toBe(
    "#ed1d24",
  );
  await useComicExample(page, "marvel");
  await expect(page.locator(".board-export-heading")).toHaveText("Team Marvel");
  await editHeading(page, "");
  await expect(
    page.getByRole("button", { name: /^Edit grid heading: / }),
  ).toHaveText("Add heading");
  await selectExportField(page, "resolution", "600");
  const download = await downloadBoard(page);
  const base64 = (await readFile(await download.path())).toString("base64");
  const height = await page.evaluate(async (base64) => {
    const response = await fetch(`data:image/png;base64,${base64}`);
    const image = await createImageBitmap(await response.blob());
    const height = image.height;
    image.close();
    return height;
  }, base64);
  expect(height).toBe(1780);
  await editHeading(page, "A".repeat(120));
  await setEditorViewport(page, { width: 390, height: 844 });
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page
        .locator(".board-export-heading")
        .evaluate(
          (element) =>
            element.scrollWidth <= element.clientWidth &&
            element.scrollHeight <= element.clientHeight,
        ),
    )
    .toBe(true);
});

test("canvas heading can be disabled without losing text or style", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("./");
  await useComicExample(page);
  await openSidebarPanel(page, "Design");
  await selectField(page, "heading-font", "Boogaloo");
  await openDesignControls(page, "heading-text-color-value");
  await page.locator("#heading-text-color-value").fill("#123456");
  await openDesignControls(page, "heading-text-color-value");
  await page.locator("#heading-text-color-value").press("Tab");
  for (const width of [1440, 390]) {
    await setEditorViewport(page, { width, height: 900 });
    await openSidebarPanel(page, "Design");
    await openDesignSection(page, "Canvas heading");
    const section = page.locator("#theme-step-2");
    const toggle = section.getByRole("switch", {
      name: "Show heading",
      exact: true,
    });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(
      section.locator('input, button:not([role="switch"])'),
    ).toHaveCount(0);
    await expect(page.locator(".board-export-heading")).toHaveCount(0);
    const padding = await page.locator("#board-grid").evaluate((grid) => {
      const style = getComputedStyle(grid);
      return { top: style.paddingTop, bottom: style.paddingBottom };
    });
    expect(padding.top).toBe(padding.bottom);
    await section.screenshot({
      path: testInfo.outputPath(`heading-disabled-${width}.png`),
    });
    await reloadWorkspace(page);
    await openSidebarPanel(page, "Design");
    await openDesignSection(page, "Canvas heading");
    await expect(toggle).not.toBeChecked();
    await expect(
      section.locator('input, button:not([role="switch"])'),
    ).toHaveCount(0);
    await expect(page.locator(".board-export-heading")).toHaveCount(0);
    const saved = (await savedWorkspace(page)).grid;
    expect(saved).toMatchObject({
      headingVisible: false,
      heading: "Team DC",
      headingFont: "Boogaloo",
      headingTextColor: "#123456",
    });
    await selectExportField(page, "resolution", "600");
    const download = await downloadBoard(page);
    const bytes = [...(await readFile(await download.path()))];
    const height = await page.evaluate(async (bytes) => {
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
      const height = image.height;
      image.close();
      return height;
    }, bytes);
    expect(height).toBe(1780);
    await openSidebarPanel(page, "Design");
    await toggle.click();
    await expect(page.locator(".board-export-heading")).toHaveText("Team DC");
    await openDesignControls(page, "heading-font");
    await expect(page.locator("#heading-font")).toHaveText("Boogaloo");
    await openDesignControls(page, "heading-text-color-value");
    await expect(page.locator("#heading-text-color-value")).toHaveValue(
      "#123456",
    );
  }
});

test("editor heading edits and modal scrolling preserve content and restore focus", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setEditorViewport(page, { width: 1440, height: 760 });
  await page.goto("./");
  await useComicExample(page);
  const heading = page.getByRole("button", {
    name: /^Edit grid heading: /,
  });
  await heading.click();
  const headingInput = page.getByRole("textbox", {
    name: "Grid heading",
    exact: true,
  });
  await headingInput.fill("Edited heading");
  await headingInput.press("Escape");
  await expect(heading).toHaveText("Edited heading");
  await editHeading(page, "");
  await reloadWorkspace(page);
  await expect(heading).toHaveText("Add heading");
  await selectExportField(page, "resolution", "600");
  const download = await downloadBoard(page);
  const bytes = [...(await readFile(await download.path()))];
  const exportSize = await page.evaluate(async (bytes) => {
    const image = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    );
    const size = { width: image.width, height: image.height };
    image.close();
    return size;
  }, bytes);
  expect(exportSize).toEqual({ width: 1380, height: 1780 });
  await editHeading(page, "Team DC");
  const actions = page.locator("#export-grid-header");
  await actions.focus();
  const before = await page.evaluate(() => ({
    scroll: window.scrollY,
  }));
  await actions.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Export grid", exact: true });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"]')),
      ),
    )
    .toBe(true);

  const during = await page.evaluate(() => ({
    scroll: window.scrollY,
  }));
  expect(during).toEqual(before);
  await page.evaluate(() => {
    const content = document.createElement("div");
    content.style.height = "1200px";
    document.querySelector("[data-modal-scroll] > div > div").prepend(content);
  });
  const frame = page.locator("[data-modal-scroll]");
  await frame.evaluate((element) => element.scrollTo(0, 400));
  await expect
    .poll(() => frame.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(before.scroll);
  await page.screenshot({
    path: testInfo.outputPath("modal-scroll-desktop.png"),
  });
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(actions).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(before.scroll);
  await expect(heading).toHaveText("Team DC");
  await editHeading(page, "My image board");
  await reloadWorkspace(page);
  await expect(heading).toHaveText("My image board");
  await page.screenshot({
    path: testInfo.outputPath("controls-desktop.png"),
    fullPage: true,
  });
  await setEditorViewport(page, { width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await actions.click();
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("controls-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(heading).toHaveText("My image board");
  expect(errors).toEqual([]);
});

touchTest("touch dialogs do not autofocus text inputs", async ({ page }) => {
  await page.goto("./");
  await page.locator("#export-grid-header").tap();
  await expect(
    page.getByRole("dialog", { name: "Export grid", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"]')),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches(
        'input, textarea, [contenteditable="true"]',
      ),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
    "INPUT",
  );
  await page.getByRole("tab", { name: "Reset", exact: true }).tap();
  const reset = page.getByRole("dialog", {
    name: "Reset",
    exact: true,
  });
  await expect(reset).toBeVisible();
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches(
        'input, textarea, [contenteditable="true"]',
      ),
    ),
  ).toBe(false);
  await reset.getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(reset).toBeHidden();
});

test("selective reset checkboxes keep unselected data with one reset action", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await uploadCellImage(page, 15);
  await editHeading(page, "Keep heading");
  await selectField(page, "heading-font", "Bangers");
  await openSidebarPanel(page, "Design");
  await openDesignSection(page, "Colors");
  await page.getByRole("radio", { name: "Rose", exact: true }).click();
  await page
    .getByRole("button", { name: "Customize Colors", exact: true })
    .click();
  const background = page.getByRole("textbox", {
    name: "Background hex value",
    exact: true,
  });
  await background.click();
  await background.fill("#554455");
  await background.press("Tab");
  await page.getByRole("button", { name: "Remove row", exact: true }).click();
  const original = await savedWorkspace(page);
  const blobs = (await localDatabase(page)).images;
  const trigger = page.getByRole("tab", { name: "Reset", exact: true });
  const dialog = page.getByRole("dialog", { name: "Reset", exact: true });
  const confirm = dialog.getByRole("button", {
    name: "Reset selected",
    exact: true,
  });
  for (const width of [1440, 390, 260]) {
    await setEditorViewport(page, { width, height: 640 });
    await expect(page.locator("[data-editor-sidebar]")).toHaveCount(1);
    const url = page.url();
    await trigger.click();
    await expect(dialog).toBeVisible();
    expect(page.url()).toBe(url);
    await expect(dialog.getByRole("checkbox", { checked: true })).toHaveCount(
      0,
    );
    await expect(dialog.getByRole("checkbox")).toHaveCount(4);
    await expect(
      dialog.getByRole("checkbox", { name: "All", exact: true }),
    ).toHaveCount(0);
    await expect(dialog.locator("[data-reset-impact]")).toHaveCount(0);
    await expect(
      dialog.getByRole("button").filter({ hasText: /reset/i }),
    ).toHaveCount(1);
    await expect(
      dialog.getByRole("button", {
        name: "Advanced combinations",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(confirm).toBeDisabled();
    await selectField(page, "reset-theme-target", "default");
    await expect(
      dialog.getByRole("checkbox", { name: "Restore appearance", exact: true }),
    ).not.toBeChecked();
    await expect(confirm).toBeDisabled();
    await selectField(page, "reset-theme-target", "current");
    await dialog
      .getByRole("checkbox", { name: "Clear library", exact: true })
      .check();
    await expect(confirm).toBeEnabled();
    await expect(dialog.locator("[data-reset-impact]")).toHaveCount(0);
    await reviewReset(dialog, ["images"]);
    expect((await localDatabase(page)).document).toEqual(original);
    expect((await localDatabase(page)).images).toEqual(blobs);
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await expect(dialog.locator("[data-reset-impact]")).toHaveCount(0);
    await selectEveryResetOption(dialog);
    await expect(dialog.getByRole("checkbox", { checked: true })).toHaveCount(
      4,
    );
    for (const checkbox of await dialog.getByRole("checkbox").all())
      await checkbox.uncheck();
    await expect(dialog.getByRole("checkbox", { checked: true })).toHaveCount(
      0,
    );
    await expect(confirm).toBeDisabled();
    await selectEveryResetOption(dialog);
    await selectField(page, "reset-theme-target", "current");
    await expect(
      dialog.getByRole("checkbox", { name: "Restore appearance", exact: true }),
    ).toBeChecked();
    await selectField(page, "reset-theme-target", "default");
    await confirm.click();
    await expect(dialog.locator("[data-reset-review]")).toBeVisible();
    await expectResetReview(
      dialog,
      ["placements", "canvas", "theme", "images"],
      "default",
    );
    await expect(
      dialog.getByRole("button").filter({ hasText: /reset/i }),
    ).toHaveCount(1);
    expect((await localDatabase(page)).document).toEqual(original);
    expect((await localDatabase(page)).images).toEqual(blobs);
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await expect(dialog.getByRole("checkbox", { checked: true })).toHaveCount(
      4,
    );
    await expect(dialog.locator("[data-reset-impact]")).toHaveCount(0);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`reset-options-${width}.png`),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect((await localDatabase(page)).document).toEqual(original);
  }
  await setEditorViewport(page, { width: 1440, height: 1080 });
  await expect(page.locator("[data-editor-sidebar]")).toHaveCount(1);
  await trigger.click();
  await expect(dialog.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await expect(confirm).toBeDisabled();
  await dialog
    .getByRole("checkbox", { name: "Restore appearance", exact: true })
    .check();
  await expect(
    page.locator('#reset-theme-target [data-value="current"]'),
  ).toHaveAttribute("aria-checked", "true");
  await reviewReset(dialog, ["theme"]);
  await confirmSelectedReset(dialog);
  const themed = await savedWorkspace(page);
  expect(themed.grid).toMatchObject({
    colorTheme: "Rose",
    background: "#613745",
  });
  expect(themed.grid.headingFont).toBe("Manrope");
  expect(themed.grid.heading).toBe(original.grid.heading);
  expect(themed.grid.cells).toEqual(original.grid.cells);
  expect(themed.grid.overflow).toEqual(original.grid.overflow);
  expect(themed.assets).toEqual(original.assets);
  expect(themed.exportSettings).toEqual(original.exportSettings);
  expect((await localDatabase(page)).images).toEqual(blobs);
  await trigger.click();
  await dialog
    .getByRole("checkbox", { name: "Restore appearance", exact: true })
    .check();
  await selectField(page, "reset-theme-target", "default");
  await reviewReset(dialog, ["theme"], "default");
  await confirmSelectedReset(dialog);
  expect((await savedWorkspace(page)).grid).toMatchObject({
    colorTheme: "Ink",
    background: "#17191b",
  });
  expect((await savedWorkspace(page)).grid.cells).toEqual(original.grid.cells);
  expect((await localDatabase(page)).images).toEqual(blobs);
  await selectField(page, "heading-font", "Bangers");
  await trigger.click();
  await dialog
    .getByRole("checkbox", { name: "New empty 2x2 grid", exact: true })
    .check();
  await reviewReset(dialog, ["canvas"]);
  await confirmSelectedReset(dialog);
  const cleared = await savedWorkspace(page);
  expect(cleared.grid).toMatchObject({
    rows: 2,
    columns: 2,
    heading: "",
    headingFont: "Bangers",
    overflow: [],
  });
  await expect(page.locator("#board-grid .grid-cell")).toHaveCount(4);
  expect(
    cleared.grid.cells.every(
      (cell) => !cell.assetId && !cell.title && !cell.crop,
    ),
  ).toBe(true);
  expect(cleared.assets).toEqual(original.assets);
  expect((await localDatabase(page)).images).toEqual(blobs);
  await reloadWorkspace(page);
  await openSidebarPanel(page, "Images");
  await chooseImage(page, "Fixture");
  await page.locator(".cell-heading").first().fill("Keep caption");
  await editHeading(page, "Keep this heading too");
  const placed = await savedWorkspace(page);
  await trigger.click();
  await dialog
    .getByRole("checkbox", { name: "Clear library", exact: true })
    .check();
  await reviewReset(dialog, ["images"]);
  await confirmSelectedReset(dialog);
  const panelCleared = await savedWorkspace(page);
  expect(panelCleared.grid).toEqual(placed.grid);
  expect(panelCleared.assets).toEqual(
    placed.assets.map((asset) => ({ ...asset, libraryHidden: true })),
  );
  expect((await localDatabase(page)).images).toEqual(blobs);
  await reloadWorkspace(page);
  await openSidebarPanel(page, "Images");
  await expect(page.locator(".asset")).toHaveCount(0);
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await trigger.click();
  await dialog
    .getByRole("checkbox", { name: "Clear board content", exact: true })
    .check();
  await reviewReset(dialog, ["placements"]);
  await confirmSelectedReset(dialog);
  const deleted = await savedWorkspace(page);
  expect(deleted.grid).toMatchObject({
    rows: 2,
    columns: 2,
    heading: "",
    headingFont: "Bangers",
  });
  expect(deleted.grid.cells[0]).toMatchObject({
    title: "",
    assetId: null,
  });
  expect(deleted.assets).toEqual(panelCleared.assets);
  expect((await localDatabase(page)).images).toEqual(blobs);
  await reloadWorkspace(page);
  expect((await savedWorkspace(page)).grid).toEqual(deleted.grid);
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await dialog
    .getByRole("checkbox", { name: "Clear library", exact: true })
    .check();
  await reviewReset(dialog, ["images"]);
  await confirmSelectedReset(dialog);
  expect((await savedWorkspace(page)).assets).toEqual([]);
  expect((await localDatabase(page)).images).toEqual([]);
});

test("guest reset clears images and removed placements and restores default settings", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await (
    await beginCellUpload(page, 15)
  ).setInputFiles({
    name: "local.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await page.locator(".cell-heading").nth(15).fill("Keep my custom caption");
  await editHeading(page, "Custom banner");
  await selectField(page, "heading-font", "Bangers");
  await page
    .locator("[data-theme-builder]")
    .getByRole("button", { name: /2 Layout/ })
    .click();
  await page.locator("#theme-step-1 [data-customize-toggle]").click();
  await page.locator("#gap").fill("25");
  await selectExportField(page, "format", "image/webp");
  await selectField(page, "resolution", "300");
  await page.locator("#quality").fill("40");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await reloadWorkspace(page);
  await expect(page.locator(".board-export-heading")).toHaveText(
    "Custom banner",
  );
  const original = await savedWorkspace(page);
  expect(original.exportSettings).toMatchObject({
    format: "image/webp",
    resolution: 300,
    quality: 70,
  });
  await resetEverything(page);
  await expect(page.locator(".grid-cell")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: /^Edit grid heading: / }),
  ).toHaveText("Add heading");
  await expect(page.locator(".asset")).toHaveCount(0);
  const reset = await savedWorkspace(page);
  expect(reset.exportSettings).toEqual({
    format: "image/png",
    resolution: 300,
    quality: 95,
  });
  expect(reset.assets).toEqual([]);
  expect((await localDatabase(page)).images).toEqual([]);
  expect(reset.grid).toMatchObject({
    name: "Grid",
    publisher: "none",
    heading: "",
    headingFont: "Manrope",
    cellFont: "Manrope",
    rows: 2,
    columns: 2,
    gap: 24,
    background: "#17191b",
  });
  expect(
    reset.grid.overflow.some(
      (entry) => entry.cell.title === "Keep my custom caption",
    ),
  ).toBe(false);
  await reloadWorkspace(page);
  for (let step = 0; step < 2; step++) {
    await page.getByRole("button", { name: "Add row", exact: true }).click();
    await page.getByRole("button", { name: "Add column", exact: true }).click();
  }
  await expect(page.locator(".cell-heading").nth(15)).toHaveValue("");
  await expect(page.locator(".grid-cell img")).toHaveCount(0);
  await setEditorViewport(page, { width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("reset-grid-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("long title overlays reach the bottom and titles can be hidden without losing text", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await uploadCellImage(page);
  const title =
    "719aa1d1e36fc0028a6b11d2317a4547 monster killer bre espresso and cream coffee can 355ml";
  await page.locator(".cell-heading").first().fill(title);
  await openSidebarPanel(page, "Images");
  await page.locator(".library-heading").fill(title);
  await selectField(page, "caption-position", "overlay-bottom");
  const canvasPreview = page
    .locator(".grid-cell [data-caption-preview]")
    .first();
  await expect(canvasPreview).toBeVisible();

  await expect(canvasPreview).toHaveText(title);
  await page.locator(".cell-heading").first().click();
  await expect(canvasPreview).toBeHidden();
  await expect(page.locator(".cell-heading").first()).toHaveValue(title);
  const canvasField = page.locator(".cell-heading").first();

  await canvasField.press("Control+End");
  await expect
    .poll(() => canvasField.evaluate((field) => field.scrollTop))
    .toBeGreaterThan(0);
  await page.locator(".cell-image-button").nth(1).press("Enter");
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  for (const width of [800, 390]) {
    await setEditorViewport(page, { width, height: 900 });
    await expect
      .poll(() =>
        picker.locator("[data-library-caption-preview]").evaluate((preview) => {
          const caption = preview.getBoundingClientRect();
          const content = preview.parentElement.getBoundingClientRect();
          const text = preview.querySelector("span");
          const style = getComputedStyle(text);
          return {
            clamp: style.webkitLineClamp,
            heightBounded:
              text.getBoundingClientRect().height <=
              parseFloat(style.lineHeight) * 3 +
                parseFloat(style.paddingTop) +
                parseFloat(style.paddingBottom) +
                0.1,
            overflowing: text.scrollHeight > text.clientHeight,
            bottomAligned: Math.abs(content.bottom - caption.bottom) < 0.1,
          };
        }),
      )
      .toEqual({
        clamp: "3",
        heightBounded: true,
        overflowing: true,
        bottomAligned: true,
      });
    await page.screenshot({
      path: testInfo.outputPath(`long-title-overlay-${width}.png`),
    });
    const field = picker.locator(".library-heading");
    const preview = picker.locator("[data-library-caption-preview]");
    await expect(preview).toBeVisible();

    const fieldBounds = await field.boundingBox();
    const textWidth = await field.evaluate((element) => element.clientWidth);
    await field.click();
    await expect(preview).toBeHidden();
    await expect(field).toHaveValue(title);

    expect(await field.boundingBox()).toEqual(fieldBounds);
    expect(await field.evaluate((element) => element.clientWidth)).toBe(
      textWidth,
    );

    const scrollbar = picker.locator("[data-caption-scrollbar]");
    await expect(scrollbar).toBeVisible();
    const scrollbarBounds = await scrollbar.boundingBox();
    expect(scrollbarBounds.x).toBeGreaterThanOrEqual(
      fieldBounds.x + fieldBounds.width,
    );
    await field.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect
      .poll(() => field.evaluate((element) => element.scrollTop))
      .toBe(0);
    await page.mouse.move(
      scrollbarBounds.x + scrollbarBounds.width / 2,
      scrollbarBounds.y + 3,
    );
    await page.mouse.down();
    await page.mouse.move(
      scrollbarBounds.x + scrollbarBounds.width / 2,
      scrollbarBounds.y + scrollbarBounds.height - 2,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect(field).toBeFocused();
    await expect
      .poll(() => field.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await field.press("Control+End");
    await expect
      .poll(() => field.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await picker
      .getByRole("heading", { name: "Choose image", exact: true })
      .click();
    await expect(preview).toBeVisible();

    await expect(scrollbar).toHaveCount(0);
  }
  await picker
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await setEditorViewport(page, { width: 1440, height: 1080 });
  await selectField(page, "caption-position", "below");
  await openSidebarPanel(page, "Design");
  await openDesignSection(page, "Card headings", true);
  const toggle = page.getByRole("switch", { name: "Show titles", exact: true });
  await expect(toggle).toBeChecked();
  const titleColor = page.getByRole("textbox", {
    name: "Overlay color hex value",
    exact: true,
  });
  const titleOpacity = page.getByRole("slider", { name: /^Overlay opacity/ });
  const cardSettings = page.getByRole("group", {
    name: "Card style",
    exact: true,
  });
  const cardControls = cardSettings.locator(
    'input, button:not([role="switch"]):not([role="radio"]), [role="radiogroup"]:not(#image-shape)',
  );
  await expect(titleColor).toBeVisible();
  await expect(titleOpacity).toBeVisible();
  await titleColor.fill("#123456");
  await titleOpacity.fill("37");
  await toggle.click();
  await expect(toggle).toBeVisible();
  await openDesignSection(page, "Layout");
  await expect(page.locator("#image-shape")).toBeVisible();
  await openDesignSection(page, "Card headings");
  await expect(cardControls).toHaveCount(0);
  await expect(titleColor).toHaveCount(0);
  await expect(titleOpacity).toHaveCount(0);
  for (const width of [1440, 390]) {
    await setEditorViewport(page, { width, height: 1080 });
    await openSidebarPanel(page, "Design");
    await openDesignSection(page, "Card headings");
    await page.locator("#theme-step-3").scrollIntoViewIfNeeded();
    await toggle.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`titles-disabled-spacing-${width}.png`),
    });
  }
  await setEditorViewport(page, { width: 1440, height: 1080 });
  await expect(page.locator(".cell-heading").first()).toBeHidden();
  await expect
    .poll(() =>
      page
        .locator(".grid-cell")
        .first()
        .evaluate((card) => {
          const content = card
            .querySelector("[data-card-content]")
            .getBoundingClientRect();
          const image = card
            .querySelector("[data-card-image]")
            .getBoundingClientRect();
          return Math.abs(content.height - image.height);
        }),
    )
    .toBeLessThan(0.1);
  await reloadWorkspace(page);
  await openSidebarPanel(page, "Design");
  await openDesignSection(page, "Card headings");
  await expect(toggle).not.toBeChecked();
  await expect(cardControls).toHaveCount(0);
  await expect(titleColor).toHaveCount(0);
  await expect(titleOpacity).toHaveCount(0);
  await expect(page.locator(".cell-heading").first()).toBeHidden();
  await expect(page.locator(".cell-heading").first()).toHaveValue(title);
  await page.evaluate(() => {
    window.titleDrawing = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      ...parameters
    ) {
      window.titleDrawing.push(text);
      return original.call(this, text, ...parameters);
    };
  });
  await downloadBoard(page);
  expect(await page.evaluate(() => window.titleDrawing)).toEqual([]);
  await toggle.click();
  await openDesignSection(page, "Card headings", true);
  await expect(cardSettings.locator("#cell-font-size")).toHaveValue("20");
  await expect(titleColor).toHaveValue("#123456");
  await expect(titleOpacity).toHaveValue("37");
  await expect(page.locator(".cell-heading").first()).toBeVisible();
  await expect(page.locator(".cell-heading").first()).toHaveValue(title);
  await openSidebarPanel(page, "Images");
  await expect(page.locator(".library-heading")).toBeVisible();
  await expect(page.locator(".library-heading")).toHaveValue(title);
  await page.evaluate(() => {
    window.titleDrawing = [];
  });
  await downloadBoard(page);
  const exportedTitle = await page.evaluate(() => window.titleDrawing);
  expect(exportedTitle).toHaveLength(3);
  expect(exportedTitle.at(-1)).toMatch(/\u2026$/);
});

test("long imported filenames produce valid captions across reload", async ({
  page,
}) => {
  await page.goto("./");
  await selectField(page, "caption-position", "above");
  const title = "A".repeat(150);
  await page.locator("#replace-upload").setInputFiles({
    name: `${title}.svg`,
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await page.locator(".cell-image-button").first().press("Enter");
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  await expect(picker).toBeVisible();
  await picker
    .getByRole("button", { name: `Use ${title}`, exact: true })
    .click();
  await expect(picker).toHaveCount(0);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    title.slice(0, 120),
  );
  await reloadWorkspace(page);
  await expect(page.locator(".asset")).toHaveCount(1);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    title.slice(0, 120),
  );
  expect((await savedWorkspace(page)).assets[0].title).toBe(title);
});

test("failed guest saves roll back blobs and recover without blocking export", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.failGuestSaves = true;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "grids-settings-v1" && window.failGuestSaves)
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.goto("./");
  await expect(page.locator("#save-status")).toHaveText("Save failed");
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Local save failed",
  );
  await expect(page.locator("#save-status")).toBeHidden();
  await page.locator("#replace-upload").setInputFiles({
    name: "retry.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await chooseImage(page, "retry");
  await selectExportField(page, "resolution", "150");
  expect((await downloadBoard(page)).suggestedFilename()).toBe("grid.png");
  await expect(page.locator("#save-status")).toHaveText("Save failed");
  const failed = await localDatabase(page);
  expect(failed.document).toBeUndefined();
  expect(failed.images).toEqual([]);
  expect(
    await page.evaluate(() => localStorage.getItem("grids-settings-v1")),
  ).toBeNull();
  await page.evaluate(() => {
    window.failGuestSaves = false;
  });
  await page.locator(".cell-heading").first().fill("Recovered save");
  expect((await savedWorkspace(page)).assets).toHaveLength(1);
  await reloadWorkspace(page);
  await expect(page.locator(".asset")).toHaveCount(1);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Recovered save",
  );
});

test("unavailable IndexedDB leaves session editing and image exports usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = function () {
      throw new DOMException("Local database unavailable", "InvalidStateError");
    };
  });
  await page.goto("./");
  await expect(page.locator("#save-status")).toHaveText("Session only");
  await expect(page.locator("#save-status")).toBeHidden();
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Editing and exports remain available for this session.",
  );
  await page.locator("#replace-upload").setInputFiles({
    name: "session.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await chooseImage(page, "session");
  await selectExportField(page, "resolution", "150");
  expect((await downloadBoard(page)).suggestedFilename()).toBe("grid.png");
  await expect(page.locator("#save-status")).toHaveText("Session only");
});

test("fresh storage ignores obsolete prototypes and rejects invalid documents", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "gridroom-v1",
      JSON.stringify({
        boards: [{ name: "Old prototype" }],
        active: 0,
        assets: [],
      }),
    ),
  );
  await page.goto("./");
  expect((await savedWorkspace(page)).grid.name).toBe("Grid");
  for (const corruption of [
    "version",
    "cells",
    "references",
    "coordinates",
    "json",
  ]) {
    const saved = await savedWorkspace(page);
    if (corruption === "version") saved.version = 99;
    if (corruption === "cells") saved.grid.cells[1].id = saved.grid.cells[0].id;
    if (corruption === "references")
      saved.grid.cells[0].assetId = crypto.randomUUID();
    if (corruption === "coordinates") saved.grid.rows = 13;
    if (corruption === "json") {
      await localDatabase(page, "delete");
      await page.evaluate(() =>
        localStorage.setItem("grids-settings-v1", "{broken"),
      );
    } else await localDatabase(page, "write", saved);
    await reloadWorkspace(page);
    await expect(page.locator(".grid-cell")).toHaveCount(9);
    expect((await savedWorkspace(page)).grid.name).toBe("Grid");
  }
});

test("edge resizing discards removed data and preserves visible coordinates and edits", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await useComicExample(page);
  const savedCells = async () => (await savedWorkspace(page)).grid.cells;
  const originalWorkspace = await savedWorkspace(page);
  const original = originalWorkspace.grid.cells;
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(page.locator(".grid-cell")).toHaveCount(6);
  expect((await savedCells())[3].id).toBe(original[2].id);
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.locator(".cell-heading").nth(3).fill("Edit after resizing");
  await chooseImage(page, originalWorkspace.assets[0].title, 8);
  await page.locator(".cell-heading").nth(8).fill("Discard this row caption");
  await expect(page.getByRole("button", { name: /Undo/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Remove row", exact: true }).click();
  await expect(page.locator(".grid-cell")).toHaveCount(6);
  await expect(page.locator(".cell-heading").nth(3)).toHaveValue(
    "Edit after resizing",
  );
  await page
    .getByRole("button", { name: "Remove column", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove column", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove column", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Removed cells", exact: true }),
  ).toHaveCount(0);
  await reloadWorkspace(page);
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  const restored = await savedCells();
  expect(restored[0].id).toBe(original[0].id);
  expect(restored[2].id).toBe(original[2].id);
  for (const index of [1, 3]) {
    expect(restored[index]).toMatchObject({
      title: "",
      assetId: null,
      fit: "cover",
    });
    expect(restored[index].crop).toBeUndefined();
    expect(restored[index].id).not.toBe(original[index].id);
  }
  expect(restored[2].title).toBe("Edit after resizing");
  await page.getByRole("button", { name: "Remove row", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Remove row", exact: true }),
  ).toBeDisabled();
  await reloadWorkspace(page);
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  const expanded = await savedWorkspace(page);
  expect(expanded.assets).toEqual(originalWorkspace.assets);
  expect(expanded.grid.overflow).toEqual([]);
  expect(expanded.grid.cells[0]).toEqual(original[0]);
  for (const index of [2, 3]) {
    expect(expanded.grid.cells[index]).toMatchObject({
      title: "",
      assetId: null,
      fit: "cover",
    });
    expect(expanded.grid.cells[index].crop).toBeUndefined();
    await expect(page.locator(".cell-heading").nth(index)).toHaveValue("");
  }
  await page.screenshot({
    path: testInfo.outputPath("edge-controls-desktop.png"),
    fullPage: true,
  });
  await setEditorViewport(page, { width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("edge-controls-mobile.png"),
    fullPage: true,
  });
  const geometry = await page.evaluate(() => {
    const grid = document
      .querySelector("[data-preview-content]")
      .getBoundingClientRect();
    const frame = document
      .querySelector("[data-resize-frame]")
      .getBoundingClientRect();
    const columns = document
      .querySelector('[aria-label="Column controls"]')
      .getBoundingClientRect();
    const rows = document
      .querySelector('[aria-label="Row controls"]')
      .getBoundingClientRect();
    return {
      rowsBelowGrid: rows.top >= grid.bottom && rows.bottom <= frame.bottom,
      columnsBesideGrid:
        columns.left >= grid.right && columns.right <= frame.right,
      canvasControls:
        document.querySelector("[data-resize-frame]").dataset
          .controlsPlacement === "canvas",
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  expect(geometry).toEqual({
    rowsBelowGrid: true,
    columnsBesideGrid: true,
    canvasControls: true,
    overflow: false,
  });
});

test("uploads follow stable cells through resize and large exports are bounded", async ({
  page,
}) => {
  await page.goto("./");
  await useComicExample(page);
  await page.evaluate(() => {
    window.pendingImageDecodes = [];
    const original = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      const decoded = original.call(this);
      return this.src.startsWith("blob:")
        ? decoded.then(
            () =>
              new Promise((resolve) =>
                window.pendingImageDecodes.push(resolve),
              ),
          )
        : decoded;
    };
  });
  await (
    await beginCellUpload(page, 2)
  ).setInputFiles(
    path.join(projectRoot, "tests/fixtures/assets/DC - Kite Man.jpg"),
  );
  await expect
    .poll(() => page.evaluate(() => window.pendingImageDecodes.length))
    .toBe(1);
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await page.evaluate(() =>
    window.pendingImageDecodes.splice(0).forEach((resolve) => resolve()),
  );
  await expect(page.locator(".cell-heading").nth(3)).toHaveValue("DC Kite Man");
  await expect(page.locator(".cell-heading").nth(2)).toHaveValue("");
  await (
    await beginCellUpload(page, 2)
  ).setInputFiles(
    path.join(projectRoot, "tests/fixtures/assets/Marvel - Eye-Boy.jpg"),
  );
  await expect
    .poll(() => page.evaluate(() => window.pendingImageDecodes.length))
    .toBe(1);
  await page
    .getByRole("button", { name: "Remove column", exact: true })
    .click();
  await page.evaluate(() =>
    window.pendingImageDecodes.splice(0).forEach((resolve) => resolve()),
  );
  await expect(page.locator(".asset")).toHaveCount(10);
  expect(
    await page
      .locator(".cell-heading")
      .evaluateAll((cells) => cells.some((cell) => cell.value.includes("Eye"))),
  ).toBe(false);
  const saved = await savedWorkspace(page);
  const board = saved.grid;
  board.rows = 12;
  board.columns = 12;
  board.heading = "";
  board.gap = 12;
  board.canvasPadding = 12;
  board.overflow = [];
  board.cells = Array.from({ length: 144 }, () => ({
    id: crypto.randomUUID(),
    assetId: null,
    title: "",
    fit: "contain",
  }));
  await localDatabase(page, "write", saved);
  await reloadWorkspace(page);
  await expect(
    page.getByRole("button", { name: "Add row", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Add column", exact: true }),
  ).toBeDisabled();
  await selectExportField(page, "resolution", "600");
  await page
    .getByRole("button", { name: "Download image", exact: true })
    .click();
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Export exceeds the 32 MP limit",
  );
  await selectExportField(page, "resolution", "150");
  const download = await downloadBoard(page);
  const bytes = [...(await readFile(await download.path()))];
  const size = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    );
    const result = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return result;
  }, bytes);
  expect(size).toEqual({ width: 1839, height: 2439 });
});

test("PWA updates activate without reloading an unsaved or focused caption", async ({
  page,
}, testInfo) => {
  const dist = path.join(projectRoot, "dist");
  const directory = testInfo.outputPath("pwa-worker");
  await mkdir(directory, { recursive: true });
  const { manifestEntries } = await getManifest({
    globDirectory: dist,
    globPatterns: ["**/*.{html,js,css,woff2,png,svg}"],
    globIgnores: ["sw.js", "workbox-*.js"],
    dontCacheBustURLsMatching: /-[A-Za-z0-9_-]{8}\.(?:js|css)$/,
  });
  let worker;
  const deploy = async (version) => {
    await generateSW({
      swDest: path.join(directory, "sw.js"),
      globDirectory: directory,
      globPatterns: [],
      additionalManifestEntries: manifestEntries.map((entry) =>
        entry.url === "index.html"
          ? { ...entry, revision: `release-${version}` }
          : entry,
      ),
      skipWaiting: true,
      clientsClaim: true,
      navigateFallback: "index.html",
    });
    worker = Buffer.concat([
      await readFile(path.join(directory, "sw.js")),
      Buffer.from(
        `\nself.addEventListener("message", event => { if (event.data === "release") event.ports[0].postMessage(${version}); });`,
      ),
    ]);
  };
  await deploy(1);
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (!pathname.startsWith("/grids/")) {
        response.writeHead(404).end();
        return;
      }
      const filename =
        decodeURIComponent(pathname.slice("/grids/".length)) || "index.html";
      const content =
        filename === "sw.js"
          ? worker
          : await readFile(
              path.join(
                filename.startsWith("workbox-") ? directory : dist,
                filename,
              ),
            );
      const extension = path.extname(filename);
      const contentType =
        {
          ".js": "application/javascript",
          ".html": "text/html",
          ".css": "text/css",
          ".woff2": "font/woff2",
          ".png": "image/png",
          ".svg": "image/svg+xml",
          ".webmanifest": "application/manifest+json",
        }[extension] ?? "application/octet-stream";
      response
        .writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "max-age=31536000",
        })
        .end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    await page.addInitScript(() =>
      localStorage.setItem(
        "test-boots",
        String(Number(localStorage.getItem("test-boots") ?? 0) + 1),
      ),
    );
    await page.goto(`http://localhost:${server.address().port}/grids/`);
    await expect(page.locator("#save-status")).toHaveAttribute(
      "data-save-state",
      "saved",
    );
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      )
      .toBe(true);
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.ready).updateViaCache,
      ),
    ).toBe("none");
    const release = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = (event) => {
              channel.port1.close();
              resolve(event.data);
            };
            navigator.serviceWorker.controller.postMessage("release", [
              channel.port2,
            ]);
          }),
      );
    expect(await release()).toBe(1);
    await uploadCellImage(page);
    await savedWorkspace(page);
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const caption = page.locator(".cell-heading").first();
    await caption.fill("Keep this edit through update");
    await expect(page.locator("#save-status")).toHaveAttribute(
      "data-save-state",
      "saving",
    );
    await deploy(2);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(release).toBe(2);
    expect(await page.evaluate(() => localStorage.getItem("test-boots"))).toBe(
      "1",
    );
    await expect(caption).toBeFocused();
    await caption.blur();
    expect(await page.evaluate(() => localStorage.getItem("test-boots"))).toBe(
      "1",
    );
    await expect(page.locator("#save-status")).toHaveAttribute(
      "data-save-state",
      "saving",
    );
    const reloaded = page.waitForEvent("load");
    await page.clock.resume();
    await reloaded;
    expect(await page.evaluate(() => localStorage.getItem("test-boots"))).toBe(
      "2",
    );
    await expect(page.locator(".cell-heading").first()).toHaveValue(
      "Keep this edit through update",
    );
    expect(await release()).toBe(2);
    expect((await savedWorkspace(page)).grid.cells[0].title).toBe(
      "Keep this edit through update",
    );
  } finally {
    await page.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

touchTest(
  "phone app manifest and offline launch preserve images, edits and export",
  async ({ page, context }, testInfo) => {
    await page.goto("./");
    await expect(page.locator(".grid-cell")).toHaveCount(9);
    const emptyImage = page.getByRole("button", {
      name: "Add image to cell 1",
      exact: true,
    });
    await expect(emptyImage).toBeVisible();
    await expect(emptyImage.getByText("Drop here")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    const manifestUrl = await page
      .locator('link[rel="manifest"]')
      .evaluate((element) => element.href);
    const appUrl = new URL("./", page.url()).href;
    expect(manifestUrl).toBe(`${appUrl}manifest.webmanifest`);
    const response = await page.request.get(manifestUrl);
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest).toMatchObject({
      name: "Gridz",
      short_name: "Gridz",
      display: "standalone",
    });
    for (const key of ["id", "start_url", "scope"])
      expect(new URL(manifest[key], manifestUrl).href).toBe(appUrl);
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual([
      "192x192",
      "512x512",
    ]);
    for (const icon of manifest.icons) {
      const dimensions = await page.evaluate(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Missing install icon: ${url}`);
        const bitmap = await createImageBitmap(await response.blob());
        const dimensions = `${bitmap.width}x${bitmap.height}`;
        bitmap.close();
        return dimensions;
      }, new URL(icon.src, manifestUrl).href);
      expect(dimensions).toBe(icon.sizes);
    }
    await expect(
      page.locator('meta[name="apple-mobile-web-app-capable"]'),
    ).toHaveAttribute("content", "yes");
    const registration = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return {
        scope: registration.scope,
        script: registration.active.scriptURL,
      };
    });
    expect(registration).toEqual({ scope: appUrl, script: `${appUrl}sw.js` });
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      )
      .toBe(true);
    const session = await context.newCDPSession(page);
    const installability = await session.send("Page.getInstallabilityErrors");
    expect(installability.installabilityErrors).toEqual([]);
    await session.detach();
    const input = await beginCellUpload(page, 0);
    await input.setInputFiles({
      name: "Offline image.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    });
    await expect(
      page.getByRole("dialog", { name: "Choose image", exact: true }),
    ).toHaveCount(0);
    const card = page.locator(".grid-cell").first();
    await expect(card.locator("img")).toBeVisible();
    await editHeading(page, "Offline board");
    await card.locator(".cell-heading").fill("Local caption");
    await expect
      .poll(async () => (await savedWorkspace(page)).grid.cells[0].title)
      .toBe("Local caption");
    const original = await localDatabase(page);
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("button", {
        name: "Edit grid heading: Offline board",
        exact: true,
      }),
    ).toBeVisible();
    await expect(card.locator(".cell-heading")).toHaveValue("Local caption");
    await expect
      .poll(() =>
        card
          .locator("img")
          .evaluate((image) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await card.locator(".cell-heading").fill("Offline edit");
    await expect
      .poll(async () => (await savedWorkspace(page)).grid.cells[0].title)
      .toBe("Offline edit");
    expect((await localDatabase(page)).images).toEqual(original.images);
    await selectExportField(page, "resolution", "150");
    const download = await downloadBoard(page);
    const bytes = await readFile(await download.path());
    expect([...bytes.subarray(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    await page.screenshot({ path: testInfo.outputPath("phone-offline.png") });
  },
);

test("page metadata assets resolve and desktop library keeps mouse dragging", async ({
  page,
}, testInfo) => {
  await setEditorViewport(page, { width: 1440, height: 1080 });
  await page.goto("./");
  await page.locator("#upload").setInputFiles(
    Array.from({ length: 2 }, (_, index) => ({
      name: `Image ${index}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  await expect(page.locator(".asset")).toHaveCount(2);

  await expect(
    page.getByRole("button", { name: "Move Image 0", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator("[data-library-thumbnail]").first(),
  ).toHaveAttribute("draggable", "true");
  await openSidebarPanel(page, "Images");
  await page
    .locator("[data-library-thumbnail]")
    .first()
    .dragTo(page.locator(".cell-image-button").first());
  await openSidebarPanel(page, "Design");
  await expect(
    page.locator(".grid-cell").first().locator("img"),
  ).toHaveAttribute("alt", "Image 0");
  await expect(page).toHaveTitle("Gridz");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /Create image grids/,
  );
  for (const [selector, content] of [
    ['meta[name="apple-mobile-web-app-title"]', "Gridz"],
    ['meta[property="og:site_name"]', "Gridz"],
    ['meta[property="og:title"]', "Gridz"],
    ['meta[name="twitter:title"]', "Gridz"],
    [
      'meta[property="og:image:alt"]',
      "Gridz: four lime tiles on a dark background",
    ],
    [
      'meta[name="twitter:image:alt"]',
      "Gridz: four lime tiles on a dark background",
    ],
  ]) {
    await expect(page.locator(selector)).toHaveAttribute("content", content);
  }
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://gridz.pages.dev/",
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://gridz.pages.dev/assets/grids-icon.png",
  );
  for (const relation of ["icon", "apple-touch-icon"]) {
    const url = await page
      .locator(`link[rel="${relation}"]`)
      .evaluate((element) => element.href);
    expect(new URL(url).pathname).toMatch(
      /^\/grids\/assets\/grids-icon\.(svg|png)$/,
    );
    const response = await page.request.get(url);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toMatch(/image\/(svg\+xml|png)/);
  }
  await page.screenshot({ path: testInfo.outputPath("library-desktop.png") });
});

test("image picker keeps uploads reachable and separates deletion from placement", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles(
    Array.from({ length: 8 }, (_, index) => ({
      name: `Grid ${index}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  await expect(page.locator(".asset")).toHaveCount(8);
  await page.locator(".cell-image-button").first().click();
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  const panel = picker.locator('[id^="headlessui-dialog-panel"]');
  await expect(picker.locator("#picker-image-source")).toHaveCount(0);
  await expect(
    picker.getByRole("region", { name: "My images", exact: true }),
  ).toBeVisible();
  await expect(picker.getByRole("tab", { name: /Choose|Library/ })).toHaveCount(
    0,
  );
  await expect(
    picker.getByRole("button", { name: "Delete items", exact: true }),
  ).toHaveCount(0);
  await expect(
    picker.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(0);
  for (const thumbnail of await picker
    .locator("[data-library-thumbnail]")
    .all()) {
    await expect(thumbnail).toHaveAttribute("draggable", "false");
  }
  for (const width of [320, 390, 780, 832, 1440]) {
    await setEditorViewport(page, { width, height: 1080 });
    await expect(panel).toBeInViewport();
    expect(
      await panel.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left >= 0 &&
          bounds.right <= innerWidth &&
          element.scrollWidth <= element.clientWidth
        );
      }),
    ).toBe(true);
    await expect(picker.locator("[data-library-image]")).toHaveCount(8);
    const lastImage = picker.getByRole("button", {
      name: "Use Grid 7",
      exact: true,
    });
    await lastImage.scrollIntoViewIfNeeded();
    await expect(lastImage).toBeInViewport();
  }
  await picker.getByRole("button", { name: "Use Grid 7", exact: true }).hover();
  await picker
    .getByRole("button", { name: "Delete image", exact: true })
    .click();
  await expect(picker.locator("[data-library-image]")).toHaveCount(7);
  await expect(page.locator(".grid-cell").first().locator("img")).toHaveCount(
    0,
  );
  await picker.getByRole("button", { name: "Use Grid 0", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(
    page.locator(".grid-cell").first().locator("img"),
  ).toHaveAttribute("alt", "Grid 0");
});

touchTest(
  "mobile picker keeps individual image selection without bulk-clear controls",
  async ({ page }, testInfo) => {
    await page.goto("./");
    const openPicker = async () => {
      await page
        .locator(".cell-image-button")
        .first()
        .tap({ position: { x: 5, y: 5 } });
      if (await page.locator(".grid-cell").first().locator("img").count())
        await page
          .getByRole("button", { name: "Replace image", exact: true })
          .tap();
      await expect(
        page.getByRole("dialog", { name: "Choose image", exact: true }),
      ).toBeVisible();
    };
    await openPicker();
    const picker = page.getByRole("dialog", {
      name: "Choose image",
      exact: true,
    });
    const chooserReady = page.waitForEvent("filechooser");
    await picker.getByRole("button", { name: "Add images", exact: true }).tap();
    await (
      await chooserReady
    ).setFiles(
      Array.from({ length: 3 }, (_, index) => ({
        name: `Picker ${index}.svg`,
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
        ),
      })),
    );
    await expect(picker.getByRole("img")).toHaveCount(3);
    await expect(page.locator(".grid-cell img")).toHaveCount(0);
    await page.evaluate(() => {
      window.__pickerTapTrace = { syntheticClicks: 0, thumbnailFocus: 0 };
      window.__pickerOriginalClick = HTMLElement.prototype.click;
      HTMLElement.prototype.click = function () {
        if (this.matches("[data-library-thumbnail]"))
          window.__pickerTapTrace.syntheticClicks++;
        return window.__pickerOriginalClick.call(this);
      };
      window.__pickerFocusListener = (event) => {
        if (event.target.matches("[data-library-thumbnail]"))
          window.__pickerTapTrace.thumbnailFocus++;
      };
      document.addEventListener("focusin", window.__pickerFocusListener);
    });
    await picker
      .getByRole("button", { name: "Use Picker 0", exact: true })
      .tap();
    await expect(picker).toHaveCount(0);
    await expect(
      page.locator(".grid-cell").first().locator("img"),
    ).toHaveAttribute("alt", "Picker 0");
    await expect(page.locator(".grid-cell img")).toHaveCount(1);
    const tapTrace = await page.evaluate(() => {
      HTMLElement.prototype.click = window.__pickerOriginalClick;
      document.removeEventListener("focusin", window.__pickerFocusListener);
      const trace = window.__pickerTapTrace;
      delete window.__pickerOriginalClick;
      delete window.__pickerFocusListener;
      delete window.__pickerTapTrace;
      return trace;
    });
    expect(tapTrace).toEqual({ syntheticClicks: 0, thumbnailFocus: 0 });
    await page.screenshot({
      path: testInfo.outputPath("picker-after-touch-selection.png"),
    });
    await openPicker();
    await setEditorViewport(page, { width: 390, height: 360 });
    const scrollFrame = picker.locator("[data-modal-scroll]");
    const thumbnail = picker.getByRole("button", {
      name: "Use Picker 0",
      exact: true,
    });
    await expect(thumbnail).toHaveCSS("touch-action", "auto");
    await thumbnail.scrollIntoViewIfNeeded();
    const thumbnailBounds = await thumbnail.boundingBox();
    const frameBounds = await scrollFrame.boundingBox();
    const initialScroll = await scrollFrame.evaluate(
      (element) => element.scrollTop,
    );
    const touch = await page.context().newCDPSession(page);
    const startX = thumbnailBounds.x + thumbnailBounds.width / 2;
    const startY = Math.min(
      thumbnailBounds.y + thumbnailBounds.height - 12,
      frameBounds.y + frameBounds.height - 20,
    );
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y: startY }],
    });
    for (let step = 1; step <= 6; step++) {
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: startX, y: startY - step * 20 }],
      });
    }
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await touch.detach();
    await expect
      .poll(() => scrollFrame.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(initialScroll);
    await expect(picker).toBeVisible();
    await expect(
      page.locator(".grid-cell").first().locator("img"),
    ).toHaveAttribute("alt", "Picker 0");
    await setEditorViewport(page, { width: 390, height: 844 });
    await expect(picker.getByRole("img")).toHaveCount(3);
    await expect(
      picker.getByRole("tab", { name: "Library", exact: true }),
    ).toHaveCount(0);
    for (const thumbnail of await picker
      .locator("[data-library-thumbnail]")
      .all()) {
      await expect(thumbnail).toHaveAttribute("draggable", "false");
    }
    await expect(
      picker.getByRole("button", { name: "Delete items", exact: true }),
    ).toHaveCount(0);
    await expect(picker.getByRole("checkbox")).toHaveCount(0);
    await picker
      .getByRole("button", { name: "Use Picker 2", exact: true })
      .tap({ position: { x: 5, y: 5 } });
    await expect(picker).toHaveCount(0);
    await expect(
      page.locator(".grid-cell").first().locator("img"),
    ).toHaveAttribute("alt", "Picker 2");
    await openPicker();
    await expect(
      picker.getByRole("button", {
        name: "Clear images",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("picker-library-mobile.png"),
    });
    await expect(picker.getByRole("img")).toHaveCount(3);
    await expect(picker.getByText("No images yet.")).toHaveCount(0);
    await expect(picker.locator("[data-upload-tile]")).toBeVisible();
    await expect(
      page.locator(".grid-cell").first().locator("img"),
    ).toHaveAttribute("alt", "Picker 2");
    await picker
      .getByRole("button", { name: "Close dialog", exact: true })
      .tap();
    await expect(picker).toHaveCount(0);
    await reloadWorkspace(page);
    await expect(
      page.locator(".grid-cell").first().locator("img"),
    ).toHaveAttribute("alt", "Picker 2");
  },
);

test("library cards support mouse and touch copying on touch-capable desktops", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("./");
  await page.locator("#upload").setInputFiles(
    ["Library A", "Library B"].map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  const images = page.locator("#asset-library [data-library-thumbnail]");
  const cells = page.locator(".grid-cell");
  await expect(images).toHaveCount(2);
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
  ).toBe(true);
  await expect(images.first()).toHaveAttribute("draggable", "true");
  const checkFloatingSize = async () => {
    const boardCard = await cells.first().boundingBox();
    const size = await page
      .locator("[data-drag-floating]")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          width: parseFloat(style.width),
          height: parseFloat(style.height),
        };
      });
    expect(size.width).toBeCloseTo(boardCard.width, 1);
    expect(size.height).toBeCloseTo(boardCard.height, 1);
  };
  const checkDropFeedback = async (index) => {
    const target = cells.nth(index);
    await expect(target).toHaveClass(/drag-over/);
    await expect(target.locator("[data-card-content]")).toHaveCSS(
      "opacity",
      "0.35",
    );
    const colors = await target.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        drop: style.getPropertyValue("--card-drop-color").trim(),
        hover: style.getPropertyValue("--card-frame-hover-color").trim(),
      };
    });
    expect(colors.drop).toBe(colors.hover);
    const frame = target.locator("[data-cell-image-frame]");
    await expect(frame).toHaveCSS("opacity", "1");
    await expect
      .poll(() =>
        frame.evaluate((element) => {
          const context = document.createElement("canvas").getContext("2d");
          context.fillStyle = getComputedStyle(element).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return context.getImageData(0, 0, 1, 1).data[3] / 255;
        }),
      )
      .toBeCloseTo(0.25, 2);
  };
  const mouseCopy = async () => {
    const sourceBounds = await images.first().boundingBox();
    const targetBounds = await cells.first().boundingBox();
    await page.mouse.move(sourceBounds.x + 8, sourceBounds.y + 8);
    await page.mouse.down();
    await page.mouse.move(sourceBounds.x + 24, sourceBounds.y + 8, {
      steps: 5,
    });
    await expect(page.locator("[data-drag-floating]")).toBeVisible();
    await checkFloatingSize();
    await page.mouse.move(targetBounds.x + 10, targetBounds.y + 10, {
      steps: 5,
    });
    await page.mouse.move(targetBounds.x + 12, targetBounds.y + 12, {
      steps: 2,
    });
    await checkDropFeedback(0);
    await page.mouse.move(
      targetBounds.x + targetBounds.width * 0.75,
      targetBounds.y + targetBounds.height * 0.5,
      { steps: 5 },
    );
    await page.screenshot({
      path: testInfo.outputPath(
        `drop-tint-${await page.evaluate(() => innerWidth)}.png`,
      ),
    });
    await page.mouse.up();
  };
  await mouseCopy();
  await expect(cells.nth(0).locator("img")).toHaveAttribute("alt", "Library A");
  await expect(images).toHaveCount(2);
  const session = await context.newCDPSession(page);
  const touchCopy = async (targetIndex, cancel = false) => {
    await images.nth(1).tap();
    const handle = page
      .locator("#asset-library .asset")
      .nth(1)
      .getByRole("button", { name: "Drag image", exact: true });
    await expect(handle).toBeVisible();
    const source = await handle.boundingBox();
    const start = {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    };
    const target = await cells
      .nth(targetIndex)
      .locator(".cell-image-button")
      .boundingBox();
    const end = { x: target.x + 10, y: target.y + 10 };
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...start, id: 1 }],
    });
    for (let step = 1; step <= 8; step++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: start.x + ((end.x - start.x) * step) / 8,
            y: start.y + ((end.y - start.y) * step) / 8,
            id: 1,
          },
        ],
      });
      if (step === 1) {
        await expect(page.locator("[data-drag-floating]")).toBeVisible();
        await checkFloatingSize();
      }
    }
    await expect(page.locator("[data-drag-floating]")).toBeVisible();
    await checkDropFeedback(targetIndex);

    await session.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
    await expect(page.locator("[data-drag-floating]")).toHaveCount(0);
  };
  await touchCopy(1);
  await expect(cells.nth(1).locator("img")).toHaveAttribute("alt", "Library B");
  await expect(images).toHaveCount(2);
  await touchCopy(2, true);
  await expect(cells.nth(2).locator("img")).toHaveCount(0);
  await images.nth(1).tap({ position: { x: 5, y: 5 } });
  await expect(
    page.getByRole("button", { name: "Delete image", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("touch-library-card.png"),
  });
  await setEditorViewport(page, { width: 780, height: 720 });
  await expect(page.locator('[data-editor-layout="bottom"]')).toBeVisible();
  await expect(page.locator("#asset-library")).toHaveCount(1);
  await mouseCopy();
  await touchCopy(2);
  await expect(cells.nth(2).locator("img")).toHaveAttribute("alt", "Library B");
  await expect(images).toHaveCount(2);
  await page.screenshot({
    path: testInfo.outputPath("bottom-library-board-sized-drag.png"),
  });
  await session.detach();
  await context.close();
});

test("touch cards toggle tools and drag moves swaps and cancels without opening picker", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 780, height: 1080 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("./");
  const cells = page.locator(".grid-cell");
  const imageButton = (index) => cells.nth(index).locator(".cell-image-button");
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  await imageButton(1).tap();
  await picker.locator("#picker-cell-upload").setInputFiles(
    ["Touch A", "Touch B"].map((name, index) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${index ? "#f26365" : "#40b4aa"}"/></svg>`,
      ),
    })),
  );
  await expect(picker).toBeVisible();
  await expect(cells.locator("img")).toHaveCount(0);
  await picker.getByRole("button", { name: "Use Touch B", exact: true }).tap();
  await expect(picker).toHaveCount(0);
  await expect(cells.nth(0).locator("img")).toHaveCount(0);
  await expect(cells.nth(1).locator("img")).toHaveAttribute("alt", "Touch B");
  await imageButton(0).tap();
  await picker.getByRole("button", { name: "Use Touch A", exact: true }).tap();
  await expect(picker).toHaveCount(0);
  await expect(cells.nth(0).locator("img")).toHaveAttribute("alt", "Touch A");
  await expect(cells.nth(1).locator("img")).toHaveAttribute("alt", "Touch B");
  const tools = cells
    .nth(0)
    .getByRole("group", { name: "Cell tools", exact: true });
  const session = await context.newCDPSession(page);
  await imageButton(0).tap();
  await expect(tools).toBeVisible();
  await expect(picker).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input, textarea"),
    ),
  ).toBe(false);
  await imageButton(0).tap();
  await expect(tools).toHaveCount(0);
  await imageButton(0).tap();
  await tools.getByRole("button", { name: "Replace image", exact: true }).tap();
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "Use Touch A", exact: true }).tap();
  await expect(picker).toHaveCount(0);
  const drag = async (sourceIndex, targetIndex, cancel = false) => {
    const handle = cells
      .nth(sourceIndex)
      .getByRole("button", { name: "Drag image", exact: true });
    if (!(await handle.isVisible())) await imageButton(sourceIndex).tap();
    await expect(handle).toBeVisible();

    const source = await handle.boundingBox();
    const target = await imageButton(targetIndex).boundingBox();
    const start = {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    };
    const end = { x: target.x + 10, y: target.y + 10 };
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...start, id: 1 }],
    });
    for (let step = 1; step <= 8; step++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: start.x + ((end.x - start.x) * step) / 8,
            y: start.y + ((end.y - start.y) * step) / 8,
            id: 1,
          },
        ],
      });
    }
    await expect(page.locator("[data-drag-floating]")).toBeVisible();

    const floating = page.locator("[data-drag-floating]");
    await expect(floating).toHaveCSS("left", "0px");
    await expect(floating).toHaveCSS("top", "0px");
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const originalTransform = await floating.evaluate(
      (element) => getComputedStyle(element).transform,
    );
    await page.evaluate(() => {
      window.__dragLayoutReads = 0;
      window.__dragOriginalBounds = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        if (
          this.matches(
            ".image-card, .cell-heading, .library-heading, .drag-preview-heading",
          )
        )
          window.__dragLayoutReads++;
        return window.__dragOriginalBounds.call(this);
      };
    });
    for (let step = 1; step <= 5; step++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: end.x + step * 3, y: end.y + step * 3, id: 1 }],
      });
    }
    await expect
      .poll(() =>
        floating.evaluate((element) => getComputedStyle(element).transform),
      )
      .not.toBe(originalTransform);
    const layoutReads = await page.evaluate(() => {
      Element.prototype.getBoundingClientRect = window.__dragOriginalBounds;
      const reads = window.__dragLayoutReads;
      delete window.__dragLayoutReads;
      delete window.__dragOriginalBounds;
      return reads;
    });
    expect(layoutReads).toBe(0);
    if (sourceIndex === 0 && targetIndex === 2)
      await page.screenshot({
        path: testInfo.outputPath("touch-drag-transform-preview.png"),
      });

    await session.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
    await expect(page.locator("[data-drag-floating]")).toHaveCount(0);
    await expect(page.locator(".grid-cell.drag-over")).toHaveCount(0);
    await expect(picker).toHaveCount(0);
    await expect(
      page.getByRole("group", { name: "Cell tools", exact: true }),
    ).toHaveCount(0);
  };
  await imageButton(0).tap();
  await drag(0, 2);
  await expect(cells.nth(0).locator("img")).toHaveCount(0);
  await expect(cells.nth(2).locator("img")).toHaveAttribute("alt", "Touch A");
  await drag(2, 1);
  await expect(cells.nth(1).locator("img")).toHaveAttribute("alt", "Touch A");
  await expect(cells.nth(2).locator("img")).toHaveAttribute("alt", "Touch B");
  await drag(1, 0, true);
  await expect(cells.nth(0).locator("img")).toHaveCount(0);
  await expect(cells.nth(1).locator("img")).toHaveAttribute("alt", "Touch A");
  await imageButton(1).tap();
  await expect(
    cells.nth(1).getByRole("group", { name: "Cell tools", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("touch-card-tools.png") });
  await reloadWorkspace(page);
  await expect(cells.nth(1).locator("img")).toHaveAttribute("alt", "Touch A");
  await expect(cells.nth(2).locator("img")).toHaveAttribute("alt", "Touch B");
  await setEditorViewport(page, { width: 780, height: 540 });

  await expect(
    cells.getByRole("button", { name: "Drag image", exact: true }),
  ).toHaveCount(0);
  const originalGrid = (await savedWorkspace(page)).grid;
  const body = await imageButton(1).boundingBox();
  const start = {
    x: body.x + body.width / 2,
    y: body.y + Math.min(body.height - 12, 140),
  };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...start, id: 1 }],
  });
  for (let step = 1; step <= 8; step++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: start.x, y: start.y - (120 * step) / 8, id: 1 }],
    });
    await expect(page.locator("[data-drag-floating]")).toHaveCount(0);
  }
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() =>
      page
        .locator("[data-workspace-scroll]")
        .evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(0);
  expect((await savedWorkspace(page)).grid).toEqual(originalGrid);
  await session.detach();
  await context.close();
});
