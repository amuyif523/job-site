import { GlassCard } from "./GlassCard";
import { Shield, Star } from "lucide-react";

const topCVs = [
  { rank: 1, user: "Anonymous #1247", role: "Data Scientist", template: "Modern", apps: 47, callback: "68%", offers: 3, rating: 4.8, reviews: 124 },
  { rank: 2, user: "Anonymous #0892", role: "Product Manager", template: "Executive", apps: 35, callback: "57%", offers: 2, rating: 4.6, reviews: 98 },
  { rank: 3, user: "Anonymous #2103", role: "Software Engineer", template: "Tech Portfolio", apps: 52, callback: "54%", offers: 4, rating: 4.5, reviews: 156 },
  { rank: 4, user: "Anonymous #3456", role: "UX Designer", template: "Minimal", apps: 28, callback: "46%", offers: 1, rating: 4.3, reviews: 67 },
  { rank: 5, user: "Anonymous #0517", role: "Data Engineer", template: "ATS-Optimized", apps: 41, callback: "43%", offers: 2, rating: 4.2, reviews: 89 },
];

const topCoverLetters = [
  { rank: 1, user: "Anonymous #3891", role: "Consultant", template: "Consulting", apps: 39, callback: "71%", offers: 5, rating: 4.9, reviews: 201 },
  { rank: 2, user: "Anonymous #1056", role: "Marketing Lead", template: "Formal", apps: 44, callback: "62%", offers: 3, rating: 4.7, reviews: 145 },
  { rank: 3, user: "Anonymous #2789", role: "Backend Developer", template: "Startup", apps: 31, callback: "58%", offers: 2, rating: 4.5, reviews: 112 },
  { rank: 4, user: "Anonymous #4102", role: "Project Manager", template: "Corporate", apps: 27, callback: "51%", offers: 2, rating: 4.4, reviews: 78 },
  { rank: 5, user: "Anonymous #0234", role: "Analyst", template: "Formal", apps: 36, callback: "48%", offers: 1, rating: 4.2, reviews: 91 },
];

const rankColors = ["#F59E0B", "#9CA3AF", "#CD7F32"];

function RankList({ title, data }: { title: string; data: typeof topCVs }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">{title}</p>
      <div className="space-y-3">
        {data.map(entry => (
          <GlassCard key={entry.rank} className="p-4 relative overflow-hidden" hover={false} style={entry.rank <= 3 ? { borderLeftWidth: 3, borderLeftColor: rankColors[entry.rank - 1] } : {}}>
            <div className="flex items-start gap-4">
              <span className="font-display font-bold text-2xl shrink-0 w-8" style={{ color: entry.rank <= 3 ? rankColors[entry.rank - 1] : "white" }}>
                {entry.rank}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-mono text-[11px] text-muted-foreground">{entry.user}</p>
                <p className="font-display font-medium text-[13px] text-foreground">{entry.role}</p>
                <span className="font-mono text-[9px] px-2 py-0.5 rounded-full glass-surface text-muted-foreground inline-block mt-1">{entry.template}</span>
                <div className="flex gap-3 mt-2 flex-wrap">
                  <span className="font-mono text-[10px] text-muted-foreground">📨 {entry.apps} applications</span>
                  <span className="font-mono text-[10px] text-jarvis-green">📞 {entry.callback} callback</span>
                  <span className="font-mono text-[10px] text-jarvis-blue">✅ {entry.offers} offers</span>
                </div>
                <div className="flex items-center gap-1 mt-2">
                  {[1, 2, 3, 4, 5].map(s => (
                    <Star key={s} className="h-3 w-3" fill={s <= Math.floor(entry.rating) ? "#F59E0B" : "transparent"} stroke="#F59E0B" />
                  ))}
                  <span className="font-mono text-[10px] text-muted-foreground ml-1">{entry.rating} ({entry.reviews} ratings)</span>
                </div>
              </div>
              <button className="font-mono text-[10px] px-2 py-1 rounded glass-surface text-muted-foreground hover:text-foreground transition-all shrink-0">
                View
              </button>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}

export function LeaderboardPage() {
  return (
    <div className="animate-fade-up space-y-6 max-w-[1200px]">
      <div>
        <h1 className="text-gradient-purple font-display font-bold text-[22px] mb-1">COMMUNITY LEADERBOARD</h1>
        <p className="font-mono text-[11px] text-muted-foreground">Top CVs and cover letters ranked by real callback & acceptance rates. All personal details removed.</p>
      </div>

      <GlassCard className="p-3 flex items-center gap-2" hover={false} style={{ borderColor: "rgba(245,158,11,0.3)" }}>
        <Shield className="h-4 w-4 text-jarvis-yellow shrink-0" />
        <p className="font-display text-[12px] text-muted-foreground">All documents are fully anonymized. Names, contact info, and company details are removed before ranking.</p>
      </GlassCard>

      <div className="grid grid-cols-2 gap-6">
        <RankList title="TOP CVs THIS MONTH" data={topCVs} />
        <RankList title="TOP COVER LETTERS THIS MONTH" data={topCoverLetters} />
      </div>

      <GlassCard className="p-6 text-center" hover={false}>
        <p className="font-display font-semibold text-base text-foreground mb-2">CONTRIBUTE TO THE COMMUNITY</p>
        <p className="font-mono text-[11px] text-muted-foreground mb-4">Share your best CV or cover letter anonymously. Help others and earn community badges.</p>
        <div className="flex gap-3 justify-center">
          <button className="px-4 py-2 rounded-md font-display text-[11px] font-medium uppercase border border-jarvis-purple/40 text-jarvis-purple hover:bg-jarvis-purple hover:text-foreground transition-all">Submit My CV</button>
          <button className="px-4 py-2 rounded-md font-display text-[11px] font-medium uppercase border border-jarvis-blue/40 text-jarvis-blue hover:bg-jarvis-blue hover:text-foreground transition-all">Submit Cover Letter</button>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground italic mt-3">UI only — submission feature coming soon</p>
      </GlassCard>
    </div>
  );
}
