import { cn } from "@/lib/utils";
import { CSSProperties, ReactNode } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}

export function GlassCard({ children, className, hover = true, onClick, style }: GlassCardProps) {
  return (
    <div
      onClick={onClick}
      style={style}
      className={cn(
        "glass-surface glow-purple transition-all duration-200",
        hover && "hover:-translate-y-0.5 hover:shadow-[0_4px_32px_rgba(0,0,0,0.5),0_0_30px_rgba(139,92,246,0.5)]",
        onClick && "cursor-pointer",
        className
      )}
    >
      {children}
    </div>
  );
}
