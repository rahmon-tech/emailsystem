"use client";
import { ResponsiveDialog } from "./shared";
import { useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import LinkExtension from "@tiptap/extension-link";
const EmailLink = LinkExtension.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      emailButton: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute("data-email-button") === "true",
        renderHTML: (attributes) =>
          attributes.emailButton
            ? {
                "data-email-button": "true",
                style:
                  "display:inline-block;background-color:#2457e0;color:#ffffff;padding:12px 20px;text-decoration:none;border-radius:6px",
              }
            : {},
      },
    };
  },
});
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import {
  Box,
  Skeleton,
  IconButton,
  Tooltip,
  MenuItem,
  Select,
  DialogContent,
  DialogActions,
  TextField,
  Button,
} from "@mui/material";
import {
  FormatBold,
  FormatItalic,
  FormatUnderlined,
  StrikethroughS,
  FormatListBulleted,
  FormatListNumbered,
  FormatAlignLeft,
  FormatAlignCenter,
  FormatAlignRight,
  Link,
  ImageOutlined,
  HorizontalRule,
  FormatQuote,
  Undo,
  Redo,
  SmartButtonOutlined,
} from "@mui/icons-material";
export function RichEditor({
  initialHtml,
  onChange,
}: {
  initialHtml: string;
  onChange: (html: string) => void;
}) {
  const [dialog, setDialog] = useState<"link" | "image" | "button" | null>(
      null,
    ),
    [url, setUrl] = useState("");
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: false }),
      EmailLink.configure({ openOnClick: false }),
      Image,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
    ],
    content: initialHtml,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        "aria-label": "Email body",
        role: "textbox",
        "aria-multiline": "true",
      },
    },
  });
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold"),
      italic: editor?.isActive("italic"),
      underline: editor?.isActive("underline"),
      strike: editor?.isActive("strike"),
      bullet: editor?.isActive("bulletList"),
      ordered: editor?.isActive("orderedList"),
      left: editor?.isActive({ textAlign: "left" }),
      center: editor?.isActive({ textAlign: "center" }),
      right: editor?.isActive({ textAlign: "right" }),
      link: editor?.isActive("link"),
      quote: editor?.isActive("blockquote"),
      heading: editor?.isActive("heading", { level: 1 })
        ? "h1"
        : editor?.isActive("heading", { level: 2 })
          ? "h2"
          : "p",
      undo: editor?.can().undo(),
      redo: editor?.can().redo(),
    }),
  });
  if (!editor)
    return (
      <Skeleton variant="rounded" height={360} aria-label="Loading editor" />
    );
  const buttons = [
    {
      label: "Bold",
      icon: FormatBold,
      active: state?.bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      icon: FormatItalic,
      active: state?.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Underline",
      icon: FormatUnderlined,
      active: state?.underline,
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: "Strike",
      icon: StrikethroughS,
      active: state?.strike,
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      label: "Bullet list",
      active: state?.bullet,
      icon: FormatListBulleted,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      active: state?.ordered,
      icon: FormatListNumbered,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Align left",
      active: state?.left,
      icon: FormatAlignLeft,
      run: () => editor.chain().focus().setTextAlign("left").run(),
    },
    {
      label: "Align center",
      active: state?.center,
      icon: FormatAlignCenter,
      run: () => editor.chain().focus().setTextAlign("center").run(),
    },
    {
      label: "Align right",
      active: state?.right,
      icon: FormatAlignRight,
      run: () => editor.chain().focus().setTextAlign("right").run(),
    },
    {
      label: "Insert link",
      active: state?.link,
      icon: Link,
      run: () => {
        setUrl("");
        setDialog("link");
      },
    },
    {
      label: "Insert image",
      icon: ImageOutlined,
      run: () => {
        setUrl("");
        setDialog("image");
      },
    },
    {
      label: "Insert button",
      icon: SmartButtonOutlined,
      run: () => {
        setUrl("");
        setDialog("button");
      },
    },
    {
      label: "Divider",
      icon: HorizontalRule,
      run: () => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      label: "Blockquote",
      active: state?.quote,
      icon: FormatQuote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "Undo",
      disabled: !state?.undo,
      icon: Undo,
      run: () => editor.chain().focus().undo().run(),
    },
    {
      label: "Redo",
      disabled: !state?.redo,
      icon: Redo,
      run: () => editor.chain().focus().redo().run(),
    },
  ];
  return (
    <>
      <Box
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            display: "flex",
            gap: 0.2,
            flexWrap: "wrap",
            p: 1,
            bgcolor: "action.hover",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Select
            size="small"
            value={state?.heading ?? "p"}
            inputProps={{ "aria-label": "Text style" }}
            sx={{ height: 42, mr: 0.5, fontSize: 12, minWidth: 112 }}
            onChange={(e) => {
              if (e.target.value === "p")
                editor.chain().focus().setParagraph().run();
              else
                editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: e.target.value === "h1" ? 1 : 2 })
                  .run();
            }}
          >
            <MenuItem value="p">Paragraph</MenuItem>
            <MenuItem value="h1">Heading 1</MenuItem>
            <MenuItem value="h2">Heading 2</MenuItem>
          </Select>
          {[
            buttons.slice(0, 4),
            buttons.slice(4, 6),
            buttons.slice(6, 9),
            buttons.slice(9, 14),
            buttons.slice(14),
          ].map((group, i) => (
            <Box
              key={i}
              sx={{
                display: "flex",
                alignItems: "center",
                borderLeft: i ? 1 : 0,
                borderColor: "divider",
                pl: i ? 0.5 : 0,
              }}
            >
              {group.map((b) => (
                <Tooltip key={b.label} title={b.label}>
                  <span>
                    <IconButton
                      aria-label={b.label}
                      aria-pressed={
                        b.active === undefined ? undefined : !!b.active
                      }
                      disabled={b.disabled}
                      onClick={b.run}
                      sx={{
                        color: b.active ? "primary.main" : "text.secondary",
                        bgcolor: b.active ? "action.selected" : "transparent",
                      }}
                    >
                      <b.icon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              ))}
            </Box>
          ))}
          <Tooltip title="Text color">
            <input
              type="color"
              aria-label="Text color"
              defaultValue="#17243b"
              onChange={(e) =>
                editor.chain().focus().setColor(e.target.value).run()
              }
              style={{
                width: 42,
                height: 42,
                border: 0,
                background: "none",
                cursor: "pointer",
              }}
            />
          </Tooltip>
        </Box>
        <EditorContent editor={editor} />
      </Box>
      <ResponsiveDialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={
          dialog === "image"
            ? "Add image"
            : dialog === "button"
              ? "Add linked button"
              : "Add link"
        }
      >
        <DialogContent>
          <TextField
            autoFocus
            label="HTTPS URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!/^https:\/\//i.test(url)}
            onClick={() => {
              if (dialog === "image")
                editor.chain().focus().setImage({ src: url }).run();
              else if (dialog === "button")
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Learn more",
                        marks: [
                          {
                            type: "link",
                            attrs: { href: url, emailButton: true },
                          },
                          { type: "bold" },
                        ],
                      },
                    ],
                  })
                  .run();
              else
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .setLink({ href: url })
                  .run();
              setDialog(null);
            }}
          >
            Insert
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </>
  );
}
