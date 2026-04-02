import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, FileText, Globe, Trophy, Zap } from "lucide-react";

import { GlassCard } from "./GlassCard";
import { ParticleBackground } from "./ParticleBackground";
import { ApiError, apiLogin, apiRegister, UserData } from "@/lib/api.ts";

interface LandingPageProps {
  onLogin: (user: UserData) => void;
}

type AuthTab = "signin" | "signup";

type SignInState = {
  email: string;
  password: string;
};

type SignUpState = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  targetRole: string;
};

const EMPTY_SIGN_IN: SignInState = {
  email: "",
  password: "",
};

const EMPTY_SIGN_UP: SignUpState = {
  name: "",
  email: "",
  password: "",
  confirmPassword: "",
  targetRole: "",
};

const PASSWORD_RULES = [
  "At least 10 characters",
  "One uppercase letter",
  "One lowercase letter",
  "One number",
];

const AUTH_PROVIDERS = [
  { name: "Google", status: "Coming soon" },
  { name: "LinkedIn", status: "Coming soon" },
  { name: "Apple", status: "Coming soon" },
] as const;

function getPasswordValidationMessage(password: string): string | null {
  if (!password) return "Password is required.";
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (!/[A-Z]/.test(password)) return "Password must include at least one uppercase letter.";
  if (!/[a-z]/.test(password)) return "Password must include at least one lowercase letter.";
  if (!/\d/.test(password)) return "Password must include at least one number.";
  return null;
}

function getSignInValidationMessage(values: SignInState): string | null {
  if (!values.email.trim()) return "Email is required.";
  if (!values.password) return "Password is required.";
  return null;
}

function getSignUpValidationMessage(values: SignUpState): string | null {
  if (!values.name.trim()) return "Name is required.";
  if (!values.email.trim()) return "Email is required.";

  const passwordMessage = getPasswordValidationMessage(values.password);
  if (passwordMessage) return passwordMessage;

  if (!values.confirmPassword) return "Please confirm your password.";
  if (values.password !== values.confirmPassword) return "Passwords do not match.";

  return null;
}

