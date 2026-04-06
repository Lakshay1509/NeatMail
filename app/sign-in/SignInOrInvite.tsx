"use client";

import { useState } from "react";
import { SignIn } from "@clerk/nextjs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { checkUserEmail } from "./actions";

interface SignInOrInviteProps {
  initialValidToken: boolean;
  initialMessage?: string;
}

export function SignInOrInvite({ initialValidToken, initialMessage }: SignInOrInviteProps) {
  const [isVerified, setIsVerified] = useState(initialValidToken);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>(!initialValidToken && initialMessage ? initialMessage : "");
  const [loading, setLoading] = useState(false);

  if (isVerified) {
    return (
      <div className="flex justify-center w-full animate-in fade-in duration-500">
        <SignIn forceRedirectUrl="/" withSignUp={true} />
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await checkUserEmail(email);
    
    if (res.valid) {
      setIsVerified(true);
    } else {
      setError(res.message || "Invalid email or user not found.");
    }
    
    setLoading(false);
  };

  return (
    <div className="w-full">
      <div className="text-center space-y-2 mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Verify Access</h1>
        <p className="text-muted-foreground">
          This app is currently invite-only. Please enter your approved email address to access the app.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="email" className="text-foreground font-medium">
            Email Address
          </Label>
          <Input
            id="email"
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-background w-full"
            disabled={loading}
          />
        </div>

        {error && (
          <p className="text-sm font-medium text-destructive mt-2 bg-destructive/10 p-3 rounded-md border border-destructive/20 text-center text-red-500">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full font-medium" disabled={loading}>
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Checking...
            </span>
          ) : (
            "Verify & Continue"
          )}
        </Button>
      </form>
    </div>
  );
}
