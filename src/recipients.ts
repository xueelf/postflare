const RECIPIENT_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export function parseRecipients(value: string): string[] {
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

export function validRecipients(value: string): boolean {
  const recipients = parseRecipients(value);

  return (
    recipients.length > 0 &&
    recipients.every(part => RECIPIENT_PATTERN.test(part))
  );
}
