const fs = require('fs');
let html = fs.readFileSync('public/fima.html', 'utf8');

const regex = /<div class="fg-hist-label">Previous close<\/div>\s*<div class="fg-hist-status">탐욕<\/div>\s*<\/div>\s*<div class="fg-hist-badge badge-greed">66<\/div>/g;

html = html.replace(regex, `<div class="fg-hist-label">Previous close</div>
                <div class="fg-hist-status" id="fg-hist-prev-text">탐욕</div>
              </div>
              <div class="fg-hist-badge badge-greed" id="fg-hist-prev">66</div>`);
              
const regex1w = /<div class="fg-hist-label">1 week ago<\/div>\s*<div class="fg-hist-status">탐욕<\/div>\s*<\/div>\s*<div class="fg-hist-badge badge-greed">64<\/div>/g;

html = html.replace(regex1w, `<div class="fg-hist-label">1 week ago</div>
                <div class="fg-hist-status" id="fg-hist-1w-text">탐욕</div>
              </div>
              <div class="fg-hist-badge badge-greed" id="fg-hist-1w">64</div>`);

const regex1m = /<div class="fg-hist-label">1 month ago<\/div>\s*<div class="fg-hist-status">공포<\/div>\s*<\/div>\s*<div class="fg-hist-badge badge-fear">41<\/div>/g;

html = html.replace(regex1m, `<div class="fg-hist-label">1 month ago</div>
                <div class="fg-hist-status" id="fg-hist-1m-text">공포</div>
              </div>
              <div class="fg-hist-badge badge-fear" id="fg-hist-1m">41</div>`);

const regex1y = /<div class="fg-hist-label">1 year ago<\/div>\s*<div class="fg-hist-status">탐욕<\/div>\s*<\/div>\s*<div class="fg-hist-badge badge-greed">63<\/div>/g;

html = html.replace(regex1y, `<div class="fg-hist-label">1 year ago</div>
                <div class="fg-hist-status" id="fg-hist-1y-text">탐욕</div>
              </div>
              <div class="fg-hist-badge badge-greed" id="fg-hist-1y">63</div>`);

fs.writeFileSync('public/fima.html', html, 'utf8');
console.log('Added IDs to history elements');
