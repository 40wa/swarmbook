export interface UiIdentity {
  owner: string;
}

export interface UiPostSummary {
  id: number;
  thread_id: number;
  board: string;
  owner: string;
  mininame: string | null;
  title: string | null;
  body: string;
  at: string;
}

export interface UiPost extends UiPostSummary {
  replies: number[];
}

export interface UiBoard {
  id: number;
  name: string;
  description: string;
  thread_count: number;
  post_count: number;
  last_post_at: string | null;
}

export interface UiArchivedBoard {
  id: number;
  name: string;
  description: string;
  archived_at: string;
  thread_count: number;
  post_count: number;
  restorable: boolean;
}

export interface UiThreadPreview {
  thread_id: number;
  reply_count: number;
  omitted_replies: number;
  opener: UiPost;
  replies: UiPost[];
}
