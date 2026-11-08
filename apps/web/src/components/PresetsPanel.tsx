import {
  RectangleVertical,
  RectangleHorizontal,
  Square,
  PanelTop,
  PanelBottom,
  PanelTopDashed,
  PanelBottomDashed,
} from "lucide-react";
import { useRef, type ReactNode } from "react";
import { Disclosure, Radio, RadioGroup } from "@headlessui/react";
import { AnimatePresence } from "motion/react";
import {
  colorPalettes as palettes,
  colorPaletteStyle,
  fontOptions,
  fontWeightOptions,
  resolveFontWeight,
  type Board,
} from "../model";
import { t } from "../i18n";
import {
  AccordionPanel,
  ChoiceButton,
  DisclosureChevron,
  DisclosureTrigger,
  IconRadioField,
  PercentField,
  SelectField,
  Toggle,
} from "./ui/controls";

function revealAccordion(accordion: HTMLElement) {
  let scroller = accordion.parentElement;
  while (
    scroller &&
    !/^(auto|scroll)$/.test(getComputedStyle(scroller).overflowY)
  ) {
    scroller = scroller.parentElement;
  }
  if (!scroller) return;
  const bounds = scroller.getBoundingClientRect();
  const sticky = scroller.querySelector<HTMLElement>(
    ":scope > [data-sidebar-sticky]",
  );
  const padding = getComputedStyle(
    accordion.closest<HTMLElement>("[data-sidebar-panels]") ?? scroller,
  );
  const top =
    Math.max(
      bounds.top + scroller.clientTop,
      sticky?.getBoundingClientRect().bottom ?? bounds.top,
    ) + parseFloat(padding.paddingTop);
  const bottom =
    bounds.top +
    scroller.clientTop +
    scroller.clientHeight -
    parseFloat(padding.paddingBottom);
  const content = accordion.getBoundingClientRect();
  const available = bottom - top;
  const delta =
    content.height > available || content.top < top
      ? content.top - top
      : content.bottom > bottom
        ? content.bottom - bottom
        : 0;
  if (delta !== 0) scroller.scrollTop += delta;
}

function revealDesignPanel(panel: HTMLDivElement) {
  const accordion = panel.closest<HTMLElement>("[data-design-accordion]");
  if (accordion) revealAccordion(accordion);
}

export function FontWeightField({
  id,
  font,
  value,
  onChange,
}: {
  id: string;
  font: Board["headingFont"];
  value?: number;
  onChange: (weight: number) => void;
}) {
  const weight = resolveFontWeight(font, value);
  return (
    <PercentField
      id={id}
      label={t("settings.fields.fontWeight")}
      outputId={`${id}-value`}
      outputValue={weight}
      min={font === "Manrope" ? 100 : 400}
      max={font === "Manrope" ? 900 : 700}
      step={font === "Manrope" ? 100 : 300}
      value={weight}
      valueText={
        fontWeightOptions(font).find((option) => option.value === weight)?.label
      }
      onChange={onChange}
    />
  );
}

