"use client";

import { useState } from "react";

export default function Page() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok) {
        window.location.href = data.url;
      } else {
        setError(data.message || "Something went wrong");
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0d0d] relative">
      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3e%3cg fill='none' fill-rule='evenodd'%3e%3cg fill='%23ffffff' fill-opacity='1'%3e%3cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3e%3c/g%3e%3c/g%3e%3c/svg%3e")`,
        }}
      />

      <div className="relative z-10">
        {/* Header */}
        <header className="border-b border-[#1a1a1a] px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-6 h-6 bg-white rounded-sm flex items-center justify-center">
                <div className="w-3 h-3 bg-black rounded-[2px]"></div>
              </div>
              <span className="text-white font-medium text-sm tracking-wide">
                DodoPayments
              </span>
            </div>
            <div className="text-[#666] text-xs font-mono">BETA</div>
          </div>
        </header>

        {/* Main */}
        <main className="flex-1 flex items-center justify-center px-8 py-16">
          <div className="w-full max-w-[420px]">
            <div className="mb-12">
              <h1 className="text-[28px] font-medium text-white mb-3 tracking-[-0.01em] leading-tight">
                Complete your purchase
              </h1>
              <p className="text-[#888] text-[15px] leading-relaxed">
                Just a few details and you're all set
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="space-y-5">
                <div>
                  <label className="block text-[#ccc] text-[13px] font-medium mb-2">
                    Full name
                  </label>
                  <input
                    id="name"
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="w-full h-11 px-4 bg-[#161616] border border-[#2a2a2a] rounded-[6px] text-white text-[15px] placeholder-[#666] focus:outline-none focus:border-[#555] focus:bg-[#1a1a1a] transition-all duration-200"
                    placeholder="Enter your full name"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[#ccc] text-[13px] font-medium mb-2">
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    className="w-full h-11 px-4 bg-[#161616] border border-[#2a2a2a] rounded-[6px] text-white text-[15px] placeholder-[#666] focus:outline-none focus:border-[#555] focus:bg-[#1a1a1a] transition-all duration-200"
                    placeholder="Enter your email address"
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-400/5 border border-red-400/20 rounded-[6px] px-4 py-3">
                  <p className="text-red-400 text-[13px] font-medium">
                    {error}
                  </p>
                </div>
              )}

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={
                    isLoading || !formData.name.trim() || !formData.email.trim()
                  }
                  className="w-full h-11 bg-white text-black text-[15px] font-medium rounded-[6px] hover:bg-[#f5f5f5] focus:outline-none focus:ring-2 focus:ring-white/20 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <div className="flex items-center justify-center">
                      <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin mr-2"></div>
                      Processing
                    </div>
                  ) : (
                    "Continue to payment"
                  )}
                </button>
              </div>

              <div className="text-center pt-4">
                <p className="text-[#666] text-[12px]">
                  Powered by <span className="text-[#888]">DodoPayments</span>
                </p>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}