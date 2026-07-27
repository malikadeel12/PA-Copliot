import React, { useCallback, useEffect, useRef, useState } from "react";
import { Crop, RotateCcw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const MIN_CROP = 12;
const INITIAL_CROP = { x: 0, y: 0, width: 100, height: 100 };

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export default function DocumentImageEditor({ open, src, title, onCancel, onApply }) {
  const stageRef = useRef(null);
  const previewRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const [crop, setCrop] = useState(INITIAL_CROP);
  const [rotation, setRotation] = useState(0);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [ready, setReady] = useState(false);

  const drawPreview = useCallback(() => {
    const canvas = previewRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;

    const normalized = ((rotation % 360) + 360) % 360;
    const quarterTurn = normalized === 90 || normalized === 270;
    const width = quarterTurn ? image.naturalHeight : image.naturalWidth;
    const height = quarterTurn ? image.naturalWidth : image.naturalHeight;
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.translate(width / 2, height / 2);
    context.rotate((normalized * Math.PI) / 180);
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    setImageSize({ width, height });
  }, [rotation]);

  useEffect(() => {
    if (!open || !src) return;
    let active = true;
    setReady(false);
    setCrop(INITIAL_CROP);
    setRotation(0);
    loadImage(src)
      .then((image) => {
        if (!active) return;
        imageRef.current = image;
        setReady(true);
      })
      .catch(() => active && setReady(false));
    return () => { active = false; };
  }, [open, src]);

  useEffect(() => {
    if (ready) drawPreview();
  }, [drawPreview, ready]);

  const startDrag = (event, mode) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, crop };
  };

  const drag = (event) => {
    const active = dragRef.current;
    const stage = stageRef.current;
    if (!active || !stage) return;
    event.preventDefault();
    const bounds = stage.getBoundingClientRect();
    const dx = ((event.clientX - active.startX) / bounds.width) * 100;
    const dy = ((event.clientY - active.startY) / bounds.height) * 100;
    const original = active.crop;

    if (active.mode === "move") {
      setCrop({
        ...original,
        x: clamp(original.x + dx, 0, 100 - original.width),
        y: clamp(original.y + dy, 0, 100 - original.height),
      });
      return;
    }

    let left = original.x;
    let top = original.y;
    let right = original.x + original.width;
    let bottom = original.y + original.height;
    if (active.mode.includes("w")) left = clamp(original.x + dx, 0, right - MIN_CROP);
    if (active.mode.includes("e")) right = clamp(right + dx, left + MIN_CROP, 100);
    if (active.mode.includes("n")) top = clamp(original.y + dy, 0, bottom - MIN_CROP);
    if (active.mode.includes("s")) bottom = clamp(bottom + dy, top + MIN_CROP, 100);
    setCrop({ x: left, y: top, width: right - left, height: bottom - top });
  };

  const stopDrag = () => { dragRef.current = null; };

  const rotate = (amount) => {
    setRotation((current) => current + amount);
    setCrop(INITIAL_CROP);
  };

  const reset = () => {
    setCrop(INITIAL_CROP);
    setRotation(0);
  };

  const apply = () => {
    const preview = previewRef.current;
    if (!preview) return;
    const sourceX = Math.round(preview.width * crop.x / 100);
    const sourceY = Math.round(preview.height * crop.y / 100);
    const sourceWidth = Math.max(1, Math.round(preview.width * crop.width / 100));
    const sourceHeight = Math.max(1, Math.round(preview.height * crop.height / 100));
    const scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
    const output = document.createElement("canvas");
    output.width = Math.max(1, Math.round(sourceWidth * scale));
    output.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = output.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(preview, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, output.width, output.height);
    onApply(output.toDataURL("image/jpeg", 0.92));
  };

  const ratio = imageSize.width / imageSize.height;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="max-w-4xl max-h-[96vh] overflow-y-auto p-0 gap-0">
        <div className="px-5 py-4 border-b border-stone-200">
          <DialogTitle className="flex items-center gap-2"><Crop className="w-5 h-5 text-emerald-700" /> Crop {title}</DialogTitle>
          <p className="mt-1 text-sm text-stone-500">Drag inside the frame to move it. Drag any corner to resize it.</p>
        </div>

        <div className="bg-stone-950 p-4 sm:p-6 flex justify-center overflow-hidden">
          <div
            ref={stageRef}
            className="relative max-w-full touch-none select-none shadow-2xl"
            style={{ width: `min(100%, ${Math.max(20, 56 * ratio)}vh)`, aspectRatio: String(ratio) }}
            onPointerMove={drag}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
          >
            <canvas ref={previewRef} className="absolute inset-0 w-full h-full" data-testid="document-editor-canvas" />
            <div className="absolute inset-0 bg-black/55 pointer-events-none" />
            <div
              className="absolute cursor-move border-2 border-white shadow-[0_0_0_1px_rgba(16,185,129,.9)]"
              style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.width}%`, height: `${crop.height}%` }}
              onPointerDown={(event) => startDrag(event, "move")}
              data-testid="document-crop-area"
            >
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <canvas
                  width={imageSize.width}
                  height={imageSize.height}
                  className="absolute max-w-none max-h-none"
                  style={{
                    width: `${10000 / crop.width}%`,
                    height: `${10000 / crop.height}%`,
                    left: `${-crop.x * 100 / crop.width}%`,
                    top: `${-crop.y * 100 / crop.height}%`,
                  }}
                  ref={(node) => {
                    if (!node || !previewRef.current) return;
                    const context = node.getContext("2d");
                    context.clearRect(0, 0, node.width, node.height);
                    context.drawImage(previewRef.current, 0, 0);
                  }}
                />
              </div>
              <span className="absolute left-1/3 top-0 bottom-0 border-l border-white/40 pointer-events-none" />
              <span className="absolute left-2/3 top-0 bottom-0 border-l border-white/40 pointer-events-none" />
              <span className="absolute top-1/3 left-0 right-0 border-t border-white/40 pointer-events-none" />
              <span className="absolute top-2/3 left-0 right-0 border-t border-white/40 pointer-events-none" />
              {[["nw", "-left-2 -top-2 cursor-nwse-resize"], ["ne", "-right-2 -top-2 cursor-nesw-resize"], ["sw", "-left-2 -bottom-2 cursor-nesw-resize"], ["se", "-right-2 -bottom-2 cursor-nwse-resize"]].map(([mode, position]) => (
                <button
                  key={mode}
                  type="button"
                  aria-label={`Resize crop from ${mode} corner`}
                  className={`absolute z-10 w-5 h-5 rounded-sm border-2 border-emerald-600 bg-white shadow ${position}`}
                  onPointerDown={(event) => startDrag(event, mode)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3 bg-white">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => rotate(-90)}><RotateCcw className="w-4 h-4 mr-2" /> Rotate left</Button>
            <Button type="button" variant="outline" onClick={() => rotate(90)}><RotateCw className="w-4 h-4 mr-2" /> Rotate right</Button>
            <Button type="button" variant="ghost" onClick={reset}>Reset</Button>
          </div>
          <div className="flex gap-2 ml-auto">
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button type="button" onClick={apply} disabled={!ready} className="bg-emerald-900 hover:bg-emerald-800 text-white"><Crop className="w-4 h-4 mr-2" /> Apply crop</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
