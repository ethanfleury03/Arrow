# CURSOR AGENT MODE: Implement Board Composition UI

## Mission
Implement the board composition feature in the RIP UI Electron app. You are in **Agent mode** — make the actual file edits, do not just describe what to do.

## Working Directory
```
~/Arrow/rip-ui/
```
Branch: `test/rip-next-pass` (already checked out)

## Context You Already Know

### Verified Locations from Prior Analysis
- **src/index.html**: Job Submission panel at line 192, Artwork Intake at line 196, drop zone at line 198, Job Settings table at lines 207-221, Sheet Layout Preview canvas at line 265, Arrange panel at line 271
- **src/app.js**: INITIAL_STATE at line ~23 (artwork.placement at ~95-112), submitDataPlaneJob() at ~554-601, bridge.submitJob() at ~585
- **src/styles.css**: .drop-zone at ~530-539, .job-settings-card at ~546-556, .layout-job-submission at ~457-459

### Backend Already Implemented
- `bridge/server.js` lines 621-643: POST /api/jobs/board proxy → forwards to Python adapter
- `rip-core/adapter/service.py` lines 254-317: POST /jobs/board endpoint
- `rip-core/adapter/board_compositor.py`: composite_board_job() function exists

### The minified app.js Note
`src/app.js` IS minified (single lines, no formatting). Use careful search to find exact insertion points. The function names and structure are still readable.

---

## Implementation Tasks

### Phase 1: HTML Changes (src/index.html)

