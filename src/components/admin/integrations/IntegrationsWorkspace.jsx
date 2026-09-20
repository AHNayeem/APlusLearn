"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui";
import { INTEGRATION_STATUS } from "@/constants";
import { ModuleCard } from "./ModuleCard";

/**
 * The external modules console (§26).
 *
 * One tab per module, each saving only itself, for the same reason the
 * platform settings console works that way: a change to the SMTP host must
 * not be able to roll back a Stripe key someone edited in another panel.
 *
 * The tab label carries the module's state, so an operator can see which one
 * needs them without opening all five. It is a word, not a dot — the badge on
 * the panel itself is the detailed version.
 */
const SHORT_STATUS = {
  [INTEGRATION_STATUS.CONNECTED]: null,
  [INTEGRATION_STATUS.CONFIGURED]: "untested",
  [INTEGRATION_STATUS.NOT_CONFIGURED]: "not set up",
  [INTEGRATION_STATUS.DISABLED]: "off",
  [INTEGRATION_STATUS.FAILING]: "failing",
  [INTEGRATION_STATUS.NEEDS_ATTENTION]: "attention",
};

export function IntegrationsWorkspace({ modules }) {
  const [tab, setTab] = useState(modules[0]?.module);

  const tabs = modules.map((module) => {
    const short = SHORT_STATUS[module.status];
    // The state is part of the label rather than a separate colour or dot, so
    // it reaches a screen reader as the tab's own name (§34).
    return {
      value: module.module,
      label: short ? `${module.label} · ${short}` : module.label,
    };
  });

  const active = modules.find((module) => module.module === tab) ?? modules[0];

  return (
    <Tabs tabs={tabs} value={tab} onChange={setTab} className="max-w-3xl">
      {/*
        Keyed by module so switching tabs remounts the panel rather than
        carrying one module's half-typed credential into another's form.
      */}
      {active && <ModuleCard key={active.module} module={active} />}
    </Tabs>
  );
}
