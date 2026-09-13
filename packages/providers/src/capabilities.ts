const inlineApiProviders = new Set([
  "resend",
  "sendgrid",
  "postmark",
  "mailjet",
  "mailgun",
]);

export function supportsInlineAttachmentTransport(connection: {
  type: string;
  transport: string;
}) {
  return (
    connection.transport === "smtp" ||
    connection.type === "ses" ||
    inlineApiProviders.has(connection.type)
  );
}
