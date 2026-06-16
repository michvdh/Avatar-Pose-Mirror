import { useLocation } from "wouter";

const PANEL = {
  background: "rgba(5, 15, 35, 0.85)",
  border: "1px solid rgba(0, 255, 136, 0.25)",
  borderRadius: 12,
  padding: "48px 40px",
  width: 280,
  cursor: "pointer",
  transition: "border-color 0.2s, box-shadow 0.2s, transform 0.15s",
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  gap: 16,
  position: "relative" as const,
};

const ICON_WRAP = {
  width: 64,
  height: 64,
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0, 255, 136, 0.08)",
  border: "1px solid rgba(0, 255, 136, 0.3)",
  marginBottom: 8,
};

export default function HomePage() {
  const [, navigate] = useLocation();

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#050a15",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "monospace",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Cyberpunk grid overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(17, 68, 136, 0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(17, 68, 136, 0.18) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          pointerEvents: "none",
        }}
      />
      {/* Radial glow centre */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(0,255,136,0.04) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: 56, zIndex: 1 }}>
        <div
          style={{
            color: "#00ff88",
            fontSize: 11,
            letterSpacing: "0.35em",
            textTransform: "uppercase",
            marginBottom: 12,
            opacity: 0.7,
          }}
        >
          Physical Therapy
        </div>
        <h1
          style={{
            color: "#e8f4ff",
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: "0.04em",
            margin: 0,
          }}
        >
          Avatar Pose Mirror
        </h1>
      </div>

      {/* Cards */}
      <div style={{ display: "flex", gap: 32, zIndex: 1 }}>
        {/* Upload Video — coming soon */}
        <div
          style={{
            ...PANEL,
            opacity: 0.45,
            cursor: "not-allowed",
            border: "1px solid rgba(0, 255, 136, 0.1)",
          }}
        >
          <div style={ICON_WRAP}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00ff88" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 16 12 12 8 16" />
              <line x1="12" y1="12" x2="12" y2="21" />
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
            </svg>
          </div>
          <div style={{ color: "#e8f4ff", fontSize: 17, fontWeight: 600, letterSpacing: "0.02em" }}>
            Upload Video
          </div>
          <div style={{ color: "#7a9ec2", fontSize: 12, textAlign: "center", lineHeight: 1.5 }}>
            Upload a therapy exercise video to your library
          </div>
          <div
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              background: "rgba(255, 170, 0, 0.15)",
              border: "1px solid rgba(255, 170, 0, 0.3)",
              borderRadius: 4,
              padding: "2px 8px",
              color: "#ffaa00",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Coming Soon
          </div>
        </div>

        {/* Select Exercise */}
        <HoverCard onClick={() => navigate("/exercises")}>
          <div style={ICON_WRAP}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00ff88" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
          </div>
          <div style={{ color: "#e8f4ff", fontSize: 17, fontWeight: 600, letterSpacing: "0.02em" }}>
            Select Exercise
          </div>
          <div style={{ color: "#7a9ec2", fontSize: 12, textAlign: "center", lineHeight: 1.5 }}>
            Browse and start a guided therapy session
          </div>
        </HoverCard>
      </div>
    </div>
  );
}

function HoverCard({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = "rgba(0, 255, 136, 0.7)";
        el.style.boxShadow = "0 0 24px rgba(0, 255, 136, 0.18), inset 0 0 20px rgba(0, 255, 136, 0.04)";
        el.style.transform = "translateY(-3px)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = "rgba(0, 255, 136, 0.25)";
        el.style.boxShadow = "none";
        el.style.transform = "translateY(0)";
      }}
      style={PANEL}
    >
      {children}
    </div>
  );
}
