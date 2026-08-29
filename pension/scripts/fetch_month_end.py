import sys
import urllib.request
import re

if len(sys.argv) < 3:
    print("Usage: fetch_month_end.py <ticker> <yyyyMM>")
    sys.exit(1)

ticker = sys.argv[1]
year_month = sys.argv[2]  # e.g., '202606'

# Convert 'yyyyMM' to 'yyyy.MM' to match sise_day format
target_month_prefix = f"{year_month[:4]}.{year_month[4:6]}"

def get_unadjusted_close(ticker, target_month_prefix):
    # Iterate through pages to find the latest trading day in the given month
    for page in range(1, 10):
        url = f"https://finance.naver.com/item/sise_day.naver?code={ticker}&page={page}"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        html = urllib.request.urlopen(req).read().decode('euc-kr')
        
        # Parse rows using regex (each row has date and then multiple tds with numbers, the first one is close price)
        # We find the <tr> blocks
        rows = re.findall(r'<span class="tah p10 gray03">(.*?)</span>.*?<span class="tah p11">(.*?)</span>', html, re.DOTALL)
        
        for date_str, close_price_str in rows:
            if date_str.startswith(target_month_prefix):
                # Found the most recent date in this month!
                return int(close_price_str.replace(',', ''))
            
            # If we went past the target month (e.g., target is 2026.06 and we see 2026.05)
            # Since dates are strictly descending, we can stop if we've gone too far.
            # But string comparison works well here.
            if date_str < target_month_prefix:
                return -1 # Not found, or no data for that month
                
    return -1

val = get_unadjusted_close(ticker, target_month_prefix)
print(val)
