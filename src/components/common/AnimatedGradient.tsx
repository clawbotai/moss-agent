"use client";

import { useEffect, useRef } from "react";

interface AnimatedGradientProps {
  className?: string;
  colors?: string[];
}

export function AnimatedGradient({
  className = "",
  colors = ["#8b7cf8", "#6366f1", "#4f46e5"],
}: AnimatedGradientProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let time = 0;

    function resize() {
      if (!canvas) return;
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    }

    function draw() {
      if (!ctx || !canvas) return;

      time += 0.005;

      const gradient = ctx.createLinearGradient(
        canvas.width * (0.5 + 0.5 * Math.sin(time)),
        0,
        canvas.width * (0.5 + 0.5 * Math.cos(time)),
        canvas.height
      );

      colors.forEach((color, i) => {
        gradient.addColorStop(i / (colors.length - 1), color);
      });

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      animationId = requestAnimationFrame(draw);
    }

    resize();
    draw();

    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, [colors]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: -1,
        opacity: 0.1,
        borderRadius: "inherit",
      }}
    />
  );
}
