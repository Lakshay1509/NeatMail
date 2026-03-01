'use client'

import { useState, useEffect } from "react"
import { useGetUserDraftPreference } from "@/features/draftPreference/use-get-user-draftPreference"
import { Textarea } from "./ui/textarea"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
// import {
//   Select,
//   SelectContent,
//   SelectItem,
//   SelectTrigger,
//   SelectValue,
// } from "./ui/select"
import { Button } from "./ui/button"
import { HelpCircle } from "lucide-react"
import { useAddUserDraftPrefernce } from "@/features/draftPreference/use-add-user-draftPreference"
import { Checkbox } from "./ui/checkbox"
import { useGetUserSubscribed } from "@/features/user/use-get-subscribed"

// const FONT_OPTIONS = [
//   { value: "default", label: "Gmail/Outlook default" },
//   { value: "arial", label: "Arial" },
//   { value: "times-new-roman", label: "Times New Roman" },
//   { value: "courier-new", label: "Courier New" },
//   { value: "georgia", label: "Georgia" },
//   { value: "verdana", label: "Verdana" },
// ]

const UserDraftPreference = () => {
  const { data, isLoading, isError } = useGetUserDraftPreference();
  const { data: subData } = useGetUserSubscribed();
  const muation = useAddUserDraftPrefernce();

  const [draftPrompt, setDraftPrompt] = useState<string>("")
  const [signature, setSignature] = useState<string>("")
  const [fontSize, setFontSize] = useState<number>(0)
  const [fontColor, setFontColor] = useState<string>("#000000")
  const [enabled, setEnabled] = useState<boolean>(false)

  useEffect(() => {
    if (data?.data) {
      setDraftPrompt(data.data.draftPrompt ?? "")
      setSignature(data.data.signature ?? "")
      setFontSize(data.data.fontSize ?? 0)
      setFontColor(data.data.fontColor ?? "#000000")
      setEnabled(data.data.enabled ?? false)
    }
  }, [data])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Failed to load draft preferences. Please try again.
      </div>
    )
  }

  const handleSubmit = async()=>{

    await muation.mutateAsync({
      fontColor:fontColor,
      fontSize:fontSize,
      draftPrompt:draftPrompt,
      signature:signature,
      enabled:enabled
    })


    
  }

  return (
    <div className="space-y-6 w-full max-w-full">
      
      <div className="flex items-start justify-between">
				<div>
					<h2 className="text-lg font-semibold text-gray-900 mb-1">Enable Drafts</h2>
					<p className="text-gray-600 text-sm md:text-base max-w-2xl">
						Automatically watch incoming emails and draft suitable response for them if needed.
					</p>
				</div>
				<div className="flex flex-col items-end gap-3">
					<div className="flex items-center gap-2 pt-1">
						<span className="text-sm font-medium text-gray-700">
							{enabled ? 'Active' : 'Inactive'}
						</span>
						<Checkbox
							disabled={subData?.subscribed === false}
							checked={enabled}
							onCheckedChange={(checked) => setEnabled(!!checked)}
							className="w-5 h-5 border-gray-300"
						/>
					</div>

				</div>
			</div>
      {/* Draft Prompt */}
      <div className="space-y-1.5">
        <Label htmlFor="draft-prompt" className="text-lg font-semibold">
          Draft Prompt
        </Label>
        <Textarea
          id="draft-prompt"
          placeholder="Reply in a friendly manner"
          value={draftPrompt}
          onChange={(e) => setDraftPrompt(e.target.value)}
          maxLength={1000}
          rows={4}
          className="resize-none w-full"
        />
        <p className="text-xs text-muted-foreground">
          Add personalized guidelines to shape how the AI composes your email responses. You may include your goals, communication preferences, decision-making approach, or important details about your business. (Up to 1000 characters)
        </p>
      </div>

      {/* Email Signature */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="email-signature" className="text-lg font-semibold">
            Email signature
          </Label>
          <HelpCircle className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="text-xs text-muted-foreground">
          To make sure your signature appears properly, copy it from your Gmail settings rather than from a previously sent email.
        </p>
        <Textarea
          id="email-signature"
          placeholder="Paste signature here"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          rows={4}
          className="resize-none w-full"
        />
      </div>

      {/* Font
      <div className="space-y-1.5">
        <Label htmlFor="font-select" className="text-sm font-medium">
          Font
        </Label>
        <Select value={font} onValueChange={setFont}>
          <SelectTrigger id="font-select" className="w-full">
            <SelectValue placeholder="Select a font" />
          </SelectTrigger>
          <SelectContent>
            {FONT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div> */}

      {/* Font Size */}
      <div className="space-y-1.5">
        <Label htmlFor="font-size" className="text-lg font-semibold">
          Font Size
        </Label>
        <Input
          id="font-size"
          type="number"
          min={8}
          max={72}
          value={fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
          className="w-full"
        />
      </div>

      {/* Font Color */}
      <div className="space-y-1.5">
        <Label htmlFor="font-color-text" className="text-lg font-semibold">
          Font Color
        </Label>
        <div className="flex items-center gap-2">
          <div
            className="relative h-8 w-8 flex-shrink-0 cursor-pointer overflow-hidden rounded-md border border-input shadow-xs"
            style={{ backgroundColor: fontColor }}
          >
            <input
              id="font-color-picker"
              type="color"
              value={fontColor}
              onChange={(e) => setFontColor(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Pick font color"
            />
          </div>
          <Input
            id="font-color-text"
            type="text"
            value={fontColor}
            onChange={(e) => {
              const val = e.target.value
              if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) {
                setFontColor(val)
              }
            }}
            className="flex-1"
            placeholder="#000000"
          />
        </div>
      </div>

      {/* Update Button */}
      <Button className="" size="sm" onClick={handleSubmit} disabled={muation.isPending || isLoading}>
        Update preferences
      </Button>
    </div>
  )
}

export default UserDraftPreference