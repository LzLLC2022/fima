import sys
import urllib.request
import ast

if len(sys.argv) < 4:
    print(0)
    sys.exit(1)

ticker = sys.argv[1]
start_time = sys.argv[2]
end_time = sys.argv[3]

url = f'https://api.finance.naver.com/siseJson.naver?symbol={ticker}&requestType=1&startTime={start_time}&endTime={end_time}&timeframe=day'
try:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    resp = urllib.request.urlopen(req).read().decode('utf-8', errors='ignore').strip()
    d = ast.literal_eval(resp)
    if len(d) >= 2:
        # d[-1] is the latest trading day in the range, [4] is the close price
        print(int(d[-1][4]))
    else:
        print(0)
except:
    print(0)
