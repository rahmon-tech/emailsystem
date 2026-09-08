"use client";
import { useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import LinkExtension from '@tiptap/extension-link';
const EmailLink=LinkExtension.extend({addAttributes(){return {...this.parent?.(),emailButton:{default:false,parseHTML:element=>element.getAttribute('data-email-button')==='true',renderHTML:attributes=>attributes.emailButton?{'data-email-button':'true',style:'display:inline-block;background-color:#2457e0;color:#ffffff;padding:12px 20px;text-decoration:none;border-radius:6px'}:{}}};}});
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import {
  Box,
  IconButton,
  Tooltip,
  MenuItem,
  Select,
  Dialog,
  DialogTitle,
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
      StarterKit.configure({link:false}),
      EmailLink.configure({openOnClick:false}),
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
    }),
  });
  if (!editor) return <Box sx={{ minHeight: 330 }} />;
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
      icon: FormatListBulleted,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      icon: FormatListNumbered,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Align left",
      icon: FormatAlignLeft,
      run: () => editor.chain().focus().setTextAlign("left").run(),
    },
    {
      label: "Align center",
      icon: FormatAlignCenter,
      run: () => editor.chain().focus().setTextAlign("center").run(),
    },
    {
      label: "Align right",
      icon: FormatAlignRight,
      run: () => editor.chain().focus().setTextAlign("right").run(),
    },
    {
      label: "Insert link",
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
      icon: FormatQuote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "Undo",
      icon: Undo,
      run: () => editor.chain().focus().undo().run(),
    },
    {
      label: "Redo",
      icon: Redo,
      run: () => editor.chain().focus().redo().run(),
    },
  ];
  return (
    <>
      <Box
        sx={{
          border: "1px solid #dde5f1",
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
            bgcolor: "#f8faff",
            borderBottom: "1px solid #e7edf5",
          }}
        >
          <Select
            size="small"
            value={
              editor.isActive("heading", { level: 1 })
                ? "h1"
                : editor.isActive("heading", { level: 2 })
                  ? "h2"
                  : "p"
            }
            inputProps={{ "aria-label": "Text style" }}
            sx={{ height: 34, mr: 1 }}
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
          {buttons.map((b) => (
            <Tooltip key={b.label} title={b.label}>
              <IconButton
                size="small"
                aria-label={b.label}
                onClick={b.run}
                sx={{
                  color: b.active ? "primary.main" : "text.secondary",
                  bgcolor: b.active ? "#e0eaff" : "transparent",
                }}
              >
                <b.icon fontSize="small" />
              </IconButton>
            </Tooltip>
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
                width: 30,
                height: 30,
                border: 0,
                background: "none",
                cursor: "pointer",
              }}
            />
          </Tooltip>
        </Box>
        <EditorContent editor={editor} />
      </Box>
      <Dialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {dialog === "image"
            ? "Add image"
            : dialog === "button"
              ? "Add linked button"
              : "Add link"}
        </DialogTitle>
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
                          { type: "link", attrs: { href: url, emailButton:true } },
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
      </Dialog>
    </>
  );
}
