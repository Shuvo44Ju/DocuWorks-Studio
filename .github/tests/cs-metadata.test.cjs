const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const CSBuilder = require(path.join(root, "builder.js"));
const converter = fs.readFileSync(path.join(root, "cs.html"), "utf8");
const CSFileReader = require(path.join(root, "file-reader.js"));

test("URS file reader falls back to FileReader when arrayBuffer throws", async () => {
  const originalFileReader = global.FileReader;
  const file = new Blob(["URS fallback content"]);
  file.arrayBuffer = async () => { throw new DOMException("file provider temporarily unavailable", "NotFoundError"); };
  global.FileReader = class {
    readAsArrayBuffer(blob) {
      Blob.prototype.arrayBuffer.call(blob).then(buffer => {
        this.result = buffer;
        this.onload();
      }, error => {
        this.error = error;
        this.onerror();
      });
    }
  };
  try {
    const bytes = await CSFileReader.readBytes(file);
    assert.equal(new TextDecoder().decode(bytes), "URS fallback content");
  } finally {
    if (originalFileReader === undefined) delete global.FileReader;
    else global.FileReader = originalFileReader;
  }
});

test("URS file reader falls back to a stream if other browser readers fail", async () => {
  const originalFileReader = global.FileReader;
  const file = new Blob(["stream fallback content"]);
  file.arrayBuffer = async () => { throw new DOMException("not found", "NotFoundError"); };
  global.FileReader = undefined;
  try {
    const bytes = await CSFileReader.readBytes(file);
    assert.equal(new TextDecoder().decode(bytes), "stream fallback content");
  } finally {
    if (originalFileReader === undefined) delete global.FileReader;
    else global.FileReader = originalFileReader;
  }
});

test("converter allows retrying the same file after a temporary read failure", () => {
  assert.match(converter, /CSFileReader\\.readBytes\\(original\\)/);
  assert.match(converter, /input\\.value=''/);
  assert.doesNotMatch(converter, /copy it to a local folder \\(such as Desktop\\)/i);
});

const builderSource = fs.readFileSync(path.join(root, "builder.js"), "utf8");

test("missing Equipment Name and URS No. do not block converter workflow", () => {
  assert.doesNotMatch(converter, /Missing URS information/);
  assert.doesNotMatch(converter, /metadataContinue/);
  assert.doesNotMatch(converter, /workflowStep\s*===\s*['"]metadata['"]/);
  assert.doesNotMatch(converter, /equipment name is still missing|URS number is still missing/i);
});

test("AI-extracted metadata remains optional and is not fabricated from the filename", () => {
  assert.match(converter, /metadataFromParsed\(sourcePreflight\)/);
  assert.match(converter, /pendingParsed\.equipmentName=String\(pendingParsed\.equipmentName\|\|sourceMeta\.equipmentName\|\|''\)/);
  assert.match(converter, /pendingParsed\.ursNumber=String\(pendingParsed\.ursNumber\|\|sourceMeta\.ursNumber\|\|''\)/);
  assert.doesNotMatch(builderSource, /Equipment Name and URS No\. are required/);
});

test("CS workbook filename has a safe fallback when metadata is unavailable", () => {
  assert.equal(CSBuilder.getFilename({}), "CS_Output.xlsx");
  assert.equal(CSBuilder.getFilename({ equipmentName: "Balance" }), "CS_Balance.xlsx");
  assert.equal(CSBuilder.getFilename({ ursNumber: "URS-001" }), "CS_URS-001.xlsx");
  assert.equal(CSBuilder.getFilename({ equipmentName: "Balance", ursNumber: "URS-001" }), "CS_Balance_URS-001.xlsx");
});

test("CS sheet and banner remain usable without title metadata", () => {
  assert.equal(CSBuilder.cleanSheetName(""), "CS-Equipment");
  assert.equal(CSBuilder.makeBanner({}), "CS File");
});
