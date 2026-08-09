import { decode, encode, type JsonValue } from "@toon-format/toon";

export const TOON_MEDIA_TYPE = "text/toon";
export const JSON_MEDIA_TYPE = "application/json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function projectForToon(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectForToon);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (
        key === "replies" &&
        Array.isArray(child) &&
        child.every((id) => Number.isSafeInteger(id) && id > 0)
      ) {
        return [key, child.join(";")];
      }
      return [key, projectForToon(child)];
    }),
  );
}

function restoreFromToon(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restoreFromToon);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key === "replies" && typeof child === "string") {
        if (child === "") return [key, []];
        const ids = child.split(";").map(Number);
        if (ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
          return [key, ids];
        }
      }
      return [key, restoreFromToon(child)];
    }),
  );
}

export function encodeApiToon(value: unknown): string {
  return `${encode(projectForToon(value))}\n`;
}

export function decodeApiToon(value: string): unknown {
  return restoreFromToon(decode(value) as JsonValue);
}

export function prefersJson(accept: string | undefined): boolean {
  if (!accept) return false;
  const mediaTypes = accept
    .split(",")
    .map((part) => part.split(";", 1)[0]?.trim().toLowerCase());
  return mediaTypes.includes(JSON_MEDIA_TYPE) && !mediaTypes.includes(TOON_MEDIA_TYPE);
}
