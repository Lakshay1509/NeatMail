"use client"

import { useEffect, useState } from "react"
import { useEditor, EditorContent, useEditorState, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { TextStyle, Color, FontFamily, FontSize } from "@tiptap/extension-text-style"
import TextAlign from "@tiptap/extension-text-align"
import Image from "@tiptap/extension-image"
import { Placeholder } from "@tiptap/extensions"
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Image as ImageIcon,
  Eraser,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ChevronDown,
  Palette,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toEditorHtml } from "@/lib/signature-html"
import {
  getSignatureConfig,
  SIGNATURE_SWATCHES,
  type FontOption,
  type SizeOption,
} from "./signature-config"

type SignatureEditorProps = {
  /** Stored signature (HTML for new signatures, plain text for legacy ones). */
  value: string
  /** Called with the editor's HTML whenever the content changes. */
  onChange: (html: string) => void
  /** Drives which font/size presets and toolbar buttons are shown. */
  isGmail: boolean
  placeholder?: string
  disabled?: boolean
}

/** A single square toolbar button with an active (pressed) state. */
function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      // Keep focus in the editor so commands apply to the current selection.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4",
        active && "bg-accent text-accent-foreground",
      )}
    >
      {children}
    </button>
  )
}

function ToolbarDivider() {
  return <Separator orientation="vertical" className="mx-0.5 !h-5" />
}

const SignatureEditor = ({
  value,
  onChange,
  isGmail,
  placeholder = "Add your signature — name, title, links, logo…",
  disabled = false,
}: SignatureEditorProps) => {
  const config = getSignatureConfig(isGmail)

  const editor = useEditor({
    // Required for Next.js SSR to avoid a hydration mismatch.
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Links are inserted from the toolbar; don't navigate away on click.
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
        },
      }),
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder }),
    ],
    content: toEditorHtml(value),
    onUpdate: ({ editor }) => {
      onChange(editor.isEmpty ? "" : editor.getHTML())
    },
  })

  // Keep the editor in sync if the stored value arrives or changes from outside (e.g. draft preferences load after mount).
  useEffect(() => {
    if (!editor) return
    const incoming = toEditorHtml(value)
    const current = editor.isEmpty ? "" : editor.getHTML()
    if (incoming !== current) {
      editor.commands.setContent(incoming, { emitUpdate: false })
    }
  }, [value, editor])

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [disabled, editor])

  if (!editor) {
    return (
      <div className="h-[180px] w-full animate-pulse rounded-md border border-input bg-muted/40" />
    )
  }

  return (
    <div
      className={cn(
        "signature-editor overflow-hidden rounded-md border border-input bg-background focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <Toolbar editor={editor} config={config} isGmail={isGmail} />
      <EditorContent
        editor={editor}
        className="max-h-[420px] min-h-[140px] overflow-y-auto px-3 py-2 text-sm"
      />
    </div>
  )
}

function Toolbar({
  editor,
  config,
  isGmail,
}: {
  editor: Editor
  config: ReturnType<typeof getSignatureConfig>
  isGmail: boolean
}) {
  // Recompute only the flags the toolbar renders from, so it stays in sync without re-rendering on every keystroke.
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      blockquote: editor.isActive("blockquote"),
      link: editor.isActive("link"),
      alignLeft: editor.isActive({ textAlign: "left" }),
      alignCenter: editor.isActive({ textAlign: "center" }),
      alignRight: editor.isActive({ textAlign: "right" }),
      fontFamily: editor.getAttributes("textStyle").fontFamily as string | undefined,
      fontSize: editor.getAttributes("textStyle").fontSize as string | undefined,
      color: editor.getAttributes("textStyle").color as string | undefined,
      linkHref: editor.getAttributes("link").href as string | undefined,
    }),
  })

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-1.5 py-1">
      <FontPicker editor={editor} fonts={config.fonts} current={state.fontFamily} />
      <SizePicker editor={editor} sizes={config.sizes} current={state.fontSize} />

      <ToolbarDivider />

      <ToolbarButton
        label="Bold"
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic />
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        active={state.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </ToolbarButton>

      <ColorPicker editor={editor} current={state.color} />

      <ToolbarDivider />

      <LinkPicker editor={editor} currentHref={state.linkHref} active={state.link} />

      {config.showAlignment && (
        <>
          <ToolbarDivider />
          <ToolbarButton
            label="Align left"
            active={state.alignLeft}
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
          >
            <AlignLeft />
          </ToolbarButton>
          <ToolbarButton
            label="Align center"
            active={state.alignCenter}
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
          >
            <AlignCenter />
          </ToolbarButton>
          <ToolbarButton
            label="Align right"
            active={state.alignRight}
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
          >
            <AlignRight />
          </ToolbarButton>
        </>
      )}

      <ToolbarDivider />

      <ToolbarButton
        label="Bulleted list"
        active={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolbarButton>
      {isGmail && (
        <ToolbarButton
          label="Quote"
          active={state.blockquote}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote />
        </ToolbarButton>
      )}

      <ToolbarDivider />

      <ImagePicker editor={editor} />
      <ToolbarButton
        label="Remove formatting"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <Eraser />
      </ToolbarButton>
    </div>
  )
}

