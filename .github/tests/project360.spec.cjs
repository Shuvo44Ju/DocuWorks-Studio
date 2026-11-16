const { test, expect } = require("@playwright/test");

test.use({
  viewport: { width: 1440, height: 1000 },
  launchOptions: {
    args: [
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--disable-dev-shm-usage"
    ]
  }
});

test("Project 360 renders CAD previews and rebuilds the 3D viewer cleanly", async ({ page }) => {
  test.setTimeout(150000);
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.goto("http://127.0.0.1:4173/project360.html", { waitUntil: "domcontentloaded" });
  await expect.poll(async () => page.locator("#modelStatus").textContent(), { timeout: 45000 })
    .toMatch(/3D viewer ready|Viewer error/);
  await expect(page.locator("#viewerError")).not.toHaveClass(/show/);
  await page.locator("#canvasWrap").screenshot({ path: "artifacts/01-initial-viewer.png" });

  // Build an actual ASCII DXF fixture so the test exercises the browser DXF parser,
  // rather than only testing the in-app sample-plan shortcut.
  const pairs = [];
  const add = (...values) => pairs.push(...values.map(String));
  const line = (layer, x1, y1, x2, y2) => add(
    "0", "LINE", "8", layer,
    "10", x1, "20", y1, "30", 0,
    "11", x2, "21", y2, "31", 0
  );
  const arc = (layer, x, y, radius, start, end) => add(
    "0", "ARC", "8", layer,
    "10", x, "20", y, "30", 0,
    "40", radius, "50", start, "51", end
  );
  const poly = (layer, pts, closed = true) => {
    add("0", "LWPOLYLINE", "8", layer, "90", pts.length, "70", closed ? 1 : 0);
    for (const [x, y] of pts) add("10", x, "20", y);
  };
  const text = (layer, value, x, y) => add(
    "0", "TEXT", "8", layer, "10", x, "20", y, "30", 0,
    "40", 0.25, "1", value, "50", 0
  );

  // Paired exterior and interior wall faces, in metres.
  line("A-WALL-EXT", 0, 0, 10, 0);
  line("A-WALL-EXT", 0, 0.2, 10, 0.2);
  line("A-WALL-EXT", 10, 0, 10, 8);
  line("A-WALL-EXT", 9.8, 0, 9.8, 8);
  line("A-WALL-EXT", 10, 8, 0, 8);
  line("A-WALL-EXT", 10, 7.8, 0, 7.8);
  line("A-WALL-EXT", 0, 8, 0, 0);
  line("A-WALL-EXT", 0.2, 8, 0.2, 0);
  line("A-WALL-INT", 5, 0.1, 5, 7.9);
  line("A-WALL-INT", 5.2, 0.1, 5.2, 7.9);

  // Door and window markers plus an unclassified paired-glazing detail.
  line("A-DOOR", 1, 0.1, 2, 0.1);
  arc("A-DOOR", 1, 0.1, 0.9, 0, 90);
  line("A-WINDOW", 4, 7.9, 6, 7.9);
  line("A-GLASS-DETAIL", 7, 7.84, 9, 7.84);
  line("A-GLASS-DETAIL", 7, 7.92, 9, 7.92);
  poly("S-COLUMN", [[0.5, 0.5], [0.9, 0.5], [0.9, 0.9], [0.5, 0.9]]);
  text("A-ROOM-TEXT", "OFFICE", 2.5, 4);

  const dxf = [
    "0", "SECTION", "2", "HEADER",
    "9", "$INSUNITS", "70", "6",
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
    ...pairs,
    "0", "ENDSEC", "0", "EOF"
  ].join("\r\n") + "\r\n";

  await page.locator("#cadFile").setInputFiles({
    name: "project360-e2e-floor.dxf",
    mimeType: "application/dxf",
    buffer: Buffer.from(dxf)
  });
  await expect(page.locator("#cadMappingWrap")).not.toHaveClass(/cad-hidden/, { timeout: 30000 });
  await expect(page.locator("#cadLoadedMeta")).toContainText("project360-e2e-floor.dxf");
  await expect(page.locator("#cadGenerate2DBtn")).toBeVisible();
  await expect(page.locator("#cadGenerate3DBtn")).toBeVisible();
  await expect(page.locator("#cadAdvanced")).not.toHaveAttribute("open", "");
  await expect(page.locator("#cadLayerList .cad-layer-row")).toHaveCount(0);

  // Upload should stay lightweight. Build the 2D view only when requested.
  await page.locator("#cadGenerate2DBtn").click();
  await expect(page.locator("#cad2DOutput")).toBeVisible();
  const drawingPixels = await page.locator("#cadPreview").evaluate(canvas => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 180 || data[i + 1] < 180 || data[i + 2] < 180) count++;
    }
    return count;
  });
  expect(drawingPixels, "the 2D preview should contain the uploaded floor-plan linework").toBeGreaterThan(50);
  await page.locator("#cadPreview").screenshot({ path: "artifacts/02-imported-cad-preview.png" });

  // Create actual CAD-derived geometry in the Three.js viewer.
  await page.locator("#cadGenerate3DBtn").click();
  await expect(page.locator("#cadGenerationStatus")).toContainText("3D model generated", { timeout: 30000 });
  await expect(page.locator("#modelStatus")).toHaveText("3D model ready", { timeout: 30000 });
  await page.locator("#cadAdvanced > summary").click();
  await expect(page.locator("#cadLayerList .cad-layer-row")).not.toHaveCount(0, { timeout: 30000 });
  await expect(page.locator("#viewerError")).not.toHaveClass(/show/);
  await expect(page.locator("#cadRoomList .cad-room-row")).not.toHaveCount(0);
  await expect(page.locator("#cadRoomList")).toContainText("OFFICE");
  await page.locator("#cadRoomList .cad-room-row").filter({ hasText: "OFFICE" }).click();
  await expect(page.locator("#editModeStatus")).toContainText("Room ·");
  await expect(page.locator("#editMoveBtn")).toHaveClass(/active/);
  await expect(page.locator("#editNumericPanel")).toBeVisible();
  const initialRoomX = Number(await page.locator("#editPosX").inputValue());
  await page.locator("#editPosX").fill((initialRoomX + 0.5).toFixed(2));
  await page.locator("#editPosX").dispatchEvent("change");
  await expect(page.locator("#editUndoBtn")).toBeEnabled();
  await page.locator("#editUndoBtn").click();
  await expect(page.locator("#editRedoBtn")).toBeEnabled();
  await page.locator("#editRedoBtn").click();
  await page.locator("#editRotateBtn").click();
  await expect(page.locator("#editRotateBtn")).toHaveClass(/active/);
  await page.locator("#editMoveBtn").click();
  await expect(page.locator("#editMoveBtn")).toHaveClass(/active/);
  const cad3dPixels = await page.locator("#three").evaluate(canvas => {
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return 0;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // Count substantially darker pixels that indicate model surfaces/frames,
    // not the pale background or the floor grid alone.
    let modelPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] < 180 && pixels[i + 1] < 200 && pixels[i + 2] < 220) modelPixels++;
    }
    return modelPixels;
  });
  console.log("CAD 3D model pixel count:", cad3dPixels);
  expect(cad3dPixels, "the 3D canvas should contain visible model surfaces").toBeGreaterThan(50);
  await page.locator("#canvasWrap").screenshot({ path: "artifacts/03-cad-3d-view.png" });

  // Exercise multi-floor generation, explode/stack, and then switch model types.
  await page.locator("#cadSampleUpperBtn").click();
  await page.locator("#cadAdvanced > summary").click();
  await expect(page.locator("#cadFloorList .cad-floor-row")).toHaveCount(2);
  await page.locator("#cadBuildMultiBtn").click();
  await expect(page.locator("#modelStatus")).toContainText("Multi-floor building generated · 2 of 2 levels", { timeout: 30000 });
  await page.locator("#cadExplodeBtn").click();
  await expect(page.locator("#cadExplodeBtn")).toHaveText("Stack floors");
  await page.locator("#cadExplodeBtn").click();
  await expect(page.locator("#cadExplodeBtn")).toHaveText("Explode floors");

  // Creating a non-CAD concept after a multi-floor CAD model must remove the old floor groups.
  await page.locator("#conceptOptions > summary").click();
  await page.locator("#useSettings").check();
  await page.locator("#bWidth").fill("18");
  await page.locator("#bDepth").fill("12");
  await page.locator("#floors").fill("3");
  await page.locator("#floorH").fill("3.2");
  await page.locator("#windows").fill("4");
  await page.locator("#staircases").fill("1");
  await page.locator("#elevators").fill("1");
  await page.locator("#createBtn").click();
  await expect(page.locator("#modelStatus")).toContainText("3 levels", { timeout: 30000 });
  await expect(page.locator("#viewerError")).not.toHaveClass(/show/);
  await page.locator("#canvasWrap").screenshot({ path: "artifacts/04-parametric-3d-view.png" });

  // A fresh CAD rebuild must replace that concept model; Clear must remove its floor groups.
  await page.locator("#cadSampleBtn").click();
  await page.locator("#cadAdvanced > summary").click();
  await page.locator("#cadGenerate3DBtn").click();
  await expect(page.locator("#cadGenerationStatus")).toContainText("3D model generated", { timeout: 30000 });
  await page.locator("#cadClearBtn").click();
  await expect(page.locator("#cadMappingWrap")).toHaveClass(/cad-hidden/);
  await expect(page.locator("#cadFloorList .cad-floor-row")).toHaveCount(0);
  await expect(page.locator("#modelStatus")).toHaveText("Ready to create");
  await expect(page.locator("#emptyView")).toBeVisible();
  await page.locator("#canvasWrap").screenshot({ path: "artifacts/05-cleared-viewer.png" });

  expect(pageErrors, "unexpected browser JavaScript exceptions").toEqual([]);
});
