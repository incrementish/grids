import { Disclosure, Radio, RadioGroup } from "@headlessui/react";
import { AnimatePresence } from "motion/react";
import { ArrowLeft, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { useState, type RefObject } from "react";
import { t } from "../i18n";
import {
  createResetGridCommand,
  documentReducer,
  type ResetSelection,
  type Workspace,
} from "../model";
import { Modal } from "./ui/Modal";
import {
  AccordionPanel,
  Button,
  CheckboxField,
  DisclosureChevron,
  DisclosureTrigger,
  IconRadioField,
} from "./ui/controls";

const emptySelection: ResetSelection = {
  canvas: false,
  theme: false,
  defaultTheme: false,
  images: false,
  placements: false,
};
type ResetAction =
  | ""
  | "placements"
  | "canvas"
  | "theme"
  | "images"
  | "advanced";

function ResetContent({
  workspace,
  disabled,
  onConfirm,
  onClose,
}: {
  workspace: Workspace;
  disabled: boolean;
  onConfirm: (selection: ResetSelection) => void;
  onClose: () => void;
}) {
  const [action, setAction] = useState<ResetAction>("");
  const [advanced, setAdvanced] = useState<ResetSelection>(emptySelection);
  const [themeTarget, setThemeTarget] = useState("current");
  const [confirmAll, setConfirmAll] = useState(false);
  const selection: ResetSelection = confirmAll
    ? {
        canvas: true,
        theme: false,
        defaultTheme: true,
        images: true,
        placements: true,
      }
    : action === "advanced"
      ? advanced
      : {
          ...emptySelection,
          ...(action === "theme"
            ? {
                theme: themeTarget === "current",
                defaultTheme: themeTarget === "default",
              }
            : action
              ? { [action]: true }
              : {}),
        };
  const selected = Object.values(selection).some(Boolean);
  const fullReset =
    selection.canvas &&
    selection.defaultTheme &&
    selection.images &&
    selection.placements;
  const preview = selected
    ? documentReducer(workspace, createResetGridCommand(selection))
    : workspace;
  const cells = [
    ...workspace.grid.cells,
    ...workspace.grid.overflow.map((entry) => entry.cell),
  ];
  const clearedCards =
    selection.canvas || selection.placements
      ? cells.filter((cell) => cell.assetId !== null || cell.title.trim())
          .length
      : 0;
  const deletedImages = workspace.assets.length - preview.assets.length;
  const retainedImages = preview.assets.length;
  const libraryImages = workspace.assets.filter(
    (asset) => !asset.libraryHidden,
  ).length;
  const confirmLabel = confirmAll
    ? t("editor.reset.confirmAll")
    : action === "placements"
      ? t("editor.reset.clearCards", { count: clearedCards })
      : action === "canvas"
        ? t("editor.reset.newGrid")
        : action === "theme"
          ? t("editor.reset.restoreAppearance")
          : action === "images"
            ? t("editor.reset.clearImages", { count: libraryImages })
            : t("editor.reset.confirm");
  const execute = () => {
    if (disabled || !selected) return;
    if (fullReset && !confirmAll) {
      setConfirmAll(true);
      return;
    }
    onConfirm(selection);
  };
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {confirmAll ? (
        <div className="flex flex-col gap-3" data-reset-review>
          <h3 className="m-0 text-base font-semibold">
            {t("editor.reset.everything")}
          </h3>
          <p className="m-0 text-sm text-ui-muted">
            {t("editor.reset.allWarning")}
          </p>
        </div>
      ) : (
        <>
          <RadioGroup
            value={action}
            onChange={setAction}
            aria-label={t("editor.reset.prompt")}
            disabled={disabled}
            className="flex flex-col gap-2"
          >
            {(["placements", "canvas", "theme", "images"] as const).map(
              (part) => (
                <Radio
                  key={part}
                  value={part}
                  as="button"
                  type="button"
                  data-reset-action={part}
                  className="flex min-h-11 min-w-0 flex-col gap-1 rounded-md border border-solid border-ui-border bg-transparent p-3 text-left text-sm [--control-hover-base:var(--panel)] data-hover:control-hover data-checked:border-ui-accent data-checked:bg-ui-selected focus-visible:outline-2 focus-visible:outline-ui-accent disabled:opacity-50"
                >
                  <span className="font-semibold">
                    {t(`editor.reset.actions.${part}.label`)}
                  </span>
                  <span className="text-xs text-ui-muted">
                    {t(`editor.reset.actions.${part}.description`)}
                  </span>
                </Radio>
              ),
            )}
          </RadioGroup>
          {(action === "theme" ||
            (action === "advanced" &&
              (advanced.theme || advanced.defaultTheme))) && (
            <IconRadioField
              id="reset-theme-target"
              label={t("editor.reset.themeTarget")}
              columns={2}
              value={themeTarget}
              options={[
                { value: "current", label: t("editor.reset.keepPalette") },
                { value: "default", label: t("editor.reset.useDefaults") },
              ]}
              onChange={(value) => {
                setThemeTarget(value);
                if (action === "advanced")
                  setAdvanced((current) => ({
                    ...current,
                    theme: value === "current",
                    defaultTheme: value === "default",
                  }));
              }}
            />
          )}
          <Disclosure defaultOpen={action === "advanced"}>
            {({ open }) => (
              <>
                <DisclosureTrigger
                  level="customize"
                  disabled={disabled}
                  onClick={() => {
                    if (!open) setAction("advanced");
                  }}
                >
                  <SlidersHorizontal aria-hidden="true" className="size-4" />
                  <span className="flex-1">{t("editor.reset.advanced")}</span>
                  <DisclosureChevron open={open} />
                </DisclosureTrigger>
                <AnimatePresence initial={false}>
                  {open && (
                    <AccordionPanel>
                      <fieldset
                        className="m-0 flex flex-col gap-2 border-0 pt-3"
                        disabled={disabled}
                      >
                        <legend className="sr-only">
                          {t("editor.reset.advanced")}
                        </legend>
                        {(
                          ["placements", "canvas", "theme", "images"] as const
                        ).map((part) => (
                          <CheckboxField
                            key={part}
                            id={`reset-${part}`}
                            label={t(`editor.reset.actions.${part}.label`)}
                            checked={
                              action === "advanced" &&
                              (part === "theme"
                                ? advanced.theme || advanced.defaultTheme
                                : advanced[part])
                            }
                            onChange={(checked) => {
                              setAction("advanced");
                              setAdvanced((current) => ({
                                ...current,
                                ...(part === "theme"
                                  ? {
                                      theme:
                                        checked && themeTarget === "current",
                                      defaultTheme:
                                        checked && themeTarget === "default",
                                    }
                                  : { [part]: checked }),
                              }));
                            }}
                          />
                        ))}
                      </fieldset>
                    </AccordionPanel>
                  )}
                </AnimatePresence>
              </>
            )}
          </Disclosure>
        </>
      )}
      {selected && (
        <div
          className="flex flex-col gap-2 border-0 border-t border-solid border-ui-border pt-3 text-sm"
          aria-live="polite"
          data-reset-impact
        >
          {(selection.canvas || selection.placements) && (
            <p className="m-0">
              {t("editor.reset.cardImpact", { count: clearedCards })}
            </p>
          )}
          {selection.canvas && (
            <p className="m-0 text-ui-muted">{t("editor.reset.gridImpact")}</p>
          )}
          {(selection.theme || selection.defaultTheme) && (
            <p className="m-0 text-ui-muted">{t("editor.reset.themeImpact")}</p>
          )}
          {selection.images ? (
            <>
              <p className="m-0">
                {t("editor.reset.deletedImpact", { count: deletedImages })}
              </p>
              <p className="m-0 text-ui-muted">
                {t("editor.reset.retainedImpact", { count: retainedImages })}
              </p>
            </>
          ) : (
            <p className="m-0 text-ui-muted">{t("editor.reset.keepLibrary")}</p>
          )}
          <p className="m-0 text-ui-muted">{t("editor.reset.irreversible")}</p>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={confirmAll ? () => setConfirmAll(false) : onClose}>
          {confirmAll && <ArrowLeft aria-hidden="true" />}
          {t(confirmAll ? "editor.reset.back" : "editor.reset.cancel")}
        </Button>
        <Button
          intent="danger"
          disabled={!selected || disabled}
          onClick={execute}
        >
          {confirmAll ? (
            <Trash2 aria-hidden="true" />
          ) : (
            <RotateCcw aria-hidden="true" />
          )}
          {confirmLabel}
        </Button>
      </div>
      {!confirmAll && (
        <div className="border-0 border-t border-solid border-ui-border pt-3">
          <Button
            intent="danger"
            disabled={disabled}
            onClick={() => setConfirmAll(true)}
          >
            <Trash2 aria-hidden="true" />
            {t("editor.reset.everything")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ResetDialog({
  open,
  session,
  workspace,
  disabled,
  onConfirm,
  onClose,
  returnFocus,
}: {
  open: boolean;
  session: number;
  workspace: Workspace;
  disabled: boolean;
  onConfirm: (selection: ResetSelection) => void;
  onClose: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("editor.reset.title")}
      returnFocus={returnFocus}
    >
      <ResetContent
        key={session}
        workspace={workspace}
        disabled={disabled}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    </Modal>
  );
}
