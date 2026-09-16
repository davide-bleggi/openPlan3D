/**
 * Furniture Model Loader
 * Loads GLB models from /models/ for furniture items, with procedural fallback.
 * Models sourced from Kenney Furniture Kit (CC0).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { base } from '$app/paths';
import { createFurnitureModel } from './furnitureModels3d';
import type { FurnitureDef } from './furnitureCatalog';

const loader = new GLTFLoader();
const modelCache = new Map<string, THREE.Group>();
const loadingPromises = new Map<string, Promise<THREE.Group | null>>();

/**
 * Map our catalog IDs to Kenney GLB filenames (without extension).
 * Each entry can also specify scale/rotation adjustments.
 */
interface ModelMapping {
  file: string;
  scale?: number;       // uniform scale multiplier
  rotateY?: number;     // additional Y rotation in radians
  offsetY?: number;     // vertical offset
  /**
   * Opt-in to non-uniform (per-axis) scaling to force the model into the
   * catalog's exact width/height/depth footprint. Default is uniform
   * scaling, which preserves the model's real proportions. Only flat,
   * shape-agnostic items (rugs, doormats) should set this — for anything
   * with recognizable proportions (a sofa, a chair) non-uniform scaling
   * visibly distorts it.
   */
  stretch?: boolean;
}

