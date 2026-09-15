"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

/** Receipts are print-friendly; the button itself is hidden when printing. */
export function PrintButton({ label = "Print receipt" }) {
  return (
    <Button
      variant="secondary"
      className="no-print"
      onClick={() => window.print()}
      iconLeft={<Printer className="size-4" />}
    >
      {label}
    </Button>
  );
}
