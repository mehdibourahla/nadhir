export const PATTERNS = [
  "rain",
  "storm",
  "sand",
  "wind",
  "heat",
  "other",
  "upcoming",
] as const;
export type MapPattern = (typeof PATTERNS)[number];

const TILE = 24;
const INK = "rgba(38, 59, 73, 0.3)";

export const patternImage = (pattern: MapPattern) => `pattern-${pattern}`;

export function drawPattern(pattern: MapPattern): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TILE * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Map pattern canvas unavailable");
  context.scale(2, 2);
  context.strokeStyle = INK;
  context.fillStyle = INK;
  context.lineWidth = 1;
  context.lineCap = "round";
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  };
  if (pattern === "rain") {
    line(5, 2, 3, 7);
    line(13, 9, 11, 14);
  } else if (pattern === "storm") {
    context.beginPath();
    context.moveTo(9, 2);
    context.lineTo(6, 8);
    context.lineTo(9, 8);
    context.lineTo(7, 14);
    context.stroke();
  } else if (pattern === "sand") {
    for (const [x, y] of [
      [3, 3],
      [11, 5],
      [6, 11],
      [14, 13],
    ] as const) {
      context.beginPath();
      context.arc(x, y, 0.9, 0, Math.PI * 2);
      context.fill();
    }
  } else if (pattern === "wind") {
    line(2, 5, 12, 5);
    line(5, 11, 15, 11);
  } else if (pattern === "heat") {
    context.beginPath();
    context.moveTo(1, 8);
    context.quadraticCurveTo(5, 4, 8, 8);
    context.quadraticCurveTo(11, 12, 15, 8);
    context.stroke();
  } else if (pattern === "upcoming") {
    line(0, TILE, TILE, 0);
    line(-TILE / 2, TILE / 2, TILE / 2, -TILE / 2);
    line(TILE / 2, TILE * 1.5, TILE * 1.5, TILE / 2);
  }
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