const MODEL_MAP: Record<string, ModelMapping> = {
  // Living Room
  sofa:           { file: 'loungeDesignSofa', scale: 110 },
  loveseat:       { file: 'loungeDesignSofa', scale: 100 },
  chair:          { file: 'loungeChair', scale: 95 },
  coffee_table:   { file: 'tableCoffee', scale: 100 },
  tv_stand:       { file: 'cabinetTelevision', scale: 100 },
  bookshelf:      { file: 'bookcaseOpen', scale: 100 },
  side_table:     { file: 'sideTable', scale: 80 },
  television:     { file: 'televisionModern', scale: 100 },
  storage:        { file: 'bookcaseClosed', scale: 100 },
  table:          { file: 'table', scale: 100 },
  // fireplace intentionally has no GLB mapping — Kenney Furniture Kit has no
  // fireplace model; the old mapping to `toaster.glb` was a placeholder that
  // rendered a literal toaster. Falls back to the procedural fireplace.

  // Living Room — GLB library expansion (issue #13)
  sofa_classic:         { file: 'loungeSofa', scale: 100 },
  sofa_corner:          { file: 'loungeSofaCorner', scale: 100 },
  sofa_long:            { file: 'loungeSofaLong', scale: 100 },
  sofa_design_corner:   { file: 'loungeDesignSofaCorner', scale: 100 },
  ottoman:              { file: 'loungeSofaOttoman', scale: 100 },
  chair_design:         { file: 'loungeDesignChair', scale: 95 },
  chair_relax:          { file: 'loungeChairRelax', scale: 95 },
  chair_cushion:        { file: 'chairCushion', scale: 95 },
  chair_modern:         { file: 'chairModernCushion', scale: 95 },
  chair_modern_frame:   { file: 'chairModernFrameCushion', scale: 95 },
  chair_rounded:        { file: 'chairRounded', scale: 95 },
  bench_indoor:         { file: 'bench', scale: 100 },
  bench_cushioned:      { file: 'benchCushion', scale: 100 },
  bench_low:            { file: 'benchCushionLow', scale: 100 },
  coffee_table_glass:   { file: 'tableCoffeeGlass', scale: 100 },
  coffee_table_glass_square: { file: 'tableCoffeeGlassSquare', scale: 100 },
  coffee_table_square:  { file: 'tableCoffeeSquare', scale: 100 },
  table_cloth:          { file: 'tableCloth', scale: 100 },
  table_glass:          { file: 'tableGlass', scale: 100 },
  table_round:          { file: 'tableRound', scale: 100 },
  table_cross_cloth:    { file: 'tableCrossCloth', scale: 100 },
  side_table_drawers:   { file: 'sideTableDrawers', scale: 80 },
  bookshelf_wide:       { file: 'bookcaseClosedWide', scale: 100 },
  bookshelf_low:        { file: 'bookcaseOpenLow', scale: 100 },
  tv_stand_doors:       { file: 'cabinetTelevisionDoors', scale: 100 },
  television_antenna:   { file: 'televisionAntenna', scale: 100 },
  television_vintage:   { file: 'televisionVintage', scale: 100 },

  // Bedroom
  bed_queen:      { file: 'bedDouble', scale: 110 },
  bed_twin:       { file: 'bedSingle', scale: 100 },
  nightstand:     { file: 'cabinetBedDrawerTable', scale: 80 },
  dresser:        { file: 'cabinetBedDrawer', scale: 100 },
  wardrobe:       { file: 'bookcaseClosedDoors', scale: 110 },
  bed_bunk:       { file: 'bedBunk', scale: 100 },
  cabinet_bed:    { file: 'cabinetBed', scale: 80 },

  // Kitchen
  stove:          { file: 'kitchenStove', scale: 100 },
  fridge:         { file: 'kitchenFridgeLarge', scale: 100 },
  sink_k:         { file: 'kitchenSink', scale: 100 },
  counter:        { file: 'kitchenCabinet', scale: 100 },
  dishwasher:     { file: 'kitchenCabinetDrawer', scale: 100 },
  oven:           { file: 'kitchenStoveElectric', scale: 100 },
  microwave:            { file: 'kitchenMicrowave', scale: 100 },
  range_hood:           { file: 'hoodModern', scale: 100 },
  range_hood_large:     { file: 'hoodLarge', scale: 100 },
  kitchen_bar:          { file: 'kitchenBar', scale: 100 },
  kitchen_bar_end:      { file: 'kitchenBarEnd', scale: 100 },
  bar_stool:            { file: 'stoolBar', scale: 90 },
  bar_stool_square:     { file: 'stoolBarSquare', scale: 90 },
  cabinet_upper:        { file: 'kitchenCabinetUpper', scale: 100 },
  cabinet_upper_corner: { file: 'kitchenCabinetUpperCorner', scale: 100 },
  cabinet_upper_double: { file: 'kitchenCabinetUpperDouble', scale: 100 },
  cabinet_upper_low:    { file: 'kitchenCabinetUpperLow', scale: 100 },
  cabinet_corner_inner: { file: 'kitchenCabinetCornerInner', scale: 100 },
  cabinet_corner_round: { file: 'kitchenCabinetCornerRound', scale: 100 },
  fridge_standard:      { file: 'kitchenFridge', scale: 100 },
  fridge_built_in:      { file: 'kitchenFridgeBuiltIn', scale: 100 },
  fridge_small:         { file: 'kitchenFridgeSmall', scale: 100 },
  dryer:                { file: 'dryer', scale: 100 },
  washer:               { file: 'washer', scale: 100 },
  blender:              { file: 'kitchenBlender', scale: 100 },
  coffee_machine:       { file: 'kitchenCoffeeMachine', scale: 100 },
  toaster:              { file: 'toaster', scale: 100 },

  // Bathroom
  toilet:         { file: 'toilet', scale: 100 },
  bathtub:        { file: 'bathtub', scale: 100 },
  shower:         { file: 'shower', scale: 100 },
  sink_b:         { file: 'bathroomSink', scale: 100 },
  washer_dryer:   { file: 'washerDryerStacked', scale: 100 },
  shower_round:         { file: 'showerRound', scale: 100 },
  toilet_square:        { file: 'toiletSquare', scale: 100 },
  sink_b_square:        { file: 'bathroomSinkSquare', scale: 100 },
  bathroom_cabinet:       { file: 'bathroomCabinet', scale: 100 },
  bathroom_cabinet_drawer: { file: 'bathroomCabinetDrawer', scale: 100 },
  bathroom_mirror:      { file: 'bathroomMirror', scale: 100 },

  // Office
  desk:           { file: 'desk', scale: 100 },
  office_chair:   { file: 'chairDesk', scale: 90 },
  desk_corner:          { file: 'deskCorner', scale: 100 },
  laptop:               { file: 'laptop', scale: 100 },
  computer_monitor:     { file: 'computerScreen', scale: 100 },
  computer_keyboard:    { file: 'computerKeyboard', scale: 100 },
  computer_mouse:       { file: 'computerMouse', scale: 100 },

  // Dining
  dining_table:   { file: 'tableCross', scale: 100 },
  dining_chair:   { file: 'chair', scale: 90 },

  // Decor
  potted_plant:   { file: 'pottedPlant', scale: 80 },
  floor_plant:    { file: 'plantSmall1', scale: 100 },
  floor_plant_2:        { file: 'plantSmall2', scale: 100 },
  floor_plant_3:        { file: 'plantSmall3', scale: 100 },
  square_rug:           { file: 'rugSquare', scale: 100, stretch: true },
  rug_rounded:          { file: 'rugRounded', scale: 100, stretch: true },
  doormat:              { file: 'rugDoormat', scale: 100, stretch: true },
  pillow:               { file: 'pillow', scale: 100 },
  pillow_blue:          { file: 'pillowBlue', scale: 100 },
  pillow_long:          { file: 'pillowLong', scale: 100 },
  pillow_blue_long:     { file: 'pillowBlueLong', scale: 100 },
  books_stack:          { file: 'books', scale: 100 },
  coat_rack:            { file: 'coatRack', scale: 100 },
  coat_rack_standing:   { file: 'coatRackStanding', scale: 100 },
  trash_can:            { file: 'trashcan', scale: 100 },
  cardboard_box:        { file: 'cardboardBoxClosed', scale: 100 },
  cardboard_box_open:   { file: 'cardboardBoxOpen', scale: 100 },
  teddy_bear:           { file: 'bear', scale: 100 },
  radio:                { file: 'radio', scale: 100 },
  speaker:              { file: 'speaker', scale: 100 },
  speaker_small:        { file: 'speakerSmall', scale: 100 },

  // Lighting
  floor_lamp:           { file: 'lampRoundFloor', scale: 100 },
  table_lamp:           { file: 'lampRoundTable', scale: 100 },
  wall_sconce:          { file: 'lampWall', scale: 100 },
  ceiling_light:        { file: 'lampSquareCeiling', scale: 100 },
  pendant_light:        { file: 'lampSquareCeiling', scale: 100 },
  floor_lamp_square:    { file: 'lampSquareFloor', scale: 100 },
  table_lamp_square:    { file: 'lampSquareTable', scale: 100 },
  ceiling_fan_3d:       { file: 'ceilingFan', scale: 100 },

  // Structures
  stairs:               { file: 'stairs', scale: 100 },
  stairs_corner:        { file: 'stairsCorner', scale: 100 },
  stairs_open:          { file: 'stairsOpen', scale: 100 },
  stairs_open_single:   { file: 'stairsOpenSingle', scale: 100 },

  // Existing catalog entries wired up to rugs already committed to static/models/
  rug:                  { file: 'rugRectangle', scale: 100, stretch: true },
  round_rug:            { file: 'rugRound', scale: 100, stretch: true },
  runner_rug:           { file: 'rugRectangle', scale: 100, stretch: true },

  // Outdoor Furniture
  fire_pit:       { file: 'outdoor_campfire_stones', scale: 100 },
  campfire:       { file: 'outdoor_campfire_logs', scale: 100 },
  tent:           { file: 'outdoor_tent_detailedOpen', scale: 100 },
  outdoor_sign:   { file: 'outdoor_sign', scale: 100 },
  outdoor_pot_large: { file: 'outdoor_pot_large', scale: 100 },
  outdoor_pot_small: { file: 'outdoor_pot_small', scale: 100 },
  bench_outdoor:  { file: 'bench', scale: 100 },

  // Landscaping — Trees
  tree_oak:       { file: 'outdoor_tree_oak', scale: 100 },
  tree_default:   { file: 'outdoor_tree_default', scale: 100 },
  tree_detailed:  { file: 'outdoor_tree_detailed', scale: 100 },
  tree_pine:      { file: 'outdoor_tree_pineRoundA', scale: 100 },
  tree_pine_tall: { file: 'outdoor_tree_pineTallA_detailed', scale: 100 },
  tree_palm:      { file: 'outdoor_tree_palm', scale: 100 },
  tree_palm_bend: { file: 'outdoor_tree_palmBend', scale: 100 },
  tree_palm_tall: { file: 'outdoor_tree_palmTall', scale: 100 },
  tree_fat:       { file: 'outdoor_tree_fat', scale: 100 },
  tree_simple:    { file: 'outdoor_tree_simple', scale: 100 },
  tree_thin:      { file: 'outdoor_tree_thin', scale: 100 },
  tree_tall:      { file: 'outdoor_tree_tall', scale: 100 },
  tree_cone:      { file: 'outdoor_tree_cone', scale: 100 },
  tree_blocky:    { file: 'outdoor_tree_blocks', scale: 100 },
  tree_small:     { file: 'outdoor_tree_small', scale: 100 },

  // Landscaping — Bushes & Plants
  bush:           { file: 'outdoor_plant_bush', scale: 100 },
  bush_detailed:  { file: 'outdoor_plant_bushDetailed', scale: 100 },
  bush_large:     { file: 'outdoor_plant_bushLarge', scale: 100 },
  bush_large_triangle: { file: 'outdoor_plant_bushLargeTriangle', scale: 100 },
  bush_small:     { file: 'outdoor_plant_bushSmall', scale: 100 },
  bush_triangle:  { file: 'outdoor_plant_bushTriangle', scale: 100 },
  cactus_short:   { file: 'outdoor_cactus_short', scale: 100 },
  cactus_tall:    { file: 'outdoor_cactus_tall', scale: 100 },
  hanging_moss:   { file: 'outdoor_hanging_moss', scale: 100 },

  // Landscaping — Flowers
  flower_purple:  { file: 'outdoor_flower_purpleA', scale: 100 },
  flower_red:     { file: 'outdoor_flower_redA', scale: 100 },
  flower_yellow:  { file: 'outdoor_flower_yellowA', scale: 100 },
  flower_purple_b: { file: 'outdoor_flower_purpleB', scale: 100 },
  flower_red_b:   { file: 'outdoor_flower_redB', scale: 100 },
  flower_yellow_b: { file: 'outdoor_flower_yellowB', scale: 100 },
  lily:           { file: 'outdoor_lily_large', scale: 100 },

  // Landscaping — Grass
  grass_tuft:     { file: 'outdoor_grass', scale: 100 },
  grass_large:    { file: 'outdoor_grass_large', scale: 100 },
  grass_leafs:    { file: 'outdoor_grass_leafs', scale: 100 },
  grass_leafs_large: { file: 'outdoor_grass_leafsLarge', scale: 100 },

  // Landscaping — Rocks & Stones
  rock_large:     { file: 'outdoor_rock_largeA', scale: 100 },
  rock_large_b:   { file: 'outdoor_rock_largeB', scale: 100 },
  rock_tall:      { file: 'outdoor_rock_tallA', scale: 100 },
  rock_small:     { file: 'outdoor_rock_smallA', scale: 100 },
  rock_small_b:   { file: 'outdoor_rock_smallB', scale: 100 },
  stone_large:    { file: 'outdoor_stone_largeA', scale: 100 },
  stone_tall:     { file: 'outdoor_stone_tallA', scale: 100 },

  // Landscaping — Misc
  mushroom_red:   { file: 'outdoor_mushroom_red', scale: 100 },
  mushroom_group: { file: 'outdoor_mushroom_redGroup', scale: 100 },
  mushroom_tan:   { file: 'outdoor_mushroom_tan', scale: 100 },
  log_single:     { file: 'outdoor_log', scale: 100 },
  log_large:      { file: 'outdoor_log_large', scale: 100 },
  log_stack:      { file: 'outdoor_log_stack', scale: 100 },
  stump_old:      { file: 'outdoor_stump_old', scale: 100 },
  stump_round:    { file: 'outdoor_stump_round', scale: 100 },
  corn:           { file: 'outdoor_crops_cornStageD', scale: 100 },
  pumpkin:        { file: 'outdoor_crop_pumpkin', scale: 100 },
  statue_column:  { file: 'outdoor_statue_column', scale: 100 },
  obelisk:        { file: 'outdoor_statue_obelisk', scale: 100 },

  // Fencing
  fence_simple:   { file: 'outdoor_fence_simple', scale: 100 },
  fence_planks:   { file: 'outdoor_fence_planks', scale: 100 },
  fence_gate:     { file: 'outdoor_fence_gate', scale: 100 },
  fence_corner:   { file: 'outdoor_fence_corner', scale: 100 },
};

