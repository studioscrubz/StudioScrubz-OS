import { getSupabaseClient } from "@/lib/supabase/client";
import type { AnnouncementAcknowledgment, AnnouncementConversation, AnnouncementMessage, Conversation, ConversationMember, DirectConversation, Message, MessageReadState, MessagingUser } from "@/types/messaging";

export const MESSAGING_REALTIME_TABLES = ["conversations", "conversation_members", "messages", "message_read_states", "announcement_acknowledgments"] as const;

export async function getMessagingUsers(): Promise<MessagingUser[]> {
  const { data, error } = await getSupabaseClient()
    .from("user_profiles")
    .select("id,display_name,email,role")
    .eq("is_active", true)
    .order("display_name", { ascending: true });
  if (error) throw new Error(`Messaging users could not be loaded: ${error.message}`);
  return data as MessagingUser[];
}

export async function getDirectConversations(userId: string): Promise<DirectConversation[]> {
  const client = getSupabaseClient();
  const { data: conversations, error: conversationError } = await client.from("conversations").select("*").eq("kind", "Direct").is("archived_at", null).order("last_message_at", { ascending: false });
  if (conversationError) throw new Error(`Conversations could not be loaded: ${conversationError.message}`);
  const rows = (conversations ?? []) as Conversation[];
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [{ data: members, error: memberError }, { data: messages, error: messageError }, { data: reads, error: readError }, { data: users, error: usersError }] = await Promise.all([
    client.from("conversation_members").select("*").in("conversation_id", ids).is("left_at", null),
    client.from("messages").select("*").in("conversation_id", ids).is("archived_at", null).order("created_at", { ascending: true }),
    client.from("message_read_states").select("*").eq("user_id", userId),
    client.from("user_profiles").select("id,display_name,email,role").eq("is_active", true),
  ]);
  if (memberError) throw new Error(`Conversation members could not be loaded: ${memberError.message}`);
  if (messageError) throw new Error(`Messages could not be loaded: ${messageError.message}`);
  if (readError) throw new Error(`Message read states could not be loaded: ${readError.message}`);
  if (usersError) throw new Error(`Messaging users could not be loaded: ${usersError.message}`);
  return buildConversations(rows, (members ?? []) as ConversationMember[], (messages ?? []) as Message[], (reads ?? []) as MessageReadState[], (users ?? []) as MessagingUser[], userId);
}

export async function getDirectConversationMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await getSupabaseClient().from("messages").select("*").eq("conversation_id", conversationId).is("archived_at", null).order("created_at", { ascending: true });
  if (error) throw new Error(`Messages could not be loaded: ${error.message}`);
  return data as Message[];
}

export async function startDirectConversation(recipientUserId: string): Promise<Conversation> {
  if (!recipientUserId) throw new Error("Choose a recipient.");
  const { data, error } = await getSupabaseClient().rpc("start_direct_conversation", { p_other_user_id: recipientUserId });
  if (error) throw new Error(`Direct conversation could not be started: ${error.message}`);
  return data as Conversation;
}

export async function sendDirectMessage(conversationId: string, body: string): Promise<Message> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Enter a message before sending.");
  const { data, error } = await getSupabaseClient().rpc("send_direct_message", { p_conversation_id: conversationId, p_body: trimmed });
  if (error) throw new Error(`Message could not be sent: ${error.message}`);
  const message = data as Message;
  notifyDirectMessagePushBestEffort(conversationId, message.id);
  return message;
}

// Fire-and-forget: push delivery must never affect whether a message send succeeds.
function notifyDirectMessagePushBestEffort(conversationId: string, messageId: string): void {
  try {
    void fetch("/api/messages/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, messageId }),
    }).catch(() => undefined);
  } catch {
    // Push notification triggering must never fail message sending.
  }
}

export async function markConversationMessagesRead(conversationId: string, messageIds?: string[]): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc("mark_messages_read", { p_conversation_id: conversationId, p_message_ids: messageIds ?? null });
  if (error) throw new Error(`Messages could not be marked read: ${error.message}`);
  return Number(data ?? 0);
}

export async function getUnreadDirectMessageCount(userId: string): Promise<number> {
  const conversations = await getDirectConversations(userId);
  return conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);
}

