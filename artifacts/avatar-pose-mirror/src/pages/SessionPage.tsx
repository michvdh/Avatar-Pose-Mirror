import { useSearch, useLocation } from "wouter";
import AvatarScene from "../AvatarScene";
import TherapistScene from "../TherapistScene";

export default function SessionPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const objectPath = params.get("exercise") ?? "";

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}>
      {/* Full-screen patient avatar (unchanged) */}
      <AvatarScene />

      {/* Therapist panel — fixed left overlay */}
      <div
        style={{
          position: "fixed",
          top: 68,
          left: 24,
          width: 280,
          height: "clamp(400px, 62vh, 560px)",
          zIndex: 20,
          borderRadius: 12,
          overflow: "hidden",
          background: "rgba(8, 28, 70, 0.82)",
          border: "1px solid rgba(0, 136, 255, 0.35)",
          boxShadow: "0 0 32px rgba(0, 100, 255, 0.15), inset 0 0 20px rgba(0, 80, 200, 0.06)",
          backdropFilter: "blur(4px)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Panel header */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid rgba(0, 136, 255, 0.2)",
            background: "rgba(0, 40, 100, 0.4)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              color: "#00aaff",
              fontFamily: "monospace",
              fontSize: 10,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              marginBottom: 2,
            }}
          >
            Therapist Guide
          </div>
          <div
            style={{
              color: "#c8e8ff",
              fontFamily: "monospace",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Dr. Suzie
          </div>
        </div>

        {/* Three.js subscene fills remaining space */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {objectPath ? (
            <TherapistScene objectPath={objectPath} />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "#4a6a88",
                fontFamily: "monospace",
                fontSize: 12,
                textAlign: "center",
                padding: 24,
              }}
            >
              No exercise selected.
            </div>
          )}
        </div>
      </div>

      {/* Back to Home button */}
      <button
        onClick={() => navigate("/")}
        style={{
          position: "fixed",
          top: 12,
          right: 12,
          fontFamily: "monospace",
          fontSize: 12,
          color: "#00ff88",
          background: "rgba(0,0,0,0.6)",
          border: "1px solid rgba(0,255,136,0.4)",
          borderRadius: 4,
          padding: "5px 12px",
          cursor: "pointer",
          zIndex: 30,
          transition: "border-color 0.15s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,255,136,0.8)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(0,255,136,0.4)"; }}
      >
        ← Home
      </button>
    </div>
  );
}