**Insert after line 221** (after the `</section>` closing .job-settings-card, before the closing `</section>` of #panelArtworkIntake):

```html
<!-- Board Composition Mode Toggle -->
<div class="board-mode-toggle">
  <label class="toggle-label">
    <input type="checkbox" id="chkBoardMode" />
    <span class="toggle-switch"></span>
    <span class="toggle-text">Board Composition Mode</span>
  </label>
</div>

<!-- Board Composition Panel (hidden by default) -->
<section id="boardCompositionPanel" class="board-composition-panel" hidden>
  <div class="board-dimensions-row">
    <div class="board-dim-input">
      <label for="boardWidthInches">Board Width (in)</label>
      <input type="number" id="boardWidthInches" value="8.5" min="1" max="100" step="0.1" />
    </div>
    <div class="board-dim-input">
      <label for="boardHeightInches">Board Height (in)</label>
      <input type="number" id="boardHeightInches" value="11" min="1" max="100" step="0.1" />
    </div>
    <button id="btnAddPdfToBoard" type="button" class="btn-add-pdf-board">+ Add PDF to Board</button>
  </div>

  <div id="boardPdfList" class="board-pdf-list">
    <!-- Board placement items rendered by JS -->
  </div>

  <div id="boardPreviewCanvas" class="board-preview-mini">
    <p class="board-preview-hint">Board preview will appear here</p>
  </div>
</section>
```

### Phase 2: CSS Changes (src/styles.css)

**Append after line ~560** (after .job-settings-card rules):

```css
/* Board Composition Mode Styles */
.board-mode-toggle {
  padding: 12px 16px;
  background: #f0f4f8;
  border-bottom: 1px solid #d0d8e0;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.toggle-label input[type="checkbox"] {
  display: none;
}

.toggle-switch {
  position: relative;
  width: 44px;
  height: 24px;
  background: #c0cad8;
  border-radius: 12px;
  transition: background 0.2s;
}

.toggle-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}

.toggle-label input:checked + .toggle-switch {
  background: #3b82f6;
}

.toggle-label input:checked + .toggle-switch::after {
  transform: translateX(20px);
}

/* Board Composition Panel */
.board-composition-panel {
  padding: 16px;
  background: #fafbfc;
  border-bottom: 1px solid #e2e8f0;
}

.board-composition-panel:not([hidden]) {
  display: block;
}

.board-dimensions-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  margin-bottom: 16px;
}

.board-dim-input {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.board-dim-input label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: #64748b;
}

.board-dim-input input {
  width: 100px;
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  font-size: 14px;
}

.btn-add-pdf-board {
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-add-pdf-board:hover {
  background: #2563eb;
}

/* Board PDF List */
.board-pdf-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
  margin-bottom: 16px;
}

.board-pdf-item {
  display: grid;
  grid-template-columns: 1fr 80px 80px 80px 80px 32px;
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

.board-pdf-item .pdf-filename {
  font-size: 13px;
  font-weight: 500;
  color: #1e293b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board-pdf-item input[type="number"] {
  padding: 5px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  font-size: 12px;
  width: 100%;
}

.board-pdf-item input[type="number"]::placeholder {
  color: #94a3b8;
}

.board-pdf-item .btn-remove-pdf {
  width: 28px;
  height: 28px;
  padding: 0;
  background: #fee2e2;
  color: #dc2626;
  border: none;
  border-radius: 4px;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.board-pdf-item .btn-remove-pdf:hover {
  background: #fecaca;
}

/* Board Preview Mini */
.board-preview-mini {
  height: 120px;
  background: #f1f5f9;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.board-preview-hint {
  font-size: 12px;
  color: #94a3b8;
}
```

### Phase 3: JavaScript Changes (src/app.js)

**IMPORTANT:** The file is minified. Work carefully. Search for exact strings before inserting.

#### Change 3.1: Add board state to INITIAL_STATE

**Find:** The artwork object in INITIAL_STATE (search for `placement:{mediaWidthMm`)
**Insert after** the placement block (before the closing `}` of placement, or right after it):

```javascript
boardMode:false,board:{widthInches:8.5,heightInches:11,placements:[]}
```

#### Change 3.2: Add board mode early-return in submitDataPlaneJob

**Find:** The start of `submitDataPlaneJob` function (search for `async function submitDataPlaneJob`)
**After** `const bridge=getBridge();` and `const jobId=generateJobId();`, **insert:**

```javascript
// Board composition mode
if(state.artwork.boardMode&&state.artwork.board.placements.length>0){const boardPayload={board_width_inches:state.artwork.board.widthInches,board_height_inches:state.artwork.board.heightInches,placements:state.artwork.board.placements.map(p=>({pdf_path:p.pdfPath,x_inches:p.xInches,y_inches:p.yInches,scale:p.scale||1,rotation_degrees:p.rotation||0,page_number:p.pageNumber||0})),args:[],env:{}};try{const apiRes=await fetch('/api/jobs/board',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(boardPayload)});const result=await apiRes.json();state.submission.lastJobId=result.id||jobId;state.submission.lastResult=apiRes.ok?'SUBMITTED':'REJECTED';render();persistState();return;}catch(err){state.submission.lastResult='ERROR: '+err.message;render();persistState();return;}}
```

#### Change 3.3: Add board management functions

**Find:** A safe insertion point after `submitDataPlaneJob` (search for `function submitDataPlaneJob` then look for the next `function` keyword after its closing `}`)

**Insert the following functions:**

```javascript
function toggleBoardMode(){state.artwork.boardMode=!state.artwork.boardMode;const panel=document.getElementById('boardCompositionPanel');const chk=document.getElementById('chkBoardMode');if(chk)chk.checked=state.artwork.boardMode;if(panel)panel.hidden=!state.artwork.boardMode;render();persistState();}
function addPdfToBoard(file){if(!file)return;const reader=new FileReader();reader.onload=function(e){const placements=state.artwork.board.placements||[];placements.push({pdfPath:file.path||file.name,fileName:file.name||'Unknown',xInches:0.5,yInches:0.5,scale:1,rotation:0,pageNumber:0});state.artwork.board.placements=placements;renderBoardPdfList();persistState();};reader.readAsDataURL(file);}
function removePdfFromBoard(index){const placements=state.artwork.board.placements||[];placements.splice(index,1);state.artwork.board.placements=placements;renderBoardPdfList();persistState();}
function renderBoardPdfList(){const list=document.getElementById('boardPdfList');if(!list)return;list.innerHTML='';const placements=state.artwork.board.placements||[];placements.forEach((p,i)=>{const item=document.createElement('div');item.className='board-pdf-item';item.innerHTML='<span class="pdf-filename" title="'+p.fileName+'">'+p.fileName+'</span><input type="number" value="'+p.xInches+'" step="0.1" placeholder="X in" onchange="updateBoardPlacement('+i+',\'xInches\',this.value)"><input type="number" value="'+p.yInches+'" step="0.1" placeholder="Y in" onchange="updateBoardPlacement('+i+',\'yInches\',this.value)"><input type="number" value="'+(p.scale||1)+'" step="0.1" placeholder="Scale" onchange="updateBoardPlacement('+i+',\'scale\',this.value)"><input type="number" value="'+(p.rotation||0)+'" step="1" placeholder="Deg" onchange="updateBoardPlacement('+i+',\'rotation\',this.value)"><button class="btn-remove-pdf" type="button" onclick="removePdfFromBoard('+i+')">×</button>';list.appendChild(item);});}
function updateBoardPlacement(index,field,value){if(state.artwork.board.placements[index]){state.artwork.board.placements[index][field]=parseFloat(value)||0;persistState();}}
```

#### Change 3.4: Wire up event listeners

**Find:** Where event listeners are set up (search for `addEventListener` near the initialization code, or where `bindClick` is called — there should be a section that wires up all the UI controls)

**Add these listeners:**

```javascript
// Board mode toggle
const chkBoardMode=document.getElementById('chkBoardMode');if(chkBoardMode){chkBoardMode.checked=state.artwork.boardMode||false;chkBoardMode.addEventListener('change',toggleBoardMode);}
// Board dimension inputs
const boardWidthInput=document.getElementById('boardWidthInches');const boardHeightInput=document.getElementById('boardHeightInches');if(boardWidthInput)boardWidthInput.addEventListener('change',function(){state.artwork.board.widthInches=parseFloat(this.value)||8.5;persistState();});if(boardHeightInput)boardHeightInput.addEventListener('change',function(){state.artwork.board.heightInches=parseFloat(this.value)||11;persistState();});
// Add PDF to board button
const btnAddPdf=document.getElementById('btnAddPdfToBoard');if(btnAddPdf){btnAddPdf.addEventListener('click',function(){const input=document.createElement('input');input.type='file';input.accept='.pdf,application/pdf';input.onchange=function(){if(this.files&&this.files[0])addPdfToBoard(this.files[0]);};input.click();});}
// Initial render of board list
if(state.artwork.boardMode)renderBoardPdfList();
```

---

## Implementation Order

1. **Edit src/styles.css** first (append styles at end)
2. **Edit src/index.html** (insert HTML after line 221)
3. **Edit src/app.js** carefully:
   - First add board state to INITIAL_STATE
   - Then add board-mode branch in submitDataPlaneJob
   - Then add board management functions
   - Then add event listeners

## Testing After Implementation

1. Run `npm start` to launch the Electron app
2. Navigate to the Job Submission tab
3. Verify the Board Composition Mode toggle appears
4. Toggle it on and verify the board panel appears
5. Click "+ Add PDF to Board" and select a PDF
6. Verify the PDF appears in the list with X/Y/Scale/Rotation inputs
7. Submit the job and verify it calls POST /api/jobs/board

## Git Commit Message
```
feat: add board composition UI for multi-PDF layout jobs

- Add board mode toggle in Job Submission panel
- Add board composition panel with dimensions and PDF list
- Integrate with existing POST /api/jobs/board endpoint
- Board placements support x/y/scale/rotation per PDF
```

Commit and push to `test/rip-next-pass`.

---

## Important Reminders

- The app.js file IS MINIFIED — single long lines, no formatting
- Search for exact strings before inserting code
- Use the file's existing style (it's all on one line per function)
- Make sure all brackets and parentheses are balanced
- After each edit, verify the change was applied correctly
- Test the app runs after all changes
