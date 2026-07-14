"use client";

import { useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  UserPlus,
  UserMinus,
  Copy,
  Check,
  Loader2,
  ShieldCheck,
  LogOut,
  Mail,
  MailX,
  MoreHorizontal,
  Pencil,
  X,
  Search,
  SlidersHorizontal,
  CreditCard,
} from "lucide-react";
import { toast } from "sonner";
import BoringAvatar from "boring-avatars";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useGetTeam, type TeamResponse } from "@/features/organization/use-get-team";
import { useCreateInvite } from "@/features/organization/use-create-invite";
import { useRevokeInvite } from "@/features/organization/use-revoke-invite";
import { useRemoveMember } from "@/features/organization/use-remove-member";
import { useLeaveOrg } from "@/features/organization/use-leave-org";
import { useUpdateOrgName } from "@/features/organization/use-update-org-name";
import { useToggleMemberAccess } from "@/features/organization/use-toggle-member-access";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors backend's z.string().min(1).max(100) in organization.ts; keep both in sync.
const NAME_MAX_LENGTH = 100;

// Cool/indigo palette, chosen to avoid clashing with the emerald/amber status colors.
const AVATAR_COLORS = ["#4f46e5", "#7c3aed", "#2563eb", "#0ea5e9", "#a5b4fc"];

type AdminTeam = Extract<TeamResponse, { role: "admin" }>;
type Member = AdminTeam["members"][number];
type Invite = AdminTeam["invites"][number];
type StatusFilter = "all" | "active" | "paused" | "pending";

