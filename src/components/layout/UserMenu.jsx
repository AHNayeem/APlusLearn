"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, LogOut, Settings, User as UserIcon, Bell, CalendarDays,
} from "lucide-react";
import { Avatar, Button, Dropdown, DropdownDivider, DropdownItem, DropdownLabel } from "@/components/ui";
import { homeForRole, ROLE_LABELS, ROLES } from "@/constants";
import { api } from "@/lib/api/client";

export function UserMenu({ user }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Button href="/login" variant="ghost" size="sm">
          Sign in
        </Button>
        <Button href="/register" size="sm">
          Get started
        </Button>
      </div>
    );
  }

  const signOut = async () => {
    setSigningOut(true);
    try {
      await api.post("/api/auth/logout");
      router.push("/");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  };

  const dashboard = homeForRole(user.role);
  const isTutor = user.role === ROLES.TUTOR;
  const isAdmin = user.role === ROLES.ADMIN;

  // Each role's account screen lives inside that role's shell, whose layout
  // enforces the role. Pointing an administrator at the learner one — which is
  // what this did — sent them through a redirect back to where they started.
  const accountHref = isAdmin ? "/admin/account" : isTutor ? "/tutor/settings" : "/settings";

  return (
    <Dropdown
      trigger={
        <span className="flex items-center gap-2 rounded-xl p-1 pr-2 transition-colors hover:bg-ink-100">
          <Avatar
            src={user.avatarUrl}
            firstName={user.firstName}
            lastName={user.lastName}
            size="sm"
          />
          <span className="hidden text-sm font-semibold text-ink-700 sm:block">
            {user.firstName}
          </span>
          <svg viewBox="0 0 20 20" className="size-4 text-ink-400" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5.2 7.3a1 1 0 0 1 1.4 0L10 10.6l3.4-3.3a1 1 0 1 1 1.4 1.4l-4.1 4a1 1 0 0 1-1.4 0l-4.1-4a1 1 0 0 1 0-1.4Z" clipRule="evenodd" />
          </svg>
        </span>
      }
    >
      <DropdownLabel>
        {user.firstName} {user.lastName} · {ROLE_LABELS[user.role]}
      </DropdownLabel>

      <DropdownItem href={dashboard} icon={<LayoutDashboard className="size-4" />}>
        Dashboard
      </DropdownItem>
      <DropdownItem
        href={isTutor ? "/tutor/bookings" : "/bookings"}
        icon={<CalendarDays className="size-4" />}
      >
        My lessons
      </DropdownItem>
      <DropdownItem
        href={isTutor ? "/tutor/notifications" : "/notifications"}
        icon={<Bell className="size-4" />}
      >
        Notifications
      </DropdownItem>

      {isTutor && (
        <DropdownItem href="/tutor/profile" icon={<UserIcon className="size-4" />}>
          My public profile
        </DropdownItem>
      )}

      <DropdownDivider />

      <DropdownItem href={accountHref} icon={<Settings className="size-4" />}>
        {isAdmin ? "My account" : "Settings"}
      </DropdownItem>
      <DropdownItem onClick={signOut} disabled={signingOut} icon={<LogOut className="size-4" />}>
        {signingOut ? "Signing out…" : "Sign out"}
      </DropdownItem>
    </Dropdown>
  );
}
