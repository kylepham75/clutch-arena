export function getPartyHost(): string | null {
  return (
    process.env.NEXT_PUBLIC_PARTYKIT_HOST ||
    process.env.PARTYKIT_HOST ||
    null
  );
}

export function isPartyKitConfigured(): boolean {
  return Boolean(getPartyHost());
}
