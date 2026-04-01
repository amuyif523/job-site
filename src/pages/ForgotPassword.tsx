import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { requestPasswordReset } from "@/lib/api";
import { ParticleBackground } from "@/components/ParticleBackground";
import { GlassCard } from "@/components/GlassCard";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Email is required");
      return;
    }

    setLoading(true);
    try {
      const res = await requestPasswordReset(normalizedEmail);
      setSuccessMessage(res.message);
    } catch (err: any) {
      setError(err.message || "Failed to request reset link");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center" style={{ background: "#07070F" }}>
      <ParticleBackground />
      <div className="relative z-[1] w-full max-w-[460px] px-6">
        <GlassCard className="p-8" hover={false}>
          <h1 className="font-display text-3xl text-foreground mb-2">Reset Password</h1>
          <p className="font-display text-sm text-muted-foreground mb-6">
            Enter your account email and we will send a reset link.
          </p>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3 py-2.5 bg-transparent glass-surface font-display text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_2px_rgba(139,92,246,0.5)]"
              />
            </div>

            {error && (
              <p className="font-mono text-[11px] text-red-400 bg-red-400/10 border border-red-400/20 px-3 py-2 rounded">
                {error}
              </p>
            )}

            {successMessage && (
              <p className="font-mono text-[11px] text-jarvis-green bg-jarvis-green/10 border border-jarvis-green/20 px-3 py-2 rounded">
                {successMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-md font-display font-semibold text-[13px] uppercase text-foreground transition-all hover:scale-[1.01] disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)", boxShadow: "0 0 20px rgba(139,92,246,0.35)" }}
            >
              {loading ? "Sending..." : "Send Reset Link"}
            </button>
          </form>

          <div className="mt-4 text-right">
            <Link to="/" className="font-mono text-[11px] text-muted-foreground hover:text-foreground underline">
              Back to sign in
            </Link>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
