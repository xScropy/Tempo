import { ArrowDown, ArrowUp, Ban, BellOff, Check, Copy, Lock, LogOut, MoreHorizontal, Play, Plus, RefreshCw, Search, Trophy, UserPlus, Users, Wifi, WifiOff, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { isTauri } from "@/db/driver";
import { atTime, addDays, fmtDuration, todayStr, weekdayName } from "@/domain/dates";
import { attempt, toast } from "@/lib/notify";
import { setSetting } from "@/store/actions";
import { useData, type Settings } from "@/store/data";
import { startSession } from "@/store/timer";
import { confirmDialog, navigate, useUi } from "@/store/ui";
import { joinSocial, leaveSocial, connectSocial, groupCode, isGroup, social, useHost, useSocial, type JoinInput } from "@/social/client";
import { DEFAULT_PRIVACY, REACTIONS, REACTION_LABEL, type ChallengeInput, type ChallengeView, type FriendView, type Privacy, type PublicProfile, type RoomView, type Snapshot } from "@/social/protocol";
import { Badge, Button, Checkbox, CommitInput, Dialog, Empty, Field, IconButton, Input, Menu, PageHeader, Progress, Section, Segmented, Select, Stat, Textarea, cx } from "@/components/ui";
import { Avatar, DayBars, METRIC_LABEL, PresenceLine, fmtMetric, hrs, leaderboard, pct, usePeople, type BoardMetric } from "./social-bits";

const call = (t: string, d?: unknown) => attempt(() => social(t, d));

const PRIVACY_LABEL: Array<[keyof Privacy, string, string]> = [
  ["activity", "Current activity", "Friends see when you are focusing or on a break (otherwise just Online)"],
  ["sessionTime", "Current session time", "Elapsed and remaining time of the session you are in"],
  ["weekly", "Weekly focus hours", ""],
  ["daily", "Daily focus hours", "The per-day chart and number of productive days"],
  ["sessions", "Pomodoro and session counts", ""],
  ["streak", "Streak", ""],
  ["goal", "Weekly goal progress", ""],
  ["profile", "Profile details", "Bio, status and achievement badges"],
  ["objective", "Session objective text", "The one piece of free text that can be shared. Off unless you turn it on."],
];

function PrivacyToggles({ value, onChange, onToggle }: { value: Privacy; onChange?: (p: Privacy) => void; onToggle?: (key: keyof Privacy, on: boolean) => void }) {
  return (
    <div className="space-y-2">
      {PRIVACY_LABEL.map(([k, label, hint]) => (
        <Checkbox key={k} checked={value[k]} onChange={(v) => (onToggle ? onToggle(k, v) : onChange?.({ ...value, [k]: v }))} label={<span>{label}{hint && <span className="block text-xs text-ink-3">{hint}</span>}</span>} className="!items-start [&>input]:mt-1" />
      ))}
      <div className="flex gap-2 pt-1 text-xs text-ink-2">
        <Lock size={13} className="mt-px shrink-0" />
        Task titles, project names, notes, calendar events and journal entries are never sent — there is no setting that shares them.
      </div>
    </div>
  );
}

// ---- joining ------------------------------------------------------------------

function Onboarding() {
  const error = useSocial((s) => s.error);
  const conn = useSocial((s) => s.conn);
  const saved = useData((s) => s.settings.social);
  const profile = useData((s) => s.profile);
  const [mode, setMode] = useState<JoinInput["mode"]>("new-group");
  const [f, setF] = useState({ url: "", code: "", port: "47800", username: "", displayName: profile?.display_name ?? "" });
  const [privacy, setPrivacy] = useState<Privacy>(DEFAULT_PRIVACY);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  if (saved) {
    return (
      <Empty
        icon={<WifiOff size={28} />}
        title={conn === "connecting" ? "Connecting…" : "Not connected"}
        body={`${error ?? "The group or server is unreachable."} Everything else in Tempo keeps working, and Tempo keeps retrying.`}
        action={
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void connectSocial()}>Retry now</Button>
            <Button onClick={() => void confirmDialog({ title: "Forget this social profile?", body: "This device will forget its login for the social server. Your tasks, time and other local data are not affected.", confirmLabel: "Forget profile", danger: true }).then((ok) => ok && attempt(leaveSocial))}>Forget profile</Button>
          </div>
        }
      />
    );
  }

  const submit = async () => {
    setBusy(true);
    await attempt(() => joinSocial({ mode, url: f.url, code: f.code, port: Number(f.port) || 47800, username: f.username, displayName: f.displayName, privacy }));
    setBusy(false);
  };
  const ready = f.username && f.displayName && (mode === "new-group" || (mode === "join-group" ? f.code.replace(/[^a-z0-9]/gi, "").length === 16 : mode === "server" ? f.url.trim() : isTauri()));

  return (
    <div className="mx-auto max-w-[640px] space-y-4 py-6">
      <div>
        <h2 className="text-xl font-semibold">Work alongside friends</h2>
        <p className="mt-1 text-sm text-ink-2">See when friends are focusing, compare weekly progress, run challenges and focus together. It is optional: Tempo works fully without it, and nothing is shared until you create a profile here.</p>
      </div>
      <Section title="1 · How will you connect?">
        <div className="space-y-3 px-3 py-3">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["new-group", "Start a group", "You get a code to send to friends. Works across different networks."],
                ["join-group", "Join with a code", "A friend already started a group and sent you its code."],
              ] as const
            ).map(([m, title, text]) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cx("rounded-md border px-3 py-2.5 text-left", mode === m ? "border-accent bg-accent/5" : "border-line-strong hover:bg-hover/50")}>
                <div className="font-medium">{title}</div>
                <div className="mt-0.5 text-xs text-ink-2">{text}</div>
              </button>
            ))}
          </div>
          {mode === "new-group" && (
            <div className="rounded border border-line bg-raised px-3 py-2 text-xs text-ink-2">
              Your computer becomes the meeting point: <strong className="text-ink">the group is reachable while your Tempo is open</strong>. Messages travel through a public relay on the internet and are encrypted with the group code, so the relay cannot read them. No account or server is needed.
            </div>
          )}
          {mode === "join-group" && (
            <Field label="Group code" hint="16 characters, like 1ABC-DEFG-HJKM-NPQR. The friend who started the group needs to have Tempo open.">
              <Input className="font-mono tracking-wider" value={f.code} placeholder="1ABC-DEFG-HJKM-NPQR" onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
            </Field>
          )}
          <button type="button" className="text-xs text-ink-3 underline hover:text-ink-2" onClick={() => setAdvanced(!advanced)}>
            {advanced ? "Hide" : "Other ways to connect"} (your own server, or the same Wi-Fi without internet)
          </button>
          {advanced && (
            <div className="space-y-3 border-t border-line pt-3">
              <Segmented value={mode === "server" || mode === "lan" ? mode : ("" as never)} onChange={setMode} options={[{ value: "server", label: "Server address" }, { value: "lan", label: "Host on this network" }]} />
              {mode === "server" && (
                <Field label="Server address" hint="A Tempo social server someone runs for you (always on, no host needed). See docs/SOCIAL.md.">
                  <Input value={f.url} placeholder="wss://your-server.example  or  ws://192.168.1.20:47800" onChange={(e) => setF({ ...f, url: e.target.value })} />
                </Field>
              )}
              {mode === "lan" && (
                <Field label="Port" hint={isTauri() ? "Friends on the same Wi-Fi connect straight to this computer, without the internet. Your firewall may ask for permission." : "Needs the desktop app."}>
                  <Input className="!w-32" type="number" value={f.port} disabled={!isTauri()} onChange={(e) => setF({ ...f, port: e.target.value })} />
                </Field>
              )}
            </div>
          )}
        </div>
      </Section>
      <Section title="2 · Your profile">
        <div className="grid grid-cols-2 gap-3 px-3 py-3">
          <Field label="Username" hint="How friends find you. 3–20 letters, numbers or _">
            <Input value={f.username} placeholder="youssef" onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} />
          </Field>
          <Field label="Display name">
            <Input value={f.displayName} placeholder="Youssef" onChange={(e) => setF({ ...f, displayName: e.target.value })} />
          </Field>
        </div>
      </Section>
      <Section title="3 · What friends may see">
        <div className="px-3 py-3">
          <PrivacyToggles value={privacy} onChange={setPrivacy} />
        </div>
      </Section>
      <div className="flex items-center gap-3">
        <Button variant="primary" className="!h-9" disabled={busy || !ready} onClick={() => void submit()}>
          {busy ? "Connecting…" : mode === "new-group" ? "Create profile and start the group" : "Create profile and connect"}
        </Button>
        <span className="text-xs text-ink-3">You can change every choice later, or leave at any time.</span>
      </div>
    </div>
  );
}

