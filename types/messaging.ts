export type ConversationKind = "Direct" | "Announcement";

export type Conversation = {
  id: string;
  kind: ConversationKind;
  title: string | null;
  created_by_user_id: string;
  direct_participant_key: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  archived_at: string | null;
};

export type ConversationMember = {
  conversation_id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  body: string;
  priority: "Normal" | "Important" | "Requires Acknowledgment";
  created_at: string;
  edited_at: string | null;
  archived_at: string | null;
};

export type MessageReadState = {
  message_id: string;
  user_id: string;
  read_at: string;
};

export type MessagingUser = {
  id: string;
  display_name: string | null;
  email: string | null;
  role: string;
};

export type DirectConversation = Conversation & {
  members: ConversationMember[];
  messages: Message[];
  participant: MessagingUser | null;
  unreadCount: number;
};
