import { useEffect, useRef, useState } from "react";

interface Props {
  objectPath: string;
}

export default function TherapistScene({ objectPath }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);

  const videoUrl = `/api/exercises/video?object=${encodeURIComponent(objectPath)}`;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.src = videoUrl;
    v.load();
    const onCanPlay = () => setReady(true);
    const onPlay    = () => setPlaying(true);
    const onPause   = () => setPlaying(false);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("play",    onPlay);
    v.addEventListener("pause",   onPause);
    return () => {
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("play",    onPlay);
      v.removeEventListener("pause",   onPause);
      v.pause();
      v.src = "";
    };
  }, [videoUrl]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        background: "#050d1f",
        overflow: "hidden",
      }}
    >
      {/* Video */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <video
          ref={videoRef}
          loop
          muted={false}
          playsInline
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />

        {/* Play/pause overlay */}
        {ready && (
          <button
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
            style={{
              position: "absolute",
              bottom: 12,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(0, 40, 100, 0.75)",
              border: "1px solid rgba(0, 136, 255, 0.5)",
              borderRadius: 20,
              padding: "6px 20px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "#c8e8ff",
              fontFamily: "monospace",
              fontSize: 12,
              transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,136,255,0.9)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(0,136,255,0.5)"; }}
          >
            {playing ? (
              /* pause icon */
              <svg width="12" height="12" viewBox="0 0 12 12" fill="#c8e8ff">
                <rect x="1" y="1" width="4" height="10" rx="1" />
                <rect x="7" y="1" width="4" height="10" rx="1" />
              </svg>
            ) : (
              /* play icon */
              <svg width="12" height="12" viewBox="0 0 12 12" fill="#c8e8ff">
                <polygon points="2,1 11,6 2,11" />
              </svg>
            )}
            {playing ? "Pause" : "Play"}
          </button>
        )}

        {/* Loading state */}
        {!ready && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#4a6a88",
              fontFamily: "monospace",
              fontSize: 12,
              background: "#050d1f",
            }}
          >
            Loading…
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div
        style={{
          padding: "8px 14px",
          borderTop: "1px solid rgba(0,136,255,0.15)",
          background: "rgba(0,20,60,0.5)",
          color: "#4a7090",
          fontFamily: "monospace",
          fontSize: 10,
          letterSpacing: "0.08em",
          textAlign: "center",
          flexShrink: 0,
        }}
      >
        Watch &amp; mirror the movement
      </div>
    </div>
  );
}
