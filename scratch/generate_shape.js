const fs = require('fs');

// Approximate keypoints from the user's screenshot
// Format: [x_index, y_value_0_to_100]
const keypoints = [
  [0, 55], [2, 70], [5, 68], [8, 72], [10, 72], 
  [12, 50], [14, 50], [16, 48], [17, 28], [18, 25], 
  [20, 35], [22, 45], [24, 35], [25, 25], [26, 20], 
  [28, 15], [30, 25], [32, 25], [34, 40], [36, 45], [37, 40],
  [40, 60], [42, 50], [45, 45], [47, 50], [50, 65], [52, 55],
  [55, 68], [57, 50], [58, 40], [60, 50], [62, 35], [63, 35], 
  [65, 45], [67, 30], [68, 20], [69, 15], [70, 25], [71, 15], 
  [72, 12], [73, 25], [74, 25], [76, 40], [77, 42], 
  [78, 70], [79, 75], [81, 72], [82, 72], [84, 76], [86, 72], 
  [88, 72], [90, 68], [91, 65], [92, 60], [93, 62], [94, 60], 
  [95, 45], [96, 30], [97, 40], [98, 25], [99, 25], 
  [100, 35], [102, 45], [104, 38], [106, 42], [108, 35], 
  [110, 50], [112, 70], [113, 68], [114, 72]
];

const maxX = 114;
const targetWidth = 1000;
const targetHeight = 250;

let points = [];
for (let i = 0; i <= maxX; i++) {
  // Find the segment i belongs to
  let p1, p2;
  for (let j = 0; j < keypoints.length - 1; j++) {
    if (keypoints[j][0] <= i && keypoints[j+1][0] >= i) {
      p1 = keypoints[j];
      p2 = keypoints[j+1];
      break;
    }
  }
  
  if (!p1) p1 = keypoints[keypoints.length - 1];
  if (!p2) p2 = keypoints[keypoints.length - 1];
  
  let t = p2[0] === p1[0] ? 0 : (i - p1[0]) / (p2[0] - p1[0]);
  let yVal = p1[1] + (p2[1] - p1[1]) * t;
  
  let x = (i / maxX) * targetWidth;
  let y = targetHeight - (yVal / 100) * targetHeight;
  
  points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
}

console.log(points.join(' '));