/**
 * Load a GLB model for the given catalog ID.
 * Returns a clone from cache if available, or loads async.
 * Returns null if no GLB mapping exists.
 */
function loadGLBModel(catalogId: string): Promise<THREE.Group | null> {
  const mapping = MODEL_MAP[catalogId];
  if (!mapping) return Promise.resolve(null);

  const cacheKey = mapping.file;

  // Return cached clone
  if (modelCache.has(cacheKey)) {
    return Promise.resolve(modelCache.get(cacheKey)!.clone());
  }

  // Return existing loading promise — clone from cache (not from resolved value, which may be mutated)
  if (loadingPromises.has(cacheKey)) {
    return loadingPromises.get(cacheKey)!.then(() => modelCache.has(cacheKey) ? modelCache.get(cacheKey)!.clone() : null);
  }

  const promise = new Promise<THREE.Group | null>((resolve) => {
    loader.load(
      `${base}/models/${mapping.file}.glb`,
      (gltf) => {
        const group = new THREE.Group();
        // Clone the scene into our group
        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        group.add(gltf.scene);
        modelCache.set(cacheKey, group);
        loadingPromises.delete(cacheKey);
        resolve(group.clone());
      },
      undefined,
      () => {
        // Load failed — fall back
        loadingPromises.delete(cacheKey);
        resolve(null);
      }
    );
  });

  loadingPromises.set(cacheKey, promise);
  return promise;
}

