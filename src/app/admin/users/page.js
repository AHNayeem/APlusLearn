import Link from "next/link";
import { Users, Search } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, ROLE_LABELS, USER_STATUS } from "@/constants";
import { listUsers } from "@/services/user.service";
import { adminUserQuerySchema } from "@/lib/validation/admin";
import {
  Avatar, Badge, Button, EmptyState, LinkTabs, Pagination, Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatDate, formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Users" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: "", label: "All" },
  { value: ROLES.PARENT, label: "Parents" },
  { value: ROLES.STUDENT, label: "Students" },
  { value: ROLES.TUTOR, label: "Tutors" },
  { value: ROLES.ADMIN, label: "Admins" },
];

function statusTone(status) {
  if (status === USER_STATUS.ACTIVE) return "success";
  if (status === USER_STATUS.SUSPENDED) return "danger";
  if (status === USER_STATUS.DELETED) return "neutral";
  return "warning";
}

export default async function AdminUsersPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/users");
  await connectToDatabase();

  const raw = await searchParams;
  const parsed = adminUserQuerySchema.safeParse(raw);
  const params = parsed.success ? parsed.data : adminUserQuerySchema.parse({});

  const { items, total, page, pageSize } = await listUsers(params);

  return (
    <DashboardPage>
      <PageHeader
        title="Users"
        description="Every account on the platform, across all roles."
      />

      <LinkTabs
        activeValue={params.role ?? ""}
        tabs={TABS.map((tab) => ({
          ...tab,
          href: tab.value ? `/admin/users?role=${tab.value}` : "/admin/users",
        }))}
      />

      <form action="/admin/users" className="mt-5 flex max-w-md gap-2">
        {params.role && <input type="hidden" name="role" value={params.role} />}
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search by name or email"
          aria-label="Search users"
          className="h-10 flex-1 rounded-xl border-0 bg-white px-3.5 text-sm ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
        />
        <Button type="submit" variant="secondary" size="sm" iconLeft={<Search className="size-4" />}>
          Search
        </Button>
      </form>

      <div className="mt-6">
        {items.length === 0 ? (
          <EmptyState
            icon={<Users className="size-7" />}
            title="No users match"
            description="Try a different search or role filter."
          />
        ) : (
          <Table>
            <THead>
              <TH>User</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>Location</TH>
              <TH>Joined</TH>
              <TH align="right">Action</TH>
            </THead>
            <TBody>
              {items.map((user) => (
                <TR key={user.id}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <Avatar
                        src={user.avatarUrl}
                        firstName={user.firstName}
                        lastName={user.lastName}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <span className="block truncate font-semibold text-ink-900">
                          {user.firstName} {user.lastName}
                        </span>
                        <span className="block truncate text-xs text-ink-500">{user.email}</span>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <Badge tone="neutral" size="sm">
                      {ROLE_LABELS[user.role]}
                    </Badge>
                  </TD>
                  <TD>
                    <Badge tone={statusTone(user.status)} size="sm">
                      {user.status.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                    {!user.emailVerifiedAt && user.status !== USER_STATUS.DELETED && (
                      <span className="mt-1 block text-[11px] text-warning-700">
                        Email unverified
                      </span>
                    )}
                  </TD>
                  <TD className="text-xs">
                    {[user.city, user.province].filter(Boolean).join(", ") || "—"}
                  </TD>
                  <TD className="text-xs">
                    <span className="block">{formatDate(user.createdAt)}</span>
                    {user.lastLoginAt && (
                      <span className="block text-ink-400">
                        Active {formatRelative(user.lastLoginAt)}
                      </span>
                    )}
                  </TD>
                  <TD align="right">
                    <Link
                      href={`/admin/users/${user.id}`}
                      className="text-sm font-semibold text-brand-600 hover:underline"
                    >
                      View
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        <Pagination
          className="mt-6"
          page={page}
          totalPages={Math.max(1, Math.ceil(total / pageSize))}
          total={total}
          pageSize={pageSize}
          label="users"
          buildHref={(p) =>
            `/admin/users?${new URLSearchParams({ ...(params.role ? { role: params.role } : {}), ...(params.q ? { q: params.q } : {}), page: String(p) })}`
          }
        />
      </div>
    </DashboardPage>
  );
}
