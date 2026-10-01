"use client";

import { SideTabs } from "@/components/ui";
import { INTEGRATION_STATUS } from "@/constants";
import { useSectionParam } from "@/hooks/useSectionParam";
import { ModuleCard } from "./ModuleCard";

/**
 * The external modules console (§26).
 *
 * One section per module, each saving only itself, for the same reason the
 * platform settings console works that way: a change to the SMTP host must
 * not be able to roll back a Stripe key someone edited in another panel. The
 * open module is kept in `?module=`, like the settings console's section.
 *
 * The menu entry carries the module's state, so an operator can see which one
 * needs them without opening all of them. It is a word, not a dot — the badge
 * on the panel itself is the detailed version — and it sits inside the tab, so
 * it reaches a screen reader as part of the tab's own name (§34).
 */
const SHORT_STATUS = {
  [INTEGRATION_STATUS.CONNECTED]: null,
  [INTEGRATION_STATUS.CONFIGURED]: "untested",
  [INTEGRATION_STATUS.NOT_CONFIGURED]: "not set up",
  [INTEGRATION_STATUS.DISABLED]: "off",
  [INTEGRATION_STATUS.FAILING]: "failing",
  [INTEGRATION_STATUS.NEEDS_ATTENTION]: "attention",
};

export function IntegrationsWorkspace({ modules, initialModule }) {
  const [tab, setTab] = useSectionParam(
    "module",
    modules.map((module) => module.module),
    initialModule,
  );

  const groups = [
    {
      label: "Modules",
      items: modules.map((module) => ({
        value: module.module,
        label: module.label,
        hint: SHORT_STATUS[module.status] ?? undefined,
      })),
    },
  ];

  const active = modules.find((module) => module.module === tab) ?? modules[0];

  return (
    <SideTabs groups={groups} value={tab} onChange={setTab} label="External modules">
      {/*
        Keyed by module so switching sections remounts the panel rather than
        carrying one module's half-typed credential into another's form.
      */}
      {active && <ModuleCard key={active.module} module={active} />}
    </SideTabs>
  );
}
