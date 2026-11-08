import { ArrowLeft, RotateCcw, Trash2 } from "lucide-react";
import { useState, type RefObject } from "react";
import { t } from "../i18n";
import { type ResetSelection, type Workspace } from "../model";
import { Modal } from "./ui/Modal";
import { Button, CheckboxField, IconRadioField } from "./ui/controls";

const emptySelection: ResetSelection = {
  canvas: false,
  theme: false,
  defaultTheme: false,
  images: false,
  placements: false,
};

function ResetContent({
  disabled,
  onConfirm,
  onClose,
}: {
  disabled: boolean;
  onConfirm: (selection: ResetSelection) => void;
  onClose: () => void;
}) {
  const [selection, setSelection] = useState<ResetSelection>(emptySelection);
  const [themeTarget, setThemeTarget] = useState("current");
  const [reviewing, setReviewing] = useState(false);
  const selected = Object.values(selection).some(Boolean);
  const fullReset =
    selection.canvas &&
    selection.defaultTheme &&
    selection.images &&
    selection.placements;
  const confirmLabel = reviewing
    ? fullReset
      ? t("editor.reset.confirmAll")
      : t("editor.reset.confirmSelection")
    : t("editor.reset.confirm");
  const execute = () => {
    if (disabled || !selected) return;
    if (!reviewing) {
      setReviewing(true);
      return;
    }
    onConfirm(selection);
  };
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {reviewing ? (
        <ul
          className="m-0 flex list-disc flex-col gap-2 pl-5 text-sm"
          aria-live="polite"
          data-reset-review
        >
          {(["placements", "canvas", "theme", "images"] as const).map(
            (part) => (
              <li
                key={part}
                className={
                  (
                    part === "theme"
                      ? selection.theme || selection.defaultTheme
                      : selection[part]
                  )
                    ? "text-ui-text"
                    : "text-ui-muted"
                }
              >
                {t(`editor.reset.actions.${part}.label`)}
                {part === "theme" && (
                  <>
                    {": "}
                    {t(
                      themeTarget === "default"
                        ? "editor.reset.useDefaults"
                        : "editor.reset.keepPalette",
                    )}
                  </>
                )}
              </li>
            ),
          )}
        </ul>
      ) : (
        <fieldset
          disabled={disabled}
          className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
        >
          <legend className="sr-only">{t("editor.reset.prompt")}</legend>
          {(["placements", "canvas", "theme", "images"] as const).map(
            (part) => (
              <CheckboxField
                key={part}
                id={`reset-${part}`}
                label={t(`editor.reset.actions.${part}.label`)}
                description={t(`editor.reset.actions.${part}.description`)}
                checked={
                  part === "theme"
                    ? selection.theme || selection.defaultTheme
                    : selection[part]
                }
                disabled={disabled}
                onChange={(checked) =>
                  setSelection((current) => ({
                    ...current,
                    ...(part === "theme"
                      ? {
                          theme: checked && themeTarget === "current",
                          defaultTheme: checked && themeTarget === "default",
                        }
                      : { [part]: checked }),
                  }))
                }
              >
                {part === "theme" && (
                  <IconRadioField
                    id="reset-theme-target"
                    label={t("editor.reset.themeTarget")}
                    columns={2}
                    value={themeTarget}
                    options={[
                      {
                        value: "current",
                        label: t("editor.reset.keepPalette"),
                      },
                      {
                        value: "default",
                        label: t("editor.reset.useDefaults"),
                      },
                    ]}
                    onChange={(value) => {
                      setThemeTarget(value);
                      setSelection((current) => {
                        const checked = current.theme || current.defaultTheme;
                        return {
                          ...current,
                          theme: checked && value === "current",
                          defaultTheme: checked && value === "default",
                        };
                      });
                    }}
                  />
                )}
              </CheckboxField>
            ),
          )}
        </fieldset>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={reviewing ? () => setReviewing(false) : onClose}>
          {reviewing && <ArrowLeft aria-hidden="true" />}
          {t(reviewing ? "editor.reset.back" : "editor.reset.cancel")}
        </Button>
        <Button
          intent="danger"
          disabled={!selected || disabled}
          onClick={execute}
        >
          {reviewing ? (
            <Trash2 aria-hidden="true" />
          ) : (
            <RotateCcw aria-hidden="true" />
          )}
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

export function ResetDialog({
  open,
  session,
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
        disabled={disabled}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    </Modal>
  );
}
