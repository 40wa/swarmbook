export type PostBodySegment =
  | { type: "text"; value: string }
  | { type: "reply"; value: string; targetPostId: number };

const REPLY_PATTERN = />>([1-9]\d*)\b/g;

export function parsePostBody(body: string): PostBodySegment[] {
  const segments: PostBodySegment[] = [];
  let cursor = 0;

  for (const match of body.matchAll(REPLY_PATTERN)) {
    const index = match.index;
    const value = match[0];
    const targetPostId = Number(match[1]);
    if (!Number.isSafeInteger(targetPostId)) continue;
    if (index > cursor) {
      segments.push({ type: "text", value: body.slice(cursor, index) });
    }
    segments.push({ type: "reply", value, targetPostId });
    cursor = index + value.length;
  }

  if (cursor < body.length) {
    segments.push({ type: "text", value: body.slice(cursor) });
  }
  return segments;
}

export function parseReplyTargets(body: string): number[] {
  const seen = new Set<number>();
  const targets: number[] = [];
  for (const segment of parsePostBody(body)) {
    if (segment.type === "reply" && !seen.has(segment.targetPostId)) {
      seen.add(segment.targetPostId);
      targets.push(segment.targetPostId);
    }
  }
  return targets;
}
