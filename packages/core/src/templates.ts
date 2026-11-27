import { z } from "zod";
import { db } from "@emailsystem/db";
import { normalizeEmail } from "@emailsystem/email";
import { AppError } from "./errors";

const templateInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    category: z.string().trim().min(1).max(60).default("Custom"),
    subject: z.string().max(250).default(""),
    preheader: z.string().max(500).default(""),
    html: z.string().min(1),
    text: z.string().max(200000).default(""),
    editorMode: z.enum(["rich", "source"]).default("rich"),
  })
  .strict();

const templateUpdate = templateInput.partial().strict();

type StarterTemplate = {
  id: string;
  name: string;
  category: string;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  editorMode: "rich";
};

const button = (label: string, href = "https://example.com") =>
  `<p><a data-email-button="true" href="${href}">${label}</a></p>`;

const starterTemplates: StarterTemplate[] = [
  {
    id: "starter-newsletter",
    name: "Clean newsletter",
    category: "Newsletter",
    subject: "Your monthly update",
    preheader: "News, highlights and what is coming next.",
    html:
      "<h1>Monthly update</h1>" +
      "<p>Hello,</p>" +
      "<p>Share the most important news first, then keep each section short and useful.</p>" +
      "<h2>What is new</h2>" +
      "<p>Add your first story or announcement here.</p>" +
      "<h2>Worth knowing</h2>" +
      "<p>Add a second update, resource or customer story.</p>" +
      button("Read the full update"),
    text: "",
    editorMode: "rich",
  },
  {
    id: "starter-announcement",
    name: "Product announcement",
    category: "Announcement",
    subject: "Something new is here",
    preheader: "A concise launch email with one clear action.",
    html:
      "<h1>Meet our latest update</h1>" +
      "<p>Explain what changed and why it matters in one short paragraph.</p>" +
      "<h2>Why you will care</h2>" +
      "<ul><li>Benefit one</li><li>Benefit two</li><li>Benefit three</li></ul>" +
      button("See what is new"),
    text: "",
    editorMode: "rich",
  },
  {
    id: "starter-event",
    name: "Event invitation",
    category: "Event",
    subject: "You are invited",
    preheader: "Event details and one simple RSVP action.",
    html:
      "<h1>You are invited</h1>" +
      "<p>Join us for an event created for our community.</p>" +
      "<p><strong>Date:</strong> Add date<br><strong>Time:</strong> Add time<br><strong>Location:</strong> Add location</p>" +
      "<p>Use this space for the main reason someone should attend.</p>" +
      button("Reserve your place"),
    text: "",
    editorMode: "rich",
  },
  {
    id: "starter-welcome",
    name: "Welcome message",
    category: "Welcome",
    subject: "Welcome — here is what to do next",
    preheader: "A warm introduction with a simple next step.",
    html:
      "<h1>Welcome</h1>" +
      "<p>Thanks for joining us. We are glad you are here.</p>" +
      "<p>Tell new contacts what they can expect and where they should begin.</p>" +
      button("Get started"),
    text: "",
    editorMode: "rich",
  },
  {
    id: "starter-nonprofit",
    name: "Nonprofit appeal",
    category: "Nonprofit",
    subject: "Help us make the next step possible",
    preheader: "Tell one human story and make the action clear.",
    html:
      "<h1>Your support can move this forward</h1>" +
      "<p>Open with one concrete story or need. Keep the language human and specific.</p>" +
      "<p>Explain what support makes possible and how people can participate.</p>" +
      button("Support this work"),
    text: "",
    editorMode: "rich",
  },
  {
    id: "starter-update",
    name: "Simple update",
    category: "General",
    subject: "A quick update",
    preheader: "A simple message for short announcements.",
    html:
      "<h1>A quick update</h1>" +
      "<p>Put the main message here. Keep it focused and easy to scan.</p>" +
      "<p>Add any important timing, next step or contact information below.</p>",
    text: "",
    editorMode: "rich",
  },
];

function validateHtml(html: string) {
  try {
    return normalizeEmail(html);
  } catch (error) {
    throw new AppError(
      400,
      "TEMPLATE_HTML",
      error instanceof Error ? error.message : "Template HTML is invalid.",
    );
  }
}

function starterById(id: string) {
  return starterTemplates.find((template) => template.id === id) ?? null;
}

export async function listTemplates(userId: string) {
  const custom = await db.emailTemplate.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      category: true,
      subject: true,
      preheader: true,
      editorMode: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  return {
    starters: starterTemplates.map((template) => ({
      id: template.id,
      name: template.name,
      category: template.category,
      subject: template.subject,
      preheader: template.preheader,
      editorMode: template.editorMode,
      kind: "starter" as const,
    })),
    custom: custom.map((template) => ({
      ...template,
      kind: "custom" as const,
    })),
  };
}

export async function getTemplate(userId: string, id: string) {
  const starter = starterById(id);
  if (starter) {
    const rendered = validateHtml(starter.html);
    return {
      ...starter,
      kind: "starter" as const,
      previewHtml: rendered.html,
      text: starter.text || rendered.text,
    };
  }
  if (!z.uuid().safeParse(id).success)
    throw new AppError(404, "NOT_FOUND", "Template not found.");
  const template = await db.emailTemplate.findFirst({
    where: { id, userId },
  });
  if (!template) throw new AppError(404, "NOT_FOUND", "Template not found.");
  const rendered = validateHtml(template.html);
  return {
    ...template,
    kind: "custom" as const,
    previewHtml: rendered.html,
    text: template.text || rendered.text,
  };
}

export async function createTemplate(userId: string, input: unknown) {
  const data = templateInput.parse(input);
  validateHtml(data.html);
  return db.emailTemplate.create({ data: { userId, ...data } });
}

export async function updateTemplate(
  userId: string,
  id: string,
  input: unknown,
) {
  if (!z.uuid().safeParse(id).success)
    throw new AppError(404, "NOT_FOUND", "Template not found.");
  const current = await db.emailTemplate.findFirst({
    where: { id, userId },
  });
  if (!current) throw new AppError(404, "NOT_FOUND", "Template not found.");
  const patch = templateUpdate.parse(input);
  if (patch.html !== undefined) validateHtml(patch.html);
  return db.emailTemplate.update({ where: { id }, data: patch });
}

export async function deleteTemplate(userId: string, id: string) {
  if (!z.uuid().safeParse(id).success)
    throw new AppError(404, "NOT_FOUND", "Template not found.");
  const result = await db.emailTemplate.deleteMany({ where: { id, userId } });
  if (!result.count) throw new AppError(404, "NOT_FOUND", "Template not found.");
  return { removed: true };
}
