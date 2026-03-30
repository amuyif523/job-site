import { useState, useRef, useEffect } from "react";
import { Bot, X, Send, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  from: "user" | "jarvis" | "error";
  text: string;
}

type ChatStatus = "idle" | "thinking" | "error";

export function JarvisChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { from: "jarvis", text: "Hi — I'm JARVIS. Ask me anything about your jobs, scores, or applications." },
  ]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, status]);

  const handleSend = async () => {
    if (!input.trim() || status === "thinking") return;

    const userMessage = input.trim();
    setInput("");
    setStatus("thinking");

    const updatedMessages: Message[] = [...messages, { from: "user", text: userMessage }];
    setMessages(updatedMessages);

    try {
      const token = localStorage.getItem("jarvis_token");

      const response = await fetch("http://localhost:8000/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: updatedMessages.map(m => ({
            role: m.from === "user" ? "user" : "model",
            content: m.text,
          })),
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      setMessages(prev => [...prev, { from: "jarvis", text: data.reply }]);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setMessages(prev => [...prev, {
        from: "error",
        text: err instanceof Error ? `Error: ${err.message}` : "Something went wrong. Please try again.",
      }]);
    }
  };

  return (
    <div className="fixed" style={{ bottom: 28, right: 28, zIndex: 50 }}>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="h-14 w-14 rounded-full flex items-center justify-center text-foreground animate-orb-ping"
          style={{ background: "linear-gradient(135deg, #8B5CF6, #E11D48)" }}
          title="Ask JARVIS"
        >
          <Bot className="h-[22px] w-[22px]" />
        </button>
      ) : (
        <div
          className="glass-surface glow-purple flex flex-col origin-bottom-right"
          style={{
            width: 380, height: 500,
            animation: "fade-up 0.22s cubic-bezier(0.34,1.56,0.64,1)",
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
            <Bot className="h-4 w-4 text-jarvis-purple" />
            <span className="text-gradient-purple font-display font-semibold text-sm">JARVIS AI</span>
            <div className="flex items-center gap-1 ml-1">
              {/* Status indicator */}
              {status === "idle" && (
                <>
                  <div className="h-1.5 w-1.5 rounded-full bg-jarvis-green animate-pulse" />
                  <span className="font-mono text-[10px] text-muted-foreground">online</span>
                </>
              )}
              {status === "thinking" && (
                <>
                  <div className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
                  <span className="font-mono text-[10px] text-yellow-400">thinking…</span>
                </>
              )}
              {status === "error" && (
                <>
                  <AlertCircle className="h-3 w-3 text-red-400" />
                  <span
                    className="font-mono text-[10px] text-red-400 cursor-pointer hover:underline"
                    onClick={() => setStatus("idle")}
                  >
                    error — retry
                  </span>
                </>
              )}
            </div>
            <button onClick={() => setOpen(false)} className="ml-auto text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
            {messages.map((msg, i) => (
              <div key={i} className={cn("flex", msg.from === "user" ? "justify-end" : "justify-start gap-2")}>
                {(msg.from === "jarvis" || msg.from === "error") && (
                  <div
                    className="h-5 w-5 rounded-full flex items-center justify-center shrink-0 mt-1"
                    style={{
                      background: msg.from === "error"
                        ? "linear-gradient(135deg, #ef4444, #b91c1c)"
                        : "linear-gradient(135deg, #8B5CF6, #3B82F6)"
                    }}
                  >
                    {msg.from === "error"
                      ? <AlertCircle className="h-3 w-3 text-white" />
                      : <span className="font-display font-bold text-[8px] text-foreground">J</span>
                    }
                  </div>
                )}
                <div className={cn(
                  "max-w-[80%] px-3 py-2 font-mono text-xs",
                  msg.from === "user"
                    ? "bg-jarvis-purple/15 border border-jarvis-purple/25 rounded-[10px_10px_2px_10px] text-foreground"
                    : msg.from === "error"
                    ? "bg-red-500/10 border border-red-500/25 rounded-[10px_10px_10px_2px] text-red-400"
                    : "glass-surface rounded-[10px_10px_10px_2px] text-foreground"
                )}>
                  {msg.text}
                </div>
              </div>
            ))}

            {/* Thinking indicator */}
            {status === "thinking" && (
              <div className="flex gap-2 items-start">
                <div className="h-5 w-5 rounded-full flex items-center justify-center shrink-0 mt-1"
                  style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)" }}>
                  <span className="font-display font-bold text-[8px] text-foreground">J</span>
                </div>
                <div className="glass-surface rounded-[10px_10px_10px_2px] px-4 py-3 flex gap-1 items-center">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="h-1.5 w-1.5 rounded-full bg-jarvis-purple"
                      style={{ animation: `dot-pulse 1.4s ease-in-out ${i * 0.16}s infinite` }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="px-3 py-2 border-t border-border/30 flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSend()}
              placeholder={status === "thinking" ? "JARVIS is thinking…" : "Ask JARVIS..."}
              disabled={status === "thinking"}
              className="flex-1 bg-transparent font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-40"
            />
            <button
              onClick={handleSend}
              disabled={status === "thinking"}
              className="text-jarvis-purple hover:text-foreground transition-colors disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}