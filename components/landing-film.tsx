"use client";

import { useEffect, useRef } from "react";

export function LandingFilm() {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    function updatePlayback() {
      if (motion.matches) video.current?.pause();
      else void video.current?.play().catch(() => { /* Native controls remain available when autoplay is blocked. */ });
    }
    updatePlayback();
    motion.addEventListener("change", updatePlayback);
    return () => motion.removeEventListener("change", updatePlayback);
  }, []);

  return <figure className="landing-film">
    <video ref={video} width={960} height={540} muted loop playsInline controls preload="none"
      poster="/videos/costume-assembly-poster.jpg"
      aria-label="Costume preview: aviator, vampire, and cosmic cowboy outfits assemble during full turns">
      <source src="/videos/costume-assembly.mp4" type="video/mp4" />
      <a href="/videos/costume-assembly.mp4">Watch the costume preview</a>
    </video>
  </figure>;
}