// Every destructive admin action funnels through one ConfirmDialog; the union
// carries the target so the dialog can render the right copy and mutation.
type PendingAction =
  | { type: "remove"; member: Member }
  | { type: "revoke"; invite: Invite }
  | { type: "pause"; member: Member };

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "pending", label: "Pending" },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function expiryLabel(iso: string) {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "Expired";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${days} days`;
}

// "marble" variant + square frame reads as a brand tile, not a person avatar.
function Monogram({ name }: { name: string }) {
  return (
    <span className="flex size-11 shrink-0 overflow-hidden rounded-xl ring-1 ring-border">
      <BoringAvatar
        name={name || "team"}
        variant="marble"
        size={44}
        square
        colors={AVATAR_COLORS}
      />
    </span>
  );
}

// "beam" variant for people; `pending` shows a dashed mail glyph for unaccepted invites.
function Avatar({
  name,
  variant = "solid",
}: {
  name: string;
  variant?: "solid" | "pending";
}) {
  if (variant === "pending") {
    return (
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
        <Mail size={15} />
      </span>
    );
  }
  return (
    <span className="flex size-9 shrink-0 overflow-hidden rounded-full ring-1 ring-border">
      <BoringAvatar
        name={name || "member"}
        variant="beam"
        size={36}
        colors={AVATAR_COLORS}
      />
    </span>
  );
}

// Only status pills use color; rest of the UI stays achromatic by design.
function StatusPill({
  status,
}: {
  status: "active" | "paused" | "pending" | "idle";
}) {
  const pill = {
    active:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-400",
    paused:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400",
    pending: "border-border bg-transparent text-muted-foreground",
    idle: "border-border bg-muted/60 text-muted-foreground",
  }[status];
  const dot = {
    active: "bg-emerald-500",
    paused: "bg-amber-500",
    pending: "bg-muted-foreground/50",
    idle: "bg-muted-foreground/60",
  }[status];
  const label = {
    active: "Active",
    paused: "Paused",
    pending: "Pending",
    idle: "Not watching",
  }[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${pill}`}
    >
      <span className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function MemberIdentity({
  avatar,
  primary,
  secondary,
  muted,
}: {
  avatar: React.ReactNode;
  primary: string;
  secondary?: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      {avatar}
      <div className="min-w-0">
        <div
          className={`truncate text-sm font-medium ${
            muted ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          {primary}
        </div>
        {secondary && (
          <div className="truncate text-xs text-muted-foreground">{secondary}</div>
        )}
      </div>
    </div>
  );
}

const TITLE_CLASS =
  "truncate text-xl font-semibold leading-tight tracking-tight text-foreground";

// Enter saves, Escape cancels. Name updates via query invalidation in the
// update hook, so the header stays in sync after save.
function EditableTeamName({ name }: { name: string }) {
  const update = useUpdateOrgName();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);

  function startEditing() {
    setValue(name);
    setEditing(true);
  }

  function save() {
    const trimmed = value.trim();
    if (!trimmed) {
      toast.error("Team name can't be empty");
      return;
    }
    if (trimmed === name) {
      setEditing(false);
      return;
    }
    update.mutate({ name: trimmed }, { onSuccess: () => setEditing(false) });
  }

  function cancel() {
    setValue(name);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="group/name flex min-w-0 items-center gap-1">
        <h1 className={TITLE_CLASS}>{name}</h1>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={startEditing}
          aria-label="Rename team"
          className="shrink-0 text-muted-foreground/50 transition hover:text-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-hover/name:opacity-100"
        >
          <Pencil />
        </Button>
      </div>
    );
  }

  const length = value.length;
  const isEmpty = value.trim().length === 0;
  const nearLimit = length >= NAME_MAX_LENGTH - 10;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          value={value}
          maxLength={NAME_MAX_LENGTH}
          disabled={update.isPending}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          aria-label="Team name"
          aria-invalid={isEmpty}
          className="h-9 w-[min(18rem,60vw)] text-base font-semibold"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={save}
          disabled={update.isPending || isEmpty}
          aria-label="Save team name"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {update.isPending ? <Loader2 className="animate-spin" /> : <Check />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={cancel}
          disabled={update.isPending}
          aria-label="Cancel rename"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X />
        </Button>
      </div>
      <span
        aria-live="polite"
        className={`pl-1 text-xs tabular-nums ${
          isEmpty
            ? "text-destructive"
            : nearLimit
              ? "text-foreground"
              : "text-muted-foreground"
        }`}
      >
        {isEmpty ? "Name can't be empty" : `${length}/${NAME_MAX_LENGTH}`}
      </span>
    </div>
  );
}

function PageHeader({
  name,
  title,
  subtitle,
  action,
}: {
  name: string;
  title: React.ReactNode;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3.5">
        <Monogram name={name} />
        <div className="min-w-0">
          {typeof title === "string" ? (
            <h1 className={TITLE_CLASS}>{title}</h1>
          ) : (
            title
          )}
          <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

// modal={false}: without it, Radix's pointer-events guard closes the menu
// on the same click that opens it in this layout.
function RowMenu({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground/60 opacity-100 transition group-hover:text-foreground data-[state=open]:text-foreground sm:opacity-70 sm:group-hover:opacity-100 sm:data-[state=open]:opacity-100"
          aria-label="Row actions"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LoadingState() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center gap-3.5">
        <div className="size-11 animate-pulse rounded-xl bg-muted" />
        <div className="space-y-2">
          <div className="h-5 w-44 animate-pulse rounded bg-muted" />
          <div className="h-4 w-56 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="mt-8 h-64 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

export default function TeamSettings() {
  const { data, isLoading } = useGetTeam();
  const { user } = useUser();

  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();
  const removeMember = useRemoveMember();
  const leaveOrg = useLeaveOrg();
  const toggleAccess = useToggleMemberAccess();

  const reduceMotion = useReducedMotion();
  const [composerOpen, setComposerOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  if (isLoading) return <LoadingState />;

  const myEmail =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    "You";

  function closeComposer() {
    setComposerOpen(false);
    setGeneratedLink(null);
    setSentTo(null);
    setEmail("");
  }

  async function handleGenerate() {
    const trimmed = email.trim().toLowerCase();
    if (trimmed && !EMAIL_RE.test(trimmed)) {
      toast.error("Enter a valid email, or leave it blank for an open link");
      return;
    }
    try {
      const res = await createInvite.mutateAsync(trimmed ? { email: trimmed } : {});
      if ("link" in res) {
        setGeneratedLink(res.link);
        setSentTo(res.emailed ? res.email : null);
      }
    } catch {
      // error toast surfaced by the hook
    }
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Invite link copied");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually");
    }
  }

  const motionProps = {
    initial: reduceMotion ? false : { opacity: 0, y: -4 },
    animate: { opacity: 1, y: 0 },
    exit: reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 },
    transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const },
  };

  // Maps the pending destructive action to the ConfirmDialog's copy, button,
  // loading flag, and mutation. Each onConfirm closes the dialog on success so
  // it stays open with a spinner while in flight and remains open on error
  // (the hook surfaces the failure via toast). Null-safe so the single dialog
  // can render (closed) even when nothing is pending.
  function buildConfirm(action: PendingAction | null) {
    switch (action?.type) {
      case "remove": {
        const email = action.member.email ?? "this teammate";
        return {
          title: `Remove ${email}?`,
          description:
            "They lose access to your shared plan and NeatMail stops organizing their inbox. You can re-invite them later.",
          confirmLabel: "Remove",
          isLoading: removeMember.isPending,
          onConfirm: () =>
            removeMember.mutate(
              { userId: action.member.userId },
              { onSuccess: () => setPendingAction(null) },
            ),
        };
      }
      case "revoke": {
        const who = action.invite.email
          ? `for ${action.invite.email}`
          : "link";
        return {
          title: "Revoke this invite?",
          description: `The invite ${who} will stop working immediately and can't be used to join. You can always generate a new one.`,
          confirmLabel: "Revoke invite",
          isLoading: revokeInvite.isPending,
          onConfirm: () =>
            revokeInvite.mutate(
              { inviteId: action.invite.id },
              { onSuccess: () => setPendingAction(null) },
            ),
        };
      }
      case "pause": {
        const email = action.member.email ?? "this teammate";
        return {
          title: `Pause access for ${email}?`,
          description:
            "NeatMail stops watching and organizing their inbox until you resume. Their seat stays reserved and their plan is unaffected.",
          confirmLabel: "Pause access",
          isLoading: toggleAccess.isPending,
          onConfirm: () =>
            toggleAccess.mutate(
              { userId: action.member.userId, active: false },
              { onSuccess: () => setPendingAction(null) },
            ),
        };
      }
      default:
        return {
          title: "",
          description: "",
          confirmLabel: "Confirm",
          isLoading: false,
          onConfirm: () => {},
        };
    }
  }
  const confirm = buildConfirm(pendingAction);

  if (data?.role === "member") {
    const orgName = data.organization.name;
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader
          name={orgName}
          title={orgName}
          subtitle="You're a member of this team."
        />

        <div className="mt-6 overflow-hidden rounded-xl border border-border">
          <div className="divide-y divide-border">
            <div className="flex items-center gap-3 px-4 py-3">
              <Avatar name={data.admin.email ?? "owner"} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {data.admin.email ?? "Team owner"}
                  </span>
                  <Badge variant="secondary" className="gap-1">
                    <ShieldCheck size={12} /> Owner
                  </Badge>
                </div>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  Owns and pays for this team
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <Avatar name={myEmail} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {myEmail}
                  </span>
                  <Badge variant="outline">You</Badge>
                </div>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  You inherit the shared plan
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Leave this team</p>
            <p className="text-xs text-muted-foreground">
              You will lose the shared plan and NeatMail stops organizing your
              inbox until you subscribe again.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={leaveOrg.isPending}
            onClick={() => setLeaveOpen(true)}
            className="shrink-0 text-destructive hover:text-destructive"
          >
            <LogOut />
            Leave team
          </Button>
        </div>

        <ConfirmDialog
          open={leaveOpen}
          onOpenChange={setLeaveOpen}
          isLoading={leaveOrg.isPending}
          icon={<LogOut className="size-5 text-destructive" />}
          title={`Leave ${orgName}?`}
          description="Your plan reverts to no subscription and NeatMail stops organizing your inbox. You can rejoin later with a new invite."
          confirmLabel="Leave team"
          onConfirm={() =>
            leaveOrg.mutate(undefined, { onSuccess: () => setLeaveOpen(false) })
          }
        />
      </div>
    );
  }

  if (data?.role === "admin") {
    const { organization, members, invites, seatLimit, seatsUsed, seatsAvailable } =
      data;
    const canInvite = seatLimit > 0 && seatsAvailable > 0;

    const q = query.trim().toLowerCase();
    const emailMatch = (value?: string | null) =>
      !q || (value ?? "").toLowerCase().includes(q);

    const showOwner =
      emailMatch(myEmail) && (statusFilter === "all" || statusFilter === "active");
    const visibleMembers = members.filter(
      (m) =>
        emailMatch(m.email) &&
        (statusFilter === "all" ||
          statusFilter === (m.active ? "active" : "paused")),
    );
    const visibleInvites = invites.filter(
      (inv) =>
        emailMatch(inv.email) &&
        (statusFilter === "all" || statusFilter === "pending"),
    );
    const isFiltering = q.length > 0 || statusFilter !== "all";
    const showSeats = !isFiltering ? seatsAvailable : 0;
    const visibleRows =
      (showOwner ? 1 : 0) + visibleMembers.length + visibleInvites.length + showSeats;

    const footerText = isFiltering
      ? `${visibleRows} result${visibleRows === 1 ? "" : "s"}`
      : `${members.length} teammate${
          members.length === 1 ? "" : "s"
        } · ${seatsAvailable} open seat${seatsAvailable === 1 ? "" : "s"}`;

    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader
          name={organization.name}
          title={<EditableTeamName name={organization.name} />}
          subtitle={
            seatLimit > 0
              ? `${seatsUsed} of ${seatLimit} teammate seat${
                  seatLimit === 1 ? "" : "s"
                } filled${invites.length ? ` · ${invites.length} pending` : ""}`
              : "Your team"
          }
          action={
            <Button variant="outline" asChild className="shrink-0">
              <Link href="/billing">
                <CreditCard /> Manage plan
              </Link>
            </Button>
          }
        />

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">Members</h2>
            <Badge variant="secondary" className="tabular-nums">
              {1 + members.length}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search members"
                aria-label="Search members"
                className="h-9 w-full pl-8 sm:w-56"
              />
            </div>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={statusFilter === "all" ? "outline" : "secondary"}
                  size="icon"
                  className="shrink-0"
                  aria-label="Filter by status"
                >
                  <SlidersHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as StatusFilter)}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {canInvite && !composerOpen && (
              <Button className="shrink-0" onClick={() => setComposerOpen(true)}>
                <UserPlus /> Invite teammate
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border bg-muted/40 hover:bg-muted/40">
                <TableHead className="h-11 pl-4 text-xs font-medium text-muted-foreground">
                  Member
                </TableHead>
                <TableHead className="hidden text-xs font-medium text-muted-foreground md:table-cell">
                  Role
                </TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="hidden text-xs font-medium text-muted-foreground lg:table-cell">
                  Joined
                </TableHead>
                <TableHead className="text-center text-xs font-medium text-muted-foreground">
                  Access
                </TableHead>
                <TableHead className="w-12 pr-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {showOwner && (
                <TableRow className="hover:bg-transparent">
                  <TableCell className="py-3.5 pl-4">
                    <MemberIdentity
                      avatar={<Avatar name={myEmail} />}
                      primary={myEmail}
                      secondary="Billed to your account"
                    />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge variant="secondary" className="gap-1">
                      <ShieldCheck size={12} /> Owner
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <StatusPill status="active" />
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground/60 lg:table-cell">
                    —
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-xs text-muted-foreground">Always on</span>
                  </TableCell>
                  <TableCell className="pr-4" />
                </TableRow>
              )}

              {visibleMembers.map((m) => (
                <TableRow key={m.userId} className="group">
                  <TableCell className="py-3.5 pl-4">
                    <MemberIdentity
                      avatar={<Avatar name={m.email ?? m.userId} />}
                      primary={m.email ?? "Unknown teammate"}
                      secondary={
                        m.active
                          ? m.watchActivated
                            ? "Teammate"
                            : "Watch off — not processing mail"
                          : "Paused — mailbox processing stopped"
                      }
                    />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge variant="outline">Member</Badge>
                  </TableCell>
                  <TableCell>
                    <StatusPill
                      status={
                        m.active ? (m.watchActivated ? "active" : "idle") : "paused"
                      }
                    />
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {formatDate(m.joinedAt)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={m.active}
                      disabled={toggleAccess.isPending}
                      onCheckedChange={(checked) => {
                        // Pausing stops their inbox processing — confirm it.
                        // Resuming is safe, so apply it immediately.
                        if (checked) {
                          toggleAccess.mutate({ userId: m.userId, active: true });
                        } else {
                          setPendingAction({ type: "pause", member: m });
                        }
                      }}
                      aria-label={
                        m.active
                          ? `Pause access for ${m.email ?? "teammate"}`
                          : `Resume access for ${m.email ?? "teammate"}`
                      }
                    />
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <RowMenu>
                      <DropdownMenuItem
                        className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                        onSelect={() => setPendingAction({ type: "remove", member: m })}
                      >
                        <UserMinus /> Remove from team
                      </DropdownMenuItem>
                    </RowMenu>
                  </TableCell>
                </TableRow>
              ))}

              {visibleInvites.map((inv) => (
                <TableRow key={inv.id} className="group">
                  <TableCell className="py-3.5 pl-4">
                    <MemberIdentity
                      avatar={<Avatar name="" variant="pending" />}
                      primary={inv.email ?? "Anyone with the link"}
                      secondary="Invitation sent"
                    />
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground/60 md:table-cell">
                    —
                  </TableCell>
                  <TableCell>
                    <StatusPill status="pending" />
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {expiryLabel(inv.expiresAt)}
                  </TableCell>
                  <TableCell className="text-center text-muted-foreground/50">
                    —
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <RowMenu>
                      <DropdownMenuItem
                        className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                        onSelect={() => setPendingAction({ type: "revoke", invite: inv })}
                      >
                        <MailX /> Revoke invite
                      </DropdownMenuItem>
                    </RowMenu>
                  </TableCell>
                </TableRow>
              ))}

              {Array.from({ length: showSeats }).map((_, i) => (
                <TableRow key={`seat-${i}`} className="hover:bg-transparent">
                  <TableCell className="py-3.5 pl-4">
                    <MemberIdentity
                      avatar={
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground/60">
                          <UserPlus size={15} />
                        </span>
                      }
                      primary="Open seat"
                      secondary="Available for a teammate"
                      muted
                    />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground/50 md:table-cell">
                    —
                  </TableCell>
                  <TableCell className="text-muted-foreground/50">—</TableCell>
                  <TableCell className="hidden text-muted-foreground/50 lg:table-cell">
                    —
                  </TableCell>
                  <TableCell className="text-center text-muted-foreground/50">
                    —
                  </TableCell>
                  <TableCell className="pr-4" />
                </TableRow>
              ))}

              {visibleRows === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={6}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    No members match your search.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-2.5">
            <span className="text-xs text-muted-foreground">{footerText}</span>
            {isFiltering && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>

        {/* State is independent of seat count so the one-time link survives the
            refetch when the last seat fills. */}
        <AnimatePresence initial={false}>
          {composerOpen && (
            <motion.div
              {...motionProps}
              className="mt-3 overflow-hidden rounded-xl border border-border bg-card p-4"
            >
              {generatedLink ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {sentTo ? "Invite sent" : "Invite link ready"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {sentTo
                          ? `We emailed the invite to ${sentTo}. You can also share this link:`
                          : "Single-use, expires in 7 days. It will not be shown again."}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs text-foreground">
                      {generatedLink}
                    </code>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      onClick={() => copyLink(generatedLink)}
                    >
                      {copied ? <Check /> : <Copy />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <div className="flex justify-end">
                    <Button variant="ghost" size="sm" onClick={closeComposer}>
                      Done
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Invite a teammate
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Generate a single-use link. Add an email to lock it to one
                      person, or leave it blank for an open link.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      autoFocus
                      placeholder="teammate@company.com (optional)"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleGenerate();
                      }}
                      className="sm:flex-1"
                      aria-label="Teammate email (optional)"
                    />
                    <div className="flex gap-2">
                      <Button
                        onClick={handleGenerate}
                        disabled={createInvite.isPending}
                        className="flex-1 sm:flex-none"
                      >
                        {createInvite.isPending ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <UserPlus />
                        )}
                        Generate link
                      </Button>
                      <Button variant="ghost" onClick={closeComposer}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* One dialog for every destructive admin action (remove / revoke /
            pause), driven by `pendingAction`. */}
        <ConfirmDialog
          open={!!pendingAction}
          onOpenChange={(open) => !open && setPendingAction(null)}
          isLoading={confirm.isLoading}
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
        <UserPlus size={20} />
      </span>
      <p className="mt-1 text-sm font-medium text-foreground">No team yet</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        Your team will appear here once it is set up.
      </p>
    </div>
  );
}
