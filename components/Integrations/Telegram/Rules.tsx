'use client'

import { useState, useEffect } from "react";
import { useGetUserTags } from "@/features/tags/use-get-user-tags";
import { useGetTelegramRules } from "@/features/telegram/use-get-telegram-rules"
import { useAddRulesTelegram } from "@/features/telegram/use-post-telegram-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Loader2, Save, ChevronDown, ChevronUp } from "lucide-react";
import { Label } from "@/components/ui/label";

type Rule = {
  domain: string;
  tag_id: string;
};

const Rules = () => {
    const { data: rulesData, isLoading: rulesLoading, isError } = useGetTelegramRules();
    const { data: tagData, isLoading: tagsLoading } = useGetUserTags();
    const mutation = useAddRulesTelegram();
    
    const [rules, setRules] = useState<Rule[]>([]);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        if (rulesData?.data) {
            setRules(rulesData.data);
        }
    }, [rulesData]);

    const handleAddRule = () => {
        if (rules.length >= 10) return;
        setRules([...rules, { domain: "", tag_id: "" }]);
    };

    const handleRemoveRule = (index: number) => {
        const newRules = [...rules];
        newRules.splice(index, 1);
        setRules(newRules);
    };

    const handleDomainChange = (index: number, value: string) => {
        const newRules = [...rules];
        newRules[index].domain = value;
        setRules(newRules);
    };

    const handleTagChange = (index: number, value: string) => {
        const newRules = [...rules];
        newRules[index].tag_id = value;
        setRules(newRules);
    };

    const handleSave = () => {
        // filter out incomplete rules
        const validRules = rules.filter(r => r.domain.trim() !== "" && r.tag_id !== "");
        mutation.mutateAsync(validRules);
    };

    const isLoading = rulesLoading || tagsLoading;

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

    return (
        <div className="space-y-6">
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

                <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                        <div>
                            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </div>
                    </Button>
                
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
                            disabled={rules.length >= 10}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Add Rule
                        </Button>
                    )}
                    
                </div>

            {isOpen && (
                <div className="pt-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    {rules.length === 0 ? (
                        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                            No rules configured. Click Add Rule to create one.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {rules.map((rule, idx) => (
                                <div key={idx} className="flex items-end gap-3">
                                    <div className="flex-1 space-y-1">
                                        <Label className="text-xs">Sender Email</Label>
                                        <Input 
                                            placeholder="e.g. notifications@domain.com" 
                                            value={rule.domain} 
                                            onChange={(e) => handleDomainChange(idx, e.target.value)}
                                        />
                                    </div>
                                    <div className="flex-1 space-y-1">
                                        <Label className="text-xs">Tag</Label>
                                        <Select value={rule.tag_id} onValueChange={(val) => handleTagChange(idx, val)}>
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
                                    </div>
                                    <Button 
                                        variant="destructive" 
                                        size="icon" 
                                        onClick={() => handleRemoveRule(idx)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex justify-end pt-6">
                        <Button 
                            onClick={handleSave} 
                            disabled={mutation.isPending || rules.length === 0}
                        >
                            {mutation.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save Rules
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Rules;