export type Me = { initials: string; savedCount: number };

/** Stand-in for your real user lookup. Replace the body, keep the signature. */
export async function getMe(sid: string): Promise<Me | null> {
  if (!sid) return null;
  return {
    initials: sid.slice(0, 2).toUpperCase(),
    savedCount: 3,
  };
}
