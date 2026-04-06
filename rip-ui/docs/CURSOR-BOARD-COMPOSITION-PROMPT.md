# Cursor Prompt: Board Composition UI for RIP UI

## Project Context

**Project:** Arrow RIP UI - A desktop Electron application for submitting print jobs to a RIP (Raster Image Processor) backend.

**Repository:** `~/Arrow/rip-ui/` (git branch: `test/rip-next-pass`)

**What we're building:** A "board composition" feature that allows users to compose **multiple PDFs on a single board/page** before sending to the RIP. This is a fundamental change from the current single-PDF-per-job model.

---

## Current Architecture

### Current Job Submission Flow
1. User drops **one PDF** in the Artwork Intake drop zone (`src/index.html` line ~200)
2. `placement` state object stores positioning (alignX/Y, scale, rotation, offsetX/Y, fitMode)
3. `submitDataPlaneJob()` in `src/app.js` (line ~554) constructs a payload
4. `bridge.submitJob(payload)` → bridge server → Thrift adapter → RIP

### Key Files (ALL in `~/Arrow/rip-ui/`)

| File | Purpose | Notes |
|------|---------|-------|
| `src/index.html` | UI HTML structure | **NOT minified** - this is where tab panels and UI elements are defined |
| `src/app.js` | Main UI logic (~5,300 lines) | **MINIFIED** - hard to edit directly |
| `src/styles.css` | CSS styling | **NOT minified** |
| `bridge/server.js` | Bridge HTTP server | Already has `/api/jobs/board` proxy endpoint (added at line ~621) |
| `bridge/job-manager.js` | Job lifecycle management | Handles job creation, queue, send |
| `bridge/memjet-adapter.js` | Thrift client for RIP | Currently handles single-job submission |
| `rip-core/adapter/service.py` | Python FastAPI adapter | Already has `/jobs/board` endpoint (line ~254) |
| `rip-core/adapter/board_compositor.py` | PDF composition logic | Already implemented |

---

## What Needs to Change in the UI

### 1. State Structure (in `src/app.js`)

Currently:
```javascript
state = {
  artwork: {
    placement: { /* single placement object */ }
  }
}
```

Needs to become:
```javascript
state = {
  artwork: {
    placement: { /* single placement object */ },
    boardMode: false,
    board: {
      widthInches: 8.5,
      heightInches: 11.0,
      placements: [
        { pdfPath, xInches, yInches, scale, rotationDegrees, pageNumber, fileName }
      ]
    }
  }
}
```

### 2. UI Elements Needed (in `src/index.html`)

**In the Job Submission panel (`#panelJobSubmission`), add:**

1. **Mode Toggle** - Switch between "Single PDF" and "Board Composition" modes
2. **Board Settings Panel** (when board mode is active):
   - Board width/height inputs (inches)
   - "Add PDF to Board" button
   - List of placed PDFs with:
     - Thumbnail or filename
     - X, Y position inputs
     - Scale input
     - Rotation input
     - Remove button
   - Visual board preview (canvas)

### 3. Submission Changes

When in board mode, `submitDataPlaneJob()` needs to:
1. Call `POST /api/jobs/board` (bridge proxy) instead of `bridge.submitJob()`
2. Send board config + placements array

---

## Backend Endpoint Already Implemented

### Bridge Proxy (`bridge/server.js`, line ~621)
```
POST /api/jobs/board
→ Proxies to: http://localhost:8080/jobs/board
→ Env var: RIP_ADAPTER_URL (defaults to http://localhost:8080)
```

### Python FastAPI Adapter (`rip-core/adapter/service.py`, line ~254)
```
POST /jobs/board
Body: {
  "board_width_inches": 8.5,
  "board_height_inches": 11.0,
  "placements": [
    {
      "pdf_path": "/path/to/file.pdf",
      "x_inches": 0.5,
      "y_inches": 0.5,
      "scale": 1.0,
      "rotation_degrees": 0,
      "page_number": 0
    }
  ],
  "args": [],
  "env": {}
}
Response: { "id": "job-uuid", "status": "queued", "composite_path": "/tmp/board-xxx.pdf" }
```

---

## Your Task for Cursor

### Step 1: Locate and Verify

Cursor should locate and confirm the EXACT lines in:

1. **`src/index.html`** - Find:
   - Line: The Artwork Intake section (`#panelArtworkIntake`)
   - Line: The drop zone (`#dropZone`)
   - Line: The Job Settings table
   - Line: The Sheet Layout Preview canvas (`#layoutCanvas`)
   - Line: The Arrange panel (`#panelArrange`)

2. **`src/app.js`** (minified) - Find:
   - Line: `INITIAL_STATE` definition (for artwork placement)
   - Line: `submitDataPlaneJob()` function
   - Line: `state.artwork.placement` usage
   - Line: Where `bridge.submitJob()` is called

3. **`src/styles.css`** - Find:
   - Line: `.drop-zone` styles
   - Line: `.job-settings-card` styles
   - Line: `.layout-job-submission` styles

### Step 2: Propose UI Changes

After verifying locations, Cursor should propose:

1. **HTML changes** to `src/index.html`:
   - Add a mode toggle switch before the drop zone
   - Add a "Board Composition" panel with board dimensions, PDF list, and controls
   - Position it appropriately within `#panelJobSubmission`

2. **CSS changes** to `src/styles.css`:
   - Add styles for the new board mode panel
   - Add styles for the PDF list items in board mode
   - Add styles for board mode toggle

3. **JavaScript changes** to `src/app.js`:
   - Update `INITIAL_STATE` to include board mode state
   - Add board mode state management functions
   - Modify `submitDataPlaneJob()` to detect board mode and call `/api/jobs/board`
   - Add event handlers for board controls

### Step 3: Implementation Plan

Cursor should output a clear implementation plan with:
- Exact file paths and line numbers for each change
- Code snippets showing what to add/modify
- Order of implementation (HTML first, then CSS, then JS)

---

## Success Criteria

1. ✅ Cursor locates all 3 files (`index.html`, `app.js`, `styles.css`) and shows exact line numbers
2. ✅ Cursor identifies current submission flow and board endpoint
3. ✅ Cursor provides complete implementation plan with code
4. ✅ Plan allows a user to make the changes without guessing

---

## Notes

- The `src/app.js` is minified but that's the file that runs in production
- The Python FastAPI adapter already does the PDF composition via `board_compositor.py`
- The bridge proxy already forwards `/api/jobs/board` to the adapter
- The main work is in the **UI state management and submission logic**
- The board composition is NOT about multiple copies of same PDF (that's "copies" in Arrange panel) - it's about placing **different** PDFs on one board
