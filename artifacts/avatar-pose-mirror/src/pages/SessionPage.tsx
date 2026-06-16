import { useSearch, useLocation } from "wouter";
import { useState, useEffect, useRef } from "react";
import AvatarScene from "../AvatarScene";
import TherapistScene from "../TherapistScene";

export default function SessionPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const objectPath = params.get("exercise") ?? "";

  const [suzieReady, setSuzieReady] = useState(false);
  const [astraReady, setAstraReady] = useState(false);
  const bothReady = suzieReady && astraReady;
  const [playing, setPlaying] = useState(false);

  // Fade-out state: once both ready, animate the overlay away then unmount it
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [overlayOpacity, setOverlayOpacity] = useState(1);

  useEffect(() => {
    if (bothReady) {
      // Trigger CSS fade-out
      setOverlayOpacity(0);
      // Remove from DOM after transition completes
      const t = setTimeout(() => setOverlayVisible(false), 700);
      return () => clearTimeout(t);
    }
  }, [bothReady]);

  // Detect AvatarScene (Astra) readiness by intercepting getUserMedia.
  // When the camera stream is obtained, MediaPipe still needs ~3 s to
  // initialise its WASM + models, so we fire astraReady after that delay.
  const astraFiredRef = useRef(false);
  useEffect(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices
    );
    (navigator.mediaDevices as any).getUserMedia = async function (
      constraints: MediaStreamConstraints
    ) {
      const stream = await original(constraints);
      if (!astraFiredRef.current) {
        astraFiredRef.current = true;
        // Give MediaPipe Holistic time to finish WASM init + first inference
        setTimeout(() => setAstraReady(true), 3500);
      }
      return stream;
    };
    return () => {
      navigator.mediaDevices.getUserMedia = original;
    };
  }, []);

  return (
    <div
      style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}
    >
      {/* Full-screen patient avatar (AvatarScene — not modified) */}
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
          boxShadow:
            "0 0 32px rgba(0, 100, 255, 0.15), inset 0 0 20px rgba(0, 80, 200, 0.06)",
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
            <>
              <TherapistScene
                objectPath={objectPath}
                onReady={() => setSuzieReady(true)}
                active={bothReady && playing}
              />
              {/* Play button — shown after loading, before first play */}
              {bothReady && !playing && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    background: "rgba(4, 14, 38, 0.55)",
                    backdropFilter: "blur(2px)",
                    zIndex: 10,
                  }}
                >
                  <button
                    onClick={() => setPlaying(true)}
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: "50%",
                      border: "2px solid rgba(0,170,255,0.7)",
                      background: "rgba(0,60,140,0.75)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 0 24px rgba(0,136,255,0.35)",
                      transition: "transform 0.15s, box-shadow 0.15s, border-color 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget;
                      el.style.transform = "scale(1.1)";
                      el.style.boxShadow = "0 0 36px rgba(0,170,255,0.55)";
                      el.style.borderColor = "rgba(0,200,255,1)";
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget;
                      el.style.transform = "scale(1)";
                      el.style.boxShadow = "0 0 24px rgba(0,136,255,0.35)";
                      el.style.borderColor = "rgba(0,170,255,0.7)";
                    }}
                  >
                    {/* Play triangle */}
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                      <polygon points="7,4 19,11 7,18" fill="#00aaff" />
                    </svg>
                  </button>
                  <span
                    style={{
                      color: "#7ab8d8",
                      fontFamily: "monospace",
                      fontSize: 11,
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                    }}
                  >
                    Start Guide
                  </span>
                </div>
              )}
            </>
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
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "rgba(0,255,136,0.8)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "rgba(0,255,136,0.4)";
        }}
      >
        ← Home
      </button>

      {/* Loading overlay — unmounted after fade-out completes */}
      {overlayVisible && (
        <LoadingOverlay
          suzieReady={suzieReady}
          astraReady={astraReady}
          opacity={overlayOpacity}
        />
      )}
    </div>
  );
}

// ─── Loading overlay ────────────────────────────────────────────────────────

function LoadingOverlay({
  suzieReady,
  astraReady,
  opacity,
}: {
  suzieReady: boolean;
  astraReady: boolean;
  opacity: number;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(5, 10, 21, 0.92)",
        backdropFilter: "blur(8px)",
        opacity,
        transition: "opacity 0.65s ease",
        fontFamily: "monospace",
      }}
    >
      {/* Title */}
      <div
        style={{
          color: "#00aaff",
          fontSize: 11,
          letterSpacing: "0.35em",
          textTransform: "uppercase",
          marginBottom: 8,
          opacity: 0.7,
        }}
      >
        Initialising Session
      </div>
      <div
        style={{
          color: "#e8f4ff",
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: "0.04em",
          marginBottom: 48,
        }}
      >
        Home Physical Therapy Guide
      </div>

      {/* Status rows */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          width: 280,
        }}
      >
        <StatusRow label="Astra" ready={astraReady} />
        <StatusRow label="Dr. Suzie" ready={suzieReady} />
      </div>

      {/* Hint */}
      <div
        style={{
          marginTop: 40,
          color: "#4a6a88",
          fontSize: 11,
          letterSpacing: "0.08em",
        }}
      >
        {suzieReady && astraReady
          ? "Starting…"
          : "Please allow camera access if prompted"}
      </div>
    </div>
  );
}

function StatusRow({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(8, 28, 70, 0.6)",
        border: `1px solid ${ready ? "rgba(0,255,136,0.4)" : "rgba(0,136,255,0.25)"}`,
        borderRadius: 8,
        padding: "12px 16px",
        transition: "border-color 0.4s ease",
      }}
    >
      <div style={{ color: "#c8e8ff", fontSize: 13, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {ready ? (
          <>
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
            >
              <circle cx="8" cy="8" r="7" stroke="#00ff88" strokeWidth="1.5" />
              <path
                d="M5 8.5l2 2 4-4"
                stroke="#00ff88"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span style={{ color: "#00ff88", fontSize: 11, letterSpacing: "0.1em" }}>
              READY
            </span>
          </>
        ) : (
          <>
            <Spinner />
            <span style={{ color: "#00aaff", fontSize: 11, letterSpacing: "0.1em" }}>
              LOADING
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      style={{ animation: "spin 1s linear infinite" }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="rgba(0,136,255,0.25)"
        strokeWidth="2"
      />
      <path
        d="M8 2a6 6 0 0 1 6 6"
        stroke="#00aaff"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
