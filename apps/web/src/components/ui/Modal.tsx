import { t } from "../../i18n";
import { cva } from "class-variance-authority";
import { motionDuration, motionPresets } from "./motion";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { X } from "lucide-react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Button, MotionDiv, Spinner } from "./controls";

const modalFrameStyles = cva(
  "fixed inset-0 overflow-y-auto overscroll-contain",
  {
    variants: { fullscreen: { true: "", false: "p-4" } },
  },
);

const modalPanelStyles = cva("flex w-full flex-col bg-ui-panel", {
  variants: {
    fullscreen: {
      true: "h-dvh",
      false:
        "gap-4 rounded-lg border border-solid border-ui-border p-5 shadow-xl",
    },
    size: { compact: "", wide: "", picker: "" },
  },
  compoundVariants: [
    { fullscreen: false, size: "compact", className: "max-w-md" },
    { fullscreen: false, size: "wide", className: "max-w-200" },
    { fullscreen: false, size: "picker", className: "max-w-none" },
  ],
});

const modalHeaderStyles = cva(
  "flex shrink-0 items-center justify-between gap-3",
  {
    variants: {
      fullscreen: {
        true: "p-3 pt-[max(12px,env(safe-area-inset-top))]",
        false: "",
      },
    },
  },
);

function InitialDialogFocus({
  target,
  enabled,
}: {
  target: RefObject<HTMLElement | null>;
  enabled: boolean;
}) {
  useEffect(() => {
    if (!enabled) return;
    const frame = requestAnimationFrame(() =>
      target.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [target, enabled]);
  return null;
}

export function Modal({
  open,
  onClose,
  title,
  initialFocus,
  returnFocus,
  children,
  fullscreen = false,
  size = "compact",
  pickerCardWidth = 120,
  onExited,
  ready,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  initialFocus?: RefObject<HTMLElement | null>;
  returnFocus: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
  fullscreen?: boolean;
  size?: "compact" | "wide" | "picker";
  pickerCardWidth?: number;
  onExited?: () => void;
  ready?: boolean;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const pendingCloseButton = useRef<HTMLButtonElement>(null);
  const scrollFrame = useRef<HTMLDivElement>(null);
  const [pickerPanel, setPickerPanel] = useState<HTMLElement | null>(null);
  const [pickerWidth, setPickerWidth] = useState<number>();
  const [prepared, setPrepared] = useState(false);
  const contentReady = ready === undefined || prepared;
  useLayoutEffect(() => {
    const frame = scrollFrame.current;
    const content = pickerPanel;
    if (
      !open ||
      !contentReady ||
      fullscreen ||
      size !== "picker" ||
      !frame ||
      !content
    )
      return;
    const fit = () => {
      const frameStyle = getComputedStyle(frame);
      const panelStyle = getComputedStyle(content);
      const grid = content.querySelector('[role="region"] > .grid');
      const gap = grid ? parseFloat(getComputedStyle(grid).columnGap) : 10;
      const inset =
        parseFloat(panelStyle.paddingLeft) +
        parseFloat(panelStyle.paddingRight) +
        parseFloat(panelStyle.borderLeftWidth) +
        parseFloat(panelStyle.borderRightWidth);
      const available = Math.min(
        frame.clientWidth -
          parseFloat(frameStyle.paddingLeft) -
          parseFloat(frameStyle.paddingRight),
        6 * pickerCardWidth + 5 * gap + inset,
      );
      const columns = Math.max(
        1,
        Math.floor((available - inset + gap) / (pickerCardWidth + gap)),
      );
      setPickerWidth(
        Math.min(available, columns * (pickerCardWidth + gap) - gap + inset),
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [open, contentReady, fullscreen, size, pickerCardWidth, pickerPanel]);
  useEffect(() => {
    if (!open) {
      setPrepared(false);
      return;
    }
    if (ready !== true || prepared) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setPrepared(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [open, ready, prepared]);
  const reduced = useReducedMotion();
  const transition = { duration: reduced ? 0 : motionDuration.layout };
  const touch =
    typeof window !== "undefined" &&
    (window.matchMedia("(any-pointer: coarse)").matches ||
      navigator.maxTouchPoints > 0);

  return (
    <AnimatePresence
      onExitComplete={() => {
        requestAnimationFrame(() =>
          returnFocus.current?.focus({ preventScroll: true }),
        );
        onExited?.();
      }}
    >
      {open && (
        <Dialog
          key="dialog"
          static
          open
          onClose={onClose}
          initialFocus={
            contentReady
              ? touch
                ? closeButton
                : (initialFocus ?? closeButton)
              : pendingCloseButton
          }
          as={MotionDiv}
          {...motionPresets.fade}
          motionTransition={transition}
          className="fixed inset-0 z-60"
        >
          <DialogBackdrop
            as={MotionDiv}
            initial={false}
            motionTransition={transition}
            className="fixed inset-0 bg-black/60"
          />
          <div
            ref={scrollFrame}
            data-modal-scroll
            data-overlay-scroll="y"
            className={modalFrameStyles({ fullscreen })}
          >
            <div className="flex min-h-full items-center justify-center">
              {contentReady ? (
                <DialogPanel
                  ref={setPickerPanel}
                  key="content"
                  data-modal-panel
                  as={MotionDiv}
                  initial={
                    ready === undefined || reduced ? false : { opacity: 0 }
                  }
                  animate={{ opacity: 1 }}
                  motionTransition={transition}
                  className={modalPanelStyles({ fullscreen, size })}
                  style={
                    size === "picker" && !fullscreen
                      ? { width: pickerWidth }
                      : undefined
                  }
                >
                  <InitialDialogFocus
                    target={touch ? closeButton : (initialFocus ?? closeButton)}
                    enabled={touch || ready !== undefined}
                  />
                  <div className={modalHeaderStyles({ fullscreen })}>
                    <DialogTitle className="text-lg font-semibold">
                      {title}
                    </DialogTitle>
                    <Button
                      ref={closeButton}
                      presentation="icon"
                      onClick={onClose}
                      aria-label={t("common.actions.closeDialog")}
                      title={t("common.actions.closeDialog")}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </div>
                  {children}
                </DialogPanel>
              ) : (
                <DialogPanel key="loading" className="flex items-center gap-3">
                  <DialogTitle className="sr-only">{title}</DialogTitle>
                  <span
                    role="status"
                    className="flex items-center gap-2 text-sm text-ui-text"
                  >
                    <Spinner />
                    {t("common.actions.loading")}
                  </span>
                  <Button
                    ref={pendingCloseButton}
                    presentation="icon"
                    onClick={onClose}
                    aria-label={t("common.actions.closeDialog")}
                    title={t("common.actions.closeDialog")}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </DialogPanel>
              )}
            </div>
          </div>
        </Dialog>
      )}
    </AnimatePresence>
  );
}