/**
 * Scale a GLB model to match our catalog dimensions.
 * Kenney models are unit-scale (~1m tall). We need to match our cm dimensions.
 */
function scaleToFit(model: THREE.Group, def: FurnitureDef, mapping: ModelMapping, exactSize = false): void {
  // Compute the model's bounding box
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);

  const EPSILON = 0.001;
  if (size.x < EPSILON || size.y < EPSILON || size.z < EPSILON) return;

  // Detect Z-up orientation: only rotate if Y is near-zero (truly flat/degenerate)
  // Don't rotate models that are just naturally short (like beds, tables)
  if (size.y < 0.01 && size.z > size.y * 10) {
    model.rotation.x = -Math.PI / 2;
    model.updateMatrixWorld(true);
    // Recompute bounding box after rotation
    box.setFromObject(model);
    box.getSize(size);
  }

  // Scale to match our catalog dimensions (in cm).
  // Our convention: width=X, height=Y, depth=Z
  const scaleX = def.width / size.x;
  const scaleY = def.height / size.y;
  const scaleZ = def.depth / size.z;

  if (mapping.stretch || exactSize) {
    // Fill the exact footprint even if it distorts proportions. Flat,
    // shape-agnostic items (rugs, doormats) opt into this by default via
    // `mapping.stretch`. `exactSize` opts a specific placed instance in the
    // same way: once the user has explicitly resized it (a real, deliberate
    // footprint request — not just whatever the catalog's nominal box
    // happens to be), honouring that request on every axis matters more
    // than protecting the model's native proportions. Without this, a
    // width-only resize left height/depth's ratio at 1 and the uniform
    // scale below — driven by the smallest ratio — kept the model exactly
    // its original size no matter how far the item was stretched.
    model.scale.set(scaleX, scaleY, scaleZ);
  } else {
    // Default: uniform scaling preserves the model's real proportions.
    // Use the smallest per-axis factor so the model never exceeds the
    // catalog footprint (avoids poking through walls/other furniture);
    // it may end up smaller than the catalog box on one or two axes.
    const uniformScale = Math.min(scaleX, scaleY, scaleZ);
    model.scale.setScalar(uniformScale);
  }

  // Re-center at origin after scaling
  const scaledBox = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3();
  scaledBox.getCenter(center);
  model.position.sub(center);
  // Put bottom on ground plane
  model.position.y -= scaledBox.min.y;

  // Recompute after repositioning
  const finalBox = new THREE.Box3().setFromObject(model);
  model.position.y -= finalBox.min.y;
}