export async function getCompanyAnnouncements(userId: string): Promise<AnnouncementConversation[]> {
  const client = getSupabaseClient();
  const { data: conversations, error: conversationError } = await client.from("conversations").select("*").eq("kind", "Announcement").is("archived_at", null).order("last_message_at", { ascending: false });
  if (conversationError) throw new Error(`Announcements could not be loaded: ${conversationError.message}`);
  const rows = (conversations ?? []) as Conversation[];
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [{ data: messages, error: messageError }, { data: reads, error: readError }, { data: acknowledgments, error: ackError }, { data: users, error: usersError }] = await Promise.all([
    client.from("messages").select("*").in("conversation_id", ids).is("archived_at", null).order("created_at", { ascending: false }),
    client.from("message_read_states").select("*").eq("user_id", userId),
    client.from("announcement_acknowledgments").select("*").eq("user_id", userId),
    client.from("user_profiles").select("id,display_name,email,role").eq("is_active", true),
  ]);
  if (messageError) throw new Error(`Announcement messages could not be loaded: ${messageError.message}`);
  if (readError) throw new Error(`Message read states could not be loaded: ${readError.message}`);
  if (ackError) throw new Error(`Announcement acknowledgments could not be loaded: ${ackError.message}`);
  if (usersError) throw new Error(`Messaging users could not be loaded: ${usersError.message}`);
  return buildAnnouncementConversations(rows, (messages ?? []) as Message[], (reads ?? []) as MessageReadState[], (acknowledgments ?? []) as AnnouncementAcknowledgment[], (users ?? []) as MessagingUser[], userId);
}

export async function sendCompanyAnnouncement(title: string, body: string, priority: Message["priority"]): Promise<Message> {
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  if (!trimmedTitle) throw new Error("Enter an announcement title before sending.");
  if (!trimmedBody) throw new Error("Enter an announcement message before sending.");
  const { data, error } = await getSupabaseClient().rpc("send_company_announcement", { p_title: trimmedTitle, p_body: trimmedBody, p_priority: priority });
  if (error) throw new Error(`Announcement could not be sent: ${error.message}`);
  const message = data as Message;
  notifyAnnouncementPushBestEffort(message.id);
  return message;
}

// Fire-and-forget: push delivery must never affect whether an announcement send succeeds.
function notifyAnnouncementPushBestEffort(messageId: string): void {
  try {
    void fetch("/api/messages/notify-announcement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId }),
    }).catch(() => undefined);
  } catch {
    // Push notification triggering must never fail announcement sending.
  }
}

export async function acknowledgeRequiredAnnouncement(messageId: string): Promise<AnnouncementAcknowledgment> {
  const { data, error } = await getSupabaseClient().rpc("acknowledge_required_announcement", { p_message_id: messageId });
  if (error) throw new Error(`Announcement could not be acknowledged: ${error.message}`);
  return data as AnnouncementAcknowledgment;
}

function buildAnnouncementConversations(conversations: Conversation[], messages: Message[], reads: MessageReadState[], acknowledgments: AnnouncementAcknowledgment[], users: MessagingUser[], userId: string): AnnouncementConversation[] {
  const readIds = new Set(reads.map((read) => read.message_id));
  const acknowledgedIds = new Map(acknowledgments.map((ack) => [ack.message_id, ack.acknowledged_at]));
  const usersById = new Map(users.map((user) => [user.id, user]));
  return conversations.map((conversation) => {
    const conversationMessages: AnnouncementMessage[] = messages
      .filter((message) => message.conversation_id === conversation.id)
      .map((message) => ({ ...message, sender: usersById.get(message.sender_user_id) ?? null, acknowledgedAt: acknowledgedIds.get(message.id) ?? null }));
    return {
      ...conversation,
      messages: conversationMessages,
      unreadCount: conversationMessages.filter((message) => message.sender_user_id !== userId && !readIds.has(message.id)).length,
    };
  });
}

function buildConversations(conversations: Conversation[], members: ConversationMember[], messages: Message[], reads: MessageReadState[], users: MessagingUser[], userId: string): DirectConversation[] {
  const readIds = new Set(reads.map((read) => read.message_id));
  const usersById = new Map(users.map((user) => [user.id, user]));
  return conversations.map((conversation) => {
    const conversationMembers = members.filter((member) => member.conversation_id === conversation.id);
    const conversationMessages = messages.filter((message) => message.conversation_id === conversation.id);
    const participantId = conversationMembers.find((member) => member.user_id !== userId)?.user_id;
    return {
      ...conversation,
      members: conversationMembers,
      messages: conversationMessages,
      participant: participantId ? usersById.get(participantId) ?? null : null,
      unreadCount: conversationMessages.filter((message) => message.sender_user_id !== userId && !readIds.has(message.id)).length,
    };
  });
}
