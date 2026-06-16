import { useEffect, useState } from "react";
import { useLocation } from "wouter";

interface Exercise {
  name: string;
  exerciseName: string;
  objectPath: string;
}

export default function ExerciseListPage() {
  const [, navigate] = useLocation();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/exercises")
      .then((r) => {
        if (!r.ok) return r.json().then((j) => Promise.reject(new Error(j.error ?? r.statusText)));
        return r.json();
      })
      .then((data: Exercise[]) => {
        setExercises(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#050a15",
        fontFamily: "monospace",
        overflow: "auto",
        position: "relative",
      }}
    >
      {/* Cyberpunk grid */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(17, 68, 136, 0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(17, 68, 136, 0.18) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          pointerEvents: "none",
        }}
      />

      {/* Header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "rgba(5, 10, 21, 0.92)",
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid rgba(0, 255, 136, 0.12)",
          padding: "18px 32px",
          display: "flex",
          alignItems: "center",
          gap: 24,
        }}
      >
        <button
          onClick={() => navigate("/")}
          style={{
            background: "none",
            border: "1px solid rgba(0, 255, 136, 0.3)",
            borderRadius: 4,
            color: "#00ff88",
            fontFamily: "monospace",
            fontSize: 12,
            padding: "5px 12px",
            cursor: "pointer",
            transition: "border-color 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "rgba(0, 255, 136, 0.8)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "rgba(0, 255, 136, 0.3)";
          }}
        >
          ← Home
        </button>
        <div>
          <div style={{ color: "#00ff88", fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase", marginBottom: 2 }}>
            Library
          </div>
          <div style={{ color: "#e8f4ff", fontSize: 18, fontWeight: 700 }}>Select Exercise</div>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "40px 32px", position: "relative", zIndex: 1 }}>
        {loading && (
          <div style={{ color: "#00ff88", textAlign: "center", paddingTop: 80, fontSize: 13 }}>
            <div style={{ marginBottom: 8, opacity: 0.6, letterSpacing: "0.2em" }}>LOADING</div>
            <div style={{ color: "#7a9ec2" }}>Fetching exercises from storage…</div>
          </div>
        )}

        {error && (
          <div
            style={{
              color: "#ff4466",
              textAlign: "center",
              paddingTop: 80,
              fontSize: 13,
              background: "rgba(255, 68, 102, 0.06)",
              border: "1px solid rgba(255, 68, 102, 0.2)",
              borderRadius: 8,
              padding: "32px",
              maxWidth: 480,
              margin: "80px auto 0",
            }}
          >
            <div style={{ fontSize: 16, marginBottom: 8 }}>⚠ Failed to load exercises</div>
            <div style={{ color: "#aaa", fontSize: 12 }}>{error}</div>
          </div>
        )}

        {!loading && !error && exercises.length === 0 && (
          <div style={{ color: "#7a9ec2", textAlign: "center", paddingTop: 80, fontSize: 13 }}>
            No exercises found in storage bucket.
          </div>
        )}

        {!loading && !error && exercises.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 20,
              maxWidth: 1200,
              margin: "0 auto",
            }}
          >
            {exercises.map((ex) => (
              <ExerciseCard
                key={ex.objectPath}
                exercise={ex}
                onClick={() =>
                  navigate(`/session?exercise=${encodeURIComponent(ex.objectPath)}`)
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ExerciseCard({
  exercise,
  onClick,
}: {
  exercise: Exercise;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = "rgba(0, 255, 136, 0.65)";
        el.style.boxShadow = "0 0 20px rgba(0, 255, 136, 0.15)";
        el.style.transform = "translateY(-2px) scale(1.015)";
        el.style.background = "rgba(0, 255, 136, 0.06)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = "rgba(0, 255, 136, 0.2)";
        el.style.boxShadow = "none";
        el.style.transform = "translateY(0) scale(1)";
        el.style.background = "rgba(5, 15, 35, 0.8)";
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = "translateY(0) scale(0.98)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "translateY(-2px) scale(1.015)";
      }}
      style={{
        background: "rgba(5, 15, 35, 0.8)",
        border: "1px solid rgba(0, 255, 136, 0.2)",
        borderRadius: 10,
        padding: "28px 24px",
        cursor: "pointer",
        transition: "border-color 0.18s, box-shadow 0.18s, transform 0.15s, background 0.18s",
        fontFamily: "monospace",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Accent top bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: "linear-gradient(90deg, transparent, rgba(0,255,136,0.5), transparent)",
        }}
      />
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: "rgba(0, 255, 136, 0.08)",
          border: "1px solid rgba(0, 255, 136, 0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 14,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00ff88" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      </div>
      <div
        style={{
          color: "#e8f4ff",
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: "0.02em",
          marginBottom: 6,
          lineHeight: 1.4,
        }}
      >
        {exercise.exerciseName}
      </div>
      <div style={{ color: "#4a6a88", fontSize: 10, letterSpacing: "0.08em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {exercise.name}
      </div>
    </div>
  );
}