/**
 * Create a furniture model — tries GLB first, falls back to procedural.
 * Returns immediately with procedural model, then replaces with GLB when loaded.
 */
export function createFurnitureModelWithGLB(
  catalogId: string,
  def: FurnitureDef,
  onLoaded?: (model: THREE.Group) => void,
  exactSize = false
): THREE.Group {
  const container = new THREE.Group();
  container.name = `furniture_${catalogId}`;

  // Start with procedural model immediately
  const procedural = createFurnitureModel(catalogId, def);
  container.add(procedural);

  // Try to load GLB async
  const mapping = MODEL_MAP[catalogId];
  if (mapping) {
    loadGLBModel(catalogId).then((glbModel) => {
      if (glbModel) {
        try {
          // Remove procedural and dispose its resources, then add GLB
          container.remove(procedural);
          procedural.traverse((obj: any) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
              if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose());
              else obj.material.dispose();
            }
          });
          scaleToFit(glbModel, def, mapping, exactSize);
          container.add(glbModel);
          onLoaded?.(container);
        } catch (err) {
          // scaleToFit or GLB add failed — fall back to procedural
          console.warn(`[FurnitureLoader] GLB error for ${catalogId}:`, err);
          container.add(procedural);
        }
      }
    });
  }

  return container;
}

/** Check if a catalog item has a GLB model available */
export function hasGLBModel(catalogId: string): boolean {
  return catalogId in MODEL_MAP;
}

/** Get the GLB filename mapped to a catalog ID, if any. Single source of truth for MODEL_MAP. */
export function getModelFile(catalogId: string): string | null {
  return MODEL_MAP[catalogId]?.file ?? null;
}

/** All distinct GLB filenames referenced by the catalog. */
export function getAllModelFiles(): string[] {
  return [...new Set(Object.values(MODEL_MAP).map((m) => m.file))];
}

/** Preload all mapped models */
export function preloadModels(): void {
  for (const catalogId of Object.keys(MODEL_MAP)) {
    loadGLBModel(catalogId);
  }
}