export function LandingPage({ onLogin }: LandingPageProps) {
  const [tab, setTab] = useState<AuthTab>("signin");
  const [showSignInPassword, setShowSignInPassword] = useState(false);
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [signInValues, setSignInValues] = useState<SignInState>(EMPTY_SIGN_IN);
  const [signUpValues, setSignUpValues] = useState<SignUpState>(EMPTY_SIGN_UP);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const currentValidationMessage = useMemo(
    () => (tab === "signin" ? getSignInValidationMessage(signInValues) : getSignUpValidationMessage(signUpValues)),
    [signInValues, signUpValues, tab]
  );

  const handleTabChange = (nextTab: AuthTab) => {
    setTab(nextTab);
    setError("");

    if (nextTab === "signin") {
      setShowSignUpPassword(false);
      setShowConfirmPassword(false);
      setSignUpValues(EMPTY_SIGN_UP);
      return;
    }

    setShowSignInPassword(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const validationMessage = tab === "signin" ? getSignInValidationMessage(signInValues) : getSignUpValidationMessage(signUpValues);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setLoading(true);
    try {
      const data =
        tab === "signin"
          ? await apiLogin(signInValues.email.trim(), signInValues.password)
          : await apiRegister(
              signUpValues.name.trim(),
              signUpValues.email.trim(),
              signUpValues.password,
              signUpValues.confirmPassword,
              signUpValues.targetRole.trim()
            );

      onLogin({ ...data.user, avatar: null });
    } catch (err) {
      if (err instanceof ApiError || err instanceof Error) {
        setError(err.message || "Something went wrong");
      } else {
        setError("Something went wrong");
      }
    } finally {
      setLoading(false);
    }
  };

  const features = [
    { icon: Zap, text: "AI match scoring against your CV" },
    { icon: FileText, text: "Tailored CVs & cover letters in seconds" },
    { icon: Globe, text: "Multi-language output — EN, DE, FR, ES, AR, ZH" },
    { icon: Trophy, text: "Community-ranked templates with real callback data" },
  ];

  return (
    <div className="relative min-h-screen flex items-center justify-center" style={{ background: "#07070F" }}>
      <ParticleBackground />

      <div className="relative z-[1] flex w-full max-w-[1100px] mx-auto px-8 gap-12 items-center">
        <div className="w-[55%] space-y-8">
          <div>
            <h1 className="text-gradient-purple font-display font-bold text-[28px] tracking-[4px] mb-6">JARVIS</h1>
            <p className="font-display font-bold text-[48px] text-foreground leading-[1.1] mb-4">
              Your AI Job Search Copilot
            </p>
            <p className="font-display text-lg text-muted-foreground max-w-[480px]">
              Discovers jobs, scores matches, writes tailored CVs and cover letters. One click to apply.
            </p>
          </div>

          <div className="space-y-3">
            {features.map((feature, index) => (
              <div key={index} className="flex items-center gap-3">
                <div
                  className="h-8 w-8 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)" }}
                >
                  <feature.icon className="h-4 w-4 text-foreground" />
                </div>
                <span className="font-display text-sm text-foreground">{feature.text}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-4">
            <div className="flex -space-x-2">
              {["JS", "AK", "LM"].map((initials, index) => (
                <div
                  key={index}
                  className="h-7 w-7 rounded-full flex items-center justify-center font-mono text-[9px] font-bold text-foreground border-2 border-background"
                  style={{
                    background: `linear-gradient(135deg, ${
                      index === 0 ? "#8B5CF6" : index === 1 ? "#3B82F6" : "#E11D48"
                    }, ${index === 0 ? "#3B82F6" : index === 1 ? "#10B981" : "#8B5CF6"})`,
                  }}
                >
                  {initials}
                </div>
              ))}
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">Trusted by job seekers across 12 countries</span>
          </div>
        </div>

        <div className="w-[45%]">
          <GlassCard className="p-8" hover={false}>
            <div className="flex gap-6 mb-6 border-b border-border/30 pb-3" role="tablist" aria-label="Authentication tabs">
              {(["signin", "signup"] as const).map((tabOption) => (
                <button
                  key={tabOption}
                  type="button"
                  role="tab"
                  aria-selected={tab === tabOption}
                  aria-controls={`${tabOption}-panel`}
                  onClick={() => handleTabChange(tabOption)}
                  className={`font-mono text-[11px] uppercase tracking-wider pb-1 transition-colors ${
                    tab === tabOption ? "text-foreground border-b-2 border-jarvis-purple" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tabOption === "signin" ? "Sign In" : "Sign Up"}
                </button>
              ))}
            </div>

            <form
              id={`${tab}-panel`}
              aria-labelledby={`${tab}-tab`}
              className="space-y-4"
              onSubmit={handleSubmit}
            >
              {tab === "signup" && (
                <div>
                  <label htmlFor="signup-name" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5">
                    Name
                  </label>
                  <input
                    id="signup-name"
                    name="name"
                    autoComplete="name"
                    value={signUpValues.name}
                    onChange={(event) => setSignUpValues((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Your name"
                    aria-invalid={Boolean(error)}
                    className="w-full px-3 py-2.5 bg-transparent glass-surface font-display text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_2px_rgba(139,92,246,0.5)]"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor={tab === "signin" ? "signin-email" : "signup-email"}
                  className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5"
                >
                  Email
                </label>
                <input
                  id={tab === "signin" ? "signin-email" : "signup-email"}
                  name="email"
                  autoComplete="email"
                  value={tab === "signin" ? signInValues.email : signUpValues.email}
                  onChange={(event) => {
                    const { value } = event.target;
                    if (tab === "signin") {
                      setSignInValues((current) => ({ ...current, email: value }));
                    } else {
                      setSignUpValues((current) => ({ ...current, email: value }));
                    }
                  }}
                  type="email"
                  placeholder="you@example.com"
                  aria-invalid={Boolean(error)}
                  className="w-full px-3 py-2.5 bg-transparent glass-surface font-display text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_2px_rgba(139,92,246,0.5)]"
                />
              </div>

              <div>
                <label
                  htmlFor={tab === "signin" ? "signin-password" : "signup-password"}
                  className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id={tab === "signin" ? "signin-password" : "signup-password"}
                    name="password"
                    autoComplete={tab === "signin" ? "current-password" : "new-password"}
                    value={tab === "signin" ? signInValues.password : signUpValues.password}
                    onChange={(event) => {
                      const { value } = event.target;
                      if (tab === "signin") {
                        setSignInValues((current) => ({ ...current, password: value }));
                      } else {
                        setSignUpValues((current) => ({ ...current, password: value }));
                      }
                    }}
                    type={tab === "signin" ? (showSignInPassword ? "text" : "password") : showSignUpPassword ? "text" : "password"}
                    placeholder="••••••••"
                    aria-invalid={Boolean(error)}
                    className="w-full px-3 py-2.5 pr-10 bg-transparent glass-surface font-display text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_2px_rgba(139,92,246,0.5)]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (tab === "signin") {
                        setShowSignInPassword((current) => !current);
                      } else {
                        setShowSignUpPassword((current) => !current);
                      }
                    }}
                    aria-label={
                      tab === "signin"
                        ? showSignInPassword
                          ? "Hide sign in password"
                          : "Show sign in password"
                        : showSignUpPassword
                          ? "Hide sign up password"
                          : "Show sign up password"
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {(tab === "signin" ? showSignInPassword : showSignUpPassword) ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {tab === "signup" && (
                  <p className="mt-2 font-mono text-[10px] leading-5 text-muted-foreground">
                    Password needs: {PASSWORD_RULES.join(", ")}.
                  </p>
                )}
              </div>

              {tab === "signup" && (
                <>
                  <div>
                    <label
                      htmlFor="signup-confirm-password"
                      className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5"
                    >
                      Confirm Password
                    </label>
                    <div className="relative">
                      <input
                        id="signup-confirm-password"
                        name="confirmPassword"
                        autoComplete="new-password"
                        value={signUpValues.confirmPassword}
                        onChange={(event) =>
                          setSignUpValues((current) => ({ ...current, confirmPassword: event.target.value }))
                        }
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder="••••••••"
                        aria-invalid={Boolean(error)}
                        className="w-full px-3 py-2.5 pr-10 bg-transparent glass-surface font-display text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_2px_rgba(139,92,246,0.5)]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((current) => !current)}
                        aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="signup-target-role"
                      className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block mb-1.5"
                    >
                      Target Role
                    </label>
                    <input
                      id="signup-target-role"
                      name="targetRole"
                      autoComplete="organization-title"
                      value={signUpValues.targetRole}
                      onChange={(event) => setSignUpValues((current) => ({ ...current, targetRole: event.target.value }))}
                      placeholder="e.g. Data Scientist, Product Manager"
                      aria-invalid={Boolean(error)}
                      className="w-full px-3 py-2.5 bg-transparent glass-surface font-display text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_2px_rgba(139,92,246,0.5)]"
                    />
                  </div>
                </>
              )}

              {error && (
                <p className="font-mono text-[11px] text-red-400 bg-red-400/10 border border-red-400/20 px-3 py-2 rounded" role="alert">
                  {error}
                </p>
              )}

              {tab === "signup" && !error && currentValidationMessage && (
                <p className="font-mono text-[11px] text-amber-300 bg-amber-400/10 border border-amber-400/20 px-3 py-2 rounded">
                  {currentValidationMessage}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || Boolean(currentValidationMessage)}
                className="w-full py-3 rounded-md font-display font-semibold text-[13px] uppercase text-foreground transition-all hover:scale-[1.01] disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)", boxShadow: "0 0 20px rgba(139,92,246,0.35)" }}
              >
                {loading ? "Please wait..." : tab === "signin" ? "Sign In" : "Create Account"}
              </button>

              <div className="flex items-center gap-3 my-2">
                <div className="flex-1 h-px bg-border/50" />
                <span className="font-mono text-[10px] text-muted-foreground">social sign-in</span>
                <div className="flex-1 h-px bg-border/50" />
              </div>

              <div className="grid grid-cols-3 gap-2">
                {AUTH_PROVIDERS.map((provider) => (
                  <button
                    key={provider.name}
                    type="button"
                    disabled
                    aria-label={`${provider.name} sign-in coming soon`}
                    className="glass-surface flex flex-col items-center justify-center gap-1 py-2.5 rounded-md font-display text-[12px] text-foreground/70 transition-all opacity-70 cursor-not-allowed"
                  >
                    <span>{provider.name}</span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                      {provider.status}
                    </span>
                  </button>
                ))}
              </div>

              <p className="font-mono text-[10px] leading-5 text-muted-foreground">
                Google, LinkedIn, and Apple sign-in are not available yet. Use email and password for now.
              </p>

              {tab === "signin" && (
                <div className="text-right mt-1">
                  <Link
                    to="/forgot-password"
                    className="font-mono text-[10px] text-muted-foreground hover:text-foreground underline"
                  >
                    Forgot password?
                  </Link>
                </div>
              )}
            </form>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
