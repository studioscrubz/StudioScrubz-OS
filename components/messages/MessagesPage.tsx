"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { getDirectConversations, getMessagingUsers, markConversationMessagesRead, sendDirectMessage, startDirectConversation } from "@/lib/services/messaging";
import type { DirectConversation, Message, MessagingUser } from "@/types/messaging";

export function MessagesPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [users, setUsers] = useState<MessagingUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [recipientId, setRecipientId] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const markingReadConversation = useRef<string | null>(null);
  const currentUserId = user?.id ?? "";

  async function load() {
    if (!currentUserId) return;
    setError(null);
    try {
      const [nextConversations, nextUsers] = await Promise.all([getDirectConversations(currentUserId), getMessagingUsers()]);
      setConversations(nextConversations);
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
  useOperationalRealtime(["conversations", "conversation_members", "messages", "message_read_states"], load);

  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;
  const availableRecipients = users.filter((candidate) => candidate.id !== currentUserId);
  const unreadTotal = conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);

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

  return <div className="space-y-6">
    <header className="border-b border-[#143d1a]/10 pb-7 sm:pb-8"><p className="mb-3 text-[11px] font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">Operations workspace</p><div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-extrabold tracking-[-.04em] text-[#143d1a] sm:text-4xl">Messages</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600 sm:text-base">Private Direct conversations for the StudioScrubz team.</p></div><button type="button" onClick={() => setNewMessageOpen(true)} className="rounded-lg bg-[#143d1a] px-4 py-3 text-sm font-extrabold text-white shadow-sm hover:bg-[#1d5426]">New Message</button></div></header>
    {error && <div role="alert" className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700"><span>{error}</span><button type="button" onClick={() => void load()} className="rounded-lg border border-red-200 px-3 py-2">Retry</button></div>}
    {newMessageOpen && <section className="rounded-2xl border border-[#d4af37]/40 bg-[#fffdf4] p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><h2 className="font-extrabold text-[#143d1a]">New Direct Message</h2><p className="mt-1 text-sm text-neutral-600">Choose an active StudioScrubz user.</p></div><button type="button" onClick={() => setNewMessageOpen(false)} className="text-sm font-bold text-neutral-500">Cancel</button></div><div className="mt-4 flex flex-col gap-3 sm:flex-row"><select aria-label="Recipient" value={recipientId} onChange={(event) => setRecipientId(event.target.value)} className={inputClass}><option value="">Select recipient</option>{availableRecipients.map((candidate) => <option key={candidate.id} value={candidate.id}>{displayName(candidate)}{candidate.role ? ` · ${candidate.role}` : ""}</option>)}</select><button type="button" disabled={starting || !recipientId} onClick={() => void startConversation()} className="rounded-lg bg-[#d4af37] px-5 py-3 text-sm font-extrabold text-[#143d1a] disabled:opacity-50">{starting ? "Opening…" : "Open Conversation"}</button></div></section>}
    <section className="grid min-h-[560px] overflow-hidden rounded-2xl border border-[#143d1a]/10 bg-white shadow-sm lg:grid-cols-[minmax(260px,360px)_1fr]">
      <aside className={`${selected ? "hidden lg:block" : "block"} border-b border-[#143d1a]/10 lg:border-b-0 lg:border-r`}><div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4"><div><h2 className="font-extrabold text-[#143d1a]">Direct</h2><p className="mt-1 text-xs text-neutral-500">{unreadTotal ? `${unreadTotal} unread` : "All caught up"}</p></div><span className="rounded-full bg-[#edf4ec] px-2.5 py-1 text-xs font-extrabold text-[#143d1a]">{conversations.length}</span></div>{loading ? <p className="p-5 text-sm text-neutral-500">Loading conversations…</p> : conversations.length === 0 ? <div className="p-5"><p className="text-sm font-bold text-neutral-700">No Direct conversations yet.</p><p className="mt-2 text-sm text-neutral-500">Start a private conversation with an active team member.</p></div> : <ul>{conversations.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} active={conversation.id === selectedId} onOpen={() => void openConversation(conversation)} currentUserId={currentUserId} />)}</ul>}</aside>
      <div className={`${selected ? "block" : "hidden lg:block"}`}>{selected ? <ConversationPanel conversation={selected} currentUserId={currentUserId} body={body} setBody={setBody} sending={sending} submitMessage={submitMessage} back={() => setSelectedId(null)} /> : <div className="grid h-full min-h-[560px] place-items-center p-8 text-center"><div><p className="text-4xl">✉</p><h2 className="mt-4 text-lg font-extrabold text-[#143d1a]">Select a conversation</h2><p className="mt-2 text-sm text-neutral-500">Your Direct messages will appear here.</p></div></div>}</div>
    </section>
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

function MessageBubble({ message, own }: { message: Message; own: boolean }) { return <div className={`flex ${own ? "justify-end" : "justify-start"}`}><article className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 ${own ? "rounded-br-md bg-[#143d1a] text-white" : "rounded-bl-md border border-neutral-200 bg-white text-neutral-700"}`}><p className="whitespace-pre-wrap break-words">{message.body}</p><time className={`mt-1 block text-[10px] ${own ? "text-white/60" : "text-neutral-400"}`}>{formatTime(message.created_at)}</time></article></div>; }
function Avatar({ name }: { name: string }) { return <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-[#d4af37] text-xs font-extrabold text-[#143d1a]">{name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?"}</span>; }
function displayName(user: MessagingUser) { return user.display_name?.trim() || user.email?.trim() || "Unnamed user"; }
function formatTime(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
const inputClass = "w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-800 outline-none focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/15";
