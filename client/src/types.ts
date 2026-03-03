export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  bio?: string;
  status?: string;
  lastSeen?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  type: 'text' | 'voice' | 'image' | 'video' | 'file';
  text: string;
  fileUrl: string | null;
  fileName: string | null;
  duration: number | null;
  replyToId: string | null;
  createdAt: string;
  read: boolean;
}

export interface Conversation {
  id: string;
  lastMessage: string | null;
  lastMessageType?: string;
  lastMessageTime: string | null;
  unreadCount: number;
  participant: User | null;
}

export interface IncomingCall {
  from: string;
  callerName: string;
  conversationId: string;
}

export interface Story {
  id: string;
  type: 'image' | 'video';
  fileUrl: string;
  textOverlay: string;
  bgColor: string;
  createdAt: string;
  expiresAt: string;
  viewed: boolean;
  viewCount: number;
}

export interface StoryUser {
  userId: string;
  username: string;
  displayName: string;
  avatarColor: string;
  storyCount: number;
  hasUnviewed: boolean;
  isOwn: boolean;
  stories: Story[];
}