// ---- friends ------------------------------------------------------------------

function FriendDialog({ friend, onClose }: { friend: FriendView; onClose: () => void }) {
  const prefs = useData((s) => s.settings.socialPrefs);
  const [period, setPeriod] = useState<"week" | "lastWeek" | "month">("week");
  const s = friend[period];
  const muted = prefs.muted.includes(friend.id);
  const p = pct(s);
  return (
    <Dialog open onClose={onClose} title={friend.displayName} width={560}>
      <div className="flex items-center gap-3">
        <Avatar user={friend} size={48} />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-ink-2">@{friend.username}{friend.statusText ? ` · ${friend.statusText}` : ""}</div>
          <PresenceLine presence={friend.presence} />
          {friend.bio && <div className="mt-1 text-sm">{friend.bio}</div>}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <Segmented size="sm" value={period} onChange={setPeriod} options={[{ value: "week", label: "This week" }, { value: "lastWeek", label: "Last week" }, { value: "month", label: "This month" }]} />
        {friend.streak != null && <span className="text-xs text-ink-2">{friend.streak}-day streak</span>}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-3">
        <Stat label="Focus time" value={hrs(s.seconds)} sub={s.targetSeconds ? `of ${fmtDuration(s.targetSeconds)} target` : undefined} />
        <Stat label="Goal" value={p == null ? "—" : `${(p * 100).toFixed(1)}%`} />
        <Stat label="Sessions" value={s.sessions ?? "—"} sub={s.pomodoros != null ? `${s.pomodoros} Pomodoros` : undefined} />
        <Stat label="Productive days" value={s.productiveDays == null ? "—" : `${s.productiveDays}/${s.days?.length ?? 7}`} sub={s.days && s.seconds != null ? `${fmtDuration(s.seconds / Math.max(1, s.days.length))} / day avg` : undefined} />
      </div>
      {p != null && <Progress value={p} tone={p >= 1 ? "ok" : "accent"} className="mt-2" />}
      <div className="mt-4 rounded border border-line px-3 py-3">
        {s.days ? <DayBars days={s.days} labels={s.days.length === 7 ? Array.from({ length: 7 }, (_, i) => weekdayName((useData.getState().settings.weekStart + i) % 7)) : undefined} /> : <div className="py-4 text-center text-sm text-ink-3">{friend.displayName} does not share daily activity.</div>}
      </div>
      {friend.badges.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {friend.badges.map((b) => (
            <Badge key={b} tone="accent"><Trophy size={10} /> {b}</Badge>
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
        <span className="mr-1 text-xs text-ink-2">Encourage</span>
        {REACTIONS.map((r) => (
          <Button key={r} size="sm" onClick={() => void call("cheer", { userId: friend.id, kind: r }).then((ok) => ok && toast("Sent", `${friend.displayName} will see “${REACTION_LABEL[r]}”.`, "ok"))}>{REACTION_LABEL[r]}</Button>
        ))}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" icon={<BellOff size={12} />} onClick={() => void attempt(() => setSetting("socialPrefs", { ...prefs, muted: muted ? prefs.muted.filter((x) => x !== friend.id) : [...prefs.muted, friend.id] }))}>{muted ? "Unmute" : "Mute"}</Button>
      </div>
    </Dialog>
  );
}

function AddFriend() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PublicProfile[] | null>(null);
  const [code, setCode] = useState("");
  useEffect(() => {
    if (q.trim().length < 2) return setHits(null);
    const t = setTimeout(() => void social<PublicProfile[]>("friend.search", { query: q }).then(setHits).catch(() => setHits([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Section title="Add a friend">
      <div className="space-y-2 px-3 py-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2 text-ink-3" />
          <Input className="!pl-8" placeholder="Search by username" aria-label="Search by username" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {hits?.length === 0 && <div className="text-xs text-ink-3">No one with a username starting “{q}”.</div>}
        {hits?.map((u) => (
          <div key={u.id} className="flex items-center gap-2">
            <Avatar user={u} size={24} />
            <span className="min-w-0 flex-1 truncate text-sm">{u.displayName} <span className="text-ink-3">@{u.username}</span></span>
            <Button size="sm" icon={<UserPlus size={12} />} onClick={() => void call("friend.request", { username: u.username }).then((ok) => ok && (toast("Request sent", `to ${u.displayName}`, "ok"), setQ("")))}>Add</Button>
          </div>
        ))}
        <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), void call("friend.request", { inviteCode: code }).then((ok) => ok && (toast("Request sent", undefined, "ok"), setCode(""))))}>
          <Input placeholder="…or paste an invitation code" aria-label="Invitation code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button type="submit" disabled={code.trim().length < 6}>Send</Button>
        </form>
      </div>
    </Section>
  );
}

type FriendSort = "working" | "hours" | "goal" | "recent";

function FriendsTab({ snap }: { snap: Snapshot }) {
  const prefs = useData((s) => s.settings.socialPrefs);
  const people = usePeople();
  const [sort, setSort] = useState<FriendSort>("working");
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "online" | "focusing">("all");
  const [open, setOpen] = useState<string | null>(null);
  const friends = useMemo(() => {
    const order = { focusing: 0, break: 1, online: 2, idle: 3, offline: 4 };
    const list = snap.friends.filter((f) => (!q || `${f.displayName} ${f.username}`.toLowerCase().includes(q.toLowerCase())) && (only === "all" || (only === "focusing" ? f.presence.status === "focusing" : f.presence.status !== "offline")));
    return list.sort((a, b) =>
      sort === "hours" ? (b.week.seconds ?? -1) - (a.week.seconds ?? -1) : sort === "goal" ? (pct(b.week) ?? -1) - (pct(a.week) ?? -1) : sort === "recent" ? b.presence.lastSeen - a.presence.lastSeen : order[a.presence.status] - order[b.presence.status] || (b.week.seconds ?? 0) - (a.week.seconds ?? 0),
    );
  }, [snap.friends, sort, q, only]);
  const online = snap.friends.filter((f) => f.presence.status !== "offline").length;
  const focusing = snap.friends.filter((f) => f.presence.status === "focusing").length;
  const myRank = leaderboard(people, "focus", "week").find((r) => r.person.id === snap.me.id)?.rank;
  const opened = snap.friends.find((f) => f.id === open);
  const active = snap.challenges.filter((c) => c.joined && c.state === "active");
  const upcoming = snap.challenges.filter((c) => c.state === "upcoming" || (c.invited && c.state !== "finished"));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 rounded-md border border-line bg-surface px-4 py-3 md:grid-cols-4">
        <Stat label="Friends online" value={`${online}`} sub={`of ${snap.friends.length}`} />
        <Stat label="Focusing now" value={<span className={focusing ? "text-ok" : undefined}>{focusing}</span>} />
        <Stat label="Your focus this week" value={hrs(snap.me.week.seconds)} sub={snap.me.week.targetSeconds ? `${Math.round((pct(snap.me.week) ?? 0) * 100)}% of ${fmtDuration(snap.me.week.targetSeconds)}` : "no weekly target set"} />
        <Stat label="Your position" value={myRank ? `#${myRank}` : "—"} sub="by focus hours this week" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {snap.incoming.length > 0 && (
            <Section title={`Friend requests · ${snap.incoming.length}`}>
              {snap.incoming.map((r) => (
                <div key={r.id} className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-0">
                  <Avatar user={r.from} />
                  <span className="min-w-0 flex-1 truncate">{r.from.displayName} <span className="text-ink-3">@{r.from.username}</span></span>
                  <Button size="sm" variant="primary" icon={<Check size={12} />} onClick={() => void call("friend.respond", { requestId: r.id, accept: true })}>Accept</Button>
                  <Button size="sm" onClick={() => void call("friend.respond", { requestId: r.id, accept: false })}>Decline</Button>
                  <IconButton label={`Block ${r.from.displayName}`} onClick={() => void call("user.block", { userId: r.from.id, on: true })}><Ban size={13} /></IconButton>
                </div>
              ))}
            </Section>
          )}
          <Section
            title={`Friends · ${snap.friends.length}`}
            action={
              <div className="flex items-center gap-1.5">
                <Input className="!h-6 !w-32 !text-sm" placeholder="Filter" aria-label="Filter friends" value={q} onChange={(e) => setQ(e.target.value)} />
                <Select className="!w-28 [&>select]:!h-6 [&>select]:!text-sm" aria-label="Show" value={only} onChange={(e) => setOnly(e.target.value as typeof only)}>
                  <option value="all">Everyone</option>
                  <option value="online">Online</option>
                  <option value="focusing">Focusing</option>
                </Select>
                <Select className="!w-40 [&>select]:!h-6 [&>select]:!text-sm" aria-label="Sort friends" value={sort} onChange={(e) => setSort(e.target.value as FriendSort)}>
                  <option value="working">Working now first</option>
                  <option value="hours">Weekly focus hours</option>
                  <option value="goal">Weekly goal progress</option>
                  <option value="recent">Most recent activity</option>
                </Select>
              </div>
            }
          >
            {snap.friends.length === 0 && <Empty icon={<Users size={26} />} title="No friends yet" body="Search for a username, or exchange invitation codes. Your own code is under Profile." />}
            {friends.map((f) => {
              const p = pct(f.week);
              const inChallenges = snap.challenges.filter((c) => c.state !== "finished" && c.standings.some((s) => s.user.id === f.id)).length;
              return (
                <div key={f.id} className="group flex items-center gap-3 border-b border-line px-3 py-2 last:border-0 hover:bg-hover/40">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOpen(f.id)}>
                    <Avatar user={f} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{f.displayName}</span>
                        <span className="truncate text-xs text-ink-3">@{f.username}</span>
                        {prefs.muted.includes(f.id) && <BellOff size={11} className="text-ink-3" aria-label="Muted" />}
                      </span>
                      <PresenceLine presence={f.presence} />
                    </span>
                    <span className="w-36 shrink-0">
                      <span className="tabular flex justify-between text-xs text-ink-2">
                        <span>{hrs(f.week.seconds)}</span>
                        <span>{p == null ? "" : `${Math.round(p * 100)}%`}</span>
                      </span>
                      <Progress value={p ?? 0} tone={p != null && p >= 1 ? "ok" : "accent"} className="mt-1" />
                      <span className="mt-0.5 block text-2xs text-ink-3">{f.week.seconds == null ? "hours not shared" : p == null ? "this week" : "of weekly goal"}{inChallenges ? ` · ${inChallenges} challenge${inChallenges === 1 ? "" : "s"}` : ""}</span>
                    </span>
                  </button>
                  <Menu
                    align="end"
                    trigger={<IconButton label={`Options for ${f.displayName}`}><MoreHorizontal size={15} /></IconButton>}
                    items={[
                      { label: "View profile", onSelect: () => setOpen(f.id) },
                      { label: prefs.muted.includes(f.id) ? "Unmute notifications" : "Mute notifications", icon: <BellOff size={13} />, onSelect: () => void attempt(() => setSetting("socialPrefs", { ...prefs, muted: prefs.muted.includes(f.id) ? prefs.muted.filter((x) => x !== f.id) : [...prefs.muted, f.id] })) },
                      "sep",
                      { label: "Remove friend", danger: true, onSelect: () => void confirmDialog({ title: `Remove ${f.displayName}?`, body: "You will stop seeing each other's activity. You can add each other again later.", confirmLabel: "Remove", danger: true }).then((ok) => ok && call("friend.remove", { userId: f.id })) },
                      { label: "Block", icon: <Ban size={13} />, danger: true, onSelect: () => void confirmDialog({ title: `Block ${f.displayName}?`, body: "They are removed from your friends, cannot find you or send you requests, and are not told.", confirmLabel: "Block", danger: true }).then((ok) => ok && call("user.block", { userId: f.id, on: true })) },
                    ]}
                  />
                </div>
              );
            })}
          </Section>
          {snap.outgoing.length > 0 && (
            <Section title="Sent requests">
              {snap.outgoing.map((r) => (
                <div key={r.id} className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-0">
                  <Avatar user={r.to} size={24} />
                  <span className="min-w-0 flex-1 truncate text-sm">{r.to.displayName} <span className="text-ink-3">@{r.to.username} · waiting</span></span>
                  <Button size="sm" onClick={() => void call("friend.cancel", { requestId: r.id })}>Cancel request</Button>
                </div>
              ))}
            </Section>
          )}
        </div>
        <div className="space-y-4">
          <AddFriend />
          <Section title="Challenges" action={<Button size="sm" variant="ghost" onClick={() => navigate("friends", "challenges")}>All</Button>}>
            {active.length + upcoming.length === 0 && <div className="px-3 py-3 text-sm text-ink-2">No active or upcoming challenges.</div>}
            {[...active, ...upcoming.filter((c) => !active.includes(c))].slice(0, 5).map((c) => {
              const mine = c.standings.find((s) => s.user.id === snap.me.id);
              return (
                <button key={c.id} type="button" onClick={() => navigate("friends", "challenges")} className="block w-full border-b border-line px-3 py-2 text-left last:border-0 hover:bg-hover/40">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                    {c.invited ? <Badge tone="warn">Invited</Badge> : c.state === "upcoming" ? <Badge>Upcoming</Badge> : mine ? <Badge tone="accent">#{mine.rank}</Badge> : null}
                  </div>
                  <div className="text-xs text-ink-3">{c.standings.length} participant{c.standings.length === 1 ? "" : "s"} · {timeLeft(c, snap.serverNow)}</div>
                </button>
              );
            })}
          </Section>
          <Section title="Recent achievements" action={<Button size="sm" variant="ghost" onClick={() => navigate("friends", "activity")}>All</Button>}>
            {snap.feed.length === 0 && <div className="px-3 py-3 text-sm text-ink-2">Achievements from you and your friends appear here.</div>}
            {snap.feed.slice(0, 5).map((f) => (
              <div key={f.id} className="flex gap-2 border-b border-line px-3 py-1.5 text-sm last:border-0">
                <Avatar user={f.user} size={20} />
                <span className="min-w-0 flex-1"><span className="font-medium">{f.user.displayName}</span> <span className="text-ink-2">{f.text}</span></span>
              </div>
            ))}
          </Section>
        </div>
      </div>
      {opened && <FriendDialog friend={opened} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ---- activity -----------------------------------------------------------------

function ActivityTab({ snap }: { snap: Snapshot }) {
  if (!snap.feed.length) return <Empty title="Nothing yet" body="Completed sessions, reached targets and challenge results from you and your friends will be listed here. It only ever contains productivity milestones." />;
  return (
    <div className="mx-auto max-w-[720px] rounded-md border border-line bg-surface">
      {snap.feed.map((f) => (
        <div key={f.id} className="flex gap-3 border-b border-line px-3 py-2.5 last:border-0">
          <Avatar user={f.user} size={32} />
          <div className="min-w-0 flex-1">
            <div><span className="font-medium">{f.user.displayName}</span> <span className="text-ink-2">{f.text}</span></div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-ink-3">{new Date(f.at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
              {REACTIONS.map((r) => {
                const who = f.reactions[r] ?? [];
                const mine = who.includes(snap.me.id);
                return (
                  <button key={r} type="button" aria-pressed={mine} onClick={() => void call("feed.react", { id: f.id, kind: r })} className={cx("h-6 rounded-full border px-2 text-xs", mine ? "border-accent bg-accent/10 text-accent" : who.length ? "border-line-strong text-ink-2" : "border-transparent text-ink-3 hover:border-line-strong hover:text-ink-2")}>
                    {REACTION_LABEL[r]}{who.length ? ` · ${who.length}` : ""}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- leaderboard --------------------------------------------------------------

function LeaderboardTab({ snap }: { snap: Snapshot }) {
  const people = usePeople();
  const [metric, setMetric] = useState<BoardMetric>("focus");
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [scope, setScope] = useState("friends");
  const group = snap.challenges.find((c) => c.id === scope);
  const rows = useMemo(() => leaderboard(group ? people.filter((p) => group.standings.some((s) => s.user.id === p.id)) : people, metric, period), [people, metric, period, group]);
  return (
    <div className="mx-auto max-w-[760px] space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="!w-64" aria-label="Ranking metric" value={metric} onChange={(e) => setMetric(e.target.value as BoardMetric)}>
          {(Object.keys(METRIC_LABEL) as BoardMetric[]).map((m) => (
            <option key={m} value={m}>{METRIC_LABEL[m]}</option>
          ))}
        </Select>
        <Segmented value={period} onChange={setPeriod} options={[{ value: "week", label: "This week" }, { value: "month", label: "This month" }]} />
        <Select className="!w-56" aria-label="Who to compare" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="friends">All friends</option>
          {snap.challenges.map((c) => (
            <option key={c.id} value={c.id}>Group: {c.name}</option>
          ))}
        </Select>
      </div>
      <div className="rounded-md border border-line bg-surface">
        {rows.map((r) => (
          <div key={r.person.id} className={cx("flex items-center gap-3 border-b border-line px-3 py-2 last:border-0", r.person.me && "bg-accent/5")}>
            <span className={cx("tabular w-7 text-center text-base font-semibold", r.rank === 1 ? "text-accent" : r.rank == null ? "text-ink-3" : "text-ink-2")}>{r.rank ?? "–"}</span>
            <Avatar user={r.person} size={30} />
            <span className="min-w-0 flex-1 truncate">{r.person.displayName}{r.person.me && <span className="text-ink-3"> (you)</span>} <span className="text-xs text-ink-3">@{r.person.username}</span></span>
            <span className={cx("tabular text-sm font-medium", r.value == null && "font-normal text-ink-3")}>{fmtMetric(metric, r.value)}</span>
            <span className="tabular flex w-12 items-center justify-end gap-0.5 text-xs" title="Change in rank compared with last week">
              {r.change == null || r.change === 0 ? <span className="text-ink-3">–</span> : r.change > 0 ? <span className="flex items-center text-ok"><ArrowUp size={11} />{r.change}</span> : <span className="flex items-center text-danger"><ArrowDown size={11} />{-r.change}</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="text-xs text-ink-3">
        {metric === "goal" ? "Share of each person's own weekly target — a 5-hour goal fully met beats a 20-hour goal half met." : metric === "consistency" ? "Days with at least 30 minutes of focus. Showing up counts as much as total hours." : "Arrows show movement compared with last week."} People who do not share a statistic are listed without a rank.
      </div>
    </div>
  );
}

// ---- challenges ---------------------------------------------------------------

function timeLeft(c: ChallengeView, now: number): string {
  if (c.state === "finished") return "ended";
  const ms = (c.state === "upcoming" ? c.start : c.end) - now;
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return `${c.state === "upcoming" ? "starts in" : "ends in"} ${d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h` : `${Math.max(1, Math.round(ms / 60_000))}m`}`;
}

const fmtValue = (c: ChallengeView, v: number) => (c.metric === "focus_seconds" ? fmtDuration(v) : c.metric === "sessions" ? `${v} session${v === 1 ? "" : "s"}` : `${v} day${v === 1 ? "" : "s"}`);
const ELIG = { verified: "Only sessions the server saw live", tracked: "Timer sessions only (no manual entries)", all: "All tracked time, including manual entries" };
const PRESETS: Record<ChallengeInput["type"], { label: string; name: string; metric: ChallengeInput["metric"]; target: string; winner: ChallengeInput["winner"]; hint: string }> = {
  focus_hours: { label: "Focus hours", name: "Most focus hours this week", metric: "focus_seconds", target: "", winner: "highest", hint: "Whoever tracks the most eligible focus time wins." },
  goal: { label: "Weekly goal", name: "15 hours of studying this week", metric: "focus_seconds", target: "15", winner: "first", hint: "Everyone works toward the same number of hours; first to reach it leads." },
  pomodoro: { label: "Pomodoro", name: "30 Pomodoro sessions in 7 days", metric: "sessions", target: "30", winner: "first", hint: "Counts completed focus sessions." },
  consistency: { label: "Consistency", name: "Focus at least 1 hour every day", metric: "days", target: "7", winner: "highest", hint: "Counts days on which the daily minimum was reached." },
  custom: { label: "Custom", name: "", metric: "focus_seconds", target: "", winner: "highest", hint: "Choose the metric, target and winning rule yourself." },
};

function ChallengeDialog({ friends, onClose }: { friends: FriendView[]; onClose: () => void }) {
  const today = todayStr();
  const [type, setType] = useState<ChallengeInput["type"]>("focus_hours");
  const [f, setF] = useState({ name: PRESETS.focus_hours.name, description: "", metric: "focus_seconds" as ChallengeInput["metric"], target: "", winner: "highest" as ChallengeInput["winner"], minDaily: "60", eligibility: "tracked" as ChallengeInput["eligibility"], start: today, end: addDays(today, 7), invite: [] as string[] });
  const pick = (t: ChallengeInput["type"]) => {
    const p = PRESETS[t];
    setType(t);
    setF({ ...f, name: p.name, metric: p.metric, target: p.target, winner: p.winner });
  };
  const submit = async () => {
    const n = Number(f.target);
    const target = f.target.trim() && n > 0 ? (f.metric === "focus_seconds" ? Math.round(n * 3600) : Math.round(n)) : null;
    const input: ChallengeInput = {
      name: f.name, description: f.description, type, metric: f.metric, target, winner: f.winner, minDailySeconds: Math.max(60, Math.round((Number(f.minDaily) || 60) * 60)), eligibility: f.eligibility,
      start: atTime(f.start, "00:00"), end: atTime(f.end, "00:00"), invite: f.invite,
    };
    if (await call("challenge.create", input)) onClose();
  };
  return (
    <Dialog open onClose={onClose} title="New challenge" width={600} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.name.trim()} onClick={() => void submit()}>Create challenge</Button></>}>
      <Segmented value={type} onChange={pick} options={(Object.keys(PRESETS) as ChallengeInput["type"][]).map((t) => ({ value: t, label: PRESETS[t].label }))} />
      <p className="mt-2 text-sm text-ink-2">{PRESETS[type].hint}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Name" className="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Description (optional)" className="col-span-2"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Measured by">
          <Select value={f.metric} disabled={type !== "custom"} onChange={(e) => setF({ ...f, metric: e.target.value as ChallengeInput["metric"] })}>
            <option value="focus_seconds">Focus time</option>
            <option value="sessions">Completed sessions</option>
            <option value="days">Days meeting a daily minimum</option>
          </Select>
        </Field>
        <Field label={f.metric === "focus_seconds" ? "Target (hours)" : f.metric === "sessions" ? "Target (sessions)" : "Target (days)"} hint="Leave empty for “highest wins”.">
          <Input type="number" min={0} step="any" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />
        </Field>
        {f.metric === "days" && (
          <Field label="Daily minimum (minutes)"><Input type="number" min={1} value={f.minDaily} onChange={(e) => setF({ ...f, minDaily: e.target.value })} /></Field>
        )}
        <Field label="Winner">
          <Select value={f.winner} onChange={(e) => setF({ ...f, winner: e.target.value as ChallengeInput["winner"] })}>
            <option value="highest">Highest total at the end</option>
            <option value="first">First to reach the target</option>
          </Select>
        </Field>
        <Field label="Starts (beginning of this day)"><Input type="date" min={today} value={f.start} onChange={(e) => e.target.value && setF({ ...f, start: e.target.value })} /></Field>
        <Field label="Ends (start of this day)"><Input type="date" min={addDays(f.start, 1)} value={f.end} onChange={(e) => e.target.value && setF({ ...f, end: e.target.value })} /></Field>
        <Field label="What counts" className="col-span-2">
          <Select value={f.eligibility} onChange={(e) => setF({ ...f, eligibility: e.target.value as ChallengeInput["eligibility"] })}>
            {(Object.keys(ELIG) as Array<keyof typeof ELIG>).map((k) => (
              <option key={k} value={k}>{ELIG[k]}</option>
            ))}
          </Select>
        </Field>
        <Field group label="Invite friends" hint="Invited friends must join themselves. The challenge is visible only to its participants and invitees." className="col-span-2">
          <div className="flex flex-wrap gap-1.5">
            {friends.length === 0 && <span className="text-sm text-ink-3">Add friends first to invite them. You can still run it on your own.</span>}
            {friends.map((u) => {
              const on = f.invite.includes(u.id);
              return (
                <button key={u.id} type="button" aria-pressed={on} onClick={() => setF({ ...f, invite: on ? f.invite.filter((x) => x !== u.id) : [...f.invite, u.id] })} className={cx("flex h-7 items-center gap-1.5 rounded-full border pl-1 pr-2.5 text-sm", on ? "border-accent bg-accent/10 text-accent" : "border-line-strong text-ink-2 hover:bg-hover")}>
                  <Avatar user={u} size={20} /> {u.displayName}
                </button>
              );
            })}
          </div>
        </Field>
      </div>
    </Dialog>
  );
}

function ChallengeCard({ c, snap }: { c: ChallengeView; snap: Snapshot }) {
  const [inviting, setInviting] = useState(false);
  const isCreator = c.creator.id === snap.me.id;
  const invitable = snap.friends.filter((f) => !c.standings.some((s) => s.user.id === f.id) && !c.invitedUsers.some((u) => u.id === f.id));
  const max = Math.max(1, ...c.standings.map((s) => s.value));
  return (
    <Section
      title={<span className="normal-case tracking-normal text-ink"><span className="text-base font-semibold">{c.name}</span></span>}
      action={
        <div className="flex items-center gap-1.5">
          <Badge tone={c.state === "active" ? "ok" : c.state === "upcoming" ? "neutral" : "neutral"}>{c.state === "active" ? "Active" : c.state === "upcoming" ? "Upcoming" : "Finished"}</Badge>
          <span className="tabular text-xs text-ink-2">{timeLeft(c, snap.serverNow)}</span>
          {c.invited && <Button size="sm" variant="primary" onClick={() => void call("challenge.join", { id: c.id })}>Join</Button>}
          {(c.joined || c.invited) && c.state !== "finished" && <Button size="sm" onClick={() => void confirmDialog({ title: c.joined ? `Leave “${c.name}”?` : "Decline this invitation?", confirmLabel: c.joined ? "Leave" : "Decline", danger: true }).then((ok) => ok && call("challenge.leave", { id: c.id }))}>{c.joined ? "Leave" : "Decline"}</Button>}
          {isCreator && c.state !== "finished" && invitable.length > 0 && <Button size="sm" icon={<UserPlus size={12} />} onClick={() => setInviting(!inviting)}>Invite</Button>}
          {isCreator && <IconButton label="Delete challenge" onClick={() => void confirmDialog({ title: `Delete “${c.name}” for everyone?`, confirmLabel: "Delete", danger: true }).then((ok) => ok && call("challenge.delete", { id: c.id }))}><X size={14} /></IconButton>}
        </div>
      }
    >
      <div className="px-3 py-2 text-xs text-ink-2">
        {c.description && <div className="mb-1 text-sm text-ink">{c.description}</div>}
        {c.target != null ? `Target: ${fmtValue(c, c.target)} · ` : ""}{c.winner === "first" ? "first to reach it leads" : "highest total wins"} · {ELIG[c.eligibility].toLowerCase()}
        {c.metric === "days" ? ` · a day counts from ${fmtDuration(c.minDailySeconds)}` : ""} · created by {c.creator.displayName}
      </div>
      {inviting && (
        <div className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2">
          {invitable.map((u) => (
            <Button key={u.id} size="sm" onClick={() => void call("challenge.invite", { id: c.id, users: [u.id] })}><Avatar user={u} size={16} /> {u.displayName}</Button>
          ))}
        </div>
      )}
      <div className="border-t border-line">
        {c.standings.map((s) => (
          <div key={s.user.id} className={cx("flex items-center gap-3 px-3 py-1.5", s.user.id === snap.me.id && "bg-accent/5")}>
            <span className={cx("tabular w-5 text-center text-sm font-semibold", s.rank === 1 && s.value > 0 ? "text-accent" : "text-ink-2")}>{s.rank}</span>
            <Avatar user={s.user} size={24} />
            <span className="w-32 shrink-0 truncate text-sm">{s.user.displayName}</span>
            <Progress value={s.progress ?? s.value / max} tone={s.reachedAt ? "ok" : "accent"} className="flex-1" />
            <span className="tabular w-24 shrink-0 text-right text-sm">{fmtValue(c, s.value)}</span>
            <span className="tabular w-10 shrink-0 text-right text-xs text-ink-2">{s.progress != null ? `${Math.round(s.progress * 100)}%` : ""}</span>
          </div>
        ))}
        {c.invitedUsers.length > 0 && <div className="px-3 py-1.5 text-xs text-ink-3">Invited, not joined yet: {c.invitedUsers.map((u) => u.displayName).join(", ")}</div>}
      </div>
      {c.events.length > 0 && (
        <div className="border-t border-line px-3 py-2 text-xs text-ink-2">
          {c.events.slice(0, 4).map((e, i) => (
            <div key={i} className="flex gap-2"><span className="tabular w-28 shrink-0 text-ink-3">{new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>{e.text}</div>
          ))}
        </div>
      )}
    </Section>
  );
}

function ChallengesTab({ snap }: { snap: Snapshot }) {
  const [creating, setCreating] = useState(false);
  const [show, setShow] = useState<"current" | "history">("current");
  const list = snap.challenges.filter((c) => (show === "history" ? c.state === "finished" : c.state !== "finished")).sort((a, b) => (show === "history" ? b.end - a.end : Number(b.invited) - Number(a.invited) || a.end - b.end));
  return (
    <div className="mx-auto max-w-[860px] space-y-3">
      <div className="flex items-center gap-2">
        <Segmented value={show} onChange={setShow} options={[{ value: "current", label: "Active and upcoming" }, { value: "history", label: "History" }]} />
        <span className="flex-1" />
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>New challenge</Button>
      </div>
      {list.length === 0 && <Empty icon={<Trophy size={26} />} title={show === "history" ? "No finished challenges yet" : "No challenges running"} body="Challenges are private to the people in them and scored from tracked time on the server, inside the challenge's dates only." action={show === "current" ? <Button onClick={() => setCreating(true)}>Create a challenge</Button> : undefined} />}
      {list.map((c) => (
        <ChallengeCard key={c.id} c={c} snap={snap} />
      ))}
      {creating && <ChallengeDialog friends={snap.friends} onClose={() => setCreating(false)} />}
    </div>
  );
}

// ---- focus together -----------------------------------------------------------

function RoomCard({ room, snap }: { room: RoomView; snap: Snapshot }) {
  const now = useSocial((s) => s.now);
  const offset = useSocial((s) => s.offsetMs);
  const prefs = useData((s) => s.settings.socialPrefs);
  const [minutes, setMinutes] = useState("25");
  const [inviting, setInviting] = useState(false);
  const t = room.timer;
  const remaining = t ? Math.max(0, t.startedAt + t.plannedMs - (now + offset)) : 0;
  const invitable = snap.friends.filter((f) => !room.members.some((m) => m.id === f.id) && !room.invitedUsers.some((u) => u.id === f.id));
  const name = (id: string) => room.members.find((m) => m.id === id)?.displayName ?? "Someone";

  if (!room.joined) {
    return (
      <Section title={<span className="normal-case tracking-normal text-ink"><span className="text-base font-semibold">{room.name}</span></span>} action={<div className="flex gap-1.5"><Button size="sm" variant="primary" onClick={() => void call("room.join", { id: room.id })}>Join</Button><Button size="sm" onClick={() => void call("room.leave", { id: room.id })}>Decline</Button></div>}>
        <div className="px-3 py-2 text-sm text-ink-2">{room.members.map((m) => m.displayName).join(", ")} invited you to focus together.</div>
      </Section>
    );
  }
  return (
    <Section
      title={<span className="normal-case tracking-normal text-ink"><span className="text-base font-semibold">{room.name}</span></span>}
      action={
        <div className="flex items-center gap-1.5">
          {invitable.length > 0 && <Button size="sm" icon={<UserPlus size={12} />} onClick={() => setInviting(!inviting)}>Invite</Button>}
          <Button size="sm" onClick={() => void confirmDialog({ title: `Leave “${room.name}”?`, confirmLabel: "Leave", danger: true }).then((ok) => ok && call("room.leave", { id: room.id }))}>Leave</Button>
        </div>
      }
    >
      {inviting && (
        <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
          {invitable.map((u) => (
            <Button key={u.id} size="sm" onClick={() => void call("room.invite", { id: room.id, users: [u.id] })}><Avatar user={u} size={16} /> {u.displayName}</Button>
          ))}
        </div>
      )}
      <div className="grid gap-4 px-3 py-3 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="rounded-md border border-line bg-raised px-3 py-3 text-center">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">{t ? (t.kind === "focus" ? "Shared focus" : "Shared break") : "Shared timer"}</div>
          <div role="timer" className={cx("tabular my-1 text-[34px] font-semibold leading-none", !t && "text-ink-3")}>{t ? `${String(Math.floor(remaining / 60_000)).padStart(2, "0")}:${String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0")}` : "--:--"}</div>
          <div className="text-xs text-ink-3">{t ? `started by ${name(t.by)}` : "not running"}</div>
          {t ? (
            <Button size="sm" className="mt-2" onClick={() => void call("room.timer", { id: room.id, kind: "stop" })}>Stop for everyone</Button>
          ) : (
            <div className="mt-2 flex items-center justify-center gap-1.5">
              <Input className="!h-7 !w-14 text-center" type="number" min={1} max={240} aria-label="Minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              <Button size="sm" variant="primary" icon={<Play size={12} />} onClick={() => void call("room.timer", { id: room.id, kind: "focus", minutes: Number(minutes) || 25 })}>Focus</Button>
              <Button size="sm" onClick={() => void call("room.timer", { id: room.id, kind: "break", minutes: 5 })}>Break 5</Button>
            </div>
          )}
          {t?.kind === "focus" && !useUi.getState().mini && <Button size="sm" variant="ghost" className="mt-1" onClick={() => void attempt(() => startSession({ mode: "countdown", minutes: Math.max(1, Math.round(remaining / 60_000)), objective: "Focus Together" })).then((ok) => ok && navigate("focus"))}>Start my timer for the rest</Button>}
        </div>
        <div className="min-w-0">
          {room.members.map((m) => (
            <div key={m.id} className="flex items-center gap-2.5 border-b border-line py-1.5 last:border-0">
              <Avatar user={m} size={26} />
              <span className="w-32 shrink-0 truncate text-sm">{m.displayName}{m.id === snap.me.id && <span className="text-ink-3"> (you)</span>}</span>
              <PresenceLine presence={m.presence} />
            </div>
          ))}
          {room.invitedUsers.length > 0 && <div className="pt-1.5 text-xs text-ink-3">Invited: {room.invitedUsers.map((u) => u.displayName).join(", ")}</div>}
          <div className="tabular mt-2 text-xs text-ink-2">{room.completedSessions} shared session{room.completedSessions === 1 ? "" : "s"} completed · {fmtDuration(room.groupFocusSeconds)} of group focus</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">
        {REACTIONS.map((r) => (
          <Button key={r} size="sm" onClick={() => void call("room.react", { id: room.id, kind: r })}>{REACTION_LABEL[r]}</Button>
        ))}
        <span className="min-w-0 flex-1 truncate pl-2 text-xs text-ink-2">{room.reactions.slice(0, 3).map((x) => `${name(x.user)}: ${REACTION_LABEL[x.kind]}`).join("  ·  ")}</span>
        <Checkbox checked={prefs.followRoomTimer} onChange={(v) => void attempt(() => setSetting("socialPrefs", { ...prefs, followRoomTimer: v }))} label={<span className="text-xs">Start my own timer with the room</span>} />
      </div>
    </Section>
  );
}

function RoomsTab({ snap }: { snap: Snapshot }) {
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ name: "", invite: [] as string[] });
  return (
    <div className="mx-auto max-w-[860px] space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm text-ink-2">Private rooms for working at the same time. Everyone keeps their own timer and tasks; only statuses are shown. No microphone, no camera.</span>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => (setF({ name: "", invite: [] }), setCreating(true))}>New room</Button>
      </div>
      {snap.rooms.length === 0 && <Empty icon={<Users size={26} />} title="No focus rooms" body="Create a room, invite friends, and start a shared Pomodoro. Rooms are invitation-only." action={<Button onClick={() => setCreating(true)}>Create a room</Button>} />}
      {snap.rooms.map((r) => (
        <RoomCard key={r.id} room={r} snap={snap} />
      ))}
      {creating && (
        <Dialog open onClose={() => setCreating(false)} title="New focus room" footer={<><Button onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" disabled={!f.name.trim()} onClick={() => void call("room.create", f).then((ok) => ok && setCreating(false))}>Create room</Button></>}>
          <Field label="Room name"><Input autoFocus value={f.name} placeholder="Evening study session" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field group label="Invite friends" className="mt-3">
            <div className="flex flex-wrap gap-1.5">
              {snap.friends.length === 0 && <span className="text-sm text-ink-3">Add friends first to invite them.</span>}
              {snap.friends.map((u) => {
                const on = f.invite.includes(u.id);
                return (
                  <button key={u.id} type="button" aria-pressed={on} onClick={() => setF({ ...f, invite: on ? f.invite.filter((x) => x !== u.id) : [...f.invite, u.id] })} className={cx("flex h-7 items-center gap-1.5 rounded-full border pl-1 pr-2.5 text-sm", on ? "border-accent bg-accent/10 text-accent" : "border-line-strong text-ink-2 hover:bg-hover")}>
                    <Avatar user={u} size={20} /> {u.displayName}
                  </button>
                );
              })}
            </div>
          </Field>
        </Dialog>
      )}
    </div>
  );
}

// ---- profile & privacy ----------------------------------------------------------

const NOTIFY_LABEL: Array<[keyof Settings["socialPrefs"]["notify"], string]> = [
  ["requests", "Friend requests and acceptances"],
  ["friendActivity", "A friend starts or finishes a focus session (in-app only)"],
  ["challenges", "Challenge invitations, milestones and results"],
  ["rooms", "Focus room invitations and joins"],
  ["cheers", "Reactions and encouragement"],
];

function ProfileTab({ snap }: { snap: Snapshot }) {
  const me = snap.me;
  const prefs = useData((s) => s.settings.socialPrefs);
  const id = useData((s) => s.settings.social);
  const host = useHost();
  const setPrefs = (p: Partial<Settings["socialPrefs"]>) => void attempt(() => setSetting("socialPrefs", { ...prefs, ...p }));
  return (
    <div className="mx-auto grid max-w-[980px] gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Section title="Your profile">
          <div className="space-y-3 px-3 py-3">
            <div className="flex items-center gap-3">
              <Avatar user={me} size={52} />
              <div className="min-w-0">
                <div className="text-lg font-semibold">{me.displayName}</div>
                <div className="text-sm text-ink-2">@{me.username}</div>
              </div>
              <Input type="color" aria-label="Avatar color" className="ml-auto !w-12 !p-1" value={me.color} onChange={(e) => void call("profile.update", { color: e.target.value })} />
            </div>
            <Field label="Display name"><CommitInput value={me.displayName} onCommit={(v) => v.trim() && void call("profile.update", { displayName: v })} /></Field>
            <Field label="Short status"><CommitInput value={me.statusText} placeholder="Preparing for the moot court" onCommit={(v) => void call("profile.update", { statusText: v })} /></Field>
            <Field label="Bio"><CommitInput multiline rows={2} value={me.bio} onCommit={(v) => void call("profile.update", { bio: v })} /></Field>
            <div className="grid grid-cols-3 gap-3 border-t border-line pt-3">
              <Stat label="This week" value={hrs(me.week.seconds)} sub={`${me.week.sessions} sessions`} />
              <Stat label="This month" value={hrs(me.month.seconds)} sub={`${me.month.productiveDays} productive days`} />
              <Stat label="Streak" value={`${me.streak} d`} sub={`longest ${me.records.longestStreak} d`} />
              <Stat label="Best day" value={hrs(me.records.bestDaySeconds)} />
              <Stat label="Best 7 days" value={hrs(me.records.bestWeekSeconds)} />
              <Stat label="Challenges" value={me.records.challengesCompleted} sub={`${me.records.challengesWon} won`} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {me.badges.length === 0 && <span className="text-xs text-ink-3">Badges are earned from real tracked activity: 10 Pomodoros, a 10-hour week, a 7-day streak, a reached weekly goal, a challenge win.</span>}
              {me.badges.map((b) => (
                <Badge key={b} tone="accent"><Trophy size={10} /> {b}</Badge>
              ))}
            </div>
          </div>
        </Section>
        <Section title="Invitation code">
          <div className="flex items-center gap-2 px-3 py-3">
            <code className="selectable rounded border border-line bg-raised px-2.5 py-1 font-mono text-base tracking-widest">{me.inviteCode}</code>
            <Button size="sm" icon={<Copy size={12} />} onClick={() => void navigator.clipboard.writeText(me.inviteCode).then(() => toast("Code copied", "Send it to a friend; they paste it under Add a friend.", "ok"))}>Copy</Button>
            <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} title="Makes the old code stop working" onClick={() => void call("invite.rotate")}>New code</Button>
          </div>
        </Section>
        <Section title="Connection">
          <div className="space-y-2 px-3 py-3 text-sm">
            {id && isGroup(id.url) ? (
              <div className="rounded border border-line bg-raised px-3 py-2.5">
                <div className="text-xs font-medium text-ink-2">{id.host ? "Your group code — send it to friends" : "Group code"}</div>
                <div className="mt-1 flex items-center gap-2">
                  <code className="selectable font-mono text-lg tracking-widest">{groupCode(id.url)}</code>
                  <Button size="sm" icon={<Copy size={12} />} onClick={() => void navigator.clipboard.writeText(groupCode(id.url)).then(() => toast("Group code copied", "Friends enter it under Social → Join with a code.", "ok"))}>Copy</Button>
                </div>
                <div className="mt-1.5 text-xs text-ink-2">
                  {id.host ? (
                    <>
                      <span className={host.relayOnline ? "text-ok" : "text-warn"}>{host.relayOnline ? "● Reachable" : "● Relay unreachable — retrying"}</span> · friends can connect while Tempo is open on this computer. Anyone with the code can join the group, so share it privately.
                    </>
                  ) : (
                    "You reach the group through the encrypted relay. It is available while its host has Tempo open."
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2"><Wifi size={14} className="text-ok" /> Connected to <code className="selectable font-mono text-xs">{id?.url}</code></div>
            )}
            {host.addresses.length > 0 && (
              <div className="rounded border border-line bg-raised px-3 py-2">
                <div className="font-medium">You are hosting on this network</div>
                <div className="text-xs text-ink-2">Friends on the same network join with one of these addresses, while Tempo is open here:</div>
                {host.addresses.map((a) => (
                  <div key={a} className="mt-1 flex items-center gap-2"><code className="selectable font-mono text-sm">{a}</code><IconButton label="Copy address" className="!h-6 !w-6" onClick={() => void navigator.clipboard.writeText(a).then(() => toast("Address copied", undefined, "ok"))}><Copy size={12} /></IconButton></div>
                ))}
              </div>
            )}
            <Button size="sm" variant="danger" icon={<LogOut size={12} />} onClick={() => void confirmDialog({ title: "Leave the social features?", body: "This device forgets its social login and stops sharing. Your tasks, tracked time and all other local data stay exactly as they are.", confirmLabel: "Leave", danger: true }).then((ok) => ok && attempt(leaveSocial))}>Leave and stop sharing</Button>
          </div>
        </Section>
      </div>
      <div className="space-y-4">
        <Section title="What friends may see">
          <div className="px-3 py-3"><PrivacyToggles value={me.privacy} onToggle={(k, on) => void call("profile.update", { privacy: { [k]: on } })} /></div>
        </Section>
        <Section title="Notifications">
          <div className="space-y-2 px-3 py-3">
            {NOTIFY_LABEL.map(([k, label]) => (
              <Checkbox key={k} checked={prefs.notify[k]} label={label} onChange={(v) => setPrefs({ notify: { ...prefs.notify, [k]: v } })} />
            ))}
            <Checkbox checked={prefs.dndWhileFocusing} label="Hold all social notifications while I am focusing" onChange={(v) => setPrefs({ dndWhileFocusing: v })} />
            <div className="flex items-center gap-2 pt-1 text-sm">
              Quiet hours from
              <Input type="time" className="!w-28" aria-label="Quiet hours from" value={prefs.quietFrom} onChange={(e) => setPrefs({ quietFrom: e.target.value })} />
              to
              <Input type="time" className="!w-28" aria-label="Quiet hours to" value={prefs.quietTo} onChange={(e) => setPrefs({ quietTo: e.target.value })} />
            </div>
            <div className="flex items-center gap-2 text-sm">
              Show me as idle after
              <Input type="number" min={1} max={120} className="!w-16" aria-label="Idle minutes" value={prefs.idleMinutes} onChange={(e) => setPrefs({ idleMinutes: Math.min(120, Math.max(1, Number(e.target.value) || 5)) })} />
              minutes without input
            </div>
            <div className="text-xs text-ink-3">Mute individual friends from their menu in the friends list.</div>
          </div>
        </Section>
        {snap.blocked.length > 0 && (
          <Section title="Blocked">
            {snap.blocked.map((u) => (
              <div key={u.id} className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-0">
                <Avatar user={u} size={24} />
                <span className="min-w-0 flex-1 truncate text-sm">{u.displayName} <span className="text-ink-3">@{u.username}</span></span>
                <Button size="sm" onClick={() => void call("user.block", { userId: u.id, on: false })}>Unblock</Button>
              </div>
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

const TABS = ["friends", "activity", "leaderboard", "challenges", "rooms", "profile"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { friends: "Friends", activity: "Activity", leaderboard: "Leaderboard", challenges: "Challenges", rooms: "Focus Together", profile: "Profile & privacy" };

export function FriendsPage() {
  const routeId = useUi((s) => s.routeId);
  const snap = useSocial((s) => s.snap);
  const conn = useSocial((s) => s.conn);
  const tab: Tab = (TABS as readonly string[]).includes(routeId ?? "") ? (routeId as Tab) : "friends";
  const pending = snap ? snap.incoming.length + snap.challenges.filter((c) => c.invited && c.state !== "finished").length + snap.rooms.filter((r) => r.invited).length : 0;
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Social" subtitle={snap ? `@${snap.me.username}${conn !== "online" ? " · reconnecting…" : ""}${pending ? ` · ${pending} waiting for you` : ""}` : "Optional. Tempo works fully without it."}>
        {snap && <Segmented value={tab} onChange={(t) => navigate("friends", t === "friends" ? null : t)} options={TABS.map((t) => ({ value: t, label: t === "friends" && snap.incoming.length ? `Friends · ${snap.incoming.length}` : t === "challenges" && snap.challenges.some((c) => c.invited && c.state !== "finished") ? "Challenges ·" : t === "rooms" && snap.rooms.some((r) => r.invited) ? "Focus Together ·" : TAB_LABEL[t] }))} />}
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {!snap ? <Onboarding /> : tab === "friends" ? <FriendsTab snap={snap} /> : tab === "activity" ? <ActivityTab snap={snap} /> : tab === "leaderboard" ? <LeaderboardTab snap={snap} /> : tab === "challenges" ? <ChallengesTab snap={snap} /> : tab === "rooms" ? <RoomsTab snap={snap} /> : <ProfileTab snap={snap} />}
      </div>
    </div>
  );
}
