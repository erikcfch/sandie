export const GRID_WIDTH = 1280;
export const GRID_HEIGHT = 720;
export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;
export const WORKGROUP_SIZE = 8;
export const TICKS_PER_FRAME = 3;

/** Extra water-only movement substeps per frame for fast leveling. Chosen so
 * that (1 soak pass + 1 corrode pass + LIQUID_SUBSTEPS) is even, leaving the grid back in buffer A. */
export const LIQUID_SUBSTEPS = 12;
