export type OrthographicFollowFrame = {
  halfWidth: number;
  halfHeight: number;
  horizontalExtent: number;
  verticalExtent: number;
};

export function resolveOrthographicFollowZoom(
  frame: OrthographicFollowFrame,
  minimumZoom: number,
  maximumZoom: number,
  safeFrame: number,
): number {
  const horizontalZoom = frame.halfWidth * safeFrame /
    Math.max(0.001, frame.horizontalExtent);
  const verticalZoom = frame.halfHeight * safeFrame /
    Math.max(0.001, frame.verticalExtent);
  return clamp(Math.min(maximumZoom, horizontalZoom, verticalZoom), minimumZoom, maximumZoom);
}

export function orthographicFrameOccupancy(
  frame: OrthographicFollowFrame,
  zoom: number,
): number {
  return Math.max(
    frame.horizontalExtent * zoom / Math.max(0.001, frame.halfWidth),
    frame.verticalExtent * zoom / Math.max(0.001, frame.halfHeight),
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
