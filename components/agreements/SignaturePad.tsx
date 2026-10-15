"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };
type Stroke = { points: Point[]; pointerType: string };

export function SignaturePad({ onChange, disabled = false }: { onChange: (signature: string | null) => void; disabled?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const redoRef = useRef<Stroke[]>([]);
  const currentRef = useRef<Stroke | null>(null);
  const [state, setState] = useState({ strokes: 0, redo: 0 });

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, rect.width, rect.height);
    context.strokeStyle = "#102f16";
    context.lineWidth = 2.25;
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const stroke of strokesRef.current) drawStroke(context, stroke, rect.width, rect.height);
  }, []);

  useEffect(() => {
    redraw();
    const observer = new ResizeObserver(redraw);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [redraw]);

  function sync() {
    const hasInk = strokesRef.current.some((stroke) => stroke.points.length >= 2);
    setState({ strokes: strokesRef.current.length, redo: redoRef.current.length });
    onChange(hasInk ? canvasRef.current?.toDataURL("image/png") ?? null : null);
  }
  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    currentRef.current = { pointerType: event.pointerType || "mouse", points: [point(event)] };
    strokesRef.current.push(currentRef.current);
    redoRef.current = [];
    sync();
  }
  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!currentRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    currentRef.current.points.push(point(event));
    redraw();
  }
  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    currentRef.current = null;
    redraw();
    sync();
  }
  function clear() { strokesRef.current = []; redoRef.current = []; redraw(); sync(); }
  function undo() { const stroke = strokesRef.current.pop(); if (stroke) redoRef.current.push(stroke); redraw(); sync(); }
  function redo() { const stroke = redoRef.current.pop(); if (stroke) strokesRef.current.push(stroke); redraw(); sync(); }

  return <div>
    <canvas ref={canvasRef} aria-label="Draw your signature using a finger, stylus, or mouse" className="mt-2 h-48 w-full touch-none rounded-xl border-2 border-dashed border-[#143d1a]/40 bg-white" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}/>
    <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={button} disabled={disabled || !state.strokes} onClick={undo}>Undo</button><button type="button" className={button} disabled={disabled || !state.redo} onClick={redo}>Redo</button><button type="button" className={button} disabled={disabled || !state.strokes} onClick={clear}>Clear</button></div>
  </div>;
}

function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number) { if (!stroke.points.length) return; context.beginPath(); context.moveTo(stroke.points[0].x * width, stroke.points[0].y * height); for (const point of stroke.points.slice(1)) context.lineTo(point.x * width, point.y * height); if (stroke.points.length === 1) context.lineTo(stroke.points[0].x * width + 0.1, stroke.points[0].y * height + 0.1); context.stroke(); }
function point(event: React.PointerEvent<HTMLCanvasElement>): Point { const rect = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }; }
const button = "rounded-lg border border-[#143d1a]/30 bg-white px-4 py-2 text-sm font-bold text-[#143d1a] disabled:opacity-40";
