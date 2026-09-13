const url = 'https://investments.miraeasset.com/tigeretf/ko/product/search/detail/refDivAjax.ajax';
(async () => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'ksdFund=KR7466940004&pageIndex=2'
  });
  const text = await res.text();
  console.log(text.substring(0, 500));
})();
