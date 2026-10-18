"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "./button";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  hideHeader,
  hideCloseButton,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
  hideHeader?: boolean;
  hideCloseButton?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content
          className={`dialog-content${className ? ` ${className}` : ""}`}
        >
          {hideHeader ? (
            <>
              <DialogPrimitive.Title className="sr-only">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                {description}
              </DialogPrimitive.Description>
            </>
          ) : (
            <>
              <DialogPrimitive.Title className="dialog-title">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="dialog-description">
                {description}
              </DialogPrimitive.Description>
            </>
          )}
          {children}
          {!hideCloseButton && (
            <DialogPrimitive.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                className="dialog-close"
                aria-label="Close dialog"
              >
                <X size={19} />
              </Button>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
