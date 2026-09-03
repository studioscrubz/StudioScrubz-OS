"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { acknowledgeRequiredAnnouncement, getCompanyAnnouncements, getDirectConversations, getMessagingUsers, markConversationMessagesRead, sendCompanyAnnouncement, sendDirectMessage, startDirectConversation } from "@/lib/services/messaging";
import type { AnnouncementConversation, AnnouncementMessage, DirectConversation, Message, MessagingUser } from "@/types/messaging";

type AnnouncementPriority = Message["priority"];
type MessagesTab = "direct" | "announcements";

export function MessagesPage() {
  const { user, profile } = useAuth();
  const [tab, setTab] = useState<MessagesTab>("direct");
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementConversation[]>([]);
  const [users, setUsers] = useState<MessagingUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [recipientId, setRecipientId] = useState("");
  const [body, setBody] = useState("");
  const [newAnnouncementOpen, setNewAnnouncementOpen] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementBody, setAnnouncementBody] = useState("");
  const [announcementPriority, setAnnouncementPriority] = useState<AnnouncementPriority>("Normal");
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const markingReadConversation = useRef<string | null>(null);
  const markingReadAnnouncements = useRef<Set<string>>(new Set());
  const currentUserId = user?.id ?? "";
  const canAnnounce = hasPermission(profile, "messages.announce");

  async function load() {
    if (!currentUserId) return;
    setError(null);
    try {
      const [nextConversations, nextAnnouncements, nextUsers] = await Promise.all([getDirectConversations(currentUserId), getCompanyAnnouncements(currentUserId), getMessagingUsers()]);
      setConversations(nextConversations);
      setAnnouncements(nextAnnouncements);
      setUsers(nextUsers);
      setSelectedId((current) => current && nextConversations.some((conversation) => conversation.id === current) ? current : nextConversations[0]?.id ?? null);
    } catch (cause) {
      console.error("Messages load failed", cause);
      setError(cause instanceof Error ? cause.message : "Messages could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [currentUserId]);
  useOperationalRealtime(["conversations", "conversation_members", "messages", "message_read_states", "announcement_acknowledgments"], load);

  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;
  const availableRecipients = users.filter((candidate) => candidate.id !== currentUserId);
  const unreadTotal = conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);
  const announcementUnreadTotal = announcements.reduce((total, conversation) => total + conversation.unreadCount, 0);
  const announcementMessages = announcements
    .flatMap((conversation) => conversation.messages.map((message) => ({ conversation, message })))
    .sort((a, b) => new Date(b.message.created_at).getTime() - new Date(a.message.created_at).getTime());

  useEffect(() => {
    if (!selected || selected.unreadCount === 0 || markingReadConversation.current === selected.id) return;
    const unreadMessageIds = selected.messages.filter((message) => message.sender_user_id !== currentUserId).map((message) => message.id);
    if (!unreadMessageIds.length) return;
    markingReadConversation.current = selected.id;
    void markConversationMessagesRead(selected.id, unreadMessageIds).then(() => {
      setConversations((current) => current.map((conversation) => conversation.id === selected.id ? { ...conversation, unreadCount: 0 } : conversation));
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Messages could not be marked read.");
    }).finally(() => {
      if (markingReadConversation.current === selected.id) markingReadConversation.current = null;
    });
  }, [currentUserId, selected]);

  useEffect(() => {
    if (tab !== "announcements") return;
    for (const conversation of announcements) {
      if (conversation.unreadCount === 0 || markingReadAnnouncements.current.has(conversation.id)) continue;
      const unreadMessageIds = conversation.messages.filter((message) => message.sender_user_id !== currentUserId).map((message) => message.id);
      if (!unreadMessageIds.length) continue;
      markingReadAnnouncements.current.add(conversation.id);
      void markConversationMessagesRead(conversation.id, unreadMessageIds).then(() => {
        setAnnouncements((current) => current.map((item) => item.id === conversation.id ? { ...item, unreadCount: 0 } : item));
      }).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Announcements could not be marked read.");
      }).finally(() => {
        markingReadAnnouncements.current.delete(conversation.id);
      });
    }
  }, [tab, announcements, currentUserId]);

  function openConversation(conversation: DirectConversation) {
    setSelectedId(conversation.id);
  }

  async function startConversation() {
    if (!recipientId) return setError("Choose an active user.");
    setStarting(true);
    setError(null);
    try {
      const conversation = await startDirectConversation(recipientId);
      await load();
      setSelectedId(conversation.id);
      setNewMessageOpen(false);
      setRecipientId("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Direct conversation could not be started.");
    } finally {
      setStarting(false);
    }
  }

  async function submitMessage() {
    if (!selected || !body.trim()) return;
    setSending(true);
    setError(null);
    try {
      await sendDirectMessage(selected.id, body);
      setBody("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  async function submitAnnouncement() {
    if (!announcementTitle.trim() || !announcementBody.trim()) return;
    setSendingAnnouncement(true);
    setError(null);
    try {
      await sendCompanyAnnouncement(announcementTitle, announcementBody, announcementPriority);
      setAnnouncementTitle("");
      setAnnouncementBody("");
      setAnnouncementPriority("Normal");
      setNewAnnouncementOpen(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The announcement could not be sent.");
    } finally {
      setSendingAnnouncement(false);
    }
  }

  async function acknowledge(messageId: string) {
    setAcknowledgingId(messageId);
    setError(null);
    try {
      await acknowledgeRequiredAnnouncement(messageId);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The announcement could not be acknowledged.");
    } finally {
      setAcknowledgingId(null);
    }
  }

  return <div className="space-y-6">
    <header className="border-b border-[#143d1a]/10 pb-7 sm:pb-8"><p className="mb-3 text-[11px] font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">Operations workspace</p><div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-extrabold tracking-[-.04em] text-[#143d1a] sm:text-4xl">Messages</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600 sm:text-base">Direct conversations and Company Announcements for the StudioScrubz team.</p></div>{tab === "direct" ? <button type="button" onClick={() => setNewMessageOpen(true)} className="rounded-lg bg-[#143d1a] px-4 py-3 text-sm font-extrabold text-white shadow-sm hover:bg-[#1d5426]">New Message</button> : canAnnounce ? <button type="button" onClick={() => setNewAnnouncementOpen(true)} className="rounded-lg bg-[#143d1a] px-4 py-3 text-sm font-extrabold text-white shadow-sm hover:bg-[#1d5426]">New Announcement</button> : null}</div></header>
    <div role="tablist" aria-label="Messages sections" className="flex gap-2 border-b border-[#143d1a]/10">
      <button type="button" role="tab" aria-selected={tab === "direct"} onClick={() => setTab("direct")} className={`rounded-t-lg px-4 py-2.5 text-sm font-extrabold ${tab === "direct" ? "border-b-2 border-[#143d1a] text-[#143d1a]" : "text-neutral-500 hover:text-[#143d1a]"}`}>Direct{unreadTotal > 0 && <span className="ml-2 rounded-full bg-[#d4af37] px-1.5 py-0.5 text-[10px] text-[#143d1a]">{unreadTotal}</span>}</button>
      <button type="button" role="tab" aria-selected={tab === "announcements"} onClick={() => setTab("announcements")} className={`rounded-t-lg px-4 py-2.5 text-sm font-extrabold ${tab === "announcements" ? "border-b-2 border-[#143d1a] text-[#143d1a]" : "text-neutral-500 hover:text-[#143d1a]"}`}>Company Announcements{announcementUnreadTotal > 0 && <span className="ml-2 rounded-full bg-[#d4af37] px-1.5 py-0.5 text-[10px] text-[#143d1a]">{announcementUnreadTotal}</span>}</button>
    </div>
    {error && <div role="alert" className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700"><span>{error}</span><button type="button" onClick={() => void load()} className="rounded-lg border border-red-200 px-3 py-2">Retry</button></div>}
    {tab === "direct" ? <>
      {newMessageOpen && <section className="rounded-2xl border border-[#d4af37]/40 bg-[#fffdf4] p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><h2 className="font-extrabold text-[#143d1a]">New Direct Message</h2><p className="mt-1 text-sm text-neutral-600">Choose an active StudioScrubz user.</p></div><button type="button" onClick={() => setNewMessageOpen(false)} className="text-sm font-bold text-neutral-500">Cancel</button></div><div className="mt-4 flex flex-col gap-3 sm:flex-row"><select aria-label="Recipient" value={recipientId} onChange={(event) => setRecipientId(event.target.value)} className={inputClass}><option value="">Select recipient</option>{availableRecipients.map((candidate) => <option key={candidate.id} value={candidate.id}>{displayName(candidate)}{candidate.role ? ` · ${candidate.role}` : ""}</option>)}</select><button type="button" disabled={starting || !recipientId} onClick={() => void startConversation()} className="rounded-lg bg-[#d4af37] px-5 py-3 text-sm font-extrabold text-[#143d1a] disabled:opacity-50">{starting ? "Opening…" : "Open Conversation"}</button></div></section>}
      <section className="grid min-h-[560px] overflow-hidden rounded-2xl border border-[#143d1a]/10 bg-white shadow-sm lg:grid-cols-[minmax(260px,360px)_1fr]">
        <aside className={`${selected ? "hidden lg:block" : "block"} border-b border-[#143d1a]/10 lg:border-b-0 lg:border-r`}><div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4"><div><h2 className="font-extrabold text-[#143d1a]">Direct</h2><p className="mt-1 text-xs text-neutral-500">{unreadTotal ? `${unreadTotal} unread` : "All caught up"}</p></div><span className="rounded-full bg-[#edf4ec] px-2.5 py-1 text-xs font-extrabold text-[#143d1a]">{conversations.length}</span></div>{loading ? <p className="p-5 text-sm text-neutral-500">Loading conversations…</p> : conversations.length === 0 ? <div className="p-5"><p className="text-sm font-bold text-neutral-700">No Direct conversations yet.</p><p className="mt-2 text-sm text-neutral-500">Start a private conversation with an active team member.</p></div> : <ul>{conversations.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} active={conversation.id === selectedId} onOpen={() => void openConversation(conversation)} currentUserId={currentUserId} />)}</ul>}</aside>
        <div className={`${selected ? "block" : "hidden lg:block"}`}>{selected ? <ConversationPanel conversation={selected} currentUserId={currentUserId} body={body} setBody={setBody} sending={sending} submitMessage={submitMessage} back={() => setSelectedId(null)} /> : <div className="grid h-full min-h-[560px] place-items-center p-8 text-center"><div><p className="text-4xl">✉</p><h2 className="mt-4 text-lg font-extrabold text-[#143d1a]">Select a conversation</h2><p className="mt-2 text-sm text-neutral-500">Your Direct messages will appear here.</p></div></div>}</div>
      </section>
    </> : <>
      {newAnnouncementOpen && canAnnounce && <section className="rounded-2xl border border-[#d4af37]/40 bg-[#fffdf4] p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><h2 className="font-extrabold text-[#143d1a]">New Announcement</h2><p className="mt-1 text-sm text-neutral-600">Sent to all active StudioScrubz users.</p></div><button type="button" onClick={() => setNewAnnouncementOpen(false)} className="text-sm font-bold text-neutral-500">Cancel</button></div><div className="mt-4 flex flex-col gap-3"><input aria-label="Announcement title" value={announcementTitle} onChange={(event) => setAnnouncementTitle(event.target.value)} placeholder="Title" className={inputClass} /><textarea aria-label="Announcement message" value={announcementBody} onChange={(event) => setAnnouncementBody(event.target.value)} rows={3} placeholder="Write the announcement…" className={`${inputClass} resize-none`} /><select aria-label="Priority" value={announcementPriority} onChange={(event) => setAnnouncementPriority(event.target.value as AnnouncementPriority)} className={inputClass}><option value="Normal">Normal</option><option value="Important">Important</option><option value="Requires Acknowledgment">Requires Acknowledgment</option></select><button type="button" disabled={sendingAnnouncement || !announcementTitle.trim() || !announcementBody.trim()} onClick={() => void submitAnnouncement()} className="self-start rounded-lg bg-[#d4af37] px-5 py-3 text-sm font-extrabold text-[#143d1a] disabled:opacity-50">{sendingAnnouncement ? "Sending…" : "Send Announcement"}</button></div></section>}
      <section className="min-h-[560px] overflow-hidden rounded-2xl border border-[#143d1a]/10 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4"><div><h2 className="font-extrabold text-[#143d1a]">Company Announcements</h2><p className="mt-1 text-xs text-neutral-500">{announcementUnreadTotal ? `${announcementUnreadTotal} unread` : "All caught up"}</p></div><span className="rounded-full bg-[#edf4ec] px-2.5 py-1 text-xs font-extrabold text-[#143d1a]">{announcementMessages.length}</span></div>
        {loading ? <p className="p-5 text-sm text-neutral-500">Loading announcements…</p> : announcementMessages.length === 0 ? <div className="p-5"><p className="text-sm font-bold text-neutral-700">No Company Announcements yet.</p>{canAnnounce && <p className="mt-2 text-sm text-neutral-500">Send the first announcement to the whole team.</p>}</div> : <ul className="divide-y divide-neutral-100">{announcementMessages.map(({ conversation, message }) => <AnnouncementRow key={message.id} title={conversation.title} message={message} acknowledging={acknowledgingId === message.id} onAcknowledge={() => void acknowledge(message.id)} />)}</ul>}
      </section>
    </>}
  </div>;
}

function ConversationRow({ conversation, active, onOpen, currentUserId }: { conversation: DirectConversation; active: boolean; onOpen: () => void; currentUserId: string }) {
  const latest = conversation.messages[conversation.messages.length - 1];
  return <li><button type="button" onClick={onOpen} className={`w-full border-b border-neutral-100 px-5 py-4 text-left transition hover:bg-[#f7f9f6] ${active ? "bg-[#edf4ec]" : "bg-white"}`}><div className="flex items-start gap-3"><Avatar name={conversation.participant ? displayName(conversation.participant) : "Unknown user"} /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><p className={`truncate text-sm ${conversation.unreadCount ? "font-extrabold text-[#143d1a]" : "font-bold text-neutral-700"}`}>{conversation.participant ? displayName(conversation.participant) : "Unknown user"}</p><time className="shrink-0 text-[11px] text-neutral-400">{latest ? formatTime(latest.created_at) : formatTime(conversation.last_message_at)}</time></div><p className={`mt-1 truncate text-xs ${conversation.unreadCount ? "font-bold text-neutral-700" : "text-neutral-500"}`}>{latest ? `${latest.sender_user_id === currentUserId ? "You: " : ""}${latest.body}` : "No messages yet"}</p></div>{conversation.unreadCount > 0 && <span className="min-w-6 rounded-full bg-[#d4af37] px-1.5 py-0.5 text-center text-[10px] font-extrabold text-[#143d1a]">{conversation.unreadCount}</span>}</div></button></li>;
}

function ConversationPanel({ conversation, currentUserId, body, setBody, sending, submitMessage, back }: { conversation: DirectConversation; currentUserId: string; body: string; setBody: (value: string) => void; sending: boolean; submitMessage: () => Promise<void>; back: () => void }) {
  const participantName = conversation.participant ? displayName(conversation.participant) : "Unknown user";
  return <div className="flex min-h-[560px] flex-col"><header className="flex items-center gap-3 border-b border-neutral-100 px-5 py-4"><button type="button" onClick={back} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-bold text-[#143d1a] lg:hidden">Back</button><Avatar name={participantName} /><div><h2 className="font-extrabold text-[#143d1a]">{participantName}</h2><p className="mt-1 text-xs text-neutral-500">Direct conversation</p></div></header><div className="flex-1 space-y-3 overflow-y-auto bg-[#fbfcfa] p-5">{conversation.messages.length === 0 ? <p className="py-10 text-center text-sm text-neutral-500">No messages yet. Send the first message.</p> : conversation.messages.map((message) => <MessageBubble key={message.id} message={message} own={message.sender_user_id === currentUserId} />)}</div><form onSubmit={(event) => { event.preventDefault(); void submitMessage(); }} className="border-t border-neutral-100 bg-white p-4"><div className="flex items-end gap-3"><textarea aria-label="Message" value={body} onChange={(event) => setBody(event.target.value)} rows={2} placeholder="Write a Direct message…" className={`${inputClass} min-h-12 resize-none`} /><button type="submit" disabled={sending || !body.trim()} className="rounded-lg bg-[#143d1a] px-4 py-3 text-sm font-extrabold text-white disabled:opacity-50">{sending ? "Sending…" : "Send"}</button></div></form></div>;
}

function AnnouncementRow({ title, message, acknowledging, onAcknowledge }: { title: string | null; message: AnnouncementMessage; acknowledging: boolean; onAcknowledge: () => void }) {
  const requiresAcknowledgment = message.priority === "Requires Acknowledgment";
  const senderName = message.sender ? displayName(message.sender) : "Unknown user";
  return <li className="px-5 py-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-extrabold text-[#143d1a]">{title || "Announcement"}</h3><PriorityBadge priority={message.priority} /></div><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-neutral-700">{message.body}</p><p className="mt-2 text-xs text-neutral-500">{senderName} · {formatTime(message.created_at)}</p></div></div>{requiresAcknowledgment && <div className="mt-3">{message.acknowledgedAt ? <span className="rounded-full bg-[#edf4ec] px-3 py-1.5 text-xs font-extrabold text-[#143d1a]">Acknowledged</span> : <button type="button" disabled={acknowledging} onClick={onAcknowledge} className="rounded-lg bg-[#143d1a] px-4 py-2 text-xs font-extrabold text-white disabled:opacity-50">{acknowledging ? "Acknowledging…" : "Acknowledge"}</button>}</div>}</li>;
}

function PriorityBadge({ priority }: { priority: AnnouncementPriority }) {
  const classes = priority === "Requires Acknowledgment" ? "bg-red-50 text-red-700" : priority === "Important" ? "bg-[#fdf3d9] text-[#9a7a17]" : "bg-[#edf4ec] text-[#143d1a]";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${classes}`}>{priority}</span>;
}

function MessageBubble({ message, own }: { message: Message; own: boolean }) { return <div className={`flex ${own ? "justify-end" : "justify-start"}`}><article className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 ${own ? "rounded-br-md bg-[#143d1a] text-white" : "rounded-bl-md border border-neutral-200 bg-white text-neutral-700"}`}><p className="whitespace-pre-wrap break-words">{message.body}</p><time className={`mt-1 block text-[10px] ${own ? "text-white/60" : "text-neutral-400"}`}>{formatTime(message.created_at)}</time></article></div>; }
function Avatar({ name }: { name: string }) { return <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-[#d4af37] text-xs font-extrabold text-[#143d1a]">{name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?"}</span>; }
function displayName(user: MessagingUser) { return user.display_name?.trim() || user.email?.trim() || "Unnamed user"; }
function formatTime(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
const inputClass = "w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-800 outline-none focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/15";
