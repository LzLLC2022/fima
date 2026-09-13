const fs = require('fs');

let lines = fs.readFileSync('public/fima.html', 'utf8').split(/\r?\n/);

// Remove tab buttons
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('switchFgTab(\'summary\')') && lines[i-1].includes('display: flex; background: #f7fafc; padding: 4px;')) {
    lines.splice(i - 1, 4); // Remove lines i-1, i, i+1, i+2
    break;
  }
}

// Update fg-summary-view
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('<div id="fg-summary-view"')) {
    lines[i] = '        <div id="fg-summary-view" style="display: flex; flex-wrap: wrap; gap: 20px; align-items: stretch; justify-content: space-between;">';
    break;
  }
}

// Update Gauge flex
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('<div style="flex: 1; min-width: 300px; display: flex; justify-content: center; position: relative;">')) {
    lines[i] = '          <div style="flex: 0 0 calc(25% - 20px); min-width: 250px; display: flex; justify-content: center; align-items: center; position: relative;">';
    break;
  }
}

// Update History flex
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('<div style="flex: 1; min-width: 250px; max-width: 320px;">')) {
    lines[i] = '          <div style="flex: 0 0 calc(25% - 20px); min-width: 250px; max-width: 320px; display: flex; flex-direction: column; justify-content: center;">';
    break;
  }
}

// Find fg-chart-view and merge it into fg-summary-view
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('<div id="fg-chart-view"')) {
    // We found fg-chart-view. The line before it is an empty line, and the line before that is </div> closing fg-summary-view.
    if (lines[i-2].includes('</div>')) {
      lines[i-2] = ''; // Remove the closing div of fg-summary-view
    }
    
    // Change style of fg-chart-view
    lines[i] = '          <div id="fg-chart-view" style="flex: 0 0 calc(50% - 20px); min-width: 400px; padding: 20px 0; display: flex; align-items: center;">';
    
    // We also need to add a wrapper div around chart content so it stretches properly inside the flex container, or just leave it.
    // The inner div of chart view has height: 250px.
    if (lines[i+1].includes('<div style="height: 250px; position: relative;">')) {
      lines[i+1] = '            <div style="height: 250px; width: 100%; position: relative;">';
    }
    break;
  }
}

// Remove switchFgTab function and add missing closing div
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('<script>') && lines[i+1] && lines[i+1].includes('function switchFgTab(tab) {')) {
    // Add the closing div for fg-summary-view right before this script block
    lines[i] = '        </div>\n        <!-- Script removed -->';
    
    // Blank out the rest of the script block
    let j = i + 1;
    while (!lines[j].includes('</script>')) {
      lines[j] = '';
      j++;
    }
    lines[j] = ''; // blank out </script>
    break;
  }
}

// Write back to file preserving Windows line endings since git might complain otherwise, or just use \n.
fs.writeFileSync('public/fima.html', lines.join('\n'), 'utf8');
console.log('Done replacing layout elements.');
