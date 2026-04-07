'use client'

import { useState, useEffect } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useGetUserTags } from "@/features/tags/use-get-user-tags";
import { useGetTelegramRules } from "@/features/telegram/use-get-telegram-rules"
import { useAddRulesTelegram } from "@/features/telegram/use-post-telegram-rules";
import { useGetTelegramPreferences } from "@/features/telegram/use-get-telegram-preferences";
import { usePostTelegramPreferences } from "@/features/telegram/use-post-telegram-preferences";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Loader2, Save, ChevronDown, ChevronUp } from "lucide-react";
import { Label } from "@/components/ui/label";
import { useGetUserIsGmail } from "@/features/user/use-get-user-isGmail";

const isValidSender = (value: string) => {
    const trimmed = value.trim();

    // Allow either a full sender email or a plain domain.
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const domainRegex = /^(?!-)(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,63}$/;

    return emailRegex.test(trimmed) || domainRegex.test(trimmed);
};

const ruleSchema = z.object({
    domain: z
        .string()
        .trim()
        .min(1, "Sender email or domain is required")
        .refine(isValidSender, "Enter a valid sender email or domain"),
    tag_id: z.string().trim().min(1, "Tag is required"),
});

const formSchema = z.object({
    rules: z.array(ruleSchema).max(10, "You can add up to 10 rules"),
});

type FormValues = z.infer<typeof formSchema>;

const Rules = () => {
    const { data: rulesData, isLoading: rulesLoading, isError } = useGetTelegramRules();
    const { data: prefsResponse, isLoading: prefsLoading } = useGetTelegramPreferences();
    const { data: tagData, isLoading: tagsLoading } = useGetUserTags();
    const {data:isGmailData}= useGetUserIsGmail();
    
    const mutation = useAddRulesTelegram();
    const mutationPrefs = usePostTelegramPreferences();

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            rules: [],
        },
    });

    const { fields, append, remove, replace } = useFieldArray({
        control: form.control,
        name: "rules",
    });

    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        if (rulesData?.data) {
            form.reset({
                rules: rulesData.data.map((rule) => ({
                    domain: rule.domain ?? "",
                    tag_id: rule.tag_id ?? "",
                })),
            });
        }
    }, [rulesData, form]);

    const handleAddRule = () => {
        if (fields.length >= 10) return;
        append({ domain: "", tag_id: "" });
    };

    const handleRemoveRule = async (index: number) => {
        const currentRules = form.getValues("rules");
        const nextRules = currentRules.filter((_, idx) => idx !== index);

        // Optimistically update the form, then persist to the backend.
        remove(index);

        try {
            await mutation.mutateAsync(nextRules);
        } catch {
            // Roll back local state when persistence fails.
            replace(currentRules);
        }
    };

    const handleSave = async (values: FormValues) => {
        await mutation.mutateAsync(values.rules);
    };

    const isLoading = rulesLoading || tagsLoading || prefsLoading;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (isError) {
        return <div className="p-4 text-red-500">Failed to load rules.</div>;
    }

    const tags = tagData?.data || [];
    const prefsData = prefsResponse?.data?.[0];
    const fwd_imp_mails = prefsData?.forward_important_mails ?? false;
    const fwd_draft = prefsData?.forward_draft_for_confirmation ?? false;

    const handleToggleFwdImp = (val: boolean) => {
        mutationPrefs.mutate({ fwd_imp_mails: val, fwd_draft });
    };
    
    const handleToggleFwdDraft = (val: boolean) => {
        mutationPrefs.mutate({ fwd_imp_mails, fwd_draft: val });
    };

    return (
        <div className="space-y-8">
            <div className="space-y-6 pb-6 border-b">
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label className="text-base font-medium">Forward Important Emails</Label>
                            <p className="text-sm text-muted-foreground">Receive instant alerts for emails marked as important or priority.</p>
                        </div>
                        <Switch 
                            checked={fwd_imp_mails} 
                            onCheckedChange={handleToggleFwdImp} 
                            disabled={mutationPrefs.isPending} 
                        />
                    </div>
                    {isGmailData?.is_gmail===true && <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label className="text-base font-medium">Review AI Drafts</Label>
                            <p className="text-sm text-muted-foreground">Get AI-generated drafts sent to Telegram for review before sending.</p>
                        </div>
                        <Switch 
                            checked={fwd_draft} 
                            onCheckedChange={handleToggleFwdDraft} 
                            disabled={mutationPrefs.isPending} 
                        />
                    </div>}
                </div>
            </div>

            <div className="space-y-4">
                <div 
                    className="flex items-center justify-between cursor-pointer group"
                    onClick={() => setIsOpen(!isOpen)}
                >
                    <div>
                        <h3 className="text-lg font-medium group-hover:text-primary transition-colors">Domain Rules</h3>
                        <p className="text-sm text-muted-foreground">
                            Automatically tag or route emails from specific domains.
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        {isOpen && (
                            <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleAddRule();
                                }}
                                disabled={fields.length >= 10}
                            >
                                <Plus className="h-4 w-4 mr-2" />
                                Add Rule
                            </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                            <div>
                                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </div>
                        </Button>
                    </div>
                </div>

                {isOpen && (
                    <form className="pt-2 animate-in fade-in slide-in-from-top-2 duration-200" onSubmit={form.handleSubmit(handleSave)}>
                        {fields.length === 0 ? (
                            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                                No rules configured. Click Add Rule to create one.
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {fields.map((field, idx) => (
                                    <div key={field.id} className="flex items-end gap-3">
                                        <div className="flex-1 space-y-1">
                                            <Label className="text-xs">Sender Email or Domain</Label>
                                            <Controller
                                                control={form.control}
                                                name={`rules.${idx}.domain`}
                                                render={({ field: domainField }) => (
                                                    <Input
                                                        placeholder="e.g. notifications@domain.com or domain.com"
                                                        value={domainField.value}
                                                        onChange={domainField.onChange}
                                                    />
                                                )}
                                            />
                                            {form.formState.errors.rules?.[idx]?.domain?.message && (
                                                <span className="text-xs text-red-500">
                                                    {form.formState.errors.rules[idx]?.domain?.message}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex-1 space-y-1">
                                            <Label className="text-xs">Tag</Label>
                                            <Controller
                                                control={form.control}
                                                name={`rules.${idx}.tag_id`}
                                                render={({ field: tagField }) => (
                                                    <Select value={tagField.value} onValueChange={tagField.onChange}>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Select a tag" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {tags.map((t: any) => (
                                                                <SelectItem key={t.tag.id} value={t.tag.id}>
                                                                    {t.tag.name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                )}
                                            />
                                            {form.formState.errors.rules?.[idx]?.tag_id?.message && (
                                                <span className="text-xs text-red-500">
                                                    {form.formState.errors.rules[idx]?.tag_id?.message}
                                                </span>
                                            )}
                                        </div>
                                        <Button 
                                            type="button"
                                            variant="destructive" 
                                            size="icon" 
                                            onClick={() => handleRemoveRule(idx)}
                                            disabled={mutation.isPending}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {form.formState.errors.rules?.message && (
                            <p className="pt-3 text-xs text-red-500">{form.formState.errors.rules.message}</p>
                        )}

                        <div className="flex justify-end pt-6">
                            <Button type="submit" disabled={mutation.isPending}>
                                {mutation.isPending ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <Save className="h-4 w-4 mr-2" />
                                )}
                                Save Rules
                            </Button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default Rules;