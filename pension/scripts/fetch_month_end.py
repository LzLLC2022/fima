import sys
import urllib.request
import json
import re

if len(sys.argv) < 3:
    print("Usage: fetch_month_end.py <ticker> <yyyyMM>")
    sys.exit(1)

ticker = sys.argv[1]
year_month = sys.argv[2]  # e.g., '202606'

# Convert 'yyyyMM' to 'yyyy-MM'
target_month_prefix = f"{year_month[:4]}-{year_month[4:6]}"

def get_unadjusted_close(ticker, target_month_prefix):
    # m.stock.naver.com API usually covers about 60 days per page if we set pageSize=60
    url = f"https://m.stock.naver.com/api/stock/{ticker}/price?pageSize=60&page=1"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    
    try:
        response = urllib.request.urlopen(req).read().decode('utf-8')
        data = json.loads(response)
    except Exception as e:
        return -1
    
    # data is a list of objects like {"localTradedAt":"2026-10-02", "closePrice":"6,377"}
    for row in data:
        date_str = row.get("localTradedAt", "")
        if date_str.startswith(target_month_prefix):
            price_str = row.get("closePrice", "0").replace(",", "")
            return int(price_str)
        if date_str < target_month_prefix:
            return -1
            
    # If not found in page 1, we could try page 2, but pageSize=60 should cover the last 2 months easily
    # for the monthly report's prev/prevPrev month queries.
    # Let's add a quick fallback to page 2 just in case.
    url2 = f"https://m.stock.naver.com/api/stock/{ticker}/price?pageSize=60&page=2"
    req2 = urllib.request.Request(url2, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        response2 = urllib.request.urlopen(req2).read().decode('utf-8')
        data2 = json.loads(response2)
        for row in data2:
            date_str = row.get("localTradedAt", "")
            if date_str.startswith(target_month_prefix):
                price_str = row.get("closePrice", "0").replace(",", "")
                return int(price_str)
            if date_str < target_month_prefix:
                return -1
    except:
        pass

    return -1

val = get_unadjusted_close(ticker, target_month_prefix)
print(val)

