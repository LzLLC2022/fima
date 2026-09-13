const fs = require('fs');

const lines = fs.readFileSync('public/fima.html', 'utf8').split(/\r?\n/);

let inTabButtons = false;
let inSwitchFn = false;

const newLines = [];

for (let i = 0; i < lines.length; i++) {
  let l = lines[i];

  // 1. Remove Tab buttons
  if (l.includes('<div style="display: flex; background: #f7fafc; padding: 4px; border-radius: 8px; border: 1px solid #e2e8f0;">') && lines[i+1].includes('switchFgTab')) {
    inTabButtons = true;
    continue;
  }
  if (inTabButtons && l.includes('</div>')) {
    inTabButtons = false;
    continue;
  }
  if (inTabButtons) continue;

  // 2. Remove switchFgTab function
  if (l.includes('<script>') && lines[i+1] && lines[i+1].includes('function switchFgTab(tab) {')) {
    inSwitchFn = true;
    continue;
  }
  if (inSwitchFn && l.includes('</script>')) {
    inSwitchFn = false;
    continue;
  }
  if (inSwitchFn) continue;

  // 3. Change #fg-summary-view flex wrap
  if (l.includes('<div id="fg-summary-view"')) {
    l = l.replace(
      /style=".*?"/, 
      'style="display: flex; flex-wrap: wrap; gap: 20px; align-items: stretch; justify-content: space-between;"'
    );
  }

  // 4. Change Gauge flex
  if (l.includes('<div style="flex: 1; min-width: 300px; display: flex; justify-content: center; position: relative;">')) {
    l = l.replace('flex: 1;', 'flex: 0 0 calc(25% - 20px);');
  }

  // 5. Change History flex
  if (l.includes('<div style="flex: 1; min-width: 250px; max-width: 320px;">')) {
    l = l.replace('flex: 1;', 'flex: 0 0 calc(25% - 20px);');
  }

  // 6. Move fg-chart-view inside fg-summary-view
  // Remove the closing div of fg-summary-view
  if (l.trim() === '</div>' && lines[i+1] === '' && lines[i+2] && lines[i+2].includes('<div id="fg-chart-view"')) {
    // Skip this closing div
    continue;
  }

  // 7. Change Chart view flex
  if (l.includes('<div id="fg-chart-view"')) {
    l = l.replace(
      /style=".*?"/, 
      'style="flex: 0 0 calc(50% - 20px); min-width: 400px; position: relative; padding: 20px 0;"'
    );
  }

  // 8. Add closing div after fg-chart-view finishes
  if (l.includes('</div>') && lines[i+1] && lines[i+1].includes('<script>') && lines[i+2] && lines[i+2].includes('function switchFgTab(tab) {')) {
    // This is the end of fg-chart-view. We need one more closing div because it's now inside fg-summary-view
    newLines.push(l);
    newLines.push('        </div> <!-- end of fg-summary-view -->');
    continue;
  }

  newLines.push(l);
}

// Since we removed switchFgTab, the condition in step 8 might not trigger if we skipped switchFgTab!
// Let's rethink step 8. The end of fg-chart-view is right before `<script>` of switchFgTab.
// Actually, it's safer to just do it via exact lines since I know the exact structure.