export function ThemeBuilder({
  board,
  disabled,
  onChange,
  children,
}: {
  board: Board;
  disabled: boolean;
  onChange: (patch: Partial<Board>) => void;
  children: [ReactNode, ReactNode, ReactNode, ReactNode];
}) {
  const closeSection = useRef<((focus?: HTMLElement) => void) | null>(null);
  const selectedPalette = palettes.find(
    (palette) =>
      board.background.toLowerCase() === palette.background &&
      board.cellBackgroundColor?.toLowerCase() === palette.surface &&
      board.headingBackgroundColor?.toLowerCase() === palette.background &&
      board.headingTextColor?.toLowerCase() === palette.text &&
      board.cellTextColor?.toLowerCase() === palette.text &&
      (board.cardBorderColor ?? palette.text).toLowerCase() === palette.text &&
      board.captionOverlayColor?.toLowerCase() === palette.overlay,
  );
  const appliedPalette =
    selectedPalette ??
    palettes.find((palette) => palette.name === board.colorTheme);
  const colorsModified = !selectedPalette;
  const applyPalette = (name: string) => {
    const style = colorPaletteStyle(name);
    if (style) onChange(style);
  };
  const steps = [
    {
      title: t("builder.colors"),
      summary: appliedPalette
        ? colorsModified
          ? t("builder.modifiedNamed", {
              value1: t(`builder.palettes.${appliedPalette.name}`),
            })
          : t(`builder.palettes.${appliedPalette.name}`)
        : t("builder.custom"),
    },
    {
      title: t("builder.layout"),
      summary: t(`editor.imageShape.${board.imageAspect ?? "square"}`),
    },
    {
      title: t("builder.heading"),
      summary: board.headingVisible ? board.headingFont : t("builder.off"),
    },
    {
      title: t("builder.captions"),
      summary:
        board.titlesVisible !== false ? board.cellFont : t("builder.off"),
    },
  ];
  return (
    <section
      aria-label={t("presets.title")}
      data-theme-builder
      className="@container/themes flex min-w-0 flex-col"
    >
      {steps.map((item, index) => (
        <Disclosure
          as="section"
          key={item.title}
          defaultOpen={index === 0}
          data-design-accordion
          className="min-w-0 border-0 border-b border-solid border-ui-border last:border-b-0"
        >
          {({ open, close }) => (
            <>
              <h3 className="m-0 text-sm">
                <DisclosureTrigger
                  ref={(element: HTMLButtonElement | null) => {
                    if (element && open) closeSection.current = close;
                  }}
                  type="button"
                  onClick={(event) => {
                    if (!open) {
                      closeSection.current?.(event.currentTarget);
                      closeSection.current = close;
                    }
                  }}
                >
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${open ? "bg-ui-accent text-ui-background" : "bg-ui-selected text-ui-muted"}`}
                  >
                    {index + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span>{item.title}</span>
                    <span className="truncate text-xs font-normal text-ui-muted">
                      {item.summary}
                    </span>
                  </span>
                  <span className="pointer-events-none absolute inset-y-0 right-0 flex aspect-square items-center justify-center">
                    <DisclosureChevron open={open} />
                  </span>
                </DisclosureTrigger>
              </h3>
              <AnimatePresence initial={false}>
                {open && (
                  <AccordionPanel key="panel" onReveal={revealDesignPanel}>
                    <fieldset
                      id={`theme-step-${index}`}
                      disabled={disabled}
                      className="m-0 flex min-w-0 flex-col gap-4 border-0 p-3"
                    >
                      {index === 0 && (
                        <RadioGroup
                          value={appliedPalette?.name ?? ""}
                          onChange={applyPalette}
                          aria-label={t("builder.colors")}
                          className="grid grid-cols-1 gap-2 @min-[224px]/themes:grid-cols-2 @min-[328px]/themes:grid-cols-3 @min-[480px]/themes:grid-cols-4"
                        >
                          {palettes.map((palette) => (
                            <Radio
                              as={ChoiceButton}
                              key={palette.name}
                              type="button"
                              value={palette.name}
                              disabled={selectedPalette === palette}
                              onClick={() => {
                                if (
                                  appliedPalette === palette &&
                                  colorsModified
                                )
                                  applyPalette(palette.name);
                              }}
                              onKeyDown={(event) => {
                                if (
                                  appliedPalette === palette &&
                                  colorsModified &&
                                  (event.key === " " || event.key === "Enter")
                                ) {
                                  event.preventDefault();
                                  applyPalette(palette.name);
                                }
                              }}
                              title={t(`builder.palettes.${palette.name}`)}
                              className="group flex min-h-18 min-w-0 flex-col items-center gap-2 rounded-md border border-solid border-ui-border bg-transparent! p-2! text-xs! aria-checked:border-ui-border! aria-checked:bg-ui-selected! [--control-hover-base:var(--panel)] enabled:data-hover:not-aria-checked:control-hover! focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-accent disabled:opacity-100!"
                            >
                              <span
                                aria-hidden="true"
                                className="flex h-7 w-full overflow-hidden rounded-sm"
                              >
                                <span
                                  className="flex-1"
                                  style={{
                                    backgroundColor: palette.background,
                                  }}
                                />
                                <span
                                  className="flex-1"
                                  style={{ backgroundColor: palette.surface }}
                                />
                                <span
                                  className="w-3"
                                  style={{ backgroundColor: palette.text }}
                                />
                              </span>
                              <span>
                                {t(`builder.palettes.${palette.name}`)}
                              </span>
                            </Radio>
                          ))}
                        </RadioGroup>
                      )}
                      {index === 1 && (
                        <>
                          <IconRadioField
                            id="image-shape"
                            label={t("editor.imageShape.label")}
                            value={board.imageAspect ?? "square"}
                            columns={3}
                            options={[
                              {
                                value: "portrait",
                                label: t("editor.imageShape.portrait"),
                                icon: RectangleVertical,
                              },
                              {
                                value: "landscape",
                                label: t("editor.imageShape.landscape"),
                                icon: RectangleHorizontal,
                              },
                              {
                                value: "square",
                                label: t("editor.imageShape.square"),
                                icon: Square,
                              },
                            ]}
                            onChange={(imageAspect) =>
                              onChange({
                                imageAspect:
                                  imageAspect as Board["imageAspect"],
                              })
                            }
                          />
                          <SelectField
                            id="builder-spacing"
                            label={t("builder.spacing")}
                            valueLabel={t("builder.customSpacing", {
                              gap: board.gap / 6,
                              padding: (board.canvasPadding ?? 60) / 6,
                            })}
                            value={
                              board.gap === 0 && board.canvasPadding === 0
                                ? "flush"
                                : board.gap === 24 && board.canvasPadding === 36
                                  ? "compact"
                                  : board.gap === 60 &&
                                      board.canvasPadding === 60
                                    ? "airy"
                                    : "custom"
                            }
                            options={[
                              { value: "flush", label: t("builder.flush") },
                              { value: "compact", label: t("builder.compact") },
                              { value: "airy", label: t("builder.airy") },
                            ]}
                            onChange={(value) => {
                              if (value !== "custom")
                                onChange(
                                  value === "flush"
                                    ? { gap: 0, canvasPadding: 0 }
                                    : value === "compact"
                                      ? { gap: 24, canvasPadding: 36 }
                                      : { gap: 60, canvasPadding: 60 },
                                );
                            }}
                          />
                          <Toggle
                            label={t("builder.rounded")}
                            checked={(board.cornerRadius ?? 0) > 0}
                            onChange={(rounded) =>
                              onChange({ cornerRadius: rounded ? 12.5 : 0 })
                            }
                          />
                          <Toggle
                            label={t("builder.borders")}
                            checked={board.cardBorderVisible === true}
                            onChange={(cardBorderVisible) =>
                              onChange({ cardBorderVisible })
                            }
                          />
                          {board.cardBorderVisible && (
                            <PercentField
                              id="card-border-width"
                              label={t("builder.borderThickness")}
                              max={5}
                              outputValue={`${board.cardBorderWidth ?? 0.5}%`}
                              value={board.cardBorderWidth ?? 0.5}
                              onChange={(cardBorderWidth) =>
                                onChange({ cardBorderWidth })
                              }
                            />
                          )}
                        </>
                      )}
                      {index === 2 && (
                        <Toggle
                          label={t("settings.fields.showHeading")}
                          checked={board.headingVisible}
                          onChange={(headingVisible) =>
                            onChange({ headingVisible })
                          }
                        />
                      )}
                      {index === 3 && (
                        <Toggle
                          label={t("settings.fields.showTitles")}
                          checked={board.titlesVisible !== false}
                          onChange={(titlesVisible) =>
                            onChange({ titlesVisible })
                          }
                        />
                      )}
                      {((index === 2 && board.headingVisible) ||
                        (index === 3 && board.titlesVisible !== false)) && (
                        <SelectField
                          id={index === 2 ? "heading-font" : "cell-font"}
                          label={t("builder.typography")}
                          value={
                            index === 2 ? board.headingFont : board.cellFont
                          }
                          largeFontPreview
                          options={fontOptions.map((font) => ({
                            value: font,
                            label: font,
                            fontFamily: font,
                            fontWeight: resolveFontWeight(
                              font,
                              index === 2
                                ? board.headingFontWeight
                                : board.cellFontWeight,
                            ),
                          }))}
                          onChange={(font) =>
                            onChange(
                              index === 2
                                ? {
                                    headingFont: font as Board["headingFont"],
                                    headingFontWeight: resolveFontWeight(
                                      font,
                                      board.headingFontWeight,
                                    ),
                                  }
                                : {
                                    cellFont: font as Board["cellFont"],
                                    cellFontWeight: resolveFontWeight(
                                      font,
                                      board.cellFontWeight,
                                    ),
                                  },
                            )
                          }
                        />
                      )}
                      {index === 3 && board.titlesVisible !== false && (
                        <IconRadioField
                          id="caption-position"
                          label={t("editor.captionPosition.label")}
                          value={
                            board.captionPlacement === "overlay"
                              ? `overlay-${board.captionAlignment === "top" ? "top" : "bottom"}`
                              : (board.captionPlacement ?? "below")
                          }
                          columns={2}
                          options={[
                            {
                              value: "above",
                              label: t("editor.captionPosition.above"),
                              icon: PanelTop,
                            },
                            {
                              value: "below",
                              label: t("editor.captionPosition.below"),
                              icon: PanelBottom,
                            },
                            {
                              value: "overlay-top",
                              label: t("editor.captionPosition.overlayTop"),
                              icon: PanelTopDashed,
                            },
                            {
                              value: "overlay-bottom",
                              label: t("editor.captionPosition.overlayBottom"),
                              icon: PanelBottomDashed,
                            },
                          ]}
                          onChange={(position) =>
                            onChange(
                              position === "above" || position === "below"
                                ? { captionPlacement: position }
                                : {
                                    captionPlacement: "overlay",
                                    captionAlignment:
                                      position === "overlay-top"
                                        ? "top"
                                        : "bottom",
                                  },
                            )
                          }
                        />
                      )}
                      {(index < 2 ||
                        (index === 2 && board.headingVisible) ||
                        (index === 3 && board.titlesVisible !== false)) && (
                        <div
                          data-design-customize
                          className="flex min-w-0 flex-col gap-4 border-0"
                        >
                          {children[index]}
                        </div>
                      )}
                    </fieldset>
                  </AccordionPanel>
                )}
              </AnimatePresence>
            </>
          )}
        </Disclosure>
      ))}
    </section>
  );
}
