// 2D Geometry and Server-Side Line of Sight (LOS) Raycasting
// Implements RF-03: Dynamic field of view / fog of war to prevent wallhacks.
// Only entities visible with unobstructed line of sight (or within immediate close range) are sent.

function distance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.hypot(dx, dy);
}

// Check if segment (p1 -> p2) intersects with wall segment (p3 -> p4)
function lineIntersectsLine(p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) {
  const d = (p2x - p1x) * (p4y - p3y) - (p2y - p1y) * (p4x - p3x);
  if (Math.abs(d) < 0.000001) return false;

  const u = ((p3x - p1x) * (p4y - p3y) - (p3y - p1y) * (p4x - p3x)) / d;
  const v = ((p3x - p1x) * (p2y - p1y) - (p3y - p1y) * (p2x - p1x)) / d;

  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

// Raycast: does a line from player A to entity B cross any solid wall or closed door?
function hasLineOfSight(x1, y1, x2, y2, walls, closedDoors = [], maxVisionRadius = 500) {
  const dist = distance(x1, y1, x2, y2);
  if (dist > maxVisionRadius) {
    return false;
  }

  // Check walls (strictly blocks sight if crossed)
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    if (lineIntersectsLine(x1, y1, x2, y2, w[0], w[1], w[2], w[3])) {
      return false;
    }
  }

  // Check closed doors
  for (let i = 0; i < closedDoors.length; i++) {
    const door = closedDoors[i];
    if (door.closed && door.wallSegment) {
      const seg = door.wallSegment;
      if (lineIntersectsLine(x1, y1, x2, y2, seg[0], seg[1], seg[2], seg[3])) {
        return false;
      }
    }
  }

  return true;
}

// Minimum distance from point to segment
function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return distance(px, py, x1, y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return distance(px, py, x1 + t * (x2 - x1), y1 + t * (y2 - y1));
}

// Server authority collision resolver with walls and closed doors
function resolveCollisions(oldX, oldY, newX, newY, radius, walls, closedDoors = []) {
  let targetX = newX;
  let targetY = newY;

  const testObstacles = [...walls];
  for (const d of closedDoors) {
    if (d.closed && d.wallSegment) {
      testObstacles.push(d.wallSegment);
    }
  }

  for (const w of testObstacles) {
    const d = distToSegment(targetX, targetY, w[0], w[1], w[2], w[3]);
    if (d < radius) {
      // Collision detected: push back along normal or restore old coordinate component
      // Check X move alone
      const dxDist = distToSegment(targetX, oldY, w[0], w[1], w[2], w[3]);
      const dyDist = distToSegment(oldX, targetY, w[0], w[1], w[2], w[3]);

      if (dxDist >= radius) {
        targetY = oldY;
      } else if (dyDist >= radius) {
        targetX = oldX;
      } else {
        targetX = oldX;
        targetY = oldY;
      }
    }
  }

  return { x: targetX, y: targetY };
}

module.exports = {
  distance,
  lineIntersectsLine,
  hasLineOfSight,
  distToSegment,
  resolveCollisions
};