// Shared styling for the font/size dropdown triggers, applied directly to the Radix trigger so its open handlers stay wired.
const DROPDOWN_TRIGGER_CLASS =
  "inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-foreground transition-colors hover:bg-accent data-[state=open]:bg-accent focus-visible:outline-none"

function FontPicker({
  editor,
  fonts,
  current,
}: {
  editor: Editor
  fonts: FontOption[]
  current?: string
}) {
  const active = fonts.find((f) => f.value === current)
  return (
    // Non-modal, since a default modal dropdown next to a ProseMirror editor closes instantly by stealing focus.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className={DROPDOWN_TRIGGER_CLASS}>
        <span className="max-w-[9rem] truncate">{active?.label ?? fonts[0].label}</span>
        <ChevronDown className="size-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 overflow-y-auto"
        // Keep the caret in the editor after picking, instead of returning focus to the trigger.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {fonts.map((font) => (
          <DropdownMenuItem
            key={font.label}
            onSelect={() => editor.chain().focus().setFontFamily(font.value).run()}
            style={{ fontFamily: font.value }}
            className={cn(active?.value === font.value && "bg-accent")}
          >
            {font.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SizePicker({
  editor,
  sizes,
  current,
}: {
  editor: Editor
  sizes: SizeOption[]
  current?: string
}) {
  const active = sizes.find((s) => s.value === current)
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className={DROPDOWN_TRIGGER_CLASS}>
        <span className="max-w-[9rem] truncate">{active?.label ?? "Size"}</span>
        <ChevronDown className="size-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 overflow-y-auto"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {sizes.map((size) => (
          <DropdownMenuItem
            key={size.value}
            onSelect={() => editor.chain().focus().setFontSize(size.value).run()}
            className={cn(active?.value === size.value && "bg-accent")}
          >
            {size.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ColorPicker({ editor, current }: { editor: Editor; current?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Text color"
          title="Text color"
          onMouseDown={(e) => e.preventDefault()}
          className="inline-flex h-8 w-8 flex-col items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:size-4"
        >
          <Palette />
          <span
            className="mt-0.5 h-[3px] w-4 rounded-full"
            style={{ backgroundColor: current || "#000000" }}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div className="grid grid-cols-7 gap-1.5">
          {SIGNATURE_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editor.chain().focus().setColor(color).run()
                setOpen(false)
              }}
              className={cn(
                "h-5 w-5 rounded-sm border border-black/10 transition-transform hover:scale-110",
                current === color && "ring-2 ring-ring ring-offset-1",
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="color"
            aria-label="Custom color"
            value={current || "#000000"}
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
            className="h-8 w-8 cursor-pointer rounded-md border border-input bg-background p-0.5"
          />
          <Button
            variant="ghost"
            size="sm"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor.chain().focus().unsetColor().run()
              setOpen(false)
            }}
          >
            Reset color
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function LinkPicker({
  editor,
  currentHref,
  active,
}: {
  editor: Editor
  currentHref?: string
  active: boolean
}) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")

  // Pre-fill with the current link when the popover opens (event-driven, so no setState-in-effect).
  const handleOpenChange = (next: boolean) => {
    if (next) setUrl(currentHref ?? "")
    setOpen(next)
  }

  const apply = () => {
    const trimmed = url.trim()
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run()
    } else {
      const href = /^(https?:|mailto:|tel:)/i.test(trimmed) ? trimmed : `https://${trimmed}`
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run()
    }
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Insert link"
          aria-pressed={active}
          title="Insert link"
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:size-4",
            active && "bg-accent text-accent-foreground",
          )}
        >
          <LinkIcon />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="space-y-2">
          <Label htmlFor="signature-link-url" className="text-xs">
            Link URL
          </Label>
          <Input
            id="signature-link-url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                apply()
              }
            }}
            autoFocus
          />
          <div className="flex justify-end gap-2 pt-1">
            {active && (
              <Button
                variant="ghost"
                size="sm"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  editor.chain().focus().extendMarkRange("link").unsetLink().run()
                  setOpen(false)
                }}
              >
                Remove
              </Button>
            )}
            <Button size="sm" onMouseDown={(e) => e.preventDefault()} onClick={apply}>
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ImagePicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")

  const insert = () => {
    const trimmed = url.trim()
    if (!trimmed) return
    editor.chain().focus().setImage({ src: trimmed }).run()
    setUrl("")
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setUrl("")
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Insert image"
          title="Insert image"
          onMouseDown={(e) => e.preventDefault()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:size-4"
        >
          <ImageIcon />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="space-y-2">
          <Label htmlFor="signature-image-url" className="text-xs">
            Image URL
          </Label>
          <Input
            id="signature-image-url"
            placeholder="https://yoursite.com/logo.png"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                insert()
              }
            }}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Paste a link to a hosted image (e.g. your logo). Email clients block
            embedded images, so host it somewhere public first.
          </p>
          <div className="flex justify-end pt-1">
            <Button size="sm" onMouseDown={(e) => e.preventDefault()} onClick={insert}>
              Insert
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default SignatureEditor
